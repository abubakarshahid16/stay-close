/**
 * Repository tests (issue 008 / #19).
 *
 * The cross-group cases matter most. docs/DOMAIN.md §6 and §10.1 require
 * pending-exclusion and contact history to be *global* to a person rather than
 * scoped to a group. A query that accidentally filtered by group would still
 * pass a naive single-group test, so those are asserted explicitly.
 */
import { NodeSqlDriver } from '../../src/testing/NodeSqlDriver';
import { migrate } from '../../src/adapters/persistence/Database';
import { SqlUnitOfWork } from '../../src/adapters/persistence/SqlRepositories';
import type { Repositories } from '../../src/ports/repositories';
import { instantFromISO, nativeContactId } from '../../src/domain/shared/ids';

const NOW = instantFromISO('2026-08-16T21:00:00.000Z');
const LATER = instantFromISO('2026-08-20T09:00:00.000Z');

async function setup(): Promise<{ db: NodeSqlDriver; uow: SqlUnitOfWork; repos: Repositories }> {
  const db = new NodeSqlDriver(':memory:');
  await migrate(db);
  const uow = new SqlUnitOfWork(db);
  return { db, uow, repos: uow.repositories };
}

describe('ContactReferenceRepository', () => {
  it('creates and finds by id, phone and native id', async () => {
    const { db, repos } = await setup();
    const created = await repos.contacts.ensure(
      { nativeId: nativeContactId('n-1'), phoneE164: '+447700900123', displayNameCache: 'Ahmed' },
      NOW
    );
    expect((await repos.contacts.findById(created.id))?.phoneE164).toBe('+447700900123');
    expect((await repos.contacts.findByPhone('+447700900123'))?.id).toBe(created.id);
    expect((await repos.contacts.findByNativeId(nativeContactId('n-1')))?.id).toBe(created.id);
    await db.close();
  });

  // Adding the same person to a second group must not create a second person.
  it('ensure() dedupes on phone number rather than inserting twice', async () => {
    const { db, repos } = await setup();
    const a = await repos.contacts.ensure(
      { nativeId: nativeContactId('n-1'), phoneE164: '+447700900123', displayNameCache: 'Ahmed' },
      NOW
    );
    const b = await repos.contacts.ensure(
      { nativeId: nativeContactId('n-1'), phoneE164: '+447700900123', displayNameCache: 'Ahmed' },
      NOW
    );
    expect(b.id).toBe(a.id);
    expect(await repos.contacts.findAll()).toHaveLength(1);
    await db.close();
  });

  // Identifier churn is expected, not an error (docs/PLATFORM.md §1.3).
  it('ensure() repairs a churned native id on the existing person', async () => {
    const { db, repos } = await setup();
    const first = await repos.contacts.ensure(
      { nativeId: nativeContactId('old-id'), phoneE164: '+447700900123', displayNameCache: 'Ahmed' },
      NOW
    );
    const again = await repos.contacts.ensure(
      { nativeId: nativeContactId('new-id'), phoneE164: '+447700900123', displayNameCache: 'Ahmed' },
      LATER
    );
    expect(again.id).toBe(first.id);
    expect(again.nativeId).toBe('new-id');
    expect(await repos.contacts.findAll()).toHaveLength(1);
    await db.close();
  });

  it('stores a null native id for an unresolvable person', async () => {
    const { db, repos } = await setup();
    const c = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+447700900999', displayNameCache: 'Unknown' },
      NOW
    );
    expect(c.nativeId).toBeNull();
    await db.close();
  });

  it('updates the cached snapshot and availability', async () => {
    const { db, repos } = await setup();
    const c = await repos.contacts.ensure(
      { nativeId: nativeContactId('n-1'), phoneE164: '+447700900123', displayNameCache: 'Ahmed' },
      NOW
    );
    await repos.contacts.updateSnapshot(c.id, 'Ahmed Khan', '+447700900123', LATER);
    await repos.contacts.setAvailability(c.id, 'unavailable', LATER);
    const updated = await repos.contacts.findById(c.id);
    expect(updated?.displayNameCache).toBe('Ahmed Khan');
    expect(updated?.availability).toBe('unavailable');
    await db.close();
  });
});

