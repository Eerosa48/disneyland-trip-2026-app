
/* Greyson's Disney Trip — Location Calibration Helper
   Browser-only editing tool. Does NOT write to GitHub or modify the app files.
   Paste into a Chrome DevTools Snippet and run on the Disney Trip map.
*/
(async () => {
  "use strict";

  if (window.greysonCalibration && typeof window.greysonCalibration.close === "function") {
    window.greysonCalibration.close();
  }

  if (typeof map === "undefined" || !window.L) {
    console.error("Open the Greyson's Disney Trip map before running the calibrator.");
    return;
  }

  const root = new URL("./", location.href);
  const storageKey = "greyson:place-calibration:v1:" + root.pathname;
  let original;
  try {
    const response = await fetch(new URL("places.json", root), { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    original = await response.json();
    if (!Array.isArray(original.places)) throw new Error("Invalid places.json");
  } catch (error) {
    console.error("Couldn't load places.json:", error);
    return;
  }

  const byId = new Map(original.places.map(p => [p.id, p]));
  const names = { disneyland: "Disneyland Park", california: "California Adventure", downtown: "Downtown Disney" };
  let edits = {};
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) edits = saved;
  } catch (_) {
    console.warn("Saved calibration data could not be read; starting with an empty draft.");
  }

  const css = document.createElement("style");
  css.textContent = `
    #greyson-cal-tool{position:fixed;right:12px;top:calc(10px + env(safe-area-inset-top,0px));z-index:9999;
      width:min(310px,calc(100vw - 24px));box-sizing:border-box;padding:13px;
      background:#fffffff5;border:1px solid #8ea68d;border-radius:12px;box-shadow:0 5px 28px #0005;
      color:#253b2b;font:13px/1.4 system-ui,-apple-system,sans-serif}
    #greyson-cal-tool *{box-sizing:border-box}
    #greyson-cal-tool h3{font-size:15px;margin:0 0 7px}
    #greyson-cal-tool label{display:block;font-weight:600;font-size:11px;margin:10px 0 3px}
    #greyson-cal-tool input,#greyson-cal-tool select{display:block;width:100%;font:13px system-ui,-apple-system,sans-serif;
      padding:9px;border:1px solid #aebfa9;border-radius:7px;background:#fff;color:#1f3324}
    #greyson-cal-tool .gc-row{display:flex;gap:7px;margin-top:9px}
    #greyson-cal-tool button{border:1px solid #759175;border-radius:7px;padding:8px 9px;
      font:600 12px system-ui,-apple-system,sans-serif;cursor:pointer;background:#f6fbf4;color:#244329}
    #greyson-cal-tool button.primary{background:#386343;color:#fff}
    #greyson-cal-tool button:disabled{opacity:.55;cursor:not-allowed}
    #greyson-cal-tool .gc-readout{padding:9px;margin-top:8px;border-radius:8px;background:#edf4e9;
      font-size:12px;white-space:pre-line}
    #greyson-cal-tool .gc-muted{font-size:11px;color:#526a56;margin:6px 0}
    #greyson-cal-tool .gc-row>*{flex:1;min-width:0}
    .greyson-cal-marker{border:none;background:transparent}
    .greyson-cal-marker span{display:flex;align-items:center;justify-content:center;
      width:28px;height:28px;border:3px solid #fff;border-radius:50%;background:#d45a34;
      color:white;font:bold 24px/24px system-ui;box-shadow:0 1px 8px #0009}
    #greyson-cal-tool .gc-exit{float:right;padding:2px 7px;font-size:15px;line-height:1.3}
  `;
  document.head.appendChild(css);

  const panel = document.createElement("aside");
  panel.id = "greyson-cal-tool";
  panel.setAttribute("aria-label", "Map coordinate calibration");
  panel.innerHTML = `
    <button type="button" class="gc-exit" title="Close calibration tool">×</button>
    <h3>Map coordinate calibration</h3>
    <div class="gc-muted">Temporary editor · nothing is sent to GitHub</div>
    <label for="gc-lookup">Find a place</label>
    <input id="gc-lookup" type="search" placeholder="Type part of the name…" autocomplete="off">
    <label for="gc-place">Select the place to correct</label>
    <select id="gc-place"></select>
    <div class="gc-readout" id="gc-readout">Loading…</div>
    <div class="gc-row">
      <button type="button" id="gc-map-click" class="primary">Click map to place</button>
      <button type="button" id="gc-center">Recenter</button>
    </div>
    <div class="gc-muted">Or drag the orange crosshair directly onto the correct location.</div>
    <div class="gc-row">
      <button type="button" id="gc-reset">Reset this place</button>
      <button type="button" id="gc-next">Next A–Z</button>
    </div>
    <div class="gc-row">
      <button type="button" id="gc-export" class="primary">Export updated JSON</button>
    </div>
    <div class="gc-muted" id="gc-progress">0 corrections saved locally.</div>
    <div class="gc-muted">Export periodically for backup. The exported file is a draft for review, not an automatic update.</div>
  `;
  document.body.appendChild(panel);

  const el = id => panel.querySelector("#" + id);
  const lookup = el("gc-lookup");
  const selector = el("gc-place");
  const readout = el("gc-readout");
  const progress = el("gc-progress");
  const clickButton = el("gc-map-click");
  let currentId = null;
  let armed = false;
  let marker = null;

  const markerIcon = L.divIcon({
    className: "greyson-cal-marker",
    html: "<span>+</span>",
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });

  function isValidPoint(p) {
    return p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
  }
  function pointFor(place) {
    return isValidPoint(edits[place.id]) ? edits[place.id] : place;
  }
  function updateReadout() {
    const place = byId.get(currentId);
    if (!place) return;
    const pt = pointFor(place);
    const changed = isValidPoint(edits[currentId]);
    readout.textContent = `${place.name}\n${names[place.park] || place.park} · ${place.area || "Other"}\n` +
      `Latitude: ${pt.lat.toFixed(6)}\nLongitude: ${pt.lon.toFixed(6)}\n` +
      (changed ? "✓ Corrected in local draft" : "◯ Original approximate coordinates");
    progress.textContent = `${Object.keys(edits).filter(id => byId.has(id) && isValidPoint(edits[id])).length}` +
      ` of ${original.places.length} locations corrected.`;
    el("gc-reset").disabled = !changed;
  }
  function store() {
    localStorage.setItem(storageKey, JSON.stringify(edits));
    updateReadout();
  }
  function setPoint(point) {
    if (!currentId || !isValidPoint(point)) return;
    const fixed = { lat: Number(point.lat.toFixed(6)), lon: Number(point.lon.toFixed(6)) };
    edits[currentId] = fixed;
    if (marker) marker.setLatLng([fixed.lat, fixed.lon]);
    store();
  }
  function disarm() {
    armed = false;
    clickButton.textContent = "Click map to place";
    clickButton.style.background = "";
    map.getContainer().style.cursor = "";
  }
  function selectPlace(id, fly) {
    if (!byId.has(id)) return;
    disarm();
    currentId = id;
    selector.value = id;
    const place = byId.get(id);
    const pt = pointFor(place);
    if (!marker) {
      marker = L.marker([pt.lat, pt.lon], { icon: markerIcon, draggable: true, bubblingMouseEvents: false })
        .addTo(map);
      marker.on("dragend", () => {
        const ll = marker.getLatLng();
        setPoint({ lat: ll.lat, lon: ll.lng });
      });
    } else {
      marker.setLatLng([pt.lat, pt.lon]);
    }
    marker.unbindTooltip();
    marker.bindTooltip(place.name, { direction: "top", offset: [0, -15] });
    if (fly) map.flyTo([pt.lat, pt.lon], Math.max(18.4, map.getZoom()), { duration: 0.35 });
    updateReadout();
  }
  function updateOptions() {
    const term = lookup.value.trim().toLowerCase();
    const matches = original.places
      .filter(p => `${p.name} ${p.area} ${names[p.park] || ""}`.toLowerCase().includes(term))
      .sort((a,b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    const selected = currentId;
    selector.replaceChildren();
    for (const p of matches) {
      const option = document.createElement("option");
      option.value = p.id;
      option.textContent = `${p.name} (${names[p.park] || p.park})`;
      selector.appendChild(option);
    }
    if (matches.length) {
      selectPlace(matches.some(p => p.id === selected) ? selected : matches[0].id, true);
    } else {
      currentId = null;
      if (marker) map.removeLayer(marker);
      marker = null;
      readout.textContent = "No matching entries.";
    }
  }
  function handleMapClick(event) {
    if (!armed) return;
    setPoint({ lat: event.latlng.lat, lon: event.latlng.lng });
    disarm();
  }

  selector.addEventListener("change", () => selectPlace(selector.value, true));
  lookup.addEventListener("input", updateOptions);
  clickButton.addEventListener("click", () => {
    armed = !armed;
    clickButton.textContent = armed ? "Click the exact spot…" : "Click map to place";
    map.getContainer().style.cursor = armed ? "crosshair" : "";
  });
  el("gc-center").addEventListener("click", () => {
    const p = byId.get(currentId);
    if (p) {
      const pt = pointFor(p);
      map.flyTo([pt.lat, pt.lon], Math.max(18.4, map.getZoom()), { duration: 0.35 });
    }
  });
  el("gc-reset").addEventListener("click", () => {
    if (!currentId) return;
    delete edits[currentId];
    store();
    selectPlace(currentId, false);
  });
  el("gc-next").addEventListener("click", () => {
    const options = Array.from(selector.options);
    const index = options.findIndex(o => o.value === currentId);
    if (index >= 0 && index + 1 < options.length) selectPlace(options[index + 1].value, true);
  });
  el("gc-export").addEventListener("click", () => {
    const exportData = JSON.parse(JSON.stringify(original));
    let applied = 0;
    for (const p of exportData.places) {
      const point = edits[p.id];
      if (!isValidPoint(point)) continue;
      p.lat = point.lat;
      p.lon = point.lon;
      p.accuracy = "manually_placed";
      applied++;
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "places-calibrated-draft.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    progress.textContent = `Exported draft with ${applied} manual coordinate corrections.`;
  });
  panel.querySelector(".gc-exit").addEventListener("click", close);
  panel.addEventListener("pointerdown", event => event.stopPropagation());
  panel.addEventListener("dblclick", event => event.stopPropagation());
  panel.addEventListener("wheel", event => event.stopPropagation(), { passive: true });
  map.on("click", handleMapClick);

  function close() {
    disarm();
    map.off("click", handleMapClick);
    if (marker) map.removeLayer(marker);
    panel.remove();
    css.remove();
    if (window.greysonCalibration && window.greysonCalibration.close === close) {
      delete window.greysonCalibration;
    }
  }
  window.greysonCalibration = { close };
  updateOptions();
  console.info("Greyson's coordinate calibration helper ready. Changes stay in localStorage until exported.");
})();
