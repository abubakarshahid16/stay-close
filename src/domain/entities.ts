/**
 * Domain entities as plain immutable data.
 *
 * Behaviour lives in separate modules (rotation, schedule maths, the reminder
 * state machine) which operate *on* these values. Keeping the shapes free of
 * methods is what lets repositories return them directly and lets tests build
 * them by hand.
 *
 * Semantics for every field are defined in docs/DOMAIN.md.
 */
import type {
  ContactEventId,
  ContactReferenceId,
  GroupId,
  Instant,
  MembershipId,
  NativeContactId,
  ReminderId,
  ScheduleId,
} from './shared/ids';

// ── Contacts ────────────────────────────────────────────────────────────────

/** A person leaving the address book becomes `unavailable`, never absent. */
export type ContactAvailability = 'available' | 'unavailable';

export interface ContactReference {
  readonly id: ContactReferenceId;
  /** Fast path only. Nullable and repairable — see docs/PLATFORM.md §1.3. */
  readonly nativeId: NativeContactId | null;
  /** Durable identity anchor, normalised E.164. */
  readonly phoneE164: string;
  /** Fallback label; the native record is the source of truth. */
  readonly displayNameCache: string;
  readonly availability: ContactAvailability;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

// ── Groups ──────────────────────────────────────────────────────────────────

export interface Group {
  readonly id: GroupId;
  readonly name: string;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface Membership {
  readonly id: MembershipId;
  readonly groupId: GroupId;
  readonly contactReferenceId: ContactReferenceId;
  readonly active: boolean;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

// ── Schedules ───────────────────────────────────────────────────────────────

export type Cadence = 'daily' | 'every_x_days' | 'weekly' | 'every_x_weeks' | 'monthly';

export const CADENCES: readonly Cadence[] = [
  'daily',
  'every_x_days',
  'weekly',
  'every_x_weeks',
  'monthly',
];

export interface Schedule {
  readonly id: ScheduleId;
  readonly groupId: GroupId;
  /** How many people this cycle selects. Independent of interval — docs/DOMAIN.md §4.1. */
  readonly peoplePerCycle: number;
  readonly cadence: Cadence;
  /** Multiplier for every_x_days / every_x_weeks. 1 otherwise. */
  readonly intervalCount: number;
  /** 0 = Sunday. Used by weekly / every_x_weeks. */
  readonly weekday: number | null;
  /** The user's chosen anchor day, 1-31. Clamped at evaluation — docs/DOMAIN.md §4.3. */
  readonly monthDay: number | null;
  /** Local wall-clock time the cycle fires. */
  readonly hour: number;
  readonly minute: number;
  readonly anchorAt: Instant;
  readonly active: boolean;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

/** Records that a cycle was processed, even when it selected nobody. */
export interface ScheduleOccurrence {
  readonly scheduleId: ScheduleId;
  readonly occurrenceAt: Instant;
  readonly generatedAt: Instant;
  readonly selectedCount: number;
}

// ── Reminders ───────────────────────────────────────────────────────────────

/**
 * `pending` covers due, snoozed and overdue — overdue is a *classification* of
 * an unresolved reminder, not a stored state (docs/DOMAIN.md §8.1).
 * `cancelled` is set when a group or membership is removed; it is not
 * completion and never writes a ContactEvent (§8.4).
 */
export type ReminderState =
  | 'pending'
  | 'completed'
  | 'skipped'
  | 'deprioritized'
  | 'cancelled';

export const TERMINAL_REMINDER_STATES: readonly ReminderState[] = [
  'completed',
  'skipped',
  'deprioritized',
  'cancelled',
];

export interface ReminderInstance {
  readonly id: ReminderId;
  /** Null once the schedule is deleted; history outlives it. */
  readonly scheduleId: ScheduleId | null;
  /** Null once the group is deleted; history outlives it. */
  readonly groupId: GroupId | null;
  /** Keeps a historical reminder readable after its group is gone. */
  readonly groupNameSnapshot: string;
  readonly contactReferenceId: ContactReferenceId;
  readonly occurrenceAt: Instant;
  readonly dueAt: Instant;
  readonly state: ReminderState;
  readonly snoozedUntil: Instant | null;
  readonly resolvedAt: Instant | null;
  readonly cancelReason: string | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

// ── History ─────────────────────────────────────────────────────────────────

/**
 * `manual_log` supports a future explicit "Log contact" action, which records a
 * real interaction without fabricating a reminder (docs/DOMAIN.md §10.3).
 */
export type ContactEventSource = 'reminder_completion' | 'manual_log';

export interface ContactEvent {
  readonly id: ContactEventId;
  readonly contactReferenceId: ContactReferenceId;
  readonly occurredAt: Instant;
  readonly source: ContactEventSource;
  readonly relatedReminderId: ReminderId | null;
  readonly createdAt: Instant;
}

// ── Rotation priority ───────────────────────────────────────────────────────

/**
 * Skip and Deprioritize are distinct states, never one flag (docs/DOMAIN.md §7.2, §7.3).
 * The skip penalty decays; deprioritization does not.
 */
export interface PriorityState {
  readonly contactReferenceId: ContactReferenceId;
  readonly skipPenaltyUntil: Instant | null;
  readonly skipCount: number;
  readonly deprioritizedAt: Instant | null;
  readonly updatedAt: Instant;
}
