/* Greyson's Disney Trip — offline place directory and map focusing.
   Exact names and aliases rank first; area matches are fallback only.
   Conservative typo tolerance works entirely on-device and offline.
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
  var searchIndex = [];
  var marker = null;
  var input, parkSelect, typeSelect, results, counter, panel, trigger;

  function normalize(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Damerau-Levenshtein distance: supports swapped letters ("driod"),
  // missing letters ("disny"), and neighboring spelling mistakes.
  // The dictionary is tiny (~316 places), so no network or search library is needed.
  function editDistance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    var rows = new Array(a.length + 1);
    for (var i = 0; i <= a.length; i++) {
      rows[i] = new Array(b.length + 1);
      rows[i][0] = i;
    }
    for (var j = 0; j <= b.length; j++) rows[0][j] = j;
    for (var r = 1; r <= a.length; r++) {
      for (var c = 1; c <= b.length; c++) {
        var cost = a[r - 1] === b[c - 1] ? 0 : 1;
        rows[r][c] = Math.min(
          rows[r - 1][c] + 1,
          rows[r][c - 1] + 1,
          rows[r - 1][c - 1] + cost
        );
        if (r > 1 && c > 1 && a[r - 1] === b[c - 2] && a[r - 2] === b[c - 1]) {
          rows[r][c] = Math.min(rows[r][c], rows[r - 2][c - 2] + 1);
        }
      }
    }
    return rows[a.length][b.length];
  }

  // Require every query word to correspond to a different place-name word.
  // This avoids unrelated partial matches and tolerates word order changes.
  function tokenScore(words, queryTokens, fuzzy) {
    if (queryTokens.length > words.length) return -1;
    var used = new Set();
    var score = 0;
    for (var t = 0; t < queryTokens.length; t++) {
      var queryWord = queryTokens[t];
      var best = -1;
      var bestIndex = -1;
      for (var w = 0; w < words.length; w++) {
        if (used.has(w)) continue;
        var word = words[w];
        var value = -1;
        if (word === queryWord) {
          value = 40;
        } else if (queryWord.length >= 2 && word.startsWith(queryWord)) {
          value = 30 + Math.min(8, Math.round(8 * queryWord.length / word.length));
        } else if (fuzzy && queryWord.length >= 4) {
          // Two mistakes require either a long word or a multi-word query;
          // short one-word queries remain strict to prevent random guesses.
          var limit = queryWord.length >= 7 ||
            (queryWord.length >= 5 && queryTokens.length > 1) ? 2 : 1;
          var distance = editDistance(queryWord, word, limit);
          if (distance <= limit) value = 20 - distance * 5;
        }
        if (value > best) { best = value; bestIndex = w; }
      }
      if (bestIndex < 0) return -1;
      used.add(bestIndex);
      score += best;
    }
    return score;
  }

  // Scoring tiers: exact > starts with > contains > whole/prefix words > typo.
  function phraseScore(text, query, queryTokens, penalty) {
    if (!text) return -1;
    if (text === query) return 1000 - penalty;
    if (text.startsWith(query + ' ')) return 920 - penalty;
    if (text.startsWith(query)) return 900 - penalty;
    if ((' ' + text + ' ').includes(' ' + query + ' ')) return 870 - penalty;
    if (text.includes(query)) return 825 - penalty;
    var words = text.split(' ');
    var direct = tokenScore(words, queryTokens, false);
    if (direct >= 0) return 720 + direct / 8 - penalty;
    var approximate = tokenScore(words, queryTokens, true);
    return approximate >= 0 ? 510 + approximate / 8 - penalty : -1;
  }

  function comparePlaces(a, b) {
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  }

  function searchPlaces(query, park, type) {
    var pool = searchIndex.filter(function (entry) {
      var place = entry.place;
      return (park === 'all' || place.park === park) &&
        (type === 'all' || place.type === type);
    });
    if (!query) {
      return { matches: pool.map(function (entry) { return entry.place; }), label: 'A–Z' };
    }

    var tokens = query.split(' ');
    var candidates = pool.map(function (entry) {
      var bestName = phraseScore(entry.name, query, tokens, 0);
      entry.aliases.forEach(function (alias) {
        bestName = Math.max(bestName, phraseScore(alias, query, tokens, 3));
      });
      return {
        place: entry.place,
        nameScore: bestName,
        areaScore: phraseScore(entry.area, query, tokens, 0)
      };
    });

    // If a precise place/alias is found, it wins over everything else.
    // E.g. "downtown disney" matches that exact alias for the District,
    // not every restaurant whose area happens to be Downtown Disney.
    var exact = candidates.filter(function (item) { return item.nameScore >= 990; });
    var matches;
    var label = 'Best matches';
    if (exact.length) {
      matches = exact;
    } else {
      var strongest = Math.max(-1, ...candidates.map(function (item) { return item.nameScore; }));
      if (strongest >= 700) {
        matches = candidates.filter(function (item) { return item.nameScore >= 700; });
      } else if (strongest >= 500) {
        matches = candidates.filter(function (item) { return item.nameScore >= 500; });
        label = 'Closest matches';
      } else {
        // Area is a fallback, not equal in relevance to a place name.
        matches = candidates.filter(function (item) { return item.areaScore >= 0; });
        matches.forEach(function (item) { item.nameScore = item.areaScore; });
        label = 'In this area';
      }
    }
    matches.sort(function (a, b) {
      return b.nameScore - a.nameScore || comparePlaces(a.place, b.place);
    });
    if (!matches.length) label = 'No matches';
    return { matches: matches.map(function (item) { return item.place; }), label: label };
  }

  function closePanel() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  function showPlace(place) {
    closePanel();
    if (marker) map.removeLayer(marker);
    marker = L.circleMarker([place.lat, place.lon], {
      radius: 9, weight: 3, color: '#fff', fillColor: '#0c7780',
      fillOpacity: 1, interactive: false
    }).addTo(map);
    marker.bindTooltip(place.name, {
      direction: 'top', permanent: false, opacity: 1,
      className: 'place-search-label', offset: [0, -10]
    }).openTooltip();
    map.flyTo([place.lat, place.lon], 19.05, { duration: 0.65 });
  }

  // Remove the selected place's marker and label on the next tap.
  document.addEventListener('pointerdown', function (event) {
    if (marker && !panel.contains(event.target)) {
      map.removeLayer(marker);
	  marker = null;
    }
  }, true);

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
    var ranked = searchPlaces(search, park, type);
    var matched = ranked.matches;
    results.replaceChildren();
    var frag = document.createDocumentFragment();
    if (!matched.length) {
      var empty = document.createElement('p');
      empty.className = 'place-search-empty';
      empty.textContent = 'No close matches found. Try a different name or spelling.';
      frag.appendChild(empty);
    } else {
      matched.forEach(function (place) { frag.appendChild(makeResult(place)); });
    }
    results.appendChild(frag);
    counter.textContent = matched.length + (matched.length === 1 ? ' place' : ' places') + ' · ' + ranked.label;
  }

  function buildControl() {
    var PlaceControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function () {
        var root = L.DomUtil.create('div', 'leaflet-control-place-search');
        trigger = L.DomUtil.create('button', 'place-search-trigger', root);
        trigger.type = 'button';
        trigger.textContent = '⌕  Find Places  ▾';
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
   
		var inputWrap = L.DomUtil.create('div', 'place-search-input-wrap', panel);

		input = L.DomUtil.create('input', 'place-search-input', inputWrap);
		input.type = 'search';
		input.placeholder = 'Search rides, shops, landmarks…';
		input.setAttribute('aria-label', 'Place name');
		input.autocomplete = 'off';

		var clearSearch = L.DomUtil.create('button', 'place-search-clear', inputWrap);
		clearSearch.type = 'button';
		clearSearch.textContent = '×';
		clearSearch.setAttribute('aria-label', 'Clear search text');
		clearSearch.hidden = true;

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
          }
        });
        close.addEventListener('click', function () {
          closePanel();
          trigger.focus();
        });
        input.addEventListener('input', function () {
		  clearSearch.hidden = !input.value.length;
		  render();
		});

		clearSearch.addEventListener('click', function () {
		  input.value = '';
		  clearSearch.hidden = true;
		  render();
		  input.focus({ preventScroll: true });
		});
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
      }).sort(comparePlaces);
      searchIndex = places.map(function (place) {
        return {
          place: place,
          name: normalize(place.name),
          aliases: (place.aliases || []).map(normalize),
          area: normalize(place.area)
        };
      });
      render();
    })
    .catch(function () {
      counter.textContent = 'Search directory unavailable';
      results.textContent = 'Try reloading when online, then reopen the app for offline use.';
    });
})();
