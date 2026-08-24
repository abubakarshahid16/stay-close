/**
 * Schedule validation and occurrence tests (issues 016 / #27, 030 / #41).
 *
 * The worked examples from docs/DOMAIN.md §4 are asserted directly, so the spec
 * and the code cannot drift apart silently.
 */
import {
  validateSchedule,
  occurrencesBetween,
  nextOccurrenceAfter,
  firesOnLocalDate,
  type ScheduleSpec,
} from '../../src/domain/schedule/cadence';
import type { Schedule } from '../../src/domain/entities';
import { isErr, isOk } from '../../src/domain/shared/Result';
import {
  groupId,
  instantFromISO,
  instantToISO,
  scheduleId,
  timeZoneId,
} from '../../src/domain/shared/ids';

const LONDON = timeZoneId('Europe/London');
const UTC = timeZoneId('UTC');

/** 2026-08-16 is a Sunday. */
const ANCHOR = instantFromISO('2026-08-16T00:00:00.000Z');

function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: scheduleId(1),
    groupId: groupId(1),
    peoplePerCycle: 2,
    cadence: 'weekly',
    intervalCount: 1,
    weekday: 0,
    monthDay: null,
    hour: 21,
    minute: 0,
    anchorAt: ANCHOR,
    active: true,
    createdAt: ANCHOR,
    updatedAt: ANCHOR,
    ...overrides,
  };
}

const spec = (overrides: Partial<ScheduleSpec> = {}): ScheduleSpec => {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = schedule(overrides);
  return rest;
};

const isoList = (list: readonly number[]): string[] =>
  list.map((i) => instantToISO(i as ReturnType<typeof instantFromISO>));

describe('validateSchedule', () => {
  it('accepts a well-formed weekly schedule', () => {
    expect(isOk(validateSchedule(spec()))).toBe(true);
  });

  it.each([
    ['zero people', { peoplePerCycle: 0 }],
    ['negative people', { peoplePerCycle: -1 }],
    ['fractional people', { peoplePerCycle: 1.5 }],
    ['absurd people count', { peoplePerCycle: 500 }],
    ['zero interval', { intervalCount: 0, cadence: 'every_x_days' as const, weekday: null }],
    ['hour 24', { hour: 24 }],
    ['negative hour', { hour: -1 }],
    ['minute 60', { minute: 60 }],
  ])('rejects %s', (_label, overrides) => {
    expect(isErr(validateSchedule(spec(overrides)))).toBe(true);
  });

  describe('weekday coupling', () => {
    it.each(['weekly', 'every_x_weeks'] as const)('%s requires a weekday', (cadence) => {
      expect(isErr(validateSchedule(spec({ cadence, weekday: null })))).toBe(true);
      expect(isErr(validateSchedule(spec({ cadence, weekday: 7 })))).toBe(true);
      expect(isOk(validateSchedule(spec({ cadence, weekday: 3, intervalCount: cadence === 'weekly' ? 1 : 2 })))).toBe(true);
    });

    // A stray weekday on a daily schedule means the caller misunderstood the
    // model; failing loudly beats silently ignoring it.
    it.each(['daily', 'every_x_days', 'monthly'] as const)(
      '%s must not carry a weekday',
      (cadence) => {
        const base = { cadence, weekday: 2, monthDay: cadence === 'monthly' ? 15 : null };
        expect(isErr(validateSchedule(spec(base)))).toBe(true);
      }
    );
  });

  describe('month day coupling', () => {
    it('monthly requires a day in range', () => {
      expect(isErr(validateSchedule(spec({ cadence: 'monthly', weekday: null, monthDay: null })))).toBe(true);
      expect(isErr(validateSchedule(spec({ cadence: 'monthly', weekday: null, monthDay: 0 })))).toBe(true);
      expect(isErr(validateSchedule(spec({ cadence: 'monthly', weekday: null, monthDay: 32 })))).toBe(true);
      expect(isOk(validateSchedule(spec({ cadence: 'monthly', weekday: null, monthDay: 31 })))).toBe(true);
    });

    it('non-monthly cadences must not carry a month day', () => {
      expect(isErr(validateSchedule(spec({ cadence: 'weekly', weekday: 0, monthDay: 15 })))).toBe(true);
    });
  });

  // Avoids "weekly every 2", which would be ambiguous with every_x_weeks.
  it('rejects a multiplier on the fixed cadences', () => {
    expect(isErr(validateSchedule(spec({ cadence: 'daily', weekday: null, intervalCount: 3 })))).toBe(true);
    expect(isErr(validateSchedule(spec({ cadence: 'weekly', intervalCount: 2 })))).toBe(true);
    expect(isOk(validateSchedule(spec({ cadence: 'every_x_days', weekday: null, intervalCount: 3 })))).toBe(true);
    expect(isOk(validateSchedule(spec({ cadence: 'every_x_weeks', intervalCount: 2 })))).toBe(true);
  });
});

