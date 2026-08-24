/**
 * Production SqlDriver, backed by expo-sqlite.
 *
 * The counterpart to NodeSqlDriver (tests). Both implement the same port, so
 * repositories and migrations run identical code and identical SQL on device
 * and in CI.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { openDatabaseAsync } from 'expo-sqlite';
import type { SqlDriver, SqlRunResult, SqlValue } from '../../ports/SqlDriver';

export const DATABASE_NAME = 'stay-close.db';

export class ExpoSqlDriver implements SqlDriver {
  private inTransaction = false;

  constructor(private readonly db: SQLiteDatabase) {}

  static async open(name: string = DATABASE_NAME): Promise<ExpoSqlDriver> {
    return new ExpoSqlDriver(await openDatabaseAsync(name));
  }

  async exec(sql: string): Promise<void> {
    await this.db.execAsync(sql);
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<SqlRunResult> {
    const result = await this.db.runAsync(sql, params as SqlValue[]);
    return { lastInsertRowId: result.lastInsertRowId, changes: result.changes };
  }

  async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
    return (await this.db.getFirstAsync<T>(sql, params as SqlValue[])) ?? null;
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.db.getAllAsync<T>(sql, params as SqlValue[]);
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    // SQLite has no nested transactions, and the migration runner calls
    // transaction() while a use case may already hold one. Join the outer
    // transaction rather than failing.
    if (this.inTransaction) return work();

    let result!: T;
    this.inTransaction = true;
    try {
      await this.db.withTransactionAsync(async () => {
        result = await work();
      });
    } finally {
      this.inTransaction = false;
    }
    return result;
  }

  async close(): Promise<void> {
    await this.db.closeAsync();
  }
}
