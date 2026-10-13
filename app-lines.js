/*
 * Stops & Lines: unified-search lines, line view (shape, direction, stops, live vehicles),
 * stop view (departures, live vs scheduled), nearby-stop row, map stop dots, back stack.
 * Data: lines index + per-line files from the runtime data store (app-store.js, IndexedDB; lazy per line);
 * live: Transitous /v5/stoptimes, /v5/trip, /v1/map/trips. Design: docs/stops-lines-ux.md
 */
(function () {
  const S = window.__tt;
  const $ = S.$;
  const map = S.map;
  const esc = S.escapeHtml;
  const FEED = "ge-tbilisi-transport-company_";
  const RT_PREFIX = FEED + "1:";
  const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  /* ———————————————— data ———————————————— */
  let linesPromise = null;
  S.lines = [];
  S.lineByKey = new Map();
  S.loadLines = function () {
    if (!linesPromise) {
      linesPromise = Promise.all([S.store.essentials(), S.loadStops()]).then(([e]) => {
        if (!e) { linesPromise = null; return S.lines; }
        return applyLines(e.lines);
      }).catch((e) => { console.warn("lines", e); linesPromise = null; return []; });
    }
    return linesPromise;
  };
  function applyLines(d) {
    S.svcMask = d.svc || {};
    S.lines = (d.lines || []).map((l, i) => ({ i, key: l[0], code: l[1], type: l[2], color: l[3], en: l[4], ka: l[5], terms: l[6] || [] }));
    S.lineByKey = new Map();
    S.lines.forEach((l) => S.lineByKey.set(l.key, l));
    S.stopLines = d.stopLines || [];
    return S.lines;
  }
  /* new data published while running: swap indexes, drop per-line + departure caches */
  S.store.on("updated", (e) => {
    applyLines(e.lines);
    linesPromise = Promise.resolve(S.lines);
    lineCache.clear(); depCache.clear();
    if (S.paintStopDots) S.paintStopDots();
  });
  const lineCache = new Map();
  S.loadLine = function (key) {
    if (lineCache.has(key)) return lineCache.get(key);
    const p = S.loadLines().then(() => S.store.getLine(key))
      .then((d) => {
        const dirs = (d.dirs || []).map((x) => {
          const stops = x.s.map((s) => ({ id: s[0], en: s[1], ka: s[2], lat: s[3], lon: s[4] }));
          const coords = S.decodePolyline(x.p, 5);
          const times = {};
          Object.keys(x.t || {}).forEach((svc) => { let acc = 0; times[svc] = x.t[svc].map((v) => (acc += v)); });
          return { d: x.d, stops, off: x.o, times, coords, si: x.si, real: x.real };
        });
        return { key, id: d.id, dirs };
      });
    p.catch(() => lineCache.delete(key));
    lineCache.set(key, p);
    return p;
  };
  S.loadLines();

  S.lineName = function (l) { return (S.lang === "ka" ? l.ka : l.en) || l.en || ""; };
  S.lineKind = function (l) { return (S.t("lineKinds") || {})[l.type] || ""; };
  S.lineBadge = function (l, cls) {
    return '<span class="line-badge' + (cls ? " " + cls : "") + (l.type === 1 ? " metro" : l.type === 6 ? " cable" : "") +
      '" style="background:' + l.color + ";color:" + S.textOn(l.color) + '">' + esc(l.code) + "</span>";
  };
  S.lineFromRouteId = function (rid) {
    if (!rid) return null;
    const k = String(rid).replace(RT_PREFIX, "").replace(/^1:/, "");
    return S.lineByKey.get(k) || null;
  };
  function stopName(s) { return S.lang === "ka" ? (s.ka || s.en) : (s.en || s.ka); }
  function altName(s) { return S.lang === "ka" ? (s.en !== s.ka ? s.en : "") : (s.ka !== s.en ? s.ka : ""); }

  /* —— Tbilisi clock + timetable —— */
  const fmtParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tbilisi", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  S.tbNow = function () {
    const p = {};
    fmtParts.formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
    const h = Number(p.hour) % 24;
    return { dow: Math.max(0, DAY.indexOf(p.weekday)), min: h * 60 + Number(p.minute) + Number(p.second) / 60 };
  };
  function startsToday(dir) {
    const now = S.tbNow();
    const prevDow = (now.dow + 6) % 7;
    const out = [];
    Object.keys(dir.times).forEach((svc) => {
      const m = S.svcMask[svc] || 0;
      if (m >> now.dow & 1) dir.times[svc].forEach((t) => out.push(t));
      if (m >> prevDow & 1) dir.times[svc].forEach((t) => { if (t + dir.off[dir.off.length - 1] >= 1440) out.push(t - 1440); });
    });
    return out.sort((a, b) => a - b);
  }
  function minToMs(m) { return Date.now() + (m - S.tbNow().min) * 60000; }
  function hhmm(m) { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
  /** next n scheduled times (minute-of-day) at stop index i of dir */
  function nextAt(dir, i, n) {
    const now = S.tbNow().min;
    const st = startsToday(dir);
    const out = [];
    for (const s of st) { const t = s + dir.off[i]; if (t >= now - 0.5) { out.push(t); if (out.length >= n) break; } }
    return out;
  }
  function headway(dir) {
    const st = startsToday(dir);
    if (!st.length) return null;
    const now = S.tbNow().min;
    const win = st.filter((t) => t >= now - 90 && t <= now + 120);
    const arr = win.length >= 3 ? win : st;
    const gaps = [];
    for (let i = 1; i < arr.length; i++) gaps.push(arr[i] - arr[i - 1]);
    gaps.sort((a, b) => a - b);
    const g = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
    return { every: g ? Math.max(1, Math.round(g)) : null, first: st.find((t) => t >= 0), last: st[st.length - 1] };
  }
  function countdown(ms) { return S.tf("inMin", Math.round((ms - Date.now()) / 60000)); }

  /* —— Departures for a merged stop —— */
  const depCache = new Map();
  function groupKey(lineKey, termId) { return lineKey + "|" + termId; }
  function dirForTerminal(ld, termId, dirId) {
    let di = ld.dirs.findIndex((d) => d.stops[d.stops.length - 1].id === termId);
    if (di < 0) di = ld.dirs.findIndex((d) => String(d.d) === String(dirId));
    return di < 0 ? 0 : di;
  }
  async function departuresOffline(idx) {
    await S.loadLines();
    const stop = S.stops[idx];
    const ids = new Set(stop.ids);
    const groups = [];
    const keys = (S.stopLines[idx] || []).map((li) => S.lines[li]).filter(Boolean);
    await Promise.all(keys.map(async (l) => {
      let ld;
      try { ld = await S.loadLine(l.key); } catch (e) { return; }
      ld.dirs.forEach((dir, di) => {
        const j = dir.stops.findIndex((s) => ids.has(s.id));
        if (j < 0 || j === dir.stops.length - 1) return;
        const ts = nextAt(dir, j, 6).filter((m, k, arr) => m - S.tbNow().min <= 90 && (k === 0 || m - arr[k - 1] > 0.75)).slice(0, 3);
        if (!ts.length) return;
        const term = dir.stops[dir.stops.length - 1];
        groups.push({ line: l, dirIdx: di, term, times: ts.map((m) => ({ ms: minToMs(m), rt: false, tripId: null })) });
      });
    }));
    return groups;
  }
  async function departuresOnline(idx) {
    await S.loadLines();
    const stop = S.stops[idx];
    const ids = new Set(stop.ids);
    const res = await Promise.all(stop.ids.slice(0, 4).map((id) =>
      S.apiCached("/v5/stoptimes?stopId=" + encodeURIComponent(RT_PREFIX + id) + "&n=30&language=" + S.lang, S.TTL.stoptimes)
        /* a copy older than 5 min is worse than the local timetable */
        .then((r) => (r.stale && Date.now() - r.at > 300e3 ? null : (r.body.stopTimes || []))).catch(() => null)));
    if (res.every((r) => r === null)) throw new Error("stoptimes failed");
    const seen = new Set();
    const groups = new Map();
    const horizon = Date.now() + 90 * 60000;
    res.forEach((list) => (list || []).forEach((st) => {
      if (!st || seen.has(st.tripId) || st.cancelled) return;
      const pl = st.place || {};
      const dep = Date.parse(pl.departure || pl.scheduledDeparture || "");
      if (!dep || dep < Date.now() - 45000 || dep > horizon) return;
      const termId = String((st.tripTo && st.tripTo.stopId) || "").replace(RT_PREFIX, "");
      if (ids.has(termId)) return; /* terminates here */
      seen.add(st.tripId);
      const l = S.lineFromRouteId(st.routeId);
      const k = groupKey(l ? l.key : st.routeShortName, termId);
      let g = groups.get(k);
      if (!g) {
        const ti = S.stopIndexById ? S.stopIndexById.get(termId) : null;
        const tStop = ti != null ? S.stops[ti] : null;
        g = {
          line: l || { key: null, code: st.routeShortName || "?", type: 3, color: "#3b82f6", en: "", ka: "" },
          term: tStop ? { id: termId, en: tStop.en, ka: tStop.ka } : { id: termId, en: (st.tripTo && st.tripTo.name) || st.headsign, ka: st.headsign },
          dirId: st.directionId, times: [], boardId: String(pl.stopId || "").replace(RT_PREFIX, ""),
        };
        groups.set(k, g);
      }
      g.times.push({ ms: dep, rt: !!st.realTime, tripId: st.tripId, sched: Date.parse(pl.scheduledDeparture || "") || dep });
    }));
    const out = [...groups.values()];
    out.forEach((g) => {
      g.times.sort((a, b) => a.ms - b.ms);
      /* the feed has duplicate trips (overlapping services) → one per minute */
      g.times = g.times.filter((t, i, arr) => i === 0 || t.ms - arr[i - 1].ms > 45000 || (t.rt && !arr[i - 1].rt)).slice(0, 3);
    });
    return out;
  }
  /** → {groups, offline, live, at} ; cached 25 s */
  S.getDepartures = async function (idx, force) {
    const c = depCache.get(idx);
    if (!force && c && Date.now() - c.at < 25000) return c;
    let groups, offline = false;
    if (S.online) {
      try { groups = await departuresOnline(idx); } catch (e) { groups = null; }
    }
    if (!groups) { groups = await departuresOffline(idx); offline = true; }
    groups.sort((a, b) => a.times[0].ms - b.times[0].ms);
    const out = { groups, offline, live: groups.some((g) => g.times.some((t) => t.rt)), at: Date.now() };
    depCache.set(idx, out);
    return out;
  };

  /* ———————————————— recents ———————————————— */
  const readLS = (k, d) => S.ls.get(k, d);
  const writeLS = (k, v) => S.ls.set(k, v);
  function addRecentLine(key) { writeLS("tt-recent-lines", [key].concat(readLS("tt-recent-lines", []).filter((k) => k !== key)).slice(0, 8)); }
  function addRecentStop(idx) {
    const s = S.stops[idx];
    if (!s || !s.ids.length) return;
    writeLS("tt-recent-stops", [s.ids[0]].concat(readLS("tt-recent-stops", []).filter((k) => k !== s.ids[0])).slice(0, 6));
  }

  /* ———————————————— search integration ———————————————— */
  function normLineQ(q) {
    return String(q || "").trim().toUpperCase().replace(/^М/, "M").replace(/^Г/, "G").replace(/\s+/g, "");
  }
  S.isLineQuery = function (q) {
    const n = normLineQ(q);
    return /^[MG]?\d{1,3}$/.test(n) || /^(METRO|МЕТРО|მეტრო)$/i.test(n);
  };
  S.searchLines = function (q) {
    if (!S.lines.length || !S.isLineQuery(q)) return [];
    const n = normLineQ(q);
    if (/^(METRO|МЕТРО|მეტრო)$/i.test(n)) return S.lines.filter((l) => l.type === 1);
    const exact = [], pre = [];
    S.lines.forEach((l) => {
      const c = l.code.toUpperCase();
      if (c === n || (l.type !== 3 && c.slice(1) === n && n.length === 1)) exact.push(l);
      else if (c.startsWith(n)) pre.push(l);
    });
    return exact.concat(pre).slice(0, 6);
  };
  S.addLineRow = function (l) {
    S.searchAddItem(
      '<span class="s-ico line">' + S.lineBadge(l) + '</span><span class="s-txt"><span class="s-name">' + esc(S.lineName(l)) +
      '</span><span class="s-meta">' + esc(S.lineKind(l)) + "</span></span>",
      () => S.openLine(l.key, {}), "line-row");
  };
  S.renderRecentLinesStops = function (listEl) {
    const lines = readLS("tt-recent-lines", []).map((k) => S.lineByKey.get(k)).filter(Boolean);
    if (lines.length) {
      S.searchAddHeader(S.t("recentLines"));
      const row = document.createElement("div");
      row.className = "rl-chips";
      lines.forEach((l) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "rl-chip";
        b.title = S.lineName(l);
        b.innerHTML = S.lineBadge(l);
        b.addEventListener("pointerdown", (e) => e.preventDefault());
        b.addEventListener("click", () => S.openLine(l.key, {}));
        row.appendChild(b);
      });
      listEl.appendChild(row);
    }
    const stops = readLS("tt-recent-stops", []).map((id) => (S.stopIndexById ? S.stopIndexById.get(id) : null)).filter((i) => i != null).slice(0, 3);
    if (stops.length) {
      S.searchAddHeader(S.t("recentStops"));
      stops.forEach((i) => {
        const s = S.stops[i];
        S.searchAddItem('<span class="s-ico stop">' + stopIcon(s.kind) + '</span><span class="s-txt"><span class="s-name">' + esc(stopName(s)) +
          '</span><span class="s-meta">' + esc(S.t("departures")) + "</span></span>", () => S.openStop(i));
      });
    }
  };
  function stopIcon(kind) {
    if (kind === 1) return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 9 5l3 8 3-8 4 14"></path></svg>';
    if (kind === 2) return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l18-3M12 4.5V9"></path><rect x="7" y="9" width="10" height="9" rx="2"></rect></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3.5" width="12" height="14" rx="3"></rect><path d="M6 12h12M9 17.5V20M15 17.5V20"></path></svg>';
  }

  /* ———————————————— navigation stack ———————————————— */
  const nav = { stack: [], base: null, camera: null, ignorePop: 0 };
  S.nav = nav;
  function top() { return nav.stack[nav.stack.length - 1]; }
  function push(v) {
    if (!nav.stack.length) {
      const fromSearch = S.mode === "search";
      const prev = fromSearch ? S.searchPrev : S.mode;
      nav.base = { mode: prev === "trip" && S.lastItineraries.length ? "trip" : "pick", pickTarget: S.pickTarget, pickEditing: S.pickEditing };
      const c = map.getCenter();
      nav.camera = { center: [c.lng, c.lat], zoom: map.getZoom() };
      if (fromSearch) {
        S.abandonSearch();
        try { history.replaceState({ ttv: 1 }, ""); } catch (e) { /* ignore */ }
      } else {
        try { history.pushState({ ttv: 1 }, ""); } catch (e) { /* ignore */ }
      }
      if (nav.base.mode === "trip") S.hideRoutes();
    } else if (S.mode === "search") {
      S.abandonSearch();
      try { history.replaceState({ ttv: 1 }, ""); } catch (e) { /* ignore */ }
    }
    nav.stack.push(v);
    show(v);
  }
  function leaveStackHistory() {
    if (history.state && history.state.ttv) { nav.ignorePop++; try { history.back(); } catch (e) { nav.ignorePop--; } }
  }
  function back(fromPop) {
    if (!nav.stack.length) return;
    nav.stack.pop();
    if (nav.stack.length) {
      if (fromPop) { try { history.pushState({ ttv: 1 }, ""); } catch (e) { /* ignore */ } }
      show(top());
      return;
    }
    if (!fromPop) leaveStackHistory();
    restoreBase();
  }
  S.navBack = back;
  function teardown() {
    stopTimers();
    S.clearLine();
    selMarker(null);
  }
  function restoreBase() {
    teardown();
    const b = nav.base || { mode: "pick" };
    if (nav.camera) map.easeTo({ center: nav.camera.center, zoom: nav.camera.zoom, duration: 400 });
    if (b.mode === "trip" && S.fromPlace && S.toPlace && S.lastItineraries.length) {
      S.setMode("trip");
      S.redrawRoutes();
      if (S.showVehicles) S.showVehicles(S.selectedItin || 0);
    } else {
      const which = b.pickTarget || (!S.fromPlace ? "from" : "to");
      S.enterPick(S.fromPlace && which === "from" && !b.pickEditing ? "to" : which, { editing: b.pickEditing && !!(S.fromPlace && S.toPlace) });
    }
  }
  /** Drop the whole stack (we're about to plan / pick) */
  function clearStack() {
    if (!nav.stack.length) return;
    nav.stack = [];
    teardown();
    leaveStackHistory();
  }
  window.addEventListener("popstate", () => {
    if (nav.ignorePop > 0) { nav.ignorePop--; return; }
    if (nav.stack.length && (S.mode === "stop" || S.mode === "line")) back(true);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (S.mode === "stop" || S.mode === "line")) back();
  });
  $("stop-back").addEventListener("click", () => back());
  $("line-back").addEventListener("click", () => back());

  function show(v) {
    stopTimers();
    if (v.kind === "stop") renderStop(v); else renderLine(v);
  }
  let timers = [];
  function stopTimers() { timers.forEach((t) => clearInterval(t)); timers = []; if (S.stopVehicles) S.stopVehicles(); }

  /* ———————————————— map layers ———————————————— */
  const whenStyle = (fn) => (S.whenStyle ? S.whenStyle(fn) : map.isStyleLoaded() ? fn() : map.once("load", fn));
  const EMPTY = { type: "FeatureCollection", features: [] };
  function casing() { return S.isDark() ? "#0d1014" : "#ffffff"; }
  function ensure() {
    if (map.getSource("line")) return;
    map.addSource("stops-all", { type: "geojson", data: EMPTY });
    map.addSource("line", { type: "geojson", data: EMPTY });
    map.addSource("line-stops", { type: "geojson", data: EMPTY });
    const round = { "line-join": "round", "line-cap": "round" };
    map.addLayer({ id: "stops-all", type: "circle", source: "stops-all", minzoom: 14.5,
      layout: { visibility: "none" },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 14.5, 4, 17, 8],
        "circle-color": S.isDark() ? "#e9edf2" : "#ffffff",
        "circle-stroke-color": ["match", ["get", "k"], 1, "#e5484d", 2, "#f0a020", "#2563eb"],
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 14.5, 2, 17, 3.5],
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 14.5, 0, 15, 1],
        "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 14.5, 0, 15, 1],
      } });
    map.addLayer({ id: "line-other", type: "line", source: "line", filter: ["==", ["get", "part"], "other"], layout: round,
      paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.3, "line-dasharray": [2, 1.5] } });
    map.addLayer({ id: "line-casing", type: "line", source: "line", filter: ["!=", ["get", "part"], "other"], layout: round,
      paint: { "line-color": casing(), "line-width": 10, "line-opacity": 0.9 } });
    map.addLayer({ id: "line-past", type: "line", source: "line", filter: ["==", ["get", "part"], "past"], layout: round,
      paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": 0.35 } });
    map.addLayer({ id: "line-ahead", type: "line", source: "line", filter: ["==", ["get", "part"], "ahead"], layout: round,
      paint: { "line-color": ["get", "color"], "line-width": 6.5 } });
    map.addLayer({ id: "line-stops", type: "circle", source: "line-stops",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"],
          11, ["case", ["==", ["get", "sel"], 1], 6, ["==", ["get", "board"], 1], 6, 2.5],
          16, ["case", ["==", ["get", "sel"], 1], 8.5, ["==", ["get", "board"], 1], 8, 5.5]],
        "circle-color": ["case", ["==", ["get", "sel"], 1], ["get", "color"], S.isDark() ? "#1a1f26" : "#ffffff"],
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": ["case", ["==", ["get", "board"], 1], 3.5, 2],
        "circle-opacity": ["case", ["==", ["get", "past"], 1], 0.45, 1],
        "circle-stroke-opacity": ["case", ["==", ["get", "past"], 1], 0.45, 1],
      } });
    S.loadStops().then(S.paintStopDots);
    updateStopDots();
  }
  S.paintStopDots = function () {
    const src = map.getSource("stops-all");
    if (src) src.setData({ type: "FeatureCollection", features: (S.stops || []).map((s) => ({
      type: "Feature", properties: { i: s.i, k: s.kind }, geometry: { type: "Point", coordinates: [s.lon, s.lat] } })) });
  };
  whenStyle(ensure);
  function themeLayers() {
    if (!map.getLayer("line-casing")) return;
    map.setPaintProperty("line-casing", "line-color", casing());
    map.setPaintProperty("stops-all", "circle-color", S.isDark() ? "#e9edf2" : "#ffffff");
    map.setPaintProperty("line-stops", "circle-color", ["case", ["==", ["get", "sel"], 1], ["get", "color"], S.isDark() ? "#1a1f26" : "#ffffff"]);
  }
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", themeLayers);
  function updateStopDots() {
    if (!map.getLayer("stops-all")) return;
    const on = S.mode === "pick" || S.mode === "stop" || S.mode === "line";
    map.setLayoutProperty("stops-all", "visibility", on ? "visible" : "none");
  }
  S.onMode = function (mode) {
    updateStopDots();
    if (mode !== "stop" && mode !== "line" && nav.stack.length && mode !== "search") {
      /* something else took over (e.g. plan from "Go here") → stack is gone */
      nav.stack = []; teardown();
    }
    updateNearby();
  };
  S.clearLine = function () {
    whenStyle(() => { ensure(); map.getSource("line").setData(EMPTY); map.getSource("line-stops").setData(EMPTY); });
  };
  function drawLine(l, ld, v) {
    whenStyle(() => {
      ensure();
      const dir = ld.dirs[v.dir];
      const feats = [];
      ld.dirs.forEach((d, i) => {
        if (i !== v.dir && d.coords.length > 1) feats.push({ type: "Feature", properties: { part: "other", color: l.color }, geometry: { type: "LineString", coordinates: d.coords } });
      });
      const cut = v.board != null ? dir.si[v.board] : 0;
      if (cut > 0) feats.push({ type: "Feature", properties: { part: "past", color: l.color }, geometry: { type: "LineString", coordinates: dir.coords.slice(0, cut + 1) } });
      const ahead = dir.coords.slice(cut);
      if (ahead.length > 1) feats.push({ type: "Feature", properties: { part: "ahead", color: l.color }, geometry: { type: "LineString", coordinates: ahead } });
      map.getSource("line").setData({ type: "FeatureCollection", features: feats });
      map.getSource("line-stops").setData({ type: "FeatureCollection", features: dir.stops.map((s, i) => ({
        type: "Feature",
        properties: { i, color: l.color, past: v.board != null && i < v.board ? 1 : 0, board: i === v.board ? 1 : 0, sel: i === v.sel ? 1 : 0 },
        geometry: { type: "Point", coordinates: [s.lon, s.lat] } })) });
    });
  }
  function fitCoords(coords, maxZoom) {
    if (!coords.length) return;
    const b = new maplibregl.LngLatBounds();
    coords.forEach((c) => b.extend(c));
    setTimeout(() => map.fitBounds(b, { padding: padFor(S.sheetSnap || "mid"), maxZoom: maxZoom || 16, duration: 550 }), 60);
  }
  let selMk = null;
  function selMarker(s) {
    if (!s) { if (selMk) { selMk.remove(); selMk = null; } return; }
    if (!selMk) {
      const el = document.createElement("div");
      el.className = "stop-sel";
      selMk = new maplibregl.Marker({ element: el, anchor: "center" });
    }
    selMk.setLngLat([s.lon, s.lat]).addTo(map);
  }

  /* Tap on map stop dots (delayed so double-tap / double-tap-drag zoom never opens a stop) */
  let tapT = null;
  map.on("click", (e) => {
    if (!(S.mode === "pick" || S.mode === "stop" || S.mode === "line")) return;
    if (!map.getLayer("stops-all")) return;
    const p = e.point, r = S.isMobile() ? 14 : 8;
    const box = [[p.x - r, p.y - r], [p.x + r, p.y + r]];
    clearTimeout(tapT);
    tapT = setTimeout(() => {
      if (S.mode === "line") {
        const f = map.queryRenderedFeatures(box, { layers: ["line-stops"] })[0];
        if (f) { selectLineStop(f.properties.i, true); return; }
      }
      const g = map.queryRenderedFeatures(box, { layers: ["stops-all"] })[0];
      if (g) S.openStop(g.properties.i);
    }, 280);
  });
  ["dblclick", "zoomstart", "dragstart"].forEach((ev) => map.on(ev, () => clearTimeout(tapT)));
  map.on("mousemove", (e) => {
    if (S.isMobile() || !map.getLayer("stops-all")) return;
    const p = e.point;
    const layers = S.mode === "line" ? ["line-stops", "stops-all"] : ["stops-all"];
    const hit = (S.mode === "pick" || S.mode === "stop" || S.mode === "line") &&
      map.queryRenderedFeatures([[p.x - 6, p.y - 6], [p.x + 6, p.y + 6]], { layers }).length;
    map.getCanvas().style.cursor = hit ? "pointer" : "";
  });

  /* ———————————————— STOP view ———————————————— */
  S.openStop = function (idx, opts) {
    S.loadStops().then(() => {
      if (!S.stops[idx]) return;
      const cur = top();
      if (cur && cur.kind === "stop" && cur.idx === idx) return;
      addRecentStop(idx);
      push(Object.assign({ kind: "stop", idx }, opts || {}));
    });
  };
  function renderStop(v) {
    const s = S.stops[v.idx];
    S.setMode("stop");
    S.setSheet("mid");
    S.clearLine();
    $("sv-ico").innerHTML = stopIcon(s.kind);
    $("sv-ico").className = "sv-ico k" + (s.kind || 0);
    $("sv-title").textContent = stopName(s);
    const code = (s.codes || "").split(" ").filter(Boolean)[0];
    $("sv-sub").textContent = [altName(s), code ? S.tf("stopCode", code) : ""].filter(Boolean).join(" · ");
    $("sv-from").textContent = S.t("startHere");
    $("sv-to").textContent = S.t("goHere");
    selMarker(s);
    map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 16), offset: offsetFor("mid"), duration: 450 });
    /* lines serving the stop: quick chips */
    S.loadLines().then(() => {
      if (top() !== v) return;
      const box = $("sv-lines");
      box.innerHTML = "";
      const ls = (S.stopLines[v.idx] || []).map((i) => S.lines[i]).filter(Boolean);
      ls.forEach((l) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "rl-chip";
        b.title = S.lineName(l);
        b.innerHTML = S.lineBadge(l);
        b.addEventListener("click", () => S.openLine(l.key, { boardStop: v.idx }));
        box.appendChild(b);
      });
      box.hidden = !ls.length;
    });
    $("stop-view").scrollTop = 0;
    $("dep-list").innerHTML = '<div class="skeleton sm"></div><div class="skeleton sm"></div><div class="skeleton sm"></div>';
    $("sv-status").textContent = "";
    $("sv-foot").textContent = "";
    const load = (force) => S.getDepartures(v.idx, force).then((d) => { if (top() === v) paintDeps(v, d); }).catch(() => {});
    load(false);
    timers.push(setInterval(() => { if (!document.hidden) load(true); }, 30000));
    timers.push(setInterval(() => { const d = depCache.get(v.idx); if (d && top() === v) paintDeps(v, d, true); }, 15000));
    S.updatePeek();
  }
  function paintDeps(v, d, soft) {
    const list = $("dep-list");
    const st = $("sv-status");
    st.className = "sv-status" + (d.offline ? " off" : "");
    st.textContent = d.offline ? S.t("depsOfflineNote") : (!d.live && d.groups.length ? S.t("depsSchedNote") : "");
    $("sv-foot").textContent = d.offline ? "" : S.tf("depsUpdated", new Intl.DateTimeFormat(S.lang === "ka" ? "ka-GE" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tbilisi" }).format(new Date(d.at)));
    list.innerHTML = "";
    const groups = d.groups.filter((g) => g.times.some((t) => t.ms > Date.now() - 45000));
    if (!groups.length) { list.innerHTML = '<div class="empty">' + esc(S.t("noDepartures")) + "</div>"; return; }
    groups.forEach((g) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dep-row";
      const times = g.times.filter((t) => t.ms > Date.now() - 45000);
      const first = times[0];
      const mins = Math.round((first.ms - Date.now()) / 60000);
      b.innerHTML = S.lineBadge(g.line, "lg") +
        '<span class="dep-main"><span class="dep-head">' + esc(S.tf("toTerminal", stopName(g.term))) + '</span>' +
        '<span class="dep-more">' + times.slice(1).map((t) => esc(countdown(t.ms)) + (t.rt ? '<i class="rt-dot"></i>' : "")).join(" · ") + "</span></span>" +
        '<span class="dep-first' + (first.rt ? " rt" : "") + (mins <= 1 ? " soon" : "") + '">' +
          (first.rt ? '<i class="rt-dot" aria-label="' + esc(S.t("live")) + '"></i>' : "") +
          '<span class="dep-min">' + esc(countdown(first.ms)) + "</span>" +
          '<span class="dep-kind">' + esc(first.rt ? S.t("live") : S.t("scheduled")) + "</span></span>";
      if (g.line.key) {
        b.addEventListener("click", () => S.openLine(g.line.key, {
          boardStop: v.idx, termId: g.term.id, dirId: g.dirId, dirIdx: g.dirIdx,
          tripId: first.tripId, depMs: first.ms, depRt: first.rt,
        }));
      } else b.disabled = true;
      list.appendChild(b);
    });
  }
  function stopPlace(s) { return { name: s.en, nameKa: s.ka, lat: s.lat, lon: s.lon, type: "STOP", kind: s.kind }; }
  $("sv-from").addEventListener("click", () => {
    const v = top(); if (!v || v.kind !== "stop") return;
    const s = S.stops[v.idx];
    clearStack();
    S.setPlace("from", stopPlace(s));
    S.advance("from");
  });
  $("sv-to").addEventListener("click", () => {
    const v = top(); if (!v || v.kind !== "stop") return;
    goTo(stopPlace(S.stops[v.idx]), null);
  });

  /** Destination chosen from a stop/line: From = boarding stop › my location › current From › ask */
  function goTo(place, boardPlace) {
    clearStack();
    S.setPlace("to", place);
    const f = S.geo && S.geo.fix;
    if (boardPlace) S.setPlace("from", boardPlace);
    else if (f && Date.now() - f.t < 120000 && S.inTbilisi(f.lat, f.lon)) S.setPlace("from", { name: S.t("myLocation"), lat: f.lat, lon: f.lon, type: "PLACE", isGps: true });
    if (S.fromPlace && S.distM(S.fromPlace.lat, S.fromPlace.lon, place.lat, place.lon) < 30) S.setPlace("from", null);
    if (S.fromPlace) S.plan(); else S.enterPick("from");
  }

  /* ———————————————— LINE view ———————————————— */
  S.openLine = function (key, opts) {
    S.loadLines().then(() => {
      if (!S.lineByKey.get(key)) { S.toast(S.t("lineMissing"), true); return; }
      addRecentLine(key);
      push(Object.assign({ kind: "line", key, dir: null, board: null, sel: null, showPast: false }, opts || {}));
    });
  };
  S.openLineFromLeg = function (routeId, tripId, boardStopId) {
    const l = S.lineFromRouteId(routeId);
    if (!l) return;
    const bid = String(boardStopId || "").replace(RT_PREFIX, "");
    const bi = S.stopIndexById ? S.stopIndexById.get(bid) : null;
    S.openLine(l.key, { boardStop: bi != null ? bi : null, boardId: bid, tripId: tripId || null, termFromTrip: true });
  };
  /* padding from the sheet's target height (not its animating rect) */
  function sheetH(snap) {
    const vh = window.innerHeight;
    return snap === "peek" ? 76 : snap === "full" ? vh - 56 : Math.round(Math.min(vh * 0.46, 430));
  }
  function padFor(snap) {
    if (!S.isMobile()) return S.mapPadding();
    const h = Math.min(window.innerHeight - 200, sheetH(snap));
    return { top: 64, bottom: h + 24, left: 30, right: 30 };
  }
  function offsetFor(snap) {
    if (!S.isMobile()) return S.visibleCenterOffset();
    return [0, -sheetH(snap) / 2 + 20];
  }
  async function renderLine(v) {
    const l = S.lineByKey.get(v.key);
    S.setMode("line");
    S.setSheet(v.sheet || "mid");
    selMarker(null);
    $("lv-badge").innerHTML = S.lineBadge(l, "xl");
    $("lv-title").textContent = S.lineName(l);
    $("lv-sub").textContent = S.lineKind(l);
    $("lv-dirs").innerHTML = "";
    $("lv-board").hidden = true;
    $("lv-status").textContent = S.t("lineLoading");
    $("lv-stops").innerHTML = '<li class="skeleton sm"></li><li class="skeleton sm"></li><li class="skeleton sm"></li>';
    if (!v.ld) $("line-view").scrollTop = 0;
    S.updatePeek();
    let ld;
    try { ld = await S.loadLine(v.key); } catch (e) {
      if (top() !== v) return;
      $("lv-status").textContent = S.t("lineMissing");
      $("lv-stops").innerHTML = "";
      return;
    }
    if (top() !== v) return;
    v.ld = ld;
    /* resolve direction + boarding stop on first render */
    if (v.dir == null) {
      let di = v.dirIdx != null ? v.dirIdx : -1;
      if (di < 0 && v.termId) di = dirForTerminal(ld, v.termId, v.dirId);
      if (di < 0 && v.tripId && /-(\d):/.test(v.tripId)) {
        const m = v.tripId.match(new RegExp(ld.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(\\d)"));
        if (m) { const k = ld.dirs.findIndex((d) => String(d.d) === m[1]); if (k >= 0) di = k; }
      }
      if (di < 0 && v.boardStop != null) {
        /* from a stop chip: the direction in which this stop is not the terminal and has more stops ahead */
        const ids = new Set(S.stops[v.boardStop].ids);
        let best = -1, ahead = -1;
        ld.dirs.forEach((d, k) => { const j = d.stops.findIndex((s) => ids.has(s.id)); if (j >= 0 && d.stops.length - 1 - j > ahead) { ahead = d.stops.length - 1 - j; best = k; } });
        di = best;
      }
      if (di < 0 && S.geo && S.geo.fix) {
        /* nearest stop to me decides: pick the direction where it has more stops ahead */
        const f = S.geo.fix;
        let best = 0, bd = Infinity;
        ld.dirs.forEach((d, k) => d.stops.forEach((s, j) => {
          const dd = S.distM(f.lat, f.lon, s.lat, s.lon) - (d.stops.length - j) * 3;
          if (dd < bd) { bd = dd; best = k; }
        }));
        di = best;
      }
      v.dir = di < 0 ? 0 : di;
      setBoard(v);
    }
    paintLine(v, l, true);
  }
  function setBoard(v) {
    const dir = v.ld.dirs[v.dir];
    v.board = null;
    let ids = null;
    if (v.boardStop != null && S.stops[v.boardStop]) ids = new Set(S.stops[v.boardStop].ids);
    else if (v.boardId) ids = new Set([v.boardId]);
    if (ids) { const j = dir.stops.findIndex((s) => ids.has(s.id)); if (j >= 0) v.board = j; }
  }
  function paintLine(v, l, fit) {
    const ld = v.ld, dir = ld.dirs[v.dir];
    const term = dir.stops[dir.stops.length - 1];
    $("lv-title").textContent = S.tf("toTerminal", stopName(term));
    const hw = headway(dir);
    const sub = [S.lineKind(l)];
    if (hw && hw.every) sub.push(S.tf("everyMin", hw.every));
    if (hw && hw.first != null) sub.push(hhmm(hw.first) + "–" + hhmm(hw.last + dir.off[dir.off.length - 1]));
    if (!hw) sub.push(S.t("noServiceToday"));
    $("lv-sub").textContent = sub.join(" · ");
    /* direction switch, labelled by terminal */
    const dirsEl = $("lv-dirs");
    dirsEl.innerHTML = "";
    dirsEl.hidden = ld.dirs.length < 2;
    ld.dirs.forEach((d, k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lv-dir" + (k === v.dir ? " on" : "");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", k === v.dir ? "true" : "false");
      b.textContent = S.tf("toTerminal", stopName(d.stops[d.stops.length - 1]));
      b.addEventListener("click", () => {
        if (k === v.dir) return;
        v.dir = k; v.sel = null; v.tripTimes = null; v.tripId = null; v.depMs = null; v._triedTrip = false;
        setBoard(v); paintLine(v, l, true);
      });
      dirsEl.appendChild(b);
    });
    const notes = [];
    if (!dir.real) notes.push(S.t("shapeApprox"));
    if (!S.online) notes.push(S.t("depsOfflineNote"));
    $("lv-status").textContent = notes.join(" ");
    paintBoard(v, l);
    paintStops(v, l);
    drawLine(l, ld, v);
    if (fit) fitCoords(v.board != null ? dir.coords.slice(dir.si[v.board]) : dir.coords, 15.5);
    /* vehicles of this line (direction-filtered unless the feed's direction ids are unreliable) */
    if (S.showLineVehicles && S.online) {
      let minLat = 90, minLon = 180, maxLat = -90, maxLon = -180;
      dir.coords.forEach(([lon, lat]) => { minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); });
      const sameIds = ld.dirs.length > 1 && ld.dirs[0].d === ld.dirs[1].d;
      S.showLineVehicles({
        legs: [{ routeId: FEED + ld.id, dir: sameIds || l.type === 1 ? null : String(dir.d), routeShortName: l.code, tripId: v.tripId || null, mode: l.type === 1 ? "SUBWAY" : "BUS" }],
        color: l.color, min: [minLat - 0.004, minLon - 0.005], max: [maxLat + 0.004, maxLon + 0.005],
      });
    }
    if (v.tripId && !v.tripTimes && S.online) loadTripTimes(v, l);
    if (v._iv) clearInterval(v._iv);
    v._iv = setInterval(() => { if (top() === v && !document.hidden) { paintBoard(v, l); paintStops(v, l, true); } }, 30000);
    timers.push(v._iv);
    S.updatePeek();
  }
  /* boarding stop chosen from a line chip: use the next departure from live data when we can */
  function refreshBoardTrip(v, l) {
    if (v.board == null || !S.online) return;
    S.getDepartures(v.boardStop).then((d) => {
      if (top() !== v) return;
      const term = v.ld.dirs[v.dir].stops.slice(-1)[0].id;
      const g = d.groups.find((x) => x.line.key === v.key && x.term.id === term);
      if (g && g.times[0] && g.times[0].tripId) {
        v.tripId = g.times[0].tripId; v.depMs = g.times[0].ms; v.depRt = g.times[0].rt;
        loadTripTimes(v, l);
      }
    }).catch(() => {});
  }
  async function loadTripTimes(v, l) {
    try {
      const d = (await S.apiCached("/v5/trip?tripId=" + encodeURIComponent(v.tripId) + "&language=" + S.lang, S.TTL.trip)).body;
      if (top() !== v) return;
      const leg = (d.legs || [])[0];
      if (!leg) return;
      const tt = new Map();
      [leg.from].concat(leg.intermediateStops || [], [leg.to]).forEach((p) => {
        if (!p || !p.stopId) return;
        const id = String(p.stopId).replace(RT_PREFIX, "");
        const iso = p.departure || p.arrival || p.scheduledDeparture || p.scheduledArrival;
        if (iso) tt.set(id, { ms: Date.parse(iso), rt: !!leg.realTime });
      });
      v.tripTimes = tt;
      paintBoard(v, l); paintStops(v, l, true);
    } catch (e) { /* stay on timetable */ }
  }
  function paintBoard(v, l) {
    const el = $("lv-board");
    const dir = v.ld.dirs[v.dir];
    if (v.board == null) {
      el.hidden = true;
      if (v.boardStop != null && !v._triedTrip) { v._triedTrip = true; refreshBoardTrip(v, l); }
      return;
    }
    if (v.boardStop != null && !v.tripId && !v._triedTrip) { v._triedTrip = true; refreshBoardTrip(v, l); }
    const bs = dir.stops[v.board];
    let ms = null, rt = false;
    const t = v.tripTimes && v.tripTimes.get(bs.id);
    if (t) { ms = t.ms; rt = t.rt; } else if (v.depMs) { ms = v.depMs; rt = !!v.depRt; } else {
      const n = nextAt(dir, v.board, 1)[0];
      if (n != null) ms = minToMs(n);
    }
    el.hidden = false;
    el.innerHTML = '<span class="lb-label">' + esc(S.tf("boardNext", stopName(bs))) + "</span>" +
      (ms ? '<span class="lb-time' + (rt ? " rt" : "") + '">' + (rt ? '<i class="rt-dot"></i>' : "") + esc(countdown(ms)) +
        ' <span class="lb-kind">' + esc(rt ? S.t("live") : S.t("scheduled")) + "</span></span>" : "");
  }
  function paintStops(v, l, keepScroll) {
    const ol = $("lv-stops");
    const view = $("line-view");
    const scroll = view.scrollTop;
    const dir = v.ld.dirs[v.dir];
    ol.innerHTML = "";
    ol.style.setProperty("--lc", l.color);
    const nowMin = S.tbNow().min;
    /* times column */
    let mode = "next";
    let sched = null;
    if (v.board != null) {
      mode = "trip";
      if (!v.tripTimes) {
        /* timetable trip that reaches the boarding stop next (or the one at depMs) */
        const st = startsToday(dir);
        const target = v.depMs ? S.tbNow().min + (v.depMs - Date.now()) / 60000 : nowMin;
        const s0 = st.find((s) => s + dir.off[v.board] >= target - 1);
        if (s0 != null) sched = s0;
      }
    }
    const from = v.board != null && !v.showPast ? v.board : 0;
    if (from > 0) {
      const li = document.createElement("li");
      li.className = "lv-past-toggle";
      li.innerHTML = '<button type="button">' + esc(S.tf("earlierStops", from)) + "</button>";
      li.querySelector("button").addEventListener("click", () => { v.showPast = true; paintStops(v, l, true); });
      ol.appendChild(li);
    }
    for (let i = from; i < dir.stops.length; i++) {
      const s = dir.stops[i];
      const li = document.createElement("li");
      li.className = "lv-stop" + (v.board != null && i < v.board ? " past" : "") + (i === v.board ? " board" : "") + (i === v.sel ? " sel" : "") +
        (i === 0 ? " first" : "") + (i === dir.stops.length - 1 ? " last" : "");
      let time = "", rt = false;
      if (mode === "trip") {
        const t = v.tripTimes && v.tripTimes.get(s.id);
        if (t) { time = S.formatTime(new Date(t.ms).toISOString()); rt = t.rt; }
        else if (sched != null && i >= v.board) time = hhmm(sched + dir.off[i]);
      } else if (i < dir.stops.length - 1) {
        const n = nextAt(dir, i, 1)[0];
        if (n != null && n - nowMin < 120) time = S.tf("inMin", Math.round(n - nowMin));
      }
      li.innerHTML = '<button type="button" class="lv-row">' +
        '<span class="lv-time' + (rt ? " rt" : "") + '">' + esc(time) + "</span>" +
        '<span class="lv-rail" aria-hidden="true"><i></i></span>' +
        '<span class="lv-name">' + esc(stopName(s)) + "</span></button>" +
        (i === v.sel ? '<div class="lv-acts"><button type="button" class="btn-small primary" data-act="go">' + esc(S.t("goHere")) + "</button>" +
          '<button type="button" class="btn-small" data-act="deps">' + esc(S.t("departures")) + "</button></div>" : "");
      li.querySelector(".lv-row").addEventListener("click", () => selectLineStop(i, false));
      if (i === v.sel) {
        li.querySelector('[data-act="go"]').addEventListener("click", () => {
          const bs = v.board != null && v.board < i ? dir.stops[v.board] : null;
          const toPl = { name: s.en, nameKa: s.ka, lat: s.lat, lon: s.lon, type: "STOP" };
          goTo(toPl, bs ? { name: bs.en, nameKa: bs.ka, lat: bs.lat, lon: bs.lon, type: "STOP" } : null);
        });
        li.querySelector('[data-act="deps"]').addEventListener("click", () => {
          const mi = S.stopIndexById.get(s.id);
          if (mi != null) S.openStop(mi);
        });
      }
      ol.appendChild(li);
    }
    if (mode === "next") {
      const h = document.createElement("li");
      h.className = "lv-legend";
      h.textContent = S.t("nextBus") + " · " + S.t("scheduled");
      ol.insertBefore(h, ol.firstChild);
    }
    if (keepScroll) view.scrollTop = scroll;
  }
  function selectLineStop(i, fromMap) {
    const v = top();
    if (!v || v.kind !== "line" || !v.ld) return;
    const l = S.lineByKey.get(v.key);
    const dir = v.ld.dirs[v.dir];
    v.sel = v.sel === i && !fromMap ? null : i;
    if (v.sel != null && v.board != null && v.sel < v.board) v.showPast = true;
    paintStops(v, l, true);
    drawLine(l, v.ld, v);
    if (v.sel != null) {
      const s = dir.stops[i];
      map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 15), offset: S.visibleCenterOffset(), duration: 400 });
      const row = $("lv-stops").querySelector(".lv-stop.sel");
      if (row && fromMap) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (S.sheetSnap === "peek") S.setSheet("mid");
    }
  }

  /* —— peek bar text —— */
  S.peekOverride = function (peek, action) {
    const v = top();
    if (!v || (S.mode !== "stop" && S.mode !== "line")) return false;
    if (v.kind === "stop") {
      const s = S.stops[v.idx];
      peek.innerHTML = '<span class="peek-stop">' + stopIcon(s.kind) + "</span>";
      peek.appendChild(document.createTextNode(stopName(s)));
      action.textContent = S.t("departures");
    } else {
      const l = S.lineByKey.get(v.key);
      const dir = v.ld && v.ld.dirs[v.dir];
      peek.innerHTML = S.lineBadge(l) + " ";
      peek.appendChild(document.createTextNode(dir ? S.tf("toTerminal", stopName(dir.stops[dir.stops.length - 1])) : S.lineName(l)));
      action.textContent = "";
    }
    return true;
  };

  /* ———————————————— NEARBY row (pick card) ———————————————— */
  const nb = $("nearby");
  let nbStop = null, nbSeq = 0, nbTimer = null;
  function nearbyEligible() {
    const f = S.geo && S.geo.fix;
    return S.mode === "pick" && S.pickTarget === "from" && !S.pickEditing && !S.toPlace && !S.fromPlace &&
      f && Date.now() - f.t < 180000 && S.inTbilisi(f.lat, f.lon) && (S.stops || []).length;
  }
  function updateNearby() {
    if (!nearbyEligible()) { nb.hidden = true; clearInterval(nbTimer); nbTimer = null; return; }
    const f = S.geo.fix;
    const st = S.nearestStop(f.lat, f.lon, 600);
    if (!st) { nb.hidden = true; return; }
    const changed = !nbStop || nbStop.i !== st.i;
    nbStop = st;
    const d = Math.round(S.distM(f.lat, f.lon, st.lat, st.lon) / 10) * 10;
    $("nb-name").innerHTML = '<span class="nb-label">' + esc(S.t("nearby")) + "</span> " + esc(stopName(st)) + ' <span class="nb-dist">' + d + " m</span>";
    nb.hidden = false;
    if (changed) { $("nb-deps").innerHTML = '<span class="nb-wait">' + esc(S.t("depsLoading")) + "</span>"; loadNearbyDeps(); }
    if (!nbTimer) nbTimer = setInterval(() => { if (!document.hidden && nearbyEligible()) loadNearbyDeps(true); }, 30000);
    requestAnimationFrame(() => S.layoutOverlays && S.layoutOverlays());
  }
  function loadNearbyDeps(force) {
    const my = ++nbSeq, st = nbStop;
    S.getDepartures(st.i, force).then((d) => {
      if (my !== nbSeq || nbStop !== st) return;
      const g = d.groups.slice(0, 3);
      $("nb-deps").innerHTML = g.length ? g.map((x) => S.lineBadge(x.line) + '<span class="nb-min' + (x.times[0].rt ? " rt" : "") + '">' +
        (x.times[0].rt ? '<i class="rt-dot"></i>' : "") + esc(countdown(x.times[0].ms)) + "</span>").join("") :
        '<span class="nb-wait">' + esc(S.t("noDepartures")) + "</span>";
    }).catch(() => {});
  }
  nb.addEventListener("click", () => { if (nbStop) S.openStop(nbStop.i); });
  S.onGeoFix = function () { updateNearby(); };
  S.loadStops().then(() => updateNearby());

  /* —— language —— */
  S.applyLangLines = function () {
    $("stop-back").setAttribute("aria-label", S.t("back"));
    $("line-back").setAttribute("aria-label", S.t("back"));
    const v = top();
    if (v && (S.mode === "stop" || S.mode === "line")) {
      if (v.kind === "line" && v.ld) paintLine(v, S.lineByKey.get(v.key), false); else if (v.kind === "stop") show(v);
    }
    if (!nb.hidden) { nbStop = null; updateNearby(); }
  };
  S.applyLangLines();
  /* if the user opens the app with a line deep link: ?line=314 / ?stop=<gtfs id> */
  try {
    const qs = new URLSearchParams(location.search);
    const ql = qs.get("line"), qst = qs.get("stop");
    if (ql) S.loadLines().then(() => { const l = S.searchLines(ql)[0] || S.lineByKey.get(ql); if (l) S.openLine(l.key, {}); });
    else if (qst) S.loadStops().then(() => { const i = S.stopIndexById.get(qst); if (i != null) S.openStop(i); });
  } catch (e) { /* ignore */ }
})();
