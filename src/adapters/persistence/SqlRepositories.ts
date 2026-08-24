/**
 * SQL repository implementations (issue 008 / #19).
 *
 * The only place in the codebase containing SQL. Hand-written, no ORM
 * (docs/ARCHITECTURE.md §8). Instants are stored as ISO-8601 UTC strings and
 * converted to/from branded `Instant` numbers at this boundary, so the domain
 * only ever sees numbers.
 */
import type { SqlDriver, SqlValue } from '../../ports/SqlDriver';
import type {
  ContactEventRepository,
  ContactReferenceRepository,
  GroupRepository,
  MembershipRepository,
  NewContactEvent,
  NewContactReference,
  NewReminder,
  NewSchedule,
  PriorityStateRepository,
  Repositories,
  ReminderRepository,
  ScheduleOccurrenceRepository,
  ScheduleRepository,
  ScheduleUpdate,
  SettingsRepository,
  UnitOfWork,
} from '../../ports/repositories';
import type {
  ContactAvailability,
  ContactEvent,
  ContactReference,
  Group,
  Membership,
  PriorityState,
  ReminderInstance,
  ReminderState,
  Schedule,
  ScheduleOccurrence,
} from '../../domain/entities';
import {
  contactEventId,
  contactReferenceId,
  groupId,
  instant,
  membershipId,
  nativeContactId,
  reminderId,
  scheduleId,
  type ContactReferenceId,
  type GroupId,
  type Instant,
  type MembershipId,
  type NativeContactId,
  type ReminderId,
  type ScheduleId,
} from '../../domain/shared/ids';

// ── conversion helpers ──────────────────────────────────────────────────────

const toIso = (i: Instant): string => new Date(i).toISOString();
const fromIso = (s: string): Instant => instant(new Date(s).getTime());
const fromIsoOrNull = (s: string | null): Instant | null => (s === null ? null : fromIso(s));
const bool = (n: number): boolean => n === 1;

/** Placeholders for an IN clause, avoiding an N+1 read in rotation. */
function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

// ── row shapes ──────────────────────────────────────────────────────────────

interface ContactRow {
  id: number;
  native_id: string | null;
  phone_e164: string;
  display_name_cache: string;
  availability: string;
  created_at: string;
  updated_at: string;
}

