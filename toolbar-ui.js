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

  // Reuse the map's already-fetched and normalized live wait information.
  var waitFeed = window.greysonWaitFeed;
  var waitData = [];
  var waitChecked = 0;
  var waitErrors = 0;
  var waitPending = false;

  if (!waitFeed) {
    console.warn('Greyson toolbar: shared wait-time feed was not initialized.');
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
    if (!waitChecked || (waitPending && !waitData.length)) {
      waitStatus.textContent = waitErrors === 2 && !waitPending
        ? 'Wait times unavailable. Try again shortly.'
        : 'Loading live wait times…';
      return;
    }
    if (!waitData.length) {
      waitStatus.textContent = waitErrors === 2
        ? 'Wait times unavailable. Try again shortly.'
        : 'No live attraction reports are available right now.';
      return;
    }
    var updated = new Date(waitChecked).toLocaleTimeString([], {
      hour: 'numeric', minute: '2-digit'
    });
    waitStatus.textContent = waitData.length + ' attractions · Updated ' + updated +
      (waitErrors ? ' · Partial feed' : '');
    waitData.forEach(function (item) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'greyson-wait-list-row';
      var name = document.createElement('span');
      name.className = 'greyson-wait-list-name';
      name.textContent = item.place.name;
      var status = document.createElement('span');
      status.className = 'greyson-wait-list-status is-' + item.badge.style;
      status.textContent = item.badge.label.replace(/(\d+)m$/, '$1 min');
      button.appendChild(name);
      button.appendChild(status);
      button.addEventListener('click', function () {
        closeAll();
        focusWaitRide(item.place);
      });
      waitList.appendChild(button);
    });
  }

  function loadWaits() {
    if (!waitPanel.hidden) renderWaits();
    if (waitFeed && navigator.onLine) waitFeed.refreshIfStale();
  }

  if (waitFeed) {
    waitFeed.subscribe(function (state) {
      waitData = state.items;
      waitChecked = state.lastCheck;
      waitErrors = state.errors;
      waitPending = state.pending;
      if (!waitPanel.hidden) renderWaits();
    });
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
    if (!waitPanel.hidden) renderWaits();
  });
  window.addEventListener('online', function () {
    if (!waitPanel.hidden) loadWaits();
  });
})();
