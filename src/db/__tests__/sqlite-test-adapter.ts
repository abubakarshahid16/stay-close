/**
 * SQLite test adapter using better-sqlite3.
 *
 * Provides an async-compatible API matching expo-sqlite's SQLiteDatabase
 * so repository tests can run in Node.js without native modules.
 */
import Database from 'better-sqlite3';

interface RunResult {
  lastInsertRowId: number;
  changes: number;
}

export class TestSQLiteDatabase {
  private db: Database.Database;

  constructor(filename: string = ':memory:') {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
  }

  async execAsync(sql: string): Promise<void> {
    // Handle PRAGMA user_version = N specially
    const pragmaMatch = sql.match(/PRAGMA user_version\s*=\s*(\d+)/);
    if (pragmaMatch) {
      this.db.pragma(`user_version = ${pragmaMatch[1]}`);
      // Also run the rest if there's more SQL
      const rest = sql.replace(/PRAGMA user_version\s*=\s*\d+\s*;?/g, '');
      if (rest.trim()) {
        this.db.exec(rest);
      }
      return;
    }
    this.db.exec(sql);
  }

  async runAsync(sql: string, params: (string | number | null)[] = []): Promise<RunResult> {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);
    return {
      lastInsertRowId: Number(result.lastInsertRowid),
      changes: result.changes,
    };
  }

  async getFirstAsync<T>(sql: string, params: (string | number | null)[] = []): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as T | undefined;
    return row ?? null;
  }

  async getAllAsync<T>(sql: string, params: (string | number | null)[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
    // better-sqlite3 doesn't support async transaction callbacks;
    // use manual BEGIN/COMMIT/ROLLBACK instead.
    this.db.exec('BEGIN');
    try {
      await fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async closeAsync(): Promise<void> {
    this.db.close();
  }
}

/**
 * Open an in-memory SQLite database for testing.
 * Applies the same migrations as the production database.
 */
export async function openTestDatabase(): Promise<TestSQLiteDatabase> {
  const db = new TestSQLiteDatabase(':memory:');
  await applyMigrations(db);
  return db;
}

async function applyMigrations(db: TestSQLiteDatabase): Promise<void> {
  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = result?.user_version ?? 0;

  if (version < 1) {
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
    `);
    db['db'].pragma('user_version = 1');
  }
}
