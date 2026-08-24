/**
 * Schedule validation and occurrence evaluation (issues 016 / #27, 030 / #41).
 *
 * An "occurrence" is one firing of a Schedule — a cycle. This module answers
 * only: *when* does this schedule fire? Who gets selected is rotation's job
 * (docs/DOMAIN.md §4.1 — people count and interval are independent).
 *
 * All arithmetic is on local calendar dates, converted to absolute instants at
 * the last step. Doing it the other way round (adding milliseconds to an
 * instant) drifts by an hour across every DST transition.
 *
 * Pure: no clock, no I/O. The caller supplies the window and the timezone.
 */
import type { Cadence, Schedule } from '../entities';
import { domainError, err, ok, type Result } from '../shared/Result';
import type { Instant, TimeZoneId } from '../shared/ids';
import {
  addLocalDays,
  addLocalMonths,
  clampDayToMonth,
  instantForLocal,
  localDaysBetween,
  localPartsAt,
} from './timezone';

/** Guards against a pathological window producing unbounded work. */
const MAX_OCCURRENCES = 512;

/** Cadences that need a weekday; the rest must not carry one. */
const WEEKDAY_CADENCES: readonly Cadence[] = ['weekly', 'every_x_weeks'];

export type ScheduleSpec = Omit<Schedule, 'id' | 'createdAt' | 'updatedAt'>;

// ── validation (issue 016) ──────────────────────────────────────────────────

/**
 * Validate a schedule before it can reach the scheduler.
 *
 * Cross-field rules live here rather than in a CHECK constraint, because a
 * constraint can only fail opaquely — "which field is wrong?" matters to the
 * user (docs/DATABASE.md §2.5).
 */
export function validateSchedule(spec: ScheduleSpec): Result<ScheduleSpec> {
  if (!Number.isInteger(spec.peoplePerCycle) || spec.peoplePerCycle < 1) {
    return err(
      domainError('INVALID_PEOPLE_PER_CYCLE', 'A schedule must select at least one person.')
    );
  }
  if (spec.peoplePerCycle > 100) {
    return err(
      domainError('INVALID_PEOPLE_PER_CYCLE', 'A cycle cannot select more than 100 people.')
    );
  }
  if (!Number.isInteger(spec.intervalCount) || spec.intervalCount < 1) {
    return err(domainError('INVALID_SCHEDULE', 'Interval must be a whole number of at least 1.'));
  }
  if (!Number.isInteger(spec.hour) || spec.hour < 0 || spec.hour > 23) {
    return err(domainError('INVALID_SCHEDULE', 'Hour must be between 0 and 23.'));
  }
  if (!Number.isInteger(spec.minute) || spec.minute < 0 || spec.minute > 59) {
    return err(domainError('INVALID_SCHEDULE', 'Minute must be between 0 and 59.'));
  }

  const needsWeekday = WEEKDAY_CADENCES.includes(spec.cadence);
  if (needsWeekday) {
    if (spec.weekday === null || !Number.isInteger(spec.weekday) || spec.weekday < 0 || spec.weekday > 6) {
      return err(
        domainError('INVALID_SCHEDULE', 'A weekly schedule needs a weekday between 0 and 6.')
      );
    }
  } else if (spec.weekday !== null) {
    return err(
      domainError('INVALID_SCHEDULE', `A ${spec.cadence} schedule must not specify a weekday.`)
    );
  }

  if (spec.cadence === 'monthly') {
    if (spec.monthDay === null || !Number.isInteger(spec.monthDay) || spec.monthDay < 1 || spec.monthDay > 31) {
      return err(
        domainError('INVALID_SCHEDULE', 'A monthly schedule needs a day between 1 and 31.')
      );
    }
  } else if (spec.monthDay !== null) {
    return err(
      domainError('INVALID_SCHEDULE', `A ${spec.cadence} schedule must not specify a month day.`)
    );
  }

  // 'daily' and 'weekly' are fixed cadences; a multiplier there is ambiguous —
  // "weekly every 2" would be indistinguishable from every_x_weeks.
  if ((spec.cadence === 'daily' || spec.cadence === 'weekly') && spec.intervalCount !== 1) {
    return err(
      domainError(
        'INVALID_SCHEDULE',
        `Use every_x_${spec.cadence === 'daily' ? 'days' : 'weeks'} for a repeating interval.`
      )
    );
  }

  return ok(spec);
}

