/**
 * Permission allowlist tests (issues 047 / #58, 048 / #59).
 *
 * This is a privacy guarantee with teeth. The dependency audit found that
 * `expo-file-system` — a transitive dependency of `expo` itself, which we never
 * asked for and never use — adds INTERNET, READ_EXTERNAL_STORAGE and
 * WRITE_EXTERNAL_STORAGE via its config plugin.
 *
 * An allowlist is the only shape that survives that. A blocklist would need to
 * name every unwanted permission in advance, and the next transitive plugin
 * would add one nobody had heard of. So the test that matters most here is the
 * one asserting an UNKNOWN permission is stripped by default.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const plugin = require('../../plugins/withMinimalPermissions.js');
const { enforceMinimalPermissions, ALLOWED_PERMISSIONS } = plugin;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const appJson = require('../../app.json');

interface ManifestPermission {
  $: { 'android:name'?: string };
}

interface Manifest {
  'uses-permission'?: ManifestPermission[];
  'uses-permission-sdk-23'?: ManifestPermission[];
}

const perm = (name: string): ManifestPermission => ({ $: { 'android:name': name } });

const namesOf = (list?: ManifestPermission[]): string[] =>
  (list ?? []).map((entry) => entry.$['android:name'] ?? '');

const enforce = (manifest: Manifest): { manifest: Manifest; removed: string[] } =>
  enforceMinimalPermissions(manifest) as { manifest: Manifest; removed: string[] };

const JUSTIFIED = [
  'android.permission.READ_CONTACTS',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
];

describe('allowlist', () => {
  it('keeps exactly the three justified permissions', () => {
    const { manifest } = enforce({ 'uses-permission': JUSTIFIED.map(perm) });
    expect(namesOf(manifest['uses-permission']).sort()).toEqual([...JUSTIFIED].sort());
  });

  it('documents a justification for every allowed permission', () => {
    for (const name of JUSTIFIED) {
      expect(typeof ALLOWED_PERMISSIONS[name]).toBe('string');
      expect(ALLOWED_PERMISSIONS[name].length).toBeGreaterThan(20);
    }
    expect(Object.keys(ALLOWED_PERMISSIONS).sort()).toEqual([...JUSTIFIED].sort());
  });

  // The three the audit actually found, from a transitive plugin.
  it.each([
    'android.permission.INTERNET',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
  ])('strips %s, added by the transitive expo-file-system plugin', (name) => {
    const { manifest, removed } = enforce({
      'uses-permission': [perm('android.permission.READ_CONTACTS'), perm(name)],
    });
    expect(namesOf(manifest['uses-permission'])).not.toContain(name);
    expect(removed).toContain(name);
  });

  it('strips WRITE_CONTACTS, added unconditionally by expo-contacts', () => {
    const { manifest } = enforce({
      'uses-permission': [
        perm('android.permission.READ_CONTACTS'),
        perm('android.permission.WRITE_CONTACTS'),
      ],
    });
    expect(namesOf(manifest['uses-permission'])).toEqual(['android.permission.READ_CONTACTS']);
  });

  // The whole reason for choosing an allowlist. This is what a blocklist
  // could not do.
  it('strips a permission nobody anticipated', () => {
    const { manifest, removed } = enforce({
      'uses-permission': [
        perm('android.permission.READ_CONTACTS'),
        perm('android.permission.SOME_FUTURE_PERMISSION_WE_HAVE_NEVER_SEEN'),
      ],
    });
    expect(namesOf(manifest['uses-permission'])).toEqual(['android.permission.READ_CONTACTS']);
    expect(removed).toContain('android.permission.SOME_FUTURE_PERMISSION_WE_HAVE_NEVER_SEEN');
  });

  it.each([
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO',
    'android.permission.READ_CALENDAR',
    'android.permission.BLUETOOTH',
    'android.permission.GET_ACCOUNTS',
    'android.permission.CALL_PHONE',
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.USE_EXACT_ALARM',
  ])('strips %s', (name) => {
    const { manifest } = enforce({ 'uses-permission': [perm(name)] });
    expect(namesOf(manifest['uses-permission'])).toEqual([]);
  });

  it('applies to uses-permission-sdk-23 as well', () => {
    const { manifest } = enforce({
      'uses-permission-sdk-23': [
        perm('android.permission.READ_CONTACTS'),
        perm('android.permission.INTERNET'),
      ],
    });
    expect(namesOf(manifest['uses-permission-sdk-23'])).toEqual([
      'android.permission.READ_CONTACTS',
    ]);
  });
});

describe('robustness', () => {
  // Throwing here would fail the whole native build.
  it('tolerates an empty manifest, a null manifest and malformed entries', () => {
    expect(() => enforce({})).not.toThrow();
    expect(() => enforceMinimalPermissions(null)).not.toThrow();

    const { manifest } = enforce({
      'uses-permission': [{ $: {} }, perm('android.permission.INTERNET')],
    });
    // The malformed entry is kept rather than silently dropped; the known-bad
    // one is removed.
    expect(manifest['uses-permission']).toHaveLength(1);
  });

  it('is idempotent', () => {
    const once = enforce({
      'uses-permission': [
        perm('android.permission.READ_CONTACTS'),
        perm('android.permission.INTERNET'),
      ],
    });
    const twice = enforce(once.manifest);
    expect(namesOf(twice.manifest['uses-permission'])).toEqual([
      'android.permission.READ_CONTACTS',
    ]);
    expect(twice.removed).toEqual([]);
  });
});

describe('app.json wiring', () => {
  it('runs the plugin last, so it sees every other plugin output', () => {
    const plugins: unknown[] = appJson.expo.plugins;
    expect(plugins[plugins.length - 1]).toBe('./plugins/withMinimalPermissions');
  });

  it('declares only the justified permissions', () => {
    expect([...appJson.expo.android.permissions].sort()).toEqual([...JUSTIFIED].sort());
  });

  // docs/PRODUCT.md §7 — web is not a V1 target, so no browser surface exists.
  it('targets only iOS and Android', () => {
    expect([...appJson.expo.platforms].sort()).toEqual(['android', 'ios']);
    expect(appJson.expo.web).toBeUndefined();
  });
});
