/* Flows: pick (center pin) → search (typing) → trip (results); planning + rendering */
(function () {
  const S = window.__tt;
  const $ = S.$;
  const panel = $("panel");
  const esc = S.escapeHtml;

  /* —— Toast —— */
  const toastEl = document.createElement("div");
  toastEl.className = "toast";
  toastEl.setAttribute("role", "status");
  document.body.appendChild(toastEl);
  let toastT = null;
  S.toast = function (msg, isErr) {
    toastEl.textContent = msg;
    toastEl.classList.toggle("error", !!isErr);
    toastEl.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove("show"), 3200);
  };

  /* —— Modes —— */
  S.setMode = function (mode) {
    S.mode = mode;
    panel.setAttribute("data-mode", mode);
    document.documentElement.setAttribute("data-mode", mode);
    if (mode === "pick") S.showCenterPin(S.pickTarget); else S.hideCenterPin();
    if (S.stopVehicles) S.stopVehicles();
    if (S.isSheetMode(mode)) S.setSheet(S.sheetSnap && S.sheetSnap !== "full" ? S.sheetSnap : "mid");
    else panel.style.removeProperty("--sheet-h");
    S.syncMapMarkers();
    requestAnimationFrame(() => { S.layoutOverlays(); S.map.resize(); });
    S.updatePeek();
    if (S.onMode) S.onMode(mode);
  };

  /* —— Pick mode —— */
  S.updatePickCard = function () {
    const w = S.pickTarget;
    const editing = !!S.pickEditing;
    $("pick-title").textContent = editing ? S.t(w === "from" ? "editStart" : "editDest") : S.t(w === "from" ? "chooseStart" : "chooseDestination");
    $("pick-card").setAttribute("data-target", w);
    const conf = $("pick-confirm");
    conf.textContent = S.t(w === "from" ? "fromHere" : "toHere");
    const ll = S.pickLngLat ? S.pickLngLat() : null;
    conf.disabled = !!(ll && !S.inTbilisi(ll.lat, ll.lng));
    const cancel = $("pick-cancel");
    const canBack = editing || (w === "to" && !!S.fromPlace) || (w === "from" && !!S.toPlace);
    cancel.hidden = !canBack;
    cancel.textContent = editing ? S.t("cancel") : S.t("back");
    const addr = $("pick-addr");
    addr.textContent = S.pickLabel || S.t("searchAddr");
    addr.classList.toggle("placeholder", !S.pickLabel);
    $("pick-msg").textContent = "";
  };
  S.enterPick = function (which, opts) {
    opts = opts || {};
    S.pickTarget = which;
    S.pickEditing = !!opts.editing;
    S.setMode("pick");
    S.updatePickCard();
    const p = which === "from" ? S.fromPlace : S.toPlace;
    const c = opts.center || (p ? [p.lat, p.lon] : null);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (c) S.centerPinOn(c[0], c[1]);
    }));
  };
  S.confirmPick = function () {
    if (S.mode !== "pick") return;
    const ll = S.pickLngLat();
    if (!S.inTbilisi(ll.lat, ll.lng)) { $("pick-msg").textContent = S.t("outsideCity"); return; }
    const which = S.pickTarget;
    const place = S.placeFromLatLon(ll.lat, ll.lng, S.pickLabel);
    S.setPlace(which, place);
    if (place.pendingLabel) S.resolvePlaceLabel(which);
    S.advance(which);
  };
  /** Common path continues on its own: From → To → plan */
  S.advance = function (justSet) {
    if (S.fromPlace && S.toPlace) { S.plan(); return; }
    S.enterPick(!S.fromPlace ? "from" : "to");
  };
  function pickCancel() {
    const w = S.pickTarget;
    if (S.pickEditing && S.fromPlace && S.toPlace) {
      S.setMode("trip");
      S.redrawRoutes();
      if (S.showVehicles) S.showVehicles(S.selectedItin || 0);
      return;
    }
    S.enterPick(w === "to" ? "from" : "to");
  }

  /* —— Search mode (keyboard) —— */
  let searchSnapshot = null;
  S.enterSearch = function (field) {
    if (S.mode !== "search") {
      S.searchPrev = S.mode;
      searchSnapshot = { from: S.fromPlace, to: S.toPlace };
    }
    S.searchField = field;
    try { if (!(history.state && history.state.tts)) history.pushState({ tts: 1 }, ""); } catch (e) { /* ignore */ }
    S.fromInput.value = S.displayName(S.fromPlace);
    S.toInput.value = S.displayName(S.toPlace);
    S.setMode("search");
    const input = field === "from" ? S.fromInput : S.toInput;
    input.focus({ preventScroll: true });
    input.select();
    markActiveField();
    renderList();
  };
  function markActiveField() {
    $("from-field").classList.toggle("active", S.searchField === "from");
    $("to-field").classList.toggle("active", S.searchField === "to");
  }
  S.resume = function (changed) {
    if (S.fromPlace && S.toPlace) {
      if (changed || !S.lastItineraries.length) S.plan();
      else { S.setMode("trip"); S.redrawRoutes(); if (S.showVehicles) S.showVehicles(S.selectedItin || 0); }
      return;
    }
    S.enterPick(!S.fromPlace ? "from" : "to");
  };
  function exitSearch(fromPop) {
    if (S.mode !== "search") return;
    if (fromPop !== true) { try { if (history.state && history.state.tts) history.back(); } catch (e) { /* ignore */ } }
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    const snap = searchSnapshot || {};
    const changed = snap.from !== S.fromPlace || snap.to !== S.toPlace;
    searchSnapshot = null;
    if (S.searchPrev === "pick" && !changed && !(S.fromPlace && S.toPlace)) {
      S.enterPick(S.pickTarget, { editing: S.pickEditing });
      return;
    }
    S.resume(changed);
  }
  function choosePlace(field, place) {
    S.setPlace(field, place);
    if (S.fromPlace && S.toPlace) { exitSearch(); return; }
    const other = field === "from" ? "to" : "from";
    S.searchField = other;
    const input = other === "from" ? S.fromInput : S.toInput;
    input.focus({ preventScroll: true });
    input.select();
    markActiveField();
    renderList();
  }

  const listEl = $("search-list");
  const sStatus = $("search-status");
  let netTimer = null, netSeq = 0;
  function icon(kind) {
    const paths = {
      stop: '<rect x="6" y="3.5" width="12" height="14" rx="3"></rect><path d="M6 12h12M9 17.5V20M15 17.5V20"></path>',
      metro: '<path d="M5 19 9 5l3 8 3-8 4 14"></path>',
      cable: '<path d="M3 6l18-3M12 4.5V9"></path><rect x="7" y="9" width="10" height="9" rx="2"></rect>',
      place: '<path d="M12 21s-6-5.3-6-10a6 6 0 1112 0c0 4.7-6 10-6 10z"></path><circle cx="12" cy="11" r="2"></circle>',
      recent: '<circle cx="12" cy="12" r="8"></circle><path d="M12 8v4l3 2"></path>',
      trip: '<circle cx="6" cy="18" r="2"></circle><circle cx="18" cy="6" r="2"></circle><path d="M8 18h6a4 4 0 000-8h-4a4 4 0 010-8h6"></path>',
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[kind] || paths.place) + "</svg>";
  }
  function itemKind(r) {
    if (r.type === "STOP") return r.kind === 1 ? "metro" : r.kind === 2 ? "cable" : "stop";
    return "place";
  }
  function addItem(html, onPick, cls, extra) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "s-item" + (cls ? " " + cls : "");
    btn.setAttribute("role", "option");
    btn.innerHTML = html;
    /* pointerdown+preventDefault keeps the keyboard/focus; click does the work */
    btn.addEventListener("pointerdown", (e) => e.preventDefault());
    btn.addEventListener("click", onPick);
    if (!extra) { listEl.appendChild(btn); return btn; }
    /* row with a trailing secondary action (e.g. departures of a stop) */
    const row = document.createElement("div");
    row.className = "s-row";
    row.appendChild(btn);
    const x = document.createElement("button");
    x.type = "button";
    x.className = "s-extra";
    x.setAttribute("aria-label", extra.label);
    x.title = extra.label;
    x.innerHTML = extra.html;
    x.addEventListener("pointerdown", (e) => e.preventDefault());
    x.addEventListener("click", (e) => { e.stopPropagation(); extra.onClick(); });
    row.appendChild(x);
    listEl.appendChild(row);
    return btn;
  }
  S.searchAddItem = addItem;
  S.searchAddHeader = function (t) { addHeader(t); };
  function stopExtra(r) {
    if (!S.openStop) return null;
    let idx = r.idx;
    if (idx == null && r.type === "STOP") { const st = S.nearestStop(r.lat, r.lon, 150); idx = st ? st.i : null; }
    if (idx == null) return null;
    return {
      label: S.t("departures"),
      html: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M12 8v4l3 2"></path></svg>',
      onClick: () => S.openStop(idx),
    };
  }
  function addHeader(text) {
    const h = document.createElement("div");
    h.className = "s-head";
    h.textContent = text;
    listEl.appendChild(h);
  }
  function placeRow(r, iconKind) {
    const name = S.displayName(r) || r.name;
    let meta = r.type === "STOP" ? (S.t("stopKind")[r.kind || 0]) : (r.area || "");
    if (r.type === "STOP" && S.lang !== "ka" && r.nameKa) meta += " · " + r.nameKa;
    return '<span class="s-ico ' + (iconKind || itemKind(r)) + '">' + icon(iconKind || itemKind(r)) + '</span>' +
      '<span class="s-txt"><span class="s-name">' + esc(name) + '</span><span class="s-meta">' + esc(meta) + "</span></span>";
  }
  function renderRows(local, online, q) {
    listEl.innerHTML = "";
    const field = S.searchField;
    const lines = S.searchLines ? S.searchLines(q || "") : [];
    if (lines.length) {
      addHeader(S.t("lines"));
      lines.forEach((ln) => S.addLineRow(ln));
      if (local.length || (online || []).length) addHeader(S.t("stopsPlaces"));
    }
    const rows = [];
    const seen = [];
    const dup = (r) => seen.some((s) => S.norm(s.name) === S.norm(r.name) && S.distM(s.lat, s.lon, r.lat, r.lon) < 600);
    local.forEach((r) => { if (!dup(r)) { rows.push(r); seen.push(r); } });
    (online || []).forEach((r) => { if (!dup(r)) { rows.push(r); seen.push(r); } });
    rows.slice(0, 12).forEach((r) => addItem(placeRow(r), () => choosePlace(field, {
      name: r.name, nameKa: r.nameKa, lat: r.lat, lon: r.lon, type: r.type, kind: r.kind,
    }), "", r.type === "STOP" ? stopExtra(r) : null));
    if (!rows.length && !lines.length) {
      const e = document.createElement("div");
      e.className = "s-empty";
      e.textContent = S.t("nothingFound");
      listEl.appendChild(e);
    }
  }
  function renderRecents() {
    listEl.innerHTML = "";
    const field = S.searchField;
    if (S.renderRecentLinesStops) S.renderRecentLinesStops(listEl);
    const trips = S.recentTrips().slice(0, 3);
    const places = S.recentPlaces().slice(0, 6);
    if (places.length) {
      addHeader(S.t("recentPlaces"));
      places.forEach((p) => addItem(placeRow(p, "recent"), () => choosePlace(field, p)));
    }
    if (trips.length) {
      addHeader(S.t("recentTrips"));
      trips.forEach((t) => addItem(
        '<span class="s-ico trip">' + icon("trip") + '</span><span class="s-txt"><span class="s-name">' +
        esc(S.displayName(t.from)) + " → " + esc(S.displayName(t.to)) + '</span><span class="s-meta">' +
        esc(new Date(t.at).toLocaleDateString(S.lang === "ka" ? "ka-GE" : "en-GB", { day: "numeric", month: "short" })) + "</span></span>",
        () => { S.setPlace("from", t.from); S.setPlace("to", t.to); exitSearch(); }));
    }
    if (!trips.length && !places.length && !listEl.querySelector(".rl-chips")) {
      addHeader(S.t("examples"));
      [["freedom", "station"], ["station", "freedom"]].forEach(([a, b2]) => addItem(
        '<span class="s-ico trip">' + icon("trip") + '</span><span class="s-txt"><span class="s-name">' +
        esc(S.displayName(S.PRESETS[a])) + " → " + esc(S.displayName(S.PRESETS[b2])) + "</span></span>",
        () => { S.setPlace("from", Object.assign({}, S.PRESETS[a])); S.setPlace("to", Object.assign({}, S.PRESETS[b2])); exitSearch(); }));
    }
  }
  function renderList() {
    const input = S.searchField === "from" ? S.fromInput : S.toInput;
    const cur = S.searchField === "from" ? S.fromPlace : S.toPlace;
    const q = input.value.trim();
    input.placeholder = S.t(S.searchField === "from" ? "searchFrom" : "searchTo");
    clearTimeout(netTimer);
    sStatus.textContent = "";
    if (!q || (cur && q === S.displayName(cur))) { renderRecents(); return; }
    const local = S.searchStopsLocal(q, 6);
    renderRows(local, [], q);
    if (!S.online) { sStatus.textContent = S.t("offlineSearch"); return; }
    if (q.length < 3 || (S.isLineQuery && S.isLineQuery(q))) return;
    const my = ++netSeq;
    netTimer = setTimeout(async () => {
      sStatus.textContent = S.t("searching");
      let online = [];
      try { online = await S.geocodeOnline(q); } catch (e) { online = []; }
      if (my !== netSeq || S.mode !== "search") return;
      sStatus.textContent = "";
      /* online STOPs after local, then places */
      online.sort((a, b2) => (a.type === "STOP" ? 0 : 1) - (b2.type === "STOP" ? 0 : 1));
      renderRows(S.searchStopsLocal(q, 6), online, q);
    }, 320);
  }
  S.renderSearchList = renderList;

  [["from", S.fromInput], ["to", S.toInput]].forEach(([field, input]) => {
    input.addEventListener("focus", () => {
      if (S.mode !== "search") { S.enterSearch(field); return; }
      if (S.searchField !== field) { S.searchField = field; markActiveField(); renderList(); }
    });
    input.addEventListener("input", renderList);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const first = listEl.querySelector(".s-item");
        if (first) first.click();
      } else if (e.key === "Escape") { exitSearch(); }
    });
  });
  listEl.addEventListener("touchstart", () => {
    /* scrolling the list closes the keyboard so all suggestions are visible */
  }, { passive: true });
  document.querySelectorAll(".sf-clear").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      const f = btn.getAttribute("data-clear");
      const input = f === "from" ? S.fromInput : S.toInput;
      input.value = "";
      S.searchField = f;
      input.focus({ preventScroll: true });
      markActiveField();
      renderList();
    });
  });
  $("search-back").addEventListener("click", () => exitSearch());
  $("search-swap").addEventListener("click", () => {
    const a = S.fromPlace, b2 = S.toPlace;
    S.setPlace("from", b2); S.setPlace("to", a);
    renderList();
  });
  $("q-map").addEventListener("click", () => {
    try { if (history.state && history.state.tts) history.back(); } catch (e) { /* ignore */ }
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    searchSnapshot = null;
    S.enterPick(S.searchField, { editing: !!(S.fromPlace && S.toPlace) });
  });
  $("q-myloc").addEventListener("click", async () => {
    const field = S.searchField;
    sStatus.textContent = S.t("locating");
    try {
      const f = await S.getFix();
      sStatus.textContent = "";
      if (!S.nearTbilisi(f.lat, f.lon)) { sStatus.textContent = S.t("geoOutside"); return; }
      choosePlace(field, { name: S.t("myLocation"), lat: f.lat, lon: f.lon, type: "PLACE", isGps: true });
    } catch (err) {
      sStatus.textContent = err && err.code === 1 ? S.t("geoDenied") : err && err.code === 3 ? S.t("geoTimeout") : S.t("geoUnavailable");
    }
  });

  /** Leave search mode because a stop/line view takes over (no resume, no history pop) */
  S.abandonSearch = function () {
    if (S.mode !== "search") return;
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    searchSnapshot = null;
  };

  /* —— Planning + results —— */
  function itineraryHasLive(it) { return (it.legs || []).some((l) => l.realTime); }
  const METRO_SVG = '<svg class="metro-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5"></circle><path d="M6.5 17V7.5l5.5 7 5.5-7V17"></path></svg>';
  const isTransit = (l) => (l.mode || "WALK").toUpperCase() !== "WALK";
  const placeKey = (p) => (p && typeof p.lat === "number" ? p.lat.toFixed(3) + "," + p.lon.toFixed(3) : "?");
  S.placeKey = placeKey;
  S.isTransitLeg = isTransit;
  /** "314", "M1", "G2": the code riders see */
  S.legName = function (l) {
    const line = S.lineFromRouteId ? S.lineFromRouteId(l.routeId) : null;
    if (line) return line.code;
    if (S.isMetroMode(l.mode)) return "M" + (l.routeShortName || "");
    return l.routeShortName || l.displayName || S.modeLabel(l.mode);
  };
  S.legColor = function (l, fallback) {
    if (!S.isMetroMode(l.mode)) return fallback;
    const line = S.lineFromRouteId ? S.lineFromRouteId(l.routeId) : null;
    return line ? line.color : S.METRO_RED;
  };
  /**
   * Merge itineraries that ride the same path (same boarding/alighting stops, same transfers) and differ only
   * by the bus number → one option "314 / 330 / 357". Direct options first, then those with transfers.
   */
  S.groupItineraries = function (list) {
    const groups = new Map(), order = [];
    (list || []).forEach((it) => {
      const tl = (it.legs || []).filter(isTransit);
      const sig = tl.length ? tl.map((l) => (S.isMetroMode(l.mode) ? "M" : "B") + placeKey(l.from) + ">" + placeKey(l.to)).join("|") : "walk";
      let g = groups.get(sig);
      if (!g) { g = []; groups.set(sig, g); order.push(g); }
      g.push(it);
    });
    return order.map((ms) => {
      ms = ms.slice().sort((a, b) => Date.parse(a.endTime) - Date.parse(b.endTime));
      const rep = Object.assign({}, ms[0]);
      const nT = (rep.legs || []).filter(isTransit).length;
      rep.alts = [];
      for (let i = 0; i < nT; i++) {
        const names = [];
        ms.forEach((m) => { const l = (m.legs || []).filter(isTransit)[i]; const n = l && S.legName(l); if (n && names.indexOf(n) < 0) names.push(n); });
        rep.alts.push(names);
      }
      rep._allLegs = [].concat.apply([], ms.map((m) => (m.legs || []).filter(isTransit)));
      rep.members = ms.length;
      rep.direct = nT <= 1;
      /* pooled frequency per ride: any of the lines in the group (1 / sum of 1 / gap), only when every gap is known */
      rep.freqs = [];
      for (let i = 0; i < nT; i++) {
        const gaps = new Map();
        ms.forEach((m) => { const l = (m.legs || []).filter(isTransit)[i]; if (l) gaps.set(S.legName(l), l._every || null); });
        const v = [...gaps.values()];
        rep.freqs.push(v.length && v.every(Boolean) ? Math.max(1, Math.round(1 / v.reduce((a, g) => a + 1 / g, 0))) : null);
      }
      rep._score = Math.min.apply(null, ms.map((m) => (typeof m._score === "number" ? m._score : Infinity)));
      return rep;
    }).sort((a, b) => (a.direct === b.direct ? 0 : a.direct ? -1 : 1) ||
      (isFinite(a._score) && isFinite(b._score) ? a._score - b._score : 0) || Date.parse(a.endTime) - Date.parse(b.endTime));
  };
  function routeBadgesHtml(it, color) {
    const tx = S.textOn(color);
    if ((it.legs || []).every((l) => (l.mode || "WALK").toUpperCase() === "WALK")) {
      return '<span class="route-badge walk"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4.5" r="1.8"></circle><path d="M10 21l2-6 3 3v3M9 12l2-4 3 1 2 3M11 8l-2 5"></path></svg>' +
        esc(S.t("walk")) + " · " + esc(S.formatDuration(it.duration)) + "</span>";
    }
    let t = 0;
    return (it.legs || []).map((leg) => {
      const mode = (leg.mode || "WALK").toUpperCase();
      if (mode === "WALK") {
        const mins = Math.round((leg.duration || 0) / 60);
        return mins >= 2 ? '<span class="route-badge walk"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4.5" r="1.8"></circle><path d="M10 21l2-6 3 3v3M9 12l2-4 3 1 2 3M11 8l-2 5"></path></svg>' + mins + "</span>" : "";
      }
      const names = (it.alts && it.alts[t]) || [S.legName(leg)];
      const pc = S.legPalette(t);
      t++;
      if (S.isMetroMode(mode)) {
        const mc = S.legColor(leg, color);
        return '<span class="route-badge metro" style="background:' + mc + ";color:" + S.textOn(mc) + '">' + METRO_SVG + esc(names.join(" / ")) + "</span>";
      }
      return '<span class="route-badge" style="background:' + pc + ";color:" + S.textOn(pc) + '">' + esc(names.join(" / ")) + "</span>";
    }).filter(Boolean).join('<span class="badge-sep">›</span>');
  }
  function renderLegs(it, color) {
    const box = document.createElement("div");
    box.className = "legs";
    let t = 0;
    const legs = it.legs || [];
    legs.forEach((leg, li) => {
      const mode = (leg.mode || "WALK").toUpperCase();
      const isWalk = mode === "WALK";
      const isMetro = S.isMetroMode(mode);
      const route = isWalk ? "" : S.legName(leg);
      const alts = isWalk ? [] : ((it.alts && it.alts[t++]) || []).filter((n) => n !== route);
      const prev = legs[li - 1], next = legs[li + 1];
      const lc = isWalk ? null : S.legColor(leg, S.legPalette(t - 1));
      const fromName = leg.from && leg.from.name && leg.from.name !== "START" ? leg.from.name : S.displayName(S.fromPlace);
      const toName = leg.to && leg.to.name && leg.to.name !== "END" ? leg.to.name : S.displayName(S.toPlace);
      const row = document.createElement("div");
      row.className = "leg" + (isWalk ? " walk" : "") + (isMetro ? " metro" : "");
      row.style.setProperty("--leg", isWalk ? "var(--muted)" : lc);
      let walkLabel = S.t("walk");
      if (isWalk && next && S.isMetroMode(next.mode)) walkLabel = S.tf("walkToMetro", (next.from && next.from.name) || "");
      else if (isWalk && prev && next && isTransit(prev) && isTransit(next)) walkLabel = S.t("transferWalk") + " · " + S.t("walk").toLowerCase();
      else if (isWalk && prev && S.isMetroMode(prev.mode)) walkLabel = S.t("exitMetro") + " · " + S.t("walk").toLowerCase();
      const nStops = (leg.intermediateStops || []).length + 1;
      const head = isWalk
        ? esc(walkLabel) + " · " + esc(S.formatDuration(leg.duration))
        : '<span class="route-num' + (isMetro ? " metro" : "") + '" data-route="' + esc(leg.routeId || "") + '" data-trip="' + esc(leg.tripId || "") + '" data-board="' + esc((leg.from && leg.from.stopId) || "") + '" role="button" tabindex="0" style="background:' + lc + ";color:" + S.textOn(lc) + '">' + (isMetro ? METRO_SVG : "") + esc(route) + "</span> " +
          esc(S.modeLabel(mode)) + (leg.headsign ? ' <span class="headsign">→ ' + esc(leg.headsign) + "</span>" : "") +
          (isMetro ? ' <span class="headsign">· ' + esc(S.tf("metroStops", nStops)) + "</span>" : "") +
          (alts.length ? ' <span class="alts">' + esc(S.tf("orAlso", alts.join(", "))) + "</span>" : "");
      const rt = !isWalk ? (leg.realTime ? '<span class="badge live">' + S.t("live") + "</span>" : '<span class="badge sched">' + S.t("scheduled") + "</span>") : "";
      const every = !isWalk && leg._every ? " · " + S.tf("directEvery", leg._every) : "";
      const xfer = !isWalk && typeof leg._wait === "number" ? '<div class="leg-xfer">' + esc(S.tf("transferWait", leg._wait)) + "</div>" : "";
      row.innerHTML = '<div class="leg-time">' + esc(S.formatTime(leg.startTime)) + "</div>" +
        '<div class="leg-line"></div><div class="leg-detail">' + xfer + '<div class="leg-head">' + head + " " + rt + "</div>" +
        '<div class="leg-sub">' + esc(fromName) + (isWalk ? "" : " → " + esc(toName)) + esc(every) + "</div></div>";
      const rn = row.querySelector(".route-num[data-route]");
      if (rn && rn.dataset.route && S.openLineFromLeg) {
        rn.title = S.t("showLine");
        rn.addEventListener("click", (e) => { e.stopPropagation(); S.openLineFromLeg(rn.dataset.route, rn.dataset.trip, rn.dataset.board); });
      }
      box.appendChild(row);
    });
    const end = document.createElement("div");
    end.className = "leg end";
    end.innerHTML = '<div class="leg-time">' + esc(S.formatTime(it.endTime)) + '</div><div class="leg-line"></div><div class="leg-detail"><div class="leg-head">' + esc(S.displayName(S.toPlace)) + "</div></div>";
    box.appendChild(end);
    const note = document.createElement("p");
    note.className = "veh-note";
    note.textContent = S.t("vehNote");
    box.appendChild(note);
    return box;
  }
  function selectItin(index, toggle) {
    const was = S.selectedItin;
    S.selectedItin = index;
    S.resultsEl.querySelectorAll(".itinerary").forEach((n) => {
      const i = Number(n.dataset.index);
      n.classList.toggle("active", i === index);
      if (i === index) n.classList.toggle("expanded", toggle && was === index ? !n.classList.contains("expanded") : true);
      else n.classList.remove("expanded");
    });
    S.drawAllItineraries(S.lastItineraries, index, { fit: was !== index, duration: 450 });
    if (S.showVehicles) S.showVehicles(index);
  }
  function renderItinerary(it, index) {
    const color = S.itinColor(index);
    const el = document.createElement("article");
    el.className = "itinerary" + (index === S.selectedItin ? " active expanded" : "");
    el.dataset.index = String(index);
    el.style.setProperty("--itin-color", color);
    const live = itineraryHasLive(it);
    el.innerHTML =
      '<button type="button" class="itin-summary" aria-expanded="false">' +
        '<span class="itin-color" aria-hidden="true"></span>' +
        '<span class="itin-main">' +
          '<span class="itin-row1"><span class="itin-dur"></span><span class="itin-times"></span>' +
          (live ? '<span class="badge live">' + S.t("live") + "</span>" : "") + "</span>" +
          '<span class="itin-badges"></span>' +
          '<span class="itin-meta"></span>' +
          '<span class="itin-freq"></span>' +
        "</span>" +
        '<span class="itin-chevron" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg></span>' +
      "</button>" +
      '<div class="itin-detail"></div>';
    el.querySelector(".itin-dur").textContent = S.formatDuration(it.duration);
    el.querySelector(".itin-times").textContent = S.formatTime(it.startTime) + " – " + S.formatTime(it.endTime);
    const walkOnly = (it.legs || []).every((l) => (l.mode || "WALK").toUpperCase() === "WALK");
    const waits = (it.legs || []).filter((l) => typeof l._wait === "number" && !walkOnly).map((l) => l._wait);
    const waitSum = waits.reduce((a, b) => a + b, 0);
    el.querySelector(".itin-meta").textContent = walkOnly ? S.t("walkOnly") : S.transferLabel(it.transfers || 0) + (waits.length && waitSum > 0 ? " · " + S.tf("transferWaitShort", waitSum) : "");
    const fr = (it.freqs || []).map((f, i) => ((it.alts && it.alts[i]) || []).join(" / ") + (f ? " · " + S.tf("directEvery", f) : ""));
    el.querySelector(".itin-freq").textContent = !walkOnly && (it.freqs || []).some(Boolean) ? fr.join("  ›  ") : "";
    el.querySelector(".itin-badges").innerHTML = routeBadgesHtml(it, color);
    el.querySelector(".itin-detail").appendChild(renderLegs(it, color));
    el.querySelector(".itin-summary").addEventListener("click", () => selectItin(index, true));
    return el;
  }
  const LIM = 8; /* options shown before "Show more options" */
  function showResults(list, note) {
    S.rawResults = list;
    list = S.groupItineraries(list);
    const total = list.length;
    if (!S.showAllOptions) list = list.slice(0, LIM);
    S.lastItineraries = list;
    S.selectedItin = 0;
    S.resultsEl.innerHTML = "";
    S.statusEl.classList.remove("error");
    S.statusEl.textContent = note || "";
    if (!list.length) {
      S.resultsEl.innerHTML = '<div class="empty">' + esc(S.t("noResults")) + "</div>";
      S.clearRoute();
      S.updatePeek();
      if (S.paintDirectLines) S.paintDirectLines();
      return;
    }
    let section = null;
    list.forEach((it, i) => {
      const sec = it.direct ? "direct" : "withTransfer";
      if (sec !== section) {
        section = sec;
        const h = document.createElement("h3");
        h.className = "itin-section";
        h.textContent = S.t(sec);
        S.resultsEl.appendChild(h);
      }
      S.resultsEl.appendChild(renderItinerary(it, i));
    });
    if (total > list.length) {
      const more = document.createElement("button");
      more.type = "button"; more.className = "here-more opts-more";
      more.textContent = S.tf("moreOptions", total - list.length);
      more.addEventListener("click", () => { S.showAllOptions = true; showResults(S.rawResults, note); });
      S.resultsEl.appendChild(more);
    }
    S.drawAllItineraries(list, 0, { fit: true });
    if (S.showVehicles) S.showVehicles(0);
    S.updatePeek();
    if (S.updateAtStop) S.updateAtStop();
    if (S.paintDirectLines) S.paintDirectLines();
  }
  let planSeq = 0;
  S.plan = async function () {
    if (!S.fromPlace || !S.toPlace) { S.toast(S.t("pickBoth"), true); return; }
    const my = ++planSeq;
    S.showAllOptions = false;
    S.setMode("trip");
    S.setSheet("mid");
    S.updateTripPoints();
    S.lastItineraries = [];
    S.resultsEl.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    S.statusEl.classList.remove("error");
    S.statusEl.textContent = S.t("planning");
    S.clearRoute();
    S.updatePeek();
    const from = S.fromPlace, to = S.toPlace;
    const fallback = () => {
      const saved = S.findSavedTrip(from, to);
      if (saved) {
        const t = new Date(saved.at).toLocaleString(S.lang === "ka" ? "ka-GE" : "en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
        const sl = saved.itineraries || [];
        (S.enrichItineraries ? S.enrichItineraries(sl) : Promise.resolve()).catch(() => {}).then(() => { if (my === planSeq) showResults(sl, S.tf(S.online ? "savedResults" : "offlineSaved", t)); });
        return true;
      }
      return false;
    };
    if (!S.online) S.probeOnline(); /* on-demand connectivity check instead of polling */
    if (!S.online && fallback()) return;
    try {
      const path = "/v5/plan?fromPlace=" + encodeURIComponent(from.lat + "," + from.lon) +
        "&toPlace=" + encodeURIComponent(to.lat + "," + to.lon) +
        "&arriveBy=false&language=" + S.lang + "&numItineraries=30" +
        (S.ls.get("tt-avoid-metro", false) ? "&transitModes=BUS,AERIAL_LIFT" : "");
      const r = await S.apiCached(path, S.TTL.plan);
      const data = r.body;
      if (my !== planSeq) return;
      const list = (data.itineraries || []).slice(0, 30);
      /* MOTIS returns short / walk-only trips in `direct`, not `itineraries` */
      const walk = (data.direct || []).find((d) => (d.legs || []).every((l) => (l.mode || "WALK").toUpperCase() === "WALK"));
      if (walk) {
        walk.walkOnly = true;
        const best = list.length ? Math.min.apply(null, list.map((x) => x.duration || 1e9)) : 1e9;
        if ((walk.duration || 0) <= best) list.unshift(walk); else list.push(walk);
      }
      if (list.length && !r.cached) S.saveTrip(from, to, list);
      if (S.enrichItineraries) await S.enrichItineraries(list);
      if (my !== planSeq) return;
      const t = new Date(r.at).toLocaleString(S.lang === "ka" ? "ka-GE" : "en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
      showResults(list, r.stale ? S.tf(S.online ? "savedResults" : "offlineSaved", t) : "");
    } catch (err) {
      if (my !== planSeq) return;
      console.warn(err);
      if (!fallback()) {
        S.resultsEl.innerHTML = "";
        S.statusEl.textContent = S.online ? S.t("error") : S.t("offline");
        S.statusEl.classList.add("error");
        if (S.paintDirectLines) S.paintDirectLines();
      }
    }
  };

  S.updateTripPoints = function () {
    $("tp-from-name").textContent = S.displayName(S.fromPlace) || S.t("chooseStart");
    $("tp-to-name").textContent = S.displayName(S.toPlace) || S.t("chooseDestination");
    S.updatePeek();
  };
  S.updatePeek = function () {
    const peek = $("peek-text"), action = $("peek-action");
    if (!peek) return;
    if (S.fromPlace && S.toPlace) {
      peek.innerHTML = '<span class="peek-a"></span><span class="peek-arrow">→</span><span class="peek-b"></span>';
      peek.querySelector(".peek-a").textContent = S.displayName(S.fromPlace);
      peek.querySelector(".peek-b").textContent = S.displayName(S.toPlace);
    } else peek.textContent = S.t("title");
    if (S.peekOverride && S.peekOverride(peek, action)) return;
    const n = (S.lastItineraries || []).length;
    action.textContent = n ? S.tf("routesFound", n) : "";
  };

  /* For share / query / paste: set a point without UI navigation */
  S.dropPin = function (which, lat, lon, name, opts) {
    opts = opts || {};
    if (!S.inTbilisi(lat, lon) && !(opts.allowNear && S.nearTbilisi(lat, lon))) { S.toast(S.t("outsideCity"), true); return false; }
    S.setPlace(which, S.placeFromLatLon(lat, lon, name));
    if (!name) S.resolvePlaceLabel(which);
    return true;
  };

  /* —— Language —— */
  S.applyLang = function () {
    document.documentElement.lang = S.lang;
    document.title = S.t("title");
    $("lang-toggle").textContent = S.t("langShort");
    $("lang-toggle").title = S.t("language");
    $("q-myloc-label").textContent = S.t("myLocation");
    $("q-map-label").textContent = S.t("chooseOnMap");
    $("search-back").setAttribute("aria-label", S.t("back"));
    ["search-swap", "trip-swap"].forEach((id) => $(id).setAttribute("aria-label", S.t("swap")));
    $("label-more").textContent = S.t("more");
    $("label-avoid-metro").textContent = S.t("avoidMetro");
    $("label-paste").textContent = S.t("paste");
    $("label-examples").textContent = S.t("examples");
    $("use-as-from").textContent = S.t("useAsFrom");
    $("use-as-to").textContent = S.t("useAsTo");
    $("preset-fs").textContent = S.t("presetFS");
    $("preset-sf").textContent = S.t("presetSF");
    $("footer").innerHTML = S.t("attribution");
    S.fromInput.placeholder = S.t("searchFrom");
    S.toInput.placeholder = S.t("searchTo");
    S.updateOnline();
    if (S.applyLangLines) S.applyLangLines();
    S.updateTripPoints();
    S.updatePickCard();
    if (S.updateLocateLabels) S.updateLocateLabels();
    if (S.mode === "search") renderList();
    if (S.mode === "pick" && S.resolvePickCenter) S.resolvePickCenter();
    if (S.mode === "trip" && S.lastItineraries.length) {
      const sel = S.selectedItin;
      S.resultsEl.innerHTML = "";
      S.lastItineraries.forEach((it, i) => S.resultsEl.appendChild(renderItinerary(it, i)));
      S.resultsEl.querySelectorAll(".itinerary").forEach((n) => {
        const i = Number(n.dataset.index);
        n.classList.toggle("active", i === sel);
        n.classList.toggle("expanded", i === sel);
      });
      if (S.paintDirectLines) S.paintDirectLines();
    }
  };

  /* —— Wiring —— */
  $("pick-confirm").addEventListener("click", S.confirmPick);
  $("pick-search").addEventListener("click", () => S.enterSearch(S.pickTarget));
  $("pick-cancel").addEventListener("click", pickCancel);
  $("trip-from").addEventListener("click", () => S.enterPick("from", { editing: true }));
  $("trip-to").addEventListener("click", () => S.enterPick("to", { editing: true }));
  $("trip-swap").addEventListener("click", () => {
    const a = S.fromPlace, b2 = S.toPlace;
    S.setPlace("from", b2); S.setPlace("to", a);
    if (S.fromPlace && S.toPlace) S.plan();
  });
  $("lang-toggle").addEventListener("click", () => {
    S.lang = S.lang === "ka" ? "en" : "ka";
    localStorage.setItem("tt-lang", S.lang);
    S.applyLang();
  });
  $("avoid-metro").checked = !!S.ls.get("tt-avoid-metro", false);
  $("avoid-metro").addEventListener("change", (e) => {
    S.ls.set("tt-avoid-metro", e.target.checked);
    if (S.fromPlace && S.toPlace) S.plan();
  });
  $("use-as-from").addEventListener("click", () => S.consumePaste("from"));
  $("use-as-to").addEventListener("click", () => S.consumePaste("to"));
  $("preset-fs").addEventListener("click", () => { S.setPlace("from", Object.assign({}, S.PRESETS.freedom)); S.setPlace("to", Object.assign({}, S.PRESETS.station)); S.plan(); });
  $("preset-sf").addEventListener("click", () => { S.setPlace("from", Object.assign({}, S.PRESETS.station)); S.setPlace("to", Object.assign({}, S.PRESETS.freedom)); S.plan(); });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && S.mode === "pick" && !$("pick-cancel").hidden) pickCancel();
    if (e.key === "Enter" && S.mode === "pick" && document.activeElement === document.body) S.confirmPick();
  });
  /* Android back button in standalone PWA: leave search mode instead of closing */
  window.addEventListener("popstate", () => { if (S.mode === "search") exitSearch(true); });

  /* —— Boot —— */
  S.applyLang();
  const acted = S.consumeQueryAndShare ? S.consumeQueryAndShare() : false;
  if (S.fromPlace && S.toPlace) S.plan();
  else if (S.fromPlace) S.enterPick("to");
  else if (S.toPlace) S.enterPick("from");
  else S.enterPick("from");
  if (acted && S.fromPlace && !S.toPlace) S.centerPinOn(S.fromPlace.lat, S.fromPlace.lon);
  /* Predict "from where I am" — only if location permission was already granted (never prompts) */
  if (!acted && navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: "geolocation" }).then((p) => {
      if (p.state !== "granted") return;
      S.getFix().then((f) => {
        if (S.mode !== "pick" || S.pickTarget !== "from" || S.fromPlace || S.userMovedMap) return;
        if (S.inTbilisi(f.lat, f.lon)) S.centerPinOn(f.lat, f.lon, 16);
      }).catch(() => {});
    }).catch(() => {});
  }
})();
