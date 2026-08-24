/**
 * Local wall-clock arithmetic tests.
 *
 * The DST and month-boundary cases are the reason this module exists. A cycle
 * that silently vanishes on a spring-forward night, or fires twice on an
 * autumn-back night, is exactly the class of bug docs/DOMAIN.md §13 forbids.
 */
import {
  localPartsAt,
  offsetMinutesAt,
  instantForLocal,
  daysInMonth,
  clampDayToMonth,
  addLocalDays,
  addLocalMonths,
  localDaysBetween,
} from '../../src/domain/schedule/timezone';
import { instantFromISO, instantToISO, timeZoneId } from '../../src/domain/shared/ids';

const UTC = timeZoneId('UTC');
const LONDON = timeZoneId('Europe/London');
const KARACHI = timeZoneId('Asia/Karachi');
const NEW_YORK = timeZoneId('America/New_York');

describe('localPartsAt', () => {
  it('reads UTC unchanged', () => {
    const parts = localPartsAt(instantFromISO('2026-08-16T21:00:00.000Z'), UTC);
    expect(parts).toEqual({ year: 2026, month: 8, day: 16, hour: 21, minute: 0, weekday: 0 });
  });

  it('applies a positive offset', () => {
    // Karachi is UTC+5 year round.
    const parts = localPartsAt(instantFromISO('2026-08-16T21:00:00.000Z'), KARACHI);
    expect(parts).toMatchObject({ year: 2026, month: 8, day: 17, hour: 2, minute: 0 });
  });

  it('applies a negative offset and crosses back a day', () => {
    const parts = localPartsAt(instantFromISO('2026-08-17T02:00:00.000Z'), NEW_YORK);
    expect(parts).toMatchObject({ month: 8, day: 16, hour: 22 });
  });

  it('reports British Summer Time', () => {
    const summer = localPartsAt(instantFromISO('2026-08-16T21:00:00.000Z'), LONDON);
    expect(summer.hour).toBe(22); // BST = UTC+1
    const winter = localPartsAt(instantFromISO('2026-01-16T21:00:00.000Z'), LONDON);
    expect(winter.hour).toBe(21); // GMT = UTC+0
  });

  it('reports weekday with Sunday as 0', () => {
    // 2026-08-16 is a Sunday.
    expect(localPartsAt(instantFromISO('2026-08-16T12:00:00.000Z'), UTC).weekday).toBe(0);
    expect(localPartsAt(instantFromISO('2026-08-17T12:00:00.000Z'), UTC).weekday).toBe(1);
    expect(localPartsAt(instantFromISO('2026-08-22T12:00:00.000Z'), UTC).weekday).toBe(6);
  });
});

describe('offsetMinutesAt', () => {
  it.each([
    [UTC, '2026-08-16T12:00:00.000Z', 0],
    [KARACHI, '2026-08-16T12:00:00.000Z', 300],
    [LONDON, '2026-08-16T12:00:00.000Z', 60],
    [LONDON, '2026-01-16T12:00:00.000Z', 0],
    [NEW_YORK, '2026-08-16T12:00:00.000Z', -240],
    [NEW_YORK, '2026-01-16T12:00:00.000Z', -300],
  ])('%s at %s is %p minutes', (zone, iso, expected) => {
    expect(offsetMinutesAt(instantFromISO(iso), zone)).toBe(expected);
  });
});