describe('GroupRepository and MembershipRepository', () => {
  it('creates, renames and lists groups', async () => {
    const { db, repos } = await setup();
    const g = await repos.groups.create('Family', NOW);
    await repos.groups.create('Colleagues', NOW);
    await repos.groups.rename(g.id, 'Close Family', LATER);
    const all = await repos.groups.findAll();
    expect(all.map((x) => x.name)).toEqual(['Close Family', 'Colleagues']);
    await db.close();
  });

  it('trims group names', async () => {
    const { db, repos } = await setup();
    const g = await repos.groups.create('   Family   ', NOW);
    expect(g.name).toBe('Family');
    await db.close();
  });

  it('supports one person in many groups', async () => {
    const { db, repos } = await setup();
    const c = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+1', displayNameCache: 'Ahmed' },
      NOW
    );
    const family = await repos.groups.create('Family', NOW);
    const friends = await repos.groups.create('Friends', NOW);
    await repos.memberships.add(family.id, c.id, NOW);
    await repos.memberships.add(friends.id, c.id, NOW);
    expect(await repos.memberships.findByContact(c.id)).toHaveLength(2);
    await db.close();
  });

  it('add() is idempotent and reactivates instead of duplicating', async () => {
    const { db, repos } = await setup();
    const c = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+1', displayNameCache: 'Ahmed' },
      NOW
    );
    const g = await repos.groups.create('Family', NOW);
    const first = await repos.memberships.add(g.id, c.id, NOW);
    await repos.memberships.setActive(first.id, false, NOW);
    const second = await repos.memberships.add(g.id, c.id, LATER);
    expect(second.id).toBe(first.id);
    expect(second.active).toBe(true);
    expect(await repos.memberships.countByGroup(g.id)).toBe(1);
    await db.close();
  });

  // docs/DOMAIN.md §3: removing from one group must not touch the others.
  it('removing one membership leaves other groups untouched', async () => {
    const { db, repos } = await setup();
    const c = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+1', displayNameCache: 'Ahmed' },
      NOW
    );
    const family = await repos.groups.create('Family', NOW);
    const friends = await repos.groups.create('Friends', NOW);
    const m = await repos.memberships.add(family.id, c.id, NOW);
    await repos.memberships.add(friends.id, c.id, NOW);

    await repos.memberships.remove(m.id);

    expect(await repos.memberships.findByGroup(family.id)).toHaveLength(0);
    expect(await repos.memberships.findByGroup(friends.id)).toHaveLength(1);
    expect(await repos.contacts.findById(c.id)).not.toBeNull();
    await db.close();
  });

  it('counts active members only when asked', async () => {
    const { db, repos } = await setup();
    const g = await repos.groups.create('Family', NOW);
    const a = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+1', displayNameCache: 'A' },
      NOW
    );
    const b = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+2', displayNameCache: 'B' },
      NOW
    );
    await repos.memberships.add(g.id, a.id, NOW);
    const mb = await repos.memberships.add(g.id, b.id, NOW);
    await repos.memberships.setActive(mb.id, false, NOW);
    expect(await repos.memberships.countByGroup(g.id)).toBe(2);
    expect(await repos.memberships.countByGroup(g.id, true)).toBe(1);
    await db.close();
  });
});

