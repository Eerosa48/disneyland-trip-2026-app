#!/usr/bin/env python3
"""Preview/apply a minimal orientation-centering fix for Greyson's Disney Trip.

Only index.html and sw.js are changed. Requires repository shell 54 baseline.
The default mode is read-only; --apply makes the two validated replacements.
"""
from pathlib import Path
import argparse
import difflib
import sys

ROOT = Path(__file__).resolve().parent
FILES = {
    'index.html': (
        b'map.invalidateSize({ pan: false });',
        b'map.invalidateSize({ pan: true, animate: false });',
    ),
    'sw.js': (
        b"const SHELL_CACHE = 'greyson-disney-shell-54';",
        b"const SHELL_CACHE = 'greyson-disney-shell-55';",
    ),
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Write the reviewed changes')
    args = parser.parse_args()
    updates = {}

    print('Orientation centering fix: shell 54 -> 55')
    print('Preserve geographic center during portrait/landscape resizing.\n')
    for name, (old, new) in FILES.items():
        path = ROOT / name
        if not path.is_file():
            print(f'ERROR: {name} not found next to this script.', file=sys.stderr)
            return 1
        before = path.read_bytes()
        count = before.count(old)
        if count != 1:
            status = 'already updated' if before.count(new) == 1 else 'unexpected source content'
            print(f'ERROR: {name}: expected exactly one old line, found {count} ({status}).', file=sys.stderr)
            print('No files changed. Do not rerun --apply; review your repo state.', file=sys.stderr)
            return 1
        after = before.replace(old, new, 1)
        updates[name] = (path, before, after)

    for name, (_, before, after) in updates.items():
        print(f'=== {name} ===')
        delta = difflib.unified_diff(
            before.decode('utf-8').splitlines(keepends=True),
            after.decode('utf-8').splitlines(keepends=True),
            fromfile='before/' + name, tofile='after/' + name,
        )
        print(''.join(delta), end='\n')

    if not args.apply:
        print('PREVIEW ONLY: no files changed. Run with --apply after review.')
        return 0

    for name, (path, _, after) in updates.items():
        path.write_bytes(after)
        print('Updated:', name)
    print('Done. Shell 55 prepared locally; nothing was pushed to GitHub.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