describe('instantForLocal', () => {
  it('round-trips a local time', () => {
    const at = instantForLocal({ year: 2026, month: 8, day: 16, hour: 21, minute: 0 }, LONDON);
    expect(localPartsAt(at, LONDON)).toMatchObject({ hour: 21, minute: 0, day: 16 });
  });

  it('resolves 21:00 local to the right UTC instant either side of DST', () => {
    const summer = instantForLocal(
      { year: 2026, month: 8, day: 16, hour: 21, minute: 0 },
      LONDON
    );
    expect(instantToISO(summer)).toBe('2026-08-16T20:00:00.000Z'); // BST

    const winter = instantForLocal(
      { year: 2026, month: 1, day: 16, hour: 21, minute: 0 },
      LONDON
    );
    expect(instantToISO(winter)).toBe('2026-01-16T21:00:00.000Z'); // GMT
  });

  it('handles a zone with a fixed positive offset', () => {
    const at = instantForLocal({ year: 2026, month: 8, day: 16, hour: 21, minute: 0 }, KARACHI);
    expect(instantToISO(at)).toBe('2026-08-16T16:00:00.000Z');
  });

  it('round-trips every hour of a DST-transition day', () => {
    // Europe/London springs forward on the last Sunday of March.
    for (let hour = 0; hour < 24; hour++) {
      const at = instantForLocal({ year: 2026, month: 3, day: 29, hour, minute: 0 }, LONDON);
      const back = localPartsAt(at, LONDON);
      // 01:00 local does not exist that day; every other hour must round-trip.
      if (hour !== 1) {
        expect(back.hour).toBe(hour);
      }
    }
  });

  // A schedule set for a time that does not exist must still fire, and must
  // never fire EARLIER than asked — that would risk a double-fire.
  it('shifts a skipped local time forward past the gap', () => {
    const at = instantForLocal({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, LONDON);
    const back = localPartsAt(at, LONDON);
    expect(back.day).toBe(29);
    // 01:30 does not exist; the clock goes 01:00 -> 02:00, so it lands at 02:30.
    expect(back.hour).toBe(2);
    expect(back.minute).toBe(30);
    // Strictly after the naive interpretation, never before.
    expect(at).toBeGreaterThan(
      instantForLocal({ year: 2026, month: 3, day: 29, hour: 0, minute: 30 }, LONDON)
    );
  });

  // A repeated local time must fire once, not twice.
  it('resolves a repeated local time to a single deterministic instant', () => {
    const spec = { year: 2026, month: 10, day: 25, hour: 1, minute: 30 };
    const first = instantForLocal(spec, LONDON);
    expect(instantForLocal(spec, LONDON)).toBe(first);
    // Reads back as the requested wall-clock time, and is the later of the two
    // instants that share it (01:30 GMT rather than 01:30 BST).
    expect(localPartsAt(first, LONDON)).toMatchObject({ hour: 1, minute: 30 });
    expect(instantToISO(first)).toBe('2026-10-25T01:30:00.000Z');
  });

  it('is stable across repeated calls', () => {
    const spec = { year: 2026, month: 8, day: 16, hour: 21, minute: 0 };
    expect(instantForLocal(spec, LONDON)).toBe(instantForLocal(spec, LONDON));
  });
});

describe('daysInMonth', () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2024, 2, 29], // leap
    [2000, 2, 29], // divisible by 400
    [1900, 2, 28], // divisible by 100 but not 400
    [2026, 4, 30],
    [2026, 12, 31],
  ])('%p-%p has %p days', (year, month, expected) => {
    expect(daysInMonth(year, month)).toBe(expected);
  });
});

describe('clampDayToMonth', () => {
  // docs/DOMAIN.md §4.3 — clamp to the last day, never roll over.
  it.each([
    [2026, 1, 31, 31],
    [2026, 2, 31, 28],
    [2024, 2, 31, 29],
    [2026, 2, 30, 28],
    [2024, 2, 30, 29],
    [2026, 2, 29, 28],
    [2024, 2, 29, 29],
    [2026, 4, 31, 30],
    [2026, 6, 31, 30],
    [2026, 8, 15, 15],
  ])('anchor %p in %p-%p clamps to %p', (year, month, anchor, expected) => {
    expect(clampDayToMonth(year, month, anchor)).toBe(expected);
  });

  it('never returns zero or a negative day', () => {
    expect(clampDayToMonth(2026, 2, 0)).toBe(1);
    expect(clampDayToMonth(2026, 2, -5)).toBe(1);
  });
});

describe('addLocalDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addLocalDays({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 1,
    });
    expect(addLocalDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
  });

  it('handles leap day and negative deltas', () => {
    expect(addLocalDays({ year: 2024, month: 2, day: 28 }, 1)).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
    expect(addLocalDays({ year: 2026, month: 3, day: 1 }, -1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
  });
});

describe('addLocalMonths', () => {
  // The anchor is preserved, so a 31st schedule returns to the 31st.
  it('clamps into short months but keeps the anchor', () => {
    const jan31 = { year: 2026, month: 1, day: 31 };
    const feb = addLocalMonths(jan31, 1, 31);
    expect(feb).toEqual({ year: 2026, month: 2, day: 28 });
    const mar = addLocalMonths(feb, 1, 31);
    expect(mar).toEqual({ year: 2026, month: 3, day: 31 });
  });

  it('crosses the year boundary in both directions', () => {
    expect(addLocalMonths({ year: 2026, month: 12, day: 15 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 15,
    });
    expect(addLocalMonths({ year: 2026, month: 1, day: 15 }, -1)).toEqual({
      year: 2025,
      month: 12,
      day: 15,
    });
  });

  it('handles multi-month steps', () => {
    expect(addLocalMonths({ year: 2026, month: 1, day: 15 }, 13)).toEqual({
      year: 2027,
      month: 2,
      day: 15,
    });
  });
});

describe('localDaysBetween', () => {
  it('counts whole days regardless of time of day', () => {
    expect(
      localDaysBetween({ year: 2026, month: 8, day: 16 }, { year: 2026, month: 8, day: 23 })
    ).toBe(7);
    expect(
      localDaysBetween({ year: 2026, month: 8, day: 23 }, { year: 2026, month: 8, day: 16 })
    ).toBe(-7);
    expect(
      localDaysBetween({ year: 2026, month: 8, day: 16 }, { year: 2026, month: 8, day: 16 })
    ).toBe(0);
  });

  // Would be 6.958 days if computed naively in milliseconds across a DST shift.
  it('is unaffected by a DST transition in between', () => {
    expect(
      localDaysBetween({ year: 2026, month: 3, day: 27 }, { year: 2026, month: 4, day: 3 })
    ).toBe(7);
  });
});
