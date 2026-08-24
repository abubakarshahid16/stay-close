/**
 * Group and membership use-case tests (issues 013 / #24, 014 / #25, 015 / #26).
 *
 * These run against the real SQL layer via NodeSqlDriver rather than
 * hand-written in-memory fakes. That is a deliberate choice: the behaviours
 * under test here (cancel-then-delete ordering, cascade vs SET NULL, unique
 * constraints) are *expressed in the schema*, so a fake repository would
 * happily pass tests the real database would fail. node:sqlite has no native
 * dependency, so this costs nothing in portability.
 */
import { NodeSqlDriver } from '../../src/testing/NodeSqlDriver';
import { FakeClock } from '../../src/testing/FakeClock';
import { migrate } from '../../src/adapters/persistence/Database';
import { SqlUnitOfWork } from '../../src/adapters/persistence/SqlRepositories';
import { GroupUseCases } from '../../src/app/groups/GroupUseCases';
import { isErr, isOk, unwrap } from '../../src/domain/shared/Result';
import { groupId, contactReferenceId } from '../../src/domain/shared/ids';

const START = '2026-08-16T21:00:00.000Z';

async function harness() {
  const db = new NodeSqlDriver(':memory:');
  await migrate(db);
  const clock = new FakeClock(START);
  const uow = new SqlUnitOfWork(db);
  return { db, clock, uow, repos: uow.repositories, groups: new GroupUseCases(uow, clock) };
}

/** A pending reminder for `contact` in `group`, so cancellation can be observed. */
async function givenPendingReminder(
  h: Awaited<ReturnType<typeof harness>>,
  gid: ReturnType<typeof groupId>,
  cid: ReturnType<typeof contactReferenceId>,
  groupName: string
) {
  const schedule = await h.repos.schedules.create(
    {
      groupId: gid,
      peoplePerCycle: 1,
      cadence: 'weekly',
      intervalCount: 1,
      weekday: 0,
      monthDay: null,
      hour: 21,
      minute: 0,
      anchorAt: h.clock.now(),
      active: true,
    },
    h.clock.now()
  );
  return h.repos.reminders.createIfAbsent(
    {
      scheduleId: schedule.id,
      groupId: gid,
      groupNameSnapshot: groupName,
      contactReferenceId: cid,
      occurrenceAt: h.clock.now(),
      dueAt: h.clock.now(),
    },
    h.clock.now()
  );
}

describe('create', () => {
  it('creates and trims', async () => {
    const h = await harness();
    const result = await h.groups.create('  Family  ');
    expect(isOk(result)).toBe(true);
    expect(unwrap(result).name).toBe('Family');
    await h.db.close();
  });

  it.each([['', 'empty'], ['   ', 'whitespace only']])('rejects %p (%s)', async (name) => {
    const h = await harness();
    const result = await h.groups.create(name);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('INVALID_GROUP_NAME');
    await h.db.close();
  });

  it('rejects a name over 100 characters', async () => {
    const h = await harness();
    const result = await h.groups.create('x'.repeat(101));
    expect(isErr(result)).toBe(true);
    // Accepts exactly 100.
    expect(isOk(await h.groups.create('y'.repeat(100)))).toBe(true);
    await h.db.close();
  });

  it('allows two groups with the same name', async () => {
    // Not forbidden by the spec; the user may have their own reason.
    const h = await harness();
    expect(isOk(await h.groups.create('Friends'))).toBe(true);
    expect(isOk(await h.groups.create('Friends'))).toBe(true);
    expect(await h.groups.list()).toHaveLength(2);
    await h.db.close();
  });
});

describe('rename', () => {
  it('renames an existing group', async () => {
    const h = await harness();
    const g = unwrap(await h.groups.create('Family'));
    const renamed = await h.groups.rename(g.id, 'Close Family');
    expect(unwrap(renamed).name).toBe('Close Family');
    await h.db.close();
  });

  it('reports NOT_FOUND for a missing group', async () => {
    const h = await harness();
    const result = await h.groups.rename(groupId(999), 'Nope');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND');
    await h.db.close();
  });

  it('rejects an invalid new name', async () => {
    const h = await harness();
    const g = unwrap(await h.groups.create('Family'));
    expect(isErr(await h.groups.rename(g.id, '  '))).toBe(true);
    expect((await h.groups.get(g.id))?.name).toBe('Family');
    await h.db.close();
  });
});

