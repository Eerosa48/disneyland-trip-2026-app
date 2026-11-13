#!/usr/bin/env python3
"""Refactor Greyson's Disney app to share one live wait-time feed.

Put this script in the repository root and run:
    py apply_shared_wait_feed.py           # preview only
    py apply_shared_wait_feed.py --apply   # write local changes

It does not contact GitHub or modify any files besides wait-times.js,
toolbar-ui.js and sw.js. It verifies every expected original code block
before writing any file.
"""
from __future__ import annotations

import argparse
import difflib
import re
from pathlib import Path


def once(text: str, original: str, replacement: str, where: str) -> str:
    count = text.count(original)
    if count != 1:
        raise RuntimeError(f"{where}: expected 1 occurrence, found {count}. Nothing was changed.")
    return text.replace(original, replacement, 1)


def between(text: str, first: str, last: str, replacement: str, where: str) -> str:
    if text.count(first) != 1 or text.count(last) != 1:
        raise RuntimeError(f"{where}: section boundaries not found exactly once. Nothing was changed.")
    start = text.index(first)
    end = text.index(last, start)
    return text[:start] + replacement + text[end:]


def change_wait_times(text: str) -> str:
    if 'window.greysonWaitFeed' in text:
        raise RuntimeError('wait-times.js already appears to contain the shared wait feed.')

    text = once(text,
        '  var heading, note, places = [], latest = {}, lastCheck = 0;\n'
        '  var pending = false, errors = 0;\n',
        '''  var heading, note, places = [], latest = {}, lastCheck = 0;
  var pending = false, errors = 0;
  var waitItems = [], placesReady = false;
  var subscribers = [];

  function snapshot() {
    return {
      items: waitItems,
      lastCheck: lastCheck,
      pending: pending,
      errors: errors
    };
  }

  function notifySubscribers() {
    var state = snapshot();
    subscribers.slice().forEach(function (callback) {
      try { callback(state); }
      catch (error) { console.warn('Greyson wait subscriber:', error); }
    });
  }

  // Shared source of live wait data for the map and toolbar.
  window.greysonWaitFeed = {
    subscribe: function (callback) {
      if (typeof callback !== 'function') {
        throw new TypeError('Wait-time subscriber must be a function');
      }
      subscribers.push(callback);
      callback(snapshot());
      return function () {
        var index = subscribers.indexOf(callback);
        if (index !== -1) subscribers.splice(index, 1);
      };
    },
    refreshIfStale: function () {
      if (!lastCheck || Date.now() - lastCheck >= REFRESH_MS) return refresh();
    }
  };
''', 'wait-times.js: shared state')

    text = once(text,
        '    var matched = 0, missing = [];\n',
        '    var matched = 0, missing = [], items = [];\n',
        'wait-times.js: paint items')

    text = once(text,
        '      var badge = badgeInfo(entry);\n      var icon = L.divIcon({',
        '      var badge = badgeInfo(entry);\n'
        '      items.push({ place: place, badge: badge });\n'
        '      var icon = L.divIcon({',
        'wait-times.js: matched item')

    text = once(text,
        '        .addTo(markers);\n    });\n    if (note) {',
        '''        .addTo(markers);
    });
    waitItems = items.sort(function (a, b) {
      return a.place.name.localeCompare(b.place.name, undefined, { sensitivity: 'base' });
    });
    if (note) {''',
        'wait-times.js: sorted shared list')

    text = once(text,
        '    if (pending || !navigator.onLine) return;\n',
        '    if (pending || !navigator.onLine || !placesReady) return;\n',
        'wait-times.js: do not fetch before places are ready')

    text = once(text,
        '    pending = false;\n    paint();\n  }',
        '    pending = false;\n    paint();\n    notifySubscribers();\n  }',
        'wait-times.js: broadcast completed refresh')

    text = once(text,
        '''  window.addEventListener('offline', function () {
    latest = {};
    markers.clearLayers();
    updateVisibility();
  });''',
        '''  window.addEventListener('offline', function () {
    latest = {};
    waitItems = [];
    markers.clearLayers();
    updateVisibility();
    notifySubscribers();
  });''',
        'wait-times.js: broadcast offline state')

    text = once(text,
        '''        return place.type === 'Attraction' && PARK_IDS[place.park] &&
          Number.isFinite(place.lat) && Number.isFinite(place.lon);
      });
      return refresh();''',
        '''        return place.type === 'Attraction' && PARK_IDS[place.park] &&
          Number.isFinite(place.lat) && Number.isFinite(place.lon);
      });
      placesReady = true;
      return refresh();''',
        'wait-times.js: mark places ready')

    text = once(text,
        '''      if (note) note.textContent = 'Attraction directory unavailable';
      updateVisibility();
      console.warn('Greyson Wait Times:', error);''',
        '''      if (note) note.textContent = 'Attraction directory unavailable';
      updateVisibility();
      notifySubscribers();
      console.warn('Greyson Wait Times:', error);''',
        'wait-times.js: broadcast directory error')

    return text


