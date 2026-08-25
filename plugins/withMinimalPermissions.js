/**
 * Config plugin: enforce the minimum-permission rule.
 *
 * Uses the Android manifest merger's own removal directive
 * (`tools:node="remove"`) rather than filtering the permission array.
 *
 * WHY, because the array-filtering version looked like it worked and did not:
 * it logged "removed: INTERNET, WRITE_CONTACTS, ..." and the generated manifest
 * still contained all of them. Two reasons.
 *
 *   1. Expo's prebuild pipeline runs several passes, and permissions declared by
 *      app.json and by autolinked packages are re-applied after a custom mod
 *      has run. Filtering the array is undone.
 *   2. More fundamentally, native library manifests contribute their own
 *      <uses-permission> entries at Gradle merge time. A config plugin never
 *      sees those at all, so no amount of filtering could remove them.
 *
 * `tools:node="remove"` is evaluated by the merger itself, so it removes a
 * permission whatever declared it — app.json, an Expo plugin, or a library
 * manifest buried in a transitive dependency.
 *
 * Verified against the built APK rather than the source manifest, because the
 * merged result is the only thing that reflects what a user actually installs.
 */
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

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

/**
 * Permissions known to be contributed by our dependency tree that this product
 * does not justify. Each is removed via the manifest merger.
 *
 * INTERNET is the one that matters most: the app makes no network requests
 * (docs/SECURITY.md §2), so an app that *cannot* reach the network is a real
 * privacy property rather than a technicality.
 */
const REMOVE = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.WRITE_CONTACTS',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK',
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.READ_CALENDAR',
  'android.permission.WRITE_CALENDAR',
  'android.permission.GET_ACCOUNTS',
  'android.permission.CALL_PHONE',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.USE_EXACT_ALARM',
  // Launcher badge counts on Samsung and some other OEM launchers, pulled in
  // by a notification dependency. Found by parsing the <uses-permission>
  // entries out of a published APK: it was the only permission being requested
  // beyond the three justified ones. This product does not use badges, and
  // "minimum permissions" is a stated requirement rather than an aspiration.
  'android.permission.READ_APP_BADGE',
  // The same badge feature under other OEM vendor names.
  'com.sec.android.provider.badge.permission.READ',
  'com.sec.android.provider.badge.permission.WRITE',
  'com.htc.launcher.permission.READ_SETTINGS',
  'com.htc.launcher.permission.UPDATE_SHORTCUT',
  'com.sonyericsson.home.permission.BROADCAST_BADGE',
  'com.anddoes.launcher.permission.UPDATE_COUNT',
  'me.everything.badger.permission.BADGE_COUNT_READ',
  'me.everything.badger.permission.BADGE_COUNT_WRITE',
];

const TOOLS_NS = 'http://schemas.android.com/tools';

/**
 * Rewrite a manifest so forbidden permissions are marked for removal and
 * allowed ones are declared once.
 *
 * @param {Record<string, any>} manifest
 * @returns {Record<string, any>} the same manifest, mutated
 */
function enforceMinimalPermissions(manifest) {
  if (!manifest || typeof manifest !== 'object') return manifest;

  // The removal directive is namespaced; without this the merger ignores it.
  manifest.$ = manifest.$ ?? {};
  manifest.$['xmlns:tools'] = TOOLS_NS;

  const existing = Array.isArray(manifest['uses-permission'])
    ? manifest['uses-permission']
    : [];

  const nameOf = (entry) => (entry && entry.$ ? entry.$['android:name'] : undefined);

  // Keep only justified permissions, and anything we do not recognise at all
  // (an unnamed or malformed entry is left alone rather than silently dropped).
  const kept = existing.filter((entry) => {
    const name = nameOf(entry);
    if (typeof name !== 'string') return true;
    return Object.prototype.hasOwnProperty.call(ALLOWED, name);
  });

  // Ensure each allowed permission is present exactly once.
  for (const name of Object.keys(ALLOWED)) {
    if (!kept.some((entry) => nameOf(entry) === name)) {
      kept.push({ $: { 'android:name': name } });
    }
  }

  // Then instruct the merger to strip the rest, whoever declared them.
  for (const name of REMOVE) {
    kept.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
  }

  manifest['uses-permission'] = kept;
  return manifest;
}

module.exports = function withMinimalPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    enforceMinimalPermissions(cfg.modResults.manifest);
    return cfg;
  });
};

module.exports.enforceMinimalPermissions = enforceMinimalPermissions;
module.exports.ALLOWED_PERMISSIONS = ALLOWED;
module.exports.REMOVED_PERMISSIONS = REMOVE;
module.exports.AndroidConfigAvailable = Boolean(AndroidConfig);
