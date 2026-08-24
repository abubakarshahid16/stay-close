/**
 * Derived history metrics (issues 041 / #52, 042 / #53).
 *
 * Everything here is **computed from persisted history**, never stored
 * redundantly (docs/DOMAIN.md §15). That matters for correctness as much as
 * tidiness: a denormalised counter would drift the moment a reminder was
 * cancelled or a contact went unavailable, and nothing would reveal it.
 *
 * No scorecard UI exists in Phase A — this is the data foundation only
 * (docs/PRODUCT.md §6). The functions are pure so they can be exercised
 * exhaustively without a database.
 */
import type { ContactEvent, ReminderInstance, ReminderState } from '../entities';
import { classify } from '../reminder/stateMachine';
import type { ContactReferenceId, GroupId, Instant } from '../shared/ids';

const MS_PER_DAY = 86_400_000;

// ── reminder counts ─────────────────────────────────────────────────────────

export interface ReminderCounts {
  readonly total: number;
  readonly pending: number;
  readonly completed: number;
  readonly skipped: number;
  readonly deprioritized: number;
  readonly cancelled: number;
  /** Pending and past the overdue threshold. Derived, not stored. */
  readonly overdue: number;
  /** Pending with a snooze still in the future. */
  readonly snoozed: number;
  /** Pending, actionable now. */
  readonly due: number;
}

export function countReminders(
  reminders: readonly ReminderInstance[],
  now: Instant
): ReminderCounts {
  const byState = (state: ReminderState): number =>
    reminders.filter((r) => r.state === state).length;

  const pending = reminders.filter((r) => r.state === 'pending');

  return {
    total: reminders.length,
    pending: pending.length,
    completed: byState('completed'),
    skipped: byState('skipped'),
    deprioritized: byState('deprioritized'),
    cancelled: byState('cancelled'),
    overdue: pending.filter((r) => classify(r, now) === 'overdue').length,
    snoozed: pending.filter((r) => classify(r, now) === 'snoozed').length,
    due: pending.filter((r) => classify(r, now) === 'due').length,
  };
}

/**
 * Share of *resolved* reminders that were completed.
 *
 * Cancelled reminders are excluded from the denominator on purpose. A
 * cancellation is the app withdrawing a request — the user never declined it,
 * so counting it against them would misrepresent their follow-through
 * (docs/DOMAIN.md §8.4).
 *
 * Returns null rather than 0 when nothing has been resolved: "no data" and
 * "0%" are different statements, and showing 0% to a new user would be a lie.
 */
export function completionRate(reminders: readonly ReminderInstance[]): number | null {
  const answered = reminders.filter(
    (r) => r.state === 'completed' || r.state === 'skipped' || r.state === 'deprioritized'
  );
  if (answered.length === 0) return null;
  const completed = answered.filter((r) => r.state === 'completed').length;
  return completed / answered.length;
}

export function completionRateByGroup(
  reminders: readonly ReminderInstance[]
): Map<GroupId, number | null> {
  const grouped = new Map<GroupId, ReminderInstance[]>();
  for (const reminder of reminders) {
    // Reminders whose group was deleted have a null groupId; their history is
    // still real, but it cannot be attributed to a group any more.
    if (reminder.groupId === null) continue;
    const bucket = grouped.get(reminder.groupId);
    if (bucket) bucket.push(reminder);
    else grouped.set(reminder.groupId, [reminder]);
  }

  const out = new Map<GroupId, number | null>();
  for (const [id, list] of grouped) out.set(id, completionRate(list));
  return out;
}

// ── streaks ─────────────────────────────────────────────────────────────────

/**
 * A streak is consecutive **completed** resolutions, in chronological order.
 * A skip or deprioritization breaks it; a cancellation is ignored, since the
 * app withdrew the request rather than the user declining it.
 *
 * Measured over resolutions rather than calendar days, because a weekly cadence
 * would score badly on a day-based streak through no fault of the user.
 */
export interface StreakSummary {
  readonly current: number;
  readonly longest: number;
}

