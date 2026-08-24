/**
 * Reminder resolution use cases (issues 026 / #37, 027 / #38, 028 / #39,
 * 029 / #40).
 *
 * The rule that shapes all of this: **completion is manual and explicit**
 * (docs/DOMAIN.md §9). Nothing here infers that contact happened. A reminder
 * being generated, a notification being delivered or opened, WhatsApp or the
 * dialer being launched — none of it completes anything. Only `complete()`
 * writes a ContactEvent, and only the user calls it.
 *
 * The four resolutions differ in exactly what they record:
 *
 *   complete      → ContactEvent written; recency updated globally
 *   snooze        → nothing recorded; the same reminder waits
 *   skip          → temporary, decaying selection penalty; no ContactEvent
 *   deprioritize  → indefinite priority reduction; no ContactEvent
 *
 * Skip and deprioritize are separate domain states, never one flag (§7.2, §7.3).
 */
import type { Clock } from '../../ports/Clock';
import type { Repositories, UnitOfWork } from '../../ports/repositories';
import type { ReminderInstance } from '../../domain/entities';
import { applyAction, classify, compareForDisplay } from '../../domain/reminder/stateMachine';
import {
  availableSnoozeOptions,
  computeSnoozeTarget,
  type SnoozeOption,
} from '../../domain/reminder/snooze';
import { domainError, err, ok, type Result } from '../../domain/shared/Result';
import { instant, type Instant, type ReminderId } from '../../domain/shared/ids';

/**
 * How long a skip suppresses reselection. Long enough that the person is not
 * offered again immediately, short enough that they return to normal rotation
 * on their own — a skip is "not now", not "not ever" (docs/DOMAIN.md §7.2).
 */
export const SKIP_PENALTY_MS = 14 * 86_400_000;

export interface ReminderView {
  readonly reminder: ReminderInstance;
  readonly classification: ReturnType<typeof classify>;
  readonly displayName: string;
  readonly phoneE164: string;
}

