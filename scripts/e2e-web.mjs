/**
 * Drives the real web app in a real browser through the core flow.
 *
 * The smoke test proves the page paints. This proves the product works: create a
 * group, add a person by hand (web has no address book), and confirm it
 * persisted. Everything in between is the real database, real repositories and
 * real rotation running in Chromium.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const DIST = 'dist';
const BASE_PATH = '/stay-close';
const PORT = 4174;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json',
  '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png',
  '.ico': 'image/x-icon', '.map': 'application/json',
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
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const steps = [];
const check = (label, ok) => {
  steps.push(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  return ok;
};

try {
  await page.goto(`http://localhost:${PORT}${BASE_PATH}/`, { waitUntil: 'load' });
  await page.getByText('Welcome to Stay Close').waitFor({ timeout: 20000 });
  check('app loads to the welcome screen', true);

  // ── create a group ───────────────────────────────────────────────────────
  await page.getByText('Create a group', { exact: true }).click();
  await page.getByPlaceholder('Group name').waitFor({ timeout: 10000 });
  check('create-group screen opens', true);

  await page.getByPlaceholder('Group name').fill('Family');
  await page.getByText('Weekly', { exact: true }).click();

  // A time the form could not previously express. It offered four fixed hours
  // (09, 12, 18, 21) with minutes locked to zero, so 07:35 was unreachable —
  // even though the domain has always accepted any hour and minute. Choosing
  // it here proves the whole path, not just the buttons: selection, validation,
  // the database write, and the description read back on the group screen.
  await page.getByLabel('07 hours').click();
  await page.getByLabel('35 minutes past').click();
  check('an arbitrary time can be selected', true);

  await page.getByText('Create and add people').click();

  // ── add a person by hand (web has no address book) ───────────────────────
  await page.getByPlaceholder('Name').waitFor({ timeout: 15000 });
  check('manual entry is offered on web', true);

  await page.getByPlaceholder('Name').fill('Ahmed');
  await page.getByPlaceholder(/Phone number/).fill('+447700900123');
  await page.getByText('Add person', { exact: true }).click();

  await page.getByText(/Added: Ahmed/).waitFor({ timeout: 10000 });
  check('person added and persisted', true);

  // ── a second person, to prove rotation has a choice ──────────────────────
  await page.getByPlaceholder('Name').fill('Sara');
  await page.getByPlaceholder(/Phone number/).fill('+447700900124');
  await page.getByText('Add person', { exact: true }).click();
  await page.getByText(/Added: Ahmed, Sara/).waitFor({ timeout: 10000 });
  check('second person added', true);

  await page.getByText('Done', { exact: true }).click();

  // ── group detail reflects it ─────────────────────────────────────────────
  await page.getByText('2 people').waitFor({ timeout: 10000 });
  check('group detail shows both members', true);

  const scheduleText = await page.getByText(/1 person every/).textContent();
  check(`schedule described: "${scheduleText?.trim()}"`, !!scheduleText);

  // The time has to survive the round trip. A schedule saved as 07:35 that
  // reads back 07:00 would mean the minutes were silently dropped, which is
  // worse than not offering them.
  check(
    `the chosen time survived into the database (${scheduleText?.trim()})`,
    scheduleText?.includes('07:35') === true
  );

  // ── survives a reload, i.e. it really persisted to IndexedDB ────────────
  await page.reload({ waitUntil: 'load' });
  await page.getByText(/Stay Close|Nobody to reach out|Reach out to/).first().waitFor({ timeout: 20000 });
  await page.goto(`http://localhost:${PORT}${BASE_PATH}/groups`, { waitUntil: 'load' });
  await page.getByText('Family').waitFor({ timeout: 15000 });
  check('data survived a page reload (IndexedDB persistence)', true);
} catch (error) {
  steps.push('FAIL  ' + (error instanceof Error ? error.message.split('\n')[0] : String(error)));
}

console.log('\n' + steps.join('\n'));
if (errors.length) {
  console.log('\nERRORS:');
  for (const e of errors.slice(0, 10)) console.log('  - ' + e);
}

const failed = steps.some((s) => s.startsWith('FAIL'));
console.log('\n' + (failed ? 'RESULT: FAILED' : 'RESULT: ALL STEPS PASSED'));

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
