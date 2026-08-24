/**
 * Notification reconciliation (issues 035 / #46, 036 / #47).
 *
 * Brings the OS notification set into agreement with the database. Runs on
 * every launch and after every reminder change, so it must be idempotent.
 *
 * Why reconciliation rather than fire-and-forget scheduling:
 *
 * - iOS caps pending local notification requests at **64** and drops the excess
 *   **silently** (docs/PLATFORM.md §2.3). A naive "schedule everything forever"
 *   design breaks with no error at all once a user has enough groups.
 * - Reboot behaviour is not guaranteed on either platform, and iOS reboot
 *   survival is unverified (§2.2). Rather than trust it, we re-derive the
 *   required set from the database and repair any drift. That makes reboot a
 *   non-issue by construction.
 *
 * So only a **near horizon** is ever materialised, and the OS is treated as a
 * cache that may be wrong.
 */
import type { Clock } from '../../ports/Clock';
import type { NotificationScheduler } from '../../ports/NotificationScheduler';
import type { UnitOfWork } from '../../ports/repositories';
import type { ReminderInstance } from '../../domain/entities';
import type { Instant, ReminderId } from '../../domain/shared/ids';

/**
 * Well below the iOS cap of 64, leaving headroom so we never approach the
 * silent-drop threshold. Reminders beyond this are still real tasks in the app;
 * they simply get their notification registered on a later reconciliation.
 */
export const NOTIFICATION_BUDGET = 48;

export interface ReconcileNotificationsOutcome {
  /** True when permission is missing, so nothing was scheduled. */
  readonly skipped: boolean;
  readonly scheduled: number;
  readonly cancelled: number;
  readonly alreadyCorrect: number;
  /** Future reminders beyond the budget, deliberately not scheduled yet. */
  readonly deferred: number;
}

const SKIPPED: ReconcileNotificationsOutcome = {
  skipped: true,
  scheduled: 0,
  cancelled: 0,
  alreadyCorrect: 0,
  deferred: 0,
};

export interface NotificationCopy {
  readonly title: string;
  readonly body: string;
}

/**
 * Default notification text.
 *
 * Deliberately does not name the person. A lock-screen notification is visible
 * to anyone holding the phone, and this app is about private relationships —
 * naming someone there leaks exactly the information the product promises to
 * keep on-device (docs/PRODUCT.md §5).
 */
export function defaultCopy(): NotificationCopy {
  return {
    title: 'Stay Close',
    body: 'Someone is waiting to hear from you.',
  };
}

export class ReconcileNotifications {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly notifications: NotificationScheduler,
    private readonly clock: Clock,
    private readonly copy: () => NotificationCopy = defaultCopy
  ) {}

  async run(): Promise<ReconcileNotificationsOutcome> {
    const permission = await this.notifications.permission();

    // No permission: the app remains fully functional through its in-app task
    // list. This is a degradation, not a failure (docs/DOMAIN.md §11).
    if (permission.state !== 'granted') return SKIPPED;

    const now = this.clock.now();
    const pending = await this.uow.repositories.reminders.findPending();

    const wanted = this.selectForHorizon(pending, now);
    const wantedIds = new Set(wanted.map((r) => r.id));
    const deferred = this.countFutureReminders(pending, now) - wanted.length;

    // Keyed by reminder so both presence AND time can be compared. Presence
    // alone is not enough: snoozing moves a reminder's due time, and a
    // presence-only check would leave the old notification to fire at the
    // original moment (docs/DOMAIN.md §8.5).
    const existing = new Map<ReminderId, Instant>();
    for (const entry of await this.notifications.listScheduled()) {
      existing.set(entry.id, entry.at);
    }

    let cancelled = 0;
    let scheduled = 0;
    let alreadyCorrect = 0;

    // Cancel anything the OS holds that we no longer want: resolved reminders,
    // reminders now in the past, and anything pushed out of the horizon.
    for (const id of existing.keys()) {
      if (!wantedIds.has(id)) {
        await this.notifications.cancel(id);
        cancelled++;
      }
    }

    // Schedule what is missing or scheduled at the wrong time. Snoozed
    // reminders land here: their dueAt has moved to the snooze target, which is
    // exactly when to notify again.
    for (const reminder of wanted) {
      if (existing.get(reminder.id) === reminder.dueAt) {
        alreadyCorrect++;
        continue;
      }
      await this.notifications.scheduleAt(reminder.id, reminder.dueAt, this.copy());
      scheduled++;
    }

    return { skipped: false, scheduled, cancelled, alreadyCorrect, deferred };
  }

  /** Cancel one reminder's notification. Called when a reminder is resolved. */
  async cancelFor(id: ReminderId): Promise<void> {
    await this.notifications.cancel(id);
  }

  /**
   * The soonest future reminders, up to the budget.
   *
   * A reminder already past due gets **no** notification. It is visible in the
   * app as due or overdue, and firing a late notification for it would be spam
   * — the policy is one notification per reminder (docs/DOMAIN.md §11).
   */
  private selectForHorizon(
    pending: readonly ReminderInstance[],
    now: Instant
  ): ReminderInstance[] {
    return pending
      .filter((reminder) => reminder.dueAt > now)
      .sort((a, b) => a.dueAt - b.dueAt)
      .slice(0, NOTIFICATION_BUDGET);
  }

  private countFutureReminders(pending: readonly ReminderInstance[], now: Instant): number {
    return pending.filter((reminder) => reminder.dueAt > now).length;
  }
}
