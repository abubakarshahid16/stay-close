/**
 * SqlDriver backed by Node's built-in `node:sqlite`.
 *
 * Used by the persistence test suite. Replaces the old better-sqlite3 test
 * adapter, which needed a native build (MSVC on Windows) and therefore could
 * not run on every contributor's machine — it aborted the whole devDependency
 * install. `node:sqlite` ships with Node 24, so the persistence suite now needs
 * no native toolchain at all.
 *
 * Test-only. Production uses ExpoSqlDriver.
 */
import { DatabaseSync } from 'node:sqlite';
import type { SqlDriver, SqlRunResult, SqlValue } from '../ports/SqlDriver';

export class NodeSqlDriver implements SqlDriver {
  private readonly db: DatabaseSync;
  private inTransaction = false;

  constructor(location = ':memory:') {
    this.db = new DatabaseSync(location);
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<SqlRunResult> {
    const result = this.db.prepare(sql).run(...(params as SqlValue[]));
    return {
      lastInsertRowId: Number(result.lastInsertRowid ?? 0),
      changes: Number(result.changes ?? 0),
    };
  }

  async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
    const row = this.db.prepare(sql).get(...(params as SqlValue[]));
    return (row as T | undefined) ?? null;
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as SqlValue[])) as T[];
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    // SQLite has no nested transactions. Migrations call transaction() while a
    // caller may already hold one, so join the outer one rather than failing.
    if (this.inTransaction) return work();

    this.db.exec('BEGIN');
    this.inTransaction = true;
    try {
      const result = await work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
