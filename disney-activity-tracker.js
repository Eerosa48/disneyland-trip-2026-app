/* Greyson's Disney Trip — production visitor activity tracker.
 * Isolated from the map, GPS, and offline downloader. No location data collected.
 * Pending session starts and feature events are stored locally until online.
 */
(function () {
  'use strict';

  const PROJECT_URL = 'https://kdlbnceepmcumxlnicvx.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_3LhyCSgyD1hBrV8JLZ1VLA_9K1-G-V_';
  const INGEST_URL = PROJECT_URL + '/functions/v1/disney-activity-ingest';
  const ID_KEY = 'greyson-disney-activity-identity-v1';
  const QUEUE_KEY = 'greyson-disney-activity-pending-v1';
  const HEARTBEAT_MS = 60000;
  const NEW_SESSION_AFTER_HIDDEN_MS = 15 * 60 * 1000;
  const MAX_QUEUE = 200;
  const VALID_NAME = /^[^\u0000-\u001f\u007f]+$/;

  let identity = readJson(ID_KEY, null);
  let queue = readJson(QUEUE_KEY, []);
  if (!Array.isArray(queue)) queue = [];
  if (!identity || typeof identity.visitorId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(identity.visitorId) ||
      typeof identity.token !== 'string' || !/^[0-9a-f]{64}$/i.test(identity.token) ||
      typeof identity.name !== 'string' || !identity.name.trim()) {
    identity = null;
    queue = [];
  }

  let currentSessionId = null;
  let currentSessionStarted = false;
  let flushActive = false;
  let retryAfter = 0;
  let hiddenAt = null;
  let lastHeartbeat = 0;
  let lastTracked = new Map();

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch (_) { return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  }
  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const h = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' +
      h.slice(16, 20) + '-' + h.slice(20);
  }
  function newToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)),
      b => b.toString(16).padStart(2, '0')).join('');
  }
  function launchMode() {
    if (window.navigator.standalone === true ||
        window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
    return 'browser';
  }
  function deviceType() {
    const ua = navigator.userAgent || '';
    if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua) ||
        (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet';
    if (/iPhone|iPod|Android.*Mobile|Mobile/i.test(ua)) return 'mobile';
    return 'desktop';
  }
  function platform() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua) ||
        (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'iOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Other';
  }
  function storeQueue() { writeJson(QUEUE_KEY, queue); }
  function enqueue(item) {
    // Leave room for session starts; drop excess nonessential events, not starts.
    if (queue.length >= MAX_QUEUE) {
      if (item.action === 'event') return;
      const oldEvent = queue.findIndex(q => q.action === 'event');
      if (oldEvent >= 0) queue.splice(oldEvent, 1);
      else if (queue.length >= MAX_QUEUE + 10) return;
    }
    queue.push(item);
    storeQueue();
    void flushQueue();
  }
  async function post(payload) {
    // Browsers keep publishable keys public. No service-role or admin credentials here.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(INGEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': PUBLISHABLE_KEY },
        body: JSON.stringify({ visitorId: identity.visitorId, token: identity.token, ...payload }),
        signal: controller.signal,
        cache: 'no-store'
      });
      if (!response.ok) {
        const failure = new Error('Activity reporting HTTP ' + response.status);
        failure.status = response.status;
        throw failure;
      }
      return true;
    } finally { clearTimeout(timeout); }
  }
  async function ensureRegistered() {
    if (identity.registered === true) return;
    await post({ action: 'register', name: identity.name });
    identity.registered = true;
    writeJson(ID_KEY, identity);
  }
  async function flushQueue() {
    if (!identity || flushActive || navigator.onLine === false ||
        document.hidden || Date.now() < retryAfter) return;
    flushActive = true;
    try {
      await ensureRegistered();
      // Preserve request order: an offline session must be created before its events.
      let processed = 0;
      while (queue.length && processed < 30 && !document.hidden) {
        const item = queue[0];
        await post(item);
        queue.shift();
        storeQueue();
        processed++;
      }
      if (queue.length) setTimeout(() => void flushQueue(), 2500);
    } catch (err) {
      // If the database was rebuilt, attempt self-registration on the next pass.
      if (err.status === 401) {
        identity.registered = false;
        writeJson(ID_KEY, identity);
      }
      if ((err.status === 400 || err.status === 404) && queue.length) {
        // An invalid/expired offline event must not block later records forever.
        queue.shift();
        storeQueue();
      }
      retryAfter = Date.now() + (err.status === 429 ? 120000 : 20000);
      // Reporting failures never block map, itinerary, GPS, or offline downloads.
      console.info('Disney activity: reporting will retry when available.');
    } finally { flushActive = false; }
  }
  function startSession() {
    if (!identity) return;
    currentSessionId = newId();
    currentSessionStarted = true;
    lastHeartbeat = 0;
    enqueue({
      action: 'start', sessionId: currentSessionId,
      launchMode: launchMode(), deviceType: deviceType(), platform: platform()
    });
  }
  function endSession() {
    if (!identity || !currentSessionStarted || !currentSessionId) return;
	
	const sessionId = currentSessionId;
	currentSessionStarted = false;
	currentSessionId = null;
	
	// Queue the end notification for reliable, ordered delivery.
	enqueue({ action: 'end', sessionId });
  }
  async function heartbeat() {
    if (!identity || !currentSessionStarted || document.hidden ||
        navigator.onLine === false) return;
    await flushQueue();
    if (queue.length || flushActive || Date.now() - lastHeartbeat < HEARTBEAT_MS - 5000) return;
    try {
      await post({ action: 'heartbeat', sessionId: currentSessionId });
      lastHeartbeat = Date.now();
    } catch (err) {
      if (err.status === 404) startSession();
      if (err.status === 401) {
        identity.registered = false;
        writeJson(ID_KEY, identity);
      }
    }
  }
  function track(feature, eventType) {
    if (!identity || !currentSessionStarted) return;
    const validFeatures = ['search', 'itinerary', 'wait_times', 'gps',
      'map_controls', 'disney_link', 'offline_download'];
    const validEvents = ['feature_open', 'feature_use', 'download_start',
      'download_finish', 'error'];
    if (!validFeatures.includes(feature) || !validEvents.includes(eventType)) return;
    const key = feature + ':' + eventType;
    const now = Date.now();
    if (now - (lastTracked.get(key) || 0) < 1500) return;
    lastTracked.set(key, now);
    enqueue({ action: 'event', sessionId: currentSessionId,
      eventId: newId(), eventType: eventType, feature: feature,
      occurredAt: new Date().toISOString() });
  }
  function bindFeatureClicks() {
    document.addEventListener('click', function (e) {
      const target = e.target instanceof Element ? e.target : e.target.parentElement;
      if (!target) return;
      const button = target.closest('button,a');
      if (!button) return;
      if (button.matches('.greyson-toolbar-button[data-tool="search"]'))
        track('search', 'feature_open');
      else if (button.matches('.greyson-toolbar-button[data-tool="itinerary"]'))
        track('itinerary', 'feature_open');
      else if (button.matches('.greyson-toolbar-button[data-tool="waits"]'))
        track('wait_times', 'feature_open');
      else if (button.matches('.place-search-result'))
        track('search', 'feature_use');
      else if (button.matches('.greyson-active-day-toggle,.greyson-itinerary-route-btn,.greyson-itinerary-route-row'))
        track('itinerary', 'feature_use');
      else if (button.matches('.greyson-wait-list-row'))
        track('wait_times', 'feature_use');
      else if (button.matches('.greyson-gps-locate'))
        track('gps', 'feature_use');
      else if (button.matches('.greyson-map-recenter'))
        track('map_controls', 'feature_use');
      else if (button.matches('.greyson-toolbar-external'))
        track('disney_link', 'feature_use');
    }, true);
  }
  function createWelcome() {
    const overlay = document.createElement('div');
    overlay.id = 'greyson-activity-welcome';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'greyson-activity-heading');
    overlay.innerHTML = '<form class="greyson-activity-card" autocomplete="off">' +
      '<div class="greyson-activity-emblem" aria-hidden="true">🏰</div>' +
      '<div class="greyson-activity-kicker">Greyson\'s Disney Trip</div>' +
      '<h2 id="greyson-activity-heading">Welcome! Please type in your name to continue</h2>' +
      '<label for="greyson-activity-name">Your name</label>' +
      '<input id="greyson-activity-name" name="name" type="text" ' +
      'autocomplete="name" maxlength="80" required placeholder="Your name" />' +
      '<p class="greyson-activity-error" role="alert" hidden></p>' +
      '<button type="submit">Continue</button>' +
      '</form>';
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const input = overlay.querySelector('input');
    const error = overlay.querySelector('.greyson-activity-error');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const name = input.value.trim();
      if (!name || !VALID_NAME.test(name) || Array.from(name).length > 80) {
        error.textContent = 'Please enter a name (up to 80 characters).';
        error.hidden = false;
        input.focus();
        return;
      }
      identity = { visitorId: newId(), token: newToken(), name: name, registered: false };
      // If storage is unavailable, the current visit still works offline.
      // Safari may ask for a name again on the next launch in that case.
      writeJson(ID_KEY, identity);
      overlay.remove();
      startSession();
    });
    setTimeout(function () { input.focus({ preventScroll: true }); }, 0);
  }
  // Only send usage reports; don't attach to geolocation or intercept search values.
  window.GreysonActivity = Object.freeze({ track: track });
  bindFeatureClicks();
  if (identity) startSession();
  else createWelcome();

  window.addEventListener('online', function () {
    retryAfter = 0;
    void flushQueue();
    void heartbeat();
  });
  
  function resumeTracking() {
    if (!identity || document.hidden) return;

    const hiddenTooLong =
      hiddenAt !== null &&
      Date.now() - hiddenAt >= NEW_SESSION_AFTER_HIDDEN_MS;

    // A long absence closes the previous session.
    if (hiddenTooLong && currentSessionStarted) {
      endSession();
    }

    // Brief absences continue the same session.
    if (!currentSessionStarted) {
      startSession();
    }

    hiddenAt = null;
    void flushQueue();
    void heartbeat();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (hiddenAt === null) hiddenAt = Date.now();
    } else {
      resumeTracking();
    }
  });

  window.addEventListener('pagehide', function () {
    if (hiddenAt === null) hiddenAt = Date.now();
  });

  window.addEventListener('pageshow', resumeTracking);

  setInterval(function () { if (!document.hidden) { void flushQueue(); void heartbeat(); } }, HEARTBEAT_MS);
})();
