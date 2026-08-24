/**
 * Exercises the install button in both browsers that matter.
 *
 * The button is the thing that was asked for and the thing that was missing, so
 * "it is in the HTML" is not evidence. Two genuinely different paths have to
 * work:
 *
 *   Chromium  fires beforeinstallprompt, which the page must suppress and
 *             re-offer behind a real button.
 *   WebKit    never fires it, because Safari has no install prompt at all, so
 *             the only honest offer is the Add to Home Screen gesture.
 *
 * Headless Chromium does not fire beforeinstallprompt on its own, so that path
 * is driven with a synthetic event carrying the same shape as the real one -
 * preventDefault, prompt(), userChoice - and the assertions are about what the
 * page DOES with it: suppress the default, reveal the button, call prompt() on
 * click, and hide once accepted.
 */
import { chromium, webkit, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const DIST = 'dist';
const BASE_PATH = '/stay-close';
const PORT = 4176;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.startsWith(BASE_PATH)) path = path.slice(BASE_PATH.length);
    if (path === '' || path === '/') path = '/index.html';
    let file = join(DIST, path);
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(DIST, 'index.html');
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    res.writeHead(404).end(String(error));
  }
});

await new Promise((resolve) => server.listen(PORT, resolve));
const url = `http://localhost:${PORT}${BASE_PATH}/`;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
};

const visible = (page, id) =>
  page.evaluate((sel) => {
    const el = document.getElementById(sel);
    if (!el) return false;
    return getComputedStyle(el).display !== 'none';
  }, id);

/** Dispatch an event shaped like a real beforeinstallprompt. */
const firePrompt = (page, outcome) =>
  page.evaluate((result) => {
    window.__scPromptCalled = false;
    const e = new Event('beforeinstallprompt');
    let prevented = false;
    e.preventDefault = () => {
      prevented = true;
    };
    e.prompt = () => {
      window.__scPromptCalled = true;
    };
    e.userChoice = Promise.resolve({ outcome: result });
    window.dispatchEvent(e);
    return prevented;
  }, outcome);

// ---------------------------------------------------------------- Chromium --
console.log('\nChromium - beforeinstallprompt path\n');
{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'load', timeout: 45000 });

  check('button hidden before any prompt', !(await visible(page, 'sc-install')));

  const suppressed = await firePrompt(page, 'accepted');
  check('page suppresses the default mini-infobar', suppressed);

  await page.waitForTimeout(200);
  check('button appears once installable', await visible(page, 'sc-install'));
  check(
    'button reads "Install app"',
    (await page.evaluate(() => document.getElementById('sc-install-label')?.textContent)) ===
      'Install app'
  );

  await page.evaluate(() => document.getElementById('sc-install').click());
  await page.waitForTimeout(300);
  check(
    'clicking calls the browser prompt',
    await page.evaluate(() => window.__scPromptCalled === true)
  );
  check('button hides after the user accepts', !(await visible(page, 'sc-install')));

  // Dismissal must persist, or the button nags on every visit.
  await page.evaluate(() => {
    try {
      localStorage.removeItem('sc-install-dismissed');
    } catch {
      /* private mode */
    }
  });
  await page.reload({ waitUntil: 'load' });
  await firePrompt(page, 'dismissed');
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById('sc-install-dismiss').click());
  await page.waitForTimeout(200);
  check('dismiss hides the button', !(await visible(page, 'sc-install')));

  await page.reload({ waitUntil: 'load' });
  await firePrompt(page, 'accepted');
  await page.waitForTimeout(300);
  check('dismissal survives a reload', !(await visible(page, 'sc-install')));

  check('no page exceptions in Chromium', errors.length === 0, errors[0] ?? '');
  await browser.close();
}

// ------------------------------------------------------------------ WebKit --
console.log('\nWebKit, iPhone profile - Add to Home Screen path\n');
{
  const browser = await webkit.launch();
  const context = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(600);

  check('button appears on iPhone without any prompt event', await visible(page, 'sc-install'));
  check(
    'button reads "Add to Home Screen"',
    (await page.evaluate(() => document.getElementById('sc-install-label')?.textContent)) ===
      'Add to Home Screen'
  );

  check('instructions hidden until asked', !(await visible(page, 'sc-ios')));
  await page.evaluate(() => document.getElementById('sc-install').click());
  await page.waitForTimeout(300);
  check('tapping shows the Add to Home Screen steps', await visible(page, 'sc-ios'));

  const text = await page.evaluate(() => document.getElementById('sc-ios-card')?.innerText ?? '');
  check(
    'steps name the actual Safari gesture',
    /Share/.test(text) && /Add to Home Screen/.test(text)
  );

  await page.evaluate(() => document.querySelector('#sc-ios-card button').click());
  await page.waitForTimeout(300);
  check('the sheet can be closed', !(await visible(page, 'sc-ios')));

  // The app itself must still be usable behind the button. Opening the
  // database takes seconds, so this polls rather than sampling once.
  let appText = '';
  let booted = false;
  for (let i = 0; i < 60; i++) {
    appText = await page.evaluate(() => document.getElementById('root')?.innerText ?? '');
    if (/Create a group|Your groups/.test(appText)) {
      booted = true;
      break;
    }
    await page.waitForTimeout(500);
  }
  check('app still boots behind the button', booted, booted ? '' : appText.slice(0, 60));

  check('no page exceptions in WebKit', errors.length === 0, errors[0] ?? '');
  await page.screenshot({ path: 'install-button-ios.png' });
  await browser.close();
}

server.close();

const bad = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - bad.length}/${checks.length} checks passed`);
process.exit(bad.length === 0 ? 0 : 1);
