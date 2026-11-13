"""Review-only installer for Greyson's three-icon toolbar.
Run in the local disneyland-trip-2026-app folder after copying toolbar-ui.js/.css.
Only edits index.html and sw.js; stores backups outside the repository.
No GitHub commits/pushes and no tile-cache changes.
"""
from pathlib import Path
import re
import shutil
import sys

ROOT = Path.cwd()
INDEX = ROOT / "index.html"
SW = ROOT / "sw.js"
FILES = [ROOT / "toolbar-ui.js", ROOT / "toolbar-ui.css"]
for file in [INDEX, SW, *FILES]:
    if not file.exists():
        sys.exit(f"Missing {file.name}. Place all toolbar files in the app folder and run here.")

index = INDEX.read_text(encoding="utf-8-sig")
sw = SW.read_text(encoding="utf-8-sig")

if "toolbar-ui.js" in index or "toolbar-ui.css" in index or "'./toolbar-ui.js'" in sw:
    sys.exit("Toolbar files are already referenced. No changes made.")


def replace_once(text, pattern, repl, explanation, flags=0):
    found = list(re.finditer(pattern, text, flags))
    if len(found) != 1:
        sys.exit(f"Expected one match for {explanation}, found {len(found)}. No files changed.")
    return re.sub(pattern, repl, text, count=1, flags=flags)

# Add the new style last, ensuring its layout overrides only override old UI controls.
index = replace_once(index,
    r'(<link\s+rel="stylesheet"\s+href="itinerary-ui\.css"\s*/>)',
    r'\1\n  <link rel="stylesheet" href="toolbar-ui.css" />',
    'itinerary-ui.css link')

# Existing modules must initialize before the toolbar moves Search into a page-level panel.
index = replace_once(index,
    r'(<script\s+src="offline-ui\.js"\s*>\s*</script>)',
    r'\1\n<script src="toolbar-ui.js"></script>',
    'offline-ui.js script')

# Remove the previous Locations control completely (do not relocate it).
index = replace_once(index,
    r'[ \t]*// Dropdown replaces the old recenter-only control\.\s*'
    r'const FocusControl = L\.Control\.extend\(\{.*?'
    r'map\.addControl\(new FocusControl\(\)\);[ \t]*',
    '\n    // The Locations control has been retired; toolbar tools are Search, Itinerary, Wait Times.\n',
    'Locations control block', flags=re.S)

# Choose a useful resort-wide first view. Session restoration remains untouched.
for key, zoom in [('initialMobile', '15.35'), ('initialDesktop', '15.70')]:
    pattern = r'(' + key + r'\s*:\s*\{\s*center\s*:\s*)\[[^\]]+\](\s*,\s*zoom\s*:\s*)[0-9]+(?:\.[0-9]+)?'
    index = replace_once(index, pattern,
        lambda match: match.group(1) + '[33.81078, -117.92184]' + match.group(2) + zoom,
        key + ' camera')

# Ensure shell caches new toolbar scripts and styles. Tile cache name must not change.
sw = replace_once(sw,
    r"(const SHELL_CACHE\s*=\s*'greyson-disney-shell-)(\d+)(';)",
    lambda match: match.group(1) + str(int(match.group(2)) + 1) + match.group(3),
    'shell cache version')
sw = replace_once(sw,
    r"('./offline-ui\.js',)",
    r"\1 './toolbar-ui.js', './toolbar-ui.css',",
    'offline-ui.js shell entry')

backup_dir = ROOT.parent / (ROOT.name + '_before_toolbar')
if backup_dir.exists():
    sys.exit(f'Backup folder already exists: {backup_dir}. No files changed.')
backup_dir.mkdir()
for original in (INDEX, SW):
    shutil.copy2(original, backup_dir / original.name)
INDEX.write_text(index, encoding='utf-8', newline='\n')
SW.write_text(sw, encoding='utf-8', newline='\n')
print('Toolbar installed locally. No GitHub changes made.')
print(f'Original index.html and sw.js backups saved outside the repository: {backup_dir}')
print('Check desktop and iPhone behavior before committing or pushing.')
