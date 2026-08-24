/**
 * NotificationScheduler for web — deliberately limited, and honest about it.
 *
 * Browsers have no equivalent of a scheduled local notification that survives
 * the tab closing. The Notification API only fires while a page (or service
 * worker) is alive, and reliable scheduled delivery needs Web Push, which needs
 * a server — which this product does not have and will not have
 * (docs/PRODUCT.md §5).
 *
 * So on web this schedules **in-page timers**. They fire while the tab is open
 * and are lost when it closes. That is a real limitation, not a bug, and the UI
 * says so rather than implying reminders will arrive like they do on a phone.
 *
 * Crucially the app still works: reminders are persistent database rows, and the
 * in-app list is the system of record (docs/DOMAIN.md §11). A web user sees
 * their due reminders whenever they open the page.
 */
import type {
  NotificationContent,
  NotificationPermission,
  NotificationPermissionState,
  NotificationScheduler,
  ScheduledNotification,
} from '../../ports/NotificationScheduler';
import { instant, type Instant, type ReminderId } from '../../domain/shared/ids';

interface Timer {
  readonly at: Instant;
  readonly handle: ReturnType<typeof setTimeout>;
}

/** setTimeout is unreliable beyond ~24 days (32-bit ms overflow). */
const MAX_TIMER_MS = 20 * 86_400_000;

export class WebNotificationScheduler implements NotificationScheduler {
  private timers = new Map<ReminderId, Timer>();

  async permission(): Promise<NotificationPermission> {
    if (typeof Notification === 'undefined') {
      return { state: 'unavailable', canAskAgain: false };
    }
    return {
      state: mapBrowserPermission(Notification.permission),
      canAskAgain: Notification.permission === 'default',
    };
  }

  async request(): Promise<NotificationPermission> {
    if (typeof Notification === 'undefined') {
      return { state: 'unavailable', canAskAgain: false };
    }
    const result = await Notification.requestPermission();
    return { state: mapBrowserPermission(result), canAskAgain: result === 'default' };
  }

  async scheduleAt(
    id: ReminderId,
    at: Instant,
    content: NotificationContent
  ): Promise<void> {
    await this.cancel(id);

    const delay = at - Date.now();
    // Too far out for a timer to be meaningful, so do not pretend to schedule
    // it. Reconciliation will pick it up on a later page load.
    if (delay <= 0 || delay > MAX_TIMER_MS) return;

    const handle = setTimeout(() => {
      this.timers.delete(id);
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          // Same privacy rule as native: never name the person, because a
          // notification can be seen by anyone near the screen.
          new Notification(content.title, { body: content.body, tag: `stay-close-${id}` });
        }
      } catch {
        // Some browsers throw when constructing a Notification outside a
        // service worker. Failing to notify must not break the page.
      }
    }, delay);

    this.timers.set(id, { at, handle });
  }

  async cancel(id: ReminderId): Promise<void> {
    const existing = this.timers.get(id);
    if (!existing) return;
    clearTimeout(existing.handle);
    this.timers.delete(id);
  }

  async listScheduled(): Promise<readonly ScheduledNotification[]> {
    return [...this.timers.entries()].map(([id, timer]) => ({ id, at: instant(timer.at) }));
  }
}

function mapBrowserPermission(value: NotificationPermission | string): NotificationPermissionState {
  if (value === 'granted') return 'granted';
  if (value === 'denied') return 'denied';
  return 'undetermined';
}
