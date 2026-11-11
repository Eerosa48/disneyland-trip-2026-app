/* Compact, resumable offline-map control. No third-party dependencies. */
(() => {
  'use strict';
  const TILE_CACHE = 'greyson-disney-tiles-v1'; // Must match sw.js
  const root = new URL('./', document.baseURI);
  const ready = window.isSecureContext && 'serviceWorker' in navigator && 'caches' in window;
  const style = document.createElement('style');
  style.textContent = `
    #disney-offline { position:fixed; left:12px; bottom:calc(14px + env(safe-area-inset-bottom, 0px)); z-index:1150;
      font: 13px/1.4 system-ui,-apple-system,sans-serif; color:#233328; }
    #disney-offline button { cursor:pointer; font:inherit; touch-action:manipulation; }
    #disney-offline .offline-launch { border:1px solid #8da387; border-radius:24px; padding:8px 13px;
      background:rgba(255,255,255,.95); box-shadow:0 2px 9px #0003; font-weight:650; }
    #disney-offline .offline-panel { position:absolute; bottom:calc(100% + 9px); left:0;
      width:min(320px, calc(100vw - 24px)); box-sizing:border-box; border:1px solid #c4d0bf;
      border-radius:12px; background:rgba(255,255,255,.98); box-shadow:0 6px 24px #0003; padding:14px; }
    #disney-offline .offline-panel[hidden] { display:none; }
    #disney-offline .offline-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    #disney-offline .offline-head strong { font-size:14px; }
    #disney-offline .offline-dismiss { border:0; background:transparent; padding:3px 7px; font-size:18px; }
    #disney-offline p { margin:8px 0; }
    #disney-offline .offline-state { color:#465b47; min-height:20px; }
    #disney-offline progress { display:block; width:100%; height:11px; accent-color:#4e7650; margin:11px 0 5px; }
    #disney-offline .offline-actions { display:flex; gap:8px; margin-top:10px; }
    #disney-offline .offline-actions button { border:1px solid #6c8d71; border-radius:8px; padding:9px 10px;
      background:#416d4b; color:white; font-weight:600; }
    #disney-offline .offline-actions button:disabled { opacity:.55; cursor:default; }
    #disney-offline .offline-actions .offline-pause { background:white; color:#344d36; }
    #disney-offline .offline-hint { display:block; color:#657568; font-size:11px; margin-top:8px; }
  `;
  document.head.append(style);

  const mount = document.createElement('aside');
  mount.id = 'disney-offline';
  mount.setAttribute('aria-label', 'Offline map controls');
  mount.innerHTML = `
    <button type="button" class="offline-launch" aria-expanded="false">↓ Offline map</button>
    <div class="offline-panel" hidden>
      <div class="offline-head"><strong>Offline map</strong>
        <button type="button" class="offline-dismiss" aria-label="Close offline map panel">×</button></div>
      <p>Save the complete trimmed map to this device for use without internet.</p>
      <div class="offline-state" role="status" aria-live="polite">Checking device…</div>
      <progress max="1" value="0" aria-label="Offline download progress"></progress>
      <div class="offline-actions">
        <button type="button" class="offline-download">Download map</button>
        <button type="button" class="offline-pause" hidden>Pause</button>
      </div>
      <small class="offline-hint">Keep the app open while downloading. If interrupted, reopen and resume.</small>
    </div>`;
  document.body.append(mount);
  const launch = mount.querySelector('.offline-launch');
  const panel = mount.querySelector('.offline-panel');
  const dismiss = mount.querySelector('.offline-dismiss');
  const status = mount.querySelector('.offline-state');
  const progress = mount.querySelector('progress');
  const downloadButton = mount.querySelector('.offline-download');
  const pauseButton = mount.querySelector('.offline-pause');

  let manifest = null;
  let downloading = false;
  let paused = false;
  let controller = null;
  let done = 0;
  let failures = 0;

  function show(message) { status.textContent = message; }
  function progressTo(count, total) {
    progress.max = Math.max(1, total);
    progress.value = Math.min(total, count);
    launch.textContent = count === total && total > 0 ? '✓ Offline map ready' : '↓ Offline map';
  }
  function toggle(open) {
    panel.hidden = !open;
    launch.setAttribute('aria-expanded', String(open));
    if (open && !downloading) refreshStatus().catch(error => show(`Status unavailable: ${error.message}`));
  }
  launch.addEventListener('click', () => toggle(panel.hidden));
  dismiss.addEventListener('click', () => toggle(false));
  pauseButton.addEventListener('click', () => {
    if (!downloading) return;
    paused = true;
    controller?.abort();
    show('Pausing… download progress is saved.');
  });

  async function ensureManifest() {
    if (manifest) return manifest;
    const response = await fetch(new URL('tile-index.json', root), { cache: 'no-cache' });
    if (!response.ok) throw new Error('tile-index.json is missing. Run py build_tile_index.py.');
    const payload = await response.json();
    if (!Array.isArray(payload.files) || payload.files.length === 0) throw new Error('Tile index is empty.');
    if (!payload.files.every(path => typeof path === 'string' && /^tiles\/(16|17|18|19|20)\/\d+\/\d+\.jpg$/.test(path))) {
      throw new Error('Invalid tile list.');
    }
    manifest = payload;
    return manifest;
  }

  async function getStoredPaths(cache) {
    const requests = await cache.keys();
    return new Set(requests.map(request => request.url));
  }

  async function refreshStatus() {
    if (!ready) {
      downloadButton.disabled = true;
      show('Offline downloads need HTTPS. Your local iPhone LAN link is for preview only.');
      return;
    }
    const tileList = await ensureManifest();
    const cache = await caches.open(TILE_CACHE);
    const cached = await getStoredPaths(cache);
    done = tileList.files.filter(path => cached.has(new URL(path, root).href)).length;
    progressTo(done, tileList.files.length);
    show(done === tileList.files.length
      ? `All ${done.toLocaleString()} tiles saved. Ready for airplane mode.`
      : `${done.toLocaleString()} of ${tileList.files.length.toLocaleString()} tiles saved.`);
    downloadButton.textContent = done ? 'Resume download' : 'Download all tiles';
    downloadButton.disabled = false;
  }

  downloadButton.addEventListener('click', async () => {
    if (!ready || downloading) return;
    downloading = true;
    paused = false;
    failures = 0;
    controller = new AbortController();
    downloadButton.disabled = true;
    pauseButton.hidden = false;
    try {
      if (navigator.storage && typeof navigator.storage.persist === 'function') {
        try { await navigator.storage.persist(); } catch (_error) { /* Optional hint only. */ }
      }
      const tileList = await ensureManifest();
      const cache = await caches.open(TILE_CACHE);
      const cached = await getStoredPaths(cache);
      const remaining = tileList.files.filter(path => !cached.has(new URL(path, root).href));
      const total = tileList.files.length;
      done = total - remaining.length;
      progressTo(done, total);
      show(`Saving map: ${done.toLocaleString()} / ${total.toLocaleString()} tiles…`);

      let nextIndex = 0;
      let fatalStorageError = false;
      const worker = async () => {
        while (!paused && !fatalStorageError && nextIndex < remaining.length) {
          const path = remaining[nextIndex++];
          const url = new URL(path, root).href;
          try {
            const request = new Request(url, {
              cache: 'no-store', signal: controller.signal,
              headers: { 'X-Disney-Bulk': '1' }
            });
            const response = await fetch(request);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            await cache.put(url, response);
            done++;
          } catch (error) {
            if (paused || error.name === 'AbortError') break;
            failures++;
            if (error.name === 'QuotaExceededError') {
              fatalStorageError = true;
              controller.abort();
            }
          }
          if ((done + failures) % 15 === 0 || done === total) {
            progressTo(done, total);
            show(`Saved ${done.toLocaleString()} / ${total.toLocaleString()} tiles${failures ? `; ${failures} failed` : ''}.`);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, remaining.length) }, () => worker()));
      progressTo(done, total);
      if (fatalStorageError) {
        show(`Storage is full after ${done.toLocaleString()} tiles. Free space and try again.`);
      } else if (paused) {
        show(`Paused at ${done.toLocaleString()} / ${total.toLocaleString()}. Resume whenever ready.`);
      } else if (failures > 0) {
        show(`Saved ${done.toLocaleString()} / ${total.toLocaleString()}; ${failures} missing. Tap Retry.`);
      } else {
        show(`All ${done.toLocaleString()} tiles saved! Test in airplane mode.`);
      }
      downloadButton.textContent = failures > 0 ? 'Retry missing tiles' : 'Resume download';
    } catch (error) {
      show(`Download not ready: ${error.message}`);
    } finally {
      downloading = false;
      controller = null;
      downloadButton.disabled = false;
      pauseButton.hidden = true;
    }
  });

  async function start() {
    if (!ready) {
      downloadButton.disabled = true;
      show('For offline use, open the app over HTTPS. LAN HTTP cannot run its service worker on iPhone.');
      return;
    }
    try {
      await navigator.serviceWorker.register(new URL('sw.js', root).href, { scope: root.pathname });
      await navigator.serviceWorker.ready;
      await refreshStatus();
    } catch (error) {
      downloadButton.disabled = true;
      show(`Offline setup failed: ${error.message}`);
    }
  }
  start();
})();
