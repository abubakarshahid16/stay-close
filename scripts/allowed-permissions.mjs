/**
 * Prints every permission the built APK is allowed to contain, one per line.
 *
 * The APK permission check in .github/workflows/build-android.yml asserts an
 * exact set, and it reads that set from here rather than restating it. A
 * hardcoded copy in the workflow is what let the list drift: it named only the
 * three android.permission.* entries, so ten vendor-prefixed permissions
 * (Firebase push receive, Play install referrer, seven OEM badge permissions)
 * sat in the APK unnoticed.
 *
 * Two sources, with different meanings:
 *
 *   ALLOWED    permissions this product asks the user for, each with a written
 *              justification.
 *   TOLERATED  permissions that appear in the merged manifest but are not
 *              requests of the user and must not be stripped - currently just
 *              the signature-level, app-scoped one AndroidX defines for its own
 *              receivers.
 *
 * A separate script rather than an inline `node -e` because the workflow is
 * YAML: an inline one-liner needs escaped newlines inside a block scalar, and
 * getting that subtly wrong produces a file that parses as a job with no steps.
 */
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const plugin = require_('../plugins/withMinimalPermissions.js');

const allowed = [
  ...Object.keys(plugin.ALLOWED_PERMISSIONS),
  ...plugin.TOLERATED_PERMISSIONS,
];

for (const name of [...new Set(allowed)].sort()) {
  console.log(name);
}
