/**
 * Upcoming schedule occurrences must reach the OS.
 *
 * This is the test whose absence let the product ship silently useless, and it
 * is worth being precise about the mechanism, because every individual piece
 * was tested and correct.
 *
 *   RunScheduler creates reminders for occurrences that have already PASSED —
 *   it asks for occurrencesBetween(lastRun, now).
 *
 *   ReconcileNotifications scheduled notifications only for reminders due in
 *   the FUTURE (dueAt > now).
 *
 * Those two sets never intersect. So a schedule set for Sunday at 21:00
 * produced no notification, ever. The only thing that ever reached the OS was a
 * snoozed reminder, because snoozing moves an existing reminder forward — which
 * is why the existing suite passed and why its own tests had to snooze first to
 * observe any scheduling at all.
 *
 * Reported from a phone as: set a schedule, close the app, nothing arrives.
 *
 * The fix registers the occurrence TIMES with the OS directly. Opening the app
 * then creates the real reminder. On a platform with no background execution a
 * notification can only be a nudge to open the app.
 */
import { NodeSqlDriver } from '../../src/testing/NodeSqlDriver';
import { FakeClock } from '../../src/testing/FakeClock';
import { FakeNotificationScheduler } from '../../src/testing/FakeNotificationScheduler';
import { migrate } from '../../src/adapters/persistence/Database';
import { SqlUnitOfWork } from '../../src/adapters/persistence/SqlRepositories';
import { SeededRandom } from '../../src/adapters/system/SeededRandom';
import { GroupUseCases } from '../../src/usecases/groups/GroupUseCases';
import { ScheduleUseCases } from '../../src/usecases/schedules/ScheduleUseCases';
import { RunScheduler } from '../../src/usecases/scheduler/RunScheduler';
import {
  ReconcileNotifications,
  NOTIFICATION_BUDGET,
} from '../../src/usecases/notifications/ReconcileNotifications';
import { unwrap } from '../../src/domain/shared/Result';

/** A Sunday, so weekly schedules land predictably. */
const START = '2026-08-16T00:00:00.000Z';

async function harness() {
  const db = new NodeSqlDriver(':memory:');
  await migrate(db);
  const clock = new FakeClock(START, 'UTC');
  const uow = new SqlUnitOfWork(db);
  const notifications = new FakeNotificationScheduler();
  notifications.setPermission('granted');

  return {
    clock,
    uow,
    notifications,
    groups: new GroupUseCases(uow, clock),
    schedules: new ScheduleUseCases(uow, clock),
    scheduler: new RunScheduler(uow, clock, new SeededRandom(1)),
    reconcile: new ReconcileNotifications(uow, notifications, clock),
  };
}

/** A group with one member and a weekly schedule, and nothing yet due. */
async function withWeeklySchedule(h: Awaited<ReturnType<typeof harness>>, hour = 21) {
  const group = unwrap(await h.groups.create('Family'));
  unwrap(
    await h.groups.addMember(group.id, {
      phoneE164: '+447700900101',
      displayName: 'Ahmed',
      nativeId: null,
    })
  );
  unwrap(
    await h.schedules.create({
      groupId: group.id,
      peoplePerCycle: 1,
      cadence: 'weekly',
      intervalCount: 1,
      weekday: 0,
      monthDay: null,
      hour,
      minute: 0,
    })
  );
  return group;
}

