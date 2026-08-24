/**
 * Config plugin: enforce the minimum-permission rule as an ALLOWLIST.
 *
 * Supersedes the earlier withReadOnlyContacts, which stripped a blocklist of
 * one permission. A blocklist is the wrong shape here, and the dependency audit
 * (issue 047) showed why: `expo-file-system` is a *transitive* dependency of
 * `expo` itself, and its config plugin adds
 *
 *     android.permission.INTERNET
 *     android.permission.READ_EXTERNAL_STORAGE
 *     android.permission.WRITE_EXTERNAL_STORAGE
 *
 * We never asked for that package and we never use it. With a blocklist we
 * would have had to know in advance to name those three — and the next
 * transitive plugin would add something we had never heard of, silently.
 *
 * So this strips everything NOT explicitly justified. A new permission from
 * anywhere in the tree is removed by default and has to be argued for by adding
 * it here, which is exactly the review step docs/PRODUCT.md §5 asks for.
 *
 * INTERNET is the one worth calling out. Stay Close makes no network requests at
 * all (verified by the audit and guarded by a test), so an app that cannot reach
 * the network is a meaningful privacy property rather than a technicality.
 *
 * NOTE: a release build must be checked to confirm this actually applied —
 * see docs/DEVICE_VERIFICATION.md §1.
 */
const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Every Android permission this product justifies, with the reason.
 * docs/PRODUCT.md §5 requires a functional justification for each.
 */
const ALLOWED = {
  'android.permission.READ_CONTACTS':
    'The native address book is the source of truth for who the user knows.',
  'android.permission.POST_NOTIFICATIONS':
    'Local reminders must be deliverable when the app is closed.',
  'android.permission.RECEIVE_BOOT_COMPLETED':
    'Re-register scheduled local notifications after a reboot.',
};

const PERMISSION_KEYS = ['uses-permission', 'uses-permission-sdk-23'];

/**
 * Remove every permission not in ALLOWED, in place.
 *
 * Tolerant of malformed entries: throwing here would fail the whole native
 * build for a cosmetic reason.
 *
 * @param {Record<string, unknown>} manifest
 * @returns {{ manifest: Record<string, unknown>, removed: string[] }}
 */
function enforceMinimalPermissions(manifest) {
  const removed = [];
  if (!manifest || typeof manifest !== 'object') return { manifest, removed };

  for (const key of PERMISSION_KEYS) {
    const entries = manifest[key];
    if (!Array.isArray(entries)) continue;

    manifest[key] = entries.filter((entry) => {
      const name = entry && entry.$ ? entry.$['android:name'] : undefined;
      // Keep anything unnamed rather than silently dropping a malformed entry
      // we do not understand.
      if (typeof name !== 'string') return true;
      if (Object.prototype.hasOwnProperty.call(ALLOWED, name)) return true;
      removed.push(name);
      return false;
    });
  }

  return { manifest, removed };
}

module.exports = function withMinimalPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    const { removed } = enforceMinimalPermissions(cfg.modResults.manifest);
    if (removed.length > 0) {
      // Visible in the prebuild log, so an unexpected addition is noticed
      // rather than silently stripped.
      // eslint-disable-next-line no-console
      console.log(`[withMinimalPermissions] removed: ${removed.join(', ')}`);
    }
    return cfg;
  });
};

module.exports.enforceMinimalPermissions = enforceMinimalPermissions;
module.exports.ALLOWED_PERMISSIONS = ALLOWED;
