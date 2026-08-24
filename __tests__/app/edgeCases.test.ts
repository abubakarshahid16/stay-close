/**
 * Normative edge cases (issues 045 / #56, 046 / #57).
 *
 * docs/DOMAIN.md §16 is a normative table of 19 required behaviours. Most are
 * already covered where the relevant logic lives — this file exists for the
 * rows that were NOT otherwise exercised, plus a traceability map so the spec
 * table and the suite cannot silently drift apart.
 *
 * Coverage map (§16 row -> where it is asserted):
 *
 *   duplicate-looking contacts .......... here
 *   contact with multiple numbers ....... domain/phone.test.ts
 *   no contacts on device ............... here
 *   empty group ......................... app/RunScheduler.test.ts
 *   one-member group .................... simulation/fairness.test.ts
 *   requested > available ............... domain/rotation.test.ts
 *   all members pending ................. domain/rotation.test.ts
 *   all members deprioritized ........... domain/rotation.test.ts
 *   native contact deleted .............. app/SyncContactReferences.test.ts
 *   group deleted with pending .......... app/GroupUseCases.test.ts
 *   schedule disabled or deleted ........ app/RunScheduler.test.ts
 *   schedule changed .................... app/RunScheduler.test.ts
 *   restart during pending reminder ..... here
 *   restart after completion ............ here
 *   notification permission revoked ..... app/ReconcileNotifications.test.ts
 *   contacts permission revoked ......... app/SyncContactReferences.test.ts
 *   month boundary ...................... domain/cadence.test.ts
 *   timezone change ..................... here
 *   device reboot ....................... app/ReconcileNotifications.test.ts
 */
import { NodeSqlDriver } from '../../src/testing/NodeSqlDriver';
import { FakeClock } from '../../src/testing/FakeClock';
import { FakeContactProvider } from '../../src/testing/FakeContactProvider';
import { migrate } from '../../src/adapters/persistence/Database';
import { SqlUnitOfWork } from '../../src/adapters/persistence/SqlRepositories';
import { SeededRandom } from '../../src/adapters/system/SeededRandom';
import { GroupUseCases } from '../../src/usecases/groups/GroupUseCases';
import { ScheduleUseCases } from '../../src/usecases/schedules/ScheduleUseCases';
import { RunScheduler } from '../../src/usecases/scheduler/RunScheduler';
import { ReminderUseCases } from '../../src/usecases/reminders/ReminderUseCases';
import { SyncContactReferences } from '../../src/usecases/contacts/SyncContactReferences';
import { unwrap } from '../../src/domain/shared/Result';
import { occurrencesBetween } from '../../src/domain/schedule/cadence';
import { instantFromISO, timeZoneId } from '../../src/domain/shared/ids';

const START = '2026-08-16T00:00:00.000Z';

