/**
 * End-to-end functional workflow (issue 053 / #64).
 *
 * Walks the entire pipeline from docs/PRODUCT.md §3 in one test, through the
 * real use cases, the real SQL layer, the real rotation engine and the real
 * reconciliation — only the platform edges are faked (address book,
 * notification service, clock, randomness).
 *
 * The per-unit suites prove each piece in isolation. This proves they compose:
 * a person selected by rotation is the person a reminder is raised for, whose
 * completion writes history that changes what the *next* cycle selects. That
 * chain is where integration bugs live, and no unit test can see it.
 *
 * This is the automated half of Functional V1 acceptance. The on-device half —
 * real notification delivery, airplane mode, two real handsets — is specified
 * in docs/DEVICE_VERIFICATION.md and cannot run here.
 */
import { NodeSqlDriver } from '../../src/testing/NodeSqlDriver';
import { FakeClock } from '../../src/testing/FakeClock';
import { FakeContactProvider } from '../../src/testing/FakeContactProvider';
import { FakeNotificationScheduler } from '../../src/testing/FakeNotificationScheduler';
import { prepareDatabase } from '../../src/adapters/persistence/prepareDatabase';
import { SqlUnitOfWork } from '../../src/adapters/persistence/SqlRepositories';
import { SeededRandom } from '../../src/adapters/system/SeededRandom';
import { GroupUseCases } from '../../src/usecases/groups/GroupUseCases';
import { ScheduleUseCases } from '../../src/usecases/schedules/ScheduleUseCases';
import { RunScheduler } from '../../src/usecases/scheduler/RunScheduler';
import { ReminderUseCases } from '../../src/usecases/reminders/ReminderUseCases';
import { ReconcileNotifications } from '../../src/usecases/notifications/ReconcileNotifications';
import { SyncContactReferences } from '../../src/usecases/contacts/SyncContactReferences';
import { StartupReconciliation } from '../../src/usecases/startup/StartupReconciliation';
import { HistoryQueries } from '../../src/usecases/history/HistoryQueries';
import { LinkingCommunicationLauncher } from '../../src/adapters/communication/LinkingCommunicationLauncher';
import { unwrap } from '../../src/domain/shared/Result';

jest.mock('react-native', () => ({
  Linking: { openURL: jest.fn().mockResolvedValue(undefined) },
  Platform: { OS: 'ios' },
}));

/** 2026-08-16 is a Sunday. */
const START = '2026-08-16T08:00:00.000Z';

/** A believable address book. */
const ADDRESS_BOOK = [
  { nativeId: 'c-1', displayName: 'Ahmed', numbers: ['+447700900101'] },
  { nativeId: 'c-2', displayName: 'Sara', numbers: ['+447700900102'] },
  { nativeId: 'c-3', displayName: 'Ali', numbers: ['+447700900103'] },
  { nativeId: 'c-4', displayName: 'Fatima', numbers: ['+447700900104'] },
  { nativeId: 'c-5', displayName: 'Yusuf', numbers: ['+447700900105'] },
];

/** The whole app, wired as the composition root would (docs/ARCHITECTURE.md §9). */
async function launchApp() {
  const db = new NodeSqlDriver(':memory:');
  const status = await prepareDatabase(db);
  if (status.kind !== 'ready') throw new Error(`database not ready: ${status.kind}`);

  const clock = new FakeClock(START, 'Europe/London');
  const random = new SeededRandom(20260816);
  const contacts = new FakeContactProvider(ADDRESS_BOOK, '44');
  const notifications = new FakeNotificationScheduler();

  const uow = new SqlUnitOfWork(db);
  const sync = new SyncContactReferences(uow, contacts, clock);
  const scheduler = new RunScheduler(uow, clock, random);
  const reconcileNotifications = new ReconcileNotifications(uow, notifications, clock);

  return {
    db,
    clock,
    contacts,
    notifications,
    uow,
    repos: uow.repositories,
    groups: new GroupUseCases(uow, clock),
    schedules: new ScheduleUseCases(uow, clock),
    scheduler,
    reminders: new ReminderUseCases(uow, clock),
    reconcileNotifications,
    history: new HistoryQueries(uow, clock),
    launcher: new LinkingCommunicationLauncher(),
    startup: new StartupReconciliation(uow, sync, scheduler, reconcileNotifications),
  };
}

