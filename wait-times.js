/* Greyson's Disney Trip — optional live attraction wait bubbles.
   Review draft. No API key or backend; no changes to saved place coordinates.
   Data: ThemeParks.wiki API (https://www.themeparks.wiki/api).
*/
(function () {
  'use strict';
  if (!window.L || typeof map === 'undefined') return;

  var API = 'https://api.themeparks.wiki/v1/entity/';
  var PARK_IDS = {
    disneyland: '7340550b-c14d-4def-80bb-acdb51d49a66',
    california: '832fcd51-ea19-4e77-85c7-75d5843b127c'
  };
  var REFRESH_MS = 1 * 60 * 1000;
  var MIN_ZOOM = 17;
  var markers = L.layerGroup();
  var heading, note, places = [], latest = {}, lastCheck = 0;
  var pending = false, errors = 0;

  function normalize(s) {
    return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function clockTime(iso) {
    if (!iso || !Number.isFinite(Date.parse(iso))) return '';
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function queueInfo(entry) {
    var value = entry && entry.queue && entry.queue.STANDBY && entry.queue.STANDBY.waitTime;
    var minutes = typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 600
      ? Math.round(value) : null;
    var state = (entry && entry.status) || 'UNKNOWN';
    return { minutes: minutes, status: state };
  }

  function badgeInfo(entry) {
    var info = queueInfo(entry);
    if (info.status === 'DOWN') return { label: 'Down', style: 'down' };
    if (info.status === 'CLOSED') return { label: 'Closed', style: 'closed' };
    if (info.status === 'REFURBISHMENT') return { label: 'Refurb', style: 'closed' };
    if (info.status === 'OPERATING' && info.minutes !== null) {
      return { label: info.minutes + 'm', style: info.minutes <= 20 ? 'short' : info.minutes <= 45 ? 'medium' : 'long' };
    }
    return { label: '—', style: 'unknown' };
  }

  function popupFor(place, entry) {
    var info = queueInfo(entry);
    var root = document.createElement('div');
    root.className = 'greyson-wait-popup';
    var name = document.createElement('strong');
    name.textContent = place.name;
    root.appendChild(name);
    var status = document.createElement('div');
    status.className = 'greyson-wait-popup-main';
    if (info.status === 'DOWN') status.textContent = 'Temporarily down';
    else if (info.status === 'CLOSED') status.textContent = 'Closed';
    else if (info.status === 'REFURBISHMENT') status.textContent = 'Under refurbishment';
    else if (info.status === 'OPERATING' && info.minutes !== null)
      status.textContent = 'Standby: ' + info.minutes + ' min';
    else if (info.status === 'OPERATING') status.textContent = 'Operating · no standby time posted';
    else status.textContent = 'Wait time unavailable';
    root.appendChild(status);
    var single = entry.queue && entry.queue.SINGLE_RIDER && entry.queue.SINGLE_RIDER.waitTime;
    if (typeof single === 'number' && Number.isFinite(single) && single >= 0 && single <= 600) {
      var other = document.createElement('small');
      other.textContent = 'Single rider: ' + Math.round(single) + ' min';
      root.appendChild(other);
    }
    var reported = clockTime(entry.lastUpdated);
    if (reported) {
      var small = document.createElement('small');
      small.textContent = 'Last reported: ' + reported;
      root.appendChild(small);
    }
    return root;
  }

  function updateVisibility() {
    var shouldShow = navigator.onLine && map.getZoom() >= MIN_ZOOM;

    if (shouldShow && !map.hasLayer(markers)) {
      markers.addTo(map);
    }

    if (!shouldShow && map.hasLayer(markers)) {
      map.removeLayer(markers);
    }

    if (!heading) return;

    if (!navigator.onLine) {
      heading.textContent = 'Wait Times unavailable offline';
    } else if (map.getZoom() < MIN_ZOOM) {
      heading.textContent = 'Zoom to see Wait Times';
    } else if (pending && !lastCheck) {
      heading.textContent = 'Loading Wait Times…';
    } else if (errors === 2) {
      heading.textContent = 'Wait Times unavailable';
    } else {
      heading.textContent = 'Wait Times';
    }
  }

  function paint() {
    markers.clearLayers();
    var matched = 0, missing = [];
    places.forEach(function (place) {
      var rows = latest[place.park] || [];
      var accepted = [place.name].concat(place.aliases || []).map(normalize);
      var entry = rows.find(function (row) { return accepted.includes(normalize(row.name)); });
      if (!entry) { missing.push(place.name); return; }
      matched += 1;
      var badge = badgeInfo(entry);
      var icon = L.divIcon({
        className: 'greyson-wait-icon',
        html: '<span class="greyson-wait-bubble greyson-wait-' + badge.style + '">' + badge.label + '</span>',
        iconSize: [46, 28], iconAnchor: [23, 14], popupAnchor: [0, -15]
      });
      L.marker([place.lat, place.lon], {
        icon: icon, keyboard: true, title: place.name + ' wait information',
        riseOnHover: true
      }).bindPopup(popupFor(place, entry), { maxWidth: 235, minWidth: 170, autoPan: true })
        .addTo(markers);
    });
    if (note) {
      note.textContent = lastCheck
	    ? 'Last checked: ' + clockTime(new Date(lastCheck).toISOString())
		: 'Waiting for first update…';
		
	  if (errors) {
		note.textContent += errors === 2
		  ? ' · unavailable'
		  : ' · partial feed';
	  }
    }
    // Browser console diagnostics: API entities do not always use Disney's published names.
    window.greysonWaitDebug = { matched: matched, unmatched: missing, feedErrors: errors };
    updateVisibility();
  }

  async function getJson(url) {
    var response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }

  async function refresh() {
    if (pending || !navigator.onLine) return;
    pending = true;
    updateVisibility();
    var checks = await Promise.allSettled(Object.keys(PARK_IDS).map(async function (park) {
      var result = await getJson(API + PARK_IDS[park] + '/live');
      if (!Array.isArray(result.liveData)) throw new Error('Invalid live data for ' + park);
      return { park: park, rows: result.liveData };
    }));
    errors = 0;
    latest = {};
    checks.forEach(function (result, i) {
      if (result.status === 'fulfilled') latest[result.value.park] = result.value.rows;
      else {
        errors += 1;
        console.warn('Greyson Wait Times: ' + Object.keys(PARK_IDS)[i], result.reason);
      }
    });
    lastCheck = Date.now();
    pending = false;
    paint();
  }


  function makeControl() {
    var WaitControl = L.Control.extend({
      options: { position: 'topleft' },

      onAdd: function () {
        var root = L.DomUtil.create(
          'div',
          'leaflet-control-greyson-wait'
        );

        // Static informational heading
        heading = L.DomUtil.create(
          'div',
          'greyson-wait-title',
          root
        );
        heading.textContent = 'Loading Wait Times…';

        // Last checked timestamp
        note = L.DomUtil.create(
          'small',
          'greyson-wait-note',
          root
        );
        note.textContent = 'Waiting for first update…';

        // Required API attribution
        var credit = L.DomUtil.create(
          'a',
          'greyson-wait-credit',
          root
        );
        credit.href = 'https://www.themeparks.wiki/api';
        credit.target = '_blank';
        credit.rel = 'noopener noreferrer';
        credit.textContent = 'Powered by ThemeParks.wiki';

        L.DomEvent.disableClickPropagation(root);
        L.DomEvent.disableScrollPropagation(root);

        return root;
      }
    });

    map.addControl(new WaitControl());
    updateVisibility();
  }

  makeControl();
  map.on('zoomend', updateVisibility);
  window.addEventListener('offline', function () {
    latest = {};
    markers.clearLayers();
    updateVisibility();
  });
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - lastCheck >= REFRESH_MS) refresh();
  });
  setInterval(function () {
    if (!document.hidden && Date.now() - lastCheck >= REFRESH_MS) refresh();
  }, REFRESH_MS);

  getJson(new URL('places.json', document.baseURI).href)
    .then(function (data) {
      if (!Array.isArray(data.places)) throw new Error('Invalid places.json');
      places = data.places.filter(function (place) {
        return place.type === 'Attraction' && PARK_IDS[place.park] &&
          Number.isFinite(place.lat) && Number.isFinite(place.lon);
      });
      return refresh();
    })
    .catch(function (error) {
      errors = 2;
      pending = false;
      if (note) note.textContent = 'Attraction directory unavailable';
      updateVisibility();
      console.warn('Greyson Wait Times:', error);
    });
})();