describe('ScheduleRepository', () => {
  const base = {
    peoplePerCycle: 2,
    cadence: 'weekly' as const,
    intervalCount: 1,
    weekday: 0,
    monthDay: null,
    hour: 21,
    minute: 0,
    anchorAt: NOW,
    active: true,
  };

  it('creates and reads back a schedule', async () => {
    const { db, repos } = await setup();
    const g = await repos.groups.create('Family', NOW);
    const s = await repos.schedules.create({ ...base, groupId: g.id }, NOW);
    expect(s.peoplePerCycle).toBe(2);
    expect(s.cadence).toBe('weekly');
    expect((await repos.schedules.findByGroup(g.id))).toHaveLength(1);
    await db.close();
  });

  it('applies a partial update and leaves other fields alone', async () => {
    const { db, repos } = await setup();
    const g = await repos.groups.create('Family', NOW);
    const s = await repos.schedules.create({ ...base, groupId: g.id }, NOW);
    await repos.schedules.update(s.id, { hour: 20, weekday: 6 }, LATER);
    const updated = await repos.schedules.findById(s.id);
    expect(updated?.hour).toBe(20);
    expect(updated?.weekday).toBe(6);
    expect(updated?.peoplePerCycle).toBe(2);
    expect(updated?.cadence).toBe('weekly');
    await db.close();
  });

  it('an empty update is a no-op', async () => {
    const { db, repos } = await setup();
    const g = await repos.groups.create('Family', NOW);
    const s = await repos.schedules.create({ ...base, groupId: g.id }, NOW);
    await expect(repos.schedules.update(s.id, {}, LATER)).resolves.toBeUndefined();
    await db.close();
  });

  it('lists only active schedules', async () => {
    const { db, repos } = await setup();
    const g = await repos.groups.create('Family', NOW);
    const s1 = await repos.schedules.create({ ...base, groupId: g.id }, NOW);
    await repos.schedules.create({ ...base, groupId: g.id, active: false }, NOW);
    const active = await repos.schedules.findAllActive();
    expect(active.map((s) => s.id)).toEqual([s1.id]);
    await db.close();
  });

  it('preserves a monthly anchor of 31 rather than a resolved date', async () => {
    const { db, repos } = await setup();
    const g = await repos.groups.create('Old Friends', NOW);
    const s = await repos.schedules.create(
      { ...base, groupId: g.id, cadence: 'monthly', weekday: null, monthDay: 31 },
      NOW
    );
    expect((await repos.schedules.findById(s.id))?.monthDay).toBe(31);
    await db.close();
  });
});

