/**
 * Repository ports.
 *
 * The domain and application layers depend on these interfaces; only
 * src/adapters/persistence implements them. No SQL exists outside that
 * directory (docs/ARCHITECTURE.md §2.1), which is what keeps use cases
 * testable against in-memory fakes.
 */
import type {
  ContactEvent,
  ContactEventSource,
  ContactReference,
  Group,
  Membership,
  PriorityState,
  ReminderInstance,
  ReminderState,
  Schedule,
  ScheduleOccurrence,
} from '../domain/entities';
import type {
  ContactEventId,
  ContactReferenceId,
  GroupId,
  Instant,
  MembershipId,
  NativeContactId,
  ReminderId,
  ScheduleId,
} from '../domain/shared/ids';

// ── Contacts ────────────────────────────────────────────────────────────────

export interface NewContactReference {
  readonly nativeId: NativeContactId | null;
  readonly phoneE164: string;
  readonly displayNameCache: string;
}

export interface ContactReferenceRepository {
  findById(id: ContactReferenceId): Promise<ContactReference | null>;
  findByPhone(phoneE164: string): Promise<ContactReference | null>;
  findByNativeId(nativeId: NativeContactId): Promise<ContactReference | null>;
  findAll(): Promise<ContactReference[]>;

  /**
   * Insert, or return the existing row for this phone number. Person-level
   * dedup across groups depends on this being an upsert, not a blind insert
   * (docs/DOMAIN.md §2 rule 6).
   */
  ensure(input: NewContactReference, now: Instant): Promise<ContactReference>;

  /** Refresh cached display data after resolving against the address book. */
  updateSnapshot(
    id: ContactReferenceId,
    displayNameCache: string,
    phoneE164: string,
    now: Instant
  ): Promise<void>;

  /** Repair a churned platform identifier (docs/PLATFORM.md §1.3). */
  repairNativeId(
    id: ContactReferenceId,
    nativeId: NativeContactId | null,
    now: Instant
  ): Promise<void>;

  setAvailability(
    id: ContactReferenceId,
    availability: ContactReference['availability'],
    now: Instant
  ): Promise<void>;
}

// ── Groups and membership ───────────────────────────────────────────────────

export interface GroupRepository {
  findById(id: GroupId): Promise<Group | null>;
  findAll(): Promise<Group[]>;
  create(name: string, now: Instant): Promise<Group>;
  rename(id: GroupId, name: string, now: Instant): Promise<void>;
  /** Cascades memberships and schedules. Never touches history. */
  delete(id: GroupId): Promise<void>;
}

export interface MembershipRepository {
  findByGroup(groupId: GroupId, activeOnly?: boolean): Promise<Membership[]>;
  findByContact(contactReferenceId: ContactReferenceId): Promise<Membership[]>;
  find(groupId: GroupId, contactReferenceId: ContactReferenceId): Promise<Membership | null>;
  /** Idempotent: re-adding an existing member reactivates rather than duplicating. */
  add(groupId: GroupId, contactReferenceId: ContactReferenceId, now: Instant): Promise<Membership>;
  remove(id: MembershipId): Promise<void>;
  setActive(id: MembershipId, active: boolean, now: Instant): Promise<void>;
  countByGroup(groupId: GroupId, activeOnly?: boolean): Promise<number>;
}

// ── Schedules ───────────────────────────────────────────────────────────────

export type NewSchedule = Omit<Schedule, 'id' | 'createdAt' | 'updatedAt'>;
export type ScheduleUpdate = Partial<Omit<NewSchedule, 'groupId'>>;

export interface ScheduleRepository {
  findById(id: ScheduleId): Promise<Schedule | null>;
  findByGroup(groupId: GroupId): Promise<Schedule[]>;
  findAllActive(): Promise<Schedule[]>;
  create(input: NewSchedule, now: Instant): Promise<Schedule>;
  update(id: ScheduleId, patch: ScheduleUpdate, now: Instant): Promise<void>;
  delete(id: ScheduleId): Promise<void>;
}

export interface ScheduleOccurrenceRepository {
  /**
   * Record a processed cycle. Returns false when the cycle was already
   * recorded — the database-level half of scheduler idempotence
   * (docs/DOMAIN.md §14.1).
   */
  record(
    scheduleId: ScheduleId,
    occurrenceAt: Instant,
    selectedCount: number,
    now: Instant
  ): Promise<boolean>;
  has(scheduleId: ScheduleId, occurrenceAt: Instant): Promise<boolean>;
  findBySchedule(scheduleId: ScheduleId): Promise<ScheduleOccurrence[]>;
  latest(scheduleId: ScheduleId): Promise<ScheduleOccurrence | null>;

  /**
   * Correct the recorded count after selection.
   *
   * The scheduler claims the occurrence row *before* selecting, so the claim
   * cannot know how many people it will pick. Without this the stored count
   * would always read 0 and quietly misreport history.
   */
  setSelectedCount(
    scheduleId: ScheduleId,
    occurrenceAt: Instant,
    selectedCount: number
  ): Promise<void>;
}

