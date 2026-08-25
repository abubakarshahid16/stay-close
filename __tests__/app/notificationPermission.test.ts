/**
 * Guards the plumbing that lets the app ASK for notification permission.
 *
 * This exists because of a silent, total failure of the product's main feature.
 * ReconcileNotifications checks the permission and skips scheduling when it is
 * not granted:
 *
 *     if (permission.state !== 'granted') return SKIPPED;
 *
 * That degradation is deliberate and documented (docs/DOMAIN.md §11) — but it
 * was written for someone who had DECLINED. Nothing in the app ever called
 * request(), and the container did not even expose the scheduler for a screen
 * to call it on. On Android 13+ POST_NOTIFICATIONS starts denied until asked,
 * so every reminder was skipped, forever, with nothing on screen saying why.
 *
 * Contacts was fine only by luck: the add-people screen happened to reach the
 * contacts provider's request() directly.
 */
import { createContainer } from '../../src/container';
import { NodeSqlDriver } from '../../src/testing/NodeSqlDriver';
import { FakeClock } from '../../src/testing/FakeClock';
import { FakeContactProvider } from '../../src/testing/FakeContactProvider';
import { FakeNotificationScheduler } from '../../src/testing/FakeNotificationScheduler';
import { SeededRandom } from '../../src/adapters/system/SeededRandom';
import { migrate } from '../../src/adapters/persistence/Database';
import { unwrap } from '../../src/domain/shared/Result';
import type { CommunicationLauncher } from '../../src/ports/CommunicationLauncher';

const START = '2026-08-16T00:00:00.000Z';

const noopLauncher = {
  call: async () => ({ ok: true as const, value: undefined }),
  whatsapp: async () => ({ ok: true as const, value: undefined }),
} as unknown as CommunicationLauncher;

async function harness() {
  const db = new NodeSqlDriver(':memory:');
  await migrate(db);
  const notifications = new FakeNotificationScheduler();
  const clock = new FakeClock(START, 'UTC');
  const container = createContainer({
    clock,
    random: new SeededRandom(1),
    contacts: new FakeContactProvider(),
    notifications,
    communication: noopLauncher,
    db,
  });
  return { container, notifications, clock, db };
}

describe('asking for notification permission', () => {
  it('exposes the scheduler, so a screen has something to ask on', async () => {
    const { container, notifications } = await harness();

    // The specific regression: with no route from the UI to the adapter, the
    // app could only ever check the permission, never request it.
    expect(container.notificationsProvider).toBe(notifications);
    expect(typeof container.notificationsProvider.request).toBe('function');
    expect(typeof container.notificationsProvider.permission).toBe('function');
  });

  it('reports the state a screen needs to warn the user', async () => {
    const { container, notifications } = await harness();

    notifications.setPermission('denied', true);
    expect(await container.notificationsProvider.permission()).toEqual({
      state: 'denied',
      canAskAgain: true,
    });

    // canAskAgain false is the terminal case: the OS will not prompt again, so
    // the only honest instruction is to change it in Settings.
    notifications.setPermission('denied', false);
    expect((await container.notificationsProvider.permission()).canAskAgain).toBe(false);
  });
});

describe('why asking matters', () => {
  /** A group with one member and a weekly schedule, plus one due reminder. */
  async function withADueReminder() {
    const h = await harness();
    const group = unwrap(await h.container.groups.create('Family'));
    unwrap(
      await h.container.groups.addMember(group.id, {
        phoneE164: '+447700900101',
        displayName: 'Ahmed',
        nativeId: null,
      })
    );
    unwrap(
      await h.container.schedules.create({
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
    h.clock.set('2026-08-16T22:00:00.000Z');
    expect((await h.container.scheduler.run()).remindersCreated).toBe(1);
    return h;
  }

  it('schedules nothing at all while permission is not granted', async () => {
    const h = await withADueReminder();
    h.notifications.setPermission('denied', true);

    await h.container.notifications.run();

    // The whole product, silently inert. This is what shipped.
    expect(h.notifications.scheduleCalls).toHaveLength(0);
  });

  it('schedules once permission is granted', async () => {
    const h = await withADueReminder();
    h.notifications.setPermission('granted');

    // Snoozed so the reminder is due in the FUTURE. A notification cannot be
    // scheduled for a moment that has already passed, so an overdue reminder
    // legitimately schedules nothing and would prove nothing here.
    const [pending] = await h.container.reminders.listPending();
    unwrap(await h.container.reminders.snooze(pending.reminder.id, 'three_hours'));

    await h.container.notifications.run();

    expect(h.notifications.scheduleCalls.length).toBeGreaterThan(0);
  });

  it('still lists the reminder in-app either way, which is the intended fallback', async () => {
    const h = await withADueReminder();
    h.notifications.setPermission('denied', true);
    await h.container.notifications.run();

    // Degraded, not broken — but only defensible if the user is told.
    expect(await h.container.reminders.listPending()).toHaveLength(1);
  });
});