describe('occurrencesBetween — daily', () => {
  it('fires once per day at the local time', () => {
    const s = schedule({ cadence: 'daily', weekday: null, hour: 9, minute: 30 });
    const got = occurrencesBetween(
      s,
      instantFromISO('2026-08-16T00:00:00.000Z'),
      instantFromISO('2026-08-19T23:59:00.000Z'),
      LONDON
    );
    expect(isoList(got)).toEqual([
      '2026-08-16T08:30:00.000Z', // 09:30 BST
      '2026-08-17T08:30:00.000Z',
      '2026-08-18T08:30:00.000Z',
      '2026-08-19T08:30:00.000Z',
    ]);
  });
});

describe('occurrencesBetween — every X days', () => {
  it('respects the interval from the anchor', () => {
    const s = schedule({ cadence: 'every_x_days', weekday: null, intervalCount: 3, hour: 9, minute: 0 });
    const got = occurrencesBetween(
      s,
      instantFromISO('2026-08-15T00:00:00.000Z'),
      instantFromISO('2026-08-26T00:00:00.000Z'),
      UTC
    );
    expect(isoList(got)).toEqual([
      '2026-08-16T09:00:00.000Z',
      '2026-08-19T09:00:00.000Z',
      '2026-08-22T09:00:00.000Z',
      '2026-08-25T09:00:00.000Z',
    ]);
  });
});

describe('occurrencesBetween — weekly', () => {
  // docs/DOMAIN.md §4: "Family ... every 7 days, Sunday, 21:00".
  it('fires on the configured weekday', () => {
    const s = schedule({ cadence: 'weekly', weekday: 0, hour: 21, minute: 0 });
    const got = occurrencesBetween(
      s,
      instantFromISO('2026-08-15T00:00:00.000Z'),
      instantFromISO('2026-09-07T00:00:00.000Z'),
      UTC
    );
    expect(isoList(got)).toEqual([
      '2026-08-16T21:00:00.000Z',
      '2026-08-23T21:00:00.000Z',
      '2026-08-30T21:00:00.000Z',
      '2026-09-06T21:00:00.000Z',
    ]);
  });

  it('walks forward from the anchor to the first matching weekday', () => {
    // Anchor is a Sunday; ask for Saturday (6).
    const s = schedule({ cadence: 'weekly', weekday: 6, hour: 20, minute: 0 });
    const got = occurrencesBetween(
      s,
      instantFromISO('2026-08-15T00:00:00.000Z'),
      instantFromISO('2026-08-30T00:00:00.000Z'),
      UTC
    );
    expect(isoList(got)).toEqual(['2026-08-22T20:00:00.000Z', '2026-08-29T20:00:00.000Z']);
  });
});

describe('occurrencesBetween — every X weeks', () => {
  // docs/DOMAIN.md §4: "Close Friends ... every 14 days, Saturday, 20:00".
  it('fires every other configured weekday', () => {
    const s = schedule({
      cadence: 'every_x_weeks',
      weekday: 6,
      intervalCount: 2,
      hour: 20,
      minute: 0,
    });
    const got = occurrencesBetween(
      s,
      instantFromISO('2026-08-15T00:00:00.000Z'),
      instantFromISO('2026-10-05T00:00:00.000Z'),
      UTC
    );
    expect(isoList(got)).toEqual([
      '2026-08-22T20:00:00.000Z',
      '2026-09-05T20:00:00.000Z',
      '2026-09-19T20:00:00.000Z',
      '2026-10-03T20:00:00.000Z',
    ]);
  });
});

