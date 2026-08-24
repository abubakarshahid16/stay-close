/**
 * Reminder resolution tests (issues 026 / #37, 027 / #38, 028 / #39, 029 / #40).
 *
 * The load-bearing assertions here are about what each resolution does NOT do.
 * Only completion may write contact history (docs/DOMAIN.md §9); skip, snooze,
 * deprioritize and cancel must leave recency untouched, or the rotation
 * weighting silently drifts.
 */
import { NodeSqlDriver } from '../../src/testing/NodeSqlDriver';
import { FakeClock } from '../../src/testing/FakeClock';
import { migrate } from '../../src/adapters/persistence/Database';
import { SqlUnitOfWork } from '../../src/adapters/persistence/SqlRepositories';
import { SeededRandom } from '../../src/adapters/system/SeededRandom';
import { GroupUseCases } from '../../src/usecases/groups/GroupUseCases';
import { ScheduleUseCases } from '../../src/usecases/schedules/ScheduleUseCases';
import { RunScheduler } from '../../src/usecases/scheduler/RunScheduler';
import { ReminderUseCases, SKIP_PENALTY_MS } from '../../src/usecases/reminders/ReminderUseCases';
import { isErr, unwrap } from '../../src/domain/shared/Result';
import { reminderId } from '../../src/domain/shared/ids';

const START = '2026-08-16T00:00:00.000Z';
const AFTER_CYCLE = '2026-08-16T22:00:00.000Z';

async function harness() {
  const db = new NodeSqlDriver(':memory:');
  await migrate(db);
  const clock = new FakeClock(START, 'UTC');
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

/** A group with `members` people, one weekly cycle already generated. */
async function givenOnePendingReminder(h: Harness, members = 4) {
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
  h.clock.set(AFTER_CYCLE);
  await h.scheduler.run();

  const pending = await h.repos.reminders.findPending();
  expect(pending).toHaveLength(1);
  return { group, schedule, reminder: pending[0] };
}

describe('complete', () => {
  it('resolves the reminder and records contact history', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);

    const result = unwrap(await h.reminders.complete(reminder.id));

    expect(result.state).toBe('completed');
    expect(result.resolvedAt).not.toBeNull();
    const events = await h.repos.events.findByContact(reminder.contactReferenceId);
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('reminder_completion');
    expect(events[0].relatedReminderId).toBe(reminder.id);
    await h.db.close();
  });

  it('updates last-contacted so future rotation sees it', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    expect(await h.repos.events.lastContactedAt(reminder.contactReferenceId)).toBeNull();

    await h.reminders.complete(reminder.id);

    expect(await h.repos.events.lastContactedAt(reminder.contactReferenceId)).not.toBeNull();
    await h.db.close();
  });

  // docs/DOMAIN.md §10.1 — history belongs to the person, not the group.
  it('makes the contact visible to a second group the person belongs to', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    const person = await h.repos.contacts.findById(reminder.contactReferenceId);

    const friends = unwrap(await h.groups.create('Friends'));
    await h.groups.addMember(friends.id, {
      phoneE164: person!.phoneE164,
      displayName: person!.displayNameCache,
      nativeId: person!.nativeId,
    });

    await h.reminders.complete(reminder.id);

    // Read without any group filter, as rotation does.
    expect(await h.repos.events.lastContactedAt(reminder.contactReferenceId)).not.toBeNull();
    await h.db.close();
  });

  // Completion is final for the occurrence (§8.2).
  it('rejects a second completion', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    await h.reminders.complete(reminder.id);

    const second = await h.reminders.complete(reminder.id);
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.code).toBe('REMINDER_ALREADY_RESOLVED');
    // No duplicate history written.
    expect(await h.repos.events.findByContact(reminder.contactReferenceId)).toHaveLength(1);
    await h.db.close();
  });

  it('rejects completing an already-skipped reminder', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    await h.reminders.skip(reminder.id);
    expect(isErr(await h.reminders.complete(reminder.id))).toBe(true);
    await h.db.close();
  });

  it('reports NOT_FOUND for a missing reminder', async () => {
    const h = await harness();
    expect(isErr(await h.reminders.complete(reminderId(999)))).toBe(true);
    await h.db.close();
  });

  it('clears the global pending exclusion', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    expect(await h.repos.reminders.hasPendingForContact(reminder.contactReferenceId)).toBe(true);

    await h.reminders.complete(reminder.id);

    expect(await h.repos.reminders.hasPendingForContact(reminder.contactReferenceId)).toBe(false);
    await h.db.close();
  });
});

