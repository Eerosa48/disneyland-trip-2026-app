/* Greyson's Disney Trip — DOCX v5 itinerary + ordered stop overlay.
 * Timeline timing is always read from itinerary-2026.json, never recalculated.
 * The dashed segments are schematic stop connectors, NOT walkable paths.
 */
(function () {
  'use strict';
  if (!window.L || typeof map === 'undefined') return;

  var itinerary = null;
  var placesById = Object.create(null);
  var dayIndex = 1; // Mon Nov 16 when viewed outside trip week.
  var currentTab = 'schedule';
  var highlight = null;
  var routeData = null;
  var routeOn = false;
  var routeLayer = L.layerGroup();
  var routeChip = null;


  function make(tag, cls, parent, content) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (content !== undefined && content !== null) el.textContent = content;
    if (parent) parent.appendChild(el);
    return el;
  }

  function todayInAnaheim() {
    try {
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles', year: 'numeric',
        month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      var data = Object.create(null);
      parts.forEach(function (p) { data[p.type] = p.value; });
      return data.year + '-' + data.month + '-' + data.day;
    } catch (_) { return ''; }
  }

  var root = make('div', 'greyson-itinerary-app', document.body);
  root.id = 'greyson-itinerary';
  var launch = make('button', 'greyson-itinerary-launch', root, '▦ Itinerary');
  launch.type = 'button';
  launch.setAttribute('aria-controls', 'greyson-itinerary-panel');
  launch.setAttribute('aria-expanded', 'false');
  routeChip = make('button', 'greyson-itinerary-routechip', root);
  routeChip.type = 'button';
  routeChip.hidden = true;
  routeChip.setAttribute('aria-label', 'Hide visible itinerary stops');
  routeChip.addEventListener('click', function () { toggleRoute(false); });
  var panel = make('section', 'greyson-itinerary-panel', root);
  panel.id = 'greyson-itinerary-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Greyson’s Disney trip itinerary');
  panel.hidden = true;

  var header = make('div', 'greyson-itinerary-head', panel);
  var titleGroup = make('div', 'greyson-itinerary-titlegroup', header);
  make('strong', '', titleGroup, 'Trip itinerary');
  make('small', '', titleGroup, 'November 15–20, 2026 · Anaheim time');
  var dismiss = make('button', 'greyson-itinerary-close', header, '×');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Close itinerary');

  var daysNav = make('nav', 'greyson-itinerary-days', panel);
  daysNav.setAttribute('aria-label', 'Select itinerary day');
  var daySummary = make('div', 'greyson-itinerary-summary', panel);
  var tabsNav = make('div', 'greyson-itinerary-tabs', panel);
  tabsNav.setAttribute('role', 'group');
  tabsNav.setAttribute('aria-label', 'Itinerary information');
  var content = make('div', 'greyson-itinerary-content', panel);
  var foot = make('div', 'greyson-itinerary-foot', panel,
    'Source: Itinerary v5 · Exact planned times, not confirmed queue or return windows.');

  function setOpen(open) {
    if (open && !itinerary) return;
    panel.hidden = !open;
    launch.setAttribute('aria-expanded', String(open));
    if (open) {
      render();
      dismiss.focus({ preventScroll: true });
    } else {
      launch.focus({ preventScroll: true });
    }
  }

  function mapFocus(placeId) {
    var p = placesById[placeId];
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return;
    if (highlight) map.removeLayer(highlight);
    highlight = L.circleMarker([p.lat, p.lon], {
      radius: 9, weight: 3, color: '#fff', fillColor: '#0c7780',
      fillOpacity: 1, interactive: false
    }).addTo(map);
    highlight.bindTooltip(p.name, {
      direction: 'top', permanent: false, className: 'place-search-label'
    }).openTooltip();
    map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 18.4), { duration: 0.65 });
    setOpen(false);
  }

  function routeStopsForDay(day) {
    if (!day || !routeData || !routeData.routes) return [];
    var rows = routeData.routes[day.date] || [];
    return rows.map(function (item, i) {
      var p = placesById[item.placeId];
      var timeline = day.timeline[item.timelineIndex];
      if (!p || !timeline) return null;
      return { index: i + 1, place: p, timeline: timeline, timelineIndex: item.timelineIndex };
    }).filter(Boolean);
  }

  function clearRoute() {
    routeLayer.clearLayers();
    if (map.hasLayer(routeLayer)) map.removeLayer(routeLayer);
  }

  function updateRouteButtons() {
    if (!routeChip || !itinerary) return;
    var day = itinerary.days[dayIndex];
    var available = routeStopsForDay(day).length > 0;
    routeChip.hidden = !(routeOn && available);
    if (!routeChip.hidden) routeChip.textContent = 'Route: ' + day.day + '  ×';
  }

  function routePopup(stop) {
    var body = make('div', 'greyson-itinerary-pin-popup');
    make('strong', '', body, 'Stop ' + stop.index + ' · ' + stop.place.name);
    make('div', 'greyson-itinerary-pin-time', body, stop.timeline.time);
    make('div', '', body, stop.timeline.activity);
    if (stop.timeline.notes) make('small', '', body, stop.timeline.notes);
    make('small', '', body, 'Map marker is approximate, not an entrance or walking path.');
    return body;
  }

  function renderRoute() {
    clearRoute();
    updateRouteButtons();
    if (!routeOn || !itinerary) return;
    var day = itinerary.days[dayIndex];
    var stops = routeStopsForDay(day);
    if (!stops.length) { routeOn = false; updateRouteButtons(); return; }

    // Do not draw a connector across park boundaries. Lines within a park
    // indicate stop ORDER only; they do NOT follow real pedestrian paths.
    var run = [];
    function flushRun() {
      if (run.length > 1) {
        L.polyline(run, {
          color: '#167b79', weight: 3, opacity: 0.58,
          dashArray: '2 9', lineCap: 'round', interactive: false
        }).addTo(routeLayer);
      }
      run = [];
    }
    var previousPark = null;
    stops.forEach(function (stop) {
      var p = stop.place;
      if (p.park !== previousPark) flushRun();
      run.push([p.lat, p.lon]);
      previousPark = p.park;
    });
    flushRun();

    stops.forEach(function (stop) {
      var p = stop.place;
      var colorClass = p.park === 'california' ? 'is-dca' :
        p.park === 'downtown' ? 'is-downtown' : 'is-disneyland';
      var icon = L.divIcon({
        className: 'greyson-itinerary-pin-wrap',
        html: '<span class="greyson-itinerary-pin ' + colorClass + '">' + stop.index + '</span>',
        iconSize: [29, 32], iconAnchor: [14, 32], popupAnchor: [0, -29]
      });
      L.marker([p.lat, p.lon], {
        icon: icon, title: 'Stop ' + stop.index + ': ' + p.name,
        keyboard: true, riseOnHover: true
      }).bindPopup(routePopup(stop), { maxWidth: 260, autoPan: true })
        .addTo(routeLayer);
    });
    routeLayer.addTo(map);
    updateRouteButtons();
  }

  function focusRouteBounds() {
    if (!itinerary) return;
    var stops = routeStopsForDay(itinerary.days[dayIndex]);
    if (!stops.length) return;
    var bounds = L.latLngBounds(stops.map(function (s) { return [s.place.lat, s.place.lon]; }));
    map.fitBounds(bounds.pad(0.07), { padding: [35, 45], maxZoom: 17.3, animate: true });
  }

  function toggleRoute(enabled) {
    routeOn = enabled;
    renderRoute();
    if (enabled) focusRouteBounds();
  }

  function renderRouteList(day) {
    var stops = routeStopsForDay(day);
    if (!stops.length) {
      make('p', 'greyson-itinerary-empty', content,
        'No resort-map route for this day. Follow the full schedule for any hotel or travel activities.');
      return;
    }
    make('p', 'greyson-itinerary-explainer', content,
      'Stops follow the DOCX order and times. Dotted lines are schematic connectors, NOT walking paths. Park hops are intentionally unconnected. Optional alternatives remain in Schedule.');
    var controls = make('div', 'greyson-itinerary-route-actions', content);
    var toggle = make('button', 'greyson-itinerary-route-btn', controls,
      routeOn ? 'Hide route from map' : 'Show stops on map');
    toggle.type = 'button';
    toggle.addEventListener('click', function () {
      toggleRoute(!routeOn);
      if (routeOn) setOpen(false);
      else render();
    });
    if (routeOn) {
      var fit = make('button', 'greyson-itinerary-route-btn is-secondary', controls, 'View full route');
      fit.type = 'button';
      fit.addEventListener('click', function () { focusRouteBounds(); setOpen(false); });
    }
    stops.forEach(function (stop) {
      var row = make('button', 'greyson-itinerary-route-row', content);
      row.type = 'button';
      var num = make('span', 'greyson-itinerary-route-num', row, String(stop.index));
      var text = make('span', 'greyson-itinerary-route-text', row);
      make('strong', '', text, stop.place.name);
      make('small', '', text, stop.timeline.time + ' · ' + stop.timeline.activity);
      row.title = 'Locate stop ' + stop.index + ' on the map';
      row.addEventListener('click', function () {
        if (!routeOn) { routeOn = true; renderRoute(); }
        mapFocus(stop.place.id);
      });
    });
  }

  function renderMapLinks(parent, entry) {
    if (!entry.mapIds || !entry.mapIds.length) return;
    var targets = entry.mapIds.filter(function (id) { return !!placesById[id]; });
    if (!targets.length) return;
    var wrap = make('div', 'greyson-itinerary-maplinks', parent);
    targets.forEach(function (id) {
      var p = placesById[id];
      var btn = make('button', 'greyson-itinerary-maplink', wrap, '⌖ ' + p.name);
      btn.type = 'button';
      btn.title = 'Show approximate landmark on map: ' + p.name;
      btn.addEventListener('click', function () { mapFocus(id); });
    });
  }

  function renderRow(entry, parent) {
    var card = make('article', 'greyson-itinerary-entry', parent);
    make('span', 'greyson-itinerary-time', card, entry.time);
    var main = make('div', 'greyson-itinerary-entry-main', card);
    make('strong', 'greyson-itinerary-activity', main, entry.activity);
    if (entry.notes) make('p', 'greyson-itinerary-note', main, entry.notes);
    renderMapLinks(main, entry);
  }

  function renderSimpleTable(items, parent, fieldNames, heading) {
    if (!items || !items.length) return;
    make('h3', 'greyson-itinerary-subhead', parent, heading);
    items.forEach(function (item) {
      var card = make('div', 'greyson-itinerary-detail-item', parent);
      fieldNames.forEach(function (field, index) {
        if (item[field]) make(index === 0 ? 'strong' : 'div', index === 0 ? '' : 'greyson-itinerary-muted', card, item[field]);
      });
    });
  }

  function renderDetails(day) {
    if (day.mealReservations && day.mealReservations.length) {
      renderSimpleTable(day.mealReservations, content, ['when', 'reservation', 'notes'], 'Dining reservations');
    }
    if (day.coffeeStops && day.coffeeStops.length) {
      renderSimpleTable(day.coffeeStops, content, ['venue', 'drink'], 'Danielle’s coffee stops');
    }
    if (day.walking) {
      make('h3', 'greyson-itinerary-subhead', content, 'Walking allowances');
      make('p', 'greyson-itinerary-detail-copy', content, day.walking);
    }
    if (day.skipFirst) {
      make('h3', 'greyson-itinerary-subhead', content, 'What to skip first');
      make('p', 'greyson-itinerary-detail-copy', content, day.skipFirst);
    }
    if (day.extraNotes && day.extraNotes.length) {
      make('h3', 'greyson-itinerary-subhead', content, 'Planning notes');
      day.extraNotes.forEach(function (note) {
        make('p', 'greyson-itinerary-detail-copy', content, note);
      });
    }
    if (day.diningTips && day.diningTips.length) {
      make('h3', 'greyson-itinerary-subhead', content, 'Family dining tips');
      day.diningTips.forEach(function (tip) {
        make('p', 'greyson-itinerary-detail-copy', content, tip);
      });
    }
    if (day.riderSwitch && day.riderSwitch.length) {
      renderSimpleTable(day.riderSwitch, content, ['ride', 'requirement', 'whileAdultsRide'], 'Adult Rider Switch');
    }
    if (day.ridePlanning && day.ridePlanning.length) {
      renderSimpleTable(day.ridePlanning, content, ['item', 'detail', 'plan'], 'Ride / wait-time planning');
    }
    if (!content.children.length) {
      make('p', 'greyson-itinerary-empty', content, 'No additional planning notes for this travel day.');
    }
  }

  function render() {
    if (!itinerary) return;
    var day = itinerary.days[dayIndex];
    daysNav.replaceChildren();
    itinerary.days.forEach(function (d, index) {
      var b = make('button', 'greyson-itinerary-day', daysNav, d.day);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(index === dayIndex));
      if (index === dayIndex) b.classList.add('is-selected');
      b.addEventListener('click', function () {
        dayIndex = index;
        currentTab = 'schedule';
        if (routeOn) renderRoute();
        render();
      });
    });

    daySummary.replaceChildren();
    make('h2', '', daySummary, day.title);
    make('p', 'greyson-itinerary-muted', daySummary, day.subtitle);
    if (day.priority) make('p', 'greyson-itinerary-priority', daySummary, day.priority);
    if (routeStopsForDay(day).length) {
      var routeAction = make('button', 'greyson-itinerary-route-btn', daySummary,
        routeOn ? '✓ Stop route shown on map · Hide' : '⌖ Show this day’s stops on map');
      routeAction.type = 'button';
      routeAction.setAttribute('aria-pressed', String(routeOn));
      routeAction.addEventListener('click', function () {
        toggleRoute(!routeOn);
        if (routeOn) setOpen(false);
        else render();
      });
    }

    tabsNav.replaceChildren();
    [
      ['schedule', 'Schedule'],
      ['route', 'Stops'],
      ['lightning', 'Lightning Lane'],
      ['details', 'Details']
    ].forEach(function (tab) {
      var button = make('button', 'greyson-itinerary-tab', tabsNav, tab[1]);
      button.type = 'button';
      var active = currentTab === tab[0];
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-pressed', String(active));
      button.addEventListener('click', function () {
        currentTab = tab[0];
        render();
      });
    });
    content.replaceChildren();
    content.scrollTop = 0;
    if (currentTab === 'schedule') {
      if (!day.timeline.length) {
        make('p', 'greyson-itinerary-empty', content,
          'Travel day · No specific times in the itinerary DOCX.');
      } else {
        day.timeline.forEach(function (entry) { renderRow(entry, content); });
      }
    } else if (currentTab === 'route') {
      renderRouteList(day);
    } else if (currentTab === 'lightning') {
      if (!day.lightningLane.length) {
        make('p', 'greyson-itinerary-empty', content,
          'No Lightning Lane booking schedule is specified for this day.');
      } else {
        make('p', 'greyson-itinerary-explainer', content,
          'These are planned check / booking reminders, NOT confirmed Lightning Lane return times.');
        day.lightningLane.forEach(function (entry) { renderRow(entry, content); });
        if (day.lightningLaneBookingRule) {
          make('p', 'greyson-itinerary-explainer', content, day.lightningLaneBookingRule);
        }
      }
    } else {
      renderDetails(day);
    }
    foot.textContent = 'DOCX v5 · Anaheim (PST) · Schematic stop order only, NOT walking directions.';
  }

  launch.addEventListener('click', function () { setOpen(panel.hidden); });
  dismiss.addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });
  document.addEventListener('pointerdown', function (event) {
    if (!panel.hidden && !root.contains(event.target)) {
      panel.hidden = true;
      launch.setAttribute('aria-expanded', 'false');
    }
  });

  Promise.all([
    fetch(new URL('itinerary-2026.json', document.baseURI)).then(function (r) {
      if (!r.ok) throw new Error('Itinerary HTTP ' + r.status);
      return r.json();
    }),
    fetch(new URL('places.json', document.baseURI)).then(function (r) {
      if (!r.ok) throw new Error('Places HTTP ' + r.status);
      return r.json();
    }),
    fetch(new URL('route-2026.json', document.baseURI)).then(function (r) {
      if (!r.ok) throw new Error('Routes HTTP ' + r.status);
      return r.json();
    })
  ]).then(function (results) {
    itinerary = results[0];
    routeData = results[2];
    if (!Array.isArray(itinerary.days)) throw new Error('Invalid itinerary days');
    if (!routeData || !routeData.routes) throw new Error('Invalid itinerary routes');
    var places = results[1].places || [];
    places.forEach(function (p) { placesById[p.id] = p; });
    var today = todayInAnaheim();
    var matchingDay = itinerary.days.findIndex(function (d) { return d.date === today; });
    if (matchingDay >= 0) dayIndex = matchingDay;
    render();
  }).catch(function (error) {
    launch.disabled = true;
    launch.textContent = 'Itinerary unavailable';
    console.warn('Greyson itinerary:', error);
  });
})();
