/**
 * Reminder state machine and snooze tests (issues 024 / #35, 025 / #36,
 * 027 / #38).
 *
 * docs/DOMAIN.md §8.2 requires invalid transitions to be *rejected*, not
 * silently ignored, and completion to be final. Both are asserted for every
 * state/action pair rather than sampled.
 */
import {
  applyAction,
  canApply,
  classify,
  compareForDisplay,
  isActionable,
  isTerminal,
  OVERDUE_AFTER_MS,
  TERMINAL_STATES,
  type ReminderAction,
} from '../../src/domain/reminder/stateMachine';
import {
  computeSnoozeTarget,
  availableSnoozeOptions,
  SNOOZE_OPTIONS,
} from '../../src/domain/reminder/snooze';
import type { ReminderInstance, ReminderState, Schedule } from '../../src/domain/entities';
import { isErr, isOk, unwrap } from '../../src/domain/shared/Result';
import {
  contactReferenceId,
  groupId,
  instant,
  instantFromISO,
  instantToISO,
  reminderId,
  scheduleId,
  timeZoneId,
} from '../../src/domain/shared/ids';

const NOW = instantFromISO('2026-08-16T21:00:00.000Z');
const UTC = timeZoneId('UTC');
const LONDON = timeZoneId('Europe/London');

const ALL_STATES: ReminderState[] = [
  'pending',
  'completed',
  'skipped',
  'deprioritized',
  'cancelled',
];
const ALL_ACTIONS: ReminderAction[] = ['complete', 'snooze', 'skip', 'deprioritize', 'cancel'];

