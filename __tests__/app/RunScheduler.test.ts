/**
 * Scheduler tests (issues 031 / #42, 032 / #43, 017 / #28).
 *
 * Idempotence is the property everything else depends on. The scheduler runs on
 * every app launch, so "run it three times, get one reminder" is not a nicety —
 * without it a user who opens the app twice gets reminded twice, and the
 * rotation weighting is corrupted by phantom history.
 */
import { NodeSqlDriver } from '../../src/testing/NodeSqlDriver';
import { FakeClock } from '../../src/testing/FakeClock';
import { migrate } from '../../src/adapters/persistence/Database';
import { SqlUnitOfWork } from '../../src/adapters/persistence/SqlRepositories';
import { SeededRandom } from '../../src/adapters/system/SeededRandom';
import { RunScheduler } from '../../src/usecases/scheduler/RunScheduler';
import { ScheduleUseCases } from '../../src/usecases/schedules/ScheduleUseCases';
import { GroupUseCases } from '../../src/usecases/groups/GroupUseCases';
import { unwrap, isErr } from '../../src/domain/shared/Result';
import { instantFromISO, scheduleId } from '../../src/domain/shared/ids';

/** 2026-08-16 is a Sunday. Anchor at 00:00 so a 21:00 cycle lands the same day. */
const START = '2026-08-16T00:00:00.000Z';

