/**
 * SqlDriver port — the narrow SQL surface the persistence layer needs.
 *
 * Exists so repositories can run against expo-sqlite on device and node:sqlite
 * in tests, with identical code and identical SQL. That is what lets the
 * persistence suite run anywhere with zero native build, replacing the old
 * better-sqlite3 test adapter which needed an MSVC toolchain on Windows
 * (docs/PLATFORM.md §3).
 *
 * This is the only abstraction over SQL. Repositories still write SQL by hand;
 * there is no ORM (docs/ARCHITECTURE.md §8).
 */

export type SqlValue = string | number | null;

export interface SqlRunResult {
  readonly lastInsertRowId: number;
  readonly changes: number;
}

export interface SqlDriver {
  /** Execute one or more statements with no parameters and no result. */
  exec(sql: string): Promise<void>;

  /** Execute a single writing statement. */
  run(sql: string, params?: readonly SqlValue[]): Promise<SqlRunResult>;

  /** First matching row, or null. */
  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;

  /** All matching rows. */
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;

  /**
   * Run `work` inside a transaction, committing on success and rolling back on
   * any thrown error. Implementations must not swallow the error.
   */
  transaction<T>(work: () => Promise<T>): Promise<T>;

  close(): Promise<void>;
}
