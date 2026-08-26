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

/**
 * Versioned deliberately.
 *
 * The first channel was created with AndroidImportance.DEFAULT, which shows a
 * notification in the shade but never as a heads-up banner. Android does NOT
 * let an app raise the importance of a channel that already exists —
 * createNotificationChannel updates the name and description of an existing
 * channel and ignores the importance, because that setting belongs to the user
 * once they have it.
 *
 * So correcting the importance in code does nothing for anyone who has already
 * opened the app: they keep the quiet channel forever. A new id creates a new
 * channel at the right importance.
 *
 * The old 'reminders' channel is deleted on first run so it does not linger in
 * system settings as a dead duplicate.
 */
const ANDROID_CHANNEL_ID = 'reminders-v2';
const RETIRED_ANDROID_CHANNEL_IDS = ['reminders'];

export function notificationIdFor(id: ReminderId): string {
  return `${ID_PREFIX}${id}`;
}

export function reminderIdFrom(identifier: string): ReminderId | null {
  if (!identifier.startsWith(ID_PREFIX)) return null;
  const raw = Number(identifier.slice(ID_PREFIX.length));
  return Number.isInteger(raw) && raw > 0 ? reminderId(raw) : null;
}

/**
 * How a notification is presented when it arrives while the app is OPEN.
 *
 * Nothing set this, and the consequence was total: expo-notifications states
 * "for the notification to be presented you have to set a notification handler
 * with setNotificationHandler", and with none set it silently swallows every
 * notification that arrives in the foreground. Tapping "Send a test reminder"
 * produced nothing at all — and a real reminder firing while the app was open
 * would have been invisible too.
 *
 * `shouldPlaySound` must be true on Android, however quiet a relationship nudge
 * ought to be. From the installed type definitions:
 *
 *   "On Android, setting shouldPlaySound: false will result in the drop-down
 *    notification alert NOT showing, no matter what the priority is."
 *
 * A silent notification that never appears is not a gentler reminder; it is no
 * reminder. The channel governs how insistent it actually is.
 */
export const FOREGROUND_BEHAVIOUR = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: true,
  // No badge: the in-app list is the system of record, and a stale count is
  // worse than none.
  shouldSetBadge: false,
} as const;

let handlerConfigured = false;

/**
 * Registers foreground presentation once per process.
 *
 * Called from the constructor rather than at module load, so importing this
 * file has no side effect and the web build never touches it.
 */
function configureForegroundPresentation(): void {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ ...FOREGROUND_BEHAVIOUR }),
  });
}

export class ExpoNotificationScheduler implements NotificationScheduler {
  constructor() {
    configureForegroundPresentation();
  }

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

  /**
   * A notification a few seconds out, so the user can see for themselves that
   * reminders reach this device.
   *
   * Seconds rather than immediate: an immediately-presented notification is
   * easy to miss while the app is in the foreground, and the point is to watch
   * it arrive. Not keyed by ReminderId, so reconciliation leaves it alone.
   */
  async sendTest(content: NotificationContent): Promise<boolean> {
    try {
      await this.ensureChannel();
      const permission = await this.permission();
      if (permission.state !== 'granted') return false;

      await Notifications.scheduleNotificationAsync({
        content: {
          title: content.title,
          body: content.body,
          badge: undefined,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 5,
          repeats: false,
          channelId: Platform.OS === 'android' ? ANDROID_CHANNEL_ID : undefined,
        },
      });
      return true;
    } catch {
      return false;
    }
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
      // HIGH, not DEFAULT. DEFAULT places a notification in the shade without
      // ever showing a heads-up banner, so a reminder could arrive and be seen
      // only by someone who happened to pull the shade down. The whole point is
      // to be noticed at the moment it fires.
      //
      // HIGH is still not FULL_SCREEN or an alarm: no full-screen intent, no
      // bypassing Do Not Disturb. The user can turn the channel down in system
      // settings, which is the right place for that choice.
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: undefined,
      sound: undefined,
    });

    // Remove the superseded channel, or it sits in system settings as a second
    // "Reminders" entry that no longer does anything.
    for (const retired of RETIRED_ANDROID_CHANNEL_IDS) {
      try {
        await Notifications.deleteNotificationChannelAsync(retired);
      } catch {
        // Never created on this device, already gone, or the platform refused.
        // None of those should stop the app from scheduling.
      }
    }

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
