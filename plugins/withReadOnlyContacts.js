/**
 * Config plugin: strip android.permission.WRITE_CONTACTS.
 *
 * expo-contacts' own plugin adds READ_CONTACTS *and* WRITE_CONTACTS
 * unconditionally (verified in node_modules/expo-contacts/plugin/src/withContacts.ts —
 * see docs/PLATFORM.md §1.5). Stay Close only ever reads: it never creates or
 * edits a device contact.
 *
 * WRITE_CONTACTS is a Play Store sensitive permission and requesting it would
 * violate the minimum-permission rule in docs/PRODUCT.md §5. This plugin must
 * be listed AFTER expo-contacts in app.json so it runs on the manifest that
 * plugin produced.
 *
 * The manifest transform is exported separately as a pure function so it can be
 * tested without the Expo build harness. Verified by the permission audit
 * (issue 048).
 */
const { withAndroidManifest } = require('expo/config-plugins');

const FORBIDDEN = ['android.permission.WRITE_CONTACTS'];

const PERMISSION_KEYS = ['uses-permission', 'uses-permission-sdk-23'];

/**
 * Remove forbidden permissions from an Android manifest object, in place.
 * Pure apart from the mutation, and tolerant of malformed entries — throwing
 * here would fail the whole native build.
 *
 * @param {Record<string, unknown>} manifest
 * @returns {Record<string, unknown>} the same manifest, mutated
 */
function stripForbiddenPermissions(manifest) {
  if (!manifest || typeof manifest !== 'object') return manifest;

  for (const key of PERMISSION_KEYS) {
    const entries = manifest[key];
    if (!Array.isArray(entries)) continue;
    manifest[key] = entries.filter((entry) => {
      const name = entry && entry.$ ? entry.$['android:name'] : undefined;
      return !FORBIDDEN.includes(name);
    });
  }

  return manifest;
}

module.exports = function withReadOnlyContacts(config) {
  return withAndroidManifest(config, (cfg) => {
    stripForbiddenPermissions(cfg.modResults.manifest);
    return cfg;
  });
};

module.exports.stripForbiddenPermissions = stripForbiddenPermissions;
module.exports.FORBIDDEN_PERMISSIONS = FORBIDDEN;
