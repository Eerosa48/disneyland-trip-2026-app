/* Greyson's Disney Trip — quiet map-only shell version and manual update check.
 * This control never displays update messages and never reloads the page itself.
 * The existing offline-ui.js controllerchange handler handles actual updates.
 */
(() => {
  'use strict';

  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  const style = document.createElement('style');
  style.textContent = `
    #greyson-version-check {
      position: fixed;
      top: calc(10px + env(safe-area-inset-top, 0px));
      right: calc(9px + env(safe-area-inset-right, 0px));
      z-index: 1200; /* Above map; below map menus, panels and admin overlay. */
      box-sizing: border-box;
      width: 44px;
      height: 40px;
      padding: 0;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: rgba(31, 70, 47, 0.62);
      text-shadow: 0 1px 2px rgba(255, 255, 255, 0.88);
      font: 750 11px/1 system-ui, -apple-system, sans-serif;
      text-align: center;
      cursor: pointer;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
      -webkit-user-select: none;
    }
    #greyson-version-check[hidden] { display: none !important; }
    #greyson-version-check:focus-visible {
      outline: 2px solid #1765d1;
      outline-offset: -3px;
    }
    /* Never sit on top of an open window, menu or welcome prompt. */
    body:has(
      .greyson-itinerary-panel:not([hidden]),
      .place-search-panel:not([hidden]),
      #greyson-wait-panel:not([hidden]),
      #greyson-admin-overlay:not([hidden]),
      .greyson-active-day-menu:not([hidden]),
      .focus-menu:not([hidden]),
      .leaflet-popup,
      #greyson-activity-welcome
    ) #greyson-version-check {
      visibility: hidden;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.id = 'greyson-version-check';
  button.type = 'button';
  button.hidden = true; // Show only an actual version reported by the worker.
  button.setAttribute('aria-label', 'Check for app updates');
  document.body.appendChild(button);

  function readActiveVersion(worker) {
    if (!worker || !('MessageChannel' in window)) return;

    const channel = new MessageChannel();
    const timeout = setTimeout(() => channel.port1.close(), 2000);

    channel.port1.onmessage = event => {
      const data = event.data;
      clearTimeout(timeout);
      channel.port1.close();
      if (!data || data.type !== 'GREYSON_SHELL_VERSION') return;
      const version = String(data.version || '');
      if (!/^\d{1,6}$/.test(version)) return;
      button.textContent = `v${version}`;
      button.hidden = false;
    };

    try {
      worker.postMessage({ type: 'GREYSON_GET_SHELL_VERSION' }, [channel.port2]);
    } catch (_) {
      clearTimeout(timeout);
      channel.port1.close();
    }
  }

  navigator.serviceWorker.ready.then(registration => {
    readActiveVersion(navigator.serviceWorker.controller || registration.active);
  }).catch(() => {});

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    readActiveVersion(navigator.serviceWorker.controller);
  });

  button.addEventListener('click', async () => {
    if (navigator.onLine === false) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration(
        new URL('./', document.baseURI).href
      );
      if (registration) await registration.update();
      // If unchanged, do nothing. A real update is reloaded by offline-ui.js.
    } catch (_) {
      // Update failures never produce a popup, toast or forced reload.
    }
  });
})();
