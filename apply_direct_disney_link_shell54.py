#!/usr/bin/env python3
"""Preview/apply Disney's verified link in Greyson's Disney Trip (shell 53 -> 54).

Run from the repository root:
  py apply_direct_disney_link_shell54.py
  py apply_direct_disney_link_shell54.py --apply

Edits exactly toolbar-ui.js and sw.js, preserving existing line endings.
"""
from pathlib import Path
from difflib import unified_diff
import argparse

OLD_LAUNCH = '''  var appleDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // A named Apple Shortcut, with one Open App -> Disneyland action, must be
  // installed on each iPhone. Keep navigation as a direct user-tapped link.
  disneyLaunch.href = appleDevice
    ? 'shortcuts://run-shortcut?name=Open%20Disneyland'
    : 'https://disneyland.disney.go.com/';'''

NEW_LAUNCH = '''  // Disney's official app link launches the installed app where iOS permits;
  // otherwise Disney controls the web/App Store fallback. No Shortcuts setup.
  disneyLaunch.href = 'https://disneyland.app.link/DisneylandApp';'''

OLD_SHELL = "const SHELL_CACHE = 'greyson-disney-shell-53';"
NEW_SHELL = "const SHELL_CACHE = 'greyson-disney-shell-54';"


def patch(path: Path, old: str, new: str):
    if not path.is_file():
        raise SystemExit(f'ERROR: {path} not found. Run from the project folder.')
    raw = path.read_bytes()
    newline = b'\r\n' if b'\r\n' in raw else b'\n'
    needle = old.encode('utf-8').replace(b'\n', newline)
    replacement = new.encode('utf-8').replace(b'\n', newline)
    occurrences = raw.count(needle)
    if occurrences != 1:
        raise SystemExit(f'ERROR: expected one shell-53 marker in {path}, found {occurrences}; no files changed.')
    output = raw.replace(needle, replacement, 1)
    # Diff text only for preview; actual writes preserve byte-for-byte contents
    # outside the replaced region.
    before = raw.decode('utf-8').splitlines(keepends=True)
    after = output.decode('utf-8').splitlines(keepends=True)
    diff = ''.join(unified_diff(before, after,
                                fromfile=f'before/{path}', tofile=f'after/{path}'))
    return output, diff


def main():
    arg = argparse.ArgumentParser(description=__doc__)
    arg.add_argument('--apply', action='store_true', help='write the verified updates')
    args = arg.parse_args()

    replacements = [
        (Path('toolbar-ui.js'), OLD_LAUNCH, NEW_LAUNCH),
        (Path('sw.js'), OLD_SHELL, NEW_SHELL),
    ]
    plans = []
    # Validate both files before modifying either one.
    for path, old, new in replacements:
        output, diff = patch(path, old, new)
        plans.append((path, output, diff))
    print('Shell 53 -> 54: replace Shortcuts launcher with Disney direct app link.\n')
    for path, _output, diff in plans:
        print(f'=== {path} ===')
        print(diff)

    if not args.apply:
        print('PREVIEW ONLY: nothing changed. Run with --apply after review.')
        return

    for path, output, _diff in plans:
        path.write_bytes(output)
        print(f'Updated: {path}')
    print('Done. Only toolbar-ui.js and sw.js changed. Nothing pushed to GitHub.')


if __name__ == '__main__':
    main()
