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
import { instant, type Instant, type ReminderId } from '../../domain/shared/ids';
import { occurrencesBetween } from '../../domain/schedule/cadence';

/**
 * Well below the iOS cap of 64, leaving headroom so we never approach the
 * silent-drop threshold. Reminders beyond this are still real tasks in the app;
 * they simply get their notification registered on a later reconciliation.
 */
export const NOTIFICATION_BUDGET = 48;

/**
 * How far ahead upcoming occurrences are registered with the OS.
 *
 * Long enough that a daily schedule stays covered between app opens, short
 * enough that a schedule edit is not competing with weeks of stale
 * notifications. The budget caps the count regardless.
 */
export const CYCLE_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;

export interface ReconcileNotificationsOutcome {
  /** True when permission is missing, so nothing was scheduled. */
  readonly skipped: boolean;
  readonly scheduled: number;
  readonly cancelled: number;
  readonly alreadyCorrect: number;
  /** Future reminders beyond the budget, deliberately not scheduled yet. */
  readonly deferred: number;
  /** Upcoming schedule occurrences registered with the OS. */
  readonly cyclesScheduled: number;
  readonly cyclesCancelled: number;
}

const SKIPPED: ReconcileNotificationsOutcome = {
  skipped: true,
  scheduled: 0,
  cancelled: 0,
  alreadyCorrect: 0,
  deferred: 0,
  cyclesScheduled: 0,
  cyclesCancelled: 0,
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

    const cycles = await this.reconcileUpcomingCycles(now);

    return {
      skipped: false,
      scheduled,
      cancelled,
      alreadyCorrect,
      deferred,
      cyclesScheduled: cycles.scheduled,
      cyclesCancelled: cycles.cancelled,
    };
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
  /**
   * Registers upcoming schedule occurrences with the OS.
   *
   * WHY THIS EXISTS, because its absence made the product silently useless:
   *
   * Reminders are created for occurrences that have already PASSED —
   * RunScheduler asks for occurrencesBetween(lastRun, now). Reminder
   * notifications are scheduled only for reminders due in the FUTURE. Those two
   * sets never intersect, so a scheduled cycle could never produce a
   * notification. The only thing that ever did was a snooze, which moves an
   * existing reminder forward.
   *
   * The result on a phone: set a group to Sunday at 21:00, close the app, and
   * nothing arrives. Ever. Reported exactly that way.
   *
   * Creating reminders in advance would be the wrong fix. A reminder records
   * something that came due; inventing them early would put not-yet-due rows
   * into pending lists, history, and the occurrence keys that make the
   * scheduler idempotent.
   *
   * So the OS is told about the occurrence TIMES instead. When one fires, the
   * notification says someone is due; opening the app runs the scheduler, which
   * creates the real reminder. On a platform with no background execution
   * (docs/PLATFORM.md §4) a notification can only ever be a nudge to open the
   * app, and that is exactly what this is.
   */
  private async reconcileUpcomingCycles(
    now: Instant
  ): Promise<{ scheduled: number; cancelled: number }> {
    const timeZone = this.clock.timeZone();
    const schedules = await this.uow.repositories.schedules.findAllActive();

    // Same budget as reminders, and for the same reason: iOS silently drops
    // requests past its 64-notification cap (docs/PLATFORM.md §2.3).
    const horizonEnd = instant(now + CYCLE_HORIZON_MS);
    const wanted = new Map<string, Instant>();

    for (const schedule of schedules) {
      for (const at of occurrencesBetween(schedule, now, horizonEnd, timeZone)) {
        // Keyed by schedule and instant, so re-running replaces rather than
        // duplicates, and a rescheduled time becomes a different key.
        wanted.set(`${schedule.id}-${at}`, at);
      }
    }

    // Nearest first, so the budget keeps what matters soonest.
    const ordered = [...wanted.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, NOTIFICATION_BUDGET);
    const keep = new Map(ordered);

    let scheduled = 0;
    let cancelled = 0;

    const existing = await this.notifications.listScheduledCycles();
    for (const entry of existing) {
      const wantedAt = keep.get(entry.key);
      // Gone, moved, or now in the past.
      if (wantedAt === undefined || wantedAt !== entry.at) {
        await this.notifications.cancelCycle(entry.key);
        cancelled++;
      }
    }

    const stillHeld = new Set(
      existing.filter((e) => keep.get(e.key) === e.at).map((e) => e.key)
    );

    const copy = this.copy();
    for (const [key, at] of keep) {
      if (stillHeld.has(key)) continue;
      await this.notifications.scheduleCycle(key, at, copy);
      scheduled++;
    }

    return { scheduled, cancelled };
  }

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
