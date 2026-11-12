/* Greyson's Disney Trip — LOCAL ONLY map-based stop-to-stop route editor.
   Requires existing project files: vendor/leaflet.js, tiles/, places.json,
   route-2026.json and itinerary-2026.json. No production app is modified.
*/
(function () {
  'use strict';
  if (!window.L) return;

  var STORAGE_KEY = 'greyson-walking-route-editor-v1';
  var DAY_LABELS = {
    '2026-11-16': 'Mon. November 16',
    '2026-11-17': 'Tues. November 17',
    '2026-11-19': 'Thurs. November 19'
  };
  var DATES = Object.keys(DAY_LABELS);
  var stopsByDay = Object.create(null);
  var legsByDay = Object.create(null);
  var chosenDay = '2026-11-16';
  var chosenLeg = 0;
  var mode = 'draw';
  var history = [];
  var future = [];
  var ready = false;

  function el(id) { return document.getElementById(id); }
  function setStatus(message, warning) {
    el('status').textContent = message;
    el('status').classList.toggle('warn', !!warning);
  }
  function readableName(s) {
    return String(s || '').replace(/^(California Adventure|Disneyland Park) /, '').replace(/\s+/g, ' ');
  }
  function pos(p) { return [p.lat, p.lon]; }
  function deepCopy(value) { return JSON.parse(JSON.stringify(value)); }
  function getLegs() { return legsByDay[chosenDay]; }
  function getStops() { return stopsByDay[chosenDay] || []; }
  function getLeg() { return getLegs()[chosenLeg]; }
  function ptsForLeg(day, index) {
    var stops = stopsByDay[day];
    var state = legsByDay[day][index];
    return [pos(stops[index])].concat(state.via.map(function (p) { return p.slice(); }), [pos(stops[index + 1])]);
  }
  function isValidPoint(p) {
    return Array.isArray(p) && p.length === 2 &&
      p.every(function (n) { return Number.isFinite(n); }) &&
      p[0] > 33.79 && p[0] < 33.83 && p[1] > -117.94 && p[1] < -117.90;
  }
  function makeBlankLegs() {
    var out = Object.create(null);
    DATES.forEach(function (date) {
      out[date] = (stopsByDay[date] || []).slice(1).map(function () {
        return { via: [], done: false };
      });
    });
    return out;
  }
  function restoreDraft() {
    legsByDay = makeBlankLegs();
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || !saved.legs) return;
      DATES.forEach(function (date) {
        var arr = saved.legs[date];
        if (!Array.isArray(arr) || arr.length !== legsByDay[date].length) return;
        arr.forEach(function (leg, i) {
          if (!leg || !Array.isArray(leg.via) || !leg.via.every(isValidPoint)) return;
          legsByDay[date][i] = { via: leg.via, done: !!leg.done };
        });
      });
      if (DATES.includes(saved.selectedDay)) chosenDay = saved.selectedDay;
      if (Number.isInteger(saved.selectedLeg)) {
        chosenLeg = Math.max(0, Math.min(saved.selectedLeg, legsByDay[chosenDay].length - 1));
      }
    } catch (e) {
      setStatus('Local saved draft could not be read. The original stop locations are still available.', true);
    }
  }
  function saveDraft() {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1, selectedDay: chosenDay, selectedLeg: chosenLeg,
        legs: legsByDay
      }));
    } catch (e) { setStatus('Browser storage unavailable. Download JSON regularly to avoid losing changes.', true); }
  }
  function checkpoint() {
    history.push(JSON.stringify(legsByDay));
    if (history.length > 80) history.shift();
    future.length = 0;
  }
  function modifyLeg(fn) {
    checkpoint();
    fn(getLeg());
    saveDraft();
    redraw();
  }

  // Match the same XYZ tile coordinates and artwork bounds as index.html.
  var z = 16;
  function xyzToLatLng(x, y, zoom) {
    var n = Math.pow(2, zoom);
    return [Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI,
      x / n * 360 - 180];
  }
  var tileBounds = L.latLngBounds(
    xyzToLatLng(11299, 26219, z), xyzToLatLng(11303, 26223, z));
  var artworkBounds = L.latLngBounds([33.80197, -117.93097], [33.81987, -117.91281]);
  var map = L.map('route-map', {
    minZoom: 15, maxZoom: 20, zoomSnap: 0.05, zoomDelta: 0.5,
    doubleClickZoom: false, attributionControl: false, zoomControl: true,
    maxBoundsViscosity: .7
  });
  L.tileLayer('tiles/{z}/{x}/{y}.jpg', {
    tileSize: 256, minZoom: 15, minNativeZoom: 16,
    maxZoom: 20, maxNativeZoom: 20, noWrap: true, bounds: tileBounds,
    keepBuffer: 3
  }).addTo(map);
  map.setMaxBounds(artworkBounds.pad(.10));
  map.setView([33.8107, -117.9200], 16.6, { animate: false });

  var completedLayer = L.layerGroup().addTo(map);
  var selectedLayer = L.layerGroup().addTo(map);
  var vertexLayer = L.layerGroup().addTo(map);
  var stopLayer = L.layerGroup().addTo(map);

  function drawSolid(points, group, selected) {
    if (!points || points.length < 2) return;
    L.polyline(points, { color: '#fff', weight: selected ? 9 : 7.5,
      opacity: .98, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(group);
    L.polyline(points, { color: selected ? '#0577c0' : '#227fae',
      weight: selected ? 5.2 : 4.1, opacity: .98,
      lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(group);
  }
  function stopColor(i, total) {
    var n = Math.ceil((i + 1) * 3 / total);
    return n === 1 ? 'is-early' : n === 2 ? 'is-middle' : 'is-late';
  }
  function updateMap() {
    completedLayer.clearLayers();
    selectedLayer.clearLayers();
    vertexLayer.clearLayers();
    stopLayer.clearLayers();
    var stops = getStops();
    var legs = getLegs();
    if (!stops || !legs) return;

    if (el('show-all').checked) legs.forEach(function (leg, index) {
      if (index !== chosenLeg && leg.done) drawSolid(ptsForLeg(chosenDay, index), completedLayer, false);
    });

    var active = getLeg();
    var full = ptsForLeg(chosenDay, chosenLeg);
    if (active.done) {
      drawSolid(full, selectedLayer, true);
    } else {
      if (full.length > 2) drawSolid(full.slice(0, -1), selectedLayer, true);
      L.polyline([full[full.length - 2], full[full.length - 1]], {
        color: '#b16c16', weight: 2.4, opacity: .9, dashArray: '6 9',
        interactive: false
      }).addTo(selectedLayer);
    }

    // Every stop location is visible; endpoints of every leg are fixed.
    stops.forEach(function (stop, i) {
      var selected = i === chosenLeg || i === chosenLeg + 1;
      var cls = 'editor-stop-marker' + (selected ? ' is-selected' : '');
      var icon = L.divIcon({className:cls, iconSize:[27,27], iconAnchor:[13.5,13.5],
        html: '<span class="' + stopColor(i, stops.length) + '">' + (i + 1) + '</span>'});
      var marker = L.marker(pos(stop), {icon: icon, bubblingMouseEvents:false,
        title: 'Stop '+(i+1)+': '+stop.name, keyboard:true, riseOnHover:true});
      marker.on('click', function () {
        chosenLeg = Math.min(i, legs.length - 1);
        saveDraft(); redraw();
      });
      marker.bindTooltip('Stop ' + (i + 1) + ': ' + stop.name,
        {direction:'top', className:'editor-stop-tooltip'});
      marker.addTo(stopLayer);
    });

    active.via.forEach(function (point, index) {
      var icon = L.divIcon({className:'editor-vertex-marker', iconSize:[17,17],
        iconAnchor:[8.5,8.5], html:'<span></span>'});
      var marker = L.marker(point, {icon:icon, draggable:true,
        bubblingMouseEvents:false, title:'Drag bend ' + (index + 1) + '; right-click to remove'});
      marker.bindTooltip('Drag to move · right-click to delete', {direction:'top'});
      marker.on('dragend', function () {
        var p = marker.getLatLng();
        modifyLeg(function (leg) {
          leg.via[index] = [Number(p.lat.toFixed(7)), Number(p.lng.toFixed(7))];
          leg.done = false;
        });
      });
      marker.on('contextmenu', function (e) {
        if (e.originalEvent) L.DomEvent.stop(e.originalEvent);
        modifyLeg(function (leg) { leg.via.splice(index, 1); leg.done = false; });
        setStatus('Removed bend ' + (index + 1) + '.');
      });
      marker.addTo(vertexLayer);
    });
  }

  function closestSegmentIndex(coords, target) {
    var p = map.latLngToLayerPoint(target);
    var shortest = Infinity, chosen = 0;
    for (var i = 0; i < coords.length - 1; i++) {
      var a = map.latLngToLayerPoint(coords[i]);
      var b = map.latLngToLayerPoint(coords[i + 1]);
      var dx = b.x - a.x, dy = b.y - a.y;
      var length = dx * dx + dy * dy;
      var t = length ? Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/length)) : 0;
      var ex = a.x + t*dx - p.x, ey = a.y + t*dy - p.y;
      var dist = ex*ex + ey*ey;
      if (dist < shortest) { shortest = dist; chosen = i; }
    }
    return chosen;
  }
  map.on('click', function (event) {
    if (!ready) return;
    var point = [Number(event.latlng.lat.toFixed(7)), Number(event.latlng.lng.toFixed(7))];
    if (!isValidPoint(point)) return;
    var index = closestSegmentIndex(ptsForLeg(chosenDay, chosenLeg), event.latlng);
    modifyLeg(function (leg) {
      if (mode === 'draw') leg.via.push(point);
      else leg.via.splice(index, 0, point);
      leg.done = false;
    });
    setStatus('Bend added. Drag its white handle to adjust. ' +
      (mode === 'draw' ? 'Continue clicking in walking order.' : 'Click elsewhere to refine the route.'));
  });

  function refreshUI() {
    if (!ready) return;
    var stops = getStops();
    var legs = getLegs();
    var choices = el('leg-choice');
    var selectedValue = String(chosenLeg);
    var rebuild = choices.options.length !== legs.length || choices.dataset.day !== chosenDay;
    if (rebuild) {
      choices.replaceChildren();
      legs.forEach(function (leg, i) {
        var option = document.createElement('option');
        option.value = String(i);
        option.textContent = (i+1) + ' → ' + (i+2) + ' · ' +
          readableName(stops[i].name) + ' → ' + readableName(stops[i+1].name);
        choices.appendChild(option);
      });
      choices.dataset.day = chosenDay;
    }
    choices.value = selectedValue;
    el('day-choice').value = chosenDay;
    el('leg-title').textContent = 'From stop ' + (chosenLeg+1) + ' (' + stops[chosenLeg].name +
      ') to stop ' + (chosenLeg+2) + ' (' + stops[chosenLeg+1].name + ').';
    var completed = legs.filter(function (x) { return x.done; }).length;
    el('progress-text').textContent = completed + ' of ' + legs.length + ' legs finished · ' +
      getLeg().via.length + ' bends in current leg';
    el('progress-fill').style.width = (legs.length ? completed / legs.length * 100 : 0) + '%';
    el('mode-draw').classList.toggle('selected', mode === 'draw');
    el('mode-insert').classList.toggle('selected', mode === 'insert');
    el('mode-help').textContent = mode === 'draw'
      ? 'Click along the walkways IN TRAVEL ORDER to add bends. The two stop endpoints are fixed. The orange dashed line is the unfinished connection.'
      : 'Click anywhere near the selected route to INSERT a new bend into the closest section. Drag white handles to move bends; right-click a handle to remove it.';
    el('undo').disabled = history.length === 0;
    el('redo').disabled = future.length === 0;
    el('remove-last').disabled = getLeg().via.length === 0;
    el('clear-leg').disabled = getLeg().via.length === 0 && !getLeg().done;
    el('complete-leg').textContent = getLeg().done ? '✓ Leg finished' : '✓ Finish leg';
  }
  function redraw() { updateMap(); refreshUI(); }
  function fitLeg() {
    var pts = ptsForLeg(chosenDay, chosenLeg);
    var bounds = L.latLngBounds(pts);
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(.45), {maxZoom: 19.25, padding: [65,65], animate: true});
    }
  }
  function selectLeg(index, doFit) {
    chosenLeg = Math.max(0, Math.min(index, getLegs().length - 1));
    mode = 'draw';
    saveDraft(); redraw();
    if (doFit) fitLeg();
  }

  el('day-choice').addEventListener('change', function () {
    chosenDay = this.value;
    var next = getLegs().findIndex(function (leg) { return !leg.done; });
    selectLeg(next === -1 ? 0 : next, true);
    setStatus('Editing ' + DAY_LABELS[chosenDay] + '. Nothing changes in your trip itinerary.');
  });
  el('leg-choice').addEventListener('change', function () { selectLeg(Number(this.value), true); });
  el('mode-draw').addEventListener('click', function () { mode = 'draw'; refreshUI(); });
  el('mode-insert').addEventListener('click', function () { mode = 'insert'; refreshUI(); });
  el('fit-leg').addEventListener('click', fitLeg);
  el('undo').addEventListener('click', function () {
    if (!history.length) return;
    future.push(JSON.stringify(legsByDay));
    legsByDay = JSON.parse(history.pop());
    saveDraft(); redraw(); setStatus('Undid last route edit.');
  });
  el('redo').addEventListener('click', function () {
    if (!future.length) return;
    history.push(JSON.stringify(legsByDay));
    legsByDay = JSON.parse(future.pop());
    saveDraft(); redraw(); setStatus('Redid route edit.');
  });
  el('remove-last').addEventListener('click', function () {
    if (!getLeg().via.length) return;
    modifyLeg(function (leg) { leg.via.pop(); leg.done = false; });
    setStatus('Removed last bend.');
  });
  el('clear-leg').addEventListener('click', function () {
    if (!confirm('Clear the selected leg? Other legs will be preserved.')) return;
    modifyLeg(function (leg) { leg.via = []; leg.done = false; });
    setStatus('Selected leg cleared.');
  });
  el('complete-leg').addEventListener('click', function () {
    if (!getLeg().done) {
      modifyLeg(function (leg) { leg.done = true; });
      setStatus('Leg ' + (chosenLeg + 1) + ' finished and autosaved.');
      if (chosenLeg < getLegs().length - 1) selectLeg(chosenLeg + 1, true);
    } else {
      setStatus('This leg is already complete. Make any edit to reopen it.');
    }
  });
  el('show-all').addEventListener('change', redraw);
  el('collapse').addEventListener('click', function () {
    var panel = el('editor-panel');
    panel.classList.toggle('is-collapsed');
    this.textContent = panel.classList.contains('is-collapsed') ? '›' : '‹';
    this.title = panel.classList.contains('is-collapsed') ? 'Expand editor panel' : 'Collapse editor panel';
    window.setTimeout(function () { map.invalidateSize(); }, 30);
  });

  function exportRoute() {
    var output = {
      source: 'Greyson local stop-to-stop route editor',
      version: 'manually-traced-review',
      status: 'VISUAL OVERLAY ONLY — not navigation',
      timeSource: 'itinerary-2026.json (unchanged)',
      coordinates: 'WGS84 latitude, longitude',
      routes: {}
    };
    var totalCompleted = 0, totalPossible = 0;
    DATES.forEach(function (day) {
      var stops = stopsByDay[day];
      var segments = [];
      totalPossible += legsByDay[day].length;
      legsByDay[day].forEach(function (leg, i) {
        if (!leg.done) return;
        totalCompleted++;
        segments.push({
          name: 'Stop ' + (i + 1) + ' → ' + (i + 2) + ': ' +
            stops[i].name + ' → ' + stops[i + 1].name,
          kind: stops[i].park !== stops[i + 1].park ? 'park-hop' : 'walk',
          legFrom: i + 1, legTo: i + 2,
          points: ptsForLeg(day, i)
        });
      });
      if (segments.length) output.routes[day] = {
        status: segments.length === legsByDay[day].length ? 'review-complete' : 'incomplete-review',
        segments: segments
      };
    });
    if (totalCompleted === 0) {
      setStatus('Finish at least one route leg before exporting.', true);
      return;
    }
    if (totalCompleted < totalPossible) {
      setStatus('Export includes ' + totalCompleted + ' finished legs. Any unfinished legs will be omitted.', true);
    } else setStatus('Exported all finished route legs.');
    var blob = new Blob([JSON.stringify(output, null, 2) + '\n'], {type:'application/json'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'walking-routes-2026.json';
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }
  el('export-route').addEventListener('click', exportRoute);
  el('import-route').addEventListener('click', function () { el('import-file').click(); });
  el('import-file').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var input = this;
    file.text().then(function (source) {
      var data = JSON.parse(source);
      if (!data.routes || !DATES.some(function (date) {
        return data.routes[date] && Array.isArray(data.routes[date].segments) &&
          data.routes[date].segments.some(function (seg) {
            return Number.isInteger(seg.legFrom) && Number.isInteger(seg.legTo);
          });
      })) throw new Error('This file is not a stop-to-stop editor export. The old rough 99-point route cannot be imported automatically; redraw it using this editor.');
      if (!confirm('Import this route? This will replace your current browser editor draft. Export it first if you want a backup.')) return;
      var next = makeBlankLegs();
      DATES.forEach(function (date) {
        if (!data.routes[date]) return;
        var segments = data.routes[date].segments || [];
        segments.forEach(function (seg) {
          var i = seg.legFrom - 1;
          if (!Number.isInteger(i) || seg.legTo !== i + 2 || !next[date][i] ||
              !Array.isArray(seg.points) || seg.points.length < 2 ||
              !seg.points.every(isValidPoint)) return;
          next[date][i] = {via: seg.points.slice(1, -1), done:true};
        });
      });
      checkpoint();
      legsByDay = next;
      chosenLeg = 0;
      saveDraft(); redraw();fitLeg();
      setStatus('Imported compatible stop-to-stop route.');
    }).catch(function (error) {
      setStatus('Import failed: ' + error.message, true);
    }).finally(function () { input.value = ''; });
  });
  el('reset-all').addEventListener('click', function () {
    if (!confirm('Delete ALL your saved editor bends for Nov 16, 17 and 19? This cannot be undone after reopening.')) return;
    checkpoint(); legsByDay = makeBlankLegs(); chosenDay = '2026-11-16'; chosenLeg = 0;
    saveDraft(); redraw(); fitLeg(); setStatus('Editor work reset. Your project files were not touched.');
  });

  function fetchJson(path) {
    return fetch(new URL(path, document.baseURI)).then(function (response) {
      if (!response.ok) throw new Error(path + ': HTTP ' + response.status);
      return response.json();
    });
  }
  Promise.all([fetchJson('places.json'), fetchJson('route-2026.json'), fetchJson('itinerary-2026.json')])
    .then(function (data) {
      var places = Object.create(null);
      (data[0].places || []).forEach(function (p) { places[p.id] = p; });
      var orders = data[1].routes || {};
      var timelineDays = Object.create(null);
      (data[2].days || []).forEach(function (d) { timelineDays[d.date] = d; });
      DATES.forEach(function (date) {
        var day = timelineDays[date];
        stopsByDay[date] = (orders[date] || []).map(function (item, i) {
          var p = places[item.placeId];
          if (!p || !day || !day.timeline[item.timelineIndex]) return null;
          return {id:item.placeId,name:p.name,park:p.park,lat:p.lat,lon:p.lon,
            time:day.timeline[item.timelineIndex].time,index:i+1};
        }).filter(Boolean);
        if (stopsByDay[date].length < 2) {
          throw new Error('Cannot load at least two mapped stops for ' + date);
        }
      });
      restoreDraft(); ready = true;
      redraw(); fitLeg();
      setStatus('Ready. Select leg 1 → 2, zoom in, and click the walkways in order.');
    }).catch(function (error) {
      setStatus('Editor could not load: ' + error.message + '. Start with py -m http.server 8000 inside your project folder.', true);
      console.warn('Greyson route editor:', error);
      document.querySelectorAll('.editor-controls button,.editor-controls select')
        .forEach(function (button) { button.disabled = true; });
    });
})();