describe('ReminderRepository', () => {
  async function seedReminderContext() {
    const ctx = await setup();
    const contact = await ctx.repos.contacts.ensure(
      { nativeId: null, phoneE164: '+1', displayNameCache: 'Ahmed' },
      NOW
    );
    const group = await ctx.repos.groups.create('Family', NOW);
    const schedule = await ctx.repos.schedules.create(
      {
        groupId: group.id,
        peoplePerCycle: 1,
        cadence: 'weekly',
        intervalCount: 1,
        weekday: 0,
        monthDay: null,
        hour: 21,
        minute: 0,
        anchorAt: NOW,
        active: true,
      },
      NOW
    );
    return { ...ctx, contact, group, schedule };
  }

  it('creates a reminder', async () => {
    const { db, repos, contact, group, schedule } = await seedReminderContext();
    const r = await repos.reminders.createIfAbsent(
      {
        scheduleId: schedule.id,
        groupId: group.id,
        groupNameSnapshot: 'Family',
        contactReferenceId: contact.id,
        occurrenceAt: NOW,
        dueAt: NOW,
      },
      NOW
    );
    expect(r?.state).toBe('pending');
    await db.close();
  });

  // The repository half of scheduler idempotence (docs/DOMAIN.md §14.1).
  it('createIfAbsent returns null for a duplicate occurrence', async () => {
    const { db, repos, contact, group, schedule } = await seedReminderContext();
    const input = {
      scheduleId: schedule.id,
      groupId: group.id,
      groupNameSnapshot: 'Family',
      contactReferenceId: contact.id,
      occurrenceAt: NOW,
      dueAt: NOW,
    };
    expect(await repos.reminders.createIfAbsent(input, NOW)).not.toBeNull();
    expect(await repos.reminders.createIfAbsent(input, NOW)).toBeNull();
    expect(await repos.reminders.createIfAbsent(input, NOW)).toBeNull();
    expect(await repos.reminders.findByContact(contact.id)).toHaveLength(1);
    await db.close();
  });

  it('resolve() marks terminal state and ignores an already-resolved reminder', async () => {
    const { db, repos, contact, group, schedule } = await seedReminderContext();
    const r = await repos.reminders.createIfAbsent(
      {
        scheduleId: schedule.id,
        groupId: group.id,
        groupNameSnapshot: 'Family',
        contactReferenceId: contact.id,
        occurrenceAt: NOW,
        dueAt: NOW,
      },
      NOW
    );
    await repos.reminders.resolve(r!.id, 'completed', LATER);
    expect((await repos.reminders.findById(r!.id))?.state).toBe('completed');

    // Completion is final for the occurrence (docs/DOMAIN.md §8.2).
    await repos.reminders.resolve(r!.id, 'skipped', LATER);
    expect((await repos.reminders.findById(r!.id))?.state).toBe('completed');
    await db.close();
  });

  it('snooze() updates in place and never creates a second reminder', async () => {
    const { db, repos, contact, group, schedule } = await seedReminderContext();
    const r = await repos.reminders.createIfAbsent(
      {
        scheduleId: schedule.id,
        groupId: group.id,
        groupNameSnapshot: 'Family',
        contactReferenceId: contact.id,
        occurrenceAt: NOW,
        dueAt: NOW,
      },
      NOW
    );
    await repos.reminders.snooze(r!.id, LATER, NOW);
    const after = await repos.reminders.findById(r!.id);
    expect(after?.state).toBe('pending');
    expect(after?.snoozedUntil).toBe(LATER);
    expect(after?.dueAt).toBe(LATER);
    expect(await repos.reminders.findByContact(contact.id)).toHaveLength(1);
    await db.close();
  });

  // docs/DOMAIN.md §6 — the exclusion is global, deliberately crossing groups.
  it('pending exclusion sees a reminder from a different group', async () => {
    const { db, repos, contact, group, schedule } = await seedReminderContext();
    const friends = await repos.groups.create('Friends', NOW);
    await repos.memberships.add(friends.id, contact.id, NOW);

    await repos.reminders.createIfAbsent(
      {
        scheduleId: schedule.id,
        groupId: group.id,
        groupNameSnapshot: 'Family',
        contactReferenceId: contact.id,
        occurrenceAt: NOW,
        dueAt: NOW,
      },
      NOW
    );

    // Asked from the perspective of the Friends rotation, which must still see it.
    expect(await repos.reminders.hasPendingForContact(contact.id)).toBe(true);
    expect(await repos.reminders.contactsWithPending()).toEqual([contact.id]);
    await db.close();
  });

  it('pending exclusion clears once resolved', async () => {
    const { db, repos, contact, group, schedule } = await seedReminderContext();
    const r = await repos.reminders.createIfAbsent(
      {
        scheduleId: schedule.id,
        groupId: group.id,
        groupNameSnapshot: 'Family',
        contactReferenceId: contact.id,
        occurrenceAt: NOW,
        dueAt: NOW,
      },
      NOW
    );
    await repos.reminders.resolve(r!.id, 'skipped', LATER);
    expect(await repos.reminders.hasPendingForContact(contact.id)).toBe(false);
    expect(await repos.reminders.contactsWithPending()).toEqual([]);
    await db.close();
  });

  // docs/DOMAIN.md §8.4 — cancellation is not completion, and preserves history.
  it('cancelPendingForGroup cancels pending and preserves resolved history', async () => {
    const { db, repos, contact, group, schedule } = await seedReminderContext();
    const other = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+2', displayNameCache: 'Sara' },
      NOW
    );
    const completed = await repos.reminders.createIfAbsent(
      {
        scheduleId: schedule.id,
        groupId: group.id,
        groupNameSnapshot: 'Family',
        contactReferenceId: contact.id,
        occurrenceAt: NOW,
        dueAt: NOW,
      },
      NOW
    );
    await repos.reminders.resolve(completed!.id, 'completed', NOW);
    await repos.reminders.createIfAbsent(
      {
        scheduleId: schedule.id,
        groupId: group.id,
        groupNameSnapshot: 'Family',
        contactReferenceId: other.id,
        occurrenceAt: NOW,
        dueAt: NOW,
      },
      NOW
    );

    const cancelled = await repos.reminders.cancelPendingForGroup(group.id, 'group_deleted', LATER);
    expect(cancelled).toBe(1);
    expect((await repos.reminders.findById(completed!.id))?.state).toBe('completed');
    const pendingOne = (await repos.reminders.findByContact(other.id))[0];
    expect(pendingOne.state).toBe('cancelled');
    expect(pendingOne.cancelReason).toBe('group_deleted');
    await db.close();
  });

  it('cancelPendingForMembership only touches that person in that group', async () => {
    const { db, repos, contact, group, schedule } = await seedReminderContext();
    const other = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+2', displayNameCache: 'Sara' },
      NOW
    );
    await repos.reminders.createIfAbsent(
      {
        scheduleId: schedule.id,
        groupId: group.id,
        groupNameSnapshot: 'Family',
        contactReferenceId: contact.id,
        occurrenceAt: NOW,
        dueAt: NOW,
      },
      NOW
    );
    await repos.reminders.createIfAbsent(
      {
        scheduleId: schedule.id,
        groupId: group.id,
        groupNameSnapshot: 'Family',
        contactReferenceId: other.id,
        occurrenceAt: NOW,
        dueAt: NOW,
      },
      NOW
    );

    const n = await repos.reminders.cancelPendingForMembership(
      group.id,
      contact.id,
      'membership_removed',
      LATER
    );
    expect(n).toBe(1);
    expect(await repos.reminders.hasPendingForContact(contact.id)).toBe(false);
    expect(await repos.reminders.hasPendingForContact(other.id)).toBe(true);
    await db.close();
  });

  it('keeps reminder history readable after the group is deleted', async () => {
    const { db, repos, contact, group, schedule } = await seedReminderContext();
    const r = await repos.reminders.createIfAbsent(
      {
        scheduleId: schedule.id,
        groupId: group.id,
        groupNameSnapshot: 'Family',
        contactReferenceId: contact.id,
        occurrenceAt: NOW,
        dueAt: NOW,
      },
      NOW
    );
    await repos.reminders.resolve(r!.id, 'completed', NOW);
    await repos.groups.delete(group.id);

    const survived = await repos.reminders.findById(r!.id);
    expect(survived).not.toBeNull();
    expect(survived?.groupId).toBeNull();
    expect(survived?.groupNameSnapshot).toBe('Family');
    await db.close();
  });
});

