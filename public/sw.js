/* Service worker for the Stay Close web build.
 *
 * Exists for ONE reason: a browser will not offer "Install app" / "Add to Home
 * Screen" without a registered service worker.
 *
 * It deliberately does almost nothing else.
 *
 * A previous version of this file added Cross-Origin-Opener-Policy and
 * Cross-Origin-Embedder-Policy headers, intending to enable SharedArrayBuffer
 * for expo-sqlite's WASM build. That was actively harmful: COEP
 * `require-corp` makes the browser reject every subresource that lacks a
 * Cross-Origin-Resource-Policy header, GitHub Pages does not send one, and the
 * result was the app's own JS bundle being blocked — a blank page as soon as the
 * worker took control. Adding isolation headers without also serving CORP on
 * every asset is worse than not adding them at all.
 *
 * It also does NOT cache app assets. An offline-first cache would mean users
 * silently running a stale build, and their data already lives locally in the
 * database — caching the shell buys little and hides deploys.
 */

self.addEventListener('install', (event) => {
  // Activate immediately rather than waiting for every tab to close, so a
  // deploy is picked up on the next load.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// No fetch handler. Requests go straight to the network, which is what we want:
// intercepting them added risk and bought nothing.
