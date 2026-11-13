/* Greyson's Disney Trip — quiet, automatic, resumable offline map cache.
 * No permanent button or progress panel. No changes to the service worker.
 * Cache names must remain consistent with sw.js to preserve saved tiles.
 */
(() => {
  'use strict';

  const TILE_CACHE = 'greyson-disney-tiles-v1';
  const root = new URL('./', document.baseURI);
  const available = window.isSecureContext && 'serviceWorker' in navigator && 'caches' in window;
  const WORKERS = 6;

  // Brief, non-interactive status messages at the former button's location.
  const style = document.createElement('style');
  style.textContent = `    
  #disney-offline-toast {
    position: fixed;
    top: calc(170px + env(safe-area-inset-top, 0px));
	left: 50%;
	bottom: auto;
	z-index: 3100;
	width: max-content;
	text-align: center;
    max-width: min(300px, calc(100vw - 28px));

    /* Text only — no background or container appearance */
    padding: 0;
    border: none;
    background: transparent;
    box-shadow: none;

    /* White lettering with dark outline */
    color: #ffffff;
    font: 700 13px/1.4 system-ui, -apple-system, sans-serif;
    text-shadow:
      -1px -1px 1px rgba(0,0,0,.9),
       1px -1px 1px rgba(0,0,0,.9),
      -1px  1px 1px rgba(0,0,0,.9),
       1px  1px 1px rgba(0,0,0,.9),
       0px  2px 4px rgba(0,0,0,.7);

    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transform: translate(-50%, 6px);
    transition:
      opacity 250ms ease,
      transform 250ms ease,
      visibility 250ms ease;
  }
    #disney-offline-toast.is-visible {
      opacity: 1;
      visibility: visible;
      transform: translate(-50%, 0);
    }
    #disney-offline-toast.is-warning { color: #ffe6ad; }
    @media (prefers-reduced-motion: reduce) {
      #disney-offline-toast { transition: none; transform: translate(-50%, 0); }
    }
  `;
  document.head.appendChild(style);

  const toast = document.createElement('div');
  toast.id = 'disney-offline-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  document.body.appendChild(toast);

  let toastTimer = null;
  function notify(message, warning = false) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle('is-warning', warning);
    toast.classList.add('is-visible');
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3300);
  }

  let manifest = null;
  let serviceReady = false;
  let running = null;
  let abortController = null;
  let pausedForPage = false;
  let retryAfterRun = false;

  async function ensureManifest() {
    if (manifest) return manifest;
    const response = await fetch(new URL('tile-index.json', root), { cache: 'no-cache' });
    if (!response.ok) throw new Error('Tile index unavailable (HTTP ' + response.status + ')');
    const data = await response.json();
    if (!Array.isArray(data.files) || data.files.length === 0 ||
        !data.files.every(path => typeof path === 'string' &&
          /^tiles\/(16|17|18|19|20)\/\d+\/\d+\.jpg$/.test(path))) {
      throw new Error('Invalid offline tile index');
    }
    manifest = data;
    return data;
  }

  function canAutoDownload() {
    if (!available || !serviceReady || document.hidden || navigator.onLine === false) return false;
    // Honor data-saving preferences, and known cellular links where exposed.
    // Safari on iPhone does not reliably expose the connection type.
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return !(connection && (connection.saveData || connection.type === 'cellular'));
  }

  async function syncMissingTiles() {
    if (!canAutoDownload()) return;
    const tileList = await ensureManifest();
    const cache = await caches.open(TILE_CACHE);
    const stored = new Set((await cache.keys()).map(request => request.url));
    const missing = tileList.files.filter(path => !stored.has(new URL(path, root).href));

    // A completed download has NO recurring banner or network tile requests.
    if (missing.length === 0) return;
    if (!canAutoDownload()) return;

    // Best-effort persistence permission; denial never prevents caching.
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      try { await navigator.storage.persist(); } catch (_) { /* optional */ }
    }
    if (!canAutoDownload()) return;

    notify('Offline maps downloading…');
    abortController = new AbortController();
    pausedForPage = false;
    let index = 0;
    let failures = 0;
    let storageFull = false;
    let successes = 0;

    async function worker() {
      while (index < missing.length && !pausedForPage && !storageFull) {
        const path = missing[index++];
        const url = new URL(path, root).href;
        try {
          // The service worker deliberately bypasses tile writes with this header.
          // This code caches each successful response exactly once.
          const response = await fetch(new Request(url, {
            cache: 'no-store',
            signal: abortController.signal,
            headers: { 'X-Disney-Bulk': '1' }
          }));
          if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + path);
          await cache.put(url, response);
          successes++;
        } catch (error) {
          if (pausedForPage || error.name === 'AbortError') break;
          failures++;
          if (error.name === 'QuotaExceededError') {
            storageFull = true;
            abortController.abort();
            break;
          }
          // Other failed tiles remain missing and can be retried next visit.
          if (failures <= 3) console.warn('Offline map tile:', path, error);
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(WORKERS, missing.length) }, worker));
      if (pausedForPage) return; // Resume on next visible app visit.
      if (storageFull) {
        console.warn('Offline map cache: browser storage quota reached.');
        notify('Offline maps incomplete — storage full', true);
      } else if (failures > 0) {
        console.warn('Offline map cache:', failures, 'tiles failed; they can be retried next visit.');
        notify('Offline maps incomplete — will retry later', true);
      } else if (successes === missing.length) {
        notify('Offline maps ready');
      }
    } finally {
      abortController = null;
    }
  }

  function runCheck() {
    if (!canAutoDownload()) return;
    if (running) {
      retryAfterRun = true;
      return;
    }
    running = syncMissingTiles()
      .catch(error => {
        console.warn('Offline map setup:', error);
        if (!document.hidden) notify('Offline maps unavailable — will retry later', true);
      })
      .finally(() => {
        running = null;
        if (retryAfterRun) {
          retryAfterRun = false;
          if (canAutoDownload()) runCheck();
        }
      });
  }

  // Mobile browsers may suspend in-flight requests when the app is backgrounded.
  // Stop cleanly and pick up only missing tiles when it becomes visible again.
  function suspendDownload() {
    if (!abortController) return;
    pausedForPage = true;
    abortController.abort();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) suspendDownload();
    else runCheck();
  });
  window.addEventListener('pagehide', suspendDownload);
  window.addEventListener('pageshow', runCheck);
  window.addEventListener('online', runCheck);

  async function start() {
    if (!available) {
      console.info('Offline map auto-download requires HTTPS or localhost and Cache Storage support.');
      return;
    }
    try {
      await navigator.serviceWorker.register(new URL('sw.js', root).href, { scope: root.pathname });
      await navigator.serviceWorker.ready;
      serviceReady = true;
      runCheck();
    } catch (error) {
      console.warn('Offline map service-worker setup:', error);
      notify('Offline maps unavailable — will retry later', true);
    }
  }
  start();
})();
