/**
 * Loads the built web app in a real browser and reports what actually happens.
 *
 * Written because the web build was "verified" three times by deploying it and
 * looking at the page, which is not verification. This runs headless Chromium
 * against dist/ and reports console errors, failed requests, page exceptions,
 * and whether the app actually rendered.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const DIST = 'dist';
const BASE_PATH = '/stay-close';
const PORT = 4173;

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
      file = join(DIST, 'index.html'); // SPA fallback
    }

    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    res.writeHead(404).end(String(error));
  }
});

await new Promise((resolve) => server.listen(PORT, resolve));

const browser = await chromium.launch();
const page = await browser.newPage();

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(err.message));
page.on('requestfailed', (req) =>
  failedRequests.push(`${req.url()}  ${req.failure()?.errorText ?? ''}`)
);
page.on('response', (res) => {
  if (res.status() >= 400) failedRequests.push(`${res.status()}  ${res.url()}`);
});

// Log every wasm attempt with what came back, since a missing .wasm is served
// the SPA fallback and therefore looks like a 200 of HTML.
const wasmAttempts = [];
page.on('response', async (res) => {
  if (!res.url().includes('.wasm')) return;
  wasmAttempts.push(`${res.status()}  ${res.headers()['content-type'] ?? '?'}  ${res.url()}`);
});

const url = `http://localhost:${PORT}${BASE_PATH}/`;
console.log(`\nLoading ${url}\n`);

await page.goto(url, { waitUntil: 'load', timeout: 30000 });

// Give the app time to boot: wasm fetch, migrations, first render.
let rendered = false;
for (let i = 0; i < 30; i++) {
  rendered = await page.evaluate(() => {
    const root = document.getElementById('root');
    return !!(root && root.children.length > 0 && root.innerText.trim().length > 0);
  });
  if (rendered) break;
  await page.waitForTimeout(500);
}

const visibleText = await page.evaluate(() => {
  const root = document.getElementById('root');
  return (root?.innerText ?? '').trim().slice(0, 500);
});

const diagnostics = await page.evaluate(() => ({
  crossOriginIsolated: self.crossOriginIsolated === true,
  sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
  rootChildren: document.getElementById('root')?.children.length ?? 0,
  diagShown: getComputedStyle(document.getElementById('sc-diag') ?? document.body).display,
}));

console.log('RENDERED:', rendered ? 'YES' : 'NO');
console.log('root children:', diagnostics.rootChildren);
console.log('crossOriginIsolated:', diagnostics.crossOriginIsolated);
console.log('SharedArrayBuffer:', diagnostics.sharedArrayBuffer);
console.log('\nVISIBLE TEXT:\n' + (visibleText || '(nothing)'));

if (pageErrors.length) {
  console.log('\nPAGE ERRORS:');
  for (const e of pageErrors) console.log('  - ' + e);
}
if (consoleErrors.length) {
  console.log('\nCONSOLE ERRORS:');
  for (const e of consoleErrors.slice(0, 15)) console.log('  - ' + e);
}
if (wasmAttempts.length) {
  console.log('\nWASM REQUESTS:');
  for (const w of wasmAttempts) console.log('  - ' + w);
} else {
  console.log('\nWASM REQUESTS: none observed');
}

if (failedRequests.length) {
  console.log('\nFAILED REQUESTS:');
  for (const r of failedRequests.slice(0, 15)) console.log('  - ' + r);
}

await browser.close();
server.close();

process.exit(rendered ? 0 : 1);