def change_toolbar(text: str) -> str:
    if 'window.greysonWaitFeed' in text:
        raise RuntimeError('toolbar-ui.js already appears to use the shared wait feed.')

    text = between(text, '  var PARK_IDS = {',
                   "  var waitFocusPane = map.getPane('greyson-wait-focus-pane') ||",
        '''  // Reuse the map's already-fetched and normalized live wait information.
  var waitFeed = window.greysonWaitFeed;
  var waitData = [];
  var waitChecked = 0;
  var waitErrors = 0;
  var waitPending = false;

  if (!waitFeed) {
    console.warn('Greyson toolbar: shared wait-time feed was not initialized.');
  }

''', 'toolbar-ui.js: remove duplicate feed, directory and formatting')

    text = once(text,
        '''    if (!waitData) {
      waitStatus.textContent = 'Loading live wait times…';
      return;
    }
    if (!waitData.length) {
      waitStatus.textContent = 'No live attraction reports are available right now.';
      return;
    }''',
        '''    if (!waitChecked || (waitPending && !waitData.length)) {
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
    }''',
        'toolbar-ui.js: loading and unavailable conditions')

    text = once(text,
        "    waitStatus.textContent = waitData.length + ' attractions · Updated ' + updated;",
        "    waitStatus.textContent = waitData.length + ' attractions · Updated ' + updated +\n"
        "      (waitErrors ? ' · Partial feed' : '');",
        'toolbar-ui.js: partial feed status')

    text = once(text,
        "      status.className = 'greyson-wait-list-status is-' + item.badge.kind;\n"
        "      status.textContent = item.badge.text;",
        "      status.className = 'greyson-wait-list-status is-' + item.badge.style;\n"
        "      status.textContent = item.badge.label.replace(/(\\d+)m$/, '$1 min');",
        'toolbar-ui.js: use shared badges')

    text = between(text,
        '  async function loadWaits() {',
        '  function closeDayMenu() {',
        '''  function loadWaits() {
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

''', 'toolbar-ui.js: replace independent network requests with subscription')

    text = once(text,
        '''  window.addEventListener('offline', function () {
    waitData = null;
    if (!waitPanel.hidden) renderWaits();
  });''',
        '''  window.addEventListener('offline', function () {
    if (!waitPanel.hidden) renderWaits();
  });''',
        'toolbar-ui.js: preserve shared state across offline events')

    return text


def change_sw(text: str) -> str:
    pattern = r"(?m)^const SHELL_CACHE = 'greyson-disney-shell-(\d+)';$"
    found = list(re.finditer(pattern, text))
    if len(found) != 1:
        raise RuntimeError('sw.js: could not locate exactly one shell-cache version.')
    current = int(found[0].group(1))
    return re.sub(pattern, f"const SHELL_CACHE = 'greyson-disney-shell-{current + 1}';", text)


def read_exact(path: Path) -> tuple[str, str, bool]:
    data = path.read_bytes()
    bom = data.startswith(b'\xef\xbb\xbf')
    text = data.decode('utf-8-sig' if bom else 'utf-8')
    eol = '\r\n' if '\r\n' in text else '\n'
    return text.replace('\r\n', '\n'), eol, bom


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Write changes after validation')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    transforms = {
        'wait-times.js': change_wait_times,
        'toolbar-ui.js': change_toolbar,
        'sw.js': change_sw,
    }
    proposed = {}
    for name, change in transforms.items():
        path = root / name
        if not path.is_file():
            raise SystemExit(f'Missing {name}. Put this script in the project root.')
        old, eol, bom = read_exact(path)
        try:
            new = change(old)
        except RuntimeError as error:
            raise SystemExit(str(error)) from error
        proposed[path] = (old, new, eol, bom)

    for path, (old, new, _, _) in proposed.items():
        print(f'\n=== {path.name} ===')
        print(''.join(difflib.unified_diff(old.splitlines(keepends=True),
                                           new.splitlines(keepends=True),
                                           fromfile='before/' + path.name,
                                           tofile='after/' + path.name)))

    if not args.apply:
        print('\nPREVIEW ONLY: no files changed. Run again with --apply when ready.')
        return

    for path, (_, new, eol, bom) in proposed.items():
        output = new.replace('\n', eol).encode('utf-8')
        path.write_bytes((b'\xef\xbb\xbf' if bom else b'') + output)
        print('Updated:', path.name)
    print('Done. Changes are local only; nothing was pushed to GitHub.')


if __name__ == '__main__':
    main()
