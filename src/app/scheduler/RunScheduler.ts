/**
 * The scheduler (issues 031 / #42, 032 / #43).
 *
 * Ties cadence evaluation to rotation and persists the result. Its defining
 * property is **idempotence**: running it repeatedly for the same cycle
 * produces one logical reminder per selected person (docs/DOMAIN.md §14.1).
 *
 * Idempotence is enforced at two independent levels, neither trusting the other:
 *   - `schedule_occurrences` records that a cycle was processed *even when it
 *     selected nobody*. Without that row an empty cycle would look unprocessed
 *     and regenerate on every run, forever.
 *   - `reminders.createIfAbsent` leans on a UNIQUE constraint, so two concurrent
 *     runs cannot both insert.
 *
 * Because no reliable background execution exists on either platform
 * (docs/PLATFORM.md §4), this runs at app launch and generates every cycle that
 * came due while the app was closed. A user who does not open the app for weeks
 * gets those cycles created and correctly classified as overdue — nothing is
 * lost.
 */
import type { Clock } from '../../ports/Clock';
import type { Random } from '../../ports/Random';
import type { Repositories, UnitOfWork } from '../../ports/repositories';
import type { Schedule } from '../../domain/entities';
import { occurrencesBetween } from '../../domain/schedule/cadence';
import { selectForCycle, type RotationCandidate } from '../../domain/rotation/rotation';
import { instant, type ContactReferenceId, type Instant } from '../../domain/shared/ids';

export interface ScheduleRunReport {
  readonly scheduleId: number;
  readonly groupName: string;
  readonly occurrencesProcessed: number;
  readonly occurrencesSkipped: number;
  readonly remindersCreated: number;
  /** Cycles that selected fewer people than asked (docs/DOMAIN.md §7.4). */
  readonly shortCycles: number;
}

export interface SchedulerRunOutcome {
  readonly ranAt: Instant;
  readonly remindersCreated: number;
  readonly occurrencesProcessed: number;
  readonly occurrencesSkipped: number;
  readonly perSchedule: readonly ScheduleRunReport[];
}

