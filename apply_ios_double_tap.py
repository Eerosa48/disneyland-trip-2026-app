"""Preview/apply an isolated iOS two-tap zoom handler to Greyson's Disney app.

Put this script and ios-double-tap.js beside index.html, sw.js, and vendor/.
Usage: py apply_ios_double_tap.py [--apply]
"""
from __future__ import annotations

import argparse
import difflib
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
# The script is designed to be moved into the app's root directory.
JS = "ios-double-tap.js"
HTML = "index.html"
SW = "sw.js"
SCRIPT_TAG = '<script src="ios-double-tap.js"></script>'
ANCHOR = '<script src="places-ui.js"></script>'
SHELL_OLD = "const SHELL_CACHE = 'greyson-disney-shell-49';"
SHELL_NEW = "const SHELL_CACHE = 'greyson-disney-shell-50';"
SW_ANCHOR = "  './vendor/leaflet-double-touch-drag-zoom.js',"


def fail(message: str) -> None:
    raise RuntimeError(message)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Actually write files')
    args = parser.parse_args()

    for name in (HTML, SW, JS):
        if not (ROOT / name).is_file():
            fail(f'Missing {name}. Put BOTH downloaded files in the app root (beside index.html).')

    source = {name: (ROOT / name).read_text(encoding='utf-8') for name in (HTML, SW, JS)}
    if SCRIPT_TAG in source[HTML] or "'./ios-double-tap.js'" in source[SW]:
        fail('The iOS double-tap fix already appears to be installed; refusing to apply twice.')
    if source[HTML].count(ANCHOR) != 1 or source[SW].count(SW_ANCHOR) != 1:
        fail('Expected HTML/service-worker insertion point not found exactly once; no files changed.')
    if source[SW].count(SHELL_OLD) != 1:
        fail('Expected shell 49 in sw.js. No files changed; check current cache version.')
    if 'var TAP_MS = 300;' not in source[JS] or 'map.doubleClickZoom.disable();' not in source[JS]:
        fail('iOS handler file differs from expected version; refusing to install.')
    if not source[HTML].find('<script src="vendor/leaflet-double-touch-drag-zoom.js"></script>') < source[HTML].find(ANCHOR):
        fail('Unexpected plugin script order in index.html.')
    if source[HTML].count('const map = L.map(') != 1:
        fail('Expected exactly one Leaflet map initialization; no files changed.')

    revised = {
        HTML: source[HTML].replace(ANCHOR, SCRIPT_TAG + '\n' + ANCHOR, 1),
        SW: source[SW].replace(SW_ANCHOR, SW_ANCHOR + "\n  './ios-double-tap.js',", 1).replace(SHELL_OLD, SHELL_NEW, 1),
    }
    for name in (HTML, SW):
        print(f'\n=== {name} ===')
        print(''.join(difflib.unified_diff(
            source[name].splitlines(keepends=True), revised[name].splitlines(keepends=True),
            fromfile=f'before/{name}', tofile=f'after/{name}'
        )), end='')
    print(f'\n=== {JS} ===')
    print(f'New JavaScript file: {len(source[JS].splitlines())} lines (left intact).')

    if args.apply:
        for name in (HTML, SW):
            (ROOT / name).write_text(revised[name], encoding='utf-8', newline='\n')
            print(f'Updated: {name}')
        print(f'Installed: {JS} (existing file, unchanged)')
        print('Done. Only local files changed. Shell is now 50; nothing pushed to GitHub.')
    else:
        print('\nPREVIEW ONLY: no files changed. Run with --apply when ready.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
