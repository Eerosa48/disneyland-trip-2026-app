/* Greyson's Disney Trip: installable shell + persistent tile cache.
   Only requests within the app's own HTTPS/localhost origin are cached. */
const SHELL_CACHE = 'greyson-disney-shell-15';
const TILE_CACHE = 'greyson-disney-tiles-v1';
const SHELL_PREFIX = 'greyson-disney-shell-';
const APP_ROOT = new URL('./', self.registration.scope);
const SHELL_FILES = [
  './', './index.html', './manifest.webmanifest', './offline-ui.js',
  './tile-index.json', './places.json', './places-ui.css', './places-ui.js',
  './vendor/leaflet.css', './vendor/leaflet.js',
  './vendor/leaflet-double-touch-drag-zoom.css',
  './vendor/leaflet-double-touch-drag-zoom.js',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/apple-touch-icon.png', './wait-times.js',
  './wait-times.css',
  './gps-ui.js',
  './gps-ui.css',
  './route-2026.json',
  './itinerary-2026.json',
  './itinerary-ui.css',
  './itinerary-ui.js',
  './walking-routes-2026.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_FILES.map(path => new URL(path, APP_ROOT).href));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(SHELL_PREFIX) && key !== SHELL_CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== APP_ROOT.origin || !url.pathname.startsWith(APP_ROOT.pathname)) return;

  const relative = url.pathname.slice(APP_ROOT.pathname.length);
  if (relative.startsWith('tiles/')) {
    event.respondWith((async () => {
      // Bulk downloader writes successful responses itself, avoiding double writes.
      if (request.headers.get('X-Disney-Bulk') === '1') return fetch(request);
      const cache = await caches.open(TILE_CACHE);
      const existing = await cache.match(request);
      if (existing) return existing;
      try {
        const response = await fetch(request);
        if (response.ok) {
          try { await cache.put(request, response.clone()); }
          catch (_storageError) { /* Still show online tile if storage is full. */ }
        }
        return response;
      } catch (_networkError) {
        return Response.error();
      }
    })());
    return;
  }

  // Keep the app's code fresh online; fall back to cached files offline.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try {
      const response = await fetch(request);
      if (response.ok && response.type !== 'opaque') {
        try { await cache.put(request, response.clone()); }
        catch (_storageError) { /* Serving online remains possible. */ }
      }
      return response;
    } catch (_networkError) {
      const fallback = await cache.match(request, { ignoreSearch: true });
      if (fallback) return fallback;
      if (request.mode === 'navigate') {
        const index = await cache.match(new URL('./index.html', APP_ROOT).href);
        if (index) return index;
      }
      return new Response('This resource is not downloaded for offline use.', {
        status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain' }
      });
    }
  })());
});
