/* Greyson's Disney Trip — optional on-device location indicator.
   Uses the browser's Geolocation API. No location is sent by this script.
   Review locally before committing to GitHub.
*/
(function () {
  'use strict';

  if (!window.L || typeof map === 'undefined') return;

  // Use the same visible-artwork boundary as our existing map.
  var resortBounds = typeof artworkBounds !== 'undefined'
    ? artworkBounds
    : L.latLngBounds([33.80197, -117.93097], [33.81987, -117.91281]);

  var watchId = null;
  var trackingRequested = false;
  var centerOnNextFix = false;
  var lastPosition = null;
  var dot = null;
  var accuracyCircle = null;
  var locateButton, stopButton, statusText;

  // GPS symbols sit above map artwork, but never intercept taps or swipes.
  var pane = map.getPane('greyson-gps-pane') || map.createPane('greyson-gps-pane');
  pane.style.zIndex = '625';
  pane.style.pointerEvents = 'none';

  function message(text) {
    if (statusText) statusText.textContent = text;
  }

  function removeGraphics() {
    if (dot) { map.removeLayer(dot); dot = null; }
    if (accuracyCircle) { map.removeLayer(accuracyCircle); accuracyCircle = null; }
  }

  function centerOn(position) {
    if (!position || !resortBounds.contains(position)) {
      message('Outside the resort map');
      return false;
    }
    map.flyTo(position, Math.max(17.5, map.getZoom()), { duration: 0.6 });
    centerOnNextFix = false;
    return true;
  }

  function onPosition(result) {
    if (!trackingRequested) return;
    var coords = result && result.coords;
    if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) {
      message('Could not read GPS coordinates');
      return;
    }
    // Do not show an old cached position as current after leaving the app.
    if (Number.isFinite(result.timestamp) && Date.now() - result.timestamp > 60000) {
      message('Waiting for a current GPS fix…');
      return;
    }

    var position = L.latLng(coords.latitude, coords.longitude);
    lastPosition = position;
    locateButton.textContent = '◎ Recenter';

    if (!resortBounds.contains(position)) {
      removeGraphics();
      message('GPS active · outside the resort map');
      return;
    }

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

    // Very large circles would obscure the park map. Show the measured
    // uncertainty in text instead of drawing circles above 250 meters.
    if (validAccuracy && accuracy <= 250) {
      if (!accuracyCircle) {
        accuracyCircle = L.circle(position, {
          pane: 'greyson-gps-pane', interactive: false,
          radius: accuracy, color: '#2d77d4', weight: 1,
          opacity: 0.55, fillColor: '#3388ff', fillOpacity: 0.11
        }).addTo(map);
        dot.bringToFront();
      } else {
        accuracyCircle.setLatLng(position);
        accuracyCircle.setRadius(accuracy);
        dot.bringToFront();
      }
    } else if (accuracyCircle) {
      map.removeLayer(accuracyCircle);
      accuracyCircle = null;
    }

    message(validAccuracy
      ? 'Accuracy: ±' + Math.round(accuracy * 3.28084) + ' ft'
      : 'GPS active · accuracy unavailable');
    if (centerOnNextFix) centerOn(position);
  }

  function onError(error) {
    if (!trackingRequested) return;
    if (error && error.code === 1) {
      stopTracking();
      message('Location permission denied');
    } else if (error && error.code === 3) {
      message('Waiting for GPS signal…');
    } else {
      message('Location temporarily unavailable');
    }
  }

  function clearWatch() {
    if (watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function startWatch() {
    if (!trackingRequested || watchId !== null || document.hidden) return;
    message('Finding your location…');
    try {
      watchId = navigator.geolocation.watchPosition(onPosition, onError, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 20000
      });
    } catch (_) {
      stopTracking();
      message('Unable to start location services');
    }
  }

  function stopTracking() {
    trackingRequested = false;
    centerOnNextFix = false;
    lastPosition = null;
    clearWatch();
    removeGraphics();
    if (locateButton) locateButton.textContent = '◎ Locate me';
    if (stopButton) stopButton.hidden = true;
    message('Location off');
  }

  function locate() {
    if (!window.isSecureContext || !navigator.geolocation) {
      message('Location requires HTTPS or localhost');
      return;
    }
    if (!trackingRequested) {
      trackingRequested = true;
      centerOnNextFix = true;
      stopButton.hidden = false;
      startWatch();
    } else if (!centerOn(lastPosition)) {
      centerOnNextFix = true;
    }
  }

  var GPSControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function () {
      var root = L.DomUtil.create('div', 'leaflet-control-greyson-gps');
      locateButton = L.DomUtil.create('button', 'greyson-gps-locate', root);
      locateButton.type = 'button';
      locateButton.textContent = '◎ Locate me';
      locateButton.setAttribute('aria-label', 'Locate and recenter on my position');

      stopButton = L.DomUtil.create('button', 'greyson-gps-stop', root);
      stopButton.type = 'button';
      stopButton.textContent = 'Stop';
      stopButton.setAttribute('aria-label', 'Stop location tracking');
      stopButton.hidden = true;

      statusText = L.DomUtil.create('small', 'greyson-gps-status', root);
      statusText.setAttribute('role', 'status');
      statusText.textContent = 'Location off';

      locateButton.addEventListener('click', locate);
      stopButton.addEventListener('click', stopTracking);
      L.DomEvent.disableClickPropagation(root);
      L.DomEvent.disableScrollPropagation(root);
      return root;
    }
  });
  map.addControl(new GPSControl());

  // Avoid continuously running high-accuracy GPS while app is backgrounded.
  document.addEventListener('visibilitychange', function () {
    if (!trackingRequested) return;
    if (document.hidden) {
      clearWatch();
      removeGraphics();
    } else {
      lastPosition = null;
      startWatch();
    }
  });
  window.addEventListener('pagehide', clearWatch);
  window.addEventListener('pageshow', function () {
    if (trackingRequested) startWatch();
  });
})();
