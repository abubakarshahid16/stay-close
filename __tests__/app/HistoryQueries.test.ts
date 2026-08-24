/**
 * History query tests (issues 018 / #29, 040 / #51, 041 / #52, 042 / #53).
 *
 * The point of these is that history is *durable* and metrics are *derived*.
 * The important cases prove history survives destructive edits and that the
 * figures still add up afterwards — a stored counter would drift here and
 * nothing would say so.
 */
import { NodeSqlDriver } from '../../src/testing/NodeSqlDriver';
import { FakeClock } from '../../src/testing/FakeClock';
import { migrate } from '../../src/adapters/persistence/Database';
import { SqlUnitOfWork } from '../../src/adapters/persistence/SqlRepositories';
import { SeededRandom } from '../../src/adapters/system/SeededRandom';
import { GroupUseCases } from '../../src/app/groups/GroupUseCases';
import { ScheduleUseCases } from '../../src/app/schedules/ScheduleUseCases';
import { RunScheduler } from '../../src/app/scheduler/RunScheduler';
import { ReminderUseCases } from '../../src/app/reminders/ReminderUseCases';
import { HistoryQueries } from '../../src/app/history/HistoryQueries';
import { unwrap } from '../../src/domain/shared/Result';

const START = '2026-08-16T00:00:00.000Z';

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
    history: new HistoryQueries(uow, clock),
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

/** A daily-cadence group, so cycles are easy to advance through. */
async function givenActiveGroup(h: Harness, members = 5) {
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
      cadence: 'daily',
      intervalCount: 1,
      weekday: null,
      monthDay: null,
      hour: 9,
      minute: 0,
    })
  );
  return { group, schedule };
}

/**
 * Advance `days`, run the scheduler, resolve whatever came up, and report how
 * many were resolved.
 *
 * Returns the count rather than letting callers assume one per day: the
 * schedule anchors at creation time, so the first pass also sweeps up the
 * anchor day's cycle. Asserting against the returned number keeps these tests
 * about the metrics rather than about this helper's arithmetic.
 *
 * Advances from wherever the clock currently is, so successive calls continue
 * forward in time. Computing from START would rewind the clock on a second
 * call, and nothing would be due.
 */
async function runDays(
  h: Harness,
  days: number,
  action: 'complete' | 'skip' = 'complete'
): Promise<number> {
  let resolved = 0;
  for (let day = 1; day <= days; day++) {
    const next = new Date(h.clock.now() + 86_400_000);
    next.setUTCHours(10, 0, 0, 0);
    h.clock.set(next.toISOString());
    await h.scheduler.run();
    for (const reminder of await h.repos.reminders.findPending()) {
      if (action === 'complete') await h.reminders.complete(reminder.id);
      else await h.reminders.skip(reminder.id);
      resolved++;
    }
  }
  return resolved;
}

describe('reminder history', () => {
  it('records every reminder ever raised for a person', async () => {
    const h = await harness();
    await givenActiveGroup(h, 2);
    await runDays(h, 6);

    const all = await h.repos.reminders.findAll();
    expect(all.length).toBeGreaterThanOrEqual(6);

    const someone = all[0].contactReferenceId;
    const theirs = await h.history.remindersForContact(someone);
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every((r) => r.contactReferenceId === someone)).toBe(true);
    await h.db.close();
  });

  // docs/DOMAIN.md §3 — history outlives the group it came from.
  it('survives deleting the group', async () => {
    const h = await harness();
    const { group } = await givenActiveGroup(h, 2);
    await runDays(h, 4);

    const before = (await h.repos.reminders.findAll()).length;
    await h.groups.delete(group.id);

    const after = await h.repos.reminders.findAll();
    expect(after).toHaveLength(before);
    // Still readable, even though the group link is gone.
    expect(after.every((r) => r.groupNameSnapshot === 'Family')).toBe(true);
    expect(after.every((r) => r.groupId === null)).toBe(true);
    await h.db.close();
  });

  it('keeps reminder history and contact history distinct', async () => {
    const h = await harness();
    await givenActiveGroup(h, 2);
    await runDays(h, 3, 'skip');

    // Skips produce reminder history but no contact history (§10).
    expect((await h.repos.reminders.findAll()).length).toBeGreaterThan(0);
    expect(await h.repos.events.findAll()).toHaveLength(0);
    await h.db.close();
  });

  it('builds a timeline that labels each entry kind', async () => {
    const h = await harness();
    await givenActiveGroup(h, 1);
    await runDays(h, 2);

    const contact = (await h.repos.contacts.findAll())[0];
    const timeline = await h.history.timelineForContact(contact.id);

    expect(timeline.some((entry) => entry.kind === 'reminder')).toBe(true);
    expect(timeline.some((entry) => entry.kind === 'contact')).toBe(true);
    // Newest first.
    const times = timeline.map((entry) => entry.at);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    await h.db.close();
  });
});

