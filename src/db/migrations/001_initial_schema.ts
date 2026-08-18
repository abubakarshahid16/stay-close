import type { SQLiteDatabase } from 'expo-sqlite';

export const migration001 = async (db: SQLiteDatabase): Promise<void> => {
  await db.execAsync(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS circles (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT    NOT NULL CHECK(length(trim(name)) > 0 AND length(name) <= 100),
      reminder_frequency TEXT   NOT NULL CHECK(reminder_frequency IN (
        'daily', 'every_3_days', 'weekly', 'every_2_weeks', 'monthly'
      )),
      created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_circles_name ON circles(name);

    CREATE TABLE IF NOT EXISTS circle_people (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      circle_id            INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      contact_identifier   TEXT    NOT NULL,
      display_name         TEXT    NOT NULL CHECK(length(trim(display_name)) > 0),
      phone_number         TEXT,
      created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      last_suggested_at    TEXT,
      suggestion_count     INTEGER NOT NULL DEFAULT 0 CHECK(suggestion_count >= 0),
      UNIQUE(circle_id, contact_identifier)
    );

    CREATE INDEX IF NOT EXISTS idx_circle_people_circle_id ON circle_people(circle_id);
    CREATE INDEX IF NOT EXISTS idx_circle_people_last_suggested ON circle_people(last_suggested_at);
    CREATE INDEX IF NOT EXISTS idx_circle_people_suggestion_count ON circle_people(suggestion_count);

    CREATE TABLE IF NOT EXISTS reminder_history (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      circle_id        INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
      circle_person_id INTEGER NOT NULL REFERENCES circle_people(id) ON DELETE CASCADE,
      suggested_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      action           TEXT    NOT NULL CHECK(action IN ('shown', 'completed', 'skipped', 'replaced')),
      completed_at     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_reminder_history_circle_id ON reminder_history(circle_id);
    CREATE INDEX IF NOT EXISTS idx_reminder_history_person_id ON reminder_history(circle_person_id);
    CREATE INDEX IF NOT EXISTS idx_reminder_history_suggested_at ON reminder_history(suggested_at);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    PRAGMA user_version = 1;
  `);
};
