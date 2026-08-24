/**
 * Post-export step for the web build.
 *
 * `expo export` produces the app but does not register a service worker, and a
 * browser will not offer "Install app" without one. Expo Router also ignores a
 * hand-written index.html, so this has to run after the export rather than being
 * a template.
 *
 * Injects, into dist/index.html:
 *   - the web manifest link (needed for installability)
 *   - iOS home-screen meta tags
 *   - a service-worker registration
 *
 * Nothing more. An earlier version also forced a one-time reload so the page
 * would be controlled by the worker, for cross-origin isolation headers the
 * worker used to add. Those headers blocked the app's own JS bundle, so both
 * they and the reload are gone.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const INDEX = join(DIST, 'index.html');
const BASE = '/stay-close';

if (!existsSync(INDEX)) {
  console.error(`[inject-pwa] ${INDEX} not found — did "expo export" run?`);
  process.exit(1);
}

// ── manifest ────────────────────────────────────────────────────────────────

const manifest = {
  name: 'Stay Close',
  short_name: 'Stay Close',
  description: 'A private, offline relationship reminder. No account, no cloud.',
  start_url: `${BASE}/`,
  scope: `${BASE}/`,
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#ffffff',
  theme_color: '#1c1c1c',
  icons: [
    { src: `${BASE}/icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${BASE}/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${BASE}/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

writeFileSync(join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2));

// ── icons ───────────────────────────────────────────────────────────────────
// Reuse the app icon at both sizes. Browsers scale, and a wrong-sized icon is
// better than a missing one, which blocks installability entirely.

mkdirSync(join(DIST, 'icons'), { recursive: true });
const source = existsSync('assets/icon.png') ? 'assets/icon.png' : null;
if (source) {
  copyFileSync(source, join(DIST, 'icons', 'icon-192.png'));
  copyFileSync(source, join(DIST, 'icons', 'icon-512.png'));
} else {
  console.warn('[inject-pwa] assets/icon.png missing — the install prompt may not appear');
}

// ── service worker ──────────────────────────────────────────────────────────

if (existsSync(join('public', 'sw.js'))) {
  copyFileSync(join('public', 'sw.js'), join(DIST, 'sw.js'));
} else {
  console.error('[inject-pwa] public/sw.js missing');
  process.exit(1);
}

// ── inject into index.html ──────────────────────────────────────────────────

const injection = `
    <link rel="manifest" href="${BASE}/manifest.json" />
    <meta name="theme-color" content="#1c1c1c" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Stay Close" />
    <script>
      // Register the worker purely so the browser offers "Install app".
      // Deliberately no reload: an earlier version forced one so the page would
      // be controlled by the worker (for cross-origin isolation headers that
      // turned out to break asset loading). Registration alone is enough for
      // installability, and a failure here must not affect the app.
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
          navigator.serviceWorker.register('${BASE}/sw.js').catch(function () {});
        });
      }
    </script>
`;

let html = readFileSync(INDEX, 'utf8');

if (html.includes('manifest.json')) {
  console.log('[inject-pwa] already injected, skipping');
} else if (!html.includes('</head>')) {
  console.error('[inject-pwa] no </head> in the exported HTML');
  process.exit(1);
} else {
  html = html.replace('</head>', `${injection}</head>`);
  writeFileSync(INDEX, html);
}

// GitHub Pages serves 404.html for unknown paths, which is how a single-page
// app keeps deep links working.
copyFileSync(INDEX, join(DIST, '404.html'));

console.log('[inject-pwa] manifest, icons, service worker and SPA fallback written');