describe('occurrencesBetween — monthly', () => {
  // docs/DOMAIN.md §4: "Old Friends ... every 30 days, 15th, 21:00".
  it('fires on the configured day each month', () => {
    const s = schedule({
      cadence: 'monthly',
      weekday: null,
      monthDay: 15,
      hour: 21,
      minute: 0,
      anchorAt: instantFromISO('2026-08-01T00:00:00.000Z'),
    });
    const got = occurrencesBetween(
      s,
      instantFromISO('2026-08-01T00:00:00.000Z'),
      instantFromISO('2026-11-20T00:00:00.000Z'),
      UTC
    );
    expect(isoList(got)).toEqual([
      '2026-08-15T21:00:00.000Z',
      '2026-09-15T21:00:00.000Z',
      '2026-10-15T21:00:00.000Z',
      '2026-11-15T21:00:00.000Z',
    ]);
  });

  // The rule from docs/DOMAIN.md §4.3, end to end.
  it('clamps a 31st anchor into short months and returns to the 31st', () => {
    const s = schedule({
      cadence: 'monthly',
      weekday: null,
      monthDay: 31,
      hour: 12,
      minute: 0,
      anchorAt: instantFromISO('2026-01-01T00:00:00.000Z'),
    });
    const got = occurrencesBetween(
      s,
      instantFromISO('2026-01-01T00:00:00.000Z'),
      instantFromISO('2026-06-01T00:00:00.000Z'),
      UTC
    );
    expect(isoList(got)).toEqual([
      '2026-01-31T12:00:00.000Z',
      '2026-02-28T12:00:00.000Z', // clamped, not rolled into March
      '2026-03-31T12:00:00.000Z', // anchor restored
      '2026-04-30T12:00:00.000Z', // clamped
      '2026-05-31T12:00:00.000Z', // anchor restored
    ]);
  });

  it('clamps to 29 February in a leap year', () => {
    const s = schedule({
      cadence: 'monthly',
      weekday: null,
      monthDay: 30,
      hour: 12,
      minute: 0,
      anchorAt: instantFromISO('2024-01-01T00:00:00.000Z'),
    });
    const got = occurrencesBetween(
      s,
      instantFromISO('2024-02-01T00:00:00.000Z'),
      instantFromISO('2024-03-01T00:00:00.000Z'),
      UTC
    );
    expect(isoList(got)).toEqual(['2024-02-29T12:00:00.000Z']);
  });
});

describe('occurrencesBetween — window semantics', () => {
  const s = schedule({ cadence: 'daily', weekday: null, hour: 12, minute: 0 });

  it('excludes the lower bound and includes the upper', () => {
    // Exactly the boundary instants, so re-running the scheduler with the last
    // processed occurrence as `after` cannot re-emit it.
    const got = occurrencesBetween(
      s,
      instantFromISO('2026-08-16T12:00:00.000Z'),
      instantFromISO('2026-08-18T12:00:00.000Z'),
      UTC
    );
    expect(isoList(got)).toEqual(['2026-08-17T12:00:00.000Z', '2026-08-18T12:00:00.000Z']);
  });

  it('returns nothing for an inverted or empty window', () => {
    const at = instantFromISO('2026-08-17T12:00:00.000Z');
    expect(occurrencesBetween(s, at, at, UTC)).toEqual([]);
    expect(occurrencesBetween(s, at, instantFromISO('2026-08-16T12:00:00.000Z'), UTC)).toEqual([]);
  });

  it('returns nothing for an inactive schedule', () => {
    const inactive = schedule({ cadence: 'daily', weekday: null, active: false });
    expect(
      occurrencesBetween(
        inactive,
        instantFromISO('2026-08-16T00:00:00.000Z'),
        instantFromISO('2026-08-20T00:00:00.000Z'),
        UTC
      )
    ).toEqual([]);
  });

  it('returns nothing before the anchor', () => {
    expect(
      occurrencesBetween(
        s,
        instantFromISO('2020-01-01T00:00:00.000Z'),
        instantFromISO('2020-02-01T00:00:00.000Z'),
        UTC
      )
    ).toEqual([]);
  });

  // A user who does not open the app for weeks must get every missed cycle
  // generated on next launch (docs/PLATFORM.md §4).
  it('emits every missed occurrence for a long gap', () => {
    const got = occurrencesBetween(
      s,
      instantFromISO('2026-08-16T00:00:00.000Z'),
      instantFromISO('2026-09-15T00:00:00.000Z'),
      UTC
    );
    expect(got).toHaveLength(30);
  });

  it('is bounded rather than looping forever on an absurd window', () => {
    const got = occurrencesBetween(
      s,
      instantFromISO('2026-08-16T00:00:00.000Z'),
      instantFromISO('2126-08-16T00:00:00.000Z'),
      UTC
    );
    expect(got.length).toBeLessThanOrEqual(512);
  });
});

