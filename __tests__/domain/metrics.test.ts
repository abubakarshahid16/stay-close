/**
 * Derived metrics tests (issues 041 / #52, 042 / #53).
 *
 * Several of these pin down *judgement calls* rather than arithmetic — whether
 * a cancellation counts against the user, whether "no data" is distinguishable
 * from zero. Those are the parts a later change is most likely to get wrong.
 */
import {
  activitySince,
  averageContactIntervalDays,
  buildScorecard,
  completionRate,
  completionRateByGroup,
  completionStreaks,
  countReminders,
  neverContacted,
  notRecentlyContacted,
  summariseRecency,
} from '../../src/domain/metrics/metrics';
import { OVERDUE_AFTER_MS } from '../../src/domain/reminder/stateMachine';
import type { ContactEvent, ReminderInstance } from '../../src/domain/entities';
import {
  contactEventId,
  contactReferenceId,
  groupId,
  instant,
  instantFromISO,
  reminderId,
  scheduleId,
  type ContactReferenceId,
  type Instant,
} from '../../src/domain/shared/ids';

const NOW = instantFromISO('2026-08-16T21:00:00.000Z');
const DAY = 86_400_000;

const daysAgo = (n: number): Instant => instant(NOW - n * DAY);
const cid = (n: number): ContactReferenceId => contactReferenceId(n);

let nextId = 1;

