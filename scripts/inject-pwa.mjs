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
 * The registration script also performs ONE guarded reload. expo-sqlite's web
 * build needs SharedArrayBuffer, which needs cross-origin isolation, which needs
 * headers only the service worker can add — and the first load happens before
 * the worker controls the page. Without that reload the database hangs forever
 * on a first visit.
 *
 * The reload is guarded three ways: skipped if already isolated, skipped if the
 * page is already controlled (which would mean the headers are not working and
 * reloading would loop), and skipped if it has already been attempted this
 * session.
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
    <style>
      #sc-diag {
        display: none;
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        padding: 20px; max-width: 720px; margin: 0 auto; color: #1c1c1c;
      }
      #sc-diag h1 { font-size: 18px; margin: 0 0 8px; }
      #sc-diag pre {
        background: #f4f4f4; border: 1px solid #ddd; border-radius: 6px;
        padding: 12px; overflow-x: auto; white-space: pre-wrap; font-size: 12px;
      }
      #sc-diag button {
        min-height: 44px; padding: 10px 16px; font-size: 15px;
        border: 1px solid #1c1c1c; background: #1c1c1c; color: #fff;
        border-radius: 6px; cursor: pointer;
      }
    </style>
    <script>
      /* Diagnostic fallback.
       *
       * A blank page is the least debuggable failure there is: if the bundle
       * throws while evaluating, React never mounts and the app cannot report
       * anything about itself. This lives OUTSIDE the bundle so it still works
       * in exactly that case.
       *
       * It captures errors and unhandled rejections, and if nothing has
       * rendered after a few seconds it shows what went wrong instead of
       * leaving a white screen.
       */
      (function () {
        var problems = [];

        function record(label, detail) {
          problems.push(label + ': ' + detail);
          render();
        }

        window.addEventListener('error', function (e) {
          if (e && e.message) record('Error', e.message + (e.filename ? '  (' + e.filename + ':' + e.lineno + ')' : ''));
        });
        window.addEventListener('unhandledrejection', function (e) {
          var r = e && e.reason;
          record('Unhandled rejection', (r && (r.message || r)) || 'unknown');
        });

        function appMounted() {
          var root = document.getElementById('root');
          return !!(root && root.children && root.children.length > 0);
        }

        function render() {
          if (appMounted()) return;
          var el = document.getElementById('sc-diag');
          if (!el) return;
          el.style.display = 'block';
          document.getElementById('sc-diag-body').textContent =
            problems.length ? problems.join('

') : 'The app did not start, and reported no error.';
          document.getElementById('sc-diag-env').textContent =
            'crossOriginIsolated: ' + (self.crossOriginIsolated === true) +
            '
SharedArrayBuffer: ' + (typeof SharedArrayBuffer !== 'undefined') +
            '
serviceWorker controlled: ' + (!!(navigator.serviceWorker && navigator.serviceWorker.controller)) +
            '
userAgent: ' + navigator.userAgent;
        }

        // Give the bundle a fair chance before declaring failure.
        setTimeout(render, 6000);

        window.__scHardReload = function () {
          try { sessionStorage.clear(); } catch (e) {}
          if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
            navigator.serviceWorker.getRegistrations().then(function (regs) {
              return Promise.all(regs.map(function (r) { return r.unregister(); }));
            }).catch(function () {}).then(function () { location.reload(); });
          } else {
            location.reload();
          }
        };
      })();
    </script>
    <script>
      // The worker supplies the cross-origin isolation headers expo-sqlite's
      // SharedArrayBuffer worker channel needs. The first load happens before
      // the worker controls the page, so reload once — guarded, so it cannot
      // loop.
      (function () {
        if (!('serviceWorker' in navigator)) return;

        navigator.serviceWorker.register('${BASE}/sw.js').then(function (reg) {
          if (self.crossOriginIsolated) return;
          if (navigator.serviceWorker.controller) return;
          if (sessionStorage.getItem('sc-iso-reload') === '1') return;

          sessionStorage.setItem('sc-iso-reload', '1');
          (reg.active ? Promise.resolve() : navigator.serviceWorker.ready).then(function () {
            window.location.reload();
          });
        }).catch(function () {});
      })();
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

  // The panel itself, after the app root so it never covers a working app.
  const panel = `
    <div id="sc-diag">
      <h1>Stay Close could not start</h1>
      <p>This is the web version. The Android app does not have this problem.</p>
      <pre id="sc-diag-body"></pre>
      <p>Environment:</p>
      <pre id="sc-diag-env"></pre>
      <button onclick="window.__scHardReload()">Clear cache and reload</button>
    </div>
  `;
  html = html.replace('</body>', `${panel}</body>`);

  writeFileSync(INDEX, html);
}

// GitHub Pages serves 404.html for unknown paths, which is how a single-page
// app keeps deep links working.
copyFileSync(INDEX, join(DIST, '404.html'));

console.log('[inject-pwa] manifest, icons, service worker and SPA fallback written');
