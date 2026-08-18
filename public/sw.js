// Stay Close — Service Worker
// Cache-first for assets, network-first for navigation

const CACHE = 'stay-close-v1';
const BASE  = '/stay-close';

const PRECACHE = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Skip non-GET and cross-origin
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  const isNav = e.request.mode === 'navigate';
  const isAsset = /\.(js|css|png|jpg|jpeg|gif|webp|woff2?|wasm)$/.test(url.pathname);

  if (isNav) {
    // Network-first for navigation (fresh HTML)
    e.respondWith(
      fetch(e.request)
        .then(res => { caches.open(CACHE).then(c => c.put(e.request, res.clone())); return res; })
        .catch(() => caches.match(e.request).then(r => r || caches.match(BASE + '/')))
    );
  } else if (isAsset) {
    // Cache-first for assets (JS/CSS/images don't change without new filename)
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        });
      })
    );
  }
});