export class ReminderUseCases {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock
  ) {}

  /**
   * Everything awaiting the user, ordered overdue-first then oldest-first.
   *
   * Snoozed reminders are included but sort last: they are still pending, just
   * asked to wait (docs/DOMAIN.md §8.3).
   */
  async listPending(): Promise<ReminderView[]> {
    const now = this.clock.now();
    const pending = await this.uow.repositories.reminders.findPending();

    const views: ReminderView[] = [];
    for (const reminder of pending) {
      const contact = await this.uow.repositories.contacts.findById(reminder.contactReferenceId);
      views.push({
        reminder,
        classification: classify(reminder, now),
        // Falls back to nothing rather than failing: an unavailable contact
        // must not hide the task.
        displayName: contact?.displayNameCache ?? 'Unknown contact',
        phoneE164: contact?.phoneE164 ?? '',
      });
    }

    return views.sort((a, b) => compareForDisplay(a.reminder, b.reminder, now));
  }

  /**
   * Mark a reminder complete. The ONLY path that records contact history.
   *
   * Writes the reminder resolution and the ContactEvent in one transaction: a
   * completion without its event would silently corrupt future rotation, since
   * recency is derived from those events.
   */
  async complete(id: ReminderId): Promise<Result<ReminderInstance>> {
    return this.resolve(id, 'complete', async (repos, reminder, now) => {
      await repos.events.record(
        {
          contactReferenceId: reminder.contactReferenceId,
          occurredAt: now,
          source: 'reminder_completion',
          relatedReminderId: reminder.id,
        },
        now
      );
    });
  }

  /**
   * "Skip this time" — resolve the occurrence, keep the person in rotation,
   * apply a temporary penalty so they are not offered again immediately.
   */
  async skip(id: ReminderId): Promise<Result<ReminderInstance>> {
    return this.resolve(id, 'skip', async (repos, reminder, now) => {
      await repos.priorities.applySkipPenalty(
        reminder.contactReferenceId,
        instant(now + SKIP_PENALTY_MS),
        now
      );
    });
  }

  /**
   * "Don't prioritise for now" — indefinite, no decay, and reversible only by
   * the user. Never deletes the person, the membership, or any history.
   */
  async deprioritize(id: ReminderId): Promise<Result<ReminderInstance>> {
    return this.resolve(id, 'deprioritize', async (repos, reminder, now) => {
      await repos.priorities.setDeprioritized(reminder.contactReferenceId, now, now);
    });
  }

  /** Undo a deprioritization. Reactivation is explicit, never automatic (§7.3). */
  async reactivate(id: ReminderId): Promise<Result<void>> {
    const reminder = await this.uow.repositories.reminders.findById(id);
    if (!reminder) return err(domainError('NOT_FOUND', `Reminder ${id} does not exist.`));
    const now = this.clock.now();
    await this.uow.repositories.priorities.setDeprioritized(
      reminder.contactReferenceId,
      null,
      now
    );
    return ok(undefined);
  }

  /** Which snooze options can actually succeed for this reminder right now. */
  async snoozeOptionsFor(id: ReminderId): Promise<Result<SnoozeOption[]>> {
    const context = await this.snoozeContext(id);
    if (!context.ok) return context;
    return ok(availableSnoozeOptions(context.value));
  }

  /**
   * Snooze. Modifies the existing reminder and never creates a second one
   * (docs/DOMAIN.md §8.5), and leaves the group's schedule untouched.
   */
  async snooze(id: ReminderId, option: SnoozeOption): Promise<Result<ReminderInstance>> {
    const reminder = await this.uow.repositories.reminders.findById(id);
    if (!reminder) return err(domainError('NOT_FOUND', `Reminder ${id} does not exist.`));

    const context = await this.snoozeContext(id);
    if (!context.ok) return context;

    const target = computeSnoozeTarget(option, context.value);
    if (!target.ok) return target;

    const now = this.clock.now();
    const transition = applyAction({
      reminder,
      action: 'snooze',
      now,
      snoozeUntil: target.value,
    });
    if (!transition.ok) return transition;

    await this.uow.repositories.reminders.snooze(id, target.value, now);
    return ok((await this.uow.repositories.reminders.findById(id)) as ReminderInstance);
  }

  private async snoozeContext(
    id: ReminderId
  ): Promise<Result<{ now: Instant; timeZone: ReturnType<Clock['timeZone']>; schedule: Awaited<ReturnType<Repositories['schedules']['findById']>> }>> {
    const reminder = await this.uow.repositories.reminders.findById(id);
    if (!reminder) return err(domainError('NOT_FOUND', `Reminder ${id} does not exist.`));

    // Null when the schedule was deleted. The relative snooze options still
    // work; next_occurrence does not, and is filtered out accordingly.
    const schedule = reminder.scheduleId
      ? await this.uow.repositories.schedules.findById(reminder.scheduleId)
      : null;

    return ok({ now: this.clock.now(), timeZone: this.clock.timeZone(), schedule });
  }

  /**
   * Shared resolution path.
   *
   * The state machine decides legality before anything is written, and the
   * side effect runs in the same transaction as the resolution.
   */
  private async resolve(
    id: ReminderId,
    action: 'complete' | 'skip' | 'deprioritize',
    sideEffect: (
      repos: Repositories,
      reminder: ReminderInstance,
      now: Instant
    ) => Promise<void>
  ): Promise<Result<ReminderInstance>> {
    const existing = await this.uow.repositories.reminders.findById(id);
    if (!existing) return err(domainError('NOT_FOUND', `Reminder ${id} does not exist.`));

    const now = this.clock.now();
    const transition = applyAction({ reminder: existing, action, now });
    if (!transition.ok) return transition;

    const resolvedState = transition.value.state;
    // Narrow rather than cast: these three actions can only produce a terminal
    // state, and if that ever stopped being true we want a failure here, not a
    // 'pending' silently written through a lying assertion.
    if (resolvedState === 'pending') {
      return err(
        domainError('INVALID_TRANSITION', `${action} unexpectedly left the reminder pending.`)
      );
    }

    await this.uow.transaction(async (repos) => {
      await repos.reminders.resolve(id, resolvedState, now);
      await sideEffect(repos, existing, now);
    });

    return ok((await this.uow.repositories.reminders.findById(id)) as ReminderInstance);
  }
}