describe('a schedule produces notifications without opening the app again', () => {
  it('registers upcoming occurrences with the OS', async () => {
    const h = await harness();
    await withWeeklySchedule(h);

    // Deliberately NO reminders exist yet, and none are due. This is the exact
    // state a user is in right after creating a group.
    expect(await h.uow.repositories.reminders.findPending()).toHaveLength(0);

    const outcome = await h.reconcile.run();

    expect(outcome.cyclesScheduled).toBeGreaterThan(0);
    expect(await h.notifications.listScheduledCycles()).not.toHaveLength(0);
  });

  it('schedules them in the future, never in the past', async () => {
    const h = await harness();
    await withWeeklySchedule(h);
    await h.reconcile.run();

    const now = h.clock.now();
    for (const cycle of await h.notifications.listScheduledCycles()) {
      expect(cycle.at).toBeGreaterThan(now);
    }
  });

  it('schedules at the time the user chose', async () => {
    const h = await harness();
    await withWeeklySchedule(h, 7);
    await h.reconcile.run();

    const [first] = [...(await h.notifications.listScheduledCycles())].sort((a, b) => a.at - b.at);
    // 07:00 UTC, since the clock's zone is UTC.
    expect(new Date(first.at).toISOString()).toMatch(/T07:00:00/);
  });

  it('does not duplicate on repeated reconciliation', async () => {
    const h = await harness();
    await withWeeklySchedule(h);

    await h.reconcile.run();
    const afterFirst = await h.notifications.listScheduledCycles();

    const second = await h.reconcile.run();
    const afterSecond = await h.notifications.listScheduledCycles();

    expect(afterSecond).toHaveLength(afterFirst.length);
    expect(second.cyclesScheduled).toBe(0);
  });

  it('respects the notification budget, since iOS drops requests past its cap', async () => {
    const h = await harness();
    const group = unwrap(await h.groups.create('Family'));
    unwrap(
      await h.groups.addMember(group.id, {
        phoneE164: '+447700900101',
        displayName: 'Ahmed',
        nativeId: null,
      })
    );
    // Daily, so a 30-day horizon offers far more occurrences than the budget.
    unwrap(
      await h.schedules.create({
        groupId: group.id,
        peoplePerCycle: 1,
        cadence: 'daily',
        intervalCount: 1,
        weekday: null,
        monthDay: null,
        hour: 9,
        minute: 0,
      })
    );

    await h.reconcile.run();
    expect((await h.notifications.listScheduledCycles()).length).toBeLessThanOrEqual(
      NOTIFICATION_BUDGET
    );
  });

  it('keeps the soonest occurrences when over budget', async () => {
    const h = await harness();
    const group = unwrap(await h.groups.create('Family'));
    unwrap(
      await h.groups.addMember(group.id, {
        phoneE164: '+447700900101',
        displayName: 'Ahmed',
        nativeId: null,
      })
    );
    unwrap(
      await h.schedules.create({
        groupId: group.id,
        peoplePerCycle: 1,
        cadence: 'daily',
        intervalCount: 1,
        weekday: null,
        monthDay: null,
        hour: 9,
        minute: 0,
      })
    );
    await h.reconcile.run();

    const times = (await h.notifications.listScheduledCycles()).map((c) => c.at).sort();
    const now = h.clock.now();
    // The first one must be the next occurrence, not one a month out.
    expect(times[0] - now).toBeLessThan(2 * 24 * 60 * 60 * 1000);
  });
});

describe('the two notification tracks stay separate', () => {
  it('reconciling reminders does not cancel upcoming cycles', async () => {
    const h = await harness();
    await withWeeklySchedule(h);
    await h.reconcile.run();
    const before = (await h.notifications.listScheduledCycles()).length;
    expect(before).toBeGreaterThan(0);

    // Make a reminder exist and reconcile again.
    h.clock.set('2026-08-16T22:00:00.000Z');
    expect((await h.scheduler.run()).remindersCreated).toBe(1);
    await h.reconcile.run();

    expect((await h.notifications.listScheduledCycles()).length).toBeGreaterThan(0);
  });

  it('a paused schedule stops producing notifications', async () => {
    const h = await harness();
    const group = await withWeeklySchedule(h);
    await h.reconcile.run();
    expect((await h.notifications.listScheduledCycles()).length).toBeGreaterThan(0);

    const [schedule] = await h.uow.repositories.schedules.findByGroup(group.id);
    await h.uow.repositories.schedules.update(schedule.id, { active: false }, h.clock.now());

    const outcome = await h.reconcile.run();
    expect(await h.notifications.listScheduledCycles()).toHaveLength(0);
    expect(outcome.cyclesCancelled).toBeGreaterThan(0);
  });

  it('schedules nothing at all without permission', async () => {
    const h = await harness();
    await withWeeklySchedule(h);
    h.notifications.setPermission('denied', true);

    const outcome = await h.reconcile.run();
    expect(outcome.skipped).toBe(true);
    expect(await h.notifications.listScheduledCycles()).toHaveLength(0);
  });
});
