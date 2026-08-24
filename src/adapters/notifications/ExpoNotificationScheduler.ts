/**
 * NotificationScheduler backed by expo-notifications (issue 034 / #45).
 *
 * Local notifications only. No push, no FCM, no APNs, no server — permanently
 * out of scope (docs/PRODUCT.md §5).
 *
 * Three decisions from docs/PLATFORM.md §2 are baked in here:
 *
 * 1. **DATE triggers only.** Repeating OS triggers cannot express rotation,
 *    because *who* a reminder is about changes every cycle. One absolute
 *    trigger per reminder.
 * 2. **The identifier IS the reminder id.** That gives a 1:1 mapping between a
 *    database row and an OS notification, which is what makes drift
 *    reconciliation and idempotence checkable at all.
 * 3. **No SCHEDULE_EXACT_ALARM.** Reminder delivery is not safety-critical, and
 *    it is a restricted permission. A few minutes of drift is fine.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type {
  NotificationContent,
  NotificationPermission,
  NotificationPermissionState,
  NotificationScheduler,
  ScheduledNotification,
} from '../../ports/NotificationScheduler';
import { instant, reminderId, type Instant, type ReminderId } from '../../domain/shared/ids';

/** Prefix so our notifications are distinguishable from anything else. */
const ID_PREFIX = 'stay-close-reminder-';

const ANDROID_CHANNEL_ID = 'reminders';

export function notificationIdFor(id: ReminderId): string {
  return `${ID_PREFIX}${id}`;
}

export function reminderIdFrom(identifier: string): ReminderId | null {
  if (!identifier.startsWith(ID_PREFIX)) return null;
  const raw = Number(identifier.slice(ID_PREFIX.length));
  return Number.isInteger(raw) && raw > 0 ? reminderId(raw) : null;
}

export class ExpoNotificationScheduler implements NotificationScheduler {
  private channelReady = false;

  async permission(): Promise<NotificationPermission> {
    return mapPermission(await Notifications.getPermissionsAsync());
  }

  async request(): Promise<NotificationPermission> {
    return mapPermission(await Notifications.requestPermissionsAsync());
  }

  async scheduleAt(
    id: ReminderId,
    at: Instant,
    content: NotificationContent
  ): Promise<void> {
    await this.ensureChannel();

    const identifier = notificationIdFor(id);

    // Replace rather than stack. Scheduling the same reminder twice must not
    // produce two notifications, and cancel-then-schedule is the only way
    // expo-notifications guarantees that.
    await this.cancel(id);

    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: content.title,
        body: content.body,
        // No badge: the in-app task list is the system of record, and a stale
        // badge count is worse than none.
        badge: undefined,
        data: { reminderId: id },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(at),
        channelId: Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined,
      },
    });
  }

  async cancel(id: ReminderId): Promise<void> {
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationIdFor(id));
    } catch {
      // Cancelling something already gone is success, not failure.
    }
  }

  async listScheduled(): Promise<readonly ScheduledNotification[]> {
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const out: ScheduledNotification[] = [];

      for (const request of scheduled) {
        const id = reminderIdFrom(request.identifier);
        // Ignore anything not ours rather than assuming we own the whole tray.
        if (id === null) continue;

        const at = dateFromTrigger(request.trigger);
        // A notification whose time we cannot read is reported at instant 0, so
        // reconciliation sees it as drifted and replaces it. Safer than
        // omitting it, which would leave a stale notification in place.
        out.push({ id, at: at ?? instant(0) });
      }

      return out;
    } catch {
      // Treated as "nothing scheduled" so reconciliation re-registers rather
      // than concluding the OS state is correct.
      return [];
    }
  }

  /**
   * Android requires a channel before notifications appear. Created lazily and
   * once: doing it at module load would run before permissions exist.
   */
  private async ensureChannel(): Promise<void> {
    if (this.channelReady || Platform.OS !== 'android') return;
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      // No vibration or sound override: a relationship nudge is not urgent.
      vibrationPattern: undefined,
      sound: undefined,
    });
    this.channelReady = true;
  }
}

/**
 * Read the fire time back out of a scheduled trigger.
 *
 * We only ever schedule DATE triggers (see the header), so anything else is
 * either not ours or a leftover from an older build — both of which should be
 * treated as drifted and replaced.
 */
function dateFromTrigger(trigger: Notifications.NotificationTrigger): Instant | null {
  if (!trigger || typeof trigger !== 'object') return null;
  const candidate = trigger as { type?: string; date?: Date | number };
  if (candidate.type !== Notifications.SchedulableTriggerInputTypes.DATE) return null;
  if (candidate.date === undefined) return null;

  const ms = candidate.date instanceof Date ? candidate.date.getTime() : Number(candidate.date);
  return Number.isFinite(ms) ? instant(ms) : null;
}

function mapPermission(status: Notifications.NotificationPermissionsStatus): NotificationPermission {
  return {
    state: mapState(status),
    canAskAgain: status.canAskAgain ?? false,
  };
}

function mapState(
  status: Notifications.NotificationPermissionsStatus
): NotificationPermissionState {
  if (status.granted) return 'granted';
  if (status.status === 'denied') return 'denied';
  if (status.status === 'undetermined') return 'undetermined';
  return 'denied';
}