// ── Reminders ───────────────────────────────────────────────────────────────

export interface NewReminder {
  readonly scheduleId: ScheduleId;
  readonly groupId: GroupId;
  readonly groupNameSnapshot: string;
  readonly contactReferenceId: ContactReferenceId;
  readonly occurrenceAt: Instant;
  readonly dueAt: Instant;
}

export interface ReminderRepository {
  findById(id: ReminderId): Promise<ReminderInstance | null>;

  /**
   * Create a reminder, or return null when one already exists for this
   * (schedule, occurrence, person). Relies on the UNIQUE constraint rather
   * than a read-then-write check.
   */
  createIfAbsent(input: NewReminder, now: Instant): Promise<ReminderInstance | null>;

  /** Every unresolved reminder, across all groups. */
  findPending(): Promise<ReminderInstance[]>;

  /**
   * Whether this person has an unresolved reminder anywhere. Backs the global
   * pending-contact exclusion (docs/DOMAIN.md §6).
   */
  hasPendingForContact(contactReferenceId: ContactReferenceId): Promise<boolean>;

  /** Contacts with an unresolved reminder anywhere — bulk form of the above. */
  contactsWithPending(): Promise<ContactReferenceId[]>;

  findByContact(contactReferenceId: ContactReferenceId): Promise<ReminderInstance[]>;
  findByGroup(groupId: GroupId): Promise<ReminderInstance[]>;

  resolve(
    id: ReminderId,
    state: Exclude<ReminderState, 'pending'>,
    now: Instant,
    cancelReason?: string
  ): Promise<void>;

  /** Modifies the existing reminder. Must never create a second one (§8.5). */
  snooze(id: ReminderId, until: Instant, now: Instant): Promise<void>;

  /** Cancel unresolved reminders for a group, preserving history (§8.4). */
  cancelPendingForGroup(groupId: GroupId, reason: string, now: Instant): Promise<number>;

  /** Cancel unresolved reminders for one person in one group (§8.4). */
  cancelPendingForMembership(
    groupId: GroupId,
    contactReferenceId: ContactReferenceId,
    reason: string,
    now: Instant
  ): Promise<number>;
}

// ── History ─────────────────────────────────────────────────────────────────

export interface NewContactEvent {
  readonly contactReferenceId: ContactReferenceId;
  readonly occurredAt: Instant;
  readonly source: ContactEventSource;
  readonly relatedReminderId: ReminderId | null;
}

export interface ContactEventRepository {
  findById(id: ContactEventId): Promise<ContactEvent | null>;
  record(input: NewContactEvent, now: Instant): Promise<ContactEvent>;
  findByContact(contactReferenceId: ContactReferenceId): Promise<ContactEvent[]>;

  /** Most recent contact for a person, globally. Null means never contacted. */
  lastContactedAt(contactReferenceId: ContactReferenceId): Promise<Instant | null>;

  /**
   * Last-contact instant for many people at once, keyed by id. People absent
   * from the map have never been contacted. Rotation reads this per cycle, so
   * it must not be N+1.
   */
  lastContactedBulk(
    ids: readonly ContactReferenceId[]
  ): Promise<Map<ContactReferenceId, Instant>>;
}

// ── Rotation priority ───────────────────────────────────────────────────────

export interface PriorityStateRepository {
  find(contactReferenceId: ContactReferenceId): Promise<PriorityState | null>;
  findBulk(
    ids: readonly ContactReferenceId[]
  ): Promise<Map<ContactReferenceId, PriorityState>>;
  /** Temporary, decaying penalty (docs/DOMAIN.md §7.2). */
  applySkipPenalty(
    contactReferenceId: ContactReferenceId,
    penaltyUntil: Instant,
    now: Instant
  ): Promise<void>;
  /** Indefinite, no decay (docs/DOMAIN.md §7.3). */
  setDeprioritized(
    contactReferenceId: ContactReferenceId,
    deprioritizedAt: Instant | null,
    now: Instant
  ): Promise<void>;
}

// ── Settings ────────────────────────────────────────────────────────────────

export interface SettingsRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  all(): Promise<Record<string, string>>;
  delete(key: string): Promise<void>;
}

// ── Unit of work ────────────────────────────────────────────────────────────

export interface Repositories {
  readonly contacts: ContactReferenceRepository;
  readonly groups: GroupRepository;
  readonly memberships: MembershipRepository;
  readonly schedules: ScheduleRepository;
  readonly occurrences: ScheduleOccurrenceRepository;
  readonly reminders: ReminderRepository;
  readonly events: ContactEventRepository;
  readonly priorities: PriorityStateRepository;
  readonly settings: SettingsRepository;
}

/**
 * A scheduler run must create reminders and record cycle state atomically, or
 * idempotence is unprovable. The application layer owns transaction
 * boundaries; the domain never sees them (docs/ARCHITECTURE.md §4.6).
 */
export interface UnitOfWork {
  readonly repositories: Repositories;
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}
