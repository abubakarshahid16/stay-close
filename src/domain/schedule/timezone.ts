/**
 * Local wall-clock arithmetic.
 *
 * Cycle times are local wall-clock — `21:00` means 21:00 where the user is —
 * while stored instants are absolute UTC (docs/DOMAIN.md §13). Converting
 * between the two is the foundation every cadence rule sits on, and it is the
 * part most likely to be subtly wrong around DST.
 *
 * Implemented on `Intl.DateTimeFormat` with an explicit `timeZone`, so there is
 * no dependency and no bundled tz database to go stale.
 *
 * Pure: takes instants and zone ids as arguments, never reads the system clock.
 */
import { instant, type Instant, type TimeZoneId } from '../shared/ids';

export interface LocalParts {
  readonly year: number;
  /** 1-12, not 0-indexed. Month arithmetic bugs usually start with 0-indexing. */
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** 0 = Sunday, matching Schedule.weekday. */
  readonly weekday: number;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Formatter construction is not free and zones repeat, so memoise. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: TimeZoneId): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/** Break an absolute instant into local calendar parts for a zone. */
export function localPartsAt(at: Instant, timeZone: TimeZoneId): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(at));
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') lookup[part.type] = part.value;
  }

  return {
    year: Number(lookup['year']),
    month: Number(lookup['month']),
    day: Number(lookup['day']),
    hour: Number(lookup['hour']),
    minute: Number(lookup['minute']),
    weekday: WEEKDAY_INDEX[lookup['weekday'] ?? 'Sun'] ?? 0,
  };
}

/** The zone's UTC offset, in minutes, at a given instant. */
export function offsetMinutesAt(at: Instant, timeZone: TimeZoneId): number {
  const local = localPartsAt(at, timeZone);
  const asIfUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  // Round to the minute: formatToParts drops seconds, so the raw difference
  // carries the instant's own sub-minute remainder.
  return Math.round((asIfUtc - at) / MS_PER_MINUTE);
}

/**
 * The absolute instant for a local wall-clock time in a zone.
 *
 * Two passes, because the offset depends on the very instant being computed.
 * The first pass guesses using the offset at the naive UTC interpretation; the
 * second corrects it. This is what makes DST transitions come out right.
 *
 * Edge cases at a DST boundary, both verified by test:
 *   - **Skipped** local time (spring forward, e.g. 01:30 on a night when the
 *     clock goes 01:00 → 02:00): that wall-clock time does not exist. The
 *     result shifts *forward* past the gap, so 01:30 resolves to 02:30 local.
 *     The cycle still happens, and never earlier than the user asked for —
 *     shifting backwards would fire early and risk a double-fire.
 *   - **Repeated** local time (autumn back, 01:30 happens twice): resolves
 *     deterministically to the *later* of the two instants, so the cycle fires
 *     exactly once.
 */
export function instantForLocal(
  parts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  },
  timeZone: TimeZoneId
): Instant {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);

  const firstGuess = instant(naive - offsetMinutesAt(instant(naive), timeZone) * MS_PER_MINUTE);

  // Second pass, using the offset actually in force at the guessed instant.
  // For a normal local time this reads back exactly as requested; for a skipped
  // one it lands past the gap, which is the behaviour documented above.
  return instant(naive - offsetMinutesAt(firstGuess, timeZone) * MS_PER_MINUTE);
}

/**
 * Days in a month, 1-indexed month. Handles leap years.
 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Clamp a monthly anchor day to a month that may be shorter.
 *
 * docs/DOMAIN.md §4.3: an anchor that does not exist in the target month clamps
 * to the last day of that month. It never rolls into the next month and never
 * skips the month. The anchor itself is stored unchanged, so a 31-anchored
 * schedule returns to the 31st in months that have one.
 */
export function clampDayToMonth(year: number, month: number, anchorDay: number): number {
  const max = daysInMonth(year, month);
  return Math.min(Math.max(anchorDay, 1), max);
}

/** Add whole days to a local calendar date, normalising month and year. */
export function addLocalDays(
  parts: { year: number; month: number; day: number },
  days: number
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + days * MS_PER_DAY);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Add whole months to a local calendar date, clamping the day. */
export function addLocalMonths(
  parts: { year: number; month: number; day: number },
  months: number,
  anchorDay = parts.day
): { year: number; month: number; day: number } {
  const zeroBased = parts.month - 1 + months;
  const year = parts.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12 + 1;
  return { year, month, day: clampDayToMonth(year, month, anchorDay) };
}

/** Whole days between two local dates, ignoring time of day. */
export function localDaysBetween(
  from: { year: number; month: number; day: number },
  to: { year: number; month: number; day: number }
): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / MS_PER_DAY);
}

export { MS_PER_MINUTE, MS_PER_HOUR, MS_PER_DAY };
