/**
 * Opens the SQLite driver for the web build. See openPlatformDriver.ts for why
 * this is a separate module rather than a branch.
 *
 * Web uses sql.js rather than expo-sqlite: expo-sqlite's web build needs
 * SharedArrayBuffer and therefore cross-origin isolation, which GitHub Pages
 * cannot provide. sql.js needs neither.
 */
import type { SqlDriver } from '../../ports/SqlDriver';
import { SqlJsDriver } from './SqlJsDriver';

export function openPlatformDriver(): Promise<SqlDriver> {
  return SqlJsDriver.open();
}
