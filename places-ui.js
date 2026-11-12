/* Greyson's Disney Trip — offline place directory and map focusing.
   Coordinates are approximate map landmarks, not guaranteed ride entrances. */
(function () {
  'use strict';
  if (!window.L || typeof map === 'undefined') return;

  var parkNames = {
    disneyland: 'Disneyland Park',
    california: 'California Adventure',
    downtown: 'Downtown Disney'
  };
  var places = [];
  var marker = null;
  var input, parkSelect, typeSelect, results, counter, panel, trigger;

  function normalize(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function closePanel() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  function showPlace(place) {
    closePanel();
    if (marker) map.removeLayer(marker);
    marker = L.circleMarker([place.lat, place.lon], {
      radius: 8, weight: 3, color: '#fff', fillColor: '#296344',
      fillOpacity: 1, interactive: false
    }).addTo(map);
    marker.bindTooltip(place.name, {
      direction: 'top', permanent: true, opacity: 1,
      className: 'place-search-label', offset: [0, -10]
    }).openTooltip();
    map.flyTo([place.lat, place.lon], place.zoom || 18.05, { duration: 0.65 });
  }

  function makeResult(place) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'place-search-result';

    var name = document.createElement('strong');
    name.textContent = place.name;
    var detail = document.createElement('small');
    detail.textContent = parkNames[place.park] + (place.area ? ' · ' + place.area : '') + ' · ' + place.type;

    button.appendChild(name);
    button.appendChild(detail);
    button.addEventListener('click', function () { showPlace(place); });
    return button;
  }

  function render() {
    if (!results) return;
    var search = normalize(input.value);
    var park = parkSelect.value;
    var type = typeSelect.value;
    var matched = places.filter(function (place) {
      if (park !== 'all' && place.park !== park) return false;
      if (type !== 'all' && place.type !== type) return false;
      if (!search) return true;
      return normalize([place.name, place.area].concat(place.aliases || []).join(' ')).includes(search);
    });
    results.replaceChildren();
    var frag = document.createDocumentFragment();
    if (!matched.length) {
      var empty = document.createElement('p');
      empty.className = 'place-search-empty';
      empty.textContent = 'No matching locations yet. Try another name or area.';
      frag.appendChild(empty);
    } else {
      matched.forEach(function (place) { frag.appendChild(makeResult(place)); });
    }
    results.appendChild(frag);
    counter.textContent = matched.length + (matched.length === 1 ? ' place' : ' places') + ' · A–Z';
  }

  function buildControl() {
    var PlaceControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function () {
        var root = L.DomUtil.create('div', 'leaflet-control-place-search');
        trigger = L.DomUtil.create('button', 'place-search-trigger', root);
        trigger.type = 'button';
        trigger.textContent = '⌕  Find places  ▾';
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-haspopup', 'true');
        trigger.setAttribute('aria-label', 'Search Disneyland Resort places');

        panel = L.DomUtil.create('div', 'place-search-panel', root);
        panel.hidden = true;

        var head = L.DomUtil.create('div', 'place-search-head', panel);
        var heading = L.DomUtil.create('strong', '', head);
        heading.textContent = 'Find a place';
        var close = L.DomUtil.create('button', 'place-search-dismiss', head);
        close.type = 'button';
        close.textContent = '×';
        close.setAttribute('aria-label', 'Close search');

        input = L.DomUtil.create('input', 'place-search-input', panel);
        input.type = 'search';
        input.placeholder = 'Search rides, shops, landmarks…';
        input.setAttribute('aria-label', 'Place name');
        input.autocomplete = 'off';

        var filters = L.DomUtil.create('div', 'place-search-filters', panel);
        parkSelect = L.DomUtil.create('select', '', filters);
        parkSelect.setAttribute('aria-label', 'Filter by park');
        [
          ['all', 'All locations'], ['disneyland', 'Disneyland Park'],
          ['california', 'California Adventure'], ['downtown', 'Downtown Disney']
        ].forEach(function (item) {
          var opt = document.createElement('option');
          opt.value = item[0];
          opt.textContent = item[1];
          parkSelect.appendChild(opt);
        });

        typeSelect = L.DomUtil.create('select', '', filters);
        typeSelect.setAttribute('aria-label', 'Filter by place type');
        [
          ['all', 'All types'],
		  ['Attraction', 'Attractions'],
          ['Dining', 'Dining'],
		  ['Shopping', 'Shopping'],
		  ['Experience', 'Experiences'],
		  ['Landmark', 'Landmarks'],
		  ['Services', 'Services']
        ].forEach(function (item) {
          var opt = document.createElement('option');
          opt.value = item[0];
          opt.textContent = item[1];
          typeSelect.appendChild(opt);
        });

        counter = L.DomUtil.create('div', 'place-search-count', panel);
        counter.setAttribute('aria-live', 'polite');
        counter.textContent = 'Loading places…';
        results = L.DomUtil.create('div', 'place-search-results', panel);
        results.setAttribute('role', 'region');
        results.setAttribute('aria-label', 'Matching places');

        var note = L.DomUtil.create('small', 'place-search-note', panel);
        note.textContent = 'Locations are approximate, not entrance directions. More places are being added.';

        trigger.addEventListener('click', function () {
          var opening = panel.hidden;
          panel.hidden = !opening;
          trigger.setAttribute('aria-expanded', String(opening));
          if (opening) {
            render();
            input.focus();
          }
        });
        close.addEventListener('click', function () {
          closePanel();
          trigger.focus();
        });
        input.addEventListener('input', render);
        parkSelect.addEventListener('change', render);
        typeSelect.addEventListener('change', render);
        root.addEventListener('keydown', function (event) {
          if (event.key === 'Escape') {
            closePanel();
            trigger.focus();
          }
        });
        document.addEventListener('pointerdown', function (event) {
          if (!root.contains(event.target)) closePanel();
        });
        L.DomEvent.disableClickPropagation(root);
        L.DomEvent.disableScrollPropagation(root);
        return root;
      }
    });

    map.addControl(new PlaceControl());
  }

  buildControl();
  fetch(new URL('places.json', document.baseURI))
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(function (data) {
      if (!Array.isArray(data.places)) throw new Error('Invalid place directory');
      places = data.places.filter(function (p) {
        return p.name && parkNames[p.park] && Number.isFinite(p.lat) && Number.isFinite(p.lon);
      }).sort(function (a, b) {
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      render();
    })
    .catch(function () {
      counter.textContent = 'Search directory unavailable';
      results.textContent = 'Try reloading when online, then reopen the app for offline use.';
    });
})();