/**
 * Schedule descriptions.
 *
 * This had no tests, which mattered once the create screen stopped restricting
 * what a schedule can be. The form used to offer four fixed times with minutes
 * locked to zero, eight of the thirty-one days of the month, and intervals
 * frozen at "every 3 days" / "every 2 weeks" — all UI restrictions, since the
 * domain has always accepted any hour 0-23, minute 0-59, day 1-31 and interval
 * from 1 upwards.
 *
 * Removing those restrictions means the description is now the only place a
 * user can confirm the app understood what they picked. A schedule set for
 * 07:35 that reads back "07:00" is worse than the restriction was.
 */
import { describeSchedule, describeCadence, cyclesCaveat } from '../../src/ui/describeSchedule';
import type { Schedule } from '../../src/domain/schedule/Schedule';
import { groupId, scheduleId } from '../../src/domain/shared/ids';

/** A schedule with everything specified, so each test varies one thing. */
function schedule(patch: Partial<Schedule> = {}): Schedule {
  return {
    id: scheduleId(1),
    groupId: groupId(1),
    peoplePerCycle: 1,
    cadence: 'weekly',
    intervalCount: 1,
    weekday: 0,
    monthDay: null,
    hour: 21,
    minute: 0,
    active: true,
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
    ...patch,
  } as Schedule;
}

describe('the time is read back exactly as chosen', () => {
  it.each([
    [0, 0, '00:00'],
    [7, 35, '07:35'],
    [9, 5, '09:05'],
    [12, 0, '12:00'],
    [13, 45, '13:45'],
    [23, 55, '23:55'],
  ])('hour %i minute %i reads as %s', (hour, minute, expected) => {
    expect(describeSchedule(schedule({ hour, minute }))).toContain(`at ${expected}`);
  });

  // The specific regression the UI change could introduce: minutes silently
  // dropped, so a 07:35 schedule reads back as 07:00.
  it('does not round minutes away', () => {
    expect(describeSchedule(schedule({ hour: 7, minute: 35 }))).not.toContain('07:00');
  });
});

describe('any interval is described, not just the ones the form used to offer', () => {
  it.each([
    [2, 'every 2 days'],
    [3, 'every 3 days'],
    [5, 'every 5 days'],
    [10, 'every 10 days'],
  ])('every_x_days with interval %i reads as "%s"', (intervalCount, expected) => {
    expect(describeCadence(schedule({ cadence: 'every_x_days', intervalCount }))).toBe(expected);
  });

  it.each([
    [2, 'every 2 weeks on Sunday'],
    [3, 'every 3 weeks on Sunday'],
    [6, 'every 6 weeks on Sunday'],
  ])('every_x_weeks with interval %i reads as "%s"', (intervalCount, expected) => {
    expect(
      describeCadence(schedule({ cadence: 'every_x_weeks', intervalCount, weekday: 0 }))
    ).toBe(expected);
  });

  // An interval of one is not "every 1 days".
  it('collapses an interval of one to the plain cadence', () => {
    expect(describeCadence(schedule({ cadence: 'every_x_days', intervalCount: 1 }))).toBe(
      'every day'
    );
    expect(
      describeCadence(schedule({ cadence: 'every_x_weeks', intervalCount: 1, weekday: 3 }))
    ).toBe('every Wednesday');
  });
});

describe('every day of the month is described', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [31, '31st'],
  ])('day %i reads as the %s', (monthDay, expected) => {
    expect(describeCadence(schedule({ cadence: 'monthly', monthDay }))).toBe(
      `on the ${expected} of each month`
    );
  });

  // Every one of the 31 days must produce something, since the form now offers
  // all of them rather than a curated eight.
  it('describes all 31 days without a gap', () => {
    for (let day = 1; day <= 31; day++) {
      const text = describeCadence(schedule({ cadence: 'monthly', monthDay: day }));
      expect(text).toMatch(/^on the \d+(st|nd|rd|th) of each month$/);
      expect(text).toContain(String(day));
    }
  });
});

describe('the rest of the description', () => {
  it('counts people correctly', () => {
    expect(describeSchedule(schedule({ peoplePerCycle: 1 }))).toContain('1 person');
    expect(describeSchedule(schedule({ peoplePerCycle: 3 }))).toContain('3 people');
  });

  it('says when a schedule is paused', () => {
    expect(describeSchedule(schedule({ active: false }))).toContain('(paused)');
    expect(describeSchedule(schedule({ active: true }))).not.toContain('(paused)');
  });

  it('names each weekday', () => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    days.forEach((name, index) => {
      expect(describeCadence(schedule({ cadence: 'weekly', weekday: index }))).toBe(
        `every ${name}`
      );
    });
  });
});

describe('the cycles caveat', () => {
  it('stays silent when everyone is picked anyway', () => {
    expect(cyclesCaveat(schedule({ peoplePerCycle: 4 }), 4)).toBeNull();
    expect(cyclesCaveat(schedule({ peoplePerCycle: 1 }), 0)).toBeNull();
  });

  it('explains the rotation when only some are picked', () => {
    const text = cyclesCaveat(schedule({ peoplePerCycle: 1 }), 6);
    expect(text).toContain('one person');
    expect(text).toContain('6 in this group');
  });
});