describe('the complete workflow', () => {
  it('runs from install to a changed rotation', async () => {
    const app = await launchApp();

    // ── 1. First launch. Nothing exists yet, and that is not an error. ──────
    const firstLaunch = await app.startup.run();
    expect(firstLaunch.healthy).toBe(true);
    expect(firstLaunch.pendingReminders).toBe(0);

    // ── 2. Grant contacts, pick people, create a group. ─────────────────────
    expect((await app.contacts.permission()).state).toBe('granted');
    const listed = await app.contacts.list();
    expect(listed).toHaveLength(5);

    const family = unwrap(await app.groups.create('Family'));
    for (const person of listed) {
      const e164 = person.phones[0].e164 as string;
      unwrap(
        await app.groups.addMember(family.id, {
          phoneE164: e164,
          displayName: person.displayName,
          nativeId: person.nativeId,
        })
      );
    }
    expect(await app.groups.memberCount(family.id)).toBe(5);

    // ── 3. Configure a schedule: one person, every Sunday at 21:00 local. ──
    const schedule = unwrap(
      await app.schedules.create({
        groupId: family.id,
        peoplePerCycle: 1,
        cadence: 'weekly',
        intervalCount: 1,
        weekday: 0,
        monthDay: null,
        hour: 21,
        minute: 0,
      })
    );

    // ── 4. Nothing is due yet — it is 08:00, the cycle fires at 21:00. ──────
    expect((await app.scheduler.run()).remindersCreated).toBe(0);

    // ── 5. Sunday evening. The cycle fires and selects one person. ──────────
    app.clock.set('2026-08-16T20:30:00.000Z'); // 21:30 BST
    const cycle = await app.startup.run();
    expect(cycle.healthy).toBe(true);
    expect(cycle.pendingReminders).toBe(1);

    const pending = await app.reminders.listPending();
    expect(pending).toHaveLength(1);
    const first = pending[0];
    expect(first.classification).toBe('due');
    // The reminder is about a real person from the address book.
    expect(ADDRESS_BOOK.map((c) => c.displayName)).toContain(first.displayName);

    // ── 6. The user opens WhatsApp. This must NOT complete anything. ────────
    const launch = await app.launcher.whatsApp(first.phoneE164);
    expect(launch.outcome).toBe('launched');

    const stillPending = await app.reminders.listPending();
    expect(stillPending).toHaveLength(1);
    expect(
      await app.repos.events.lastContactedAt(first.reminder.contactReferenceId)
    ).toBeNull();

    // ── 7. The user confirms manually. Only now is history written. ─────────
    const completed = unwrap(await app.reminders.complete(first.reminder.id));
    expect(completed.state).toBe('completed');
    expect(
      await app.repos.events.lastContactedAt(first.reminder.contactReferenceId)
    ).not.toBeNull();
    expect(await app.reminders.listPending()).toHaveLength(0);

    // ── 8. Next Sunday. Rotation must pick somebody else. ───────────────────
    app.clock.set('2026-08-23T20:30:00.000Z');
    await app.startup.run();

    const second = await app.reminders.listPending();
    expect(second).toHaveLength(1);
    // The whole promise of the product: not the same person again.
    expect(second[0].reminder.contactReferenceId).not.toBe(first.reminder.contactReferenceId);

    // ── 9. History reflects exactly what happened. ──────────────────────────
    const counts = await app.history.reminderCounts();
    expect(counts.completed).toBe(1);
    expect(counts.pending).toBe(1);
    expect(await app.history.overallCompletionRate()).toBe(1);
    expect((await app.history.streaks()).current).toBe(1);
    expect(await app.history.neverContactedPeople()).toHaveLength(4);

    expect(schedule.id).toBeDefined();
    await app.db.close();
  });

  it('rotates through everyone before repeating anybody', async () => {
    const app = await launchApp();

    const family = unwrap(await app.groups.create('Family'));
    for (const person of await app.contacts.list()) {
      await app.groups.addMember(family.id, {
        phoneE164: person.phones[0].e164 as string,
        displayName: person.displayName,
        nativeId: person.nativeId,
      });
    }
    await app.schedules.create({
      groupId: family.id,
      peoplePerCycle: 1,
      cadence: 'weekly',
      intervalCount: 1,
      weekday: 0,
      monthDay: null,
      hour: 21,
      minute: 0,
    });

    const selected: number[] = [];
    // Five Sundays for five people.
    for (const sunday of [
      '2026-08-16T20:30:00.000Z',
      '2026-08-23T20:30:00.000Z',
      '2026-08-30T20:30:00.000Z',
      '2026-09-06T20:30:00.000Z',
      '2026-09-13T20:30:00.000Z',
    ]) {
      app.clock.set(sunday);
      await app.startup.run();
      for (const view of await app.reminders.listPending()) {
        selected.push(view.reminder.contactReferenceId);
        unwrap(await app.reminders.complete(view.reminder.id));
      }
    }

    expect(selected).toHaveLength(5);
    // Everyone exactly once — no repeats while others were waiting.
    expect(new Set(selected).size).toBe(5);
    await app.db.close();
  });
});

