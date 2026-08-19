/* Stay Close service worker — offline support, fast repeat loads, and
 * cross-origin isolation (COOP/COEP) injection.
 *
 * GitHub Pages cannot send custom HTTP headers, but expo-sqlite's web
 * engine (wa-sqlite) needs SharedArrayBuffer, which only exists when the
 * page is "cross-origin isolated" — which in turn requires the
 * Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy response
 * headers. This worker adds those headers to every same-origin response
 * it serves, working around the missing server support. See:
 * https://github.com/gzuidhof/coi-serviceworker
 *
 * The very first page load (before this worker controls the page) is
 * NOT isolated — the bootstrap script in index.html detects that and
 * reloads once after the worker takes control.
 */
const CACHE = 'stay-close-v4';
const BASE = '/stay-close';

const PRECACHE = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/manifest.json`,
  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`,
];

function withCOI(res) {
  if (!res) return res;
  try {
    const headers = new Headers(res.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  } catch {
    return res;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          caches.open(CACHE).then((c) => c.put(`${BASE}/index.html`, res.clone()));
          return withCOI(res);
        } catch {
          const cached = (await caches.match(`${BASE}/index.html`)) || (await caches.match(`${BASE}/`));
          return withCOI(cached);
        }
      })()
    );
    return;
  }

  if (/\.(js|css|png|jpg|jpeg|svg|gif|webp|woff2?|ttf|wasm|json)$/i.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return withCOI(cached);
        const res = await fetch(req);
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return withCOI(res);
      })()
    );
  }
});