interface GroupRow {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

interface MembershipRow {
  id: number;
  group_id: number;
  contact_reference_id: number;
  active: number;
  created_at: string;
  updated_at: string;
}

interface ScheduleRow {
  id: number;
  group_id: number;
  people_per_cycle: number;
  cadence: string;
  interval_count: number;
  weekday: number | null;
  month_day: number | null;
  hour: number;
  minute: number;
  anchor_at: string;
  active: number;
  created_at: string;
  updated_at: string;
}

interface OccurrenceRow {
  schedule_id: number;
  occurrence_at: string;
  generated_at: string;
  selected_count: number;
}

interface ReminderRow {
  id: number;
  schedule_id: number | null;
  group_id: number | null;
  group_name_snapshot: string;
  contact_reference_id: number;
  occurrence_at: string;
  due_at: string;
  state: string;
  snoozed_until: string | null;
  resolved_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: number;
  contact_reference_id: number;
  occurred_at: string;
  source: string;
  related_reminder_id: number | null;
  created_at: string;
}

interface PriorityRow {
  contact_reference_id: number;
  skip_penalty_until: string | null;
  skip_count: number;
  deprioritized_at: string | null;
  updated_at: string;
}

// ── mappers ─────────────────────────────────────────────────────────────────

const mapContact = (r: ContactRow): ContactReference => ({
  id: contactReferenceId(r.id),
  nativeId: r.native_id === null ? null : nativeContactId(r.native_id),
  phoneE164: r.phone_e164,
  displayNameCache: r.display_name_cache,
  availability: r.availability as ContactAvailability,
  createdAt: fromIso(r.created_at),
  updatedAt: fromIso(r.updated_at),
});

const mapGroup = (r: GroupRow): Group => ({
  id: groupId(r.id),
  name: r.name,
  createdAt: fromIso(r.created_at),
  updatedAt: fromIso(r.updated_at),
});

const mapMembership = (r: MembershipRow): Membership => ({
  id: membershipId(r.id),
  groupId: groupId(r.group_id),
  contactReferenceId: contactReferenceId(r.contact_reference_id),
  active: bool(r.active),
  createdAt: fromIso(r.created_at),
  updatedAt: fromIso(r.updated_at),
});

const mapSchedule = (r: ScheduleRow): Schedule => ({
  id: scheduleId(r.id),
  groupId: groupId(r.group_id),
  peoplePerCycle: r.people_per_cycle,
  cadence: r.cadence as Schedule['cadence'],
  intervalCount: r.interval_count,
  weekday: r.weekday,
  monthDay: r.month_day,
  hour: r.hour,
  minute: r.minute,
  anchorAt: fromIso(r.anchor_at),
  active: bool(r.active),
  createdAt: fromIso(r.created_at),
  updatedAt: fromIso(r.updated_at),
});

const mapOccurrence = (r: OccurrenceRow): ScheduleOccurrence => ({
  scheduleId: scheduleId(r.schedule_id),
  occurrenceAt: fromIso(r.occurrence_at),
  generatedAt: fromIso(r.generated_at),
  selectedCount: r.selected_count,
});

const mapReminder = (r: ReminderRow): ReminderInstance => ({
  id: reminderId(r.id),
  scheduleId: r.schedule_id === null ? null : scheduleId(r.schedule_id),
  groupId: r.group_id === null ? null : groupId(r.group_id),
  groupNameSnapshot: r.group_name_snapshot,
  contactReferenceId: contactReferenceId(r.contact_reference_id),
  occurrenceAt: fromIso(r.occurrence_at),
  dueAt: fromIso(r.due_at),
  state: r.state as ReminderState,
  snoozedUntil: fromIsoOrNull(r.snoozed_until),
  resolvedAt: fromIsoOrNull(r.resolved_at),
  cancelReason: r.cancel_reason,
  createdAt: fromIso(r.created_at),
  updatedAt: fromIso(r.updated_at),
});

const mapEvent = (r: EventRow): ContactEvent => ({
  id: contactEventId(r.id),
  contactReferenceId: contactReferenceId(r.contact_reference_id),
  occurredAt: fromIso(r.occurred_at),
  source: r.source as ContactEvent['source'],
  relatedReminderId: r.related_reminder_id === null ? null : reminderId(r.related_reminder_id),
  createdAt: fromIso(r.created_at),
});

const mapPriority = (r: PriorityRow): PriorityState => ({
  contactReferenceId: contactReferenceId(r.contact_reference_id),
  skipPenaltyUntil: fromIsoOrNull(r.skip_penalty_until),
  skipCount: r.skip_count,
  deprioritizedAt: fromIsoOrNull(r.deprioritized_at),
  updatedAt: fromIso(r.updated_at),
});

// ── contacts ────────────────────────────────────────────────────────────────

export class SqlContactReferenceRepository implements ContactReferenceRepository {
  constructor(private readonly db: SqlDriver) {}

  async findById(id: ContactReferenceId): Promise<ContactReference | null> {
    const row = await this.db.get<ContactRow>('SELECT * FROM contact_references WHERE id = ?', [id]);
    return row ? mapContact(row) : null;
  }

  async findByPhone(phoneE164: string): Promise<ContactReference | null> {
    const row = await this.db.get<ContactRow>(
      'SELECT * FROM contact_references WHERE phone_e164 = ?',
      [phoneE164]
    );
    return row ? mapContact(row) : null;
  }

  async findByNativeId(id: NativeContactId): Promise<ContactReference | null> {
    const row = await this.db.get<ContactRow>(
      'SELECT * FROM contact_references WHERE native_id = ?',
      [id]
    );
    return row ? mapContact(row) : null;
  }

  async findAll(): Promise<ContactReference[]> {
    const rows = await this.db.all<ContactRow>(
      'SELECT * FROM contact_references ORDER BY display_name_cache ASC'
    );
    return rows.map(mapContact);
  }