describe('ContactEventRepository', () => {
  // docs/DOMAIN.md §10.1 — completing in one group must be visible to all others.
  it('last contact is global across groups', async () => {
    const { db, repos } = await setup();
    const contact = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+1', displayNameCache: 'Ahmed' },
      NOW
    );
    const family = await repos.groups.create('Family', NOW);
    const friends = await repos.groups.create('Friends', NOW);
    await repos.memberships.add(family.id, contact.id, NOW);
    await repos.memberships.add(friends.id, contact.id, NOW);

    expect(await repos.events.lastContactedAt(contact.id)).toBeNull();

    await repos.events.record(
      {
        contactReferenceId: contact.id,
        occurredAt: NOW,
        source: 'reminder_completion',
        relatedReminderId: null,
      },
      NOW
    );

    // Read without any group filter — Friends rotation sees the Family contact.
    expect(await repos.events.lastContactedAt(contact.id)).toBe(NOW);
    await db.close();
  });

  it('returns the most recent event when several exist', async () => {
    const { db, repos } = await setup();
    const c = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+1', displayNameCache: 'Ahmed' },
      NOW
    );
    await repos.events.record(
      { contactReferenceId: c.id, occurredAt: NOW, source: 'manual_log', relatedReminderId: null },
      NOW
    );
    await repos.events.record(
      { contactReferenceId: c.id, occurredAt: LATER, source: 'manual_log', relatedReminderId: null },
      LATER
    );
    expect(await repos.events.lastContactedAt(c.id)).toBe(LATER);
    expect(await repos.events.findByContact(c.id)).toHaveLength(2);
    await db.close();
  });

  it('records a manual log with no related reminder', async () => {
    const { db, repos } = await setup();
    const c = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+1', displayNameCache: 'Ahmed' },
      NOW
    );
    const e = await repos.events.record(
      { contactReferenceId: c.id, occurredAt: NOW, source: 'manual_log', relatedReminderId: null },
      NOW
    );
    expect(e.relatedReminderId).toBeNull();
    expect(e.source).toBe('manual_log');
    await db.close();
  });

  it('lastContactedBulk returns one entry per contacted person', async () => {
    const { db, repos } = await setup();
    const a = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+1', displayNameCache: 'A' },
      NOW
    );
    const b = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+2', displayNameCache: 'B' },
      NOW
    );
    const never = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+3', displayNameCache: 'C' },
      NOW
    );
    await repos.events.record(
      { contactReferenceId: a.id, occurredAt: NOW, source: 'manual_log', relatedReminderId: null },
      NOW
    );
    await repos.events.record(
      { contactReferenceId: b.id, occurredAt: LATER, source: 'manual_log', relatedReminderId: null },
      LATER
    );

    const map = await repos.events.lastContactedBulk([a.id, b.id, never.id]);
    expect(map.get(a.id)).toBe(NOW);
    expect(map.get(b.id)).toBe(LATER);
    // Absent means never contacted — the top rotation tier.
    expect(map.has(never.id)).toBe(false);
    await db.close();
  });

  it('lastContactedBulk handles an empty id list', async () => {
    const { db, repos } = await setup();
    expect((await repos.events.lastContactedBulk([])).size).toBe(0);
    await db.close();
  });
});