describe('skip', () => {
  it('resolves the occurrence and applies a decaying penalty', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);

    const result = unwrap(await h.reminders.skip(reminder.id));

    expect(result.state).toBe('skipped');
    const priority = await h.repos.priorities.find(reminder.contactReferenceId);
    expect(priority?.skipCount).toBe(1);
    expect(priority?.skipPenaltyUntil).toBe(h.clock.now() + SKIP_PENALTY_MS);
    // Not a deprioritization — the two are distinct states (§7.2, §7.3).
    expect(priority?.deprioritizedAt).toBeNull();
    await h.db.close();
  });

  // The critical negative: a skip must not look like contact.
  it('writes no contact history', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    await h.reminders.skip(reminder.id);
    expect(await h.repos.events.lastContactedAt(reminder.contactReferenceId)).toBeNull();
    await h.db.close();
  });

  it('leaves the person in the group', async () => {
    const h = await harness();
    const { group, reminder } = await givenOnePendingReminder(h);
    await h.reminders.skip(reminder.id);
    expect(await h.groups.memberCount(group.id)).toBe(4);
    expect(await h.repos.contacts.findById(reminder.contactReferenceId)).not.toBeNull();
    await h.db.close();
  });

  it('accumulates on repeated skips of the same person', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    await h.reminders.skip(reminder.id);

    // A later cycle picks someone; skip the same person again directly.
    await h.repos.priorities.applySkipPenalty(
      reminder.contactReferenceId,
      h.clock.now(),
      h.clock.now()
    );
    expect((await h.repos.priorities.find(reminder.contactReferenceId))?.skipCount).toBe(2);
    await h.db.close();
  });
});

describe('deprioritize', () => {
  it('resolves the occurrence and sets an indefinite marker', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);

    const result = unwrap(await h.reminders.deprioritize(reminder.id));

    expect(result.state).toBe('deprioritized');
    const priority = await h.repos.priorities.find(reminder.contactReferenceId);
    expect(priority?.deprioritizedAt).not.toBeNull();
    await h.db.close();
  });

  it('writes no contact history', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    await h.reminders.deprioritize(reminder.id);
    expect(await h.repos.events.lastContactedAt(reminder.contactReferenceId)).toBeNull();
    await h.db.close();
  });

  // §7.3 — never a deletion.
  it('keeps the person, the membership and all history', async () => {
    const h = await harness();
    const { group, reminder } = await givenOnePendingReminder(h);
    await h.reminders.deprioritize(reminder.id);

    expect(await h.repos.contacts.findById(reminder.contactReferenceId)).not.toBeNull();
    expect(await h.groups.memberCount(group.id)).toBe(4);
    expect(await h.repos.reminders.findById(reminder.id)).not.toBeNull();
    await h.db.close();
  });

  it('reactivation is explicit and clears the marker', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    await h.reminders.deprioritize(reminder.id);

    unwrap(await h.reminders.reactivate(reminder.id));

    expect((await h.repos.priorities.find(reminder.contactReferenceId))?.deprioritizedAt).toBeNull();
    await h.db.close();
  });
});