  async ensure(input: NewContactReference, now: Instant): Promise<ContactReference> {
    // Upsert on the durable anchor. Adding the same person to a second group
    // must not create a second person (docs/DOMAIN.md §2 rule 6).
    const existing = await this.findByPhone(input.phoneE164);
    if (existing) {
      if (input.nativeId !== null && input.nativeId !== existing.nativeId) {
        await this.repairNativeId(existing.id, input.nativeId, now);
      }
      return (await this.findById(existing.id)) as ContactReference;
    }

    const iso = toIso(now);
    const result = await this.db.run(
      `INSERT INTO contact_references
         (native_id, phone_e164, display_name_cache, availability, created_at, updated_at)
       VALUES (?, ?, ?, 'available', ?, ?)`,
      [input.nativeId, input.phoneE164, input.displayNameCache, iso, iso]
    );
    return (await this.findById(contactReferenceId(result.lastInsertRowId))) as ContactReference;
  }

  async updateSnapshot(
    id: ContactReferenceId,
    displayNameCache: string,
    phoneE164: string,
    now: Instant
  ): Promise<void> {
    await this.db.run(
      `UPDATE contact_references
          SET display_name_cache = ?, phone_e164 = ?, updated_at = ?
        WHERE id = ?`,
      [displayNameCache, phoneE164, toIso(now), id]
    );
  }

  async repairNativeId(
    id: ContactReferenceId,
    nativeId: NativeContactId | null,
    now: Instant
  ): Promise<void> {
    await this.db.run(
      'UPDATE contact_references SET native_id = ?, updated_at = ? WHERE id = ?',
      [nativeId, toIso(now), id]
    );
  }

  async setAvailability(
    id: ContactReferenceId,
    availability: ContactAvailability,
    now: Instant
  ): Promise<void> {
    await this.db.run(
      'UPDATE contact_references SET availability = ?, updated_at = ? WHERE id = ?',
      [availability, toIso(now), id]
    );
  }
}

// ── groups ──────────────────────────────────────────────────────────────────

export class SqlGroupRepository implements GroupRepository {
  constructor(private readonly db: SqlDriver) {}

  async findById(id: GroupId): Promise<Group | null> {
    const row = await this.db.get<GroupRow>('SELECT * FROM groups WHERE id = ?', [id]);
    return row ? mapGroup(row) : null;
  }

  async findAll(): Promise<Group[]> {
    const rows = await this.db.all<GroupRow>('SELECT * FROM groups ORDER BY name ASC');
    return rows.map(mapGroup);
  }

  async create(name: string, now: Instant): Promise<Group> {
    const iso = toIso(now);
    const result = await this.db.run(
      'INSERT INTO groups (name, created_at, updated_at) VALUES (?, ?, ?)',
      [name.trim(), iso, iso]
    );
    return (await this.findById(groupId(result.lastInsertRowId))) as Group;
  }

  async rename(id: GroupId, name: string, now: Instant): Promise<void> {
    await this.db.run('UPDATE groups SET name = ?, updated_at = ? WHERE id = ?', [
      name.trim(),
      toIso(now),
      id,
    ]);
  }

  async delete(id: GroupId): Promise<void> {
    // Cascades memberships and schedules. Reminder and contact history survive
    // via ON DELETE SET NULL (docs/DATABASE.md §2.2).
    await this.db.run('DELETE FROM groups WHERE id = ?', [id]);
  }
}

export class SqlMembershipRepository implements MembershipRepository {
  constructor(private readonly db: SqlDriver) {}

  async findByGroup(id: GroupId, activeOnly = false): Promise<Membership[]> {
    const rows = await this.db.all<MembershipRow>(
      `SELECT * FROM memberships WHERE group_id = ?${activeOnly ? ' AND active = 1' : ''}`,
      [id]
    );
    return rows.map(mapMembership);
  }

  async findByContact(id: ContactReferenceId): Promise<Membership[]> {
    const rows = await this.db.all<MembershipRow>(
      'SELECT * FROM memberships WHERE contact_reference_id = ?',
      [id]
    );
    return rows.map(mapMembership);
  }

  async find(gid: GroupId, cid: ContactReferenceId): Promise<Membership | null> {
    const row = await this.db.get<MembershipRow>(
      'SELECT * FROM memberships WHERE group_id = ? AND contact_reference_id = ?',
      [gid, cid]
    );
    return row ? mapMembership(row) : null;
  }