describe('the workflow under real-world disruption', () => {
  it('survives the user ignoring the app for two months', async () => {
    const app = await launchApp();

    const family = unwrap(await app.groups.create('Family'));
    for (const person of await app.contacts.list()) {
      await app.groups.addMember(family.id, {
        phoneE164: person.phones[0].e164 as string,
        displayName: person.displayName,
        nativeId: person.nativeId,
      });
    }
    await app.schedules.create({
      groupId: family.id,
      peoplePerCycle: 1,
      cadence: 'weekly',
      intervalCount: 1,
      weekday: 0,
      monthDay: null,
      hour: 21,
      minute: 0,
    });

    // No app code runs for two months (docs/PLATFORM.md §4 — no background
    // execution exists), then the user opens it.
    app.clock.set('2026-10-18T20:30:00.000Z');
    const outcome = await app.startup.run();

    expect(outcome.healthy).toBe(true);
    // Missed cycles were generated, but nobody is stacked with several
    // reminders — the global pending rule holds within a catch-up run.
    const pending = await app.reminders.listPending();
    expect(pending.length).toBeGreaterThan(0);
    expect(new Set(pending.map((v) => v.reminder.contactReferenceId)).size).toBe(
      pending.length
    );
    // Old work presents as overdue rather than vanishing.
    expect(pending.some((v) => v.classification === 'overdue')).toBe(true);
    await app.db.close();
  });

  it('keeps working when a contact is deleted from the phone', async () => {
    const app = await launchApp();

    const family = unwrap(await app.groups.create('Family'));
    for (const person of await app.contacts.list()) {
      await app.groups.addMember(family.id, {
        phoneE164: person.phones[0].e164 as string,
        displayName: person.displayName,
        nativeId: person.nativeId,
      });
    }
    await app.schedules.create({
      groupId: family.id,
      peoplePerCycle: 1,
      cadence: 'daily',
      intervalCount: 1,
      weekday: null,
      monthDay: null,
      hour: 9,
      minute: 0,
    });

    app.clock.set('2026-08-16T09:30:00.000Z');
    await app.startup.run();
    const view = (await app.reminders.listPending())[0];
    unwrap(await app.reminders.complete(view.reminder.id));

    // The user deletes that person from their address book.
    const deleted = await app.repos.contacts.findById(view.reminder.contactReferenceId);
    app.contacts.remove(deleted!.nativeId as string);

    app.clock.set('2026-08-17T09:30:00.000Z');
    const outcome = await app.startup.run();

    expect(outcome.healthy).toBe(true);
    // Marked unavailable, not deleted, and their history survives.
    expect((await app.repos.contacts.findById(deleted!.id))?.availability).toBe('unavailable');
    expect(await app.repos.events.lastContactedAt(deleted!.id)).not.toBeNull();
    // The app carries on with everyone else.
    expect((await app.reminders.listPending()).length).toBeGreaterThan(0);
    await app.db.close();
  });

  it('keeps working with notifications denied', async () => {
    const app = await launchApp();
    app.notifications.setPermission('denied');

    const family = unwrap(await app.groups.create('Family'));
    for (const person of await app.contacts.list()) {
      await app.groups.addMember(family.id, {
        phoneE164: person.phones[0].e164 as string,
        displayName: person.displayName,
        nativeId: person.nativeId,
      });
    }
    await app.schedules.create({
      groupId: family.id,
      peoplePerCycle: 1,
      cadence: 'daily',
      intervalCount: 1,
      weekday: null,
      monthDay: null,
      hour: 9,
      minute: 0,
    });

    app.clock.set('2026-08-16T09:30:00.000Z');
    const outcome = await app.startup.run();

    // Reminders still exist as in-app tasks; notifications are an enhancement,
    // never the system of record (docs/DOMAIN.md §11).
    expect(outcome.healthy).toBe(true);
    expect(await app.reminders.listPending()).toHaveLength(1);
    expect(app.notifications.scheduledCount).toBe(0);
    await app.db.close();
  });

  it('keeps working when contacts permission is revoked mid-life', async () => {
    const app = await launchApp();

    const family = unwrap(await app.groups.create('Family'));
    for (const person of await app.contacts.list()) {
      await app.groups.addMember(family.id, {
        phoneE164: person.phones[0].e164 as string,
        displayName: person.displayName,
        nativeId: person.nativeId,
      });
    }
    await app.schedules.create({
      groupId: family.id,
      peoplePerCycle: 1,
      cadence: 'daily',
      intervalCount: 1,
      weekday: null,
      monthDay: null,
      hour: 9,
      minute: 0,
    });

    app.clock.set('2026-08-16T09:30:00.000Z');
    await app.startup.run();
    const before = await app.repos.contacts.findAll();

    // The user revokes Contacts in system settings.
    app.contacts.setPermission('denied', false);
    app.clock.set('2026-08-17T09:30:00.000Z');
    const outcome = await app.startup.run();

    // Nothing concluded from an absent address book: "invisible" is not
    // "deleted" (docs/DOMAIN.md §2.1).
    const after = await app.repos.contacts.findAll();
    expect(after).toHaveLength(before.length);
    expect(after.every((c) => c.availability === 'available')).toBe(true);
    // Groups, schedules and reminders are all intact.
    expect(await app.groups.memberCount(family.id)).toBe(5);
    expect(outcome.scheduler.ok).toBe(true);
    await app.db.close();
  });

  it('preserves everything across a simulated app restart', async () => {
    const app = await launchApp();

    const family = unwrap(await app.groups.create('Family'));
    for (const person of await app.contacts.list()) {
      await app.groups.addMember(family.id, {
        phoneE164: person.phones[0].e164 as string,
        displayName: person.displayName,
        nativeId: person.nativeId,
      });
    }
    await app.schedules.create({
      groupId: family.id,
      peoplePerCycle: 1,
      cadence: 'daily',
      intervalCount: 1,
      weekday: null,
      monthDay: null,
      hour: 9,
      minute: 0,
    });

    app.clock.set('2026-08-16T09:30:00.000Z');
    await app.startup.run();
    const view = (await app.reminders.listPending())[0];
    unwrap(await app.reminders.complete(view.reminder.id));

    // "Restart": a fresh unit of work over the same database file.
    const restarted = new SqlUnitOfWork(app.db);
    expect(await restarted.repositories.groups.findAll()).toHaveLength(1);
    expect(await restarted.repositories.memberships.findByGroup(family.id)).toHaveLength(5);
    expect(
      await restarted.repositories.events.lastContactedAt(view.reminder.contactReferenceId)
    ).not.toBeNull();
    expect(
      (await restarted.repositories.reminders.findById(view.reminder.id))?.state
    ).toBe('completed');
    await app.db.close();
  });
});

