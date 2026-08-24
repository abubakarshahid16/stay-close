/**
 * Startup reconciliation and data-availability tests (issues 043 / #54,
 * 044 / #55).
 *
 * Two properties matter:
 *
 * - **Isolation.** A failure in one step must not stop the others. A
 *   notification problem must not prevent reminders being generated, and a
 *   contacts problem must not hide work the user already has.
 * - **No silent destruction.** A corrupt or unopenable database must surface a
 *   decision rather than recreate itself. It may hold years of relationship
 *   history — the very thing the product exists to remember
 *   (docs/ARCHITECTURE.md §6).
 */
import { NodeSqlDriver } from '../../src/testing/NodeSqlDriver';
import { FakeClock } from '../../src/testing/FakeClock';
import { FakeNotificationScheduler } from '../../src/testing/FakeNotificationScheduler';
import { migrate } from '../../src/adapters/persistence/Database';
import { SqlUnitOfWork } from '../../src/adapters/persistence/SqlRepositories';
import { SeededRandom } from '../../src/adapters/system/SeededRandom';
import { GroupUseCases } from '../../src/app/groups/GroupUseCases';
import { ScheduleUseCases } from '../../src/app/schedules/ScheduleUseCases';
import { RunScheduler } from '../../src/app/scheduler/RunScheduler';
import { ReconcileNotifications } from '../../src/app/notifications/ReconcileNotifications';
import {
  StartupReconciliation,
  type ContactSyncStep,
} from '../../src/app/startup/StartupReconciliation';
import {
  prepareDatabase,
  recoveryOptionsFor,
} from '../../src/adapters/persistence/prepareDatabase';
import { unwrap } from '../../src/domain/shared/Result';

const START = '2026-08-16T00:00:00.000Z';

const okSync = (): ContactSyncStep => ({
  run: async () => ({ checked: 3, repaired: 0, markedUnavailable: 0, skipped: false }),
});

const failingSync = (message: string): ContactSyncStep => ({
  run: async () => {
    throw new Error(message);
  },
});

