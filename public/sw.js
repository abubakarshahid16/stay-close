/* Service worker for the Stay Close web build.
 *
 * Does two jobs, both load-bearing.
 *
 * 1. **Cross-origin isolation.** expo-sqlite's web build uses SharedArrayBuffer
 *    and Atomics.wait to talk to its SQLite worker (see
 *    node_modules/expo-sqlite/web/WorkerChannel.ts). SharedArrayBuffer only
 *    exists in a cross-origin-isolated context, which requires
 *    Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy response
 *    headers. GitHub Pages cannot set headers, so this worker supplies them.
 *
 *    Without isolation the worker never replies, Atomics.wait never resolves,
 *    and the app hangs on its loading screen forever.
 *
 * 2. **Installability.** A registered worker with a fetch handler is what makes
 *    browsers offer "Install app" / "Add to Home Screen".
 *
 * THE PART THAT IS EASY TO GET WRONG: `COEP: require-corp` makes the browser
 * reject every subresource that does not carry a
 * Cross-Origin-Resource-Policy header. GitHub Pages sends none. An earlier
 * version of this file set COOP/COEP on the document but not CORP on the
 * assets, so the app's own JS bundle was blocked and the page went blank.
 * Both halves are required, or neither should be attempted.
 *
 * It deliberately does NOT cache anything. An offline cache would mean users
 * silently running a stale build, and their data already lives locally in
 * SQLite.
 */

self.addEventListener('install', (event) => {
  // Activate immediately so a deploy is picked up on the next load.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only same-origin requests are ours to annotate. A cross-origin request
  // would need CORP from its own server, which we cannot provide.
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const response = await fetch(request);

      // 204/304 and opaque responses have no body to re-wrap.
      if (!response.body) return response;

      const headers = new Headers(response.headers);

      // Every same-origin response gets CORP, so it is allowed to load inside
      // a require-corp document. This is the half that was missing before.
      headers.set('Cross-Origin-Resource-Policy', 'same-origin');

      // The document itself additionally needs COOP + COEP for
      // crossOriginIsolated to become true and SharedArrayBuffer to exist.
      if (request.mode === 'navigate') {
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    })().catch(() => fetch(request))
  );
});
