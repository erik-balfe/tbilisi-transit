/*
 * "Here": one tap → where am I and what can I take from here (design: docs/nearby-stop-ux.md).
 *  - Here button (map, above the locate button) + auto-offer dot when a stop is ≤ 100 m away
 *  - Here view = the stop sheet in "here" mode: nearest stop (+ switcher), departures sorted by time with a
 *    "where it goes" summary, tab "All lines", rows that fit a planned trip are marked
 *  - "At the stop" card inside the trip view (same data, same stop detection) for planned trips
 * Local timetable first (instant, offline), live data upgrades the rows afterwards.
 */
(function () {
  const S = window.__tt;
  const $ = S.$;
  const esc = S.escapeHtml;
  const map = S.map;
  const geo = S.geo;
  const sv = $("stop-view");
  const RT_PREFIX = "ge-tbilisi-transport-company_1:";
  const NEAR_OFFER_M = 100, MAX_CAND_M = 250, FAR_M = 400, FIX_FRESH_MS = 90e3, FIX_LAST_MS = 20 * 60e3;
  const top = () => (S.topView ? S.topView() : null);
  const hereView = () => { const v = top(); return v && v.kind === "stop" && v.here && S.mode === "stop" ? v : null; };
  const countdown = (ms) => S.tf("inMin", Math.max(0, Math.round((ms - Date.now()) / 60000)));
  const ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];

  /* ———————————————— position ———————————————— */
  function remember(f) { if (f) S.ls.set("tt-lastfix", { lat: f.lat, lon: f.lon, acc: f.acc || 0, t: f.t || Date.now() }); }
  function currentFix() {
    const f = geo.fix;
    if (f && Date.now() - f.t < FIX_FRESH_MS) return { fix: f, fresh: true };
    const l = S.ls.get("tt-lastfix", null);
    const g = f && (!l || f.t > l.t) ? f : l;
    if (g && Date.now() - g.t < FIX_LAST_MS) return { fix: g, fresh: false };
    return null;
  }
  function bearing(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
    const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  /** stops within MAX_CAND_M of the fix, nearest first: [{i, d, arrow}] */
  function nearbyStops(f) {
    const out = [];
    for (const s of S.stops || []) {
      if (Math.abs(s.lat - f.lat) > 0.003 || Math.abs(s.lon - f.lon) > 0.004) continue;
      const d = S.distM(f.lat, f.lon, s.lat, s.lon);
      if (d <= MAX_CAND_M) out.push({ i: s.i, d, arrow: ARROWS[Math.round(bearing(f.lat, f.lon, s.lat, s.lon) / 45) % 8] });
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }
  S.nearestStopsTo = nearbyStops;

  /* ———————————————— "where it goes" ———————————————— */
  /** notable stops after position j: hubs (many lines), metro, cable car; spaced; never the terminal */
  function routeSummary(ld, di, j) {
    const dir = ld.dirs[di];
    if (!dir || j < 0) return null;
    const rem = dir.stops.slice(j + 1);
    const n = rem.length;
    if (!n) return null;
    const mins = Math.max(1, Math.round(dir.off[dir.off.length - 1] - dir.off[j]));
    const termName = S.stopName(rem[n - 1]);
    const cands = [];
    rem.slice(0, -1).forEach((s, k) => {
      if (k < 1) return; /* the very next stop says little */
      const mi = S.stopIndexById ? S.stopIndexById.get(s.id) : null;
      const ms = mi != null ? S.stops[mi] : null;
      const hub = mi != null ? (S.stopLines[mi] || []).length : 0;
      const score = (ms && ms.kind === 1 ? 60 : ms && ms.kind === 2 ? 30 : 0) + hub;
      cands.push({ k, s, score, hub, kind: ms ? ms.kind : 0 });
    });
    const maxPick = n > 30 ? 4 : 3;
    const picked = [];
    const ok = (c) => c.k <= n - 3 && picked.every((p) => Math.abs(p.k - c.k) >= 3 && S.stopName(p.s) !== S.stopName(c.s)) && S.stopName(c.s) !== termName;
    cands.slice().sort((a, b) => b.score - a.score || a.k - b.k).forEach((c) => { if (picked.length < maxPick && (c.hub >= 4 || c.kind) && ok(c)) picked.push(c); });
    if (picked.length < 2 && n >= 8) {
      [Math.round(n / 3), Math.round((2 * n) / 3)].forEach((k) => { const c = cands.find((x) => x.k === k - 1) || cands.find((x) => x.k === k); if (c && picked.length < 3 && ok(c)) picked.push(c); });
    }
    picked.sort((a, b) => a.k - b.k);
    return { via: picked.map((c) => S.stopName(c.s)), n, mins };
  }
  function viaHtml(sum) {
    if (!sum) return "";
    const via = sum.via.length ? " · " + esc(S.t("hereVia")) + " " + sum.via.map(esc).join(" › ") : "";
    return '<i>' + esc(S.tf("hereRide", sum)) + "</i>" + via;
  }

  /* ———————————————— line files for this view (lazy, cached by the store) ———————————————— */
  const lds = new Map(); /* key → line data */
  function loadLinesFor(keys, then) {
    let pending = 0;
    keys.forEach((k) => {
      if (lds.has(k)) return;
      pending++;
      S.loadLine(k).then((ld) => { lds.set(k, ld); }).catch(() => {}).finally(() => { if (--pending === 0) then(); });
    });
    if (!pending) then();
  }
  function summarize(v, e) {
    if (e._sum !== undefined || !e.line.key) return;
    const ld = lds.get(e.line.key);
    if (!ld) return;
    const ids = new Set(S.stops[v.idx].ids);
    let di = e.dirIdx;
    if (di == null) di = S.sched.dirForTerminal(ld, e.term.id, e.dirId);
    e._di = di;
    const dir = ld.dirs[di];
    const j = dir ? dir.stops.findIndex((s) => ids.has(s.id)) : -1;
    e._sum = j >= 0 ? routeSummary(ld, di, j) : null;
  }

  /* ———————————————— planned-trip fit ———————————————— */
  /** boarding stops of all options → [{lat, lon, name, key, ids:Set, direct:[codes], transfer:[codes]}] */
  function boardings() {
    const by = new Map();
    (S.lastItineraries || []).forEach((it) => {
      const tl = (it.legs || []).filter(S.isTransitLeg);
      if (!tl.length) return;
      const f = tl[0].from || {};
      const k = S.placeKey(f);
      let b = by.get(k);
      if (!b) { b = { lat: f.lat, lon: f.lon, name: f.name, key: k, ids: new Set(), direct: [], transfer: [] }; by.set(k, b); }
      (it._allLegs || tl).forEach((l) => { if (l.from && S.placeKey(l.from) === k && l.from.stopId) b.ids.add(String(l.from.stopId).replace(RT_PREFIX, "")); });
      const list = tl.length === 1 ? b.direct : b.transfer;
      ((it.alts && it.alts[0]) || [S.legName(tl[0])]).forEach((n) => { if (list.indexOf(n) < 0) list.push(n); });
    });
    by.forEach((b) => { b.transfer = b.transfer.filter((n) => b.direct.indexOf(n) < 0); });
    return [...by.values()];
  }
  /** lines of the planned trip that board at stop idx → {direct:Set, transfer:Set} or null */
  function tripFit(idx) {
    const st = S.stops[idx];
    if (!st) return null;
    const ids = new Set(st.ids);
    const b = boardings().find((x) => [...x.ids].some((i) => ids.has(i)) || S.distM(x.lat, x.lon, st.lat, st.lon) < 60);
    return b ? { direct: new Set(b.direct), transfer: new Set(b.transfer) } : null;
  }
  S.tripFit = tripFit;

  /* ———————————————— Here view ———————————————— */
  const tabsEl = $("here-tabs"), switchEl = $("here-switch");

  function statusLine(v) {
    if (v.state === "locating") return S.t("hereLocating");
    if (v.state === "outside") return S.t("hereOutside");
    if (v.state === "nostop") return S.t("hereNoStop");
    if (v.state === "error") return v.err && v.err.code === 1 ? S.t("geoDenied") : v.err && v.err.code === 3 ? S.t("geoTimeout") : S.t("geoUnavailable");
    const d = Math.round(v.dist);
    if (!v.fresh) return S.tf("hereLast", Math.round((Date.now() - v.fix.t) / 60000)) + " · " + S.tf("hereAway", d);
    if (d > FAR_M) return S.tf("hereFar", d);
    return d < 25 ? S.t("hereYouAt") : S.tf("hereAway", d);
  }
  function paintHead(v) {
    const s = S.stops[v.idx];
    sv.classList.add("here");
    sv.classList.toggle("here-pending", !s);
    $("sv-ico").innerHTML = s ? S.stopIcon(s.kind) : S.stopIcon(0);
    $("sv-ico").className = "sv-ico k" + ((s && s.kind) || 0);
    $("sv-title").textContent = s ? S.stopName(s) : S.t("hereLocating");
    $("sv-sub").textContent = v.state === "locating" ? "" : statusLine(v);
    /* switcher (≥ 2 stops close together) */
    const cs = (v.cands || []).slice(0, 4);
    switchEl.innerHTML = "";
    switchEl.hidden = cs.length < 2 || !s;
    cs.forEach((c) => {
      const st = S.stops[c.i];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "here-chip" + (c.i === v.idx ? " on" : "");
      b.setAttribute("aria-pressed", c.i === v.idx ? "true" : "false");
      b.dataset.stop = String(c.i);
      const codes = (S.stopLines[c.i] || []).slice(0, 3).map((li) => S.lines[li] && S.lines[li].code).filter(Boolean).join(" ");
      b.innerHTML = '<span class="hc-name">' + esc(S.stopName(st)) + '</span><span class="hc-meta"><b>' + Math.round(c.d) + " m " + c.arrow + "</b> " + esc(codes) + "</span>";
      b.addEventListener("click", () => { v.pinned = true; setStop(v, c.i); });
      switchEl.appendChild(b);
    });
    /* tabs */
    tabsEl.hidden = !s;
    if (s) {
      const nAll = (S.stopLines[v.idx] || []).length;
      const fit = tripFit(v.idx);
      tabsEl.innerHTML = "";
      [["next", S.t("hereTabNext")], ["all", S.tf("hereTabAll", nAll)]].forEach(([k, label]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "here-tab" + (v.tab === k ? " on" : "");
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", v.tab === k ? "true" : "false");
        b.dataset.tab = k;
        b.textContent = label;
        b.addEventListener("click", () => { v.tab = k; paintHead(v); paintBody(v); });
        tabsEl.appendChild(b);
      });
      if (fit && v.tab === "next") {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "here-tab trip" + (v.onlyTrip ? " on" : "");
        b.id = "here-only-trip";
        b.setAttribute("aria-pressed", v.onlyTrip ? "true" : "false");
        b.textContent = "★ " + S.t("hereOnlyTrip");
        b.addEventListener("click", () => { v.onlyTrip = !v.onlyTrip; paintHead(v); paintBody(v); });
        tabsEl.appendChild(b);
      }
    }
    S.updatePeek();
  }

  function messageHtml(v) {
    const retry = '<button type="button" class="chip act" id="here-retry">' + esc(S.t("hereRetry")) + "</button>";
    const search = '<button type="button" class="chip" id="here-search">' + esc(S.t("hereSearchStop")) + "</button>";
    return '<div class="here-msg"><p>' + esc(statusLine(v)) + '</p><div class="here-msg-act">' + retry + search + "</div></div>";
  }
  function bindMessage(v) {
    const r = $("here-retry"), q = $("here-search");
    if (r) r.addEventListener("click", () => { v.state = "locating"; paintHead(v); paintBody(v); locate(v, true); });
    if (q) q.addEventListener("click", () => { if (S.navBack) S.navBack(); const b = $("pick-search"); if (b) b.click(); });
  }

  function paintBody(v) {
    const list = $("dep-list");
    if (v.idx == null || !S.stops[v.idx]) {
      if (v.state === "locating") list.innerHTML = '<div class="skeleton sm"></div><div class="skeleton sm"></div><div class="skeleton sm"></div>';
      else { list.innerHTML = messageHtml(v); bindMessage(v); }
      $("sv-status").textContent = ""; $("sv-foot").textContent = "";
      return;
    }
    if (v.tab === "all") paintAll(v); else paintNext(v);
  }

  function paintNext(v) {
    const list = $("dep-list");
    const d = v.deps && v.depsIdx === v.idx ? v.deps : null;
    const st = $("sv-status");
    if (!d) { list.innerHTML = '<div class="skeleton sm"></div><div class="skeleton sm"></div><div class="skeleton sm"></div>'; st.textContent = ""; return; }
    st.className = "sv-status" + (d.offline ? " off" : "");
    st.textContent = d.offline ? S.t("depsOfflineNote") : (!d.live && d.flat.length ? S.t("depsSchedNote") : "");
    $("sv-foot").textContent = d.offline ? "" : S.tf("depsUpdated", new Intl.DateTimeFormat(S.lang === "ka" ? "ka-GE" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tbilisi" }).format(new Date(d.at)));
    const now = Date.now();
    const fit = tripFit(v.idx);
    let rows = d.flat.filter((e) => e.ms > now - 45000 && e.ms <= now + 90 * 60000);
    if (fit && v.onlyTrip) rows = rows.filter((e) => fit.direct.has(e.line.code) || fit.transfer.has(e.line.code));
    if (!rows.length) { list.innerHTML = '<div class="empty">' + esc(S.t("noDepartures")) + "</div>"; return; }
    const lim = v.limit || 12;
    const shown = rows.slice(0, lim);
    list.innerHTML = "";
    shown.forEach((e, n) => {
      summarize(v, e);
      const mins = Math.round((e.ms - now) / 60000);
      const kind = fit ? (fit.direct.has(e.line.code) ? "direct" : fit.transfer.has(e.line.code) ? "transfer" : "") : "";
      const b = document.createElement("button");
      b.type = "button"; b.dataset.ms = String(e.ms);
      b.className = "dep-row here-row" + (kind ? " fit " + kind : "") + (n === 0 ? " first" : "");
      b.innerHTML = S.lineBadge(e.line, "lg") +
        '<span class="dep-main"><span class="dep-head">' + esc(S.tf("toTerminal", S.stopName(e.term))) +
        (kind ? ' <span class="fit-tag ' + kind + '">★ ' + esc(S.t(kind === "direct" ? "hereFitDirect" : "hereFitTransfer")) + "</span>" : "") + "</span>" +
        '<span class="dep-via">' + viaHtml(e._sum) + "</span></span>" +
        '<span class="dep-first' + (e.rt ? " rt" : "") + (mins <= 1 ? " soon" : "") + '">' +
          (e.rt ? '<i class="rt-dot" aria-label="' + esc(S.t("live")) + '"></i>' : "") +
          '<span class="dep-min">' + esc(countdown(e.ms)) + "</span>" +
          '<span class="dep-kind">' + esc(e.rt ? S.t("live") : S.t("scheduled")) + "</span></span>";
      if (e.line.key) {
        b.addEventListener("click", () => S.openLine(e.line.key, {
          boardStop: v.idx, termId: e.term.id, dirId: e.dirId, dirIdx: e.dirIdx != null ? e.dirIdx : e._di,
          tripId: e.tripId, depMs: e.ms, depRt: e.rt,
        }));
      } else b.disabled = true;
      list.appendChild(b);
    });
    if (rows.length > lim) {
      const m = document.createElement("button");
      m.type = "button"; m.className = "here-more"; m.textContent = S.t("hereMore");
      m.addEventListener("click", () => { v.limit = lim + 12; paintNext(v); });
      list.appendChild(m);
    }
    /* summaries need the line files: fill in as they arrive (rows are already on screen) */
    const need = [...new Set(shown.filter((e) => e._sum === undefined && e.line.key).map((e) => e.line.key))];
    if (need.length) loadLinesFor(need, () => { if (hereView() === v && v.tab === "next") paintNext(v); });
  }

  function paintAll(v) {
    const list = $("dep-list");
    $("sv-status").textContent = ""; $("sv-foot").textContent = "";
    const ids = new Set(S.stops[v.idx].ids);
    const lines = (S.stopLines[v.idx] || []).map((li) => S.lines[li]).filter(Boolean);
    const num = (l) => (l.type === 1 ? -2 : l.type === 6 ? -1 : 0) * 1e6 + (parseInt(String(l.code).replace(/\D/g, ""), 10) || 0);
    lines.sort((a, b) => num(a) - num(b) || a.code.localeCompare(b.code));
    const fit = tripFit(v.idx);
    list.innerHTML = "";
    const tb = S.tbNow().min;
    const rows = [];
    lines.forEach((l) => {
      const ld = lds.get(l.key);
      if (!ld) { rows.push({ l, pending: true }); return; }
      let any = false;
      ld.dirs.forEach((dir, di) => {
        const j = dir.stops.findIndex((s) => ids.has(s.id));
        if (j < 0 || j === dir.stops.length - 1) return;
        any = true;
        const nx = S.sched.nextAt(dir, j, 1)[0];
        const hw = S.sched.headway(dir);
        rows.push({ l, di, term: dir.stops[dir.stops.length - 1], nx, every: hw && hw.every, sum: routeSummary(ld, di, j) });
      });
      if (!any) rows.push({ l, none: true });
    });
    rows.forEach((r) => {
      const b = document.createElement("button");
      b.type = "button";
      const kind = fit ? (fit.direct.has(r.l.code) ? "direct" : fit.transfer.has(r.l.code) ? "transfer" : "") : "";
      b.className = "dep-row here-row all" + (kind ? " fit " + kind : "");
      let head, right = "", via = "";
      if (r.pending) {
        head = (r.l.terms || []).map((t) => S.tf("toTerminal", S.lang === "ka" ? t[1] || t[0] : t[0])).join("  ");
      } else if (r.none) {
        head = S.lineName(r.l); right = '<span class="dep-kind">' + esc(S.t("hereNoService")) + "</span>";
      } else {
        head = S.tf("toTerminal", S.stopName(r.term));
        via = viaHtml(r.sum);
        if (r.nx == null) right = '<span class="dep-kind">' + esc(S.t("hereNoService")) + "</span>";
        else {
          const m = Math.round(r.nx - tb);
          right = '<span class="dep-min">' + esc(m <= 90 ? S.tf("inMin", Math.max(0, m)) : S.sched.hhmm(r.nx)) + "</span>" +
            '<span class="dep-kind">' + esc(r.every ? S.tf("everyMin", r.every) : S.t("scheduled")) + "</span>";
        }
      }
      b.innerHTML = S.lineBadge(r.l, "lg") + '<span class="dep-main"><span class="dep-head">' + esc(head) +
        (kind ? ' <span class="fit-tag ' + kind + '">★</span>' : "") + '</span><span class="dep-via">' + via + "</span></span>" +
        '<span class="dep-first">' + right + "</span>";
      b.addEventListener("click", () => S.openLine(r.l.key, { boardStop: v.idx, dirIdx: r.di != null ? r.di : undefined }));
      list.appendChild(b);
    });
    const need = lines.filter((l) => !lds.has(l.key)).map((l) => l.key);
    if (need.length) loadLinesFor(need, () => { if (hereView() === v && v.tab === "all") paintAll(v); });
  }

  /* ——— data flow ——— */
  function loadBoard(v) {
    const idx = v.idx, my = (v.seq = (v.seq || 0) + 1);
    v.deps = null; v.depsIdx = null; v.limit = 12;
    const live = () => hereView() === v && v.idx === idx && v.seq === my;
    const give = (d, rank) => {
      if (!live()) return;
      if (v.depsIdx === idx && v.deps && v.rank > rank) return; /* never replace live data with the local timetable */
      v.deps = d; v.depsIdx = idx; v.rank = rank;
      if (v.tab === "next") paintNext(v);
    };
    const c = S.cachedDepartures(idx);
    if (c && Date.now() - c.at < 120e3) give(c, c.offline ? 1 : 2);
    S.getDeparturesLocal(idx).then((d) => give(d, 1)).catch(() => {});
    const fetchLive = (force) => S.getDepartures(idx, force).then((d) => give(d, d.offline ? 1 : 2)).catch(() => {});
    fetchLive(false);
    S.stopLabelFns.timers(setInterval(() => { if (!document.hidden && live()) fetchLive(true); }, 30000));
    S.stopLabelFns.timers(setInterval(() => { if (live() && v.tab === "next" && v.deps) paintNext(v); }, 15000));
    S.loadLines().then(() => { if (live() && v.tab === "all") paintAll(v); });
  }
  function focusMap(v) {
    const s = S.stops[v.idx];
    if (!s) return;
    S.stopLabelFns.selMarker(s);
    map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(Math.min(map.getZoom(), 17), 16.3), offset: S.stopLabelFns.offsetFor("mid"), duration: 450 });
  }
  function setStop(v, idx) {
    const first = v.idx == null;
    const changed = v.idx !== idx;
    v.idx = idx;
    if (v.fix) { const s = S.stops[idx]; v.dist = S.distM(v.fix.lat, v.fix.lon, s.lat, s.lon); }
    paintHead(v);
    if (changed || first) { loadBoard(v); paintBody(v); focusMap(v); }
  }
  function applyFix(v, cf) {
    v.fix = cf.fix; v.fresh = cf.fresh;
    if (!S.nearTbilisi(cf.fix.lat, cf.fix.lon)) { v.state = "outside"; v.idx = null; v.cands = []; paintHead(v); paintBody(v); return; }
    const cs = nearbyStops(cf.fix);
    v.cands = cs.filter((c, k) => k < 4 && c.d <= Math.max(120, cs[0].d + 80) || c.i === v.idx);
    if (!cs.length) {
      /* nothing within 250 m: show the nearest stop anyway (up to 1.5 km) */
      let best = null;
      for (const s of S.stops) {
        if (Math.abs(s.lat - cf.fix.lat) > 0.015 || Math.abs(s.lon - cf.fix.lon) > 0.02) continue;
        const d = S.distM(cf.fix.lat, cf.fix.lon, s.lat, s.lon);
        if (!best || d < best.d) best = { i: s.i, d, arrow: ARROWS[Math.round(bearing(cf.fix.lat, cf.fix.lon, s.lat, s.lon) / 45) % 8] };
      }
      if (!best) { v.state = "nostop"; v.idx = null; paintHead(v); paintBody(v); return; }
      cs.push(best); v.cands = [best];
    }
    v.state = "ready";
    let pick = v.idx;
    if (!(v.pinned && v.idx != null)) {
      const cur = cs.find((c) => c.i === v.idx);
      pick = !cur || cur.d - cs[0].d > 25 ? cs[0].i : v.idx;
    }
    if (v.idx != null && !v.cands.some((c) => c.i === v.idx)) { const cur = cs.find((c) => c.i === v.idx); if (cur) v.cands.push(cur); }
    setStop(v, pick);
  }
  function locate(v, force) {
    const cf = force ? null : currentFix();
    if (cf) applyFix(v, cf);
    if (cf && cf.fresh) return;
    S.getFix().then((f) => {
      if (hereView() !== v) return;
      remember(f);
      if (S.showFix) S.showFix();
      applyFix(v, { fix: f, fresh: true });
    }).catch((err) => {
      if (hereView() !== v) return;
      if (cf) return; /* keep the last known position */
      v.state = "error"; v.err = err; v.idx = null; paintHead(v); paintBody(v);
    });
  }

  S.renderHere = function (v) {
    S.setMode("stop");
    S.setSheet("mid");
    S.clearLine();
    v.state = v.state || "locating";
    v.tab = v.tab || "next";
    $("sv-status").textContent = ""; $("sv-foot").textContent = "";
    $("stop-view").scrollTop = 0;
    paintHead(v);
    paintBody(v);
    if (v.idx != null) { loadBoard(v); focusMap(v); }
    locate(v, false);
    /* re-check the position while the view is open (no watch): may re-target with hysteresis */
    S.stopLabelFns.timers(setInterval(() => {
      if (document.hidden || hereView() !== v || v.pinned) return;
      S.getFix().then((f) => { if (hereView() === v) { remember(f); applyFix(v, { fix: f, fresh: true }); } }).catch(() => {});
    }, 30000));
  };
  /** Open the Here view (idx: optional starting stop, e.g. from the Nearby row) */
  S.openHere = function (idx) {
    S.loadStops().then(() => {
      const cur = hereView();
      if (cur) { cur.pinned = false; cur.tab = "next"; locate(cur, true); return; }
      if (S.mode === "stop" || S.mode === "line") { /* leave the current stop/line first: Here replaces it */ }
      const v = { kind: "stop", here: true, idx: idx == null ? null : idx, pinned: false, tab: "next", state: idx == null ? "locating" : "ready" };
      if (idx != null) { const s = S.stops[idx]; const cf = currentFix(); v.fix = cf && cf.fix; v.fresh = !!(cf && cf.fresh); v.dist = cf ? S.distM(cf.fix.lat, cf.fix.lon, s.lat, s.lon) : 0; v.cands = cf ? nearbyStops(cf.fix).slice(0, 4) : []; }
      S.pushView(v);
    });
  };

  /* ———————————————— Here button + auto-offer ———————————————— */
  class HereControl {
    onAdd() {
      const wrap = document.createElement("div");
      wrap.className = "maplibregl-ctrl maplibregl-ctrl-group tt-here";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "here-btn";
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="3.5" width="13" height="14" rx="3.2"></rect><path d="M5.5 12h13M9 17.5V20.5M15 17.5V20.5"></path><circle cx="9" cy="14.8" r="0.6"></circle><circle cx="15" cy="14.8" r="0.6"></circle></svg><i class="here-dot" aria-hidden="true"></i>';
      btn.addEventListener("click", () => S.openHere());
      wrap.appendChild(btn);
      this._el = wrap;
      S.hereBtn = btn;
      return wrap;
    }
    onRemove() { this._el.remove(); }
  }
  map.addControl(new HereControl(), "bottom-right");
  function paintBtn() {
    const b = S.hereBtn;
    if (!b) return;
    const on = !!hereView();
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    const lab = S.t("hereBtn") + (b.dataset.near ? " · " + b.dataset.near : "");
    b.title = lab; b.setAttribute("aria-label", lab);
  }
  function updateOffer() {
    const b = S.hereBtn;
    if (!b || !S.stops || !S.stops.length) return;
    const f = geo.fix;
    let near = null;
    if (f && Date.now() - f.t < 180e3 && S.inTbilisi(f.lat, f.lon)) {
      const c = nearbyStops(f)[0];
      if (c && c.d <= NEAR_OFFER_M) near = S.stopName(S.stops[c.i]);
    }
    b.classList.toggle("near", !!near);
    if (near) b.dataset.near = near; else delete b.dataset.near;
    paintBtn();
  }
  const prevFix = S.onGeoFix;
  let lastTripCard = 0;
  S.onGeoFix = function (f) {
    if (prevFix) prevFix.apply(this, arguments);
    remember(f);
    updateOffer();
    const v = hereView();
    if (v && !v.pinned) applyFix(v, { fix: f, fresh: true });
    if (S.mode === "trip" && Date.now() - lastTripCard > 5000) { lastTripCard = Date.now(); updateCard(); }
  };
  const prevMode = S.onMode;
  S.onMode = function (m) {
    if (prevMode) prevMode.apply(this, arguments);
    if (m !== "trip") { card.hidden = true; cardStop(); }
    if (m !== "stop") sv.classList.remove("here");
    paintBtn();
    if (m === "trip") updateCard();
  };
  /* back on the page at a stop: quietly refresh the position (only when permission is already granted) */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !navigator.permissions || !navigator.permissions.query) return;
    navigator.permissions.query({ name: "geolocation" }).then((p) => {
      if (p.state === "granted" && (!geo.fix || Date.now() - geo.fix.t > 60e3)) S.getFix().catch(() => {});
    }).catch(() => {});
  });
  S.loadStops().then(() => { updateOffer(); });
  const applyLang = S.applyLang;
  S.applyLang = function () { applyLang.apply(this, arguments); paintBtn(); const v = hereView(); if (v) { paintHead(v); paintBody(v); } };

  /* ———————————————— "At the stop" card (planned trip) ———————————————— */
  const card = $("at-stop");
  let cardTimer = null, cardSeq = 0;
  function badge(code) {
    const l = S.lines && S.lines.find((x) => x.code === code);
    return l ? S.lineBadge(l, "big") : '<span class="line-badge big">' + esc(code) + "</span>";
  }
  function cardRow(label, cls, codes, deps) {
    if (!codes.length) return "";
    return '<div class="as-row ' + cls + '"><div class="as-label">' + esc(label) + '</div><div class="as-lines">' +
      codes.map((c) => {
        const ts = deps.get(c) || [];
        return '<div class="as-line">' + badge(c) + '<span class="as-times">' +
          (ts.length ? ts.slice(0, 2).map((t) => '<span class="as-t' + (t.rt ? " rt" : "") + '">' + (t.rt ? '<i class="rt-dot"></i>' : "") + esc(countdown(t.ms)) + "</span>").join("") : "—") +
          "</span></div>";
      }).join("") + "</div></div>";
  }
  async function updateCard() {
    const my = ++cardSeq;
    const f = geo.fix;
    let hit = null;
    if (S.mode === "trip" && f && Date.now() - f.t < 180e3) {
      let bd = 200;
      boardings().forEach((c) => { const d = S.distM(f.lat, f.lon, c.lat, c.lon); if (d < bd) { bd = d; hit = c; } });
    }
    if (!hit) { card.hidden = true; card.innerHTML = ""; cardStop(); return; }
    const b = hit, deps = new Map();
    const paint = () => {
      card.innerHTML = '<button type="button" class="as-head" id="as-open">' + esc(S.tf("atStop", b.name || "")) + ' <span class="as-more">' + esc(S.t("hereAllDeps")) + " ›</span></button>" +
        cardRow(S.t("atStopDirect"), "direct", b.direct, deps) + cardRow(S.t("atStopTransfer"), "transfer", b.transfer, deps) +
        '<p class="as-note">' + esc(S.t("atStopHint")) + "</p>";
      card.hidden = false;
      const o = $("as-open");
      if (o) o.addEventListener("click", () => S.openHere(st ? st.i : undefined));
    };
    await S.loadStops();
    const st = S.nearestStop(b.lat, b.lon, 150);
    paint();
    if (st) {
      try {
        const d = await S.getDepartures(st.i);
        if (my !== cardSeq) return;
        d.flat.forEach((e) => {
          if (e.boardId && b.ids.size && !b.ids.has(e.boardId)) return; /* other side of the road */
          const c = e.line.code;
          deps.set(c, (deps.get(c) || []).concat([e]).sort((x, y) => x.ms - y.ms));
        });
        paint();
      } catch (e) { /* badges without times */ }
    }
    if (!cardTimer) cardTimer = setInterval(() => { if (!document.hidden) updateCard(); }, 30000);
  }
  function cardStop() { clearInterval(cardTimer); cardTimer = null; }
  S.updateAtStop = updateCard;
  paintBtn();
})();