async function harness(zone = 'UTC') {
  const db = new NodeSqlDriver(':memory:');
  await migrate(db);
  const clock = new FakeClock(START, zone);
  const uow = new SqlUnitOfWork(db);
  return {
    db,
    clock,
    uow,
    repos: uow.repositories,
    groups: new GroupUseCases(uow, clock),
    schedules: new ScheduleUseCases(uow, clock),
    scheduler: new RunScheduler(uow, clock, new SeededRandom(1)),
    reminders: new ReminderUseCases(uow, clock),
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

async function givenWeeklyGroup(h: Harness, members: number) {
  const group = unwrap(await h.groups.create('Family'));
  for (let i = 1; i <= members; i++) {
    await h.groups.addMember(group.id, {
      phoneE164: `+4477009001${String(i).padStart(2, '0')}`,
      displayName: `Person ${i}`,
      nativeId: `n-${i}`,
    });
  }
  const schedule = unwrap(
    await h.schedules.create({
      groupId: group.id,
      peoplePerCycle: 1,
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

describe('contacts', () => {
  // Two address-book entries that look like the same person but are distinct
  // records. The user decides; the app must not silently merge them.
  it('treats distinct identifiers with distinct numbers as distinct people', async () => {
    const h = await harness();
    const group = unwrap(await h.groups.create('Family'));

    const a = unwrap(
      await h.groups.addMember(group.id, {
        phoneE164: '+447700900111',
        displayName: 'Ahmed Khan',
        nativeId: 'native-a',
      })
    );
    const b = unwrap(
      await h.groups.addMember(group.id, {
        phoneE164: '+447700900222',
        displayName: 'Ahmed Khan',
        nativeId: 'native-b',
      })
    );

    expect(b.contactReferenceId).not.toBe(a.contactReferenceId);
    expect(await h.groups.memberCount(group.id)).toBe(2);
    await h.db.close();
  });

  // ...but the same NUMBER is the same person, however it arrives.
  it('merges two entries that share a number', async () => {
    const h = await harness();
    const group = unwrap(await h.groups.create('Family'));

    const a = unwrap(
      await h.groups.addMember(group.id, {
        phoneE164: '+447700900111',
        displayName: 'Ahmed',
        nativeId: 'native-a',
      })
    );
    const b = unwrap(
      await h.groups.addMember(group.id, {
        phoneE164: '+447700900111',
        displayName: 'Ahmed Khan',
        nativeId: 'native-b',
      })
    );

    expect(b.contactReferenceId).toBe(a.contactReferenceId);
    expect(await h.repos.contacts.findAll()).toHaveLength(1);
    await h.db.close();
  });

  it('remains usable with an empty address book', async () => {
    const h = await harness();
    const provider = new FakeContactProvider([]);
    const sync = new SyncContactReferences(h.uow, provider, h.clock);

    // Creating a group with no members is valid, and syncing concludes nothing.
    const group = unwrap(await h.groups.create('Family'));
    const outcome = await sync.run();

    expect(outcome.checked).toBe(0);
    expect(outcome.markedUnavailable).toBe(0);
    expect(await h.groups.memberCount(group.id)).toBe(0);
    await h.db.close();
  });

  it('creates no reminders for a group whose only member is unavailable', async () => {
    const h = await harness();
    const { group } = await givenWeeklyGroup(h, 1);
    const contact = (await h.repos.contacts.findAll())[0];
    await h.repos.contacts.setAvailability(contact.id, 'unavailable', h.clock.now());

    h.clock.set('2026-08-16T22:00:00.000Z');
    const outcome = await h.scheduler.run();

    expect(outcome.remindersCreated).toBe(0);
    // The cycle is still recorded, so it is not retried forever.
    expect(outcome.occurrencesProcessed).toBe(1);
    expect(await h.groups.memberCount(group.id)).toBe(1);
    await h.db.close();
  });
});

describe('restart', () => {
  // A "restart" is a fresh unit of work over the same database file.
  it('preserves a pending reminder', async () => {
    const h = await harness();
    await givenWeeklyGroup(h, 4);
    h.clock.set('2026-08-16T22:00:00.000Z');
    await h.scheduler.run();

    const restarted = new SqlUnitOfWork(h.db);
    const pending = await restarted.repositories.reminders.findPending();

    expect(pending).toHaveLength(1);
    expect(pending[0].state).toBe('pending');
    await h.db.close();
  });

  it('preserves a completion and its contact history', async () => {
    const h = await harness();
    await givenWeeklyGroup(h, 4);
    h.clock.set('2026-08-16T22:00:00.000Z');
    await h.scheduler.run();

    const reminder = (await h.repos.reminders.findPending())[0];
    await h.reminders.complete(reminder.id);

    const restarted = new SqlUnitOfWork(h.db);
    const after = await restarted.repositories.reminders.findById(reminder.id);
    expect(after?.state).toBe('completed');
    expect(
      await restarted.repositories.events.lastContactedAt(reminder.contactReferenceId)
    ).not.toBeNull();
    // Resolved work is no longer outstanding.
    expect(await restarted.repositories.reminders.findPending()).toHaveLength(0);
    await h.db.close();
  });

  it('does not regenerate already-processed cycles after a restart', async () => {
    const h = await harness();
    const { schedule } = await givenWeeklyGroup(h, 4);
    h.clock.set('2026-08-16T22:00:00.000Z');
    await h.scheduler.run();

    const restarted = new SqlUnitOfWork(h.db);
    const rescheduler = new RunScheduler(restarted, h.clock, new SeededRandom(1));
    const outcome = await rescheduler.run();

    expect(outcome.remindersCreated).toBe(0);
    expect(await h.repos.occurrences.findBySchedule(schedule.id)).toHaveLength(1);
    await h.db.close();
  });
});

describe('timezone change', () => {
  /**
   * The user flies from London to Karachi. A weekly 21:00 schedule must keep
   * firing at 21:00 *local*, which means the absolute instant moves — and
   * crucially, no cycle may be duplicated or skipped in the process.
   */
  const LONDON = timeZoneId('Europe/London');
  const KARACHI = timeZoneId('Asia/Karachi');

  it('keeps the local time and shifts the absolute instant', () => {
    const schedule = {
      id: 1 as never,
      groupId: 1 as never,
      peoplePerCycle: 1,
      cadence: 'weekly' as const,
      intervalCount: 1,
      weekday: 0,
      monthDay: null,
      hour: 21,
      minute: 0,
      anchorAt: instantFromISO('2026-08-16T00:00:00.000Z'),
      active: true,
      createdAt: instantFromISO('2026-08-16T00:00:00.000Z'),
      updatedAt: instantFromISO('2026-08-16T00:00:00.000Z'),
    };

    const inLondon = occurrencesBetween(
      schedule,
      instantFromISO('2026-08-16T00:00:00.000Z'),
      instantFromISO('2026-08-24T00:00:00.000Z'),
      LONDON
    );
    const inKarachi = occurrencesBetween(
      schedule,
      instantFromISO('2026-08-16T00:00:00.000Z'),
      instantFromISO('2026-08-24T00:00:00.000Z'),
      KARACHI
    );

    // Same number of cycles, different absolute instants.
    expect(inLondon).toHaveLength(2);
    expect(inKarachi).toHaveLength(2);
    expect(inKarachi[0]).not.toBe(inLondon[0]);
    // Karachi is UTC+5, London BST is UTC+1: four hours earlier in UTC.
    expect(inLondon[0] - inKarachi[0]).toBe(4 * 3_600_000);
  });

  // The important one: moving timezone mid-run must not double-remind.
  it('does not duplicate a cycle when the device timezone changes', async () => {
    const h = await harness('Europe/London');
    await givenWeeklyGroup(h, 6);

    // First cycle fires while in London.
    h.clock.set('2026-08-16T21:00:00.000Z');
    const first = await h.scheduler.run();
    expect(first.remindersCreated).toBe(1);

    // The user lands in Karachi; the same wall-clock cycle must not re-fire.
    h.clock.setTimeZone('Asia/Karachi');
    const second = await h.scheduler.run();

    expect(second.remindersCreated).toBe(0);
    expect(await h.repos.reminders.findPending()).toHaveLength(1);
    await h.db.close();
  });

  it('does not skip a cycle when moving to a timezone that is behind', async () => {
    const h = await harness('Asia/Karachi');
    await givenWeeklyGroup(h, 6);

    h.clock.set('2026-08-16T18:00:00.000Z'); // 23:00 Karachi, past 21:00
    expect((await h.scheduler.run()).remindersCreated).toBe(1);

    // Move west, then advance a full week; the next cycle must still arrive.
    h.clock.setTimeZone('America/New_York');
    h.clock.set('2026-08-24T06:00:00.000Z');
    const next = await h.scheduler.run();

    expect(next.occurrencesProcessed).toBeGreaterThanOrEqual(1);
    await h.db.close();
  });

  it('keeps a reminder resolvable across a timezone change', async () => {
    const h = await harness('Europe/London');
    await givenWeeklyGroup(h, 4);
    h.clock.set('2026-08-16T21:00:00.000Z');
    await h.scheduler.run();

    const reminder = (await h.repos.reminders.findPending())[0];
    h.clock.setTimeZone('Asia/Karachi');

    const resolved = unwrap(await h.reminders.complete(reminder.id));
    expect(resolved.state).toBe('completed');
    await h.db.close();
  });
});

describe('clock moving backwards', () => {
  // A user correcting a wrong device clock, or a manual change. Nothing may be
  // regenerated, because the occurrence watermark is monotonic.
  it('does not regenerate cycles when the clock is set back', async () => {
    const h = await harness();
    await givenWeeklyGroup(h, 5);

    h.clock.set('2026-09-06T22:00:00.000Z'); // several cycles due
    const first = await h.scheduler.run();
    expect(first.occurrencesProcessed).toBeGreaterThan(1);

    h.clock.set('2026-08-16T22:00:00.000Z'); // back in time
    const second = await h.scheduler.run();

    expect(second.remindersCreated).toBe(0);
    await h.db.close();
  });

  it('leaves existing reminders intact when the clock moves back', async () => {
    const h = await harness();
    await givenWeeklyGroup(h, 5);
    h.clock.set('2026-08-16T22:00:00.000Z');
    await h.scheduler.run();
    const before = await h.repos.reminders.findPending();

    h.clock.advance(-30 * 86_400_000);

    expect(await h.repos.reminders.findPending()).toHaveLength(before.length);
    await h.db.close();
  });
});
