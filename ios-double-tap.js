/* Greyson's Disney Trip — reliable two-tap zoom for iPhone/iPad Safari and Home Screen.
 * Keeps Leaflet pinch, panning, and the existing double-tap-and-drag plugin intact.
 * Attach after the map is created; do not intercept controls or attraction markers.
 */
(function () {
  'use strict';
  if (!window.L || typeof map === 'undefined') return;

  // A touch-only fallback: do not change desktop double-click zoom.
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIOS || !('ontouchstart' in window)) return;

  var element = map.getContainer();
  var TAP_MS = 300;
  var BETWEEN_TAPS_MS = 350;
  var MAX_MOVE_SQ = 12 * 12;
  var MAX_SEPARATION_SQ = 40 * 40;
  var blocked = '.leaflet-control, .leaflet-popup, .leaflet-marker-icon, ' +
    '.leaflet-interactive, .leaflet-tooltip, button, a, input, select, textarea, [role="button"]';
  var active = null;
  var previous = null;

  function distanceSq(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function reset() {
    active = null;
    previous = null;
  }

  function onStart(event) {
    // Don't turn double-taps on UI, markers, or multi-finger gestures into zooms.
    if (event.touches.length !== 1 ||
        (event.target.closest && event.target.closest(blocked))) {
      reset();
      return;
    }
    var t = event.touches[0];
    active = {
      id: t.identifier, x: t.clientX, y: t.clientY,
      started: Date.now(), moved: false
    };
  }

  function onMove(event) {
    if (!active) return;
    // Even a slight move on the second touch belongs to the existing
    // double-touch-drag plugin, not to the discrete two-tap gesture.
    active.moved = true;
    if (event.touches.length !== 1) reset();
  }

  function onEnd(event) {
    if (!active) return;
    var start = active;
    active = null;
    if (event.touches.length !== 0 || event.changedTouches.length !== 1 || start.moved) {
      previous = null;
      return;
    }
    var touch = event.changedTouches[0];
    var now = Date.now();
    var tap = { x: touch.clientX, y: touch.clientY, ended: now };
    if (touch.identifier !== start.id || now - start.started > TAP_MS ||
        distanceSq(start, tap) > MAX_MOVE_SQ) {
      previous = null;
      return;
    }

    if (previous && now - previous.ended <= BETWEEN_TAPS_MS &&
        distanceSq(previous, tap) <= MAX_SEPARATION_SQ) {
      previous = null;
      if (map.getZoom() < map.getMaxZoom()) {
        var point = map.mouseEventToContainerPoint(touch);
        map.setZoomAround(point,
          Math.min(map.getMaxZoom(), map.getZoom() + map.options.zoomDelta),
          { animate: true });
      }
    } else {
      previous = tap;
    }
  }

  // Leaflet can also synthesize a dblclick from two iOS taps. Turn off ONLY
  // its iOS dblclick zoom handler so our fallback can't zoom twice.
  map.doubleClickZoom.disable();
  element.addEventListener('touchstart', onStart, { passive: true });
  element.addEventListener('touchmove', onMove, { passive: true });
  element.addEventListener('touchend', onEnd, { passive: true });
  element.addEventListener('touchcancel', reset, { passive: true });
})();