describe('activity queries', () => {
  it('classifies pending reminders as due, overdue or snoozed', async () => {
    const h = await harness();
    await givenActiveGroup(h, 5);

    h.clock.set('2026-08-17T10:00:00.000Z');
    await h.scheduler.run();
    const first = (await h.repos.reminders.findPending())[0];
    await h.reminders.snooze(first.id, 'three_hours');

    // Let more cycles pile up unresolved so some age into overdue.
    h.clock.set('2026-08-22T10:00:00.000Z');
    await h.scheduler.run();

    const buckets = await h.history.pendingByClassification();
    expect(buckets.overdue.length + buckets.due.length + buckets.snoozed.length).toBe(
      (await h.repos.reminders.findPending()).length
    );
    expect(buckets.overdue.length).toBeGreaterThan(0);
    await h.db.close();
  });

  it('lists never-contacted people', async () => {
    const h = await harness();
    await givenActiveGroup(h, 5);
    expect(await h.history.neverContactedPeople()).toHaveLength(5);

    const resolved = await runDays(h, 2);
    expect((await h.history.neverContactedPeople()).length).toBe(5 - resolved);
    await h.db.close();
  });

  it('lists people not contacted within a window', async () => {
    const h = await harness();
    await givenActiveGroup(h, 3);
    await runDays(h, 3);

    // Everyone contacted in the last few days.
    expect(await h.history.notContactedInDays(30)).toHaveLength(0);

    // Months later, all three are stale again.
    h.clock.set('2026-12-01T10:00:00.000Z');
    expect(await h.history.notContactedInDays(30)).toHaveLength(3);
    await h.db.close();
  });

  it('reports recency for one person', async () => {
    const h = await harness();
    await givenActiveGroup(h, 1);

    const contact = (await h.repos.contacts.findAll())[0];
    expect((await h.history.recencyFor(contact.id)).neverContacted).toBe(true);

    await runDays(h, 1);
    const after = await h.history.recencyFor(contact.id);
    expect(after.neverContacted).toBe(false);
    expect(after.daysSinceContact).toBe(0);
    await h.db.close();
  });

  it('reports an average interval once there are two contacts', async () => {
    const h = await harness();
    await givenActiveGroup(h, 1);

    await runDays(h, 1);
    const contact = (await h.repos.contacts.findAll())[0];
    // A single contact establishes no interval.
    expect(await h.history.averageIntervalDaysFor(contact.id)).toBeNull();

    await runDays(h, 2);
    expect(await h.history.averageIntervalDaysFor(contact.id)).not.toBeNull();
    await h.db.close();
  });

  it('summarises recent activity', async () => {
    const h = await harness();
    await givenActiveGroup(h, 5);
    const resolved = await runDays(h, 4);

    const week = await h.history.activityInLastDays(7);
    expect(week.contactsCompleted).toBe(resolved);
    // One reminder per person, so distinct people equals contacts made.
    expect(week.distinctPeopleContacted).toBe(resolved);
    await h.db.close();
  });
});

describe('metrics', () => {
  it('reports counts across states', async () => {
    const h = await harness();
    await givenActiveGroup(h, 5);
    const resolved = await runDays(h, 3);

    const counts = await h.history.reminderCounts();
    expect(counts.completed).toBe(resolved);
    expect(counts.total).toBe(resolved);
    expect(counts.pending).toBe(0);
    await h.db.close();
  });

  it('is 100% when everything is completed and 0% when everything is skipped', async () => {
    const completing = await harness();
    await givenActiveGroup(completing, 4);
    await runDays(completing, 3);
    expect(await completing.history.overallCompletionRate()).toBe(1);
    await completing.db.close();

    const skipping = await harness();
    await givenActiveGroup(skipping, 4);
    await runDays(skipping, 3, 'skip');
    expect(await skipping.history.overallCompletionRate()).toBe(0);
    await skipping.db.close();
  });

  // "No data" must be distinguishable from 0%.
  it('is null before anything is resolved', async () => {
    const h = await harness();
    await givenActiveGroup(h, 3);
    expect(await h.history.overallCompletionRate()).toBeNull();
    await h.db.close();
  });

  it('tracks streaks and breaks them on a skip', async () => {
    const h = await harness();
    await givenActiveGroup(h, 6);
    const completed = await runDays(h, 3);
    expect(await h.history.streaks()).toEqual({ current: completed, longest: completed });

    await runDays(h, 1, 'skip');
    const afterSkip = await h.history.streaks();
    // A skip resets the current run but never lowers the record.
    expect(afterSkip.current).toBe(0);
    expect(afterSkip.longest).toBe(completed);
    await h.db.close();
  });

  it('reports a completion rate per group', async () => {
    const h = await harness();
    const { group } = await givenActiveGroup(h, 4);
    await runDays(h, 2);

    const rates = await h.history.completionRatePerGroup();
    expect(rates.get(group.id)).toBe(1);
    await h.db.close();
  });

  it('assembles a full scorecard', async () => {
    const h = await harness();
    await givenActiveGroup(h, 6);
    const resolved = await runDays(h, 4);

    const card = await h.history.scorecard();
    expect(card.peopleTotal).toBe(6);
    expect(card.reminders.completed).toBe(resolved);
    expect(card.completionRate).toBe(1);
    expect(card.streaks.current).toBe(resolved);
    expect(card.peopleNeverContacted).toBe(6 - resolved);
    await h.db.close();
  });

  it('is safe on a brand-new install', async () => {
    const h = await harness();
    const card = await h.history.scorecard();
    expect(card).toMatchObject({
      completionRate: null,
      peopleTotal: 0,
      peopleNeverContacted: 0,
    });
    expect(card.streaks).toEqual({ current: 0, longest: 0 });
    await h.db.close();
  });

  // The reason metrics are derived rather than stored: a counter would drift
  // here, and the drift would be invisible.
  it('stays consistent after a group is deleted', async () => {
    const h = await harness();
    const { group } = await givenActiveGroup(h, 4);
    await runDays(h, 3);

    const before = await h.history.reminderCounts();
    await h.groups.delete(group.id);
    const after = await h.history.reminderCounts();

    expect(after.total).toBe(before.total);
    expect(after.completed).toBe(before.completed);
    // Attribution to a group is gone, but the history itself is not.
    expect((await h.history.completionRatePerGroup()).size).toBe(0);
    await h.db.close();
  });
});