function reminder(overrides: Partial<ReminderInstance> = {}): ReminderInstance {
  return {
    id: reminderId(nextId++),
    scheduleId: scheduleId(1),
    groupId: groupId(1),
    groupNameSnapshot: 'Family',
    contactReferenceId: cid(1),
    occurrenceAt: NOW,
    dueAt: NOW,
    state: 'pending',
    snoozedUntil: null,
    resolvedAt: null,
    cancelReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

let nextEventId = 1;

function event(overrides: Partial<ContactEvent> = {}): ContactEvent {
  return {
    id: contactEventId(nextEventId++),
    contactReferenceId: cid(1),
    occurredAt: NOW,
    source: 'reminder_completion',
    relatedReminderId: null,
    createdAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  nextId = 1;
  nextEventId = 1;
});

describe('countReminders', () => {
  it('counts every state', () => {
    const counts = countReminders(
      [
        reminder({ state: 'pending', dueAt: NOW }),
        reminder({ state: 'completed', resolvedAt: NOW }),
        reminder({ state: 'completed', resolvedAt: NOW }),
        reminder({ state: 'skipped', resolvedAt: NOW }),
        reminder({ state: 'deprioritized', resolvedAt: NOW }),
        reminder({ state: 'cancelled', resolvedAt: NOW }),
      ],
      NOW
    );
    expect(counts).toMatchObject({
      total: 6,
      pending: 1,
      completed: 2,
      skipped: 1,
      deprioritized: 1,
      cancelled: 1,
    });
  });

  // overdue and snoozed are derived from elapsed time, not stored.
  it('derives due, overdue and snoozed from the clock', () => {
    const counts = countReminders(
      [
        reminder({ dueAt: NOW }),
        reminder({ dueAt: instant(NOW - 3 * OVERDUE_AFTER_MS) }),
        reminder({ dueAt: daysAgo(-1), snoozedUntil: daysAgo(-1) }),
      ],
      NOW
    );
    expect(counts.due).toBe(1);
    expect(counts.overdue).toBe(1);
    expect(counts.snoozed).toBe(1);
  });

  it('handles an empty history', () => {
    expect(countReminders([], NOW)).toMatchObject({ total: 0, pending: 0, overdue: 0 });
  });
});

describe('completionRate', () => {
  // "No data" and "0%" are different statements; showing 0% to a new user lies.
  it('is null with nothing resolved', () => {
    expect(completionRate([])).toBeNull();
    expect(completionRate([reminder({ state: 'pending' })])).toBeNull();
  });

  it('is the share of answered reminders that were completed', () => {
    const rate = completionRate([
      reminder({ state: 'completed', resolvedAt: NOW }),
      reminder({ state: 'completed', resolvedAt: NOW }),
      reminder({ state: 'skipped', resolvedAt: NOW }),
      reminder({ state: 'deprioritized', resolvedAt: NOW }),
    ]);
    expect(rate).toBe(0.5);
  });

  // docs/DOMAIN.md §8.4 — the app withdrew the request; the user never declined.
  it('excludes cancellations from the denominator', () => {
    const rate = completionRate([
      reminder({ state: 'completed', resolvedAt: NOW }),
      reminder({ state: 'cancelled', resolvedAt: NOW }),
      reminder({ state: 'cancelled', resolvedAt: NOW }),
    ]);
    expect(rate).toBe(1);
  });

  it('is null when only cancellations exist', () => {
    expect(completionRate([reminder({ state: 'cancelled', resolvedAt: NOW })])).toBeNull();
  });

  it('excludes pending from the denominator', () => {
    const rate = completionRate([
      reminder({ state: 'completed', resolvedAt: NOW }),
      reminder({ state: 'pending' }),
      reminder({ state: 'pending' }),
    ]);
    expect(rate).toBe(1);
  });
});

describe('completionRateByGroup', () => {
  it('reports a rate per group', () => {
    const rates = completionRateByGroup([
      reminder({ groupId: groupId(1), state: 'completed', resolvedAt: NOW }),
      reminder({ groupId: groupId(1), state: 'skipped', resolvedAt: NOW }),
      reminder({ groupId: groupId(2), state: 'completed', resolvedAt: NOW }),
    ]);
    expect(rates.get(groupId(1))).toBe(0.5);
    expect(rates.get(groupId(2))).toBe(1);
  });

  // History outlives its group, but cannot be attributed to one any more.
  it('omits reminders whose group was deleted', () => {
    const rates = completionRateByGroup([
      reminder({ groupId: null, state: 'completed', resolvedAt: NOW }),
      reminder({ groupId: groupId(1), state: 'completed', resolvedAt: NOW }),
    ]);
    expect(rates.size).toBe(1);
    expect(rates.has(groupId(1))).toBe(true);
  });
});

describe('completionStreaks', () => {
  const at = (n: number) => ({ resolvedAt: daysAgo(n) });

  it('is zero with no history', () => {
    expect(completionStreaks([])).toEqual({ current: 0, longest: 0 });
  });

  it('counts consecutive completions', () => {
    const streaks = completionStreaks([
      reminder({ state: 'completed', ...at(3) }),
      reminder({ state: 'completed', ...at(2) }),
      reminder({ state: 'completed', ...at(1) }),
    ]);
    expect(streaks).toEqual({ current: 3, longest: 3 });
  });

  it('breaks the current streak on a skip', () => {
    const streaks = completionStreaks([
      reminder({ state: 'completed', ...at(4) }),
      reminder({ state: 'completed', ...at(3) }),
      reminder({ state: 'skipped', ...at(2) }),
      reminder({ state: 'completed', ...at(1) }),
    ]);
    expect(streaks.current).toBe(1);
    expect(streaks.longest).toBe(2);
  });

  it('breaks the streak on a deprioritization too', () => {
    const streaks = completionStreaks([
      reminder({ state: 'completed', ...at(3) }),
      reminder({ state: 'deprioritized', ...at(2) }),
    ]);
    expect(streaks.current).toBe(0);
    expect(streaks.longest).toBe(1);
  });

  // Consistent with completionRate: a withdrawn request is not a failure.
  it('ignores cancellations entirely', () => {
    const streaks = completionStreaks([
      reminder({ state: 'completed', ...at(3) }),
      reminder({ state: 'cancelled', ...at(2) }),
      reminder({ state: 'completed', ...at(1) }),
    ]);
    expect(streaks).toEqual({ current: 2, longest: 2 });
  });

  it('orders by resolution time, not array order', () => {
    const streaks = completionStreaks([
      reminder({ state: 'completed', ...at(1) }),
      reminder({ state: 'skipped', ...at(3) }),
      reminder({ state: 'completed', ...at(2) }),
    ]);
    // Chronologically: skipped, completed, completed.
    expect(streaks).toEqual({ current: 2, longest: 2 });
  });

  it('ignores unresolved reminders', () => {
    const streaks = completionStreaks([
      reminder({ state: 'completed', ...at(1) }),
      reminder({ state: 'pending' }),
    ]);
    expect(streaks).toEqual({ current: 1, longest: 1 });
  });
});

describe('summariseRecency', () => {
  it('reports never contacted', () => {
    expect(summariseRecency(cid(1), [], NOW)).toEqual({
      contactReferenceId: cid(1),
      lastContactedAt: null,
      daysSinceContact: null,
      neverContacted: true,
    });
  });

  it('uses the most recent event', () => {
    const summary = summariseRecency(
      cid(1),
      [event({ occurredAt: daysAgo(30) }), event({ occurredAt: daysAgo(5) })],
      NOW
    );
    expect(summary.daysSinceContact).toBe(5);
    expect(summary.neverContacted).toBe(false);
  });

  it('ignores other people events', () => {
    const summary = summariseRecency(
      cid(1),
      [event({ contactReferenceId: cid(2), occurredAt: daysAgo(1) })],
      NOW
    );
    expect(summary.neverContacted).toBe(true);
  });

  it('never reports negative days for a future timestamp', () => {
    const summary = summariseRecency(cid(1), [event({ occurredAt: daysAgo(-5) })], NOW);
    expect(summary.daysSinceContact).toBe(0);
  });
});

describe('notRecentlyContacted and neverContacted', () => {
  const ids = [cid(1), cid(2), cid(3)];
  const events = [
    event({ contactReferenceId: cid(1), occurredAt: daysAgo(2) }),
    event({ contactReferenceId: cid(2), occurredAt: daysAgo(60) }),
  ];

  it('includes people past the threshold and everyone never contacted', () => {
    expect(notRecentlyContacted(ids, events, NOW, 30)).toEqual([cid(2), cid(3)]);
  });

  it('excludes recently contacted people', () => {
    expect(notRecentlyContacted(ids, events, NOW, 30)).not.toContain(cid(1));
  });

  it('lists only people with no events at all', () => {
    expect(neverContacted(ids, events)).toEqual([cid(3)]);
  });

  it('treats everyone as never contacted with no events', () => {
    expect(neverContacted(ids, [])).toEqual(ids);
  });
});

describe('averageContactIntervalDays', () => {
  // One contact establishes no interval; reporting 0 would be wrong.
  it('is null with fewer than two events', () => {
    expect(averageContactIntervalDays(cid(1), [])).toBeNull();
    expect(averageContactIntervalDays(cid(1), [event({ occurredAt: daysAgo(3) })])).toBeNull();
  });

  it('averages the gaps between consecutive contacts', () => {
    const value = averageContactIntervalDays(cid(1), [
      event({ occurredAt: daysAgo(20) }),
      event({ occurredAt: daysAgo(10) }),
      event({ occurredAt: daysAgo(0) }),
    ]);
    expect(value).toBe(10);
  });

  it('is unaffected by input order', () => {
    const ordered = averageContactIntervalDays(cid(1), [
      event({ occurredAt: daysAgo(20) }),
      event({ occurredAt: daysAgo(10) }),
    ]);
    const shuffled = averageContactIntervalDays(cid(1), [
      event({ occurredAt: daysAgo(10) }),
      event({ occurredAt: daysAgo(20) }),
    ]);
    expect(shuffled).toBe(ordered);
  });
});

describe('activitySince', () => {
  it('counts only what falls in the window', () => {
    const summary = activitySince(
      [
        reminder({ state: 'skipped', resolvedAt: daysAgo(2) }),
        reminder({ state: 'skipped', resolvedAt: daysAgo(20) }),
      ],
      [
        event({ contactReferenceId: cid(1), occurredAt: daysAgo(1) }),
        event({ contactReferenceId: cid(2), occurredAt: daysAgo(3) }),
        event({ contactReferenceId: cid(3), occurredAt: daysAgo(40) }),
      ],
      daysAgo(7),
      NOW
    );
    expect(summary.contactsCompleted).toBe(2);
    expect(summary.remindersSkipped).toBe(1);
    expect(summary.distinctPeopleContacted).toBe(2);
  });

  it('counts one person contacted twice as one person', () => {
    const summary = activitySince(
      [],
      [event({ occurredAt: daysAgo(1) }), event({ occurredAt: daysAgo(2) })],
      daysAgo(7),
      NOW
    );
    expect(summary.contactsCompleted).toBe(2);
    expect(summary.distinctPeopleContacted).toBe(1);
  });

  it('is empty for a window with no activity', () => {
    expect(activitySince([], [], daysAgo(7), NOW)).toEqual({
      contactsCompleted: 0,
      remindersSkipped: 0,
      distinctPeopleContacted: 0,
    });
  });
});

describe('buildScorecard', () => {
  it('assembles every metric', () => {
    const card = buildScorecard({
      reminders: [
        reminder({ state: 'completed', resolvedAt: daysAgo(2) }),
        reminder({ state: 'skipped', resolvedAt: daysAgo(1) }),
        reminder({ state: 'pending', dueAt: instant(NOW - 5 * OVERDUE_AFTER_MS) }),
      ],
      events: [
        event({ contactReferenceId: cid(1), occurredAt: daysAgo(2) }),
        event({ contactReferenceId: cid(2), occurredAt: daysAgo(45) }),
      ],
      contactIds: [cid(1), cid(2), cid(3)],
      now: NOW,
    });

    expect(card.reminders.total).toBe(3);
    expect(card.reminders.overdue).toBe(1);
    expect(card.completionRate).toBe(0.5);
    expect(card.peopleTotal).toBe(3);
    expect(card.peopleNeverContacted).toBe(1);
    expect(card.peopleNotContactedIn30Days).toBe(2); // cid(2) at 45d, cid(3) never
    expect(card.last7Days.contactsCompleted).toBe(1);
    expect(card.last30Days.contactsCompleted).toBe(1);
  });

  it('is safe on a brand-new install', () => {
    const card = buildScorecard({ reminders: [], events: [], contactIds: [], now: NOW });
    expect(card.completionRate).toBeNull();
    expect(card.streaks).toEqual({ current: 0, longest: 0 });
    expect(card.peopleTotal).toBe(0);
  });
});
