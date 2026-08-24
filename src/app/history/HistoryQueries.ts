/**
 * History and activity queries (issues 018 / #29, 040 / #51, 041 / #52,
 * 042 / #53).
 *
 * A thin read layer: it fetches persisted history and hands it to the pure
 * metric functions in src/domain/metrics. Nothing is cached and no counters are
 * maintained — every figure is derived on demand (docs/DOMAIN.md §15).
 *
 * That is a correctness decision, not just a tidy one. A stored counter would
 * drift the moment a reminder was cancelled or a contact went unavailable, and
 * nothing would reveal the drift.
 *
 * No presentation here. Phase A builds the data foundation only
 * (docs/PRODUCT.md §6).
 */
import type { Clock } from '../../ports/Clock';
import type { UnitOfWork } from '../../ports/repositories';
import type { ContactEvent, ReminderInstance } from '../../domain/entities';
import {
  activitySince,
  averageContactIntervalDays,
  buildScorecard,
  completionRate,
  completionRateByGroup,
  completionStreaks,
  countReminders,
  neverContacted,
  notRecentlyContacted,
  summariseRecency,
  type ActivitySummary,
  type RecencySummary,
  type Scorecard,
} from '../../domain/metrics/metrics';
import { classify } from '../../domain/reminder/stateMachine';
import { instant, type ContactReferenceId, type GroupId } from '../../domain/shared/ids';

const MS_PER_DAY = 86_400_000;

/** One row of a person's timeline, whichever kind of record it came from. */
export type TimelineEntry =
  | { readonly kind: 'reminder'; readonly at: number; readonly reminder: ReminderInstance }
  | { readonly kind: 'contact'; readonly at: number; readonly event: ContactEvent };

export class HistoryQueries {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock
  ) {}

  // ── reminder history (issue 040) ──────────────────────────────────────────

  /** Every reminder ever raised for a person, newest first. */
  async remindersForContact(id: ContactReferenceId): Promise<ReminderInstance[]> {
    return this.uow.repositories.reminders.findByContact(id);
  }

  async remindersForGroup(id: GroupId): Promise<ReminderInstance[]> {
    return this.uow.repositories.reminders.findByGroup(id);
  }

  /**
   * A person's combined timeline: what the app asked, and what the user
   * confirmed.
   *
   * The two are kept as distinct entry kinds rather than merged. A reminder is
   * not evidence of contact, and flattening them would blur exactly the
   * distinction docs/DOMAIN.md §10 draws.
   */
  async timelineForContact(id: ContactReferenceId): Promise<TimelineEntry[]> {
    const reminders = await this.uow.repositories.reminders.findByContact(id);
    const events = await this.uow.repositories.events.findByContact(id);

    const entries: TimelineEntry[] = [
      ...reminders.map((reminder) => ({
        kind: 'reminder' as const,
        at: reminder.resolvedAt ?? reminder.occurrenceAt,
        reminder,
      })),
      ...events.map((event) => ({ kind: 'contact' as const, at: event.occurredAt, event })),
    ];

    return entries.sort((a, b) => b.at - a.at);
  }

  // ── activity queries (issue 041) ──────────────────────────────────────────

  /** Pending reminders grouped by how they present right now. */
  async pendingByClassification(): Promise<{
    due: ReminderInstance[];
    overdue: ReminderInstance[];
    snoozed: ReminderInstance[];
  }> {
    const now = this.clock.now();
    const pending = await this.uow.repositories.reminders.findPending();

    const due: ReminderInstance[] = [];
    const overdue: ReminderInstance[] = [];
    const snoozed: ReminderInstance[] = [];

    for (const reminder of pending) {
      const classification = classify(reminder, now);
      if (classification === 'overdue') overdue.push(reminder);
      else if (classification === 'snoozed') snoozed.push(reminder);
      else if (classification === 'due') due.push(reminder);
    }

    return { due, overdue, snoozed };
  }

  async recencyFor(id: ContactReferenceId): Promise<RecencySummary> {
    const events = await this.uow.repositories.events.findByContact(id);
    return summariseRecency(id, events, this.clock.now());
  }

  /** People never contacted — the top of the rotation ladder. */
  async neverContactedPeople(): Promise<ContactReferenceId[]> {
    const contacts = await this.uow.repositories.contacts.findAll();
    const events = await this.uow.repositories.events.findAll();
    return neverContacted(
      contacts.map((c) => c.id),
      events
    );
  }

  async notContactedInDays(days: number): Promise<ContactReferenceId[]> {
    const contacts = await this.uow.repositories.contacts.findAll();
    const events = await this.uow.repositories.events.findAll();
    return notRecentlyContacted(
      contacts.map((c) => c.id),
      events,
      this.clock.now(),
      days
    );
  }

  async averageIntervalDaysFor(id: ContactReferenceId): Promise<number | null> {
    const events = await this.uow.repositories.events.findByContact(id);
    return averageContactIntervalDays(id, events);
  }

  async activityInLastDays(days: number): Promise<ActivitySummary> {
    const now = this.clock.now();
    const reminders = await this.uow.repositories.reminders.findAll();
    const events = await this.uow.repositories.events.findAll();
    return activitySince(reminders, events, instant(now - days * MS_PER_DAY), now);
  }

  // ── metrics (issue 042) ───────────────────────────────────────────────────

  async reminderCounts() {
    const reminders = await this.uow.repositories.reminders.findAll();
    return countReminders(reminders, this.clock.now());
  }

  async overallCompletionRate(): Promise<number | null> {
    return completionRate(await this.uow.repositories.reminders.findAll());
  }

  async completionRatePerGroup(): Promise<Map<GroupId, number | null>> {
    return completionRateByGroup(await this.uow.repositories.reminders.findAll());
  }

  async streaks() {
    return completionStreaks(await this.uow.repositories.reminders.findAll());
  }

  /** The whole scorecard in one pass, for a future statistics screen. */
  async scorecard(): Promise<Scorecard> {
    const [reminders, events, contacts] = [
      await this.uow.repositories.reminders.findAll(),
      await this.uow.repositories.events.findAll(),
      await this.uow.repositories.contacts.findAll(),
    ];

    return buildScorecard({
      reminders,
      events,
      contactIds: contacts.map((c) => c.id),
      now: this.clock.now(),
    });
  }
}