describe('snooze', () => {
  it('keeps the reminder pending and moves its due time', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);

    const result = unwrap(await h.reminders.snooze(reminder.id, 'one_hour'));

    expect(result.state).toBe('pending');
    expect(result.snoozedUntil).toBe(h.clock.now() + 3_600_000);
    expect(result.dueAt).toBe(result.snoozedUntil);
    await h.db.close();
  });

  // §8.5 — never a second reminder.
  it('creates no duplicate', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    await h.reminders.snooze(reminder.id, 'three_hours');
    await h.reminders.snooze(reminder.id, 'one_hour');

    expect(await h.repos.reminders.findByContact(reminder.contactReferenceId)).toHaveLength(1);
    await h.db.close();
  });

  it('writes no contact history', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    await h.reminders.snooze(reminder.id, 'one_hour');
    expect(await h.repos.events.lastContactedAt(reminder.contactReferenceId)).toBeNull();
    await h.db.close();
  });

  it('leaves the group schedule untouched', async () => {
    const h = await harness();
    const { schedule, reminder } = await givenOnePendingReminder(h);
    const before = await h.repos.schedules.findById(schedule.id);
    await h.reminders.snooze(reminder.id, 'tomorrow');
    expect(await h.repos.schedules.findById(schedule.id)).toEqual(before);
    await h.db.close();
  });

  // The spec bug I found and fixed: relative snooze is measured from now, so a
  // long-overdue reminder still lands in the future.
  it('moves a badly overdue reminder into the future', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    h.clock.set('2026-09-30T12:00:00.000Z'); // six weeks late

    const result = unwrap(await h.reminders.snooze(reminder.id, 'thirty_minutes'));

    expect(result.snoozedUntil).toBeGreaterThan(h.clock.now());
    await h.db.close();
  });

  it('keeps a snoozed reminder out of actionable work until it lapses', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    await h.reminders.snooze(reminder.id, 'three_hours');

    const stillSnoozed = await h.reminders.listPending();
    expect(stillSnoozed[0].classification).toBe('snoozed');

    h.clock.advance(4 * 3_600_000);
    const lapsed = await h.reminders.listPending();
    expect(lapsed[0].classification).toBe('due');
    await h.db.close();
  });

  it('offers all five options with an active schedule', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    expect(unwrap(await h.reminders.snoozeOptionsFor(reminder.id))).toHaveLength(5);
    await h.db.close();
  });

  it('hides next_occurrence once the schedule is deleted', async () => {
    const h = await harness();
    const { schedule, reminder } = await givenOnePendingReminder(h);
    // Deleting the schedule cancels the reminder, so use a fresh pending one.
    await h.repos.schedules.delete(schedule.id);

    const options = await h.reminders.snoozeOptionsFor(reminder.id);
    expect(unwrap(options)).not.toContain('next_occurrence');
    await h.db.close();
  });

  it('rejects snoozing a resolved reminder', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    await h.reminders.complete(reminder.id);
    expect(isErr(await h.reminders.snooze(reminder.id, 'one_hour'))).toBe(true);
    await h.db.close();
  });
});

describe('listPending', () => {
  it('shows the person behind each reminder', async () => {
    const h = await harness();
    await givenOnePendingReminder(h);
    const views = await h.reminders.listPending();
    expect(views).toHaveLength(1);
    expect(views[0].displayName).toMatch(/^Person \d$/);
    expect(views[0].phoneE164).toMatch(/^\+44/);
    await h.db.close();
  });

  it('excludes resolved reminders', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    await h.reminders.complete(reminder.id);
    expect(await h.reminders.listPending()).toHaveLength(0);
    await h.db.close();
  });

  it('orders overdue before due', async () => {
    const h = await harness();
    await givenOnePendingReminder(h, 10);
    // Generate several more weekly cycles so a spread of ages exists.
    h.clock.set('2026-09-13T22:00:00.000Z');
    await h.scheduler.run();

    const views = await h.reminders.listPending();
    expect(views.length).toBeGreaterThan(1);

    const ranks = views.map((v) => (v.classification === 'overdue' ? 0 : 1));
    expect([...ranks].sort()).toEqual(ranks); // non-decreasing
    await h.db.close();
  });

  // docs/DOMAIN.md §8.3 — a missed notification never destroys the task.
  it('still lists a reminder that was never acted on', async () => {
    const h = await harness();
    await givenOnePendingReminder(h);
    h.clock.set('2026-10-30T12:00:00.000Z'); // months later

    const views = await h.reminders.listPending();
    expect(views).toHaveLength(1);
    expect(views[0].classification).toBe('overdue');
    await h.db.close();
  });

  it('still lists a reminder whose contact has gone unavailable', async () => {
    const h = await harness();
    const { reminder } = await givenOnePendingReminder(h);
    await h.repos.contacts.setAvailability(
      reminder.contactReferenceId,
      'unavailable',
      h.clock.now()
    );

    const views = await h.reminders.listPending();
    expect(views).toHaveLength(1);
    await h.db.close();
  });
});
