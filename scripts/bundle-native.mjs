/**
 * Builds a native JS bundle and throws away the output.
 *
 * The point is only to prove that Metro can resolve the native dependency
 * graph for a platform. That is not something the unit tests, the web build, or
 * a debug APK can tell you — see the comment on the "Bundle for Android" CI
 * step.
 *
 * Takes the platform as an argument, because iOS needs exactly the same guard
 * and had none. The bug that made this script necessary — the web SQLite driver
 * dragging `node:fs` into the native graph — would have broken the iOS bundle
 * identically, and nothing would have caught it: iOS is not built on every
 * push, and its native compile is currently blocked upstream anyway
 * (docs/PLATFORM.md §6.1). A JS bundle needs no Xcode, so it can be checked on
 * Linux in seconds regardless.
 *
 *   node scripts/bundle-android.mjs            # android, the default
 *   node scripts/bundle-android.mjs ios
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

const platform = process.argv[2] ?? 'android';
if (platform !== 'android' && platform !== 'ios') {
  console.error(`::error::Unknown platform "${platform}". Expected android or ios.`);
  process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), `sc-bundle-${platform}-`));

// Resolved the same way android/app/build.gradle resolves it, so this checks
// the same entry point the real build uses.
const entry = execFileSync(
  process.execPath,
  ['-e', "require('expo/scripts/resolveAppEntry')", process.cwd(), platform, 'absolute'],
  { encoding: 'utf8' }
).trim();

console.log(`Bundling ${entry} for ${platform}...`);

try {
  execFileSync(
    process.execPath,
    [
      require_.resolve('@expo/cli'),
      'export:embed',
      '--platform', platform,
      '--dev', 'false',
      '--entry-file', entry,
      '--bundle-output', join(out, platform === 'ios' ? 'main.jsbundle' : 'index.android.bundle'),
      '--assets-dest', join(out, 'assets'),
    ],
    { stdio: 'inherit' }
  );
  console.log(`${platform} bundle resolved cleanly.`);
} catch {
  console.error('\n::error::The Android JS bundle failed to build. The APK would not build either.');
  process.exitCode = 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