describe('addMember', () => {
  it('adds a person to a group', async () => {
    const h = await harness();
    const g = unwrap(await h.groups.create('Family'));
    const m = await h.groups.addMember(g.id, {
      phoneE164: '+447700900123',
      displayName: 'Ahmed',
      nativeId: 'n-1',
    });
    expect(isOk(m)).toBe(true);
    expect(await h.groups.memberCount(g.id)).toBe(1);
    await h.db.close();
  });

  // docs/DOMAIN.md §2 rule 6 — one person, many groups.
  it('reuses the same person across groups instead of duplicating', async () => {
    const h = await harness();
    const family = unwrap(await h.groups.create('Family'));
    const friends = unwrap(await h.groups.create('Friends'));
    const person = { phoneE164: '+447700900123', displayName: 'Ahmed', nativeId: 'n-1' };

    const a = unwrap(await h.groups.addMember(family.id, person));
    const b = unwrap(await h.groups.addMember(friends.id, person));

    expect(b.contactReferenceId).toBe(a.contactReferenceId);
    expect(await h.repos.contacts.findAll()).toHaveLength(1);
    await h.db.close();
  });

  it('is idempotent within a group', async () => {
    const h = await harness();
    const g = unwrap(await h.groups.create('Family'));
    const person = { phoneE164: '+447700900123', displayName: 'Ahmed', nativeId: 'n-1' };
    const first = unwrap(await h.groups.addMember(g.id, person));
    const second = unwrap(await h.groups.addMember(g.id, person));
    expect(second.id).toBe(first.id);
    expect(await h.groups.memberCount(g.id)).toBe(1);
    await h.db.close();
  });

  it('accepts a null native id', async () => {
    const h = await harness();
    const g = unwrap(await h.groups.create('Family'));
    const m = await h.groups.addMember(g.id, {
      phoneE164: '+447700900123',
      displayName: 'Manual entry',
      nativeId: null,
    });
    expect(isOk(m)).toBe(true);
    await h.db.close();
  });

  it('rejects a missing group and an empty display name', async () => {
    const h = await harness();
    const g = unwrap(await h.groups.create('Family'));
    expect(
      isErr(
        await h.groups.addMember(groupId(999), {
          phoneE164: '+1',
          displayName: 'X',
          nativeId: null,
        })
      )
    ).toBe(true);
    expect(
      isErr(
        await h.groups.addMember(g.id, { phoneE164: '+1', displayName: '   ', nativeId: null })
      )
    ).toBe(true);
    await h.db.close();
  });

  it('reports every group a person belongs to', async () => {
    const h = await harness();
    const family = unwrap(await h.groups.create('Family'));
    const friends = unwrap(await h.groups.create('Friends'));
    const person = { phoneE164: '+447700900123', displayName: 'Ahmed', nativeId: 'n-1' };
    const m = unwrap(await h.groups.addMember(family.id, person));
    await h.groups.addMember(friends.id, person);

    const names = (await h.groups.groupsForContact(m.contactReferenceId)).map((g) => g.name).sort();
    expect(names).toEqual(['Family', 'Friends']);
    await h.db.close();
  });
});

describe('delete group', () => {
  it('cancels unresolved reminders and reports how many', async () => {
    const h = await harness();
    const g = unwrap(await h.groups.create('Family'));
    const m = unwrap(
      await h.groups.addMember(g.id, {
        phoneE164: '+447700900123',
        displayName: 'Ahmed',
        nativeId: 'n-1',
      })
    );
    const reminder = await givenPendingReminder(h, g.id, m.contactReferenceId, 'Family');

    const outcome = unwrap(await h.groups.delete(g.id));
    expect(outcome.cancelledReminders).toBe(1);

    const after = await h.repos.reminders.findById(reminder!.id);
    expect(after?.state).toBe('cancelled');
    expect(after?.cancelReason).toBe('group_deleted');
    await h.db.close();
  });

  // Cancellation is not completion — it must not create a contact event.
  it('does not record contact history when cancelling', async () => {
    const h = await harness();
    const g = unwrap(await h.groups.create('Family'));
    const m = unwrap(
      await h.groups.addMember(g.id, {
        phoneE164: '+447700900123',
        displayName: 'Ahmed',
        nativeId: 'n-1',
      })
    );
    await givenPendingReminder(h, g.id, m.contactReferenceId, 'Family');
    await h.groups.delete(g.id);
    expect(await h.repos.events.lastContactedAt(m.contactReferenceId)).toBeNull();
    await h.db.close();
  });

  it('preserves resolved history and the person', async () => {
    const h = await harness();
    const g = unwrap(await h.groups.create('Family'));
    const m = unwrap(
      await h.groups.addMember(g.id, {
        phoneE164: '+447700900123',
        displayName: 'Ahmed',
        nativeId: 'n-1',
      })
    );
    const reminder = await givenPendingReminder(h, g.id, m.contactReferenceId, 'Family');
    await h.repos.reminders.resolve(reminder!.id, 'completed', h.clock.now());
    await h.repos.events.record(
      {
        contactReferenceId: m.contactReferenceId,
        occurredAt: h.clock.now(),
        source: 'reminder_completion',
        relatedReminderId: reminder!.id,
      },
      h.clock.now()
    );

    await h.groups.delete(g.id);

    const survived = await h.repos.reminders.findById(reminder!.id);
    expect(survived?.state).toBe('completed');
    expect(survived?.groupNameSnapshot).toBe('Family');
    expect(await h.repos.contacts.findById(m.contactReferenceId)).not.toBeNull();
    expect(await h.repos.events.lastContactedAt(m.contactReferenceId)).not.toBeNull();
    await h.db.close();
  });

  it("leaves the person's other groups alone", async () => {
    const h = await harness();
    const family = unwrap(await h.groups.create('Family'));
    const friends = unwrap(await h.groups.create('Friends'));
    const person = { phoneE164: '+447700900123', displayName: 'Ahmed', nativeId: 'n-1' };
    const m = unwrap(await h.groups.addMember(family.id, person));
    await h.groups.addMember(friends.id, person);

    await h.groups.delete(family.id);

    expect(await h.groups.get(friends.id)).not.toBeNull();
    expect(await h.groups.memberCount(friends.id)).toBe(1);
    expect(await h.groups.groupsForContact(m.contactReferenceId)).toHaveLength(1);
    await h.db.close();
  });

  it('reports NOT_FOUND for a missing group', async () => {
    const h = await harness();
    const result = await h.groups.delete(groupId(999));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND');
    await h.db.close();
  });

  it('deleting an empty group cancels nothing', async () => {
    const h = await harness();
    const g = unwrap(await h.groups.create('Empty'));
    expect(unwrap(await h.groups.delete(g.id)).cancelledReminders).toBe(0);
    await h.db.close();
  });
});

