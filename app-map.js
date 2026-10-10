/* Map (MapLibre + OSM raster), theme, markers, route lines, bottom sheet, center-pin picker, live locate */
(function () {
  const S = window.__tt;
  const $ = S.$;
  if (typeof maplibregl === "undefined") { console.warn("MapLibre GL missing"); return; }

  const b = S.TBILISI;
  const maxBounds = [[b.lonMin - 0.1, b.latMin - 0.1], [b.lonMax + 0.1, b.latMax + 0.1]];
  const saved = (() => { try { return JSON.parse(localStorage.getItem("tt-view")); } catch (e) { return null; } })();

  /* Raster paint per theme. Dark = luminance inverted + hue restored (no extra tile server). */
  function rasterPaint(dark) {
    return dark
      ? { "raster-brightness-min": 0.9, "raster-brightness-max": 0.06, "raster-hue-rotate": 180, "raster-saturation": -0.5, "raster-contrast": 0.15, "raster-fade-duration": 150 }
      : { "raster-brightness-min": 0, "raster-brightness-max": 1, "raster-hue-rotate": 0, "raster-saturation": -0.1, "raster-contrast": 0, "raster-fade-duration": 150 };
  }
  const STYLE = {
    version: 8,
    name: "OSM Raster",
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": S.isDark() ? "#1b2027" : "#eef0f2" } },
      { id: "osm", type: "raster", source: "osm", paint: rasterPaint(S.isDark()) },
    ],
  };

  /*
   * Gestures: one-finger pan, two-finger pinch-zoom (rotation off), double-tap zoom and
   * Android "double-tap-and-hold, drag" one-finger zoom (MapLibre TapDragZoomHandler, part of
   * touchZoomRotate). Nothing in the app listens to map taps any more, so the second tap is
   * never stolen by pin placement (that was what broke the gesture before).
   */
  const map = new maplibregl.Map({
    container: "map",
    style: STYLE,
    center: saved && saved.c ? saved.c : [b.center[1], b.center[0]],
    zoom: saved && saved.z ? saved.z : 13,
    maxBounds,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    cooperativeGestures: false,
    dragPan: true,
    touchZoomRotate: true,
    doubleClickZoom: true,
    scrollZoom: true,
    keyboard: true,
    fadeDuration: 0,
  });
  S.map = map;
  map.touchZoomRotate.disableRotation();

  const attrib = new maplibregl.AttributionControl({ compact: true });
  map.addControl(attrib, "bottom-right");
  if (!S.isMobile()) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  map.on("moveend", () => {
    const c = map.getCenter();
    try { localStorage.setItem("tt-view", JSON.stringify({ c: [+c.lng.toFixed(5), +c.lat.toFixed(5)], z: +map.getZoom().toFixed(2) })); } catch (e) { /* ignore */ }
  });

  /* —— Theme —— */
  function themeColors() {
    const dark = S.isDark();
    return {
      dark,
      casing: dark ? "#0d1014" : "#ffffff",
      walk: dark ? "#a3abb6" : "#5f6875",
      accFill: dark ? "rgba(96,165,250,0.16)" : "rgba(37,99,235,0.12)",
      accLine: dark ? "rgba(96,165,250,0.5)" : "rgba(37,99,235,0.4)",
    };
  }
  S.applyMapTheme = function () {
    const dark = S.isDark();
    if (!map.getLayer("osm")) return;
    const p = rasterPaint(dark);
    Object.keys(p).forEach((k) => map.setPaintProperty("osm", k, p[k]));
    map.setPaintProperty("bg", "background-color", dark ? "#1b2027" : "#eef0f2");
    const tc = themeColors();
    ["routes-alt-casing", "routes-sel-casing"].forEach((id) => map.getLayer(id) && map.setPaintProperty(id, "line-color", tc.casing));
    if (map.getLayer("user-acc-fill")) {
      map.setPaintProperty("user-acc-fill", "fill-color", tc.accFill);
      map.setPaintProperty("user-acc-line", "line-color", tc.accLine);
    }
    if (S.redrawRoutes) S.redrawRoutes();
  };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", S.applyMapTheme);

  /* —— Route layers —— */
  function ensureLayers() {
    if (map.getSource("routes")) return;
    const tc = themeColors();
    map.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource("user-acc", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "user-acc-fill", type: "fill", source: "user-acc", paint: { "fill-color": tc.accFill } });
    map.addLayer({ id: "user-acc-line", type: "line", source: "user-acc", paint: { "line-color": tc.accLine, "line-width": 1 } });
    const notSel = ["!=", ["get", "selected"], 1], sel = ["==", ["get", "selected"], 1];
    const walk = ["==", ["get", "walk"], 1], notWalk = ["!=", ["get", "walk"], 1];
    const round = { "line-join": "round", "line-cap": "round" };
    map.addLayer({ id: "routes-alt-casing", type: "line", source: "routes", filter: ["all", notSel, notWalk], layout: round,
      paint: { "line-color": tc.casing, "line-width": 7, "line-opacity": 0.85 } });
    map.addLayer({ id: "routes-alt", type: "line", source: "routes", filter: ["all", notSel, notWalk], layout: round,
      paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.8 } });
    map.addLayer({ id: "routes-alt-walk", type: "line", source: "routes", filter: ["all", notSel, walk], layout: round,
      paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-opacity": 0.6, "line-dasharray": [0.1, 2] } });
    map.addLayer({ id: "routes-sel-casing", type: "line", source: "routes", filter: ["all", sel, notWalk], layout: round,
      paint: { "line-color": tc.casing, "line-width": 11, "line-opacity": 0.95 } });
    map.addLayer({ id: "routes-sel", type: "line", source: "routes", filter: ["all", sel, notWalk], layout: round,
      paint: { "line-color": ["get", "color"], "line-width": 7 } });
    map.addLayer({ id: "routes-sel-walk", type: "line", source: "routes", filter: ["all", sel, walk], layout: round,
      paint: { "line-color": ["get", "color"], "line-width": 4, "line-dasharray": [0.1, 1.8] } });
  }
  const whenStyle = (fn) => (map.isStyleLoaded() ? fn() : map.once("load", fn));
  map.on("load", () => { ensureLayers(); S.applyMapTheme(); map.resize(); });

  S.decodePolyline = function (encoded, precision) {
    if (!encoded) return [];
    const factor = Math.pow(10, precision == null ? 5 : precision);
    let index = 0, lat = 0, lng = 0;
    const out = [];
    while (index < encoded.length) {
      let bb, shift = 0, result = 0;
      do { bb = encoded.charCodeAt(index++) - 63; result |= (bb & 0x1f) << shift; shift += 5; } while (bb >= 0x20);
      lat += result & 1 ? ~(result >> 1) : result >> 1;
      shift = 0; result = 0;
      do { bb = encoded.charCodeAt(index++) - 63; result |= (bb & 0x1f) << shift; shift += 5; } while (bb >= 0x20);
      lng += result & 1 ? ~(result >> 1) : result >> 1;
      out.push([lng / factor, lat / factor]);
    }
    return out;
  };
  S.legCoords = function (leg) {
    const g = leg.legGeometry || {};
    let c = S.decodePolyline(g.points || "", g.precision != null ? g.precision : 5);
    if (c.length < 2 && leg.from && leg.to) c = [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]];
    return c;
  };

  S.clearRoute = function () {
    S.drawn = null;
    whenStyle(() => { ensureLayers(); map.getSource("routes").setData({ type: "FeatureCollection", features: [] }); });
  };

  /** Draw every option at once (distinct colors); selected one thicker and on top */
  S.drawAllItineraries = function (list, selectedIdx, opts) {
    opts = opts || {};
    if (!list || !list.length) { S.clearRoute(); return; }
    const sel = selectedIdx == null ? 0 : selectedIdx;
    S.selectedItin = sel;
    S.drawn = { list, sel };
    whenStyle(() => {
      ensureLayers();
      const tc = themeColors();
      const features = [];
      const bounds = new maplibregl.LngLatBounds();
      list.forEach((it, i) => {
        const color = S.itinColor(i);
        const selected = i === sel ? 1 : 0;
        (it.legs || []).forEach((leg) => {
          const coords = S.legCoords(leg);
          if (coords.length < 2) return;
          const isWalk = (leg.mode || "WALK").toUpperCase() === "WALK" ? 1 : 0;
          features.push({ type: "Feature", properties: { color: isWalk ? tc.walk : color, walk: isWalk, selected, itin: i },
            geometry: { type: "LineString", coordinates: coords } });
          if (selected) coords.forEach((c) => bounds.extend(c));
        });
      });
      /* selected last so it renders above within the same layer group */
      features.sort((a, b2) => a.properties.selected - b2.properties.selected);
      map.getSource("routes").setData({ type: "FeatureCollection", features });
      if (opts.fit !== false && !bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: S.mapPadding(), maxZoom: 16, duration: opts.duration || 600 });
      }
    });
  };
  S.redrawRoutes = function () {
    if (S.drawn) S.drawAllItineraries(S.drawn.list, S.drawn.sel, { fit: false });
  };

  /* —— A/B markers for set points —— */
  const markers = { from: null, to: null };
  function pinEl(which) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "tt-pin " + which;
    el.innerHTML = '<span class="tt-pin-head">' + (which === "from" ? "A" : "B") + '</span><span class="tt-pin-tip"></span>';
    el.setAttribute("aria-label", S.t(which === "from" ? "editStart" : "editDest"));
    el.addEventListener("click", (e) => { e.stopPropagation(); if (S.enterPick) S.enterPick(which, { editing: true }); });
    return el;
  }
  S.syncMapMarkers = function () {
    ["from", "to"].forEach((w) => {
      const p = w === "from" ? S.fromPlace : S.toPlace;
      const hide = S.mode === "pick" && S.pickTarget === w;
      if (!p || hide) {
        if (markers[w]) { markers[w].remove(); markers[w] = null; }
        return;
      }
      if (!markers[w]) markers[w] = new maplibregl.Marker({ element: pinEl(w), anchor: "bottom" });
      markers[w].setLngLat([p.lon, p.lat]).addTo(map);
    });
  };

  /* —— Layout helpers —— */
  const panel = $("panel");
  const handle = $("panel-handle");
  function panelRect() { return panel.getBoundingClientRect(); }
  function safeTop() {
    const t = $("top-ui");
    return t ? Math.max(0, t.getBoundingClientRect().top - 8) : 0;
  }
  /** Screen point that is the "center" of the visible map (above sheet / right of card) */
  S.visibleCenter = function () {
    const W = window.innerWidth, H = window.innerHeight;
    const r = panelRect();
    if (S.isMobile()) {
      const bottom = S.mode === "search" ? H : Math.min(H, r.top);
      const top = 0 + safeTop();
      return { x: W / 2, y: Math.round(top + (bottom - top) / 2) };
    }
    const left = S.mode === "search" || panel.getAttribute("data-sheet") !== "peek" ? r.right : 0;
    return { x: Math.round(left + (W - left) / 2), y: Math.round(H / 2) };
  };
  S.visibleCenterOffset = function () {
    const p = S.visibleCenter();
    const c = map.getContainer().getBoundingClientRect();
    return [p.x - c.width / 2, p.y - c.height / 2];
  };
  S.mapPadding = function () {
    const r = panelRect();
    if (S.isMobile()) {
      const h = Math.max(0, window.innerHeight - r.top);
      return { top: 64 + safeTop(), bottom: Math.round(h) + 24, left: 28, right: 28 };
    }
    const peek = panel.getAttribute("data-sheet") === "peek";
    return { top: 48, bottom: 48, left: peek ? 48 : Math.round(r.right) + 32, right: 64 };
  };
  S.flyToPlace = function (lat, lon, zoom) {
    map.easeTo({ center: [lon, lat], zoom: zoom || Math.max(map.getZoom(), 16), offset: S.visibleCenterOffset(), duration: 450 });
  };

  /* Keep bottom-right controls + center pin clear of the panel */
  function layoutOverlays() {
    const r = panelRect();
    const H = window.innerHeight;
    const bottomGap = S.isMobile() && S.mode !== "search" ? Math.max(0, H - r.top) : 0;
    document.documentElement.style.setProperty("--panel-gap", Math.round(bottomGap) + "px");
    positionCenterPin();
  }
  S.layoutOverlays = layoutOverlays;
  if (window.ResizeObserver) new ResizeObserver(() => { layoutOverlays(); }).observe(panel);
  panel.addEventListener("transitionend", () => { layoutOverlays(); map.resize(); });

  /* —— Bottom sheet (trip mode, mobile): peek / mid / full —— */
  function snapHeights() {
    const vh = window.innerHeight;
    return { peek: 76, mid: Math.round(Math.min(vh * 0.46, 430)), full: Math.round(vh - 56) };
  }
  function applySheetHeight(px, animate) {
    panel.classList.toggle("sheet-dragging", !animate);
    panel.style.setProperty("--sheet-h", Math.round(px) + "px");
  }
  S.setSheet = function (snap, opts) {
    opts = opts || {};
    const name = ["peek", "mid", "full"].includes(snap) ? snap : "mid";
    S.sheetSnap = name;
    panel.setAttribute("data-sheet", name);
    handle.setAttribute("aria-expanded", name !== "peek" ? "true" : "false");
    if (S.isMobile()) applySheetHeight(snapHeights()[name], opts.animate !== false);
    else panel.style.removeProperty("--sheet-h");
    requestAnimationFrame(layoutOverlays);
    if (S.updatePeek) S.updatePeek();
  };

  let drag = null;
  function nearestSnap(h, v) {
    const s = snapHeights();
    if (Math.abs(v) > 0.6) {
      if (v > 0) return h > s.mid + 20 ? "mid" : "peek";
      return h < s.mid - 20 ? "mid" : "full";
    }
    let best = "peek", bd = Infinity;
    Object.keys(s).forEach((k) => { const d = Math.abs(h - s[k]); if (d < bd) { bd = d; best = k; } });
    return best;
  }
  function dragStart(y, id, fromBody) {
    drag = { startY: y, startH: panelRect().height, lastY: y, lastT: performance.now(), v: 0, moved: false, fromBody };
    if (!fromBody) { try { handle.setPointerCapture(id); } catch (e) { /* ignore */ } }
  }
  function dragMove(y) {
    if (!drag) return;
    const s = snapHeights();
    const h = Math.max(s.peek - 10, Math.min(s.full + 20, drag.startH + (drag.startY - y)));
    const now = performance.now();
    drag.v = (y - drag.lastY) / Math.max(1, now - drag.lastT);
    drag.lastY = y; drag.lastT = now;
    if (Math.abs(drag.startY - y) > 6) drag.moved = true;
    if (drag.moved) applySheetHeight(h, false);
  }
  function dragEnd() {
    if (!drag) return;
    const d = drag; drag = null;
    panel.classList.remove("sheet-dragging");
    if (!d.moved) {
      if (d.fromBody) return;
      const cur = S.sheetSnap || "mid";
      S.setSheet(cur === "peek" ? "mid" : cur === "mid" ? "full" : "mid");
      return;
    }
    S.setSheet(nearestSnap(panelRect().height, d.v));
  }
  handle.addEventListener("pointerdown", (e) => {
    if (S.mode !== "trip") return;
    if (!S.isMobile()) return;
    e.preventDefault();
    dragStart(e.clientY, e.pointerId, false);
  });
  handle.addEventListener("pointermove", (e) => { if (drag && !drag.fromBody) { e.preventDefault(); dragMove(e.clientY); } });
  handle.addEventListener("pointerup", () => {
    if (!S.isMobile()) { if (S.mode === "trip") S.setSheet(S.sheetSnap === "peek" ? "mid" : "peek"); return; }
    dragEnd();
  });
  handle.addEventListener("pointercancel", dragEnd);
  handle.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); S.setSheet(S.sheetSnap === "peek" ? "mid" : S.sheetSnap === "mid" ? "full" : "peek"); }
  });
  /* Pull the sheet down from the content when it is scrolled to top (Uber-like) */
  const tripView = $("trip-view");
  tripView.addEventListener("touchstart", (e) => {
    if (S.mode !== "trip" || !S.isMobile() || e.touches.length !== 1) return;
    if (tripView.scrollTop > 0) return;
    dragStart(e.touches[0].clientY, null, true);
    drag.armed = false;
  }, { passive: true });
  tripView.addEventListener("touchmove", (e) => {
    if (!drag || !drag.fromBody) return;
    const y = e.touches[0].clientY;
    const down = y - drag.startY;
    /* only take over for a downward pull, or upward pull while not yet full */
    if (!drag.armed) {
      if (Math.abs(down) < 8) return;
      if (down > 0 || S.sheetSnap !== "full") drag.armed = true;
      else { drag = null; return; }
    }
    e.preventDefault();
    dragMove(y);
  }, { passive: false });
  tripView.addEventListener("touchend", () => { if (drag && drag.fromBody) { if (drag.armed) dragEnd(); else drag = null; } });

  /* —— Center-pin picker —— */
  const cpin = $("center-pin");
  const bubble = $("pin-bubble");
  const addrEl = $("pin-addr");
  let pickSeq = 0, revTimer = null;
  S.pickLabel = null;

  function positionCenterPin() {
    if (cpin.hidden) return;
    const p = S.visibleCenter();
    cpin.style.left = p.x + "px";
    cpin.style.top = p.y + "px";
  }
  S.pickLngLat = function () {
    const p = S.visibleCenter();
    const c = map.getContainer().getBoundingClientRect();
    return map.unproject([p.x - c.left, p.y - c.top]);
  };
  function setPickAddr(text, state) {
    S.pickLabel = state === "ok" ? text : null;
    addrEl.textContent = text || "";
    bubble.classList.toggle("loading", state === "loading");
    bubble.hidden = !text;
    if (S.updatePickCard) S.updatePickCard();
  }
  function resolveCenter() {
    clearTimeout(revTimer);
    const seq = ++pickSeq;
    const ll = S.pickLngLat();
    if (!S.inTbilisi(ll.lat, ll.lng)) { setPickAddr(S.t("outsideCity"), "out"); return; }
    setPickAddr(S.t("resolving"), "loading");
    revTimer = setTimeout(async () => {
      const name = await S.reverseGeocode(ll.lat, ll.lng).catch(() => null);
      if (seq !== pickSeq || S.mode !== "pick") return;
      setPickAddr(name || S.t("droppedPin"), "ok");
    }, 450);
  }
  map.on("movestart", (e) => {
    if (e && e.originalEvent) S.userMovedMap = true;
    if (S.mode !== "pick") return;
    cpin.classList.add("lifted");
    ++pickSeq;
    bubble.hidden = true;
    S.pickLabel = null;
    if (S.updatePickCard) S.updatePickCard();
  });
  map.on("moveend", () => {
    if (S.mode !== "pick") return;
    cpin.classList.remove("lifted");
    resolveCenter();
  });
  S.showCenterPin = function (which) {
    cpin.hidden = false;
    cpin.setAttribute("data-target", which);
    $("cp-letter").textContent = which === "from" ? "A" : "B";
    requestAnimationFrame(() => { positionCenterPin(); resolveCenter(); });
  };
  S.resolvePickCenter = function () { if (S.mode === "pick") resolveCenter(); };
  S.hideCenterPin = function () { cpin.hidden = true; ++pickSeq; };
  S.centerPinOn = function (lat, lon, zoom) {
    map.easeTo({ center: [lon, lat], zoom: zoom || Math.max(map.getZoom(), 16), offset: S.visibleCenterOffset(), duration: 400 });
  };
  bubble.addEventListener("click", () => { if (S.confirmPick) S.confirmPick(); });

  /* —— Live "show me" locate control (watchPosition) —— */
  const geo = { state: "off", watchId: null, fix: null, marker: null, heading: null, first: false };
  S.geo = geo;
  class LocateControl {
    onAdd() {
      const wrap = document.createElement("div");
      wrap.className = "maplibregl-ctrl maplibregl-ctrl-group tt-locate";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "locate-btn";
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="lc-arrow" d="M12 2.5 19.5 20 12 16.2 4.5 20z"></path></svg>';
      btn.addEventListener("click", onLocateClick);
      wrap.appendChild(btn);
      this._el = wrap;
      geo.btn = btn;
      setGeoState("off");
      return wrap;
    }
    onRemove() { this._el.remove(); }
  }
  map.addControl(new LocateControl(), "bottom-right");

  function setGeoState(st) {
    geo.state = st;
    if (!geo.btn) return;
    geo.btn.setAttribute("data-state", st);
    const label = st === "follow" ? S.t("locateFollow") : st === "background" ? S.t("locateRecenter") : S.t("locateOn");
    geo.btn.title = label;
    geo.btn.setAttribute("aria-label", label);
    geo.btn.setAttribute("aria-pressed", st === "follow" || st === "background" ? "true" : "false");
  }
  S.updateLocateLabels = () => setGeoState(geo.state);

  function circlePoly(lon, lat, r) {
    const pts = [];
    const dLat = r / 111320, dLon = r / (111320 * Math.cos(lat * Math.PI / 180));
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
    }
    return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [pts] } };
  }
  function renderFix() {
    const f = geo.fix;
    if (!f) return;
    if (!geo.marker) {
      const el = document.createElement("div");
      el.className = "user-dot";
      el.innerHTML = '<span class="ud-cone"></span><span class="ud-core"></span>';
      geo.marker = new maplibregl.Marker({ element: el, anchor: "center", pitchAlignment: "map", rotationAlignment: "map" });
    }
    geo.marker.setLngLat([f.lon, f.lat]).addTo(map);
    const el = geo.marker.getElement();
    const hd = geo.heading;
    el.classList.toggle("has-heading", hd != null);
    if (hd != null) el.style.setProperty("--hd", hd + "deg");
    whenStyle(() => {
      ensureLayers();
      map.getSource("user-acc").setData({ type: "FeatureCollection", features: f.acc > 5 ? [circlePoly(f.lon, f.lat, Math.min(f.acc, 2000))] : [] });
    });
  }
  function followTo(f, first) {
    const opts = { center: [f.lon, f.lat], offset: S.visibleCenterOffset(), duration: first ? 700 : 500 };
    if (first) opts.zoom = Math.max(map.getZoom(), 16);
    map.easeTo(opts);
  }
  function onPos(pos) {
    const c = pos.coords;
    geo.fix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy || 0, t: Date.now() };
    if (c.heading != null && !isNaN(c.heading) && (c.speed || 0) > 0.7) geo.heading = c.heading;
    renderFix();
    if (geo.state === "waiting") {
      setGeoState("follow");
      if (!S.inTbilisi(c.latitude, c.longitude) && S.toast) S.toast(S.t("geoOutside"));
      followTo(geo.fix, true);
    } else if (geo.state === "follow") {
      followTo(geo.fix, false);
    }
  }
  function onPosErr(err) {
    let msg = S.t("geoUnavailable");
    if (err && err.code === 1) msg = S.t("geoDenied");
    else if (err && err.code === 3) msg = S.t("geoTimeout");
    if (S.toast) S.toast(msg, true);
    if (err && err.code === 1) stopGeo();
    else if (geo.state === "waiting") setGeoState("error");
  }
  function onOrient(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === "number") h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === "number") h = 360 - e.alpha;
    if (h == null) return;
    geo.heading = Math.round(h);
    if (geo.marker) {
      const el = geo.marker.getElement();
      el.classList.add("has-heading");
      el.style.setProperty("--hd", geo.heading + "deg");
    }
  }
  function startGeo() {
    if (!navigator.geolocation) { if (S.toast) S.toast(S.t("geoUnsupported"), true); return; }
    setGeoState("waiting");
    if (geo.fix && Date.now() - geo.fix.t < 15000) { setGeoState("follow"); followTo(geo.fix, true); }
    if (geo.watchId == null) {
      geo.watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
      window.addEventListener("deviceorientationabsolute", onOrient);
    }
  }
  function stopGeo() {
    if (geo.watchId != null) navigator.geolocation.clearWatch(geo.watchId);
    geo.watchId = null;
    window.removeEventListener("deviceorientationabsolute", onOrient);
    if (geo.marker) { geo.marker.remove(); geo.marker = null; }
    if (map.getSource("user-acc")) map.getSource("user-acc").setData({ type: "FeatureCollection", features: [] });
    geo.heading = null;
    setGeoState("off");
  }
  function onLocateClick() {
    if (geo.state === "off" || geo.state === "error") startGeo();
    else if (geo.state === "background") { setGeoState("follow"); if (geo.fix) followTo(geo.fix, false); }
    else stopGeo(); /* follow / waiting → off */
  }
  /* One-shot fix for "My location" rows (reuses the live watch when on) */
  S.getFix = function () {
    return new Promise((resolve, reject) => {
      if (geo.fix && Date.now() - geo.fix.t < 20000) return resolve(geo.fix);
      if (!navigator.geolocation) return reject({ code: -1 });
      navigator.geolocation.getCurrentPosition((pos) => {
        const c = pos.coords;
        geo.fix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy || 0, t: Date.now() };
        if (geo.state !== "off") renderFix();
        resolve(geo.fix);
      }, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 20000 });
    });
  };
  /* User panning breaks follow (pinch-zoom keeps it) */
  map.on("dragstart", () => { if (geo.state === "follow") setGeoState("background"); });

  window.addEventListener("resize", () => {
    map.resize();
    if (S.mode === "trip" && S.isMobile()) S.setSheet(S.sheetSnap || "mid", { animate: false });
    layoutOverlays();
  });
  setTimeout(() => map.resize(), 100);
})();