describe('occurrencesBetween — DST', () => {
  // Held at 21:00 local across the transition, which means the UTC instant
  // shifts by an hour. Adding milliseconds instead would drift.
  it('keeps a weekly schedule at the same local time across a DST change', () => {
    const s = schedule({
      cadence: 'weekly',
      weekday: 0,
      hour: 21,
      minute: 0,
      anchorAt: instantFromISO('2026-10-18T00:00:00.000Z'),
    });
    const got = occurrencesBetween(
      s,
      instantFromISO('2026-10-17T00:00:00.000Z'),
      instantFromISO('2026-11-02T00:00:00.000Z'),
      LONDON
    );
    expect(isoList(got)).toEqual([
      '2026-10-18T20:00:00.000Z', // 21:00 BST
      '2026-10-25T21:00:00.000Z', // 21:00 GMT — one hour later in UTC
      '2026-11-01T21:00:00.000Z',
    ]);
  });

  // 02:30 local does not exist on 29 March in London, so this is the case that
  // would silently drop or double a cycle.
  it('produces neither a duplicate nor a gap across a spring-forward day', () => {
    const s = schedule({
      cadence: 'daily',
      weekday: null,
      hour: 2,
      minute: 30,
      // Anchor must precede the window, or nothing fires at all.
      anchorAt: instantFromISO('2026-03-01T00:00:00.000Z'),
    });
    const got = occurrencesBetween(
      s,
      instantFromISO('2026-03-27T00:00:00.000Z'),
      instantFromISO('2026-04-01T00:00:00.000Z'),
      LONDON
    );
    // One per calendar day, 27 through 31 March inclusive.
    expect(got).toHaveLength(5);
    // Distinct and strictly increasing: the skipped hour must not collapse two
    // days onto the same instant.
    expect(new Set(got).size).toBe(5);
    expect([...got].sort((a, b) => a - b)).toEqual(got);

    // The real proof that DST is handled: consecutive gaps are 24h, then 23h
    // across the spring-forward night, then 24h. Fixed millisecond arithmetic
    // would give 24h throughout and drift the local time by an hour.
    const gapsInHours = got.slice(1).map((at, i) => (at - got[i]) / 3_600_000);
    expect(gapsInHours).toEqual([24, 23, 24, 24]);
  });
});

describe('nextOccurrenceAfter', () => {
  it('finds the next firing', () => {
    const s = schedule({ cadence: 'weekly', weekday: 0, hour: 21, minute: 0 });
    const next = nextOccurrenceAfter(s, instantFromISO('2026-08-17T00:00:00.000Z'), UTC);
    expect(instantToISO(next as ReturnType<typeof instantFromISO>)).toBe(
      '2026-08-23T21:00:00.000Z'
    );
  });

  it('returns null for an inactive schedule', () => {
    const s = schedule({ active: false });
    expect(nextOccurrenceAfter(s, ANCHOR, UTC)).toBeNull();
  });
});

describe('firesOnLocalDate', () => {
  it('matches the cadence', () => {
    const daily = schedule({ cadence: 'daily', weekday: null });
    expect(firesOnLocalDate(daily, { year: 2026, month: 8, day: 20 }, UTC)).toBe(true);

    const weekly = schedule({ cadence: 'weekly', weekday: 0 });
    expect(firesOnLocalDate(weekly, { year: 2026, month: 8, day: 23 }, UTC)).toBe(true);
    expect(firesOnLocalDate(weekly, { year: 2026, month: 8, day: 24 }, UTC)).toBe(false);

    const everyThree = schedule({ cadence: 'every_x_days', weekday: null, intervalCount: 3 });
    expect(firesOnLocalDate(everyThree, { year: 2026, month: 8, day: 19 }, UTC)).toBe(true);
    expect(firesOnLocalDate(everyThree, { year: 2026, month: 8, day: 20 }, UTC)).toBe(false);
  });

  it('never fires before the anchor', () => {
    const s = schedule({ cadence: 'daily', weekday: null });
    expect(firesOnLocalDate(s, { year: 2020, month: 1, day: 1 }, UTC)).toBe(false);
  });

  it('handles a clamped monthly day', () => {
    const s = schedule({
      cadence: 'monthly',
      weekday: null,
      monthDay: 31,
      anchorAt: instantFromISO('2026-01-01T00:00:00.000Z'),
    });
    expect(firesOnLocalDate(s, { year: 2026, month: 2, day: 28 }, UTC)).toBe(true);
    expect(firesOnLocalDate(s, { year: 2026, month: 2, day: 27 }, UTC)).toBe(false);
    expect(firesOnLocalDate(s, { year: 2026, month: 3, day: 31 }, UTC)).toBe(true);
  });
});
