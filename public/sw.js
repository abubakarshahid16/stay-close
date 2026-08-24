/* Service worker for the Stay Close web build.
 *
 * Exists for two reasons only:
 *
 * 1. A PWA needs a registered service worker before a browser will offer
 *    "Install app" / "Add to Home Screen".
 * 2. expo-sqlite's WASM build needs cross-origin isolation headers to use
 *    SharedArrayBuffer. GitHub Pages cannot set headers, so the worker
 *    supplies them via a fetch handler — this is the documented workaround and
 *    the reason the previous web version's database kept failing to open.
 *
 * It deliberately does NOT cache app assets. An offline-first cache would mean
 * users silently running a stale build, and the app's own data is already local
 * in SQLite — caching the shell buys little and hides deploys.
 */

self.addEventListener('install', (event) => {
  // Take over immediately rather than waiting for every tab to close.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only same-origin navigations and scripts need the isolation headers.
  if (request.mode !== 'navigate' && request.destination !== 'script') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const response = await fetch(request);

      // A response with no body (204/304) cannot be reconstructed.
      if (!response.body) return response;

      const headers = new Headers(response.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    })().catch(() => fetch(request))
  );
});
