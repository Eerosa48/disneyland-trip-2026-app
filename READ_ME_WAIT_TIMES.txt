Greyson's Disney Trip — LIVE WAIT-TIME BUBBLES / REVIEW DRAFT
=============================================================
This package does not alter GitHub or your existing ride coordinates.

New files:
  wait-times.js
  wait-times.css

1. Copy both files into the root of your local Disneyland app repository
   (the same folder as index.html and places.json).

2. In index.html, in <head>, add:
     <link rel="stylesheet" href="wait-times.css" />
   It can go immediately below the places-ui.css link.

3. In index.html, just before </body>, add:
     <script src="wait-times.js"></script>
   Put it immediately after the places-ui.js script tag.

4. OPTIONAL FOR LOCAL TESTING, BUT REQUIRED BEFORE PUSHING THE PWA:
   In sw.js:
   - Change SHELL_CACHE to 'greyson-disney-shell-v3'
   - Add './wait-times.js', './wait-times.css' to the SHELL_FILES list.
   Keep TILE_CACHE unchanged, so existing offline map tiles are not deleted.

5. Launch Windows PowerShell from the repo root:
     py -m http.server 8000
   Open http://localhost:8000 in Chrome, while you have internet.

6. Zoom to at least level 17 in either park. The wait-time bubbles show
   posted standby minutes, or a status if the API gives one.
   Tap a bubble for the ride's name and more information.
   Use the "Wait times" control to turn the bubbles on and off.
   Data refreshes at most every five minutes while the page is visible.

7. After testing, open Chrome DevTools Console and type:
     greysonWaitDebug
   You'll see the count of matched rides and names the external feed did
   not match. Those may be differently named, closed or missing from feed.

Notes:
- Only the current places.json "Attraction" entries are eligible.
- A missing ride in liveData does NOT necessarily mean closed. Unreported
  rides simply have no bubble. Outside park hours, few/none may appear.
- There is no offline wait-time promise. The map and search remain offline;
  live bubbles disappear without connectivity.
- ThemeParks.wiki is a third-party, unofficial data provider; a visible
  attribution link is built into the control.
- The code was syntax-checked, but live browser/API behavior must be
  confirmed locally before committing. No repository files were changed.
