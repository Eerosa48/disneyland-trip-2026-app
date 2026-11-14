/* Greyson's Disney Trip — optional administrator launcher.
 * The name "Edward" is a convenience-only visibility gate, NOT authorization.
 * The existing Supabase reporting Edge Function must verify the admin user ID.
 * No administrator credentials or secret API keys belong in this file.
 */
(function () {
  'use strict';

  const IDENTITY_KEY = 'greyson-disney-activity-identity-v1';
  const OWNER_DISPLAY_NAME = 'edward';
  const DASHBOARD_PATH = './disney-activity-dashboard.html';
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.id = 'greyson-admin-launch';
  launcher.setAttribute('aria-label', 'Open private activity dashboard');
  launcher.title = 'Private activity dashboard';
  launcher.hidden = true;
  launcher.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 3v18h18"/>' +
    '<path d="m7 15 4-4 4 3 5-7"/>' +
    '<path d="M16 7h4v4"/>' +
    '</svg>';

  const overlay = document.createElement('section');
  overlay.id = 'greyson-admin-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Private Disney activity dashboard');
  overlay.innerHTML =
    '<div class="greyson-admin-header">' +
      '<div class="greyson-admin-heading">' +
        '<span class="greyson-admin-kicker">Greyson\'s Disney Trip</span>' +
        '<strong>Activity Dashboard</strong>' +
      '</div>' +
      '<button type="button" class="greyson-admin-close" ' +
        'aria-label="Close activity dashboard" title="Return to map">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.5" stroke-linecap="round" aria-hidden="true">' +
          '<path d="M5 5l14 14M19 5 5 19" />' +
        '</svg>' +
      '</button>' +
    '</div>' +
    '<iframe class="greyson-admin-frame" title="Private Disney Activity Dashboard" ' +
      'referrerpolicy="no-referrer"></iframe>';

  document.body.appendChild(launcher);
  document.body.appendChild(overlay);

  const frame = overlay.querySelector('iframe');
  const closeButton = overlay.querySelector('.greyson-admin-close');
  let open = false;
  let originalOverflow = '';
  let savedMapView = null;
  const previousInert = new Map();

  function isOwnerName() {
    try {
      const identity = JSON.parse(localStorage.getItem(IDENTITY_KEY) || 'null');
      return typeof identity?.name === 'string' &&
        identity.name.trim().toLowerCase() === OWNER_DISPLAY_NAME;
    } catch (_) {
      return false;
    }
  }

  function refreshLauncher() {
    launcher.hidden = !isOwnerName();
    if (launcher.hidden && open) closeDashboard();
  }

  function makeBackgroundInert() {
    for (const node of document.body.children) {
      if (node === overlay || !('inert' in node)) continue;
      previousInert.set(node, node.inert);
      node.inert = true;
    }
  }

  function restoreBackground() {
    for (const [node, inertValue] of previousInert) node.inert = inertValue;
    previousInert.clear();
  }

  function openDashboard() {
    if (open || !isOwnerName()) return;
    open = true;
    originalOverflow = document.body.style.overflow;
    savedMapView = (typeof map !== 'undefined' && map && typeof map.getCenter === 'function')
      ? { center: map.getCenter(), zoom: map.getZoom() } : null;
    makeBackgroundInert();
    document.body.style.overflow = 'hidden';
    overlay.hidden = false;
    const url = new URL(DASHBOARD_PATH, document.baseURI);
    url.searchParams.set('embedded', '1');
    frame.src = url.href;
    closeButton.focus({ preventScroll: true });
  }

  function closeDashboard() {
    if (!open) return;
    open = false;
    // Remove the embedded page (and its polling timers), leaving the map intact.
    frame.removeAttribute('src');
    overlay.hidden = true;
    document.body.style.overflow = originalOverflow;
    restoreBackground();
    if (savedMapView && typeof map !== 'undefined' && map && typeof map.setView === 'function') {
      map.setView(savedMapView.center, savedMapView.zoom, { animate: false });
    }
    savedMapView = null;
    if (!launcher.hidden) launcher.focus({ preventScroll: true });
  }

  // Prevent browser-level pinch zoom outside the Leaflet map.
  function blockPagePinch(doc, preserveMapPinch) {
    function shouldBlock(event) {
      if (!preserveMapPinch) return true;
      const target = event.target;
      return !(target instanceof Element && target.closest('#map'));
    }

    function cancelGesture(event) {
      if (shouldBlock(event) && event.cancelable) {
        event.preventDefault();
      }
    }

    ['gesturestart', 'gesturechange'].forEach(type => {
      doc.addEventListener(type, cancelGesture, {
        capture: true,
        passive: false
      });
    });

    ['touchstart', 'touchmove'].forEach(type => {
      doc.addEventListener(type, event => {
        if (event.touches.length > 1 &&
            shouldBlock(event) && event.cancelable) {
          event.preventDefault();
        }
      }, {
        capture: true,
        passive: false
      });
    });
  }

  // Protect the main interface, but preserve Leaflet map gestures.
  blockPagePinch(document, true);

  // The dashboard also works as a standalone page. Hide its own Map links
  // only when embedded, so navigation never replaces the frame with a map.
  frame.addEventListener('load', function () {
    if (!open) return;
    try {
      const documentInFrame = frame.contentDocument;
      if (!documentInFrame) return;
	  blockPagePinch(documentInFrame, false);
      documentInFrame.querySelectorAll('a.map-return, a[href="./index.html"]').forEach(function (link) {
        link.style.display = 'none';
        link.setAttribute('aria-hidden', 'true');
        link.tabIndex = -1;
      });
      documentInFrame.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') closeDashboard();
      });
    } catch (_) { /* Parent X is always available if DOM access is restricted. */ }
  });

  launcher.addEventListener('click', openDashboard);
  closeButton.addEventListener('click', closeDashboard);
  document.addEventListener('keydown', function (event) {
    if (open && event.key === 'Escape') closeDashboard();
  });

  // The tracker saves the name during a form submit. Recheck immediately
  // afterward so "Edward" sees the icon without needing a page refresh.
  document.addEventListener('submit', function (event) {
    if (event.target?.matches('#greyson-activity-welcome form')) {
      setTimeout(refreshLauncher, 0);
    }
  }, true);
  window.addEventListener('pageshow', refreshLauncher);
  window.addEventListener('storage', function (event) {
    if (event.key === IDENTITY_KEY) refreshLauncher();
  });
  refreshLauncher();
})();
