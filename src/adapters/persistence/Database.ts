/**
 * Migration runner (issue 007 / #18).
 *
 * Forward-only, numbered migrations anchored on PRAGMA user_version. Each runs
 * inside a transaction, so a failure leaves the schema at its previous version
 * rather than half-applied.
 *
 * Deliberately driver-agnostic: the same runner is used against expo-sqlite on
 * device and node:sqlite in tests, so migrations are verified by the same code
 * path that runs in production.
 */
import type { SqlDriver } from '../../ports/SqlDriver';
import { migration001 } from './migrations/001_initial';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: (driver: SqlDriver) => Promise<void>;
}

/** Ordered, forward-only. Append; never edit a released entry. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: '001_initial', up: migration001 },
];

export const LATEST_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

export async function getSchemaVersion(driver: SqlDriver): Promise<number> {
  const row = await driver.get<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Apply every migration newer than the current schema version.
 * Safe to call on every launch — it is a no-op once current.
 */
export async function migrate(driver: SqlDriver): Promise<number> {
  // Must be set per connection; it does not persist in the database file.
  await driver.exec('PRAGMA foreign_keys = ON;');

  const current = await getSchemaVersion(driver);
  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version
  );

  for (const migration of pending) {
    await driver.transaction(async () => {
      await migration.up(driver);
      // PRAGMA does not accept bound parameters, and `version` comes from the
      // hardcoded MIGRATIONS list above, never from user input.
      await driver.exec(`PRAGMA user_version = ${migration.version};`);
    });
  }

  return getSchemaVersion(driver);
}

/**
 * Verify the schema is at the expected version.
 * Used by startup reconciliation (issue 043) to fail loudly rather than
 * operating against an unexpected schema.
 */
export async function assertSchemaCurrent(driver: SqlDriver): Promise<void> {
  const version = await getSchemaVersion(driver);
  if (version !== LATEST_VERSION) {
    throw new Error(
      `Schema version mismatch: found ${version}, expected ${LATEST_VERSION}. Migrations did not complete.`
    );
  }
}
