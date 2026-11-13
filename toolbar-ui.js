/* Greyson's Disney Trip — three-action toolbar.
 * Presentation layer only: reuses existing Search/Itinerary controls.
 * Wait Times list uses the same live data provider as the map's wait bubbles.
 * Does not change GPS, map routes, itinerary, or offline tile caches.
 */
(function () {
  'use strict';
  if (!window.L || typeof map === 'undefined') return;

  var searchTrigger = document.querySelector('.place-search-trigger');
  var searchPanel = document.querySelector('.place-search-panel');
  var itineraryTrigger = document.querySelector('.greyson-itinerary-launch');
  var itineraryPanel = document.querySelector('.greyson-itinerary-panel');
  if (!searchTrigger || !searchPanel || !itineraryTrigger || !itineraryPanel) {
    console.warn('Greyson toolbar: Search or Itinerary controls have not loaded.');
    return;
  }

  // Move the existing search panel out of Leaflet's lower stacking context.
  // Its hidden trigger and all original search/filter event handlers remain intact.
  document.body.appendChild(searchPanel);
  searchPanel.addEventListener('pointerdown', function (event) {
    // The original search script listens for outside taps on document.
    // Keep interactions within this relocated panel from closing it.
    event.stopPropagation();
  });
  searchPanel.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      if (!searchPanel.hidden) searchTrigger.click();
      event.stopPropagation();
    }
  });

  var bar = document.createElement('nav');
  bar.id = 'greyson-toolbar';
  bar.setAttribute('aria-label', 'Map tools');
  document.body.appendChild(bar);
  
  // Keep expanded panels just below the selected-day banner.
  var dayHeader = document.querySelector('.greyson-active-day');

  function updateExpandedPanelTop() {
    if (!dayHeader) return;

    var top = Math.ceil(dayHeader.getBoundingClientRect().bottom + 6);

    document.documentElement.style.setProperty(
      '--greyson-expanded-panel-top',
      top + 'px'
    );
  }

  if (dayHeader) {
    updateExpandedPanelTop();

    window.addEventListener('resize', updateExpandedPanelTop);

    if (window.visualViewport) {
      window.visualViewport.addEventListener(
        'resize',
        updateExpandedPanelTop
      );
    }

    if (window.ResizeObserver) {
      var panelTopObserver = new ResizeObserver(updateExpandedPanelTop);
      panelTopObserver.observe(dayHeader);
    }
  }

  var iconSvg = {
    search: '<circle cx="10.8" cy="10.8" r="6.4"></circle><path d="m16 16 5 5"></path>',
    itinerary: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M7 3v4M17 3v4M3 10h18"></path><path d="m9 15 2 2 4-4"></path>',
    waits: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3.5 2"></path>'
  };
  var actions = [
    { key: 'search', label: 'Search', icon: iconSvg.search },
    { key: 'itinerary', label: 'Itinerary', icon: iconSvg.itinerary },
    { key: 'waits', label: 'Wait Times', icon: iconSvg.waits }
  ];
  var buttons = Object.create(null);
  actions.forEach(function (action) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'greyson-toolbar-button';
    button.dataset.tool = action.key;
    button.setAttribute('aria-label', action.label);
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ' +
      'fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + action.icon + '</svg>' +
      '<span>' + action.label + '</span>';
    bar.appendChild(button);
    buttons[action.key] = button;
    button.addEventListener('click', function () { toggleTool(action.key); });
  });

  // Suppress the existing scripts' outside-pointer handlers while a toolbar
  // button is pressed. We manage panel switching intentionally below.
  bar.addEventListener('pointerdown', function (event) { event.stopPropagation(); });

  var waitPanel = document.createElement('section');
  waitPanel.id = 'greyson-wait-panel';
  waitPanel.hidden = true;
  waitPanel.setAttribute('role', 'dialog');
  waitPanel.setAttribute('aria-label', 'Live attraction wait times');
  document.body.appendChild(waitPanel);

  var waitHead = document.createElement('div');
  waitHead.className = 'greyson-wait-panel-head';
  waitPanel.appendChild(waitHead);
  var waitTitle = document.createElement('strong');
  waitTitle.textContent = 'Wait Times';
  waitHead.appendChild(waitTitle);
  var waitClose = document.createElement('button');
  waitClose.type = 'button';
  waitClose.className = 'greyson-wait-panel-close';
  waitClose.setAttribute('aria-label', 'Close wait times');
  waitClose.textContent = '×';
  waitHead.appendChild(waitClose);
  var waitStatus = document.createElement('div');
  waitStatus.className = 'greyson-wait-panel-status';
  waitStatus.setAttribute('role', 'status');
  waitPanel.appendChild(waitStatus);
  var waitList = document.createElement('div');
  waitList.className = 'greyson-wait-panel-list';
  waitPanel.appendChild(waitList);
  var waitCredit = document.createElement('a');
  waitCredit.className = 'greyson-wait-panel-credit';
  waitCredit.href = 'https://www.themeparks.wiki/api';
  waitCredit.target = '_blank';
  waitCredit.rel = 'noopener noreferrer';
  waitCredit.textContent = 'Live data: ThemeParks.wiki';
  waitPanel.appendChild(waitCredit);

  var PARK_IDS = {
    disneyland: '7340550b-c14d-4def-80bb-acdb51d49a66',
    california: '832fcd51-ea19-4e77-85c7-75d5843b127c'
  };
  var API = 'https://api.themeparks.wiki/v1/entity/';
  var placePromise = null;
  var waitData = null;
  var waitChecked = 0;
  var waitPending = null;
  var REFRESH_MS = 60 * 1000;

  function normalize(value) {
    return String(value || '').normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function placeDirectory() {
    if (!placePromise) {
      placePromise = fetch(new URL('places.json', document.baseURI))
        .then(function (response) {
          if (!response.ok) throw new Error('Place directory unavailable');
          return response.json();
        }).then(function (data) {
          if (!Array.isArray(data.places)) throw new Error('Invalid place directory');
          return data.places.filter(function (p) {
            return p.type === 'Attraction' && PARK_IDS[p.park] &&
              Number.isFinite(p.lat) && Number.isFinite(p.lon);
          });
        }).catch(function (error) { placePromise = null; throw error; });
    }
    return placePromise;
  }

  function findEntry(place, rows) {
    var names = [place.name].concat(place.aliases || []).map(normalize);
    return rows.find(function (row) { return names.includes(normalize(row.name)); });
  }

  function formatWait(entry) {
    var status = entry.status || 'UNKNOWN';
    var wait = entry.queue && entry.queue.STANDBY && entry.queue.STANDBY.waitTime;
    if (status === 'DOWN') return { text: 'Down', kind: 'down' };
    if (status === 'CLOSED') return { text: 'Closed', kind: 'closed' };
    if (status === 'REFURBISHMENT') return { text: 'Refurb', kind: 'closed' };
    if (status === 'OPERATING' && typeof wait === 'number' &&
        Number.isFinite(wait) && wait >= 0 && wait <= 600) {
      var minutes = Math.round(wait);
      return { text: minutes + ' min', kind: minutes <= 20 ? 'short' :
        minutes <= 45 ? 'medium' : 'long' };
    }
    return { text: '—', kind: 'unknown' };
  }

  var waitFocusPane = map.getPane('greyson-wait-focus-pane') ||
    map.createPane('greyson-wait-focus-pane');

  waitFocusPane.style.zIndex = '640';
  waitFocusPane.style.pointerEvents = 'none';

  var waitFocusMarker = null;

  function focusWaitRide(place) {
    // Remove the previous highlighted attraction.
    if (waitFocusMarker) {
      map.removeLayer(waitFocusMarker);
    }

    // Highlight the newly selected attraction.
    waitFocusMarker = L.circleMarker(
      [place.lat, place.lon], {
        pane: 'greyson-wait-focus-pane',
		radius: 9,
        weight: 3,
        color: '#ffffff',
        fillColor: '#0c7780',
        fillOpacity: 1,
        interactive: false
      }
    ).addTo(map);

    // Display the attraction name above its marker.
    waitFocusMarker.bindTooltip(place.name, {
      direction: 'top',
      permanent: false,
      opacity: 1,
      className: 'place-search-label',
      offset: [0, -10]
    }).openTooltip();

    // Consistent target zoom, regardless of starting zoom.
    map.flyTo(
      [place.lat, place.lon],
      19.05,
      { duration: 0.65 }
    );
  }

  // Remove the selected attraction's marker and label on the next tap.
  document.addEventListener('pointerdown', function () {
    if (waitFocusMarker) {
      map.removeLayer(waitFocusMarker);
	  waitFocusMarker = null;
    }
  }, true);

  function renderWaits() {
    waitList.replaceChildren();
    if (!navigator.onLine) {
      waitStatus.textContent = 'Live wait times are unavailable offline.';
      return;
    }
    if (!waitData) {
      waitStatus.textContent = 'Loading live wait times…';
      return;
    }
    if (!waitData.length) {
      waitStatus.textContent = 'No live attraction reports are available right now.';
      return;
    }
    var updated = new Date(waitChecked).toLocaleTimeString([], {
      hour: 'numeric', minute: '2-digit'
    });
    waitStatus.textContent = waitData.length + ' attractions · Updated ' + updated;
    waitData.forEach(function (item) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'greyson-wait-list-row';
      var name = document.createElement('span');
      name.className = 'greyson-wait-list-name';
      name.textContent = item.place.name;
      var status = document.createElement('span');
      status.className = 'greyson-wait-list-status is-' + item.badge.kind;
      status.textContent = item.badge.text;
      button.appendChild(name);
      button.appendChild(status);
      button.addEventListener('click', function () {
        closeAll();
        focusWaitRide(item.place);
      });
      waitList.appendChild(button);
    });
  }

  async function loadWaits() {
    if (!navigator.onLine) {
      waitData = null;
      renderWaits();
      return;
    }
    if (waitData && Date.now() - waitChecked < REFRESH_MS) {
      renderWaits();
      return;
    }
    if (waitPending) return waitPending;
    waitStatus.textContent = 'Loading live wait times…';
    waitPending = (async function () {
      var directory = await placeDirectory();
      var parks = Object.keys(PARK_IDS);
      var feeds = await Promise.allSettled(parks.map(async function (park) {
        var response = await fetch(API + PARK_IDS[park] + '/live', { cache: 'no-store' });
        if (!response.ok) throw new Error('Live feed HTTP ' + response.status);
        var data = await response.json();
        if (!Array.isArray(data.liveData)) throw new Error('Invalid live feed');
        return { park: park, rows: data.liveData };
      }));
      var rowsByPark = Object.create(null);
      var successes = 0;
      feeds.forEach(function (result) {
        if (result.status === 'fulfilled') {
          rowsByPark[result.value.park] = result.value.rows;
          successes++;
        }
      });
      if (!successes) throw new Error('Live wait-time service is unavailable');
      waitData = directory.map(function (place) {
        var entry = findEntry(place, rowsByPark[place.park] || []);
        return entry ? { place: place, badge: formatWait(entry) } : null;
      }).filter(Boolean).sort(function (a, b) {
        return a.place.name.localeCompare(b.place.name, undefined, { sensitivity: 'base' });
      });
      waitChecked = Date.now();
      if (!waitPanel.hidden) renderWaits();
      if (successes < parks.length && !waitPanel.hidden) {
        waitStatus.textContent += ' · Partial feed';
      }
    })().catch(function (error) {
      waitData = null;
      if (!waitPanel.hidden) {
        waitList.replaceChildren();
        waitStatus.textContent = 'Wait times unavailable. Try again shortly.';
      }
      console.warn('Greyson toolbar wait times:', error);
    }).finally(function () { waitPending = null; });
    return waitPending;
  }

  function closeDayMenu() {
    var menu = document.querySelector('.greyson-active-day-menu');
    var button = document.querySelector('.greyson-active-day-date');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }
  function activeTool() {
    if (!waitPanel.hidden) return 'waits';
    if (!itineraryPanel.hidden) return 'itinerary';
    if (!searchPanel.hidden) return 'search';
    return '';
  }
  // A floating glass neck connects whichever panel is open to its toolbar tab.
  // These elements are decorative, so they never intercept taps on the map.
  var connector = document.createElement('div');
  connector.id = 'greyson-panel-connector';
  connector.hidden = true;
  document.body.appendChild(connector);

  var connectorSeam = document.createElement('div');
  connectorSeam.id = 'greyson-panel-connector-seam';
  connectorSeam.hidden = true;
  document.body.appendChild(connectorSeam);

  function positionConnector(active) {
    var panel = active === 'search' ? searchPanel :
      active === 'itinerary' ? itineraryPanel :
      active === 'waits' ? waitPanel : null;
    var button = buttons[active];

    if (!panel || !button) {
      connector.hidden = true;
      connectorSeam.hidden = true;
      return;
    }

    var panelRect = panel.getBoundingClientRect();
    var buttonRect = button.getBoundingClientRect();
    var centerX = (buttonRect.left + buttonRect.right) / 2;

    // Keep the neck inside the panel's left and right edges, even on desktop.
    var neckWidth = Math.min(
      buttonRect.width - 12,
      136,
      2 * (centerX - panelRect.left - 10),
      2 * (panelRect.right - centerX - 10)
    );

    if (neckWidth < 40 || !panelRect.height) {
      connector.hidden = true;
      connectorSeam.hidden = true;
      return;
    }

    var left = centerX - neckWidth / 2;
    var top = panelRect.bottom - 5;
    var bottom = buttonRect.bottom - 4;

    connector.style.left = left + 'px';
    connector.style.top = top + 'px';
    connector.style.width = neckWidth + 'px';
    connector.style.height = Math.max(12, bottom - top) + 'px';

    // Conceal the horizontal panel border beneath the connecting neck.
    connectorSeam.style.left = (left + 1) + 'px';
    connectorSeam.style.top = (panelRect.bottom - 3) + 'px';
    connectorSeam.style.width = (neckWidth - 2) + 'px';
    connectorSeam.style.height = '6px';

    connector.hidden = false;
    connectorSeam.hidden = false;
  }

  function updateActive() {
    var active = activeTool();
    Object.keys(buttons).forEach(function (key) {
      buttons[key].classList.toggle('is-selected', key === active);
      buttons[key].setAttribute('aria-expanded', String(key === active));
    });
    positionConnector(active);
  }

  // Keep the connector aligned when Safari changes its visible viewport.
  window.addEventListener('resize', function () {
    requestAnimationFrame(updateActive);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () {
      requestAnimationFrame(updateActive);
    });
  }
  function closeAll() {
    if (!searchPanel.hidden) searchTrigger.click();
    if (!itineraryPanel.hidden) itineraryTrigger.click();
    waitPanel.hidden = true;
    updateActive();
  }
  function toggleTool(tool) {
    var alreadyOpen = activeTool() === tool;
    closeAll();
    closeDayMenu();
    if (alreadyOpen) return;
    if (tool === 'search') {
      searchTrigger.click();
    } else if (tool === 'itinerary') {
      itineraryTrigger.click();
    } else if (tool === 'waits') {
      waitPanel.hidden = false;
      loadWaits();
      waitClose.focus({ preventScroll: true });
    }
    updateActive();
  }

  waitClose.addEventListener('click', function () {
    waitPanel.hidden = true;
    updateActive();
    buttons.waits.focus({ preventScroll: true });
  });
  waitPanel.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      waitPanel.hidden = true;
      updateActive();
      buttons.waits.focus({ preventScroll: true });
    }
  });
  document.addEventListener('pointerdown', function (event) {
    if (!waitPanel.hidden && !waitPanel.contains(event.target) && !bar.contains(event.target)) {
      waitPanel.hidden = true;
    }
    // Existing Search and Itinerary scripts process this same event first.
    updateActive();
  });
  // Keep the toolbar highlight synchronized when an existing panel's own
  // close button or result selection dismisses that panel.
  document.addEventListener('click', function () {
    requestAnimationFrame(updateActive);
  });
  window.addEventListener('offline', function () {
    waitData = null;
    if (!waitPanel.hidden) renderWaits();
  });
  window.addEventListener('online', function () {
    if (!waitPanel.hidden) loadWaits();
  });
})();
