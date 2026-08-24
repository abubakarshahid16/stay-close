/**
 * Notification reconciliation tests (issues 035 / #46, 036 / #47).
 *
 * Two properties matter most, and neither is obvious from reading the code:
 *
 * - the iOS 64-notification cap is respected, since exceeding it drops requests
 *   SILENTLY (docs/PLATFORM.md §2.3) — a bug with no error message
 * - drift is repaired rather than assumed away, so an OS that loses its pending
 *   set across a reboot self-heals on next launch (§2.2)
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
import { ReminderUseCases } from '../../src/app/reminders/ReminderUseCases';
import {
  ReconcileNotifications,
  NOTIFICATION_BUDGET,
  defaultCopy,
} from '../../src/app/notifications/ReconcileNotifications';
import { unwrap } from '../../src/domain/shared/Result';
import { instant, reminderId } from '../../src/domain/shared/ids';

const START = '2026-08-16T00:00:00.000Z';
const DAY = 86_400_000;

async function harness() {
  const db = new NodeSqlDriver(':memory:');
  await migrate(db);
  const clock = new FakeClock(START, 'UTC');
  const uow = new SqlUnitOfWork(db);
  const notifications = new FakeNotificationScheduler();
  return {
    db,
    clock,
    uow,
    notifications,
    repos: uow.repositories,
    groups: new GroupUseCases(uow, clock),
    schedules: new ScheduleUseCases(uow, clock),
    scheduler: new RunScheduler(uow, clock, new SeededRandom(1)),
    reminders: new ReminderUseCases(uow, clock),
    reconcile: new ReconcileNotifications(uow, notifications, clock),
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

/** Insert `count` pending reminders due at increasing future days. */
async function givenFuturePendingReminders(h: Harness, count: number) {
  const group = unwrap(await h.groups.create('Family'));
  const schedule = unwrap(
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

  for (let i = 1; i <= count; i++) {
    const contact = await h.repos.contacts.ensure(
      {
        nativeId: null,
        phoneE164: `+44770090${String(i).padStart(4, '0')}`,
        displayNameCache: `Person ${i}`,
      },
      h.clock.now()
    );
    await h.repos.memberships.add(group.id, contact.id, h.clock.now());
    await h.repos.reminders.createIfAbsent(
      {
        scheduleId: schedule.id,
        groupId: group.id,
        groupNameSnapshot: 'Family',
        contactReferenceId: contact.id,
        occurrenceAt: instant(h.clock.now() + i * DAY),
        dueAt: instant(h.clock.now() + i * DAY),
      },
      h.clock.now()
    );
  }
  return { group, schedule };
}

describe('permission handling', () => {
  it.each(['denied', 'undetermined', 'unavailable'] as const)(
    'schedules nothing when permission is %s',
    async (state) => {
      const h = await harness();
      await givenFuturePendingReminders(h, 3);
      h.notifications.setPermission(state);

      const outcome = await h.reconcile.run();

      // The app still works: the reminders remain as in-app tasks.
      expect(outcome.skipped).toBe(true);
      expect(h.notifications.scheduledCount).toBe(0);
      expect(await h.repos.reminders.findPending()).toHaveLength(3);
      await h.db.close();
    }
  );
});

describe('scheduling', () => {
  it('schedules one notification per future reminder', async () => {
    const h = await harness();
    await givenFuturePendingReminders(h, 3);

    const outcome = await h.reconcile.run();

    expect(outcome.scheduled).toBe(3);
    expect(h.notifications.scheduledCount).toBe(3);
    await h.db.close();
  });

  it('schedules at the reminder due time', async () => {
    const h = await harness();
    await givenFuturePendingReminders(h, 1);
    await h.reconcile.run();

    const pending = (await h.repos.reminders.findPending())[0];
    expect(h.notifications.scheduledFor(pending.id)?.at).toBe(pending.dueAt);
    await h.db.close();
  });

  // docs/PRODUCT.md §5 — a lock screen is visible to anyone holding the phone.
  it('does not name the person in the notification', async () => {
    const h = await harness();
    await givenFuturePendingReminders(h, 1);
    await h.reconcile.run();

    const entry = h.notifications.scheduleCalls[0];
    expect(entry.content.body).not.toMatch(/Person/);
    expect(entry.content.title).toBe('Stay Close');
    expect(defaultCopy().body).not.toMatch(/Person/);
    await h.db.close();
  });

  // docs/DOMAIN.md §11 — one notification per reminder, never spam.
  it('does not notify for a reminder already past due', async () => {
    const h = await harness();
    await givenFuturePendingReminders(h, 3);
    // Jump past all three due dates.
    h.clock.advanceDays(10);

    const outcome = await h.reconcile.run();

    expect(outcome.scheduled).toBe(0);
    expect(h.notifications.scheduledCount).toBe(0);
    // Still real work in the app, just not re-notified.
    expect(await h.repos.reminders.findPending()).toHaveLength(3);
    await h.db.close();
  });
});

describe('idempotence', () => {
  it('does not reschedule what is already correct', async () => {
    const h = await harness();
    await givenFuturePendingReminders(h, 3);

    const first = await h.reconcile.run();
    const second = await h.reconcile.run();

    expect(first.scheduled).toBe(3);
    expect(second.scheduled).toBe(0);
    expect(second.alreadyCorrect).toBe(3);
    expect(second.cancelled).toBe(0);
    expect(h.notifications.scheduleCalls).toHaveLength(3);
    await h.db.close();
  });

  it('stays stable over many runs', async () => {
    const h = await harness();
    await givenFuturePendingReminders(h, 5);
    for (let i = 0; i < 5; i++) await h.reconcile.run();
    expect(h.notifications.scheduledCount).toBe(5);
    expect(h.notifications.scheduleCalls).toHaveLength(5);
    await h.db.close();
  });
});

describe('drift repair', () => {
  // The reboot case. iOS survival is unverified (docs/PLATFORM.md §2.2), so
  // reconciliation must not depend on it.
  it('re-registers everything after the OS loses its pending set', async () => {
    const h = await harness();
    await givenFuturePendingReminders(h, 4);
    await h.reconcile.run();
    expect(h.notifications.scheduledCount).toBe(4);

    h.notifications.simulateOsWipe();
    const outcome = await h.reconcile.run();

    expect(outcome.scheduled).toBe(4);
    expect(h.notifications.scheduledCount).toBe(4);
    await h.db.close();
  });

  // Regression guard. Reconciliation originally compared presence only, so a
  // notification left at a stale time was reported "already correct" and fired
  // at the wrong moment. Time is part of the comparison now.
  it('replaces a notification scheduled at the wrong time', async () => {
    const h = await harness();
    await givenFuturePendingReminders(h, 1);
    const pending = (await h.repos.reminders.findPending())[0];

    // The OS holds this reminder, but an hour off from its actual due time.
    h.notifications.seed(pending.id, instant(pending.dueAt + 3_600_000), defaultCopy());

    const outcome = await h.reconcile.run();

    expect(outcome.scheduled).toBe(1);
    expect(outcome.alreadyCorrect).toBe(0);
    expect(h.notifications.scheduledFor(pending.id)?.at).toBe(pending.dueAt);
    await h.db.close();
  });

  it('cancels a stray notification for a reminder that no longer exists', async () => {
    const h = await harness();
    await givenFuturePendingReminders(h, 2);
    // The OS holds one we never asked for, or whose reminder is long gone.
    h.notifications.seed(reminderId(9999), instant(h.clock.now() + DAY), defaultCopy());

    const outcome = await h.reconcile.run();

    expect(outcome.cancelled).toBe(1);
    expect(h.notifications.cancelCalls).toContain(reminderId(9999));
    await h.db.close();
  });

  it('cancels the notification once its reminder is resolved', async () => {
    const h = await harness();
    await givenFuturePendingReminders(h, 3);
    await h.reconcile.run();

    const pending = await h.repos.reminders.findPending();
    await h.reminders.complete(pending[0].id);
    const outcome = await h.reconcile.run();

    expect(outcome.cancelled).toBe(1);
    expect(h.notifications.scheduledFor(pending[0].id)).toBeUndefined();
    expect(h.notifications.scheduledCount).toBe(2);
    await h.db.close();
  });

  it('moves the notification when a reminder is snoozed', async () => {
    const h = await harness();
    await givenFuturePendingReminders(h, 1);
    await h.reconcile.run();

    const pending = (await h.repos.reminders.findPending())[0];
    const originalAt = h.notifications.scheduledFor(pending.id)?.at;

    unwrap(await h.reminders.snooze(pending.id, 'three_hours'));
    await h.reconcile.run();

    const updated = (await h.repos.reminders.findPending())[0];
    const rescheduled = h.notifications.scheduledFor(updated.id);
    expect(rescheduled?.at).toBe(updated.dueAt);
    expect(rescheduled?.at).not.toBe(originalAt);
    await h.db.close();
  });
});

describe('the iOS 64-notification cap', () => {
  // Exceeding the cap drops requests silently, so this is a correctness bug
  // with no error message. Hence an explicit budget.
  it('never schedules more than the budget', async () => {
    const h = await harness();
    await givenFuturePendingReminders(h, NOTIFICATION_BUDGET + 20);

    const outcome = await h.reconcile.run();

    expect(outcome.scheduled).toBe(NOTIFICATION_BUDGET);
    expect(h.notifications.scheduledCount).toBe(NOTIFICATION_BUDGET);
    expect(outcome.deferred).toBe(20);
    await h.db.close();
  });

  it('keeps the budget below the platform cap', () => {
    expect(NOTIFICATION_BUDGET).toBeLessThan(64);
  });

  it('prioritises the soonest reminders', async () => {
    const h = await harness();
    await givenFuturePendingReminders(h, NOTIFICATION_BUDGET + 10);
    await h.reconcile.run();

    const scheduledIds = new Set(
      (await h.notifications.listScheduled()).map((entry) => entry.id)
    );
    const pending = (await h.repos.reminders.findPending()).sort((a, b) => a.dueAt - b.dueAt);

    // The first BUDGET by due date are scheduled; the tail is deferred.
    for (const reminder of pending.slice(0, NOTIFICATION_BUDGET)) {
      expect(scheduledIds.has(reminder.id)).toBe(true);
    }
    for (const reminder of pending.slice(NOTIFICATION_BUDGET)) {
      expect(scheduledIds.has(reminder.id)).toBe(false);
    }
    await h.db.close();
  });

  // Deferred reminders are not lost — they get their turn as nearer ones clear.
  it('promotes a deferred reminder once earlier ones are resolved', async () => {
    const h = await harness();
    await givenFuturePendingReminders(h, NOTIFICATION_BUDGET + 1);
    await h.reconcile.run();

    const pending = (await h.repos.reminders.findPending()).sort((a, b) => a.dueAt - b.dueAt);
    const lastOne = pending[pending.length - 1];
    expect(h.notifications.scheduledFor(lastOne.id)).toBeUndefined();

    await h.reminders.complete(pending[0].id);
    await h.reconcile.run();

    expect(h.notifications.scheduledFor(lastOne.id)).toBeDefined();
    await h.db.close();
  });
});

describe('empty state', () => {
  it('handles having no reminders at all', async () => {
    const h = await harness();
    const outcome = await h.reconcile.run();
    expect(outcome).toMatchObject({ skipped: false, scheduled: 0, cancelled: 0 });
    await h.db.close();
  });
});
