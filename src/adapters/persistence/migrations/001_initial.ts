/**
 * Migration 001 — initial schema (issues 006 / #17, 007 / #18).
 *
 * Design notes that are load-bearing, not incidental:
 *
 * - `contact_references.phone_e164` is UNIQUE and NOT NULL because it is the
 *   durable identity anchor. `native_id` is nullable and repairable, since
 *   Android changes `_ID` on aggregation/sync and iOS identifiers are
 *   device-local (docs/PLATFORM.md §1.3).
 *
 * - History NEVER cascades. `reminder_instances` and `contact_events` hold
 *   what the app asked and what the user confirmed; docs/DOMAIN.md §3 and
 *   §10.2 require both to survive group deletion, membership removal, schedule
 *   change and native-contact deletion. So their group/schedule links are
 *   nullable with ON DELETE SET NULL, and a group name snapshot keeps the row
 *   readable afterwards. Using CASCADE here would silently destroy user
 *   history — the exact failure the spec forbids.
 *
 * - `contact_references` is never deleted (ON DELETE RESTRICT from everything
 *   that points at it). A person who leaves the address book becomes
 *   `unavailable`, not absent.
 *
 * - `schedule_occurrences` is the idempotence anchor. It records that a cycle
 *   was processed even when it selected zero people, so re-running the
 *   scheduler cannot regenerate it (docs/DOMAIN.md §14.1).
 */
import type { SqlDriver } from '../../../ports/SqlDriver';

export const MIGRATION_001_VERSION = 1;

export async function migration001(driver: SqlDriver): Promise<void> {
  await driver.exec(`
    CREATE TABLE IF NOT EXISTS contact_references (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      native_id           TEXT,
      phone_e164          TEXT    NOT NULL UNIQUE,
      display_name_cache  TEXT    NOT NULL,
      availability        TEXT    NOT NULL DEFAULT 'available'
                            CHECK(availability IN ('available', 'unavailable')),
      created_at          TEXT    NOT NULL,
      updated_at          TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_contact_refs_native ON contact_references(native_id);
    CREATE INDEX IF NOT EXISTS idx_contact_refs_availability ON contact_references(availability);

    CREATE TABLE IF NOT EXISTS groups (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL
                    CHECK(length(trim(name)) > 0 AND length(name) <= 100),
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memberships (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id              INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      contact_reference_id  INTEGER NOT NULL REFERENCES contact_references(id) ON DELETE RESTRICT,
      active                INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      created_at            TEXT    NOT NULL,
      updated_at            TEXT    NOT NULL,
      UNIQUE(group_id, contact_reference_id)
    );

    CREATE INDEX IF NOT EXISTS idx_memberships_group ON memberships(group_id, active);
    CREATE INDEX IF NOT EXISTS idx_memberships_contact ON memberships(contact_reference_id);

    CREATE TABLE IF NOT EXISTS schedules (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id          INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      people_per_cycle  INTEGER NOT NULL CHECK(people_per_cycle >= 1),
      cadence           TEXT    NOT NULL CHECK(cadence IN (
                          'daily', 'every_x_days', 'weekly', 'every_x_weeks', 'monthly'
                        )),
      interval_count    INTEGER NOT NULL DEFAULT 1 CHECK(interval_count >= 1),
      weekday           INTEGER CHECK(weekday IS NULL OR (weekday BETWEEN 0 AND 6)),
      month_day         INTEGER CHECK(month_day IS NULL OR (month_day BETWEEN 1 AND 31)),
      hour              INTEGER NOT NULL CHECK(hour BETWEEN 0 AND 23),
      minute            INTEGER NOT NULL CHECK(minute BETWEEN 0 AND 59),
      anchor_at         TEXT    NOT NULL,
      active            INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      created_at        TEXT    NOT NULL,
      updated_at        TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_schedules_group ON schedules(group_id, active);

    -- Idempotence anchor: one row per processed cycle, even when zero people
    -- were selected. Without this, an empty cycle would be regenerated on
    -- every scheduler run.
    CREATE TABLE IF NOT EXISTS schedule_occurrences (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id     INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      occurrence_at   TEXT    NOT NULL,
      generated_at    TEXT    NOT NULL,
      selected_count  INTEGER NOT NULL DEFAULT 0 CHECK(selected_count >= 0),
      UNIQUE(schedule_id, occurrence_at)
    );

    -- History. Group and schedule links are nullable ON DELETE SET NULL so
    -- these rows outlive the group they came from (docs/DOMAIN.md §3).
    CREATE TABLE IF NOT EXISTS reminder_instances (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id           INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
      group_id              INTEGER REFERENCES groups(id) ON DELETE SET NULL,
      group_name_snapshot   TEXT    NOT NULL,
      contact_reference_id  INTEGER NOT NULL REFERENCES contact_references(id) ON DELETE RESTRICT,
      occurrence_at         TEXT    NOT NULL,
      due_at                TEXT    NOT NULL,
      state                 TEXT    NOT NULL CHECK(state IN (
                              'pending', 'completed', 'skipped', 'deprioritized', 'cancelled'
                            )),
      snoozed_until         TEXT,
      resolved_at           TEXT,
      cancel_reason         TEXT,
      created_at            TEXT    NOT NULL,
      updated_at            TEXT    NOT NULL,
      UNIQUE(schedule_id, occurrence_at, contact_reference_id)
    );

    -- Global pending lookup (docs/DOMAIN.md §6) — must be fast and must not be
    -- scoped by group.
    CREATE INDEX IF NOT EXISTS idx_reminders_pending
      ON reminder_instances(contact_reference_id, state);
    CREATE INDEX IF NOT EXISTS idx_reminders_state_due
      ON reminder_instances(state, due_at);
    CREATE INDEX IF NOT EXISTS idx_reminders_group ON reminder_instances(group_id);

    CREATE TABLE IF NOT EXISTS contact_events (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_reference_id  INTEGER NOT NULL REFERENCES contact_references(id) ON DELETE RESTRICT,
      occurred_at           TEXT    NOT NULL,
      source                TEXT    NOT NULL CHECK(source IN (
                              'reminder_completion', 'manual_log'
                            )),
      related_reminder_id   INTEGER REFERENCES reminder_instances(id) ON DELETE SET NULL,
      created_at            TEXT    NOT NULL
    );

    -- Last-contact lookup is the hottest read in rotation.
    CREATE INDEX IF NOT EXISTS idx_contact_events_person
      ON contact_events(contact_reference_id, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS priority_states (
      contact_reference_id  INTEGER PRIMARY KEY REFERENCES contact_references(id) ON DELETE RESTRICT,
      skip_penalty_until    TEXT,
      skip_count            INTEGER NOT NULL DEFAULT 0 CHECK(skip_count >= 0),
      deprioritized_at      TEXT,
      updated_at            TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key    TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    );
  `);
}
