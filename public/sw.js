/* Service worker for the Stay Close web build.
 *
 * Exists for one reason: browsers require a registered service worker with a
 * fetch handler before offering "Install app" / "Add to Home Screen".
 *
 * It no longer manipulates headers. An earlier version added COOP/COEP to make
 * SharedArrayBuffer available for expo-sqlite's web build, which needed
 * cross-origin isolation. That approach caused two separate outages: without
 * matching CORP headers on every asset it blocked the app's own bundle (blank
 * page), and with them it depended on a second page load to take effect.
 *
 * The web build now uses sql.js, which is single-threaded and needs no
 * SharedArrayBuffer and no isolation. So the headers are gone, and with them
 * the whole class of failure.
 *
 * It deliberately does not cache. An offline cache would leave users on a stale
 * build, and their data already lives locally in IndexedDB.
 */

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass-through. Present because installability requires a fetch handler, not
// because anything needs intercepting.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
