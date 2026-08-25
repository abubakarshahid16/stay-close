/**
 * Permission enforcement tests (issues 047 / #58, 048 / #59).
 *
 * The plugin uses the Android manifest merger's own removal directive
 * (tools:node="remove") rather than filtering the permission array. That change
 * came from a real failure: the filtering version LOGGED that it had removed
 * INTERNET and WRITE_CONTACTS, and the generated manifest still contained both.
 * Expo re-applies permissions in later prebuild passes, and native library
 * manifests contribute their own entries at Gradle merge time, which a config
 * plugin never sees.
 *
 * So these tests assert the DIRECTIVES are emitted. Whether the merger honoured
 * them is verified against the built APK in the release workflow, because the
 * merged result is the only thing that reflects what a user installs.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const plugin = require('../../plugins/withMinimalPermissions.js');
const { enforceMinimalPermissions, ALLOWED_PERMISSIONS, REMOVED_PERMISSIONS } = plugin;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const appJson = require('../../app.json');

interface Entry {
  $: Record<string, string | undefined>;
}

interface Manifest {
  $?: Record<string, string>;
  'uses-permission'?: Entry[];
}

const JUSTIFIED = [
  'android.permission.READ_CONTACTS',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
];

const perm = (name: string): Entry => ({ $: { 'android:name': name } });

const enforce = (manifest: Manifest): Manifest =>
  enforceMinimalPermissions(manifest) as Manifest;

/** Entries the app actually requests: named, with no removal directive. */
const requested = (m: Manifest): string[] =>
  (m['uses-permission'] ?? [])
    .filter((e) => e.$['tools:node'] !== 'remove')
    .map((e) => e.$['android:name'] ?? '')
    .filter(Boolean);

/** Entries marked for the merger to strip. */
const removals = (m: Manifest): string[] =>
  (m['uses-permission'] ?? [])
    .filter((e) => e.$['tools:node'] === 'remove')
    .map((e) => e.$['android:name'] ?? '');

describe('permission enforcement', () => {
  it('declares the tools namespace, without which the merger ignores removals', () => {
    const out = enforce({ 'uses-permission': [] });
    expect(out.$?.['xmlns:tools']).toBe('http://schemas.android.com/tools');
  });

  it('requests exactly the three justified permissions', () => {
    const out = enforce({ 'uses-permission': [] });
    expect(requested(out).sort()).toEqual([...JUSTIFIED].sort());
  });

  it('documents a justification for each', () => {
    for (const name of JUSTIFIED) {
      expect(typeof ALLOWED_PERMISSIONS[name]).toBe('string');
      expect(ALLOWED_PERMISSIONS[name].length).toBeGreaterThan(20);
    }
    expect(Object.keys(ALLOWED_PERMISSIONS).sort()).toEqual([...JUSTIFIED].sort());
  });

  // The permissions the audit actually found coming from dependencies.
  it.each([
    'android.permission.INTERNET',
    'android.permission.WRITE_CONTACTS',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
  ])('marks %s for removal', (name) => {
    const out = enforce({ 'uses-permission': [perm(name)] });
    expect(removals(out)).toContain(name);
    expect(requested(out)).not.toContain(name);
  });

  it.each([
    'android.permission.CALL_PHONE',
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.USE_EXACT_ALARM',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO',
    'android.permission.READ_CALENDAR',
    'android.permission.GET_ACCOUNTS',
  ])('also marks %s for removal', (name) => {
    expect(REMOVED_PERMISSIONS).toContain(name);
    expect(removals(enforce({ 'uses-permission': [] }))).toContain(name);
  });

  it('never marks a justified permission for removal', () => {
    const out = enforce({ 'uses-permission': JUSTIFIED.map(perm) });
    for (const name of JUSTIFIED) expect(removals(out)).not.toContain(name);
  });

  it('drops an unrecognised permission from the request list', () => {
    const out = enforce({
      'uses-permission': [perm('android.permission.SOMETHING_NOBODY_ANTICIPATED')],
    });
    expect(requested(out)).not.toContain('android.permission.SOMETHING_NOBODY_ANTICIPATED');
  });

  it('does not duplicate a justified permission already present', () => {
    const out = enforce({ 'uses-permission': [perm('android.permission.READ_CONTACTS')] });
    const contacts = requested(out).filter((n) => n === 'android.permission.READ_CONTACTS');
    expect(contacts).toHaveLength(1);
  });

  it('tolerates an empty or malformed manifest rather than failing a build', () => {
    expect(() => enforce({})).not.toThrow();
    expect(() => enforceMinimalPermissions(null)).not.toThrow();
    const out = enforce({ 'uses-permission': [{ $: {} }] });
    expect(requested(out).sort()).toEqual([...JUSTIFIED].sort());
  });

  it('is idempotent', () => {
    const once = enforce({ 'uses-permission': [perm('android.permission.INTERNET')] });
    const twice = enforce(once);
    expect(requested(twice).sort()).toEqual([...JUSTIFIED].sort());
    expect(new Set(removals(twice)).size).toBe(removals(twice).length);
  });
});

describe('permissions found in a real APK', () => {
  // Regression guard for one that actually shipped.
  //
  // v2.0.0-alpha.10 requested android.permission.READ_APP_BADGE. It came from a
  // notification dependency, it was on nobody's forbidden list, and the CI check
  // at the time was a blocklist — so it passed. It was found by parsing the
  // <uses-permission> entries out of the published APK's binary manifest.
  //
  // The lasting fix is that CI now asserts an allowlist against the built APK.
  // This test keeps the plugin side honest too.
  const BADGE_PERMISSIONS = [
    'android.permission.READ_APP_BADGE',
    'com.sec.android.provider.badge.permission.READ',
    'com.sec.android.provider.badge.permission.WRITE',
  ];

  it.each(BADGE_PERMISSIONS)('strips %s', (name) => {
    expect(REMOVED_PERMISSIONS).toContain(name);
  });

  it('removes a badge permission a dependency declares', () => {
    const out = enforce({
      'uses-permission': [perm('android.permission.READ_APP_BADGE')],
    });
    expect(requested(out)).not.toContain('android.permission.READ_APP_BADGE');
    expect(removals(out)).toContain('android.permission.READ_APP_BADGE');
  });

  // The three the app does justify must survive, or the removals have gone
  // too far and the app stops working.
  it('still requests exactly the justified three alongside it', () => {
    const out = enforce({
      'uses-permission': [
        perm('android.permission.READ_APP_BADGE'),
        perm('android.permission.INTERNET'),
      ],
    });
    expect(requested(out).sort()).toEqual([...JUSTIFIED].sort());
  });

  // Component-level protections are not requested permissions, and must not be
  // mistaken for them: BIND_JOB_SERVICE and DUMP both appear in the built
  // manifest as <service android:permission=...> and <receiver
  // android:permission=...>, which is correct and must not be "fixed".
  it('does not try to strip component-level protections', () => {
    for (const name of ['android.permission.BIND_JOB_SERVICE', 'android.permission.DUMP']) {
      expect(REMOVED_PERMISSIONS).not.toContain(name);
    }
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

  // docs/PRODUCT.md §7.1 — web was re-included as a degraded target.
  it('targets iOS, Android and web', () => {
    expect([...appJson.expo.platforms].sort()).toEqual(['android', 'ios', 'web']);
    expect(appJson.expo.web).toBeDefined();
  });
});
