/* Core state, i18n, geocoding (online + offline stops), recents, theme, offline flag */
(function () {
  const { API, PRESETS, I18N, TBILISI, ITIN_COLORS } = window.TT;
  const S = (window.__tt = {
    API, PRESETS, I18N, TBILISI, ITIN_COLORS,
    lang: localStorage.getItem("tt-lang") || ((navigator.language || "").startsWith("ka") ? "ka" : "en"),
    fromPlace: null,
    toPlace: null,
    /* UI mode: "pick" (center pin) | "search" (typing) | "trip" (results) */
    mode: "pick",
    pickTarget: "from",
    searchField: "from",
    selectedItin: 0,
    lastItineraries: [],
    online: navigator.onLine !== false,
  });
  const $ = (id) => document.getElementById(id);
  S.$ = $;
  S.fromInput = $("from");
  S.toInput = $("to");
  S.statusEl = $("status");
  S.resultsEl = $("results");
  S.pasteInput = $("paste");

  S.t = function (key) {
    const pack = S.I18N[S.lang] || S.I18N.en;
    return pack[key] != null ? pack[key] : S.I18N.en[key];
  };
  S.tf = function (key, arg) {
    const v = S.t(key);
    return typeof v === "function" ? v(arg) : v;
  };
  S.displayName = function (p) {
    if (!p) return "";
    if (S.lang === "ka" && p.nameKa) return p.nameKa;
    return p.name || "";
  };
  S.inTbilisi = function (lat, lon) {
    const b = S.TBILISI;
    return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
  };
  S.nearTbilisi = function (lat, lon) {
    const b = S.TBILISI, pad = 0.12;
    return lat >= b.latMin - pad && lat <= b.latMax + pad && lon >= b.lonMin - pad && lon <= b.lonMax + pad;
  };
  S.isCoordLabel = function (name) {
    if (!name) return true;
    return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(String(name).trim());
  };
  S.escapeHtml = function (s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };
  S.distM = function (lat1, lon1, lat2, lon2) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };
  S.isMobile = function () { return window.matchMedia("(max-width: 799px)").matches; };
  S.isDark = function () { return window.matchMedia("(prefers-color-scheme: dark)").matches; };

  /* Readable text color on a hex background */
  S.textOn = function (hex) {
    const h = String(hex || "#000").replace("#", "");
    const r = parseInt(h.substr(0, 2), 16) / 255, g = parseInt(h.substr(2, 2), 16) / 255, b = parseInt(h.substr(4, 2), 16) / 255;
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return L > 0.28 ? "#111418" : "#ffffff";
  };
  S.itinColor = function (i) { return S.ITIN_COLORS[i % S.ITIN_COLORS.length]; };

  S.formatTime = function (iso) {
    if (!iso) return "—";
    try {
      return new Intl.DateTimeFormat(S.lang === "ka" ? "ka-GE" : "en-GB", {
        timeZone: "Asia/Tbilisi", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(iso));
    } catch (e) { return String(iso).slice(11, 16); }
  };
  S.formatDuration = function (sec) { return Math.max(1, Math.round((sec || 0) / 60)) + " " + S.t("duration"); };
  S.transferLabel = function (n) {
    if (!n) return S.t("transfers0");
    if (n === 1) return S.t("transfers1");
    return S.tf("transfersN", n);
  };
  S.modeLabel = function (mode) {
    const m = (mode || "").toUpperCase();
    if (m === "WALK") return S.t("walk");
    if (m === "BUS") return S.t("bus");
    if (["SUBWAY", "METRO", "RAIL", "TRAM"].includes(m)) return S.t("metro");
    if (["GONDOLA", "CABLE_CAR", "FUNICULAR", "AERIAL_LIFT"].includes(m)) return S.t("gondola");
    return mode || "?";
  };

  /* —— Network —— */
  S.apiGet = async function (path, opts) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), (opts && opts.timeout) || 20000);
    try {
      let res;
      try {
        res = await fetch(S.API + path, { headers: { Accept: "application/json" }, signal: ctl.signal });
      } catch (e) {
        S.setOnline(false); /* network failure → offline indicator */
        throw e;
      }
      S.setOnline(true);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally { clearTimeout(to); }
  };

  /* —— Offline stop index (bundled GTFS stops, precached by SW) —— */
  let stopsPromise = null;
  S.loadStops = function () {
    if (!stopsPromise) {
      stopsPromise = fetch("data/stops.json").then((r) => r.json()).then((d) => {
        S.stops = (d.stops || []).map((s) => ({
          en: s[0], ka: s[1], lat: s[2], lon: s[3], codes: s[4], kind: s[5],
          _n: S.norm(s[0] + " " + s[1] + " " + s[4]),
        }));
        return S.stops;
      }).catch(() => (S.stops = []));
    }
    return stopsPromise;
  };
  S.norm = function (s) {
    return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  };
  S.searchStopsLocal = function (text, limit) {
    const list = S.stops || [];
    const q = S.norm(text);
    if (!q) return [];
    const words = q.split(" ");
    const scored = [];
    for (const s of list) {
      let ok = true, score = 0;
      for (const w of words) {
        const i = s._n.indexOf(w);
        if (i < 0) { ok = false; break; }
        score += i === 0 || s._n[i - 1] === " " ? 2 : 1;
      }
      if (!ok) continue;
      if (s._n.startsWith(q)) score += 3;
      if (s.kind) score += 1.5; /* metro / cable car first on ties */
      scored.push([score, s]);
    }
    scored.sort((a, b) => b[0] - a[0] || a[1].en.length - b[1].en.length);
    return scored.slice(0, limit || 6).map(([, s]) => ({
      type: "STOP", name: s.en, nameKa: s.ka, lat: s.lat, lon: s.lon, kind: s.kind, local: true,
    }));
  };
  S.nearestStop = function (lat, lon, maxM) {
    let best = null, bd = maxM || 250;
    for (const s of S.stops || []) {
      if (Math.abs(s.lat - lat) > 0.01 || Math.abs(s.lon - lon) > 0.013) continue;
      const d = S.distM(lat, lon, s.lat, s.lon);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };

  S.filterTbilisi = function (results) {
    return (results || []).filter((r) =>
      r && typeof r.lat === "number" && typeof r.lon === "number" && S.inTbilisi(r.lat, r.lon) && (!r.country || r.country === "GE"));
  };
  S.nominatimSearch = async function (text) {
    const b = S.TBILISI;
    const viewbox = [b.lonMin, b.latMax, b.lonMax, b.latMin].join(",");
    const url = "https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&namedetails=1&limit=6" +
      "&countrycodes=ge&bounded=1&viewbox=" + encodeURIComponent(viewbox) + "&q=" + encodeURIComponent(text.trim());
    const res = await fetch(url, { headers: { Accept: "application/json", "Accept-Language": S.lang === "ka" ? "ka,en" : "en" } });
    if (!res.ok) return [];
    const data = await res.json();
    return (Array.isArray(data) ? data : []).map((r) => {
      const lat = parseFloat(r.lat), lon = parseFloat(r.lon);
      if (!S.inTbilisi(lat, lon)) return null;
      const nd = r.namedetails || {};
      const name = (S.lang === "ka" ? nd.name : nd["name:en"]) || nd.name || (r.display_name || "").split(",")[0] || "Place";
      const a = r.address || {};
      const area = a.suburb || a.neighbourhood || a.city_district || "";
      return { type: "PLACE", name, lat, lon, area, country: "GE" };
    }).filter(Boolean);
  };
  /** Online geocode (Transitous + Nominatim). Throws when offline. */
  S.geocodeOnline = async function (text) {
    const q = encodeURIComponent(text.trim());
    const bias = S.TBILISI.center[0] + "," + S.TBILISI.center[1];
    let data = [];
    try {
      data = await S.apiGet("/v1/geocode?text=" + q + "&language=" + S.lang + "&place=" + encodeURIComponent(bias), { timeout: 8000 });
    } catch (e) { data = []; }
    let out = S.filterTbilisi(Array.isArray(data) ? data : []).map((r) => ({
      type: r.type === "STOP" ? "STOP" : "PLACE", name: r.name, lat: r.lat, lon: r.lon,
      area: ((r.areas || []).map((a) => a.name).filter(Boolean).slice(-2)[0]) || "",
    }));
    if (out.filter((r) => r.type !== "STOP").length < 2) {
      try { out = out.concat(await S.nominatimSearch(text)); } catch (e) { /* ignore */ }
    }
    return out;
  };

  /** Friendly label from Nominatim reverse JSON — never raw coords */
  S.friendlyFromNominatim = function (data) {
    if (!data || data.error) return null;
    const a = data.address || {};
    const road = a.road || a.pedestrian || a.footway || a.path || a.square;
    const num = a.house_number;
    const area = a.suburb || a.neighbourhood || a.quarter || a.city_district;
    if (data.name && data.name.length < 50 && !S.isCoordLabel(data.name) && data.name !== road) return data.name;
    if (road) return road + (num ? " " + num : "");
    if (area) return area;
    const first = (data.display_name || "").split(",")[0];
    return first && !S.isCoordLabel(first) ? first : null;
  };
  const revCache = new Map();
  S.reverseGeocode = async function (lat, lon) {
    const key = lat.toFixed(4) + "," + lon.toFixed(4) + "," + S.lang;
    if (revCache.has(key)) return revCache.get(key);
    let name = null;
    if (S.online) {
      try {
        const url = "https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&zoom=18" +
          "&lat=" + encodeURIComponent(lat) + "&lon=" + encodeURIComponent(lon);
        const res = await fetch(url, { headers: { Accept: "application/json", "Accept-Language": S.lang === "ka" ? "ka,en" : "en" } });
        if (res.ok) name = S.friendlyFromNominatim(await res.json());
      } catch (e) { S.setOnline(false); }
    }
    if (!name) {
      await S.loadStops();
      const st = S.nearestStop(lat, lon, 300);
      if (st) name = S.tf("nearStop", S.lang === "ka" ? st.ka : st.en);
    }
    if (name) revCache.set(key, name);
    return name;
  };

  S.placeFromLatLon = function (lat, lon, name) {
    return { name: name || S.t("droppedPin"), lat, lon, type: "PLACE", pendingLabel: !name };
  };

  /** Set a trip end. Keeps fields + markers + summary in sync. No navigation here. */
  S.setPlace = function (which, place) {
    if (which === "from") S.fromPlace = place; else S.toPlace = place;
    const input = which === "from" ? S.fromInput : S.toInput;
    input.value = place ? S.displayName(place) : "";
    if (S.syncMapMarkers) S.syncMapMarkers();
    if (S.updateTripPoints) S.updateTripPoints();
    if (place && !place.pendingLabel) S.addRecentPlace(place);
  };
  /** Fill a pending "Pinned place" label later via reverse geocode */
  S.resolvePlaceLabel = async function (which) {
    const p = which === "from" ? S.fromPlace : S.toPlace;
    if (!p || !p.pendingLabel) return;
    const name = await S.reverseGeocode(p.lat, p.lon);
    const cur = which === "from" ? S.fromPlace : S.toPlace;
    if (cur !== p || !name) return;
    p.name = name; p.pendingLabel = false;
    S.setPlace(which, p);
  };

  /* —— Recents (localStorage; work offline) —— */
  function readLS(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota */ } }
  S.recentPlaces = function () { return readLS("tt-recent-places", []); };
  S.addRecentPlace = function (p) {
    if (!p || p.isGps || S.isCoordLabel(p.name)) return;
    const list = S.recentPlaces().filter((r) => S.distM(r.lat, r.lon, p.lat, p.lon) > 40);
    list.unshift({ name: p.name, nameKa: p.nameKa, lat: p.lat, lon: p.lon, type: p.type, kind: p.kind });
    writeLS("tt-recent-places", list.slice(0, 8));
  };
  S.recentTrips = function () { return readLS("tt-recent-trips", []); };
  S.saveTrip = function (from, to, itineraries) {
    const slim = (itineraries || []).map((it) => Object.assign({}, it, {
      legs: (it.legs || []).map((l) => {
        const c = Object.assign({}, l);
        delete c.intermediateStops; delete c.alternatives; delete c.steps;
        return c;
      }),
    }));
    const strip = (p) => ({ name: p.name, nameKa: p.nameKa, lat: p.lat, lon: p.lon, type: p.type });
    const list = S.recentTrips().filter((t) =>
      !(S.distM(t.from.lat, t.from.lon, from.lat, from.lon) < 60 && S.distM(t.to.lat, t.to.lon, to.lat, to.lon) < 60));
    list.unshift({ from: strip(from), to: strip(to), at: Date.now(), itineraries: slim });
    writeLS("tt-recent-trips", list.slice(0, 5));
  };
  S.findSavedTrip = function (from, to) {
    return S.recentTrips().find((t) =>
      S.distM(t.from.lat, t.from.lon, from.lat, from.lon) < 80 && S.distM(t.to.lat, t.to.lon, to.lat, to.lon) < 80);
  };

  /* —— Online / offline indicator —— */
  S.setOnline = function (v) {
    if (S.online === v) return;
    S.online = v;
    paintOnline();
  };
  function updateOnline() {
    S.online = navigator.onLine !== false;
    paintOnline();
  }
  function paintOnline() {
    const pill = $("offline-pill");
    if (pill) { pill.hidden = S.online; pill.textContent = S.t("offline"); }
    document.documentElement.classList.toggle("is-offline", !S.online);
  }
  /* navigator.onLine can lie (captive / flaky networks): probe cheaply when it says online */
  S.probeOnline = function () {
    if (navigator.onLine === false) { S.setOnline(false); return; }
    fetch("manifest.webmanifest?probe=" + Date.now(), { method: "HEAD", cache: "no-store" })
      .then(() => S.setOnline(true)).catch(() => S.setOnline(false));
  };
  setInterval(() => { if (!S.online) S.probeOnline(); }, 15000);
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);
  S.updateOnline = updateOnline;

  /* —— Keyboard-safe viewport vars (visualViewport) —— */
  function updateVV() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    const top = vv ? vv.offsetTop : 0;
    document.documentElement.style.setProperty("--vvh", Math.round(h) + "px");
    document.documentElement.style.setProperty("--vvtop", Math.round(top) + "px");
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", updateVV);
    window.visualViewport.addEventListener("scroll", updateVV);
  }
  window.addEventListener("resize", updateVV);
  updateVV();

  S.loadStops();
  updateOnline();
  setTimeout(S.probeOnline, 1500);
})();
