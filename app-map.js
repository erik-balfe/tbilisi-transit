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

  const map = new maplibregl.Map({
    container: "map",
    style: OSM_STYLE,
    center: center,
    zoom: b.zoom,
    maxBounds: maxBounds,
    attributionControl: true,
    dragRotate: false,
    pitchWithRotate: false,
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

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
    hint.textContent = S.activePin === "to" ? S.t("mapHintTo") : S.t("mapHintFrom");
    S.$("pin-from").classList.toggle("active", S.activePin === "from");
    S.$("pin-to").classList.toggle("active", S.activePin === "to");
    refreshPinStyles();
  };

  function applyCoords(which, lat, lon, name) {
    const input = which === "from" ? S.fromInput : S.toInput;
    const place = S.placeFromLatLon(lat, lon, name);
    S.setPlace(which, place, input, { skipMap: true });
    placeMarker(which, lat, lon);
    S.statusEl.classList.remove("error");
    S.statusEl.textContent = which === "from" ? S.t("droppedFrom") : S.t("droppedTo");
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
          S.activePin = "from";
          S.updateMapHint();
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
          S.activePin = "to";
          S.updateMapHint();
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
    const collapsed = panel && panel.getAttribute("data-collapsed") === "true";
    const mobile = window.matchMedia("(max-width: 799px)").matches;
    if (mobile) {
      const h = collapsed ? 56 : Math.min(window.innerHeight * 0.45, 360);
      return { top: 48, bottom: h + 16, left: 24, right: 24 };
    }
    const w = collapsed ? 40 : Math.min(400, window.innerWidth * 0.4) + 24;
    return { top: 40, bottom: 40, left: w, right: 40 };
  };

  /* Google / OTP encoded polyline decoder (precision 5 or 6) */
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

  function modeStroke(mode, leg) {
    const m = (mode || "WALK").toUpperCase();
    if (leg && leg.routeColor && /^[0-9a-fA-F]{6}$/.test(leg.routeColor)) {
      return "#" + leg.routeColor;
    }
    if (m === "WALK") return "#8b9aab";
    if (m === "BUS") return "#3db8a0";
    if (["SUBWAY", "METRO", "RAIL", "TRAM"].includes(m)) return "#e07a3a";
    if (["GONDOLA", "CABLE_CAR", "FUNICULAR"].includes(m)) return "#7b6cf0";
    return "#3db8a0";
  }

  function ensureRouteLayers() {
    if (!map.getSource("route")) {
      map.addSource("route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        filter: ["!=", ["get", "walk"], 1],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#0a1210",
          "line-width": 9,
          "line-opacity": 0.55,
        },
      });
      map.addLayer({
        id: "route-transit",
        type: "line",
        source: "route",
        filter: ["!=", ["get", "walk"], 1],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 6,
          "line-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "route-walk",
        type: "line",
        source: "route",
        filter: ["==", ["get", "walk"], 1],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 3.5,
          "line-opacity": 0.9,
          "line-dasharray": [1.2, 1.2],
        },
      });
    }
    routeReady = true;
  }

  S.clearRoute = function () {
    if (!routeReady || !map.getSource("route")) return;
    map.getSource("route").setData({ type: "FeatureCollection", features: [] });
  };

  S.drawItineraryRoute = function (it) {
    if (!it) {
      S.clearRoute();
      return;
    }
    const run = () => {
      ensureRouteLayers();
      const features = [];
      const bounds = new maplibregl.LngLatBounds();
      let any = false;
      (it.legs || []).forEach((leg, i) => {
        const geom = leg.legGeometry || {};
        const precision = geom.precision != null ? geom.precision : 5;
        let coords = S.decodePolyline(geom.points || "", precision);
        if (coords.length < 2 && leg.from && leg.to) {
          coords = [
            [leg.from.lon, leg.from.lat],
            [leg.to.lon, leg.to.lat],
          ];
        }
        if (coords.length < 2) return;
        const mode = (leg.mode || "WALK").toUpperCase();
        const walk = mode === "WALK" ? 1 : 0;
        features.push({
          type: "Feature",
          properties: {
            color: modeStroke(mode, leg),
            walk: walk,
            mode: mode,
            idx: i,
          },
          geometry: { type: "LineString", coordinates: coords },
        });
        coords.forEach((c) => {
          bounds.extend(c);
          any = true;
        });
      });
      map.getSource("route").setData({ type: "FeatureCollection", features: features });
      if (any && !bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: S.mapPadding(), maxZoom: 15, duration: 700 });
      }
    };
    if (map.isStyleLoaded()) run();
    else map.once("load", run);
  };

  map.on("click", (e) => {
    /* Ignore clicks that hit markers (they stopPropagation), or UI */
    let { lng, lat } = e.lngLat;
    if (!S.inTbilisi(lat, lng)) {
      S.statusEl.textContent = S.t("outsideCity");
      S.statusEl.classList.add("error");
      return;
    }
    applyCoords(S.activePin, lat, lng);
  });

  S.$("pin-from").addEventListener("click", () => {
    S.activePin = "from";
    S.updateMapHint();
  });
  S.$("pin-to").addEventListener("click", () => {
    S.activePin = "to";
    S.updateMapHint();
  });

  /* Panel collapse for max map space */
  const panel = S.$("panel");
  const toggle = S.$("panel-toggle");
  function setCollapsed(collapsed) {
    if (!panel) return;
    panel.setAttribute("data-collapsed", collapsed ? "true" : "false");
    if (toggle) toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    setTimeout(() => map.resize(), 60);
  }
  if (toggle) {
    toggle.addEventListener("click", () => {
      const now = panel.getAttribute("data-collapsed") === "true";
      setCollapsed(!now);
    });
  }
  /* Mobile starts slightly open; user can collapse */
  if (window.matchMedia("(max-width: 799px)").matches) {
    setCollapsed(false);
  }

  S.map = map;
  S.dropPin = function (which, lat, lon, name) {
    if (!S.inTbilisi(lat, lon)) {
      S.statusEl.textContent = S.t("outsideCity");
      S.statusEl.classList.add("error");
      return false;
    }
    applyCoords(which, lat, lon, name);
    map.easeTo({ center: [lon, lat], duration: 400 });
    return true;
  };

  S.expandPanel = function () {
    setCollapsed(false);
  };
  S.collapsePanel = function () {
    setCollapsed(true);
  };

  map.on("load", () => {
    ensureRouteLayers();
    map.resize();
  });
  window.addEventListener("resize", () => map.resize());
  /* Fix size after fonts / layout settle */
  setTimeout(() => map.resize(), 80);
  setTimeout(() => map.resize(), 400);

  S.updateMapHint();
})();
