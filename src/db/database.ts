import * as SQLite from 'expo-sqlite';
import { migration001 } from './migrations/001_initial_schema';

const DB_NAME = 'stay-close.db';
const CURRENT_VERSION = 1;

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  try {
    _db = await openDatabase();
  } catch (err) {
    // On web, the OPFS file lock/worker state from a just-closed tab or
    // navigation can briefly be inconsistent when the new page tries to
    // open it (various error shapes: "Access Handle", "NoModificationAllowedError",
    // "Invalid VFS state", etc). Retry once after a short delay so that
    // transient race doesn't surface as a hard error to the user.
    await new Promise((resolve) => setTimeout(resolve, 500));
    _db = await openDatabase();
  }
  return _db;
}

export async function openDatabase(
  name: string = DB_NAME
): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(name);

  // Enable foreign keys on every connection
  await db.execAsync('PRAGMA foreign_keys = ON;');

  // Run migrations
  await runMigrations(db);

  return db;
}

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  const result = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version'
  );
  const currentVersion = result?.user_version ?? 0;
  if (currentVersion >= CURRENT_VERSION) return;

  if (currentVersion < 1) {
    await db.withTransactionAsync(async () => {
      await migration001(db);
    });
  }

  // Future migrations: if (currentVersion < 2) { ... }
}

export async function closeDatabase(): Promise<void> {
  if (_db) {
    await _db.closeAsync();
    _db = null;
  }
}

/** For testing only — resets the singleton */
export function _resetDatabaseSingleton(): void {
  _db = null;
}

export function nowISO(): string {
  return new Date().toISOString();
}
