"""Build an exact list of EXISTING trimmed tiles for the offline download UI.

Run in the Disneyland app repository root:
    py build_tile_index.py

Does not modify or download map tiles.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TILES = ROOT / 'tiles'


def main():
    files = []
    size = 0
    for path in TILES.glob('*/*/*.jpg'):
        relative = path.relative_to(ROOT)
        try:
            z, x, filename = relative.parts[1:]
            y = Path(filename).stem
            numbers = (int(z), int(x), int(y))
        except (ValueError, IndexError):
            continue
        if not 16 <= numbers[0] <= 20:
            continue
        files.append((numbers, relative.as_posix()))
        size += path.stat().st_size

    files.sort(key=lambda item: item[0])
    paths = [item[1] for item in files]
    if not paths:
        raise SystemExit('No map tiles found. Run this script from the repository root.')

    target = ROOT / 'tile-index.json'
    target.write_text(json.dumps({
        'version': 1,
        'count': len(paths),
        'bytes': size,
        'files': paths
    }, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
    print(f'Indexed {len(paths):,} actual tiles ({size / 1048576:.1f} MiB).')
    print(f'Created {target}; add it to GitHub along with the PWA files.')


if __name__ == '__main__':
    main()