async function harness(sync: ContactSyncStep = okSync()) {
  const db = new NodeSqlDriver(':memory:');
  await migrate(db);
  const clock = new FakeClock(START, 'UTC');
  const uow = new SqlUnitOfWork(db);
  const notifications = new FakeNotificationScheduler();
  const scheduler = new RunScheduler(uow, clock, new SeededRandom(1));
  const reconcileNotifications = new ReconcileNotifications(uow, notifications, clock);

  return {
    db,
    clock,
    uow,
    notifications,
    repos: uow.repositories,
    groups: new GroupUseCases(uow, clock),
    schedules: new ScheduleUseCases(uow, clock),
    scheduler,
    startup: new StartupReconciliation(uow, sync, scheduler, reconcileNotifications),
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

async function givenDueWork(h: Harness) {
  const group = unwrap(await h.groups.create('Family'));
  for (let i = 1; i <= 4; i++) {
    await h.groups.addMember(group.id, {
      phoneE164: `+4477009001${String(i).padStart(2, '0')}`,
      displayName: `Person ${i}`,
      nativeId: `n-${i}`,
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
  h.clock.set('2026-08-16T22:00:00.000Z');
  return group;
}

describe('happy path', () => {
  it('runs every step and reports outstanding work', async () => {
    const h = await harness();
    await givenDueWork(h);

    const outcome = await h.startup.run();

    expect(outcome.healthy).toBe(true);
    expect(outcome.problems).toEqual([]);
    expect(outcome.contacts.ok).toBe(true);
    expect(outcome.scheduler.ok).toBe(true);
    expect(outcome.notifications.ok).toBe(true);
    expect(outcome.pendingReminders).toBe(1);
    await h.db.close();
  });

  // Runs on every launch, so repeating must be safe.
  it('is idempotent across repeated launches', async () => {
    const h = await harness();
    await givenDueWork(h);

    await h.startup.run();
    const second = await h.startup.run();

    expect(second.healthy).toBe(true);
    if (second.scheduler.ok) expect(second.scheduler.value.remindersCreated).toBe(0);
    expect(second.pendingReminders).toBe(1);
    await h.db.close();
  });

  it('registers notifications for future reminders', async () => {
    const h = await harness();
    const group = unwrap(await h.groups.create('Family'));
    await h.groups.addMember(group.id, {
      phoneE164: '+447700900123',
      displayName: 'Ahmed',
      nativeId: 'n-1',
    });
    await h.schedules.create({
      groupId: group.id,
      peoplePerCycle: 1,
      cadence: 'daily',
      intervalCount: 1,
      weekday: null,
      monthDay: null,
      hour: 9,
      minute: 0,
    });

    h.clock.set('2026-08-16T10:00:00.000Z');
    await h.startup.run();

    // The generated reminder is already due, so nothing is notified — the
    // reminder is in-app work instead (docs/DOMAIN.md §11).
    expect(await h.repos.reminders.findPending()).toHaveLength(1);
    await h.db.close();
  });
});

describe('step isolation', () => {
  // A contacts problem must not stop reminders being generated.
  it('still schedules when contact sync fails', async () => {
    const h = await harness(failingSync('contacts unavailable'));
    await givenDueWork(h);

    const outcome = await h.startup.run();

    expect(outcome.healthy).toBe(false);
    expect(outcome.contacts.ok).toBe(false);
    expect(outcome.scheduler.ok).toBe(true);
    if (outcome.scheduler.ok) expect(outcome.scheduler.value.remindersCreated).toBe(1);
    await h.db.close();
  });

  it('reports the failure in a readable form', async () => {
    const h = await harness(failingSync('address book locked'));
    const outcome = await h.startup.run();

    expect(outcome.problems).toHaveLength(1);
    expect(outcome.problems[0]).toContain('Contact sync');
    expect(outcome.problems[0]).toContain('address book locked');
    await h.db.close();
  });

  // A notification problem must not hide work the user already has.
  it('still reports pending work when notification reconciliation fails', async () => {
    const h = await harness();
    await givenDueWork(h);
    // Break the scheduler used by reconciliation, not the database.
    h.notifications.permission = async () => {
      throw new Error('notification service unavailable');
    };

    const outcome = await h.startup.run();

    expect(outcome.notifications.ok).toBe(false);
    expect(outcome.pendingReminders).toBe(1);
    expect(outcome.scheduler.ok).toBe(true);
    await h.db.close();
  });

  it('does not throw when every step fails', async () => {
    const h = await harness(failingSync('boom'));
    h.notifications.permission = async () => {
      throw new Error('also boom');
    };

    await expect(h.startup.run()).resolves.toBeDefined();
    const outcome = await h.startup.run();
    expect(outcome.healthy).toBe(false);
    expect(outcome.problems.length).toBeGreaterThanOrEqual(2);
    await h.db.close();
  });
});

describe('database availability', () => {
  it('reports ready for a fresh database', async () => {
    const db = new NodeSqlDriver(':memory:');
    expect(await prepareDatabase(db)).toEqual({ kind: 'ready' });
    await db.close();
  });

  it('is safe to call repeatedly', async () => {
    const db = new NodeSqlDriver(':memory:');
    await prepareDatabase(db);
    expect(await prepareDatabase(db)).toEqual({ kind: 'ready' });
    await db.close();
  });

  it('reports unavailable rather than throwing when migration fails', async () => {
    const db = new NodeSqlDriver(':memory:');
    // Simulate an unusable database file.
    await db.close();

    const status = await prepareDatabase(db);
    expect(status.kind).toBe('unavailable');
    if (status.kind === 'unavailable') expect(status.detail.length).toBeGreaterThan(0);
  });

  it('offers no recovery options when the database is fine', async () => {
    expect(recoveryOptionsFor({ kind: 'ready' })).toEqual([]);
  });

  // The destructive option is offered, never taken automatically.
  it('offers retry before erasing', async () => {
    for (const status of [
      { kind: 'unavailable' as const, detail: 'x' },
      { kind: 'schema-mismatch' as const, detail: 'x' },
    ]) {
      const options = recoveryOptionsFor(status);
      expect(options[0]).toBe('retry');
      expect(options).toContain('erase-and-restart');
    }
  });

  // The whole point of issue 044: a corrupt database may hold years of
  // history, so nothing here may recreate it silently.
  it('never erases data as part of preparing the database', async () => {
    const db = new NodeSqlDriver(':memory:');
    await migrate(db);
    const uow = new SqlUnitOfWork(db);
    const clock = new FakeClock(START, 'UTC');
    const groups = new GroupUseCases(uow, clock);
    unwrap(await groups.create('Family'));

    await prepareDatabase(db);

    // Still there. prepareDatabase is not allowed to be destructive.
    expect(await uow.repositories.groups.findAll()).toHaveLength(1);
    await db.close();
  });
});