async function harness(seed = 1) {
  const db = new NodeSqlDriver(':memory:');
  await migrate(db);
  const clock = new FakeClock(START, 'UTC');
  const uow = new SqlUnitOfWork(db);
  const random = new SeededRandom(seed);
  return {
    db,
    clock,
    uow,
    repos: uow.repositories,
    scheduler: new RunScheduler(uow, clock, random),
    schedules: new ScheduleUseCases(uow, clock),
    groups: new GroupUseCases(uow, clock),
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

/** A group with `memberCount` members and a weekly Sunday 21:00 schedule. */
async function givenGroupWithSchedule(
  h: Harness,
  memberCount: number,
  peoplePerCycle = 1
) {
  const group = unwrap(await h.groups.create('Family'));
  for (let i = 1; i <= memberCount; i++) {
    await h.groups.addMember(group.id, {
      phoneE164: `+4477009001${String(i).padStart(2, '0')}`,
      displayName: `Person ${i}`,
      nativeId: `n-${i}`,
    });
  }
  const schedule = unwrap(
    await h.schedules.create({
      groupId: group.id,
      peoplePerCycle,
      cadence: 'weekly',
      intervalCount: 1,
      weekday: 0,
      monthDay: null,
      hour: 21,
      minute: 0,
    })
  );
  return { group, schedule };
}

describe('reminder generation', () => {
  it('creates reminders for a due cycle', async () => {
    const h = await harness();
    await givenGroupWithSchedule(h, 5, 2);
    h.clock.set('2026-08-16T22:00:00.000Z'); // past 21:00

    const outcome = await h.scheduler.run();

    expect(outcome.occurrencesProcessed).toBe(1);
    expect(outcome.remindersCreated).toBe(2);
    expect(await h.repos.reminders.findPending()).toHaveLength(2);
    await h.db.close();
  });

  it('creates nothing before the first cycle is due', async () => {
    const h = await harness();
    await givenGroupWithSchedule(h, 5, 2);
    h.clock.set('2026-08-16T20:00:00.000Z'); // before 21:00

    const outcome = await h.scheduler.run();

    expect(outcome.occurrencesProcessed).toBe(0);
    expect(outcome.remindersCreated).toBe(0);
    await h.db.close();
  });

  it('ignores an inactive schedule', async () => {
    const h = await harness();
    const { schedule } = await givenGroupWithSchedule(h, 5, 2);
    await h.schedules.setActive(schedule.id, false);
    h.clock.set('2026-08-16T22:00:00.000Z');

    expect((await h.scheduler.run()).remindersCreated).toBe(0);
    await h.db.close();
  });

  it('creates nothing for an empty group but still records the cycle', async () => {
    const h = await harness();
    const group = unwrap(await h.groups.create('Empty'));
    const schedule = unwrap(
      await h.schedules.create({
        groupId: group.id,
        peoplePerCycle: 2,
        cadence: 'weekly',
        intervalCount: 1,
        weekday: 0,
        monthDay: null,
        hour: 21,
        minute: 0,
      })
    );
    h.clock.set('2026-08-16T22:00:00.000Z');

    const outcome = await h.scheduler.run();
    expect(outcome.remindersCreated).toBe(0);
    expect(outcome.occurrencesProcessed).toBe(1);
    // Recorded, so it is not regenerated forever.
    expect(await h.repos.occurrences.findBySchedule(schedule.id)).toHaveLength(1);
    await h.db.close();
  });

  it('records the number actually selected', async () => {
    const h = await harness();
    // Asks for 5, only 3 members exist (docs/DOMAIN.md §7.4).
    const { schedule } = await givenGroupWithSchedule(h, 3, 5);
    h.clock.set('2026-08-16T22:00:00.000Z');

    const outcome = await h.scheduler.run();
    expect(outcome.remindersCreated).toBe(3);
    expect(outcome.perSchedule[0].shortCycles).toBe(1);
    expect((await h.repos.occurrences.latest(schedule.id))?.selectedCount).toBe(3);
    await h.db.close();
  });
});

describe('idempotence', () => {
  // The headline property (docs/DOMAIN.md §14.1).
  it('running three times produces one reminder per person per cycle', async () => {
    const h = await harness();
    await givenGroupWithSchedule(h, 5, 2);
    h.clock.set('2026-08-16T22:00:00.000Z');

    const first = await h.scheduler.run();
    const second = await h.scheduler.run();
    const third = await h.scheduler.run();

    expect(first.remindersCreated).toBe(2);
    expect(second.remindersCreated).toBe(0);
    expect(third.remindersCreated).toBe(0);
    // Later runs do not even re-evaluate the cycle: the recorded occurrence
    // advances the watermark, so occurrencesBetween returns nothing.
    // occurrencesSkipped counts genuine claim contention, not this path.
    expect(second.occurrencesProcessed).toBe(0);
    expect(await h.repos.reminders.findPending()).toHaveLength(2);
    await h.db.close();
  });

  // The claim path itself, exercised directly: a pre-recorded occurrence must
  // be refused rather than reprocessed. This is what protects against two
  // concurrent runs both selecting for the same cycle.
  it('refuses to reprocess an occurrence that is already claimed', async () => {
    const h = await harness();
    const { schedule } = await givenGroupWithSchedule(h, 5, 2);

    // Claim the 21:00 cycle out of band, without creating any reminders.
    const occurrenceAt = instantFromISO('2026-08-16T21:00:00.000Z');
    expect(
      await h.repos.occurrences.record(schedule.id, occurrenceAt, 0, h.clock.now())
    ).toBe(true);

    h.clock.set('2026-08-16T22:00:00.000Z');
    const outcome = await h.scheduler.run();

    expect(outcome.remindersCreated).toBe(0);
    expect(await h.repos.reminders.findPending()).toHaveLength(0);
    await h.db.close();
  });

  it('does not regenerate an empty cycle on later runs', async () => {
    const h = await harness();
    const group = unwrap(await h.groups.create('Empty'));
    await h.schedules.create({
      groupId: group.id,
      peoplePerCycle: 1,
      cadence: 'weekly',
      intervalCount: 1,
      weekday: 0,
      monthDay: null,
      hour: 21,
      minute: 0,
    });
    h.clock.set('2026-08-16T22:00:00.000Z');

    await h.scheduler.run();
    const second = await h.scheduler.run();
    // Nothing due, because the empty cycle was still recorded. Without that
    // row it would look unprocessed and regenerate on every launch forever.
    expect(second.occurrencesProcessed).toBe(0);
    expect(second.remindersCreated).toBe(0);
    await h.db.close();
  });

  it('stays idempotent across many runs and many cycles', async () => {
    const h = await harness();
    await givenGroupWithSchedule(h, 10, 1);

    // Four weekly cycles have come due.
    h.clock.set('2026-09-07T22:00:00.000Z');
    const first = await h.scheduler.run();
    expect(first.occurrencesProcessed).toBe(4);

    for (let i = 0; i < 5; i++) {
      expect((await h.scheduler.run()).remindersCreated).toBe(0);
    }
    // 4 cycles x 1 person, and no duplicates.
    const all = await h.repos.reminders.findPending();
    expect(all).toHaveLength(4);
    await h.db.close();
  });
});

describe('catch-up after a long absence', () => {
  // docs/PLATFORM.md §4 — no background execution, so missed cycles must be
  // generated at launch rather than lost.
  it('generates every cycle missed while the app was closed', async () => {
    const h = await harness();
    await givenGroupWithSchedule(h, 20, 1);

    // Eight weeks later.
    h.clock.set('2026-10-11T22:00:00.000Z');
    const outcome = await h.scheduler.run();

    expect(outcome.occurrencesProcessed).toBe(9);
    await h.db.close();
  });

  // The global pending rule applies within a single catch-up run too, so one
  // person cannot be reminded by eight consecutive cycles.
  it('does not stack multiple reminders on the same person during catch-up', async () => {
    const h = await harness();
    await givenGroupWithSchedule(h, 20, 1);
    h.clock.set('2026-10-11T22:00:00.000Z');

    await h.scheduler.run();

    const pending = await h.repos.reminders.findPending();
    const ids = pending.map((r) => r.contactReferenceId);
    expect(new Set(ids).size).toBe(ids.length);
    await h.db.close();
  });

  it('stops creating reminders once everyone is pending', async () => {
    const h = await harness();
    // Three members, weekly, ten weeks of catch-up: only three can be pending.
    await givenGroupWithSchedule(h, 3, 1);
    h.clock.set('2026-10-25T22:00:00.000Z');

    await h.scheduler.run();
    expect(await h.repos.reminders.findPending()).toHaveLength(3);
    await h.db.close();
  });
});

describe('schedule editing', () => {
  // docs/DOMAIN.md §4.4 — future behaviour changes, history does not.
  it('does not rewrite past occurrences or reminders', async () => {
    const h = await harness();
    const { schedule } = await givenGroupWithSchedule(h, 5, 1);
    h.clock.set('2026-08-16T22:00:00.000Z');
    await h.scheduler.run();

    const before = await h.repos.reminders.findPending();
    expect(before).toHaveLength(1);
    const originalDue = before[0].dueAt;

    // Sunday 21:00 -> Saturday 20:00.
    unwrap(await h.schedules.edit(schedule.id, { weekday: 6, hour: 20 }));

    const after = await h.repos.reminders.findById(before[0].id);
    expect(after?.dueAt).toBe(originalDue);
    // The processed cycle stays processed, so it is not regenerated.
    expect(await h.repos.occurrences.findBySchedule(schedule.id)).toHaveLength(1);
    await h.db.close();
  });

  it('applies the new configuration to future cycles', async () => {
    const h = await harness();
    const { schedule } = await givenGroupWithSchedule(h, 5, 1);
    h.clock.set('2026-08-16T22:00:00.000Z');
    await h.scheduler.run();

    unwrap(await h.schedules.edit(schedule.id, { weekday: 6, hour: 20 }));

    // The following Saturday is 22 August.
    h.clock.set('2026-08-22T21:00:00.000Z');
    const outcome = await h.scheduler.run();
    expect(outcome.occurrencesProcessed).toBe(1);
    await h.db.close();
  });

  it('re-validates cross-field rules on the merged schedule', async () => {
    const h = await harness();
    const { schedule } = await givenGroupWithSchedule(h, 5, 1);

    // Switching to daily without clearing weekday must fail, not silently pass.
    expect(isErr(await h.schedules.edit(schedule.id, { cadence: 'daily' }))).toBe(true);
    // Clearing it explicitly succeeds.
    expect(
      unwrap(await h.schedules.edit(schedule.id, { cadence: 'daily', weekday: null })).cadence
    ).toBe('daily');
    await h.db.close();
  });

  it('reports NOT_FOUND for a missing schedule', async () => {
    const h = await harness();
    expect(isErr(await h.schedules.edit(scheduleId(999), { hour: 9 }))).toBe(true);
    await h.db.close();
  });

  it('refuses a second active schedule for one group in V1', async () => {
    const h = await harness();
    const { group } = await givenGroupWithSchedule(h, 3, 1);
    const second = await h.schedules.create({
      groupId: group.id,
      peoplePerCycle: 1,
      cadence: 'daily',
      intervalCount: 1,
      weekday: null,
      monthDay: null,
      hour: 9,
      minute: 0,
    });
    expect(isErr(second)).toBe(true);
    await h.db.close();
  });

  it('pausing a schedule stops future cycles without touching history', async () => {
    const h = await harness();
    const { schedule } = await givenGroupWithSchedule(h, 5, 1);
    h.clock.set('2026-08-16T22:00:00.000Z');
    await h.scheduler.run();

    await h.schedules.setActive(schedule.id, false);
    h.clock.set('2026-08-30T22:00:00.000Z');

    expect((await h.scheduler.run()).remindersCreated).toBe(0);
    expect(await h.repos.reminders.findPending()).toHaveLength(1); // the original survives
    await h.db.close();
  });

  it('deleting a schedule cancels its unresolved reminders', async () => {
    const h = await harness();
    const { schedule } = await givenGroupWithSchedule(h, 5, 1);
    h.clock.set('2026-08-16T22:00:00.000Z');
    await h.scheduler.run();

    const outcome = unwrap(await h.schedules.delete(schedule.id));
    expect(outcome.cancelledReminders).toBe(1);
    expect(await h.repos.reminders.findPending()).toHaveLength(0);
    await h.db.close();
  });
});

describe('multiple groups', () => {
  it('runs every active schedule', async () => {
    const h = await harness();
    for (const name of ['Family', 'Friends']) {
      const group = unwrap(await h.groups.create(name));
      for (let i = 1; i <= 4; i++) {
        await h.groups.addMember(group.id, {
          phoneE164: `+44770090${name === 'Family' ? '1' : '2'}${String(i).padStart(2, '0')}`,
          displayName: `${name} ${i}`,
          nativeId: `${name}-${i}`,
        });
      }
      await h.schedules.create({
        groupId: group.id,
        peoplePerCycle: 1,
        cadence: 'weekly',
        intervalCount: 1,
        weekday: 0,
        monthDay: null,
        hour: 21,
        minute: 0,
      });
    }
    h.clock.set('2026-08-16T22:00:00.000Z');

    const outcome = await h.scheduler.run();
    expect(outcome.perSchedule).toHaveLength(2);
    expect(outcome.remindersCreated).toBe(2);
    await h.db.close();
  });

  // docs/DOMAIN.md §6 — a shared person must not be reminded by both groups.
  it('does not double-remind a person who belongs to two groups', async () => {
    const h = await harness();
    const shared = {
      phoneE164: '+447700900999',
      displayName: 'Shared',
      nativeId: 'shared-1',
    };

    for (const name of ['Family', 'Friends']) {
      const group = unwrap(await h.groups.create(name));
      await h.groups.addMember(group.id, shared);
      await h.schedules.create({
        groupId: group.id,
        peoplePerCycle: 1,
        cadence: 'weekly',
        intervalCount: 1,
        weekday: 0,
        monthDay: null,
        hour: 21,
        minute: 0,
      });
    }
    h.clock.set('2026-08-16T22:00:00.000Z');

    await h.scheduler.run();

    // One reminder total, not one per group.
    expect(await h.repos.reminders.findPending()).toHaveLength(1);
    await h.db.close();
  });
});