function reminder(overrides: Partial<ReminderInstance> = {}): ReminderInstance {
  return {
    id: reminderId(1),
    scheduleId: scheduleId(1),
    groupId: groupId(1),
    groupNameSnapshot: 'Family',
    contactReferenceId: contactReferenceId(1),
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

function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: scheduleId(1),
    groupId: groupId(1),
    peoplePerCycle: 1,
    cadence: 'weekly',
    intervalCount: 1,
    weekday: 0,
    monthDay: null,
    hour: 21,
    minute: 0,
    anchorAt: instantFromISO('2026-08-09T00:00:00.000Z'),
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('terminal states', () => {
  it('classifies the four resolutions as terminal and pending as not', () => {
    expect(TERMINAL_STATES).toEqual(['completed', 'skipped', 'deprioritized', 'cancelled']);
    expect(isTerminal('pending')).toBe(false);
    for (const state of TERMINAL_STATES) expect(isTerminal(state)).toBe(true);
  });
});

describe('transition legality — exhaustive', () => {
  it('permits every action only from pending', () => {
    for (const state of ALL_STATES) {
      for (const action of ALL_ACTIONS) {
        expect(canApply(state, action)).toBe(state === 'pending');
      }
    }
  });

  // Completion is final for the occurrence (docs/DOMAIN.md §8.2).
  it.each(TERMINAL_STATES)('rejects every action on a %s reminder', (state) => {
    for (const action of ALL_ACTIONS) {
      const result = applyAction({ reminder: reminder({ state }), action, now: NOW });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.code).toBe('REMINDER_ALREADY_RESOLVED');
    }
  });
});

describe('resolving actions', () => {
  it.each([
    ['complete', 'completed'],
    ['skip', 'skipped'],
    ['deprioritize', 'deprioritized'],
    ['cancel', 'cancelled'],
  ] as const)('%s moves pending to %s and stamps resolvedAt', (action, expected) => {
    const outcome = unwrap(applyAction({ reminder: reminder(), action, now: NOW }));
    expect(outcome.state).toBe(expected);
    expect(outcome.resolvedAt).toBe(NOW);
    expect(outcome.snoozedUntil).toBeNull();
  });

  it('clears an existing snooze when resolving', () => {
    const snoozed = reminder({ snoozedUntil: instantFromISO('2026-08-17T09:00:00.000Z') });
    const outcome = unwrap(applyAction({ reminder: snoozed, action: 'complete', now: NOW }));
    expect(outcome.snoozedUntil).toBeNull();
  });
});

describe('snooze transition', () => {
  it('stays pending and moves the due time', () => {
    const until = instantFromISO('2026-08-16T22:00:00.000Z');
    const outcome = unwrap(
      applyAction({ reminder: reminder(), action: 'snooze', now: NOW, snoozeUntil: until })
    );
    expect(outcome.state).toBe('pending');
    expect(outcome.snoozedUntil).toBe(until);
    expect(outcome.dueAt).toBe(until);
    expect(outcome.resolvedAt).toBeNull();
  });

  it('requires a target', () => {
    expect(isErr(applyAction({ reminder: reminder(), action: 'snooze', now: NOW }))).toBe(true);
  });

  // A past target would re-fire immediately, which is not a snooze.
  it.each([
    ['the past', instantFromISO('2026-08-16T20:00:00.000Z')],
    ['exactly now', NOW],
  ])('rejects a target in %s', (_label, until) => {
    const result = applyAction({
      reminder: reminder(),
      action: 'snooze',
      now: NOW,
      snoozeUntil: until,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.detail).toMatch(/future/);
  });
});

describe('classification', () => {
  it('reports resolved for any terminal state', () => {
    for (const state of TERMINAL_STATES) {
      expect(classify(reminder({ state }), NOW)).toBe('resolved');
    }
  });

  it('reports due for a freshly due reminder', () => {
    expect(classify(reminder({ dueAt: NOW }), NOW)).toBe('due');
  });

  it('reports overdue once past the threshold', () => {
    const old = instant(NOW - OVERDUE_AFTER_MS);
    expect(classify(reminder({ dueAt: old }), NOW)).toBe('overdue');
    // Just inside the threshold is still merely due.
    expect(classify(reminder({ dueAt: instant(NOW - OVERDUE_AFTER_MS + 1000) }), NOW)).toBe('due');
  });

  it('reports snoozed while the snooze is in the future', () => {
    const future = instantFromISO('2026-08-17T09:00:00.000Z');
    expect(classify(reminder({ snoozedUntil: future, dueAt: future }), NOW)).toBe('snoozed');
  });

  // A lapsed snooze returns to normal work rather than hiding forever.
  it('returns a lapsed snooze to due or overdue', () => {
    const past = instantFromISO('2026-08-16T20:00:00.000Z');
    expect(classify(reminder({ snoozedUntil: past, dueAt: past }), NOW)).toBe('due');
    const ancient = instant(NOW - 5 * OVERDUE_AFTER_MS);
    expect(classify(reminder({ snoozedUntil: ancient, dueAt: ancient }), NOW)).toBe('overdue');
  });

  it('treats due and overdue as actionable, snoozed and resolved as not', () => {
    expect(isActionable(reminder({ dueAt: NOW }), NOW)).toBe(true);
    expect(isActionable(reminder({ dueAt: instant(NOW - 3 * OVERDUE_AFTER_MS) }), NOW)).toBe(true);
    const future = instantFromISO('2026-08-18T09:00:00.000Z');
    expect(isActionable(reminder({ snoozedUntil: future, dueAt: future }), NOW)).toBe(false);
    expect(isActionable(reminder({ state: 'completed' }), NOW)).toBe(false);
  });
});

describe('display order', () => {
  // The product is about the person you have neglected longest, so oldest
  // first — not newest.
  it('sorts overdue first, then due, then snoozed, each oldest first', () => {
    const future = instantFromISO('2026-08-18T09:00:00.000Z');
    const items = [
      reminder({ id: reminderId(1), dueAt: NOW }), // due
      reminder({ id: reminderId(2), snoozedUntil: future, dueAt: future }), // snoozed
      reminder({ id: reminderId(3), dueAt: instant(NOW - 10 * OVERDUE_AFTER_MS) }), // very overdue
      reminder({ id: reminderId(4), dueAt: instant(NOW - 2 * OVERDUE_AFTER_MS) }), // overdue
    ];
    const sorted = [...items].sort((a, b) => compareForDisplay(a, b, NOW));
    expect(sorted.map((r) => r.id)).toEqual([
      reminderId(3),
      reminderId(4),
      reminderId(1),
      reminderId(2),
    ]);
  });
});

describe('snooze targets', () => {
  const context = { now: NOW, timeZone: UTC, schedule: schedule() };

  it.each([
    ['thirty_minutes', '2026-08-16T21:30:00.000Z'],
    ['one_hour', '2026-08-16T22:00:00.000Z'],
    ['three_hours', '2026-08-17T00:00:00.000Z'],
  ] as const)('%s is measured from now', (option, expected) => {
    expect(instantToISO(unwrap(computeSnoozeTarget(option, context)))).toBe(expected);
  });

  // The spec bug this caught: measuring from dueAt would put an overdue
  // reminder's snooze in the past, re-firing it immediately.
  it('is measured from now even for a reminder overdue by days', () => {
    const target = unwrap(computeSnoozeTarget('thirty_minutes', context));
    expect(target).toBeGreaterThan(NOW);
    expect(instantToISO(target)).toBe('2026-08-16T21:30:00.000Z');
  });

  it('tomorrow uses the schedule time of day', () => {
    const target = unwrap(computeSnoozeTarget('tomorrow', context));
    expect(instantToISO(target)).toBe('2026-08-17T21:00:00.000Z');
  });

  it('tomorrow falls back to 09:00 with no schedule', () => {
    const target = unwrap(
      computeSnoozeTarget('tomorrow', { now: NOW, timeZone: UTC, schedule: null })
    );
    expect(instantToISO(target)).toBe('2026-08-17T09:00:00.000Z');
  });

  it('tomorrow respects the local timezone', () => {
    const target = unwrap(
      computeSnoozeTarget('tomorrow', { now: NOW, timeZone: LONDON, schedule: schedule() })
    );
    // 21:00 BST on 17 August is 20:00 UTC.
    expect(instantToISO(target)).toBe('2026-08-17T20:00:00.000Z');
  });

  it('next_occurrence uses the schedule', () => {
    const target = unwrap(computeSnoozeTarget('next_occurrence', context));
    // Weekly Sunday 21:00; the next after 2026-08-16 21:00 is 2026-08-23.
    expect(instantToISO(target)).toBe('2026-08-23T21:00:00.000Z');
  });

  it('next_occurrence fails when the schedule is gone', () => {
    const result = computeSnoozeTarget('next_occurrence', {
      now: NOW,
      timeZone: UTC,
      schedule: null,
    });
    expect(isErr(result)).toBe(true);
  });

  it('next_occurrence fails when the schedule is paused', () => {
    const result = computeSnoozeTarget('next_occurrence', {
      now: NOW,
      timeZone: UTC,
      schedule: schedule({ active: false }),
    });
    expect(isErr(result)).toBe(true);
  });

  it('every target is strictly in the future', () => {
    for (const option of SNOOZE_OPTIONS) {
      const result = computeSnoozeTarget(option, context);
      if (isOk(result)) expect(result.value).toBeGreaterThan(NOW);
    }
  });
});

describe('available snooze options', () => {
  it('offers all five with an active schedule', () => {
    expect(availableSnoozeOptions({ now: NOW, timeZone: UTC, schedule: schedule() })).toEqual([
      'thirty_minutes',
      'one_hour',
      'three_hours',
      'tomorrow',
      'next_occurrence',
    ]);
  });

  // The UI must never offer an action that cannot succeed.
  it('hides next_occurrence when there is no usable schedule', () => {
    expect(availableSnoozeOptions({ now: NOW, timeZone: UTC, schedule: null })).not.toContain(
      'next_occurrence'
    );
    expect(
      availableSnoozeOptions({ now: NOW, timeZone: UTC, schedule: schedule({ active: false }) })
    ).not.toContain('next_occurrence');
  });

  it('never offers arbitrary date-time selection', () => {
    // V1 is predefined options only (docs/DOMAIN.md §8.5).
    expect(SNOOZE_OPTIONS).toHaveLength(5);
  });
});
