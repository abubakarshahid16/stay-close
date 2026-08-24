/**
 * Opens the SQLite driver for a native build.
 *
 * This exists as a platform-resolved module pair rather than a `Platform.OS`
 * branch because of what a bundler does with the branch it does not take.
 *
 * AppContext used to import BOTH drivers and pick between them at runtime. On
 * web that was fine. On Android it was fatal: importing SqlJsDriver pulls in
 * sql.js, whose Node build calls `require("node:fs")`, and Metro cannot
 * resolve `node:fs` for a native target. The Android bundle therefore failed
 * to build at all.
 *
 * A `Platform.OS` check cannot help — it runs long after bundling, by which
 * point the import has already had to resolve. Metro picks `.web.ts` for web
 * and this file everywhere else, so the web driver is never even parsed for a
 * native build, and vice versa.
 *
 * This went unnoticed because the release APK is the only artefact that
 * bundles JS for Android, and the workflow was building the debug variant,
 * which does not bundle at all.
 */
import type { SqlDriver } from '../../ports/SqlDriver';
import { ExpoSqlDriver } from './ExpoSqlDriver';

export function openPlatformDriver(): Promise<SqlDriver> {
  return ExpoSqlDriver.open();
}
