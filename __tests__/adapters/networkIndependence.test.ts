/**
 * Network-independence guard (issue 047 / #58).
 *
 * docs/PRODUCT.md §4-5 promises the app makes no network requests at all. That
 * promise is only worth something if it is enforced rather than asserted, so
 * this scans our own source on every CI run.
 *
 * It is a source scan, not a runtime interception. A runtime test would only
 * catch code paths a test happens to execute; this catches the mere *presence*
 * of a network call anywhere in the app, which is the property actually claimed.
 *
 * The complementary on-device check — airplane mode plus traffic inspection —
 * is in docs/DEVICE_VERIFICATION.md §8, since only that can prove a dependency
 * is not calling out.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SCANNED_DIRS = ['src', 'app', 'plugins'];
const EXTENSIONS = ['.ts', '.tsx', '.js'];

/** Every source file we ship, excluding test helpers. */
function sourceFiles(): string[] {
  const out: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!EXTENSIONS.some((ext) => entry.endsWith(ext))) continue;
      out.push(full);
    }
  };

  for (const dir of SCANNED_DIRS) walk(join(ROOT, dir));
  return out;
}

/** Strip comments so prose about `fetch` does not trip the scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly pattern: string;
}

/**
 * Patterns that would indicate the app talking to the network itself.
 *
 * `Linking.openURL` is deliberately absent: handing a URL to the OS is the user
 * leaving our app, not us making a request (docs/DOMAIN.md §12).
 */
const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'fetch', pattern: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', pattern: /\bWebSocket\b/ },
  { name: 'EventSource', pattern: /\bEventSource\b/ },
  { name: 'sendBeacon', pattern: /\bsendBeacon\b/ },
  { name: 'axios', pattern: /\baxios\b/ },
  { name: 'node:http', pattern: /require\(['"]https?['"]\)|from\s+['"]https?['"]/ },
  { name: 'expo-push-token', pattern: /getExpoPushTokenAsync|getDevicePushTokenAsync/ },
];

function scan(): Finding[] {
  const findings: Finding[] = [];

  for (const file of sourceFiles()) {
    const cleaned = stripComments(readFileSync(file, 'utf8'));
    const lines = cleaned.split('\n');

    lines.forEach((text, index) => {
      for (const { name, pattern } of FORBIDDEN) {
        if (pattern.test(text)) {
          findings.push({
            file: relative(ROOT, file).split(sep).join('/'),
            line: index + 1,
            text: text.trim(),
            pattern: name,
          });
        }
      }
    });
  }

  return findings;
}

describe('the app makes no network requests', () => {
  it('scans a non-trivial number of files', () => {
    // Guards the guard: a broken walk would pass vacuously.
    expect(sourceFiles().length).toBeGreaterThan(20);
  });

  it('contains no network calls anywhere in src, app or plugins', () => {
    const findings = scan();
    if (findings.length > 0) {
      const report = findings
        .map((f) => `  ${f.file}:${f.line}  [${f.pattern}]  ${f.text}`)
        .join('\n');
      throw new Error(
        `Network usage found. docs/PRODUCT.md §4 promises this app makes no network requests:\n${report}`
      );
    }
    expect(findings).toEqual([]);
  });

  it('detects a planted violation', () => {
    // Proves the patterns actually match, rather than the suite passing because
    // the regexes are wrong.
    const planted = 'const data = await fetch("https://example.com");';
    const matched = FORBIDDEN.filter((entry) => entry.pattern.test(planted));
    expect(matched.map((m) => m.name)).toContain('fetch');
  });

  it('does not flag a comment mentioning fetch', () => {
    const commented = stripComments('// we never fetch( anything\nconst x = 1;');
    expect(FORBIDDEN.some((entry) => entry.pattern.test(commented))).toBe(false);
  });
});

describe('outbound URLs', () => {
  it('references no remote host except deep links and XML namespaces', () => {
    const allowed = [
      // A deep link handed to the OS, not a request we make (docs/DOMAIN.md §12).
      'https://wa.me/',
      // An XML namespace IDENTIFIER, used by the Android manifest merger. URIs
      // in that position are names, never fetched — the merger resolves them
      // locally and no HTTP request is ever made.
      'http://schemas.android.com/',
    ];
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const cleaned = stripComments(readFileSync(file, 'utf8'));
      for (const match of cleaned.matchAll(/https?:\/\/[a-zA-Z0-9._/-]+/g)) {
        const url = match[0];
        if (!allowed.some((prefix) => url.startsWith(prefix))) {
          offenders.push(`${relative(ROOT, file).split(sep).join('/')}: ${url}`);
        }
      }
    }

    // wa.me is a deep link handed to the OS, not a request we make.
    expect(offenders).toEqual([]);
  });
});

describe('no network-capable dependencies are declared', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require('../../package.json');

  it('declares no HTTP client', () => {
    const deps = Object.keys(pkg.dependencies ?? {});
    for (const banned of ['axios', 'node-fetch', 'got', 'superagent', 'ky', 'request']) {
      expect(deps).not.toContain(banned);
    }
  });

  it('declares no analytics, crash-reporting or attribution SDK', () => {
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const banned = /segment|amplitude|mixpanel|sentry|bugsnag|firebase|posthog|appsflyer|branch|datadog|analytics|crashlytics/i;
    expect(deps.filter((name) => banned.test(name))).toEqual([]);
  });

  it('declares no backend or auth client', () => {
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const banned = /supabase|@aws-|firebase-admin|apollo|graphql-request|auth0|clerk/i;
    expect(deps.filter((name) => banned.test(name))).toEqual([]);
  });
});