  async add(gid: GroupId, cid: ContactReferenceId, now: Instant): Promise<Membership> {
    // Idempotent by design: re-adding someone reactivates their membership
    // rather than failing on the UNIQUE constraint or duplicating them.
    const existing = await this.find(gid, cid);
    if (existing) {
      if (!existing.active) await this.setActive(existing.id, true, now);
      return (await this.find(gid, cid)) as Membership;
    }
    const iso = toIso(now);
    await this.db.run(
      `INSERT INTO memberships (group_id, contact_reference_id, active, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?)`,
      [gid, cid, iso, iso]
    );
    return (await this.find(gid, cid)) as Membership;
  }

  async remove(id: MembershipId): Promise<void> {
    await this.db.run('DELETE FROM memberships WHERE id = ?', [id]);
  }

  async setActive(id: MembershipId, active: boolean, now: Instant): Promise<void> {
    await this.db.run('UPDATE memberships SET active = ?, updated_at = ? WHERE id = ?', [
      active ? 1 : 0,
      toIso(now),
      id,
    ]);
  }

  async countByGroup(id: GroupId, activeOnly = false): Promise<number> {
    const row = await this.db.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM memberships WHERE group_id = ?${activeOnly ? ' AND active = 1' : ''}`,
      [id]
    );
    return row?.c ?? 0;
  }
}

// ── schedules ───────────────────────────────────────────────────────────────

export class SqlScheduleRepository implements ScheduleRepository {
  constructor(private readonly db: SqlDriver) {}

  async findById(id: ScheduleId): Promise<Schedule | null> {
    const row = await this.db.get<ScheduleRow>('SELECT * FROM schedules WHERE id = ?', [id]);
    return row ? mapSchedule(row) : null;
  }

  async findByGroup(id: GroupId): Promise<Schedule[]> {
    const rows = await this.db.all<ScheduleRow>(
      'SELECT * FROM schedules WHERE group_id = ? ORDER BY id ASC',
      [id]
    );
    return rows.map(mapSchedule);
  }

  async findAllActive(): Promise<Schedule[]> {
    const rows = await this.db.all<ScheduleRow>(
      'SELECT * FROM schedules WHERE active = 1 ORDER BY id ASC'
    );
    return rows.map(mapSchedule);
  }

  async create(input: NewSchedule, now: Instant): Promise<Schedule> {
    const iso = toIso(now);
    const result = await this.db.run(
      `INSERT INTO schedules
         (group_id, people_per_cycle, cadence, interval_count, weekday, month_day,
          hour, minute, anchor_at, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.groupId,
        input.peoplePerCycle,
        input.cadence,
        input.intervalCount,
        input.weekday,
        input.monthDay,
        input.hour,
        input.minute,
        toIso(input.anchorAt),
        input.active ? 1 : 0,
        iso,
        iso,
      ]
    );
    return (await this.findById(scheduleId(result.lastInsertRowId))) as Schedule;
  }

  async update(id: ScheduleId, patch: ScheduleUpdate, now: Instant): Promise<void> {
    const columns: Record<string, SqlValue> = {};
    if (patch.peoplePerCycle !== undefined) columns['people_per_cycle'] = patch.peoplePerCycle;
    if (patch.cadence !== undefined) columns['cadence'] = patch.cadence;
    if (patch.intervalCount !== undefined) columns['interval_count'] = patch.intervalCount;
    if (patch.weekday !== undefined) columns['weekday'] = patch.weekday;
    if (patch.monthDay !== undefined) columns['month_day'] = patch.monthDay;
    if (patch.hour !== undefined) columns['hour'] = patch.hour;
    if (patch.minute !== undefined) columns['minute'] = patch.minute;
    if (patch.anchorAt !== undefined) columns['anchor_at'] = toIso(patch.anchorAt);
    if (patch.active !== undefined) columns['active'] = patch.active ? 1 : 0;

    const keys = Object.keys(columns);
    if (keys.length === 0) return;

    // Column names come from the fixed mapping above, never from caller input.
    const assignments = keys.map((k) => `${k} = ?`).join(', ');
    await this.db.run(
      `UPDATE schedules SET ${assignments}, updated_at = ? WHERE id = ?`,
      [...keys.map((k) => columns[k]), toIso(now), id]
    );
  }

  async delete(id: ScheduleId): Promise<void> {
    await this.db.run('DELETE FROM schedules WHERE id = ?', [id]);
  }
}

export class SqlScheduleOccurrenceRepository implements ScheduleOccurrenceRepository {
  constructor(private readonly db: SqlDriver) {}

