(function () {
  const { API, PRESETS, I18N, TBILISI, ITIN_COLORS } = window.TT;
  const S = (window.__tt = {
    API, PRESETS, I18N, TBILISI, ITIN_COLORS,
    lang: localStorage.getItem("tt-lang") || "en",
    fromPlace: null,
    toPlace: null,
    activePin: "from",
    /* pinMode: "from" | "to" | "none" — none = map pans freely, pins only via Move/drag */
    pinMode: "from",
    timers: { from: null, to: null },
    reverseSeq: { from: 0, to: 0 },
    selectedItin: 0,
    lastItineraries: [],
  });
  const $ = (id) => document.getElementById(id);
  S.$ = $;
  S.fromInput = $("from");
  S.toInput = $("to");
  S.fromSuggest = $("from-suggest");
  S.toSuggest = $("to-suggest");
  S.statusEl = $("status");
  S.resultsEl = $("results");
  S.goBtn = $("go");
  S.pasteInput = $("paste");

  S.t = function (key) {
    const pack = S.I18N[S.lang] || S.I18N.en;
    return pack[key];
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
  /** Soft pad (~13 km) — warn but still allow pin */
  S.nearTbilisi = function (lat, lon) {
    const b = S.TBILISI;
    const pad = 0.12;
    return lat >= b.latMin - pad && lat <= b.latMax + pad &&
      lon >= b.lonMin - pad && lon <= b.lonMax + pad;
  };
  S.clampToTbilisi = function (lat, lon) {
    const b = S.TBILISI;
    return [
      Math.min(b.latMax, Math.max(b.latMin, lat)),
      Math.min(b.lonMax, Math.max(b.lonMin, lon)),
    ];
  };
  S.isCoordLabel = function (name) {
    if (!name) return true;
    return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(String(name).trim());
  };
  S.applyLang = function () {
    document.documentElement.lang = S.lang;
    $("title").textContent = S.t("title");
    const mini = $("title-mini");
    if (mini) mini.textContent = S.t("title");
    const sheetHint = $("sheet-hint");
    if (sheetHint) sheetHint.textContent = S.t("sheetOpen");
    $("label-from").textContent = S.t("from");
    $("label-to").textContent = S.t("to");
    S.goBtn.textContent = S.t("go");
    $("swap").title = S.t("swap");
    $("swap").setAttribute("aria-label", S.t("swap"));
    ["loc-from", "loc-to"].forEach((id) => {
      const btn = $(id);
      if (!btn) return;
      btn.title = S.t("useMyLocation");
      btn.setAttribute("aria-label", S.t("useMyLocation"));
    });
    const pfs = $("preset-fs");
    const psf = $("preset-sf");
    if (pfs) pfs.textContent = S.t("presetFS");
    if (psf) psf.textContent = S.t("presetSF");
    $("footer").innerHTML = S.t("footer");
    $("lang-en").classList.toggle("active", S.lang === "en");
    $("lang-ka").classList.toggle("active", S.lang === "ka");
    const more = $("label-more");
    if (more) more.textContent = S.t("more");
    const lp = $("label-paste");
    if (lp) lp.textContent = S.t("paste");
    const le = $("label-examples");
    if (le) le.textContent = S.t("examples");
    $("use-as-from").textContent = S.t("useAsFrom");
    $("use-as-to").textContent = S.t("useAsTo");
    const editChip = $("edit-trip-chip");
    if (editChip) editChip.textContent = S.t("edit");
    ["move-from", "move-to"].forEach((id) => {
      const btn = $(id);
      if (btn) btn.textContent = S.t("movePin");
    });
    if (S.updateMapHint) S.updateMapHint();
    if (S.updatePeek) S.updatePeek();
    if (S.fromPlace && !S.isCoordLabel(S.fromPlace.name)) S.fromInput.value = S.displayName(S.fromPlace);
    if (S.toPlace && !S.isCoordLabel(S.toPlace.name)) S.toInput.value = S.displayName(S.toPlace);
    if (S.updateTripSummary) S.updateTripSummary();
  };
  S.formatTime = function (iso) {
    if (!iso) return "—";
    try {
      return new Intl.DateTimeFormat(S.lang === "ka" ? "ka-GE" : "en-GB", {
        timeZone: "Asia/Tbilisi", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(new Date(iso));
    } catch (e) { return iso.slice(11, 16); }
  };
  S.formatDuration = function (sec) {
    return Math.round((sec || 0) / 60) + " " + S.t("duration");
  };
  S.transferLabel = function (n) {
    if (!n) return S.t("transfers0");
    if (n === 1) return S.t("transfers1");
    return S.t("transfersN")(n);
  };
  S.modeLabel = function (mode) {
    const m = (mode || "").toUpperCase();
    if (m === "WALK") return S.t("walk");
    if (m === "BUS") return S.t("bus");
    if (m === "SUBWAY" || m === "METRO" || m === "RAIL" || m === "TRAM") return S.t("metro");
    if (m === "GONDOLA" || m === "CABLE_CAR" || m === "FUNICULAR") return S.t("gondola");
    return mode || "?";
  };
  S.modeClass = function (mode) {
    const m = (mode || "WALK").toUpperCase();
    if (["SUBWAY", "METRO", "RAIL", "TRAM"].includes(m)) return "mode-SUBWAY";
    if (["GONDOLA", "CABLE_CAR", "FUNICULAR"].includes(m)) return "mode-GONDOLA";
    if (m === "BUS") return "mode-BUS";
    return "mode-WALK";
  };
  S.filterTbilisi = function (results) {
    const pool = (results || []).filter((r) =>
      r && typeof r.lat === "number" && typeof r.lon === "number" && S.inTbilisi(r.lat, r.lon)
    );
    const ge = pool.filter((r) => !r.country || r.country === "GE");
    const use = ge.length ? ge : pool;
    const stops = use.filter((r) => r.type === "STOP");
    const rest = use.filter((r) => r.type !== "STOP");
    return stops.concat(rest).slice(0, 8);
  };
  S.areaHint = function (r) {
    const areas = (r.areas || []).map((a) => a.name).filter(Boolean);
    const bits = [r.type === "STOP" ? "Stop" : (r.type || "Place")].concat(areas.slice(-2));
    return bits.filter(Boolean).join(" · ");
  };
  S.apiGet = async function (path) {
    const res = await fetch(S.API + path, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error("HTTP " + res.status + (text ? ": " + text.slice(0, 80) : ""));
    }
    return res.json();
  };
  S.nominatimSearch = async function (text) {
    const b = S.TBILISI;
    const viewbox = [b.lonMin, b.latMax, b.lonMax, b.latMin].join(",");
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6" +
      "&countrycodes=ge&bounded=1&viewbox=" + encodeURIComponent(viewbox) +
      "&q=" + encodeURIComponent(text.trim());
    const res = await fetch(url, {
      headers: { Accept: "application/json", "Accept-Language": S.lang === "ka" ? "ka,en" : "en" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (Array.isArray(data) ? data : [])
      .map((r) => {
        const lat = parseFloat(r.lat);
        const lon = parseFloat(r.lon);
        if (!S.inTbilisi(lat, lon)) return null;
        const name = (r.namedetails && (r.namedetails.name || r.namedetails["name:en"])) ||
          (r.display_name || "").split(",")[0] || "Place";
        return {
          type: "PLACE",
          name,
          lat, lon,
          country: "GE",
          id: "nominatim:" + r.osm_type + "/" + r.osm_id,
          areas: [{ name: "Tbilisi" }],
        };
      })
      .filter(Boolean);
  };

  /** Friendly label from Nominatim reverse JSON — never raw coords */
  S.friendlyFromNominatim = function (data) {
    if (!data) return null;
    const addr = data.address || {};
    const road =
      addr.road || addr.pedestrian || addr.footway || addr.path ||
      addr.neighbourhood || addr.suburb || addr.quarter || addr.city_district;
    const amenity = addr.amenity || addr.tourism || addr.shop || addr.building || addr.public_building;
    const area = addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || addr.city;
    if (data.name && data.name.length < 60 && !S.isCoordLabel(data.name)) {
      if (area && area !== data.name) return data.name + " · " + area;
      return data.name;
    }
    if (amenity && road) return amenity + " · " + road;
    if (amenity) return amenity + (area ? " · " + area : "");
    if (road && area) return road + " · " + area;
    if (road) return road;
    if (area) return S.t("droppedPin") + " · " + area;
    const first = (data.display_name || "").split(",")[0];
    if (first && !S.isCoordLabel(first)) return first;
    return S.t("droppedPin");
  };

  S.reverseGeocode = async function (lat, lon) {
    const url =
      "https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&zoom=17" +
      "&lat=" + encodeURIComponent(lat) + "&lon=" + encodeURIComponent(lon);
    const res = await fetch(url, {
      headers: { Accept: "application/json", "Accept-Language": S.lang === "ka" ? "ka,en" : "en" },
    });
    if (!res.ok) return null;
    return S.friendlyFromNominatim(await res.json());
  };

  S.geocode = async function (text) {
    const q = encodeURIComponent(text.trim());
    const bias = S.TBILISI.center[0] + "," + S.TBILISI.center[1];
    let data = [];
    try {
      data = await S.apiGet(
        "/v1/geocode?text=" + q + "&language=" + S.lang + "&place=" + encodeURIComponent(bias)
      );
    } catch (e) {
      data = [];
    }
    let filtered = S.filterTbilisi(Array.isArray(data) ? data : []);
    if (filtered.length < 2) {
      try {
        const extra = await S.nominatimSearch(text);
        const seen = new Set(filtered.map((r) => r.name + "|" + r.lat.toFixed(4)));
        extra.forEach((r) => {
          const k = r.name + "|" + r.lat.toFixed(4);
          if (!seen.has(k)) { filtered.push(r); seen.add(k); }
        });
      } catch (e) { /* ignore */ }
    }
    return S.filterTbilisi(filtered).slice(0, 8);
  };
  S.placeFromResult = function (r) {
    return { name: r.name, lat: r.lat, lon: r.lon, id: r.id, type: r.type, country: r.country || "GE" };
  };
  S.placeFromLatLon = function (lat, lon, name) {
    const n = name || S.t("droppedPin");
    return { name: n, lat, lon, type: "PLACE", country: "GE", pendingLabel: !name };
  };
  S.setPlace = function (which, place, inputEl, opts) {
    opts = opts || {};
    if (which === "from") {
      S.fromPlace = place;
      S.fromInput.classList.toggle("has-place", !!place);
    } else {
      S.toPlace = place;
      S.toInput.classList.toggle("has-place", !!place);
    }
    if (place && inputEl) {
      const label = S.displayName(place);
      /* Never show raw lat,lon in the field */
      inputEl.value = S.isCoordLabel(label) ? S.t("droppedPin") : label;
    }
    if (!opts.skipMap && S.syncMapMarkers) S.syncMapMarkers();
    if (S.updateTripSummary) S.updateTripSummary();
    if (S.updatePeek) S.updatePeek();
    if (S.updateMovePinButtons) S.updateMovePinButtons();
    if (!opts.skipAdvance && place) {
      if (S.afterPlaceSet) S.afterPlaceSet(which, opts);
    }
  };

  /** After pin drop: show friendly placeholder, then reverse-geocode */
  S.resolvePinLabel = async function (which, lat, lon) {
    const seq = ++S.reverseSeq[which];
    const input = which === "from" ? S.fromInput : S.toInput;
    const place = which === "from" ? S.fromPlace : S.toPlace;
    if (place && place.lat === lat && place.lon === lon) {
      place.name = S.t("droppedPin");
      place.pendingLabel = true;
      input.value = place.name;
    }
    try {
      const name = await S.reverseGeocode(lat, lon);
      if (seq !== S.reverseSeq[which]) return;
      const cur = which === "from" ? S.fromPlace : S.toPlace;
      if (!cur || Math.abs(cur.lat - lat) > 1e-6 || Math.abs(cur.lon - lon) > 1e-6) return;
      if (name) {
        cur.name = name;
        cur.pendingLabel = false;
        input.value = name;
        if (S.updateTripSummary) S.updateTripSummary();
      }
    } catch (e) {
      /* keep "Dropped pin" */
    }
  };

  S.renderSuggest = function (box, items, which, inputEl) {
    box.innerHTML = "";
    if (!items.length) { box.classList.remove("open"); return; }
    items.forEach((r, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "option");
      if (i === 0) btn.classList.add("active");
      btn.innerHTML = '<div class="name"></div><div class="meta"></div>';
      btn.querySelector(".name").textContent = r.name;
      btn.querySelector(".meta").textContent = S.areaHint(r);
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const other = which === "from" ? S.toPlace : S.fromPlace;
        S.setPlace(which, S.placeFromResult(r), inputEl, {
          triggerPlan: !!other,
        });
        box.classList.remove("open");
        if (S.setSheet && S.sheetSnap !== "peek") S.setSheet("mid");
      });
      box.appendChild(btn);
    });
    box.classList.add("open");
  };
  S.debounceGeocode = function (which) {
    clearTimeout(S.timers[which]);
    S.timers[which] = setTimeout(async () => {
      const inputEl = which === "from" ? S.fromInput : S.toInput;
      const box = which === "from" ? S.fromSuggest : S.toSuggest;
      const text = inputEl.value.trim();
      S.setPlace(which, null, null, { skipMap: true, skipAdvance: true });
      inputEl.classList.remove("has-place");
      if (S.syncMapMarkers) S.syncMapMarkers();
      if (text.length < 2) { box.classList.remove("open"); return; }
      try {
        S.statusEl.textContent = S.t("searching");
        S.statusEl.classList.remove("error");
        S.renderSuggest(box, await S.geocode(text), which, inputEl);
        S.statusEl.textContent = "";
      } catch (err) {
        S.statusEl.textContent = S.t("error");
        S.statusEl.classList.add("error");
        box.classList.remove("open");
      }
    }, 280);
  };

  S.setPanelMode = function (mode) {
    const panel = $("panel");
    if (!panel) return;
    panel.setAttribute("data-mode", mode);
    const summary = $("trip-summary");
    if (summary) {
      if (mode === "results" && S.fromPlace && S.toPlace) {
        summary.hidden = false;
        S.updateTripSummary();
      } else {
        summary.hidden = true;
      }
    }
    if (S.afterPanelLayout) S.afterPanelLayout();
  };

  S.updateTripSummary = function () {
    const a = $("sum-from");
    const b = $("sum-to");
    if (!a || !b) return;
    a.textContent = S.fromPlace ? S.displayName(S.fromPlace) : "—";
    b.textContent = S.toPlace ? S.displayName(S.toPlace) : "—";
  };

  /**
   * Pin state machine:
   * - from: next map tap / search / GPS sets From
   * - to: next sets To (auto after From in 99% path)
   * - none: both set; map pans freely; Move pin / field focus / drag to adjust
   */
  S.armPinField = function (which) {
    if (which !== "from" && which !== "to") {
      S.pinMode = "none";
      S.activePin = null;
    } else {
      S.pinMode = which;
      S.activePin = which;
    }
    $("from-field").classList.toggle("armed", S.pinMode === "from");
    $("to-field").classList.toggle("armed", S.pinMode === "to");
    if (S.updateMapHint) S.updateMapHint();
    if (S.updateMovePinButtons) S.updateMovePinButtons();
    if (S.updatePeek) S.updatePeek();
  };

  S.disarmPins = function () {
    S.armPinField(null);
  };

  S.updateMovePinButtons = function () {
    const mf = $("move-from");
    const mt = $("move-to");
    const both = !!(S.fromPlace && S.toPlace);
    if (mf) {
      mf.hidden = !both;
      mf.classList.toggle("active", S.pinMode === "from");
    }
    if (mt) {
      mt.hidden = !both;
      mt.classList.toggle("active", S.pinMode === "to");
    }
  };

  S.updatePeek = function () {
    const peek = $("peek-text");
    const action = $("peek-action");
    if (!peek) return;
    if (S.fromPlace && S.toPlace) {
      const a = S.displayName(S.fromPlace) || "A";
      const b = S.displayName(S.toPlace) || "B";
      peek.innerHTML =
        '<span class="peek-a"></span><span class="peek-arrow">→</span><span class="peek-b"></span>';
      peek.querySelector(".peek-a").textContent = a;
      peek.querySelector(".peek-b").textContent = b;
      if (action) {
        action.hidden = false;
        const n = (S.lastItineraries && S.lastItineraries.length) || 0;
        action.textContent = n ? (typeof S.t("routesFound") === "function" ? S.t("routesFound")(n) : n + "") : S.t("peekSwipe");
      }
    } else if (S.fromPlace && !S.toPlace) {
      peek.textContent = S.t("chooseDestination");
      if (action) { action.hidden = false; action.textContent = S.t("peekSwipe"); }
    } else if (!S.fromPlace && S.toPlace) {
      peek.textContent = S.t("chooseStart");
      if (action) { action.hidden = false; action.textContent = S.t("peekSwipe"); }
    } else {
      peek.textContent = S.t("peekPlan");
      if (action) { action.hidden = false; action.textContent = S.t("peekSwipe"); }
    }
  };

  /**
   * After a place is set: advance arming for the common path; auto-plan when second lands.
   * opts.autoPlan (default true for map/gps/suggest) — caller can disable.
   * opts.fromUserFocus — don't re-advance if only focusing.
   */
  S.afterPlaceSet = function (which, opts) {
    opts = opts || {};
    const both = !!(S.fromPlace && S.toPlace);
    if (both) {
      S.disarmPins();
      if (opts.autoPlan !== false && S.plan && !opts.skipPlan) {
        /* Second end just placed — plan (map/GPS/suggest). Not on every keystroke. */
        if (opts.triggerPlan) S.plan();
      }
      if (S.updatePeek) S.updatePeek();
      return;
    }
    if (which === "from" && S.fromPlace && !S.toPlace) {
      S.armPinField("to");
      if (S.statusEl && !S.statusEl.classList.contains("error")) {
        S.statusEl.textContent = S.t("chooseDestination");
      }
    } else if (which === "to" && S.toPlace && !S.fromPlace) {
      S.armPinField("from");
      if (S.statusEl && !S.statusEl.classList.contains("error")) {
        S.statusEl.textContent = S.t("chooseStart");
      }
    } else if (!S.fromPlace && !S.toPlace) {
      S.armPinField("from");
    }
    if (S.updatePeek) S.updatePeek();
  };
})();
