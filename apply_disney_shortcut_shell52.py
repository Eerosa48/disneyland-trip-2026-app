#!/usr/bin/env python3
"""Preview/apply the Greyson Disney app shortcut (shell 51 -> 52).

Run in the Disneyland app root:
    py apply_disney_shortcut_shell52.py          # read-only unified diff
    py apply_disney_shortcut_shell52.py --apply  # write after reviewing diff

Only toolbar-ui.js, toolbar-ui.css, and sw.js are changed.
Does not contact GitHub or modify app data, route JSON or tile caches.
"""

import argparse
import difflib
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent

JS_ANCHOR = "  // Suppress the existing scripts' outside-pointer handlers while a toolbar\n"
JS_INSERT = """  // External Disneyland launch link: intentionally NOT a fourth panel action.
  // Keeping it outside `actions` preserves the three original buttons,
  // their active state, and the panel's glass connector positions.
  var disneyLaunch = document.createElement('a');
  disneyLaunch.className = 'greyson-toolbar-external';
  disneyLaunch.setAttribute('aria-label',
    'Open Disneyland app for dining reservations and Lightning Lane');
  disneyLaunch.title = 'Dining Reservations and Lightning Lane (opens Disneyland)';
  var appleDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // A named Apple Shortcut, with one Open App -> Disneyland action, must be
  // installed on each iPhone. Keep navigation as a direct user-tapped link.
  disneyLaunch.href = appleDevice
    ? 'shortcuts://run-shortcut?name=Open%20Disneyland'
    : 'https://disneyland.disney.go.com/';
  disneyLaunch.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ' +
    'fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3.5 2v7.5M6.5 2v7.5M9.5 2v7.5M3.5 7h6M6.5 9.5V22"/>' +
    '<path d="M18 2 13 11h4l-2 11 7-14h-5z"/>' +
    '</svg>' +
    '<span class="greyson-toolbar-external-text">' +
    '<span>Dining</span><span>+ LL</span></span>';
  bar.appendChild(disneyLaunch);

"""

CSS_APPEND = """

/* Small external-launch shortcut; NOT an expandable toolbar panel.
 * Preserve the three existing buttons and the 72px toolbar height. */
#greyson-toolbar .greyson-toolbar-external {
  box-sizing: border-box;
  position: relative;
  display: flex;
  flex: 0 0 50px;
  width: 50px;
  min-width: 50px;
  height: 50px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: 1px solid rgba(128, 165, 143, .45);
  border-radius: 14px;
  background: rgba(255, 255, 255, .46);
  color: #244b3c;
  text-decoration: none;
  font: 750 10px/1 system-ui, -apple-system, sans-serif;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
#greyson-toolbar .greyson-toolbar-external svg {
  display: block;
  width: 19px;
  height: 19px;
  flex: 0 0 19px;
}
#greyson-toolbar .greyson-toolbar-external-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  white-space: nowrap;
}
#greyson-toolbar .greyson-toolbar-external:active {
  background: rgba(200, 226, 210, .65);
}
#greyson-toolbar .greyson-toolbar-external:focus-visible {
  outline: 2px solid #1765d1;
  outline-offset: 0;
}
/* Preserve breathing room for labels on narrower phones. */
@media (max-width: 390px) {
  #greyson-toolbar .greyson-toolbar-button { gap: 4px; font-size: 11px; }
  #greyson-toolbar .greyson-toolbar-button svg {
    width: 21px;
    height: 21px;
    flex-basis: 21px;
  }
}
@media (max-width: 350px) {
  #greyson-toolbar .greyson-toolbar-button { gap: 2px; font-size: 10px; }
  #greyson-toolbar .greyson-toolbar-button svg {
    width: 17px;
    height: 17px;
    flex-basis: 17px;
  }
}
"""


def transform(path, text):
    if path == 'toolbar-ui.js':
        if text.count(JS_ANCHOR) != 1:
            raise ValueError('toolbar-ui.js anchor missing/duplicated; review newer source first')
        if 'greyson-toolbar-external' in text:
            raise ValueError('toolbar-ui.js already contains an external shortcut; refusing duplicate')
        if text.count('bar.appendChild(button);') != 1 or text.count('positionConnector(active)') < 2:
            raise ValueError('toolbar-ui.js toolbar structure changed; review manually')
        return text.replace(JS_ANCHOR, JS_INSERT + JS_ANCHOR, 1)

    if path == 'toolbar-ui.css':
        required = ['#greyson-toolbar {', '#greyson-toolbar .greyson-toolbar-button {',
                    '#greyson-toolbar .greyson-toolbar-button:last-child::after',
                    'width: min(540px, calc(100vw - 24px));', 'height: 72px;']
        for token in required:
            if token not in text:
                raise ValueError('toolbar-ui.css expected rule missing: ' + token)
        if 'greyson-toolbar-external' in text:
            raise ValueError('toolbar-ui.css already contains external shortcut styles')
        return text.rstrip('\n') + CSS_APPEND + '\n'

    if path == 'sw.js':
        old = "const SHELL_CACHE = 'greyson-disney-shell-51';"
        if text.count(old) != 1:
            raise ValueError('sw.js is not shell 51; review manually before bumping')
        if "const TILE_CACHE = 'greyson-disney-tiles-v1';" not in text:
            raise ValueError('sw.js tile-cache setting changed unexpectedly')
        return text.replace(old, "const SHELL_CACHE = 'greyson-disney-shell-52';", 1)

    raise ValueError('Unexpected file: ' + path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Write changes after preview')
    args = parser.parse_args()
    changed = {}

    for name in ('toolbar-ui.js', 'toolbar-ui.css', 'sw.js'):
        path = ROOT / name
        if not path.is_file():
            sys.exit(f'ERROR: {name} not found. Place this script in your app root.')
        raw = path.read_bytes()
        try:
            original = raw.decode('utf-8')
        except UnicodeDecodeError:
            sys.exit(f'ERROR: {name} is not UTF-8. No files changed.')
        # Transform using LF, restore each file's current line endings for the write.
        ending = '\r\n' if b'\r\n' in raw else '\n'
        logical = original.replace('\r\n', '\n')
        try:
            modified = transform(name, logical)
        except ValueError as e:
            sys.exit(f'ERROR: {e}. No files changed.')
        changed[name] = (path, logical, modified.replace('\n', ending), ending)

    print('PREVIEW OF THE ONLY THREE FILES TO CHANGE:')
    for name, (_, old, updated, ending) in changed.items():
        new = updated.replace('\r\n', '\n')
        print(f'\n=== {name} ===')
        print(''.join(difflib.unified_diff(old.splitlines(True), new.splitlines(True),
            fromfile='before/' + name, tofile='after/' + name)), end='')

    if not args.apply:
        print('\nPREVIEW ONLY: no files changed. Run again with --apply after review.')
        return

    for name, (path, _, new, _) in changed.items():
        path.write_bytes(new.encode('utf-8'))
        print('Updated:', name)
    print("Done. Shell 52 prepared locally; nothing was pushed to GitHub.")


if __name__ == '__main__':
    main()