  async record(
    sid: ScheduleId,
    occurrenceAt: Instant,
    selectedCount: number,
    now: Instant
  ): Promise<boolean> {
    // OR IGNORE leans on UNIQUE(schedule_id, occurrence_at): a second attempt
    // for the same cycle changes nothing and reports false.
    const result = await this.db.run(
      `INSERT OR IGNORE INTO schedule_occurrences
         (schedule_id, occurrence_at, generated_at, selected_count)
       VALUES (?, ?, ?, ?)`,
      [sid, toIso(occurrenceAt), toIso(now), selectedCount]
    );
    return result.changes > 0;
  }

  async has(sid: ScheduleId, occurrenceAt: Instant): Promise<boolean> {
    const row = await this.db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM schedule_occurrences WHERE schedule_id = ? AND occurrence_at = ?',
      [sid, toIso(occurrenceAt)]
    );
    return (row?.c ?? 0) > 0;
  }

  async findBySchedule(sid: ScheduleId): Promise<ScheduleOccurrence[]> {
    const rows = await this.db.all<OccurrenceRow>(
      'SELECT * FROM schedule_occurrences WHERE schedule_id = ? ORDER BY occurrence_at ASC',
      [sid]
    );
    return rows.map(mapOccurrence);
  }

  async latest(sid: ScheduleId): Promise<ScheduleOccurrence | null> {
    const row = await this.db.get<OccurrenceRow>(
      'SELECT * FROM schedule_occurrences WHERE schedule_id = ? ORDER BY occurrence_at DESC LIMIT 1',
      [sid]
    );
    return row ? mapOccurrence(row) : null;
  }

  async setSelectedCount(
    sid: ScheduleId,
    occurrenceAt: Instant,
    selectedCount: number
  ): Promise<void> {
    await this.db.run(
      'UPDATE schedule_occurrences SET selected_count = ? WHERE schedule_id = ? AND occurrence_at = ?',
      [selectedCount, sid, toIso(occurrenceAt)]
    );
  }
}

// ── reminders ───────────────────────────────────────────────────────────────

export class SqlReminderRepository implements ReminderRepository {
  constructor(private readonly db: SqlDriver) {}

  async findById(id: ReminderId): Promise<ReminderInstance | null> {
    const row = await this.db.get<ReminderRow>('SELECT * FROM reminder_instances WHERE id = ?', [id]);
    return row ? mapReminder(row) : null;
  }

  async createIfAbsent(input: NewReminder, now: Instant): Promise<ReminderInstance | null> {
    const iso = toIso(now);
    // OR IGNORE relies on UNIQUE(schedule_id, occurrence_at, contact_reference_id)
    // rather than a read-then-write check, so concurrent runs cannot both win.
    const result = await this.db.run(
      `INSERT OR IGNORE INTO reminder_instances
         (schedule_id, group_id, group_name_snapshot, contact_reference_id,
          occurrence_at, due_at, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        input.scheduleId,
        input.groupId,
        input.groupNameSnapshot,
        input.contactReferenceId,
        toIso(input.occurrenceAt),
        toIso(input.dueAt),
        iso,
        iso,
      ]
    );
    if (result.changes === 0) return null;
    return this.findById(reminderId(result.lastInsertRowId));
  }

  async findPending(): Promise<ReminderInstance[]> {
    const rows = await this.db.all<ReminderRow>(
      `SELECT * FROM reminder_instances WHERE state = 'pending' ORDER BY due_at ASC`
    );
    return rows.map(mapReminder);
  }

  async hasPendingForContact(id: ContactReferenceId): Promise<boolean> {
    const row = await this.db.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM reminder_instances
        WHERE contact_reference_id = ? AND state = 'pending'`,
      [id]
    );
    return (row?.c ?? 0) > 0;
  }

  async contactsWithPending(): Promise<ContactReferenceId[]> {
    const rows = await this.db.all<{ contact_reference_id: number }>(
      `SELECT DISTINCT contact_reference_id FROM reminder_instances WHERE state = 'pending'`
    );
    return rows.map((r) => contactReferenceId(r.contact_reference_id));
  }