describe('PriorityStateRepository', () => {
  it('has no state until something is applied', async () => {
    const { db, repos } = await setup();
    const c = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+1', displayNameCache: 'A' },
      NOW
    );
    expect(await repos.priorities.find(c.id)).toBeNull();
    await db.close();
  });

  it('accumulates skip penalties', async () => {
    const { db, repos } = await setup();
    const c = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+1', displayNameCache: 'A' },
      NOW
    );
    await repos.priorities.applySkipPenalty(c.id, LATER, NOW);
    expect((await repos.priorities.find(c.id))?.skipCount).toBe(1);
    await repos.priorities.applySkipPenalty(c.id, LATER, LATER);
    const state = await repos.priorities.find(c.id);
    expect(state?.skipCount).toBe(2);
    expect(state?.skipPenaltyUntil).toBe(LATER);
    await db.close();
  });

  // Skip and Deprioritize are distinct states (docs/DOMAIN.md §7.2, §7.3).
  it('deprioritization is separate from a skip penalty and is reversible', async () => {
    const { db, repos } = await setup();
    const c = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+1', displayNameCache: 'A' },
      NOW
    );
    await repos.priorities.applySkipPenalty(c.id, LATER, NOW);
    await repos.priorities.setDeprioritized(c.id, NOW, NOW);
    let state = await repos.priorities.find(c.id);
    expect(state?.deprioritizedAt).toBe(NOW);
    expect(state?.skipCount).toBe(1); // skip history not clobbered

    await repos.priorities.setDeprioritized(c.id, null, LATER);
    state = await repos.priorities.find(c.id);
    expect(state?.deprioritizedAt).toBeNull();
    await db.close();
  });

  it('findBulk returns only people with state', async () => {
    const { db, repos } = await setup();
    const a = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+1', displayNameCache: 'A' },
      NOW
    );
    const b = await repos.contacts.ensure(
      { nativeId: null, phoneE164: '+2', displayNameCache: 'B' },
      NOW
    );
    await repos.priorities.applySkipPenalty(a.id, LATER, NOW);
    const map = await repos.priorities.findBulk([a.id, b.id]);
    expect(map.has(a.id)).toBe(true);
    expect(map.has(b.id)).toBe(false);
    expect((await repos.priorities.findBulk([])).size).toBe(0);
    await db.close();
  });
});

