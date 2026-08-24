/**
 * SqlDriver for the browser, built on sql.js.
 *
 * Replaces expo-sqlite on web, and the reason is architectural rather than
 * cosmetic. expo-sqlite's web build needs a chain of five things to all hold:
 * WASM, a Worker, SharedArrayBuffer, Atomics.wait, and therefore cross-origin
 * isolation — which static hosts like GitHub Pages cannot provide without a
 * service worker synthesising COOP/COEP headers, which then requires CORP on
 * every asset, and only takes effect on the second page load. Every link in
 * that chain is a way for the app to hang or blank out.
 *
 * sql.js is single-threaded SQLite compiled to WASM. No Worker, no
 * SharedArrayBuffer, no isolation, no header manipulation. It runs on any
 * static host.
 *
 * The trade: sql.js holds the database in memory and must be persisted
 * explicitly. This driver snapshots it to IndexedDB after every write, which is
 * appropriate here — the data is a few hundred rows of groups, reminders and
 * history, not a large dataset.
 *
 * Because repositories talk to the SqlDriver port and write plain SQL, every
 * repository, migration and test works unchanged against this.
 */
import type { SqlDriver, SqlRunResult, SqlValue } from '../../ports/SqlDriver';

/** Minimal shape of the sql.js pieces used here, to avoid a hard type dependency. */
interface SqlJsStatement {
  bind(params: SqlValue[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}

interface SqlJsDatabase {
  run(sql: string, params?: SqlValue[]): void;
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  prepare(sql: string): SqlJsStatement;
  export(): Uint8Array;
  close(): void;
}

interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
}

/**
 * Re-applied after every snapshot.
 *
 * sql.js's export() resets connection-scoped pragmas, and this driver exports
 * on every write. Without re-applying, foreign keys silently switch off after
 * the first save — which would quietly disable every ON DELETE SET NULL and
 * RESTRICT rule protecting user history (docs/DATABASE.md §2.2). Caught by
 * test, not by inspection.
 */
const CONNECTION_PRAGMAS = 'PRAGMA foreign_keys = ON;';

const IDB_NAME = 'stay-close-storage';
const IDB_STORE = 'database';
const IDB_KEY = 'sqlite';

/** Debounce window for snapshots, so a burst of writes costs one save. */
const PERSIST_DEBOUNCE_MS = 250;

// ── IndexedDB helpers ───────────────────────────────────────────────────────

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
  });
}

async function loadSnapshot(): Promise<Uint8Array | undefined> {
  const idb = await openIdb();
  try {
    return await new Promise<Uint8Array | undefined>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const request = tx.objectStore(IDB_STORE).get(IDB_KEY);
      request.onsuccess = () => {
        const value = request.result;
        resolve(value instanceof Uint8Array ? value : undefined);
      };
      request.onerror = () => reject(request.error ?? new Error('Could not read the database'));
    });
  } finally {
    idb.close();
  }
}

async function saveSnapshot(bytes: Uint8Array): Promise<void> {
  const idb = await openIdb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not save the database'));
    });
  } finally {
    idb.close();
  }
}

/** Where the sql.js wasm lives, resolved against the deployed base path. */
function wasmUrl(file: string): string {
  if (typeof document !== 'undefined' && document.baseURI) {
    return new URL(file, document.baseURI).toString();
  }
  return `./${file}`;
}

// ── driver ──────────────────────────────────────────────────────────────────

export class SqlJsDriver implements SqlDriver {
  private inTransaction = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persisting: Promise<void> = Promise.resolve();

  private constructor(private readonly db: SqlJsDatabase) {}

  /**
   * @param locateWasm Overrides where the sql.js wasm is fetched from. Exists so
   *   the web database can be exercised under Node in tests, where there is no
   *   document to resolve a URL against — this path had previously only ever
   *   been verified by deploying it.
   */
  static async open(locateWasm?: (file: string) => string): Promise<SqlJsDriver> {
    // Imported dynamically so a load failure lands in a promise the caller
    // catches, rather than throwing at module scope and blanking the page.
    const module = await import('sql.js');
    const initSqlJs = (module.default ?? module) as unknown as (
      config?: { locateFile?: (file: string) => string }
    ) => Promise<SqlJsStatic>;

    const SQL = await initSqlJs({ locateFile: locateWasm ?? wasmUrl });

    // Restore the previous session if there is one.
    let snapshot: Uint8Array | undefined;
    try {
      snapshot = await loadSnapshot();
    } catch {
      // A private window or blocked storage. Start fresh rather than fail —
      // the app is still usable, just not persistent.
      snapshot = undefined;
    }

    const driver = new SqlJsDriver(new SQL.Database(snapshot));
    driver.applyConnectionPragmas();
    return driver;
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
    this.schedulePersist();
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<SqlRunResult> {
    this.db.run(sql, params as SqlValue[]);

    // sql.js exposes neither directly on run(), so read them back. Both are
    // connection-scoped and this driver is single-threaded, so they are safe.
    const meta = this.db.exec('SELECT last_insert_rowid() AS id, changes() AS changed');
    const row = meta[0]?.values?.[0] ?? [0, 0];

    this.schedulePersist();
    return {
      lastInsertRowId: Number(row[0] ?? 0),
      changes: Number(row[1] ?? 0),
    };
  }

  async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params as SqlValue[]);
      return statement.step() ? (statement.getAsObject() as T) : null;
    } finally {
      statement.free();
    }
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params as SqlValue[]);
      const rows: T[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as T);
      return rows;
    } finally {
      statement.free();
    }
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    // SQLite has no nested transactions, and the migration runner may call this
    // while a use case already holds one. Join the outer transaction.
    if (this.inTransaction) return work();

    this.db.exec('BEGIN');
    this.inTransaction = true;
    try {
      const result = await work();
      this.db.exec('COMMIT');
      this.inTransaction = false;
      // Persist immediately on commit rather than waiting for the debounce, so
      // a tab closed straight after a write does not lose it.
      await this.persistNow();
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.inTransaction = false;
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.flush();
    this.db.close();
  }

  /** Wait for any pending snapshot. Used on close and by tests. */
  async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.persistNow();
  }

  private schedulePersist(): void {
    // Inside a transaction the database is mid-change; persisting then could
    // snapshot a partial state. The commit path handles it instead.
    if (this.inTransaction) return;

    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow();
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * Connection-scoped settings that must hold for correctness. Public only so
   * open() can call it before the instance is handed out.
   */
  applyConnectionPragmas(): void {
    this.db.exec(CONNECTION_PRAGMAS);
  }

  private snapshot(): Uint8Array {
    const bytes = this.db.export();
    // export() resets connection-scoped pragmas, so restore them immediately —
    // before any further statement can run against a connection with foreign
    // keys silently disabled.
    this.applyConnectionPragmas();
    return bytes;
  }

  private persistNow(): Promise<void> {
    // Snapshot synchronously, so the pragma restore happens before any
    // subsequent statement, regardless of when the save settles.
    const bytes = this.snapshot();

    // Chained so two snapshots cannot interleave and write out of order.
    this.persisting = this.persisting
      .then(() => saveSnapshot(bytes))
      .catch(() => {
        // Storage full, or blocked in a private window. The in-memory database
        // still works for this session; losing persistence must not break the
        // app mid-use.
      });
    return this.persisting;
  }
}
