DISNEYLAND OFFLINE MAP — STARTER KIT
====================================

This is a locally runnable viewer and authorized map-tile downloader, based on
your November 11, 2026 browser inspection. The ZIP does NOT contain Disney's
artwork; the tile downloader fetches the original tile data directly on your
Windows PC. Only download imagery you are authorized to retain.

1. Unzip this project somewhere permanent, such as your Documents folder.
2. Open PowerShell in the unzipped folder.
3. Run: py setup_map.py --max-zoom 16
   This obtains the Leaflet viewer assets and only the 30 tiles at zoom 16.
4. Run: py -m http.server 8000
5. Open http://localhost:8000/ in Chrome or Edge.
6. Confirm the image displays, including artwork and embedded labels.
7. Stop the server with Ctrl+C.
8. Later run: py setup_map.py --max-zoom 20
   This completes all five levels (16, 17, 18, 19, 20).
9. Restart the server, revisit http://localhost:8000/, and disconnect
   internet to verify the map still works offline.

The local Python server does not require internet access after downloads.
All JavaScript, CSS, map tiles, and map controls are kept in this folder.
Do not double-click index.html until setup has been completed.

OBSERVED ORIGINAL MAP PARAMETERS
  Map revision: 764741755
  Tile naming: /{revision}/{z}/{x}/{y}.jpg
  Image size: 512 x 512 physical pixels
  Displayed tile size: 256 x 256 CSS pixels
  Zoom levels used: 16 through 20
  z=16 coverage: x=11298..11303, y=26218..26222
  30 tile positions at z16; up to 10,230 over five zoom levels
  The full rectangle may include areas outside the parks, and the CDN may
  return some missing/blank tiles. Missing tiles will appear empty locally.

FILE STRUCTURE AFTER SETUP
  index.html
  setup_map.py
  vendor/leaflet.js
  vendor/leaflet.css
  vendor/images/... 
  tiles/16/<x>/<y>.jpg
  tiles/17/<x>/<y>.jpg
  ...
  tiles/20/<x>/<y>.jpg

IMPORTANT
  The browser may display WebP/AVIF images even when URLs end in .jpg.
  The downloader preserves the original image bytes without re-encoding.
  Internet access is used only during setup/download and is not required to
  view the completed map locally.
  Future route toggles are deliberately NOT included yet.
