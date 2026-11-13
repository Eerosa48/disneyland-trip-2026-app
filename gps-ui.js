/* Greyson's Disney Trip — compact GPS wayfinder (review version).
   On-device Geolocation API only. No coordinates are sent by this script.
   Tap once to start GPS; tap again to recenter at a closer zoom.
   Tracking pauses when the app is hidden and resumes when visible.
*/
(function () {
  'use strict';
  if (!window.L || typeof map === 'undefined') return;

  // Same artwork boundary as our Leaflet map. Never pan to a distant location.
  var resortBounds = typeof artworkBounds !== 'undefined'
    ? artworkBounds
    : L.latLngBounds([33.80197, -117.93097], [33.81987, -117.91281]);

  // Adjust this one value if you prefer a closer/wider recenter view.
  // The app won't zoom OUT if the user is already closer than this.
  var GPS_FOCUS_ZOOM = 19.0;
  var watchId = null;
  var trackingRequested = false;
  var centerOnNextFix = false;
  var lastPosition = null;
  var outsideNotified = false;
  var dot = null;
  var accuracyCircle = null;
  var button = null;
  var toast = null;
  var toastTimer = null;

  // Place GPS graphics above the map artwork without intercepting gestures.
  var pane = map.getPane('greyson-gps-pane') || map.createPane('greyson-gps-pane');
  pane.style.zIndex = '625';
  pane.style.pointerEvents = 'none';

  function notify(message) {
    if (!toast) return;
    if (toastTimer !== null) clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(function () {
      toast.hidden = true;
      toastTimer = null;
    }, 3500);
  }

  function updateButton() {
    if (!button) return;
    button.classList.toggle('is-active', trackingRequested);
    button.setAttribute('aria-pressed', String(trackingRequested));
    var label = trackingRequested
      ? 'Recenter map on my current location'
      : 'Turn on location and find me on the map';
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  function removeGraphics() {
    if (dot) { map.removeLayer(dot); dot = null; }
    if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }
  }

  function centerOn(position) {
    if (!position || !resortBounds.contains(position)) return false;
    // Respect a manually chosen zoom if it is already closer than 19.
    map.flyTo(position, Math.max(GPS_FOCUS_ZOOM, map.getZoom()), { duration: 0.6 });
    centerOnNextFix = false;
    return true;
  }

  function clearWatch() {
    if (watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function deactivate() {
    trackingRequested = false;
    centerOnNextFix = false;
    lastPosition = null;
    outsideNotified = false;
    clearWatch();
    removeGraphics();
    updateButton();
  }

  function onPosition(result) {
    if (!trackingRequested || document.hidden) return;
    var coords = result && result.coords;
    if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) {
      notify('Location data unavailable');
      return;
    }
    // Do not show a cached old GPS fix as if it were live.
    if (Number.isFinite(result.timestamp) && Date.now() - result.timestamp > 60000) return;

    var position = L.latLng(coords.latitude, coords.longitude);
    lastPosition = position;

    if (!resortBounds.contains(position)) {
      removeGraphics();
      if (!outsideNotified) notify('Bruh, this only works in Disney');
      outsideNotified = true;
      return;
    }
    outsideNotified = false;

    var accuracy = Number(coords.accuracy);
    var validAccuracy = Number.isFinite(accuracy) && accuracy > 0;
    if (!dot) {
      dot = L.circleMarker(position, {
        pane: 'greyson-gps-pane', interactive: false,
        radius: 8, weight: 3, color: '#ffffff',
        fillColor: '#1765d1', fillOpacity: 1
      }).addTo(map);
    } else {
      dot.setLatLng(position);
    }

    // Keep the true accuracy radius when it fits the map. Hide very large
    // circles (>250 m) rather than drawing a misleading, clipped radius.
    if (validAccuracy && accuracy <= 250) {
      if (!accuracyCircle) {
        accuracyCircle = L.circle(position, {
          pane: 'greyson-gps-pane', interactive: false,
          radius: accuracy, color: '#2d77d4', weight: 1,
          opacity: 0.55, fillColor: '#3388ff', fillOpacity: 0.11
        }).addTo(map);
      } else {
        accuracyCircle.setLatLng(position);
        accuracyCircle.setRadius(accuracy);
      }
      dot.bringToFront();
    } else if (accuracyCircle) {
      map.removeLayer(accuracyCircle);
      accuracyCircle = null;
    }

    if (centerOnNextFix) centerOn(position);
  }

  function onError(error) {
    if (!trackingRequested || document.hidden) return;
    if (error && error.code === 1) {
      deactivate();
      notify('Location access denied. Check browser permissions.');
    } else if (error && error.code === 3) {
      notify('Waiting for a GPS signal…');
    } else {
      notify('Location temporarily unavailable');
    }
  }

  function startWatch() {
    if (!trackingRequested || watchId !== null || document.hidden) return;
    try {
      watchId = navigator.geolocation.watchPosition(onPosition, onError, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 20000
      });
    } catch (_) {
      deactivate();
      notify('Unable to start location services');
    }
  }

  function locateOrRecenter() {
    if (!window.isSecureContext || !navigator.geolocation) {
      notify('Location requires HTTPS or localhost');
      return;
    }
    if (!trackingRequested) {
      trackingRequested = true;
      centerOnNextFix = true;
      updateButton();
      startWatch();
    } else if (!centerOn(lastPosition)) {
      centerOnNextFix = true;
      notify(lastPosition && !resortBounds.contains(lastPosition)
        ? 'Bruh, this only works in Disney'
        : 'Finding your location…');
    }
  }

  var GPSControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function () {
      var root = L.DomUtil.create('div', 'leaflet-control-greyson-gps');
      button = L.DomUtil.create('button', 'greyson-gps-locate', root);
      button.type = 'button';
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path d="M20.5 3.5 14.2 21l-3.3-7.8L3 9.8 20.5 3.5Z"/>' +
        '</svg>';
      // Separate map recenter button above the GPS arrow.
      var recenterButton = L.DomUtil.create(
        'button', 'greyson-map-recenter', root
      );

      recenterButton.type = 'button';
      recenterButton.title = 'Return to the default map view';
      recenterButton.setAttribute(
        'aria-label', 'Recenter the resort map'
      );

      recenterButton.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
          '<circle cx="12" cy="12" r="6.25"/>' +
          '<path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>' +
        '</svg>';

      recenterButton.addEventListener('click', function () {
        if (typeof focusInitialView === 'function') {
          focusInitialView(true);
        }
      });
      toast = L.DomUtil.create('div', 'greyson-gps-toast', document.body);
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.hidden = true;
	  toast.addEventListener('click', function () {
		clearTimeout(toastTimer);
		toast.hidden = true;
		toastTimer = null;
	  });
      updateButton();
      button.addEventListener('click', locateOrRecenter);
      L.DomEvent.disableClickPropagation(root);
      L.DomEvent.disableScrollPropagation(root);
      return root;
    }
  });
  map.addControl(new GPSControl());

  // iOS may suspend the page when backgrounded. Explicitly release the GPS
  // watcher while hidden, then resume only if the user had enabled tracking.
  document.addEventListener('visibilitychange', function () {
    if (!trackingRequested) return;
    if (document.hidden) {
      clearWatch();
      lastPosition = null;
      removeGraphics();
    } else {
      startWatch();
    }
  });
  window.addEventListener('pagehide', function () {
    clearWatch();
    lastPosition = null;
    removeGraphics();
  });
  window.addEventListener('pageshow', function () {
    if (trackingRequested) startWatch();
  });
})();
