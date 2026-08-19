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

/**
 * Last-resort recovery for web: wipes the on-device SQLite file entirely
 * and reloads. Used from the error screen when the app can't even open the
 * database (so normal in-app "delete my data" is unreachable). Nothing is
 * ever sent anywhere — this only clears local browser storage on this device.
 */
export async function resetLocalData(): Promise<void> {
  _db = null;
  if (typeof navigator !== 'undefined' && 'storage' in navigator) {
    try {
      const root = await (navigator.storage as any).getDirectory();
      await root.removeEntry(DB_NAME, { recursive: true }).catch(() => {});
    } catch {
      // OPFS not available or already clear — nothing to do
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.clear();
      window.sessionStorage?.clear();
    } catch {
      // ignore
    }
    window.location.reload();
  }
}

export function nowISO(): string {
  return new Date().toISOString();
}
