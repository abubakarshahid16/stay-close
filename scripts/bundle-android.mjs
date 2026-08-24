/**
 * Builds the Android JS bundle and throws away the output.
 *
 * The point is only to prove that Metro can resolve the native dependency
 * graph. That is not something the unit tests, the web build, or a debug APK
 * can tell you — see the comment on the "Bundle for Android" CI step.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const out = mkdtempSync(join(tmpdir(), 'sc-bundle-'));

// Resolved the same way android/app/build.gradle resolves it, so this checks
// the same entry point the real build uses.
const entry = execFileSync(
  process.execPath,
  ['-e', "require('expo/scripts/resolveAppEntry')", process.cwd(), 'android', 'absolute'],
  { encoding: 'utf8' }
).trim();

console.log(`Bundling ${entry} for Android...`);

try {
  execFileSync(
    process.execPath,
    [
      require_.resolve('@expo/cli'),
      'export:embed',
      '--platform', 'android',
      '--dev', 'false',
      '--entry-file', entry,
      '--bundle-output', join(out, 'index.android.bundle'),
      '--assets-dest', join(out, 'assets'),
    ],
    { stdio: 'inherit' }
  );
  console.log('\nAndroid bundle resolved cleanly.');
} catch {
  console.error('\n::error::The Android JS bundle failed to build. The APK would not build either.');
  process.exitCode = 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
