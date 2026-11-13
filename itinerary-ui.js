/* Greyson's Disney Trip — DOCX v5 itinerary + ordered stop overlay.
 * Timeline timing is always read from itinerary-2026.json, never recalculated.
 * Route overlays are visual only; Stops and Route remain independent.
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
  // Walking overlays are separate from the numbered Stops layer and itinerary data.
  // Traced paths exist for all three park days. Rest day has no map route.
  var WALKING_DATES = ['2026-11-16', '2026-11-17', '2026-11-19'];
  var walkingOn = false;
  var walkingLayer = L.layerGroup();
  var walkingData = null;
  var walkingFetch = null;
  var walkingLoadError = false;
  // Persist only local UI state; no GPS positions or server sync.
  var SESSION_KEY = 'greyson-disney-map-session-v1';
  var sessionReady = false;
  var sessionDate = '';
  var validDates = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'];
  var dateLabels = {
    '2026-11-16': 'Mon. 11/16',
    '2026-11-17': 'Tues. 11/17',
    '2026-11-18': 'Wed. 11/18',
    '2026-11-19': 'Thurs. 11/19'
  };


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
  // The fixed top banner reflects the same selected day as the panel.
  // The Route control is available for the Nov 16 pilot; other days remain disabled.
  var dayBanner = make('div', 'greyson-active-day', document.body);
  dayBanner.setAttribute('aria-label', 'Selected itinerary day and map overlays');
  var dayBannerDate = make('button', 'greyson-active-day-date', dayBanner, 'Mon. 11/16 ▾');
  dayBannerDate.type = 'button';
  dayBannerDate.disabled = true;
  dayBannerDate.setAttribute('aria-expanded', 'false');
  dayBannerDate.setAttribute('aria-haspopup', 'true');

  var dayMenu = make('div', 'greyson-active-day-menu', dayBanner);
  dayMenu.hidden = true;
  dayMenu.setAttribute('aria-label', 'Choose itinerary day');

  function closeDayMenu() {
    dayMenu.hidden = true;
    dayBannerDate.setAttribute('aria-expanded', 'false');
  }

  dayBannerDate.addEventListener('click', function () {
    if (!itinerary) return;
    if (!panel.hidden) setOpen(false);

    var opening = dayMenu.hidden;
    dayMenu.hidden = !opening;
    dayBannerDate.setAttribute('aria-expanded', String(opening));
  });

  document.addEventListener('pointerdown', function (event) {
    if (!dayMenu.contains(event.target) &&
	    !dayBannerDate.contains(event.target)) {
	  closeDayMenu();
	}
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !dayMenu.hidden) closeDayMenu();
  });

  var dayBannerControls = make('div', 'greyson-active-day-controls', dayBanner);
  var bannerStops = make('button', 'greyson-active-day-toggle', dayBannerControls, 'Stops');
  bannerStops.type = 'button';
  bannerStops.disabled = true;
  bannerStops.setAttribute('aria-pressed', 'false');
  bannerStops.setAttribute('aria-label', 'Show itinerary stops on map');
  bannerStops.addEventListener('click', function () {
    if (!itinerary || !routeStopsForDay(itinerary.days[dayIndex]).length) return;
    toggleRoute(!routeOn);
    render();
  });
  var bannerWalking = make('button', 'greyson-active-day-toggle', dayBannerControls, 'Route');
  bannerWalking.type = 'button';
  bannerWalking.disabled = true;
  bannerWalking.title = 'Show this day’s visual walking route';
  bannerWalking.setAttribute('aria-label', 'Show walking route preview');
  bannerWalking.setAttribute('aria-pressed', 'false');
  bannerWalking.addEventListener('click', toggleWalking);

  var panel = make('section', 'greyson-itinerary-panel', root);
  panel.id = 'greyson-itinerary-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Greyson’s Disney trip itinerary');
  panel.hidden = true;

  var header = make('div', 'greyson-itinerary-head', panel);

  var titleGroup = make('div', 'greyson-itinerary-titlegroup', header);
  make('strong', '', titleGroup, 'Trip Itinerary');

  var headActions = make('div', 'greyson-itinerary-head-actions', header);

  var dismiss = make('button', 'greyson-itinerary-close', headActions, '×');
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
	  
	  requestAnimationFrame(function () {
		updateScheduleFocus(true);
      });
	  
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
    map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 19.05), { duration: 0.65 });
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

  function stopColorClass(index, total) {
    var stage = Math.ceil(index * 3 / total);
    return stage === 1 ? 'is-early' :
           stage === 2 ? 'is-middle' : 'is-late';
  }

  function clearRoute() {
    routeLayer.clearLayers();
    if (map.hasLayer(routeLayer)) map.removeLayer(routeLayer);
  }

  function updateRouteButtons() {
    if (!itinerary) return;
    var day = itinerary.days[dayIndex];
    var available = routeStopsForDay(day).length > 0;
    if (!available) routeOn = false;
    var pressed = routeOn && available;
    dayBannerDate.textContent = (dateLabels[day.date] || day.day) + ' ▾';
    dayBannerDate.disabled = false;
    dayBannerDate.setAttribute('aria-label',
      'Change selected day. Currently ' + (dateLabels[day.date] || day.day));
	bannerStops.disabled = !available;
	bannerStops.classList.toggle('is-active', pressed);
	bannerStops.setAttribute('aria-pressed', String(pressed));
	bannerStops.title = available
	  ? (pressed ? 'Hide stops for this day' : 'Show stops for this day')
	  : 'No map stops scheduled for this day';
    bannerStops.setAttribute('aria-label', pressed
      ? 'Hide itinerary stops on map' : 'Show itinerary stops on map');

    var walkingAvailable = WALKING_DATES.includes(day.date);
    bannerWalking.disabled = !walkingAvailable || !!walkingFetch;
    bannerWalking.classList.toggle('is-active', walkingOn && walkingAvailable);
    bannerWalking.setAttribute('aria-pressed', String(walkingOn && walkingAvailable));
    bannerWalking.setAttribute('aria-label', walkingOn
      ? 'Hide walking route preview' : 'Show walking route preview');
    bannerWalking.title = !walkingAvailable
      ? 'No walking route planned for this day'
      : walkingLoadError ? 'Route failed to load; tap to retry'
      : (walkingOn ? 'Hide the visual route' : 'Show the visual route');
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

    // Stops toggles show numbered destination pins only. Walking lines belong
    // exclusively to the independent Route toggle.
    stops.forEach(function (stop) {
      var p = stop.place;
      var colorClass = stopColorClass(stop.index, stops.length);
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
    if (routeOn) focusRouteBounds();
    saveSession();
  }


  function renderWalking() {
    walkingLayer.clearLayers();
    if (map.hasLayer(walkingLayer)) map.removeLayer(walkingLayer);
    if (!walkingOn || !itinerary || !walkingData) return;
    var day = itinerary.days[dayIndex];
    var entry = walkingData.routes && walkingData.routes[day.date];
    if (!entry || !Array.isArray(entry.segments)) return;

    entry.segments.forEach(function (segment) {
      var coords = segment.points;
      if (!Array.isArray(coords) || coords.length < 2) return;
      // White casing helps distinguish the walking line from the artwork.
      L.polyline(coords, {
        color: '#fff', opacity: 0.96, weight: 8, lineCap: 'round',
        lineJoin: 'round', interactive: false
      }).addTo(walkingLayer);
      L.polyline(coords, {
        color: '#1b77b5', opacity: 0.98, weight: 4.5,
        lineCap: 'round', lineJoin: 'round',
        dashArray: segment.kind === 'park-hop' ? '8 9' : null,
        interactive: false
      }).addTo(walkingLayer);
    });
    walkingLayer.addTo(map);
  }

  function loadWalkingData() {
    if (walkingData) return Promise.resolve(walkingData);
    if (walkingFetch) return walkingFetch;
    walkingLoadError = false;
    walkingFetch = fetch(new URL('walking-routes-2026.json', document.baseURI))
      .then(function (r) {
        if (!r.ok) throw new Error('walking-routes-2026.json HTTP ' + r.status);
        return r.json();
      }).then(function (data) {
        var invalidDays = WALKING_DATES.filter(function (date) {
          var row = data && data.routes && data.routes[date];
          return !row || !Array.isArray(row.segments) || !row.segments.length ||
            !row.segments.every(function (segment) {
              return Array.isArray(segment.points) && segment.points.length >= 2 &&
                segment.points.every(function (coords) {
                  return Array.isArray(coords) && coords.length === 2 &&
                    coords.every(Number.isFinite);
                });
            });
        });
        if (invalidDays.length) {
          throw new Error('Invalid walking route geometry for ' + invalidDays.join(', '));
        }
        walkingData = data;
        walkingLoadError = false;
        return data;
      }).finally(function () {
        walkingFetch = null;
        updateRouteButtons();
      });
    updateRouteButtons();
    return walkingFetch;
  }

  function toggleWalking() {
    if (!itinerary || !WALKING_DATES.includes(itinerary.days[dayIndex].date)) return;
    if (walkingOn) {
      walkingOn = false;
      renderWalking();
      updateRouteButtons();
      saveSession();
      return;
    }
    walkingOn = true;
    updateRouteButtons();
    saveSession();
    loadWalkingData().then(function () {
      // A day switch while loading must never display the wrong day's path.
      renderWalking();
      updateRouteButtons();
    }).catch(function (err) {
      walkingOn = false;
      walkingLoadError = true;
      renderWalking();
      updateRouteButtons();
      saveSession();
      console.warn('Greyson walking route unavailable (tap Route to retry):', err);
    });
  }

  function renderRouteList(day) {
    var stops = routeStopsForDay(day);
    if (!stops.length) {
      make('p', 'greyson-itinerary-empty', content,
        'No mapped stops for this rest day. See Schedule and Details for the day’s plans.');
      return;
    }
    make('p', 'greyson-itinerary-explainer', content,
      'Stops follow the DOCX order and times. Use the separate Route toggle for the traced walking-path overlay. Optional alternatives remain in Schedule.');
    if (routeOn) {
      var controls = make('div', 'greyson-itinerary-route-actions', content);
      var fit = make('button', 'greyson-itinerary-route-btn is-secondary', controls, 'View all stops');
      fit.type = 'button';
      fit.addEventListener('click', function () { focusRouteBounds(); setOpen(false); });
    }
    stops.forEach(function (stop) {
      var row = make('button', 'greyson-itinerary-route-row', content);
      row.type = 'button';
      var num = make('span', 'greyson-itinerary-route-num', row, String(stop.index));
      num.classList.add(stopColorClass(stop.index, stops.length));
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

  // Current time in Anaheim, expressed as minutes after midnight.
  function anaheimMinutes() {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date());

    var values = Object.create(null);
    parts.forEach(function (p) {
      values[p.type] = p.value;
    });

    return Number(values.hour) * 60 + Number(values.minute);
  }

  // Convert the chronological itinerary times to 24-hour ranges.
  function schedulePeriods(entries) {
    var previousStart = -1;

    return entries.map(function (entry) {
      var times = String(entry.time || '').match(/\d{1,2}:\d{2}/g);
      if (!times) return null;

      function halfDay(value) {
        var parts = value.split(':').map(Number);
        return (parts[0] % 12) * 60 + parts[1];
      }

      var start = halfDay(times[0]);
      while (start <= previousStart) start += 720;
      previousStart = start;

      var end = null;

      if (times.length > 1) {
        end = halfDay(times[1]);
        while (end <= start) end += 720;
      } else if (/^\s*After\b/i.test(entry.time)) {
        end = 1440;
      }

      return { start: start, end: end };
    });
  }

  function updateScheduleFocus(scrollToActivity) {
    if (!itinerary || currentTab !== 'schedule') return;

    var rows = Array.from(
      content.querySelectorAll('.greyson-itinerary-entry')
    );

    rows.forEach(function (row) {
      row.classList.remove('is-current', 'is-upcoming');
      var label = row.querySelector('.greyson-itinerary-live-tag');
      if (label) label.remove();
    });

    var day = itinerary.days[dayIndex];

    // Never label a different date as the current activity.
    if (day.date !== todayInAnaheim()) return;

    var now = anaheimMinutes();
    var periods = schedulePeriods(day.timeline);
    var targetIndex = -1;
    var state = '';

    for (var i = 0; i < periods.length; i++) {
      var period = periods[i];
      if (!period) continue;

      if (now < period.start) {
        targetIndex = i;
        state = 'is-upcoming';
        break;
      }

      var end = period.end;
      if (end === null) {
        end = periods[i + 1] ? periods[i + 1].start : 1440;
      }

      if (now >= period.start && now < end) {
        targetIndex = i;
        state = 'is-current';
        break;
      }
    }

    if (targetIndex < 0 || !rows[targetIndex]) return;

    var target = rows[targetIndex];
    target.classList.add(state);

    var main = target.querySelector('.greyson-itinerary-entry-main');
    if (main) {
      var badge = document.createElement('span');
      badge.className = 'greyson-itinerary-live-tag';
      badge.textContent =
        state === 'is-current' ? 'NOW' : 'UP NEXT';
      main.insertBefore(badge, main.firstChild);
    }

    if (scrollToActivity && !panel.hidden) {
      var listRect = content.getBoundingClientRect();
      var rowRect = target.getBoundingClientRect();

      content.scrollTop += rowRect.top - listRect.top - 12;
    }
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

  function selectDay(index) {
    if (!itinerary || !itinerary.days[index] ||
        !validDates.includes(itinerary.days[index].date)) return;

    closeDayMenu();
    if (dayIndex === index) return;

    dayIndex = index;
    currentTab = 'schedule';

    if (routeOn) renderRoute();
    if (walkingOn && !WALKING_DATES.includes(itinerary.days[index].date)) {
      walkingOn = false;
    }

    renderWalking();
    render();
    saveSession();
  }

  function render() {
    if (!itinerary) return;
    var day = itinerary.days[dayIndex];
    // Keep the top banner and itinerary-panel toggle in sync.
    updateRouteButtons();

	dayMenu.replaceChildren();

	itinerary.days.forEach(function (day, index) {
	  if (!validDates.includes(day.date)) return;

	  var option = make('button', 'greyson-active-day-option',
        dayMenu, dateLabels[day.date]);

	  option.type = 'button';
	  option.classList.toggle('is-selected', index === dayIndex);
	  option.setAttribute('aria-pressed', String(index === dayIndex));

	  option.addEventListener('click', function () {
        selectDay(index);
      });
    });

    daysNav.replaceChildren();
    itinerary.days.forEach(function (d, index) {
      if (d.date === '2026-11-15' || d.date === '2026-11-20') return;
      var b = make('button', 'greyson-itinerary-day', daysNav, d.day);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(index === dayIndex));
      if (index === dayIndex) b.classList.add('is-selected');
      b.addEventListener('click', function () {
        selectDay(index);
      });
    });

    daySummary.replaceChildren();
    make('h2', '', daySummary, day.title);
    make('p', 'greyson-itinerary-muted', daySummary, day.subtitle);
    if (day.priority) make('p', 'greyson-itinerary-priority', daySummary, day.priority);

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
	if (currentTab === 'schedule') {
      updateScheduleFocus(false);
	}
	foot.textContent = 'DOCX v5 · Anaheim (PST) · Route is a visual draft, NOT turn-by-turn navigation.';
  }

  // Save map center/zoom and overlay state after the user finishes panning,
  // zooming, focusing a place, or toggling stops. Storage is per browser/origin.
  function saveSession() {
    if (!sessionReady || !itinerary) return;
    // If Anaheim rolled into a new day while the app stayed visible, reset
    // before persisting rather than carrying yesterday's overlays forward.
    if (todayInAnaheim() !== sessionDate) {
      refreshDayIfNeeded();
      return;
    }
    try {
      var center = map.getCenter();
      var chosenDay = itinerary.days[dayIndex];
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        savedOn: todayInAnaheim(),
        selectedDate: chosenDay.date,
        center: [center.lat, center.lng],
        zoom: map.getZoom(),
        stopsOn: !!routeOn,
        walkingOn: !!walkingOn
      }));
    } catch (_) { /* Blocked/full storage: app remains functional without persistence. */ }
  }

  function readSavedSession(today) {
    try {
      var saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!saved || saved.savedOn !== today || !validDates.includes(saved.selectedDate)) return null;
      // On an actual park/rest day, the real Anaheim day overrides any
      // previously browsed itinerary day, regardless of saved map state.
      if (validDates.includes(today) && saved.selectedDate !== today) return null;
      return saved;
    } catch (_) { return null; }
  }

  function restoreMapView(saved) {
    if (!saved || !Array.isArray(saved.center) || saved.center.length !== 2) return;
    var lat = saved.center[0], lon = saved.center[1], zoom = saved.zoom;
    if (![lat, lon, zoom].every(Number.isFinite)) return;
    if (map.options.maxBounds && !map.options.maxBounds.contains([lat, lon])) return;
    if (zoom < map.getMinZoom() || zoom > map.getMaxZoom()) return;
    map.setView([lat, lon], zoom, { animate: false });
  }

  function refreshDayIfNeeded() {
    if (!sessionReady || !itinerary) return;
    var today = todayInAnaheim();
    if (today === sessionDate) return;
    sessionDate = today;
    // A new Anaheim calendar day always begins with a clean map overview.
    var matchingDay = itinerary.days.findIndex(function (d) { return d.date === today; });
    if (matchingDay >= 0 && validDates.includes(today)) dayIndex = matchingDay;
    else dayIndex = 1; // Preview day outside the four itinerary dates.
    routeOn = false;
    walkingOn = false;
    renderWalking();
    currentTab = 'schedule';
    if (highlight) { map.removeLayer(highlight); highlight = null; }
    renderRoute();
    if (typeof focusInitialView === 'function') focusInitialView();
    render();
    saveSession();
  }

  map.on('moveend zoomend', saveSession);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refreshDayIfNeeded();
  });
  window.addEventListener('pageshow', refreshDayIfNeeded);

  // Loading errors should never permanently disable the itinerary. A
  // transient connection, stale SW response, or malformed JSON can be retried
  // without reloading the entire map or losing downloaded tile caches.
  var loadingPromise = null;

  function fetchJsonFile(filename, retry) {
    return fetch(new URL(filename, document.baseURI), retry ? { cache: 'reload' } : undefined)
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .catch(function (error) {
        if (!retry) {
          return new Promise(function (resolve) { setTimeout(resolve, 650); })
            .then(function () { return fetchJsonFile(filename, true); });
        }
        throw new Error(filename + ': ' + (error && error.message ? error.message : String(error)));
      });
  }

  function loadItinerary(openAfter) {
    if (loadingPromise) return loadingPromise;
    launch.disabled = true;
    launch.textContent = 'Loading itinerary…';
    launch.title = '';

    loadingPromise = Promise.all([
      fetchJsonFile('itinerary-2026.json', false),
      fetchJsonFile('places.json', false),
      fetchJsonFile('route-2026.json', false)
    ]).then(function (results) {
      var nextItinerary = results[0];
      var nextRouteData = results[2];
      if (!nextItinerary || !Array.isArray(nextItinerary.days))
        throw new Error('itinerary-2026.json: missing days array');
      if (!nextRouteData || !nextRouteData.routes)
        throw new Error('route-2026.json: missing routes object');
      if (!results[1] || !Array.isArray(results[1].places))
        throw new Error('places.json: missing places array');

      itinerary = nextItinerary;
      routeData = nextRouteData;
      placesById = Object.create(null);
      results[1].places.forEach(function (p) { placesById[p.id] = p; });
      var today = todayInAnaheim();
      sessionDate = today;
      var matchingDay = itinerary.days.findIndex(function (d) { return d.date === today; });
      if (matchingDay >= 0 && validDates.includes(today)) dayIndex = matchingDay;
      var saved = readSavedSession(today);
      if (saved) {
        var savedIndex = itinerary.days.findIndex(function (d) { return d.date === saved.selectedDate; });
        if (savedIndex >= 0) dayIndex = savedIndex;
        routeOn = !!saved.stopsOn && routeStopsForDay(itinerary.days[dayIndex]).length > 0;
        walkingOn = !!saved.walkingOn && WALKING_DATES.includes(itinerary.days[dayIndex].date);
      }
      if (routeOn) renderRoute(); // Does not auto-fit on restoration.
      if (saved) restoreMapView(saved);
      render();
      sessionReady = true;
      saveSession();
      if (walkingOn) {
        loadWalkingData().then(function () { renderWalking(); updateRouteButtons(); })
          .catch(function (error) {
            walkingOn = false;
            walkingLoadError = true;
            updateRouteButtons();
            saveSession();
            console.warn('Greyson walking route restoration failed:', error);
          });
      }
      launch.textContent = '▦ Itinerary';
      launch.disabled = false;
      launch.title = '';
      if (openAfter) setOpen(true);
    }).catch(function (error) {
      // Reset partial initialization; the button remains operable for retry.
      sessionReady = false;
      itinerary = null;
      routeData = null;
      launch.disabled = false;
      launch.textContent = '↻ Retry itinerary';
      launch.title = 'Could not load itinerary. Tap to try again.';
      console.warn('Greyson itinerary load failed (tap Retry itinerary to try again):', error);
    }).finally(function () {
      loadingPromise = null;
    });
    return loadingPromise;
  }

  launch.addEventListener('click', function () {
    if (itinerary) setOpen(panel.hidden);
    else loadItinerary(true);
  });
  dismiss.addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });
  // Remove the selected itinerary marker and label on the next tap.
  document.addEventListener('pointerdown', function (event) {
    if (highlight && !panel.contains(event.target)) {
      map.removeLayer(highlight);
      highlight = null;
    }
  }, true);
  document.addEventListener('pointerdown', function (event) {
    if (!panel.hidden && !root.contains(event.target)) {
      panel.hidden = true;
      launch.setAttribute('aria-expanded', 'false');
    }
  });

  // Refresh the highlight without interrupting manual scrolling.
  window.setInterval(function () {
    if (!document.hidden &&
        !panel.hidden &&
        currentTab === 'schedule') {
      updateScheduleFocus(false);
    }
  }, 30000);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !panel.hidden) {
      updateScheduleFocus(false);
    }
  });

  loadItinerary(false);
})();
