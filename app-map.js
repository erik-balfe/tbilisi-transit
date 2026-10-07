(function () {
  const S = window.__tt;
  if (typeof maplibregl === "undefined") {
    console.warn("MapLibre GL missing");
    return;
  }

  const b = S.TBILISI;
  /* MapLibre uses [lng, lat] */
  const center = [b.center[1], b.center[0]];
  const maxBounds = [
    [b.lonMin - 0.08, b.latMin - 0.08],
    [b.lonMax + 0.08, b.latMax + 0.08],
  ];

  const OSM_STYLE = {
    version: 8,
    name: "OSM Raster",
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      osm: {
        type: "raster",
        tiles: [
          "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxzoom: 19,
      },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  };

  /*
   * Touch / pan diagnosis + fix:
   * - MapLibre supports 1-finger dragPan and 2-finger pinch (touchZoomRotate).
   * - Prior issues: (1) oversized bottom sheet left almost no map hit area;
   *   (2) no explicit cooperativeGestures:false / dragPan.enable;
   *   (3) missing touch-action:none on #map canvas (browser could steal gestures);
   *   (4) panel resize without reliable map.resize().
   * Fixes: mid-height sheet by default, touch-action CSS, explicit gesture flags,
   * disable rotation so 2-finger stays pinch+pan, resize after every sheet change.
   */
  const map = new maplibregl.Map({
    container: "map",
    style: OSM_STYLE,
    center: center,
    zoom: b.zoom,
    maxBounds: maxBounds,
    attributionControl: true,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    cooperativeGestures: false,
    dragPan: true,
    touchZoomRotate: true,
    scrollZoom: true,
    boxZoom: true,
    keyboard: true,
    doubleClickZoom: true,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  map.on("load", () => {
    /* Ensure handlers are on after style settles */
    map.dragPan.enable();
    map.touchZoomRotate.enable();
    map.touchZoomRotate.disableRotation(); /* 2-finger = pinch zoom (+ pan), no rotate */
    map.scrollZoom.enable();
    ensureRouteLayers();
    map.resize();
  });

  let fromMarker = null;
  let toMarker = null;
  let routeReady = false;

  function pinEl(which, active) {
    const el = document.createElement("div");
    const label = which === "from" ? "A" : "B";
    el.className = "tt-pin " + which + (active ? " active" : "");
    el.innerHTML = '<div class="tt-pin-inner"><span>' + label + "</span></div>";
    el.title = which === "from" ? "From" : "To";
    return el;
  }

  function refreshPinStyles() {
    if (fromMarker) {
      const el = fromMarker.getElement();
      el.className = "tt-pin from" + (S.activePin === "from" ? " active" : "");
    }
    if (toMarker) {
      const el = toMarker.getElement();
      el.className = "tt-pin to" + (S.activePin === "to" ? " active" : "");
    }
  }

  S.updateMapHint = function () {
    const hint = S.$("map-hint");
    if (!hint) return;
    const mode = S.pinMode || S.activePin || "from";
    let key = "mapHintFrom";
    let expect = false;
    if (mode === "none") {
      key = "mapHintBoth";
    } else if (mode === "to") {
      key = S.fromPlace ? "mapHintTo" : "mapHintMoveTo";
      expect = true;
    } else {
      /* from */
      if (S.fromPlace && S.toPlace) key = "mapHintMoveFrom";
      else if (S.toPlace && !S.fromPlace) key = "mapHintMoveFrom";
      else key = "mapHintFrom";
      expect = !!(S.toPlace && !S.fromPlace);
    }
    hint.textContent = S.t(key);
    hint.classList.toggle("expect", expect);
    refreshPinStyles();
    const ff = S.$("from-field");
    const tf = S.$("to-field");
    if (ff) ff.classList.toggle("armed", mode === "from");
    if (tf) tf.classList.toggle("armed", mode === "to");
    if (S.updateMovePinButtons) S.updateMovePinButtons();
  };

  function applyCoords(which, lat, lon, name, opts) {
    opts = opts || {};
    const input = which === "from" ? S.fromInput : S.toInput;
    const other = which === "from" ? S.toPlace : S.fromPlace;
    const place = S.placeFromLatLon(lat, lon, name);
    S.setPlace(which, place, input, {
      skipMap: true,
      triggerPlan: !!other && opts.autoPlan !== false,
      skipPlan: opts.skipPlan,
    });
    placeMarker(which, lat, lon);
    S.statusEl.classList.remove("error");
    if (!(S.fromPlace && S.toPlace)) {
      S.statusEl.textContent = which === "from" ? S.t("chooseDestination") : S.t("chooseStart");
    } else {
      S.statusEl.textContent = which === "from" ? S.t("droppedFrom") : S.t("droppedTo");
    }
    /* Reverse-geocode unless caller already provided a real name */
    if (!name || S.isCoordLabel(name)) {
      if (S.resolvePinLabel) S.resolvePinLabel(which, lat, lon);
    }
  }

  function placeMarker(which, lat, lon) {
    const lngLat = [lon, lat];
    if (which === "from") {
      if (fromMarker) {
        fromMarker.setLngLat(lngLat);
      } else {
        fromMarker = new maplibregl.Marker({
          element: pinEl("from", S.activePin === "from"),
          draggable: true,
          anchor: "bottom",
        })
          .setLngLat(lngLat)
          .addTo(map);
        fromMarker.on("dragend", () => {
          const p = fromMarker.getLngLat();
          if (!S.inTbilisi(p.lat, p.lng)) {
            const [clat, clon] = S.clampToTbilisi(p.lat, p.lng);
            fromMarker.setLngLat([clon, clat]);
            S.statusEl.textContent = S.t("outsideCity");
            S.statusEl.classList.add("error");
            applyCoords("from", clat, clon);
            return;
          }
          applyCoords("from", p.lat, p.lng);
        });
        fromMarker.getElement().addEventListener("click", (e) => {
          e.stopPropagation();
          /* Explicit: tap existing pin to arm move for uncommon re-pick */
          if (S.armPinField) S.armPinField("from");
          else { S.activePin = "from"; S.updateMapHint(); }
        });
      }
    } else {
      if (toMarker) {
        toMarker.setLngLat(lngLat);
      } else {
        toMarker = new maplibregl.Marker({
          element: pinEl("to", S.activePin === "to"),
          draggable: true,
          anchor: "bottom",
        })
          .setLngLat(lngLat)
          .addTo(map);
        toMarker.on("dragend", () => {
          const p = toMarker.getLngLat();
          if (!S.inTbilisi(p.lat, p.lng)) {
            const [clat, clon] = S.clampToTbilisi(p.lat, p.lng);
            toMarker.setLngLat([clon, clat]);
            S.statusEl.textContent = S.t("outsideCity");
            S.statusEl.classList.add("error");
            applyCoords("to", clat, clon);
            return;
          }
          applyCoords("to", p.lat, p.lng);
        });
        toMarker.getElement().addEventListener("click", (e) => {
          e.stopPropagation();
          if (S.armPinField) S.armPinField("to");
          else { S.activePin = "to"; S.updateMapHint(); }
        });
      }
    }
    refreshPinStyles();
  }

  S.syncMapMarkers = function () {
    if (S.fromPlace) placeMarker("from", S.fromPlace.lat, S.fromPlace.lon);
    else if (fromMarker) {
      fromMarker.remove();
      fromMarker = null;
    }
    if (S.toPlace) placeMarker("to", S.toPlace.lat, S.toPlace.lon);
    else if (toMarker) {
      toMarker.remove();
      toMarker = null;
    }
    refreshPinStyles();
    fitPins();
  };

  function fitPins() {
    const pts = [];
    if (S.fromPlace) pts.push([S.fromPlace.lon, S.fromPlace.lat]);
    if (S.toPlace) pts.push([S.toPlace.lon, S.toPlace.lat]);
    if (pts.length === 2) {
      const bounds = new maplibregl.LngLatBounds(pts[0], pts[1]);
      map.fitBounds(bounds, { padding: S.mapPadding(), maxZoom: 14, duration: 600 });
    } else if (pts.length === 1) {
      map.easeTo({ center: pts[0], duration: 400 });
    }
  }

  S.mapPadding = function () {
    const panel = S.$("panel");
    const mobile = window.matchMedia("(max-width: 799px)").matches;
    if (mobile) {
      let h = 64;
      if (panel) {
        const rect = panel.getBoundingClientRect();
        if (rect.height > 0) h = rect.height;
      }
      return { top: 48, bottom: Math.round(h) + 10, left: 20, right: 20 };
    }
    const peek = panel && panel.getAttribute("data-sheet") === "peek";
    const w = peek ? 40 : Math.min(380, window.innerWidth * 0.38) + 20;
    return { top: 36, bottom: 36, left: w, right: 36 };
  };

  S.decodePolyline = function (encoded, precision) {
    if (!encoded) return [];
    const factor = Math.pow(10, precision == null ? 5 : precision);
    let index = 0;
    const len = encoded.length;
    let lat = 0;
    let lng = 0;
    const coordinates = [];
    while (index < len) {
      let b;
      let shift = 0;
      let result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += dlat;
      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += dlng;
      coordinates.push([lng / factor, lat / factor]);
    }
    return coordinates;
  };

  function ensureRouteLayers() {
    if (map.getSource("routes")) {
      routeReady = true;
      return;
    }
    map.addSource("routes", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    /* Dim alternatives first (under), then selected on top */
    map.addLayer({
      id: "routes-alt-casing",
      type: "line",
      source: "routes",
      filter: ["all", ["!=", ["get", "selected"], 1], ["!=", ["get", "walk"], 1]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#0a1210",
        "line-width": 6,
        "line-opacity": 0.35,
      },
    });
    map.addLayer({
      id: "routes-alt",
      type: "line",
      source: "routes",
      filter: ["all", ["!=", ["get", "selected"], 1], ["!=", ["get", "walk"], 1]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 3.5,
        "line-opacity": 0.55,
      },
    });
    map.addLayer({
      id: "routes-alt-walk",
      type: "line",
      source: "routes",
      filter: ["all", ["!=", ["get", "selected"], 1], ["==", ["get", "walk"], 1]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 2.5,
        "line-opacity": 0.45,
        "line-dasharray": [1.2, 1.4],
      },
    });
    map.addLayer({
      id: "routes-sel-casing",
      type: "line",
      source: "routes",
      filter: ["all", ["==", ["get", "selected"], 1], ["!=", ["get", "walk"], 1]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#0a1210",
        "line-width": 10,
        "line-opacity": 0.6,
      },
    });
    map.addLayer({
      id: "routes-sel",
      type: "line",
      source: "routes",
      filter: ["all", ["==", ["get", "selected"], 1], ["!=", ["get", "walk"], 1]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 6.5,
        "line-opacity": 0.98,
      },
    });
    map.addLayer({
      id: "routes-sel-walk",
      type: "line",
      source: "routes",
      filter: ["all", ["==", ["get", "selected"], 1], ["==", ["get", "walk"], 1]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 3.5,
        "line-opacity": 0.9,
        "line-dasharray": [1.2, 1.2],
      },
    });
    routeReady = true;
  }

  function legCoords(leg) {
    const geom = leg.legGeometry || {};
    const precision = geom.precision != null ? geom.precision : 5;
    let coords = S.decodePolyline(geom.points || "", precision);
    if (coords.length < 2 && leg.from && leg.to) {
      coords = [
        [leg.from.lon, leg.from.lat],
        [leg.to.lon, leg.to.lat],
      ];
    }
    return coords;
  }

  S.clearRoute = function () {
    if (!routeReady || !map.getSource("routes")) return;
    map.getSource("routes").setData({ type: "FeatureCollection", features: [] });
  };

  /** Draw all itineraries at once; selectedIdx is thicker/brighter */
  S.drawAllItineraries = function (list, selectedIdx, opts) {
    opts = opts || {};
    if (!list || !list.length) {
      S.clearRoute();
      return;
    }
    const sel = selectedIdx == null ? 0 : selectedIdx;
    S.selectedItin = sel;
    const run = () => {
      ensureRouteLayers();
      const features = [];
      const bounds = new maplibregl.LngLatBounds();
      let any = false;
      const colors = S.ITIN_COLORS || ["#3db8a0", "#5b8def", "#e07a3a"];
      list.forEach((it, itinIdx) => {
        const color = colors[itinIdx % colors.length];
        const selected = itinIdx === sel ? 1 : 0;
        (it.legs || []).forEach((leg, i) => {
          const coords = legCoords(leg);
          if (coords.length < 2) return;
          const mode = (leg.mode || "WALK").toUpperCase();
          const walk = mode === "WALK" ? 1 : 0;
          /* Walk legs use muted gray for alts; selected walk stays gray dashed */
          const lineColor = walk ? (selected ? "#8b9aab" : "#6a7a8a") : color;
          features.push({
            type: "Feature",
            properties: {
              color: lineColor,
              walk: walk,
              mode: mode,
              itin: itinIdx,
              selected: selected,
              idx: i,
            },
            geometry: { type: "LineString", coordinates: coords },
          });
          if (selected || opts.fitAll) {
            coords.forEach((c) => {
              bounds.extend(c);
              any = true;
            });
          }
        });
      });
      /* If nothing selected extended bounds, fit all */
      if (!any) {
        features.forEach((f) => {
          (f.geometry.coordinates || []).forEach((c) => {
            bounds.extend(c);
            any = true;
          });
        });
      }
      map.getSource("routes").setData({ type: "FeatureCollection", features: features });
      if (any && !bounds.isEmpty() && opts.fit !== false) {
        map.fitBounds(bounds, { padding: S.mapPadding(), maxZoom: 15, duration: opts.duration || 700 });
      }
    };
    if (map.isStyleLoaded()) run();
    else map.once("load", run);
  };

  /* Back-compat single draw */
  S.drawItineraryRoute = function (it) {
    if (!it) {
      S.clearRoute();
      return;
    }
    const list = S.lastItineraries && S.lastItineraries.length ? S.lastItineraries : [it];
    const idx = list.indexOf(it);
    S.drawAllItineraries(list, idx >= 0 ? idx : 0);
  };

  map.on("click", (e) => {
    const mode = S.pinMode || S.activePin;
    if (!mode || mode === "none") {
      /* Both ends set — map pans freely; don't steal taps */
      return;
    }
    let { lng, lat } = e.lngLat;
    if (!S.inTbilisi(lat, lng)) {
      S.statusEl.textContent = S.t("outsideCity");
      S.statusEl.classList.add("error");
      return;
    }
    applyCoords(mode, lat, lng);
  });

  /* —— Draggable bottom sheet: peek / mid / full —— */
  const panel = S.$("panel");
  const handle = S.$("panel-handle");

  function isMobileSheet() {
    return window.matchMedia("(max-width: 799px)").matches;
  }

  function snapHeights() {
    const vh = window.innerHeight;
    const safe = 0;
    return {
      peek: Math.round(Math.min(72, vh * 0.12) + 8),
      mid: Math.round(Math.min(vh * 0.42, 400)),
      full: Math.round(Math.min(vh * 0.78, vh - 48)),
    };
  }

  function resizeMapSoon() {
    requestAnimationFrame(() => {
      map.resize();
      setTimeout(() => map.resize(), 60);
      setTimeout(() => map.resize(), 280);
    });
  }
  S.afterPanelLayout = resizeMapSoon;

  function applySheetHeight(px, animate) {
    if (!panel || !isMobileSheet()) return;
    if (!animate) panel.classList.add("sheet-dragging");
    else panel.classList.remove("sheet-dragging");
    panel.style.setProperty("--sheet-h", Math.round(px) + "px");
    if (animate) resizeMapSoon();
  }

  function setSheetSnap(snap, opts) {
    opts = opts || {};
    if (!panel) return;
    const heights = snapHeights();
    const name = snap === "peek" || snap === "mid" || snap === "full" ? snap : "mid";
    S.sheetSnap = name;
    panel.setAttribute("data-sheet", name);
    if (handle) handle.setAttribute("aria-expanded", name !== "peek" ? "true" : "false");
    if (isMobileSheet()) {
      applySheetHeight(heights[name], opts.animate !== false);
    } else {
      panel.style.removeProperty("--sheet-h");
      resizeMapSoon();
    }
    if (S.updatePeek) S.updatePeek();
  }

  S.setSheet = function (sheet) {
    setSheetSnap(sheet, { animate: true });
  };
  S.expandPanel = function () {
    setSheetSnap("mid", { animate: true });
  };
  S.collapsePanel = function () {
    setSheetSnap("peek", { animate: true });
  };

  /* Redefine mapPadding from actual sheet height */
  S.mapPadding = function () {
    const mobile = isMobileSheet();
    if (mobile) {
      let h = 64;
      if (panel) {
        const rect = panel.getBoundingClientRect();
        h = rect.height || snapHeights()[S.sheetSnap || "mid"];
      }
      return { top: 48, bottom: Math.round(h) + 10, left: 20, right: 20 };
    }
    const peek = panel && panel.getAttribute("data-sheet") === "peek";
    const w = peek ? 40 : Math.min(380, window.innerWidth * 0.38) + 20;
    return { top: 36, bottom: 36, left: w, right: 36 };
  };

  /* Drag logic (touch + mouse) on handle */
  let drag = null;

  function nearestSnap(h, velocityY) {
    const s = snapHeights();
    /* velocityY > 0 means finger moved down → prefer smaller sheet */
    if (Math.abs(velocityY) > 0.7) {
      if (velocityY > 0) {
        if (h > s.mid + 20) return "mid";
        return "peek";
      }
      if (h < s.mid - 20) return "mid";
      return "full";
    }
    const pts = [
      ["peek", s.peek],
      ["mid", s.mid],
      ["full", s.full],
    ];
    let best = pts[0];
    let bestD = Math.abs(h - pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const d = Math.abs(h - pts[i][1]);
      if (d < bestD) { best = pts[i]; bestD = d; }
    }
    return best[0];
  }

  function onDragStart(clientY, pointerId) {
    if (!panel || !isMobileSheet()) return;
    const rect = panel.getBoundingClientRect();
    drag = {
      startY: clientY,
      startH: rect.height,
      lastY: clientY,
      lastT: performance.now(),
      velocityY: 0,
      pointerId: pointerId,
      moved: false,
    };
    panel.classList.add("sheet-dragging");
    try {
      if (handle && pointerId != null) handle.setPointerCapture(pointerId);
    } catch (e) { /* ignore */ }
  }

  function onDragMove(clientY) {
    if (!drag) return;
    const dy = drag.startY - clientY; /* up = positive → taller */
    const s = snapHeights();
    let h = drag.startH + dy;
    h = Math.max(s.peek - 8, Math.min(s.full + 24, h));
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    /* velocity in px/ms of finger Y (down positive) */
    drag.velocityY = (clientY - drag.lastY) / dt;
    drag.lastY = clientY;
    drag.lastT = now;
    if (Math.abs(drag.startY - clientY) > 6) drag.moved = true;
    applySheetHeight(h, false);
  }

  function onDragEnd() {
    if (!drag) return;
    const rect = panel.getBoundingClientRect();
    const wasTap = !drag.moved;
    const v = drag.velocityY;
    drag = null;
    panel.classList.remove("sheet-dragging");
    if (wasTap) {
      /* Tap handle: peek→mid→full→peek */
      const cur = panel.getAttribute("data-sheet") || "mid";
      if (cur === "peek") setSheetSnap("mid");
      else if (cur === "mid") setSheetSnap("full");
      else setSheetSnap("peek");
      return;
    }
    setSheetSnap(nearestSnap(rect.height, v));
  }

  if (handle) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      if (!isMobileSheet()) {
        /* Desktop: click toggles peek ↔ mid */
        return;
      }
      e.preventDefault();
      onDragStart(e.clientY, e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!drag) return;
      e.preventDefault();
      onDragMove(e.clientY);
    });
    handle.addEventListener("pointerup", (e) => {
      if (!isMobileSheet() && !drag) {
        const cur = panel.getAttribute("data-sheet") || "mid";
        setSheetSnap(cur === "peek" ? "mid" : "peek");
        return;
      }
      onDragEnd();
    });
    handle.addEventListener("pointercancel", () => onDragEnd());
    handle.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const cur = panel.getAttribute("data-sheet") || "mid";
        if (cur === "peek") setSheetSnap("mid");
        else if (cur === "mid") setSheetSnap("full");
        else setSheetSnap("peek");
      }
    });
  }

  S.map = map;
  S.dropPin = function (which, lat, lon, name, opts) {
    opts = opts || {};
    if (!S.inTbilisi(lat, lon)) {
      if (!(opts.allowNear && S.nearTbilisi && S.nearTbilisi(lat, lon))) {
        S.statusEl.textContent = S.t("outsideCity");
        S.statusEl.classList.add("error");
        return false;
      }
    }
    applyCoords(which, lat, lon, name, { autoPlan: opts.autoPlan !== false, skipPlan: opts.skipPlan });
    map.easeTo({ center: [lon, lat], duration: 400 });
    return true;
  };

  window.addEventListener("resize", () => {
    map.resize();
    if (panel && isMobileSheet()) {
      const snap = panel.getAttribute("data-sheet") || "mid";
      setSheetSnap(snap, { animate: false });
    }
  });

  /* Init sheet */
  S.sheetSnap = "mid";
  if (panel) {
    if (isMobileSheet()) setSheetSnap("mid", { animate: false });
    else panel.setAttribute("data-sheet", "mid");
  }
  setTimeout(() => map.resize(), 80);
  setTimeout(() => map.resize(), 400);

  S.updateMapHint();
  if (S.updatePeek) S.updatePeek();
})();
