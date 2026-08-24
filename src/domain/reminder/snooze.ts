/**
 * Snooze target computation (issue 027 / #38).
 *
 * Predefined options only — arbitrary date-time picking is out of V1 scope
 * (docs/DOMAIN.md §8.5).
 *
 * The relative options are measured from **now**, not from the reminder's
 * original due time. A reminder overdue by three days would otherwise snooze to
 * a moment three days in the past and re-fire immediately. The user asked to be
 * reminded in 30 minutes, so that is what happens.
 *
 * Pure: the clock and the schedule arrive as arguments.
 */
import type { Schedule } from '../entities';
import { nextOccurrenceAfter } from '../schedule/cadence';
import { addLocalDays, instantForLocal, localPartsAt } from '../schedule/timezone';
import { domainError, err, ok, type Result } from '../shared/Result';
import { instant, type Instant, type TimeZoneId } from '../shared/ids';

export type SnoozeOption =
  | 'thirty_minutes'
  | 'one_hour'
  | 'three_hours'
  | 'tomorrow'
  | 'next_occurrence';

export const SNOOZE_OPTIONS: readonly SnoozeOption[] = [
  'thirty_minutes',
  'one_hour',
  'three_hours',
  'tomorrow',
  'next_occurrence',
];

const MINUTE = 60_000;
const HOUR = 3_600_000;

const RELATIVE_OFFSETS: Partial<Record<SnoozeOption, number>> = {
  thirty_minutes: 30 * MINUTE,
  one_hour: HOUR,
  three_hours: 3 * HOUR,
};

export interface SnoozeContext {
  readonly now: Instant;
  readonly timeZone: TimeZoneId;
  /**
   * The reminder's schedule, when it still exists. Needed for `tomorrow` (to
   * reuse the schedule's time of day) and `next_occurrence`. A reminder whose
   * schedule has been deleted can still be snoozed by the relative options.
   */
  readonly schedule: Schedule | null;
}

/** Default time of day for `tomorrow` when no schedule is available. */
const FALLBACK_HOUR = 9;
const FALLBACK_MINUTE = 0;

export function computeSnoozeTarget(
  option: SnoozeOption,
  context: SnoozeContext
): Result<Instant> {
  const { now, timeZone, schedule } = context;

  const relative = RELATIVE_OFFSETS[option];
  if (relative !== undefined) {
    return ok(instant(now + relative));
  }

  if (option === 'tomorrow') {
    const today = localPartsAt(now, timeZone);
    const nextDay = addLocalDays(today, 1);
    const target = instantForLocal(
      {
        ...nextDay,
        hour: schedule?.hour ?? FALLBACK_HOUR,
        minute: schedule?.minute ?? FALLBACK_MINUTE,
      },
      timeZone
    );
    // Guard rather than trust: a DST shift could in principle land this on or
    // before now, and a snooze into the past is not a snooze.
    return target > now
      ? ok(target)
      : err(domainError('INVALID_TRANSITION', 'Tomorrow resolved to a past time.'));
  }

  // next_occurrence
  if (!schedule) {
    return err(
      domainError(
        'NOT_FOUND',
        'This reminder has no schedule any more, so there is no next occurrence.'
      )
    );
  }

  const next = nextOccurrenceAfter(schedule, now, timeZone);
  if (next === null) {
    return err(
      domainError(
        'INVALID_SCHEDULE',
        'That schedule is paused, so it has no next occurrence to snooze until.'
      )
    );
  }

  return ok(next);
}

/**
 * Which options are offerable right now.
 *
 * `next_occurrence` is hidden when the schedule is gone or paused, so the UI
 * never presents an action that cannot succeed.
 */
export function availableSnoozeOptions(context: SnoozeContext): SnoozeOption[] {
  return SNOOZE_OPTIONS.filter((option) => computeSnoozeTarget(option, context).ok);
}