describe('two groups sharing a person', () => {
  // The arrangement docs/DOMAIN.md §6 and §10.1 exist for.
  it('never double-reminds, and completion counts across both', async () => {
    const app = await launchApp();

    const family = unwrap(await app.groups.create('Family'));
    const friends = unwrap(await app.groups.create('Friends'));
    const people = await app.contacts.list();

    // Ahmed is in both groups.
    const shared = people[0];
    for (const group of [family, friends]) {
      await app.groups.addMember(group.id, {
        phoneE164: shared.phones[0].e164 as string,
        displayName: shared.displayName,
        nativeId: shared.nativeId,
      });
      await app.schedules.create({
        groupId: group.id,
        peoplePerCycle: 1,
        cadence: 'daily',
        intervalCount: 1,
        weekday: null,
        monthDay: null,
        hour: 9,
        minute: 0,
      });
    }

    app.clock.set('2026-08-16T09:30:00.000Z');
    await app.startup.run();

    // One reminder total, not one per group.
    const pending = await app.reminders.listPending();
    expect(pending).toHaveLength(1);

    unwrap(await app.reminders.complete(pending[0].reminder.id));

    // Completing in one group is visible to the other: one shared person, one
    // relationship.
    const contact = await app.repos.contacts.findByPhone(shared.phones[0].e164 as string);
    expect(await app.repos.events.lastContactedAt(contact!.id)).not.toBeNull();
    expect(await app.groups.groupsForContact(contact!.id)).toHaveLength(2);
    await app.db.close();
  });
});
