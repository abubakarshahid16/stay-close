import * as SQLite from 'expo-sqlite';
import { migration001 } from './migrations/001_initial_schema';

const DB_NAME = 'stay-close.db';
const CURRENT_VERSION = 1;

let _db = null;

export async function getDatabase() {
  if (_db) return _db;
  try {
    _db = await openDatabase();
  } catch (err) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    _db = await openDatabase();
  }
  return _db;
}

export async function openDatabase(name = DB_NAME) {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await runMigrations(db);
  return db;
}

async function runMigrations(db) {
  const result = await db.getFirstAsync('PRAGMA user_version');
  const currentVersion = result?.user_version ?? 0;
  if (currentVersion >= CURRENT_VERSION) return;

  if (currentVersion < 1) {
    await db.withTransactionAsync(async () => {
      await migration001(db);
    });
  }
}

export async function closeDatabase() {
  if (_db) {
    await _db.closeAsync();
    _db = null;
  }
}

export function _resetDatabaseSingleton() {
  _db = null;
}

export async function resetLocalData() {
  _db = null;
  if (typeof navigator !== 'undefined' && 'storage' in navigator) {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(DB_NAME, { recursive: true }).catch(() => {});
    } catch {
    }
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage?.clear();
      window.sessionStorage?.clear();
    } catch {
    }
    window.location.reload();
  }
}

export function nowISO() {
  return new Date().toISOString();
}