// ── occurrence evaluation (issue 030) ──────────────────────────────────────

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

/**
 * Every occurrence of `schedule` strictly after `after` and at or before
 * `until`, in ascending order.
 *
 * Exclusive lower bound, inclusive upper: the caller passes the last processed
 * occurrence as `after`, so a cycle is never re-emitted and none is skipped.
 */
export function occurrencesBetween(
  schedule: Schedule,
  after: Instant,
  until: Instant,
  timeZone: TimeZoneId
): Instant[] {
  if (!schedule.active) return [];
  if (until <= after) return [];

  const out: Instant[] = [];
  let date = firstOccurrenceDate(schedule, timeZone);
  let guard = 0;

  while (guard++ < MAX_OCCURRENCES) {
    const at = instantForLocal({ ...date, hour: schedule.hour, minute: schedule.minute }, timeZone);

    if (at > until) break;
    if (at > after) out.push(at);

    date = nextOccurrenceDate(schedule, date);
  }

  return out;
}

/** The next occurrence strictly after `after`, or null if the schedule is inactive. */
export function nextOccurrenceAfter(
  schedule: Schedule,
  after: Instant,
  timeZone: TimeZoneId
): Instant | null {
  if (!schedule.active) return null;

  let date = firstOccurrenceDate(schedule, timeZone);
  let guard = 0;

  while (guard++ < MAX_OCCURRENCES) {
    const at = instantForLocal({ ...date, hour: schedule.hour, minute: schedule.minute }, timeZone);
    if (at > after) return at;
    date = nextOccurrenceDate(schedule, date);
  }

  return null;
}

/**
 * The schedule's first candidate date, derived from its anchor.
 *
 * For weekday cadences this walks forward from the anchor to the first matching
 * weekday; for monthly it clamps the anchor day into the anchor month. The
 * anchor is what makes "every 3 days" and "every 2 weeks" well-defined rather
 * than relative to whenever the scheduler happens to run.
 */
function firstOccurrenceDate(schedule: Schedule, timeZone: TimeZoneId): LocalDate {
  const anchor = localPartsAt(schedule.anchorAt, timeZone);
  const base: LocalDate = { year: anchor.year, month: anchor.month, day: anchor.day };

  if (WEEKDAY_CADENCES.includes(schedule.cadence)) {
    const target = schedule.weekday ?? 0;
    const delta = (target - anchor.weekday + 7) % 7;
    return delta === 0 ? base : addLocalDays(base, delta);
  }

  if (schedule.cadence === 'monthly') {
    const anchorDay = schedule.monthDay ?? anchor.day;
    return { ...base, day: clampDayToMonth(base.year, base.month, anchorDay) };
  }

  return base;
}

function nextOccurrenceDate(schedule: Schedule, current: LocalDate): LocalDate {
  switch (schedule.cadence) {
    case 'daily':
      return addLocalDays(current, 1);
    case 'every_x_days':
      return addLocalDays(current, schedule.intervalCount);
    case 'weekly':
      return addLocalDays(current, 7);
    case 'every_x_weeks':
      return addLocalDays(current, 7 * schedule.intervalCount);
    case 'monthly':
      // Pass the stored anchor so a 31st schedule returns to the 31st rather
      // than sticking at 28 after one short month (docs/DOMAIN.md §4.3).
      return addLocalMonths(current, schedule.intervalCount, schedule.monthDay ?? current.day);
  }
}

/**
 * Whether a schedule would fire on a given local date. Exposed for tests and
 * for explaining a schedule to the user; the scheduler uses
 * occurrencesBetween.
 */
export function firesOnLocalDate(
  schedule: Schedule,
  date: LocalDate,
  timeZone: TimeZoneId
): boolean {
  const start = firstOccurrenceDate(schedule, timeZone);
  const elapsed = localDaysBetween(start, date);
  if (elapsed < 0) return false;

  switch (schedule.cadence) {
    case 'daily':
      return true;
    case 'every_x_days':
      return elapsed % schedule.intervalCount === 0;
    case 'weekly':
      return elapsed % 7 === 0;
    case 'every_x_weeks':
      return elapsed % (7 * schedule.intervalCount) === 0;
    case 'monthly': {
      const anchorDay = schedule.monthDay ?? start.day;
      return date.day === clampDayToMonth(date.year, date.month, anchorDay);
    }
  }
}
