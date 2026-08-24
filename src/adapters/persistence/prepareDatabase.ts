/**
 * Database bootstrapping and availability (issue 044 / #55).
 *
 * Lives in the persistence adapter, not the application layer: opening,
 * migrating and validating a SQLite database is inherently about the concrete
 * storage mechanism. The lint rule in docs/ARCHITECTURE.md §2.1 caught this
 * being in the wrong layer, correctly.
 *
 * The rule that governs everything here: **nothing in this file may destroy
 * data.** A corrupt database might still hold years of relationship history —
 * the very thing the product exists to remember — so recovery is a decision
 * surfaced to the user, never an automatic wipe (docs/ARCHITECTURE.md §6).
 */
import type { SqlDriver } from '../../ports/SqlDriver';
import { assertSchemaCurrent, migrate } from './Database';

export type DatabaseStatus =
  | { readonly kind: 'ready' }
  /** Opened, but the schema is not what this build expects. */
  | { readonly kind: 'schema-mismatch'; readonly detail: string }
  /** Could not be opened or migrated at all. */
  | { readonly kind: 'unavailable'; readonly detail: string };

/**
 * Bring the database to a usable state, or report precisely why it is not.
 *
 * Deliberately attempts no automatic repair.
 */
export async function prepareDatabase(driver: SqlDriver): Promise<DatabaseStatus> {
  try {
    await migrate(driver);
  } catch (error) {
    return {
      kind: 'unavailable',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    await assertSchemaCurrent(driver);
  } catch (error) {
    return {
      kind: 'schema-mismatch',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  return { kind: 'ready' };
}

/**
 * What the user can be offered when the database is unusable.
 *
 * `erase-and-restart` is destructive and must never be automatic. It is listed
 * so a recovery screen can offer it behind an explicit confirmation — the only
 * circumstance in which history may be discarded.
 */
export type RecoveryOption = 'retry' | 'continue-read-only' | 'erase-and-restart';

export function recoveryOptionsFor(status: DatabaseStatus): RecoveryOption[] {
  switch (status.kind) {
    case 'ready':
      return [];
    case 'schema-mismatch':
    case 'unavailable':
      // Retry first: a partially-applied migration often succeeds on a second
      // attempt, so erasing should be the last resort rather than the first.
      return ['retry', 'erase-and-restart'];
  }
}