  async findByContact(id: ContactReferenceId): Promise<ReminderInstance[]> {
    const rows = await this.db.all<ReminderRow>(
      `SELECT * FROM reminder_instances WHERE contact_reference_id = ?
        ORDER BY occurrence_at DESC, id DESC`,
      [id]
    );
    return rows.map(mapReminder);
  }

  async findByGroup(id: GroupId): Promise<ReminderInstance[]> {
    const rows = await this.db.all<ReminderRow>(
      `SELECT * FROM reminder_instances WHERE group_id = ? ORDER BY occurrence_at DESC, id DESC`,
      [id]
    );
    return rows.map(mapReminder);
  }

  async resolve(
    id: ReminderId,
    state: Exclude<ReminderState, 'pending'>,
    now: Instant,
    cancelReason?: string
  ): Promise<void> {
    const iso = toIso(now);
    await this.db.run(
      `UPDATE reminder_instances
          SET state = ?, resolved_at = ?, cancel_reason = ?, snoozed_until = NULL, updated_at = ?
        WHERE id = ? AND state = 'pending'`,
      [state, iso, cancelReason ?? null, iso, id]
    );
  }

  async snooze(id: ReminderId, until: Instant, now: Instant): Promise<void> {
    // Updates the existing row. Snooze must never create a second reminder
    // (docs/DOMAIN.md §8.5).
    await this.db.run(
      `UPDATE reminder_instances
          SET snoozed_until = ?, due_at = ?, updated_at = ?
        WHERE id = ? AND state = 'pending'`,
      [toIso(until), toIso(until), toIso(now), id]
    );
  }

  async cancelPendingForGroup(id: GroupId, reason: string, now: Instant): Promise<number> {
    const iso = toIso(now);
    const result = await this.db.run(
      `UPDATE reminder_instances
          SET state = 'cancelled', resolved_at = ?, cancel_reason = ?, updated_at = ?
        WHERE group_id = ? AND state = 'pending'`,
      [iso, reason, iso, id]
    );
    return result.changes;
  }

  async cancelPendingForMembership(
    gid: GroupId,
    cid: ContactReferenceId,
    reason: string,
    now: Instant
  ): Promise<number> {
    const iso = toIso(now);
    const result = await this.db.run(
      `UPDATE reminder_instances
          SET state = 'cancelled', resolved_at = ?, cancel_reason = ?, updated_at = ?
        WHERE group_id = ? AND contact_reference_id = ? AND state = 'pending'`,
      [iso, reason, iso, gid, cid]
    );
    return result.changes;
  }
}

// ── history ─────────────────────────────────────────────────────────────────

export class SqlContactEventRepository implements ContactEventRepository {
  constructor(private readonly db: SqlDriver) {}

  async findById(id: ReturnType<typeof contactEventId>): Promise<ContactEvent | null> {
    const row = await this.db.get<EventRow>('SELECT * FROM contact_events WHERE id = ?', [id]);
    return row ? mapEvent(row) : null;
  }

