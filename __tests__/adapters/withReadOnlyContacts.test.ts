/**
 * Config plugin test (issue 010 / #21, re-verified by the audit in 048).
 *
 * This is a privacy guarantee, not a convenience. expo-contacts' own plugin
 * adds WRITE_CONTACTS unconditionally — a Play Store sensitive permission the
 * app has no use for, since Stay Close only reads. A regression here would ship
 * a permission request that contradicts docs/PRODUCT.md §5, and nothing else in
 * the suite would notice.
 *
 * Tests the exported pure transform rather than the plugin wrapper, so no
 * module-registry patching is involved.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { stripForbiddenPermissions } = require('../../plugins/withReadOnlyContacts.js');
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

const strip = (manifest: Manifest): Manifest =>
  stripForbiddenPermissions(manifest) as Manifest;

describe('stripForbiddenPermissions', () => {
  it('strips WRITE_CONTACTS', () => {
    const out = strip({
      'uses-permission': [
        perm('android.permission.READ_CONTACTS'),
        perm('android.permission.WRITE_CONTACTS'),
      ],
    });
    expect(namesOf(out['uses-permission'])).not.toContain('android.permission.WRITE_CONTACTS');
  });

  it('keeps every permission the app actually needs', () => {
    const out = strip({
      'uses-permission': [
        perm('android.permission.READ_CONTACTS'),
        perm('android.permission.WRITE_CONTACTS'),
        perm('android.permission.POST_NOTIFICATIONS'),
        perm('android.permission.RECEIVE_BOOT_COMPLETED'),
      ],
    });
    expect(namesOf(out['uses-permission']).sort()).toEqual([
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.READ_CONTACTS',
      'android.permission.RECEIVE_BOOT_COMPLETED',
    ]);
  });

  // Some plugin versions emit this variant instead.
  it('also strips it from uses-permission-sdk-23', () => {
    const out = strip({
      'uses-permission-sdk-23': [
        perm('android.permission.READ_CONTACTS'),
        perm('android.permission.WRITE_CONTACTS'),
      ],
    });
    expect(namesOf(out['uses-permission-sdk-23'])).toEqual(['android.permission.READ_CONTACTS']);
  });

  it('tolerates a manifest with no permission entries', () => {
    expect(() => strip({})).not.toThrow();
  });

  // Throwing here would fail the whole native build.
  it('tolerates malformed entries', () => {
    const out = strip({
      'uses-permission': [
        { $: {} },
        perm('android.permission.WRITE_CONTACTS'),
        perm('android.permission.READ_CONTACTS'),
      ],
    });
    expect(namesOf(out['uses-permission'])).not.toContain('android.permission.WRITE_CONTACTS');
    expect(namesOf(out['uses-permission'])).toContain('android.permission.READ_CONTACTS');
  });

  it('tolerates a null manifest', () => {
    expect(() => stripForbiddenPermissions(null)).not.toThrow();
  });

  it('is idempotent', () => {
    const once = strip({
      'uses-permission': [
        perm('android.permission.READ_CONTACTS'),
        perm('android.permission.WRITE_CONTACTS'),
      ],
    });
    const twice = strip(once);
    expect(namesOf(twice['uses-permission'])).toEqual(['android.permission.READ_CONTACTS']);
  });
});

describe('app.json wiring', () => {
  it('lists the plugin after expo-contacts so it sees that plugin output', () => {
    const plugins: unknown[] = appJson.expo.plugins;
    const contactsIndex = plugins.findIndex((p) => Array.isArray(p) && p[0] === 'expo-contacts');
    const stripIndex = plugins.findIndex((p) => p === './plugins/withReadOnlyContacts');

    expect(contactsIndex).toBeGreaterThanOrEqual(0);
    expect(stripIndex).toBeGreaterThan(contactsIndex);
  });

  it('does not declare WRITE_CONTACTS in app.json either', () => {
    expect(appJson.expo.android.permissions).not.toContain('android.permission.WRITE_CONTACTS');
  });

  // docs/PLATFORM.md §2.4 and §5.1 — deliberately not requested.
  it.each([
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.USE_EXACT_ALARM',
    'android.permission.CALL_PHONE',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO',
  ])('does not request %s', (permission) => {
    expect(appJson.expo.android.permissions).not.toContain(permission);
  });

  it('declares only the three permissions the product justifies', () => {
    expect([...appJson.expo.android.permissions].sort()).toEqual([
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.READ_CONTACTS',
      'android.permission.RECEIVE_BOOT_COMPLETED',
    ]);
  });

  // docs/PRODUCT.md §7 — web is not a V1 target.
  it('targets only iOS and Android', () => {
    expect([...appJson.expo.platforms].sort()).toEqual(['android', 'ios']);
    expect(appJson.expo.web).toBeUndefined();
  });
});