describe('removeMember', () => {
  it('cancels only that membership and only in that group', async () => {
    const h = await harness();
    const family = unwrap(await h.groups.create('Family'));
    const friends = unwrap(await h.groups.create('Friends'));
    const person = { phoneE164: '+447700900123', displayName: 'Ahmed', nativeId: 'n-1' };
    const m = unwrap(await h.groups.addMember(family.id, person));
    await h.groups.addMember(friends.id, person);

    const familyReminder = await givenPendingReminder(h, family.id, m.contactReferenceId, 'Family');
    const friendsReminder = await givenPendingReminder(
      h,
      friends.id,
      m.contactReferenceId,
      'Friends'
    );

    const outcome = unwrap(await h.groups.removeMember(family.id, m.contactReferenceId));
    expect(outcome.cancelledReminders).toBe(1);

    expect((await h.repos.reminders.findById(familyReminder!.id))?.state).toBe('cancelled');
    expect((await h.repos.reminders.findById(friendsReminder!.id))?.state).toBe('pending');
    await h.db.close();
  });

  it('keeps the person, their history and their other memberships', async () => {
    const h = await harness();
    const family = unwrap(await h.groups.create('Family'));
    const friends = unwrap(await h.groups.create('Friends'));
    const person = { phoneE164: '+447700900123', displayName: 'Ahmed', nativeId: 'n-1' };
    const m = unwrap(await h.groups.addMember(family.id, person));
    await h.groups.addMember(friends.id, person);
    await h.repos.events.record(
      {
        contactReferenceId: m.contactReferenceId,
        occurredAt: h.clock.now(),
        source: 'manual_log',
        relatedReminderId: null,
      },
      h.clock.now()
    );

    await h.groups.removeMember(family.id, m.contactReferenceId);

    expect(await h.groups.memberCount(family.id)).toBe(0);
    expect(await h.groups.memberCount(friends.id)).toBe(1);
    expect(await h.repos.contacts.findById(m.contactReferenceId)).not.toBeNull();
    expect(await h.repos.events.lastContactedAt(m.contactReferenceId)).not.toBeNull();
    await h.db.close();
  });

  it('reports MEMBERSHIP_NOT_FOUND when the person is not in the group', async () => {
    const h = await harness();
    const g = unwrap(await h.groups.create('Family'));
    const result = await h.groups.removeMember(g.id, contactReferenceId(999));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('MEMBERSHIP_NOT_FOUND');
    await h.db.close();
  });

  it('deactivating keeps the membership row', async () => {
    const h = await harness();
    const g = unwrap(await h.groups.create('Family'));
    const m = unwrap(
      await h.groups.addMember(g.id, {
        phoneE164: '+447700900123',
        displayName: 'Ahmed',
        nativeId: 'n-1',
      })
    );
    await h.groups.setMemberActive(m.id, false);
    expect(await h.groups.memberCount(g.id)).toBe(1);
    expect(await h.groups.memberCount(g.id, true)).toBe(0);
    await h.db.close();
  });
});
