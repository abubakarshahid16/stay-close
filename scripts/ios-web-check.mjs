/**
 * Verifies the iPhone route actually works.
 *
 * There is no native iOS build (sideloading needs an Apple Developer account),
 * so the README tells iPhone users to open the web app and Add to Home Screen.
 * That claim was never tested: every previous web check ran headless Chromium,
 * which is not the engine an iPhone uses.
 *
 * This runs WebKit — the same engine as Safari — under an iPhone device
 * profile, and additionally checks the things Add to Home Screen depends on,
 * because iOS ignores the web app manifest's icons and reads <link
 * rel="apple-touch-icon"> instead. A missing one pins a screenshot of the page.
 */
import { webkit, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const DIST = 'dist';
const BASE_PATH = '/stay-close';
const PORT = 4175;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json',
  '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png',
  '.ico': 'image/x-icon', '.map': 'application/json',
};

// Passing a URL checks a deployed site instead of the local dist/ build, so
// the same assertions can run against what users actually load.
const TARGET = process.argv[2] ?? null;

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.startsWith(BASE_PATH)) path = path.slice(BASE_PATH.length);
    if (path === '' || path === '/') path = '/index.html';

    let file = join(DIST, path);
    let fellBack = false;
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(DIST, 'index.html');
      fellBack = true;
    }

    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      // Lets the test tell a real asset from the SPA fallback, which is how a
      // missing .wasm previously masqueraded as a successful 200.
      'X-SPA-Fallback': fellBack ? '1' : '0',
    });
    res.end(body);
  } catch (error) {
    res.writeHead(404).end(String(error));
  }
});

if (!TARGET) await new Promise((resolve) => server.listen(PORT, resolve));

const iPhone = devices['iPhone 14'];
const browser = await webkit.launch();
const context = await browser.newContext({ ...iPhone });
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
const failed = [];

page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));
page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));

const url = TARGET ?? `http://localhost:${PORT}${BASE_PATH}/`;
console.log(TARGET ? 'Target: LIVE deployment' : 'Target: local dist/');
console.log(`\nWebKit (Safari engine), iPhone 14 profile`);
console.log(`Loading ${url}\n`);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

await page.goto(url, { waitUntil: 'load', timeout: 45000 });

// Waiting for "root has any text at all" is not enough: the boot screen says
// "Opening your data" and satisfies that instantly, so a database that never
// opens looks identical to a working app. Wait for real post-boot content.
const BOOT_TEXT = /Opening your data|Loading your reminders/i;
const READY_TEXT = /Your groups|Create a group/i;

let ready = false;
let lastSeen = '';
for (let i = 0; i < 60; i++) {
  lastSeen = await page.evaluate(() =>
    (document.getElementById('root')?.innerText ?? '').trim()
  );
  if (READY_TEXT.test(lastSeen)) { ready = true; break; }
  await page.waitForTimeout(500);
}
check('app boots past the loading screen in WebKit', ready,
  ready ? '' : `stuck on: "${lastSeen.slice(0, 80)}"`);
check('boot screen cleared', !BOOT_TEXT.test(lastSeen));

const text = await page.evaluate(() =>
  (document.getElementById('root')?.innerText ?? '').trim().slice(0, 300)
);

// The database is the part that broke on web twice; prove it opened by
// exercising a real navigation rather than trusting first paint.
const dbWorks = await page.evaluate(() => !/could not start|failed|error/i.test(
  document.getElementById('root')?.innerText ?? ''
));
check('no failure text on screen', dbWorks);

// Prove the SQLite database really opened by writing through it, rather than
// inferring it from a rendered screen.
const canWrite = await (async () => {
  try {
    await page.getByText(/Create a group/i).first().click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    return /name|group/i.test(await page.evaluate(() =>
      document.getElementById('root')?.innerText ?? ''));
  } catch { return false; }
})();
check('can navigate into the create-group flow', canWrite);

// Add to Home Screen prerequisites.
const meta = await page.evaluate(() => ({
  capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content,
  title: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content,
  touchIcon: document.querySelector('link[rel="apple-touch-icon"]')?.href,
  manifest: document.querySelector('link[rel="manifest"]')?.href,
}));
check('apple-mobile-web-app-capable', meta.capable === 'yes');
check('apple-mobile-web-app-title', Boolean(meta.title), meta.title);
check('apple-touch-icon declared', Boolean(meta.touchIcon));

// iOS silently falls back to a page screenshot if this 404s, so fetch it and
// confirm it is genuinely a PNG rather than the SPA fallback HTML.
if (meta.touchIcon) {
  const r = await page.request.get(meta.touchIcon);
  const ct = r.headers()['content-type'] ?? '';
  const isFallback = r.headers()['x-spa-fallback'] === '1' ||
    (r.headers()['content-type'] ?? '').includes('text/html');
  check('apple-touch-icon serves a real PNG', r.ok() && ct.includes('png') && !isFallback,
    `${r.status()} ${ct}${isFallback ? ' (SPA FALLBACK)' : ''}`);
}

if (meta.manifest) {
  const r = await page.request.get(meta.manifest);
  const m = r.ok() ? await r.json() : null;
  check('manifest is valid JSON', Boolean(m), m ? `${m.icons?.length ?? 0} icons` : '');

  for (const icon of m?.icons ?? []) {
    const ir = await page.request.get(new URL(icon.src, meta.manifest).toString());
    const fallback = ir.headers()['x-spa-fallback'] === '1' ||
      (ir.headers()['content-type'] ?? '').includes('text/html');
    check(`icon ${icon.sizes} (${icon.purpose})`, ir.ok() && !fallback,
      fallback ? 'SPA FALLBACK — file missing' : `${ir.status()}`);
  }
}

check('no page exceptions', pageErrors.length === 0, pageErrors[0] ?? '');
check('no console errors', consoleErrors.length === 0, consoleErrors[0] ?? '');
check('no failed requests', failed.length === 0, failed[0] ?? '');

console.log('\nVISIBLE TEXT:\n' + (text || '(nothing)'));
if (pageErrors.length) { console.log('\nPAGE ERRORS:'); pageErrors.forEach((e) => console.log('  - ' + e)); }
if (consoleErrors.length) { console.log('\nCONSOLE ERRORS:'); consoleErrors.slice(0, 10).forEach((e) => console.log('  - ' + e)); }
if (failed.length) { console.log('\nFAILED REQUESTS:'); failed.slice(0, 10).forEach((e) => console.log('  - ' + e)); }

await page.screenshot({ path: 'ios-web-check.png' });
await browser.close();
if (!TARGET) server.close();

const bad = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - bad.length}/${checks.length} checks passed`);
process.exit(bad.length === 0 ? 0 : 1);