export class RunScheduler {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly random: Random
  ) {}

  async run(): Promise<SchedulerRunOutcome> {
    const now = this.clock.now();
    const timeZone = this.clock.timeZone();

    const schedules = await this.uow.repositories.schedules.findAllActive();
    const reports: ScheduleRunReport[] = [];

    let created = 0;
    let processed = 0;
    let skipped = 0;

    for (const schedule of schedules) {
      const report = await this.runSchedule(schedule, now, timeZone);
      if (!report) continue;
      reports.push(report);
      created += report.remindersCreated;
      processed += report.occurrencesProcessed;
      skipped += report.occurrencesSkipped;
    }

    return {
      ranAt: now,
      remindersCreated: created,
      occurrencesProcessed: processed,
      occurrencesSkipped: skipped,
      perSchedule: reports,
    };
  }

  private async runSchedule(
    schedule: Schedule,
    now: Instant,
    timeZone: ReturnType<Clock['timeZone']>
  ): Promise<ScheduleRunReport | null> {
    const repos = this.uow.repositories;

    const group = await repos.groups.findById(schedule.groupId);
    if (!group) return null; // group deleted; the schedule cascades away shortly

    const lastProcessed = await repos.occurrences.latest(schedule.id);
    // Exclusive lower bound. With no history, start just before the anchor so
    // the anchor's own occurrence is included.
    const after = lastProcessed ? lastProcessed.occurrenceAt : instant(schedule.anchorAt - 1);

    const due = occurrencesBetween(schedule, after, now, timeZone);
    if (due.length === 0) {
      return {
        scheduleId: schedule.id,
        groupName: group.name,
        occurrencesProcessed: 0,
        occurrencesSkipped: 0,
        remindersCreated: 0,
        shortCycles: 0,
      };
    }

    let created = 0;
    let processed = 0;
    let skipped = 0;
    let shortCycles = 0;

    for (const occurrenceAt of due) {
      const result = await this.uow.transaction(async (tx) =>
        this.processOccurrence(tx, schedule, group.name, occurrenceAt, now)
      );

      if (result === null) {
        skipped++;
        continue;
      }
      processed++;
      created += result.created;
      if (result.short) shortCycles++;
    }

    return {
      scheduleId: schedule.id,
      groupName: group.name,
      occurrencesProcessed: processed,
      occurrencesSkipped: skipped,
      remindersCreated: created,
      shortCycles,
    };
  }

  /**
   * One cycle, atomically. Returns null when the cycle was already processed.
   *
   * Claiming the occurrence row FIRST is what makes this safe: if the claim
   * fails the cycle is already done and we do no work, and if it succeeds the
   * selection and inserts commit with it or roll back together.
   */
  private async processOccurrence(
    repos: Repositories,
    schedule: Schedule,
    groupName: string,
    occurrenceAt: Instant,
    now: Instant
  ): Promise<{ created: number; short: boolean } | null> {
    const claimed = await repos.occurrences.record(schedule.id, occurrenceAt, 0, now);
    if (!claimed) return null;

    const candidates = await this.buildCandidates(repos, schedule);
    const pendingIds = new Set(await repos.reminders.contactsWithPending());

    const selection = selectForCycle({
      candidates,
      count: schedule.peoplePerCycle,
      // Rank against the cycle's own instant, not wall-clock now: a cycle being
      // generated late must be judged as of when it was due.
      now: occurrenceAt,
      random: this.random,
      context: { pendingContactIds: pendingIds },
    });

    let created = 0;
    for (const contactReferenceId of selection.selected) {
      const reminder = await repos.reminders.createIfAbsent(
        {
          scheduleId: schedule.id,
          groupId: schedule.groupId,
          groupNameSnapshot: groupName,
          contactReferenceId,
          occurrenceAt,
          dueAt: occurrenceAt,
        },
        now
      );
      if (reminder) created++;
    }

    // Correct the placeholder written at claim time, so stored history reports
    // what was actually selected rather than always 0.
    await repos.occurrences.setSelectedCount(
      schedule.id,
      occurrenceAt,
      selection.selected.length
    );

    return { created, short: selection.short };
  }

  private async buildCandidates(
    repos: Repositories,
    schedule: Schedule
  ): Promise<RotationCandidate[]> {
    const memberships = await repos.memberships.findByGroup(schedule.groupId);
    if (memberships.length === 0) return [];

    const contactIds = memberships.map((m) => m.contactReferenceId);

    // Bulk reads: rotation runs per cycle, and a long catch-up run would
    // otherwise be O(cycles x members) round trips.
    const lastContacted = await repos.events.lastContactedBulk(contactIds);
    const priorities = await repos.priorities.findBulk(contactIds);

    const candidates: RotationCandidate[] = [];
    for (const membership of memberships) {
      const contact = await repos.contacts.findById(membership.contactReferenceId);
      if (!contact) continue;

      candidates.push({
        contactReferenceId: membership.contactReferenceId,
        membershipActive: membership.active,
        availability: contact.availability,
        lastContactedAt: lastContacted.get(membership.contactReferenceId) ?? null,
        priority: priorities.get(membership.contactReferenceId) ?? null,
      });
    }

    return candidates;
  }
}

/**
 * Startup reconciliation (issue 032 / #43).
 *
 * Runs on every launch, so every step must be idempotent. Order matters:
 * contacts are synced before scheduling, or a cycle could select someone whose
 * contact has since been deleted.
 */
export interface ReconcileOutcome {
  readonly contactsChecked: number;
  readonly contactsRepaired: number;
  readonly contactsMarkedUnavailable: number;
  readonly scheduler: SchedulerRunOutcome;
  readonly pendingReminders: number;
}

export interface ContactSyncStep {
  run(): Promise<{
    checked: number;
    repaired: number;
    markedUnavailable: number;
    skipped: boolean;
  }>;
}

export class ReconcileOnStartup {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly sync: ContactSyncStep,
    private readonly scheduler: RunScheduler
  ) {}

  async run(): Promise<ReconcileOutcome> {
    // 1. Align contact references with the address book first.
    const syncOutcome = await this.sync.run();

    // 2. Generate any cycles that came due while the app was closed.
    const schedulerOutcome = await this.scheduler.run();

    // 3. Report what is now awaiting the user. Pending reminders are recovered
    //    simply by still being in the database — a missed notification never
    //    destroys the task (docs/DOMAIN.md §8.3).
    const pending = await this.uow.repositories.reminders.findPending();

    return {
      contactsChecked: syncOutcome.checked,
      contactsRepaired: syncOutcome.repaired,
      contactsMarkedUnavailable: syncOutcome.markedUnavailable,
      scheduler: schedulerOutcome,
      pendingReminders: pending.length,
    };
  }
}

export type { ContactReferenceId };