describe('ScheduleOccurrenceRepository', () => {
  it('records a cycle once and reports duplicates', async () => {
    const { db, repos } = await setup();
    const g = await repos.groups.create('Family', NOW);
    const s = await repos.schedules.create(
      {
        groupId: g.id,
        peoplePerCycle: 1,
        cadence: 'daily',
        intervalCount: 1,
        weekday: null,
        monthDay: null,
        hour: 9,
        minute: 0,
        anchorAt: NOW,
        active: true,
      },
      NOW
    );

    expect(await repos.occurrences.record(s.id, NOW, 1, NOW)).toBe(true);
    expect(await repos.occurrences.record(s.id, NOW, 1, NOW)).toBe(false);
    expect(await repos.occurrences.has(s.id, NOW)).toBe(true);
    expect(await repos.occurrences.has(s.id, LATER)).toBe(false);
    await db.close();
  });

  // An empty cycle must still be recorded, or it regenerates forever.
  it('records a cycle that selected nobody', async () => {
    const { db, repos } = await setup();
    const g = await repos.groups.create('Empty', NOW);
    const s = await repos.schedules.create(
      {
        groupId: g.id,
        peoplePerCycle: 3,
        cadence: 'daily',
        intervalCount: 1,
        weekday: null,
        monthDay: null,
        hour: 9,
        minute: 0,
        anchorAt: NOW,
        active: true,
      },
      NOW
    );
    expect(await repos.occurrences.record(s.id, NOW, 0, NOW)).toBe(true);
    expect(await repos.occurrences.has(s.id, NOW)).toBe(true);
    expect((await repos.occurrences.latest(s.id))?.selectedCount).toBe(0);
    await db.close();
  });
});

describe('SettingsRepository', () => {
  it('gets, sets, overwrites and deletes', async () => {
    const { db, repos } = await setup();
    expect(await repos.settings.get('onboarded')).toBeNull();
    await repos.settings.set('onboarded', 'true');
    expect(await repos.settings.get('onboarded')).toBe('true');
    await repos.settings.set('onboarded', 'false');
    expect(await repos.settings.get('onboarded')).toBe('false');
    expect(await repos.settings.all()).toEqual({ onboarded: 'false' });
    await repos.settings.delete('onboarded');
    expect(await repos.settings.get('onboarded')).toBeNull();
    await db.close();
  });
});

describe('SqlUnitOfWork', () => {
  it('commits on success', async () => {
    const { db, uow, repos } = await setup();
    await uow.transaction(async (r) => {
      await r.groups.create('Family', NOW);
    });
    expect(await repos.groups.findAll()).toHaveLength(1);
    await db.close();
  });

  // A scheduler run creates reminders and records cycle state; a partial
  // commit would break idempotence (docs/ARCHITECTURE.md §4.6).
  it('rolls the whole unit back on failure', async () => {
    const { db, uow, repos } = await setup();
    await expect(
      uow.transaction(async (r) => {
        await r.groups.create('Family', NOW);
        await r.groups.create('Friends', NOW);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(await repos.groups.findAll()).toHaveLength(0);
    await db.close();
  });
});