export function completionStreaks(reminders: readonly ReminderInstance[]): StreakSummary {
  const resolved = reminders
    .filter(
      (r) => r.state === 'completed' || r.state === 'skipped' || r.state === 'deprioritized'
    )
    .filter((r) => r.resolvedAt !== null)
    .sort((a, b) => (a.resolvedAt as number) - (b.resolvedAt as number));

  let longest = 0;
  let run = 0;
  for (const reminder of resolved) {
    if (reminder.state === 'completed') {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }

  // `run` ends holding the trailing streak, which is the current one.
  return { current: run, longest };
}

// ── recency ─────────────────────────────────────────────────────────────────

export interface RecencySummary {
  readonly contactReferenceId: ContactReferenceId;
  /** Null means never contacted. */
  readonly lastContactedAt: Instant | null;
  /** Null means never contacted. */
  readonly daysSinceContact: number | null;
  readonly neverContacted: boolean;
}

export function summariseRecency(
  contactReferenceId: ContactReferenceId,
  events: readonly ContactEvent[],
  now: Instant
): RecencySummary {
  const mine = events.filter((e) => e.contactReferenceId === contactReferenceId);
  if (mine.length === 0) {
    return {
      contactReferenceId,
      lastContactedAt: null,
      daysSinceContact: null,
      neverContacted: true,
    };
  }

  const last = mine.reduce((max, e) => (e.occurredAt > max ? e.occurredAt : max), mine[0].occurredAt);
  return {
    contactReferenceId,
    lastContactedAt: last,
    daysSinceContact: Math.floor(Math.max(now - last, 0) / MS_PER_DAY),
    neverContacted: false,
  };
}

/** People not contacted within `days`, plus everyone never contacted. */
export function notRecentlyContacted(
  contactIds: readonly ContactReferenceId[],
  events: readonly ContactEvent[],
  now: Instant,
  days: number
): ContactReferenceId[] {
  return contactIds.filter((id) => {
    const summary = summariseRecency(id, events, now);
    return summary.neverContacted || (summary.daysSinceContact as number) >= days;
  });
}

export function neverContacted(
  contactIds: readonly ContactReferenceId[],
  events: readonly ContactEvent[]
): ContactReferenceId[] {
  const contacted = new Set(events.map((e) => e.contactReferenceId));
  return contactIds.filter((id) => !contacted.has(id));
}

/**
 * Mean days between consecutive contacts with one person.
 *
 * Null with fewer than two events: a single contact establishes no interval,
 * and reporting 0 or the age of that one contact would both be wrong.
 */
export function averageContactIntervalDays(
  contactReferenceId: ContactReferenceId,
  events: readonly ContactEvent[]
): number | null {
  const times = events
    .filter((e) => e.contactReferenceId === contactReferenceId)
    .map((e) => e.occurredAt)
    .sort((a, b) => a - b);

  if (times.length < 2) return null;

  let total = 0;
  for (let i = 1; i < times.length; i++) total += times[i] - times[i - 1];
  return total / (times.length - 1) / MS_PER_DAY;
}

// ── activity windows ────────────────────────────────────────────────────────

export interface ActivitySummary {
  readonly contactsCompleted: number;
  readonly remindersSkipped: number;
  readonly distinctPeopleContacted: number;
}

/** Activity in the window (from, now]. */
export function activitySince(
  reminders: readonly ReminderInstance[],
  events: readonly ContactEvent[],
  from: Instant,
  now: Instant
): ActivitySummary {
  const inWindow = (at: Instant | null | undefined): boolean =>
    at !== null && at !== undefined && at > from && at <= now;

  const contactEvents = events.filter((e) => inWindow(e.occurredAt));

  return {
    contactsCompleted: contactEvents.length,
    remindersSkipped: reminders.filter((r) => r.state === 'skipped' && inWindow(r.resolvedAt))
      .length,
    distinctPeopleContacted: new Set(contactEvents.map((e) => e.contactReferenceId)).size,
  };
}

// ── whole-app scorecard ─────────────────────────────────────────────────────

export interface Scorecard {
  readonly reminders: ReminderCounts;
  readonly completionRate: number | null;
  readonly streaks: StreakSummary;
  readonly peopleTotal: number;
  readonly peopleNeverContacted: number;
  readonly peopleNotContactedIn30Days: number;
  readonly last7Days: ActivitySummary;
  readonly last30Days: ActivitySummary;
}

export function buildScorecard(input: {
  readonly reminders: readonly ReminderInstance[];
  readonly events: readonly ContactEvent[];
  readonly contactIds: readonly ContactReferenceId[];
  readonly now: Instant;
}): Scorecard {
  const { reminders, events, contactIds, now } = input;
  const day = MS_PER_DAY;

  return {
    reminders: countReminders(reminders, now),
    completionRate: completionRate(reminders),
    streaks: completionStreaks(reminders),
    peopleTotal: contactIds.length,
    peopleNeverContacted: neverContacted(contactIds, events).length,
    peopleNotContactedIn30Days: notRecentlyContacted(contactIds, events, now, 30).length,
    last7Days: activitySince(reminders, events, ((now - 7 * day) as Instant), now),
    last30Days: activitySince(reminders, events, ((now - 30 * day) as Instant), now),
  };
}
