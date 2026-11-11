"""Download dependencies and authorized Disneyland map tiles for local offline use.

Usage (Windows PowerShell):
  py setup_map.py --max-zoom 16  # Small proof-of-concept (30 tiles)
  py setup_map.py --max-zoom 20  # Full five zoom levels (10,230 tiles)

Run from the folder containing this file. Existing files are reused/resumable.
"""
import argparse
import pathlib
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
REVISION = '764741755'
CDN = f'https://cdn6.parksmedia.wdprapps.disney.com/media/maps/prod/disneyland/{REVISION}'
BASE_Z = 16
MIN_X, MAX_X = 11299, 11302
MIN_Y, MAX_Y = 26219, 26222
LIBRARY = 'https://unpkg.com/leaflet@1.9.4/dist/'
DEPENDENCIES = {
    'vendor/leaflet.js': LIBRARY + 'leaflet.js',
    'vendor/leaflet.css': LIBRARY + 'leaflet.css',
    # For future map controls/markers, include these offline too.
    'vendor/images/layers.png': LIBRARY + 'images/layers.png',
    'vendor/images/layers-2x.png': LIBRARY + 'images/layers-2x.png',
    'vendor/images/marker-icon.png': LIBRARY + 'images/marker-icon.png',
    'vendor/images/marker-icon-2x.png': LIBRARY + 'images/marker-icon-2x.png',
    'vendor/images/marker-shadow.png': LIBRARY + 'images/marker-shadow.png',
}


def download(url, target, *, image=False, retries=3):
    if target.exists() and target.stat().st_size > 0:
        return 'existing'
    target.parent.mkdir(parents=True, exist_ok=True)
    headers = {
        'User-Agent': 'Mozilla/5.0 (compatible; AuthorizedOfflineMap/1.0)',
        'Accept': 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8' if image else '*/*',
    }
    for attempt in range(1, retries+1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=25) as response:
                data = response.read()
                mime = response.headers.get('Content-Type', '').split(';')[0].lower()
            if not data:
                raise ValueError('Empty response')
            if image and not mime.startswith('image/'):
                raise ValueError(f'Unexpected tile content-type: {mime}')
            part = target.with_name(target.name + '.part')
            part.write_bytes(data)
            part.replace(target)
            return 'downloaded'
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 404):
                return f'HTTP {exc.code}'
            msg = f'HTTP {exc.code}'
        except (urllib.error.URLError, OSError, ValueError) as exc:
            msg = str(exc)
        if attempt < retries:
            time.sleep(attempt * 1.5)
    return f'ERROR {msg}'


def coordinates(z):
    factor = 1 << (z - BASE_Z)
    for x in range(MIN_X * factor, (MAX_X+1)*factor):
        for y in range(MIN_Y * factor, (MAX_Y+1)*factor):
            yield x, y


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--max-zoom', type=int, default=16, choices=range(16,21),
                        metavar='16..20', help='Highest zoom to download, default 16')
    parser.add_argument('--delay', type=float, default=0.12,
                        help='Seconds between tile requests (default 0.12; increase if requested)')
    args = parser.parse_args()
    print('Preparing local Leaflet library...')
    for relative, url in DEPENDENCIES.items():
        state = download(url, ROOT / relative)
        print(f'  {relative}: {state}')
        if state.startswith('ERROR') or state.startswith('HTTP'):
            print('  Could not download a required Leaflet file. Check your connection and rerun.')
            return 1
    total = sum(
        (MAX_X - MIN_X + 1) *
        (MAX_Y - MIN_Y + 1) *
        4 ** (z - BASE_Z)
        for z in range(BASE_Z, args.max_zoom + 1)
    )
    print(f'Preparing {total:,} map tiles, zoom levels 16–{args.max_zoom}.')
    print('Already-downloaded tiles will be skipped. Ctrl+C safely stops; rerun to resume.')
    attempted, problems = 0, 0
    try:
        for z in range(BASE_Z, args.max_zoom + 1):
            z_done, z_missing = 0, 0
            for x, y in coordinates(z):
                target = ROOT / 'tiles' / str(z) / str(x) / f'{y}.jpg'
                state = download(f'{CDN}/{z}/{x}/{y}.jpg', target, image=True)
                if state != 'existing':
                    time.sleep(args.delay)
                attempted += 1
                z_done += 1
                if state.startswith('HTTP') or state.startswith('ERROR'):
                    problems += 1
                    z_missing += 1
                    if z_missing <= 8:
                        print(f'  z={z}, x={x}, y={y}: {state}')
                if attempted % 200 == 0:
                    print(f'Progress: {attempted:,}/{total:,} checked; missing/errors so far: {problems:,}')
            print(f'Zoom {z} completed: {z_done:,} checked; {z_missing:,} missing/errors.')
    except KeyboardInterrupt:
        print('\nStopped safely. Rerun the same command to resume.')
        return 130
    print(f'Finished: {attempted:,} positions checked, {problems:,} missing or failed.')
    print('Now run: py -m http.server 8000')
    print('Then open: http://localhost:8000/')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