  async record(input: NewContactEvent, now: Instant): Promise<ContactEvent> {
    const result = await this.db.run(
      `INSERT INTO contact_events
         (contact_reference_id, occurred_at, source, related_reminder_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        input.contactReferenceId,
        toIso(input.occurredAt),
        input.source,
        input.relatedReminderId,
        toIso(now),
      ]
    );
    return (await this.findById(contactEventId(result.lastInsertRowId))) as ContactEvent;
  }

  async findByContact(id: ContactReferenceId): Promise<ContactEvent[]> {
    const rows = await this.db.all<EventRow>(
      'SELECT * FROM contact_events WHERE contact_reference_id = ? ORDER BY occurred_at DESC',
      [id]
    );
    return rows.map(mapEvent);
  }

  async lastContactedAt(id: ContactReferenceId): Promise<Instant | null> {
    // Global by design: contact history belongs to the person, not the group
    // (docs/DOMAIN.md §10.1).
    const row = await this.db.get<{ occurred_at: string }>(
      `SELECT occurred_at FROM contact_events
        WHERE contact_reference_id = ? ORDER BY occurred_at DESC LIMIT 1`,
      [id]
    );
    return row ? fromIso(row.occurred_at) : null;
  }

  async lastContactedBulk(
    ids: readonly ContactReferenceId[]
  ): Promise<Map<ContactReferenceId, Instant>> {
    const out = new Map<ContactReferenceId, Instant>();
    if (ids.length === 0) return out;

    const rows = await this.db.all<{ contact_reference_id: number; last_at: string }>(
      `SELECT contact_reference_id, MAX(occurred_at) AS last_at
         FROM contact_events
        WHERE contact_reference_id IN (${placeholders(ids.length)})
        GROUP BY contact_reference_id`,
      ids as readonly SqlValue[]
    );
    for (const row of rows) {
      out.set(contactReferenceId(row.contact_reference_id), fromIso(row.last_at));
    }
    return out;
  }
}

// ── rotation priority ───────────────────────────────────────────────────────

export class SqlPriorityStateRepository implements PriorityStateRepository {
  constructor(private readonly db: SqlDriver) {}

  async find(id: ContactReferenceId): Promise<PriorityState | null> {
    const row = await this.db.get<PriorityRow>(
      'SELECT * FROM priority_states WHERE contact_reference_id = ?',
      [id]
    );
    return row ? mapPriority(row) : null;
  }

  async findBulk(
    ids: readonly ContactReferenceId[]
  ): Promise<Map<ContactReferenceId, PriorityState>> {
    const out = new Map<ContactReferenceId, PriorityState>();
    if (ids.length === 0) return out;
    const rows = await this.db.all<PriorityRow>(
      `SELECT * FROM priority_states WHERE contact_reference_id IN (${placeholders(ids.length)})`,
      ids as readonly SqlValue[]
    );
    for (const row of rows) out.set(contactReferenceId(row.contact_reference_id), mapPriority(row));
    return out;
  }

  async applySkipPenalty(
    id: ContactReferenceId,
    penaltyUntil: Instant,
    now: Instant
  ): Promise<void> {
    const iso = toIso(now);
    await this.db.run(
      `INSERT INTO priority_states
         (contact_reference_id, skip_penalty_until, skip_count, deprioritized_at, updated_at)
       VALUES (?, ?, 1, NULL, ?)
       ON CONFLICT(contact_reference_id) DO UPDATE SET
         skip_penalty_until = excluded.skip_penalty_until,
         skip_count = skip_count + 1,
         updated_at = excluded.updated_at`,
      [id, toIso(penaltyUntil), iso]
    );
  }

  async setDeprioritized(
    id: ContactReferenceId,
    deprioritizedAt: Instant | null,
    now: Instant
  ): Promise<void> {
    const iso = toIso(now);
    await this.db.run(
      `INSERT INTO priority_states
         (contact_reference_id, skip_penalty_until, skip_count, deprioritized_at, updated_at)
       VALUES (?, NULL, 0, ?, ?)
       ON CONFLICT(contact_reference_id) DO UPDATE SET
         deprioritized_at = excluded.deprioritized_at,
         updated_at = excluded.updated_at`,
      [id, deprioritizedAt === null ? null : toIso(deprioritizedAt), iso]
    );
  }
}

// ── settings ────────────────────────────────────────────────────────────────

export class SqlSettingsRepository implements SettingsRepository {
  constructor(private readonly db: SqlDriver) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.get<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = ?',
      [key]
    );
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.run(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value]
    );
  }

  async all(): Promise<Record<string, string>> {
    const rows = await this.db.all<{ key: string; value: string }>(
      'SELECT key, value FROM app_settings'
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async delete(key: string): Promise<void> {
    await this.db.run('DELETE FROM app_settings WHERE key = ?', [key]);
  }
}

// ── unit of work ────────────────────────────────────────────────────────────

export function createRepositories(db: SqlDriver): Repositories {
  return {
    contacts: new SqlContactReferenceRepository(db),
    groups: new SqlGroupRepository(db),
    memberships: new SqlMembershipRepository(db),
    schedules: new SqlScheduleRepository(db),
    occurrences: new SqlScheduleOccurrenceRepository(db),
    reminders: new SqlReminderRepository(db),
    events: new SqlContactEventRepository(db),
    priorities: new SqlPriorityStateRepository(db),
    settings: new SqlSettingsRepository(db),
  };
}

export class SqlUnitOfWork implements UnitOfWork {
  readonly repositories: Repositories;

  constructor(private readonly db: SqlDriver) {
    this.repositories = createRepositories(db);
  }

  async transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.db.transaction(() => work(this.repositories));
  }
}
