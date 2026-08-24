/**
 * Production SqlDriver, backed by expo-sqlite.
 *
 * The counterpart to NodeSqlDriver (tests). Both implement the same port, so
 * repositories and migrations run identical code and identical SQL on device
 * and in CI.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { SqlDriver, SqlRunResult, SqlValue } from '../../ports/SqlDriver';

export const DATABASE_NAME = 'stay-close.db';

export class ExpoSqlDriver implements SqlDriver {
  private inTransaction = false;

  constructor(private readonly db: SQLiteDatabase) {}

  /**
   * Imported lazily rather than at module scope.
   *
   * On web, expo-sqlite's entry point sets up a Worker and a
   * SharedArrayBuffer channel as a side effect of being imported. If that
   * throws — and it does when the page is not cross-origin isolated — a
   * top-level import takes the whole bundle down with it, and the app renders
   * a blank page with no way to report anything.
   *
   * Deferring it means the failure lands inside a promise we already catch, so
   * the app can show a real error instead.
   */
  static async open(name: string = DATABASE_NAME): Promise<ExpoSqlDriver> {
    const sqlite = await import('expo-sqlite');
    return new ExpoSqlDriver(await sqlite.openDatabaseAsync(name));
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
