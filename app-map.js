(function () {
  const S = window.__tt;
  if (typeof L === "undefined") {
    console.warn("Leaflet missing");
    return;
  }

  const b = S.TBILISI;
  const bounds = L.latLngBounds([b.latMin, b.lonMin], [b.latMax, b.lonMax]);

  function pinIcon(which, active) {
    const label = which === "from" ? "A" : "B";
    const cls = "tt-pin " + which + (active ? " active" : "");
    return L.divIcon({
      className: cls,
      html: '<div class="tt-pin-inner"><span>' + label + "</span></div>",
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -28],
    });
  }

  const map = L.map("map", {
    center: b.center,
    zoom: b.zoom,
    maxBounds: bounds.pad(0.15),
    maxBoundsViscosity: 0.85,
    zoomControl: true,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    maxZoom: 19,
  }).addTo(map);

  /* Soft mask hint — keep pans inside city */
  map.setMaxBounds(bounds.pad(0.15));

  let fromMarker = null;
  let toMarker = null;

  function refreshPinStyles() {
    if (fromMarker) fromMarker.setIcon(pinIcon("from", S.activePin === "from"));
    if (toMarker) toMarker.setIcon(pinIcon("to", S.activePin === "to"));
  }

  S.updateMapHint = function () {
    const hint = S.$("map-hint");
    if (!hint) return;
    hint.textContent = S.activePin === "to" ? S.t("mapHintTo") : S.t("mapHintFrom");
    S.$("pin-from").classList.toggle("active", S.activePin === "from");
    S.$("pin-to").classList.toggle("active", S.activePin === "to");
    refreshPinStyles();
  };

  function placeMarker(which, lat, lon) {
    const ll = L.latLng(lat, lon);
    if (which === "from") {
      if (fromMarker) {
        fromMarker.setLatLng(ll);
      } else {
        fromMarker = L.marker(ll, { draggable: true, icon: pinIcon("from", S.activePin === "from") }).addTo(map);
        fromMarker.on("dragend", () => {
          const p = fromMarker.getLatLng();
          if (!S.inTbilisi(p.lat, p.lng)) {
            const [clat, clon] = S.clampToTbilisi(p.lat, p.lng);
            fromMarker.setLatLng([clat, clon]);
            S.statusEl.textContent = S.t("outsideCity");
            S.statusEl.classList.add("error");
            applyCoords("from", clat, clon);
            return;
          }
          applyCoords("from", p.lat, p.lng);
        });
        fromMarker.on("click", () => {
          S.activePin = "from";
          S.updateMapHint();
        });
      }
    } else {
      if (toMarker) {
        toMarker.setLatLng(ll);
      } else {
        toMarker = L.marker(ll, { draggable: true, icon: pinIcon("to", S.activePin === "to") }).addTo(map);
        toMarker.on("dragend", () => {
          const p = toMarker.getLatLng();
          if (!S.inTbilisi(p.lat, p.lng)) {
            const [clat, clon] = S.clampToTbilisi(p.lat, p.lng);
            toMarker.setLatLng([clat, clon]);
            S.statusEl.textContent = S.t("outsideCity");
            S.statusEl.classList.add("error");
            applyCoords("to", clat, clon);
            return;
          }
          applyCoords("to", p.lat, p.lng);
        });
        toMarker.on("click", () => {
          S.activePin = "to";
          S.updateMapHint();
        });
      }
    }
    refreshPinStyles();
  }

  function applyCoords(which, lat, lon, name) {
    const input = which === "from" ? S.fromInput : S.toInput;
    const place = S.placeFromLatLon(lat, lon, name);
    S.setPlace(which, place, input, { skipMap: true });
    placeMarker(which, lat, lon);
    S.statusEl.classList.remove("error");
    S.statusEl.textContent = which === "from" ? S.t("droppedFrom") : S.t("droppedTo");
  }

  S.syncMapMarkers = function () {
    if (S.fromPlace) placeMarker("from", S.fromPlace.lat, S.fromPlace.lon);
    else if (fromMarker) { map.removeLayer(fromMarker); fromMarker = null; }
    if (S.toPlace) placeMarker("to", S.toPlace.lat, S.toPlace.lon);
    else if (toMarker) { map.removeLayer(toMarker); toMarker = null; }
    refreshPinStyles();
    fitPins();
  };

  function fitPins() {
    const pts = [];
    if (S.fromPlace) pts.push([S.fromPlace.lat, S.fromPlace.lon]);
    if (S.toPlace) pts.push([S.toPlace.lat, S.toPlace.lon]);
    if (pts.length === 2) {
      map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 14, animate: true });
    } else if (pts.length === 1) {
      map.panTo(pts[0]);
    }
  }

  map.on("click", (e) => {
    let { lat, lng } = e.latlng;
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

  S.map = map;
  S.dropPin = function (which, lat, lon, name) {
    if (!S.inTbilisi(lat, lon)) {
      S.statusEl.textContent = S.t("outsideCity");
      S.statusEl.classList.add("error");
      return false;
    }
    applyCoords(which, lat, lon, name);
    map.panTo([lat, lon]);
    return true;
  };

  /* Fix grey tiles when container was sized late */
  setTimeout(() => map.invalidateSize(), 50);
  window.addEventListener("resize", () => map.invalidateSize());

  S.updateMapHint();
})();
