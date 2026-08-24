/**
 * Reminder state machine and classification (issues 024 / #35, 025 / #36).
 *
 * Two distinct ideas, deliberately separated:
 *
 * - **State** is stored: pending, completed, skipped, deprioritized, cancelled.
 * - **Classification** is derived: snoozed, due, overdue. `overdue` is *not* a
 *   stored state — it is what an unresolved reminder becomes with the passage of
 *   time (docs/DOMAIN.md §8.1). Storing it would require a background job to
 *   flip it, which the platform cannot provide (docs/PLATFORM.md §4).
 *
 * Invalid transitions return a Result rather than throwing, so they are
 * assertable in tests instead of caught (docs/ARCHITECTURE.md §6).
 *
 * Pure: no clock, no I/O.
 */
import type { ReminderInstance, ReminderState } from '../entities';
import { domainError, err, ok, type Result } from '../shared/Result';
import type { Instant } from '../shared/ids';

/** What the user (or the system) is trying to do to a reminder. */
export type ReminderAction =
  | 'complete'
  | 'snooze'
  | 'skip'
  | 'deprioritize'
  | 'cancel';

/** How a pending reminder presents to the user right now. */
export type ReminderClassification = 'snoozed' | 'due' | 'overdue' | 'resolved';

/**
 * A reminder is overdue once it has been unresolved for longer than this.
 * Chosen as one day so "due today" and "overdue" match how the product talks
 * about them (docs/DOMAIN.md §8.3), not from any platform constraint.
 */
export const OVERDUE_AFTER_MS = 86_400_000;

export const TERMINAL_STATES: readonly ReminderState[] = [
  'completed',
  'skipped',
  'deprioritized',
  'cancelled',
];

export function isTerminal(state: ReminderState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** The state an action moves a reminder to. Snooze stays pending by design. */
const ACTION_RESULT: Record<ReminderAction, ReminderState> = {
  complete: 'completed',
  snooze: 'pending',
  skip: 'skipped',
  deprioritize: 'deprioritized',
  cancel: 'cancelled',
};

/**
 * Whether `action` is legal on a reminder in `state`.
 *
 * Only pending reminders accept anything. Completion is final for the
 * occurrence, and no action resurrects a resolved reminder (§8.2).
 */
export function canApply(state: ReminderState, action: ReminderAction): boolean {
  if (state !== 'pending') return false;
  return action in ACTION_RESULT;
}

export interface TransitionOutcome {
  readonly state: ReminderState;
  /** Set when the action resolves the reminder; null for snooze. */
  readonly resolvedAt: Instant | null;
  /** Set only by snooze; cleared by every resolving action. */
  readonly snoozedUntil: Instant | null;
  /** Snooze also moves the due time, so the task re-presents at the right moment. */
  readonly dueAt: Instant | null;
}

export interface TransitionInput {
  readonly reminder: Pick<ReminderInstance, 'state' | 'dueAt'>;
  readonly action: ReminderAction;
  readonly now: Instant;
  /** Required for snooze; ignored otherwise. Must be strictly in the future. */
  readonly snoozeUntil?: Instant;
}

/**
 * Apply an action to a reminder, returning the resulting field values.
 *
 * Returns the *values to persist* rather than mutating, so the caller owns the
 * write and the transaction.
 */
export function applyAction(input: TransitionInput): Result<TransitionOutcome> {
  const { reminder, action, now, snoozeUntil } = input;

  if (isTerminal(reminder.state)) {
    return err(
      domainError(
        'REMINDER_ALREADY_RESOLVED',
        `This reminder is already ${reminder.state} and cannot be changed.`
      )
    );
  }

  if (!canApply(reminder.state, action)) {
    return err(
      domainError('INVALID_TRANSITION', `Cannot ${action} a reminder that is ${reminder.state}.`)
    );
  }

  if (action === 'snooze') {
    if (snoozeUntil === undefined) {
      return err(domainError('INVALID_TRANSITION', 'Snooze needs a target time.'));
    }
    // A target in the past would re-fire immediately, which is not a snooze.
    if (snoozeUntil <= now) {
      return err(
        domainError('INVALID_TRANSITION', 'A snooze must be for a time in the future.')
      );
    }
    return ok({
      state: 'pending',
      resolvedAt: null,
      snoozedUntil: snoozeUntil,
      dueAt: snoozeUntil,
    });
  }

  return ok({
    state: ACTION_RESULT[action],
    resolvedAt: now,
    // Resolving clears any snooze; the occurrence is over.
    snoozedUntil: null,
    dueAt: null,
  });
}

/**
 * How a reminder presents right now.
 *
 * A snoozed reminder is still pending — it has simply been asked to wait. An
 * overdue one is also still pending and still resolvable; the classification
 * exists to order the user's list, not to expire anything (§8.3).
 */
export function classify(
  reminder: Pick<ReminderInstance, 'state' | 'dueAt' | 'snoozedUntil'>,
  now: Instant
): ReminderClassification {
  if (reminder.state !== 'pending') return 'resolved';
  if (reminder.snoozedUntil !== null && reminder.snoozedUntil > now) return 'snoozed';
  if (now - reminder.dueAt >= OVERDUE_AFTER_MS) return 'overdue';
  return 'due';
}

/** Whether a reminder should be shown as actionable work right now. */
export function isActionable(
  reminder: Pick<ReminderInstance, 'state' | 'dueAt' | 'snoozedUntil'>,
  now: Instant
): boolean {
  const classification = classify(reminder, now);
  return classification === 'due' || classification === 'overdue';
}

/**
 * Order for the user's task list: overdue first, then due, then snoozed, each
 * oldest-first. Deliberately not "newest first" — the point of the product is
 * the person you have neglected longest.
 */
export function compareForDisplay(
  a: Pick<ReminderInstance, 'state' | 'dueAt' | 'snoozedUntil'>,
  b: Pick<ReminderInstance, 'state' | 'dueAt' | 'snoozedUntil'>,
  now: Instant
): number {
  const rank: Record<ReminderClassification, number> = {
    overdue: 0,
    due: 1,
    snoozed: 2,
    resolved: 3,
  };
  const byRank = rank[classify(a, now)] - rank[classify(b, now)];
  if (byRank !== 0) return byRank;
  return a.dueAt - b.dueAt;
}
