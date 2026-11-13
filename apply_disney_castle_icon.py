#!/usr/bin/env python3
"""Preview / install the castle+firework toolbar icon for shell 52 -> 53.

Put this script and disney-castle-toolbar.png in the project root.
Run `py apply_disney_castle_icon.py` to preview, then `py apply_disney_castle_icon.py --apply`.
"""
from pathlib import Path
import argparse
import difflib
import re
import sys

ROOT = Path(__file__).resolve().parent
ICON = ROOT / 'disney-castle-toolbar.png'
ICON_DEST = ROOT / 'icons' / 'disney-castle-toolbar.png'


def load(path):
    raw = (ROOT / path).read_bytes()
    newline = '\r\n' if b'\r\n' in raw else '\n'
    text = raw.decode('utf-8').replace('\r\n', '\n')
    return text, newline


def encode(text, newline):
    return text.replace('\r\n', '\n').replace('\n', newline).encode('utf-8')


def one_replace(text, old, new, where):
    if text.count(old) != 1:
        raise RuntimeError(f'{where}: expected exactly one match; found {text.count(old)}. No files changed.')
    return text.replace(old, new, 1)


def transform_js(text):
    if text.count('  disneyLaunch.innerHTML =') != 1 or text.count('  bar.appendChild(disneyLaunch);') != 1:
        raise RuntimeError('toolbar-ui.js: Disneyland shortcut structure not found. No files changed.')
    start = text.index('  disneyLaunch.innerHTML =')
    end = text.index('  bar.appendChild(disneyLaunch);', start)
    old = text[start:end]
    if 'greyson-toolbar-external-text' not in old or ('<svg' not in old and 'greyson-toolbar-castle' not in old):
        raise RuntimeError('toolbar-ui.js: unexpected Disneyland button markup. No files changed.')
    new = (
        '  disneyLaunch.innerHTML =\n'
        '    \'<img class="greyson-toolbar-castle" src="icons/disney-castle-toolbar.png" alt="" aria-hidden="true">\' +\n'
        '    \'<span class="greyson-toolbar-external-text">Disney</span>\';\n'
    )
    return text[:start] + new + text[end:]


def transform_css(text):
    # Only changes the new external button's icon size/style. Original 3 controls untouched.
    pattern = re.compile(
        r'#greyson-toolbar \.greyson-toolbar-external svg \{\n'
        r'(?:[^{}]*\n)*?\}'
    )
    match = pattern.search(text)
    if not match:
        raise RuntimeError('toolbar-ui.css: external SVG style block not found. No files changed.')
    replacement = (
        '#greyson-toolbar .greyson-toolbar-castle {\n'
        '  display: block;\n'
        '  width: 26px;\n'
        '  height: 26px;\n'
        '  flex: 0 0 26px;\n'
        '  object-fit: contain;\n'
        '}\n'
    )
    out = text[:match.start()] + replacement.rstrip('\n') + text[match.end():]
    return out.rstrip('\n') + '\n'


def transform_sw(text):
    text = one_replace(
        text,
        "const SHELL_CACHE = 'greyson-disney-shell-52';",
        "const SHELL_CACHE = 'greyson-disney-shell-53';",
        'sw.js shell version'
    )
    text = one_replace(
        text,
        "'./icons/apple-touch-icon.png', './wait-times.js',",
        "'./icons/apple-touch-icon.png', './icons/disney-castle-toolbar.png', './wait-times.js',",
        'sw.js icon precache'
    )
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Write changes after preview')
    args = parser.parse_args()
    if not ICON.is_file():
        raise SystemExit('ERROR: Put disney-castle-toolbar.png next to this script in the project root.')
    if ICON.read_bytes()[:8] != b'\x89PNG\r\n\x1a\n':
        raise SystemExit('ERROR: Not a valid PNG header.')
    if ICON_DEST.exists():
        raise SystemExit('ERROR: Destination icon already exists. Check whether the change was already applied.')
    transformations = {
        'toolbar-ui.js': transform_js,
        'toolbar-ui.css': transform_css,
        'sw.js': transform_sw,
    }
    ready = {}
    print('PREVIEW: shell 52 -> 53, with the exact provided castle/firework silhouette:')
    for name, transform in transformations.items():
        old, newline = load(name)
        new = transform(old)
        ready[name] = encode(new, newline)
        print(f'\n=== {name} ===')
        diff = difflib.unified_diff(
            old.splitlines(keepends=True), new.splitlines(keepends=True),
            fromfile='before/' + name, tofile='after/' + name
        )
        print(''.join(diff), end='')
    print(f'\nNEW FILE: icons/disney-castle-toolbar.png ({ICON.stat().st_size:,} bytes)')
    if not args.apply:
        print('\nPREVIEW ONLY. No files changed. Run with --apply to install.')
        return
    ICON_DEST.parent.mkdir(parents=True, exist_ok=True)
    for name, data in ready.items():
        (ROOT / name).write_bytes(data)
        print('Updated:', name)
    ICON_DEST.write_bytes(ICON.read_bytes())
    print('Added:', ICON_DEST.relative_to(ROOT))
    print('Done. Shell 53 is ready locally. Nothing pushed to GitHub.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, UnicodeError) as exc:
        print('ERROR:', exc, file=sys.stderr)
        raise SystemExit(1)
