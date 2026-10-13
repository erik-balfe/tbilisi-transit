/*
 * "At the stop" card: once a trip is planned and the rider is at (≤ 200 m) a boarding stop of one of the options
 * — or taps "At the stop" — show big badges of every line from this stop that fits (direct vs with transfer)
 * with their next arrivals, so a glance at an arriving bus answers "does it fit?".
 */
(function () {
  const S = window.__tt;
  const $ = S.$;
  const esc = S.escapeHtml;
  const card = $("at-stop");
  const btn = $("at-stop-btn");
  const RT_PREFIX = "ge-tbilisi-transport-company_1:";
  let forced = false, timer = null, seq = 0;

  /** boarding stops of all options → {lat, lon, name, key, ids:Set, direct:[codes], transfer:[codes]} */
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
  function pick(cands) {
    const f = S.geo && S.geo.fix;
    if (f && Date.now() - f.t < 180000) {
      let best = null, bd = 200;
      cands.forEach((c) => { const d = S.distM(f.lat, f.lon, c.lat, c.lon); if (d < bd) { bd = d; best = c; } });
      if (best) return { b: best, near: true };
    }
    if (!forced) return null;
    const it = (S.lastItineraries || [])[S.selectedItin || 0];
    const l = it && (it.legs || []).filter(S.isTransitLeg)[0];
    const b = l && cands.find((c) => c.key === S.placeKey(l.from));
    return b ? { b, near: false } : null;
  }
  function badge(code) {
    const l = S.lines && S.lines.find((x) => x.code === code);
    return l ? S.lineBadge(l, "big") : '<span class="line-badge big">' + esc(code) + "</span>";
  }
  function row(label, cls, codes, deps) {
    if (!codes.length) return "";
    return '<div class="as-row ' + cls + '"><div class="as-label">' + esc(label) + '</div><div class="as-lines">' +
      codes.map((c) => {
        const ts = deps.get(c) || [];
        return '<div class="as-line">' + badge(c) + '<span class="as-times">' +
          (ts.length ? ts.slice(0, 2).map((t) => '<span class="as-t' + (t.rt ? " rt" : "") + '">' + (t.rt ? '<i class="rt-dot"></i>' : "") +
            esc(S.tf("inMin", Math.max(0, Math.round((t.ms - Date.now()) / 60000)))) + "</span>").join("") : "—") +
          "</span></div>";
      }).join("") + "</div></div>";
  }
  async function update() {
    const my = ++seq;
    btn.hidden = S.mode !== "trip" || !(S.lastItineraries || []).some((it) => (it.legs || []).some(S.isTransitLeg));
    btn.setAttribute("aria-pressed", forced ? "true" : "false");
    btn.classList.toggle("on", forced);
    const p = S.mode === "trip" ? pick(boardings()) : null;
    if (!p) { card.hidden = true; card.innerHTML = ""; stop(); return; }
    const b = p.b;
    const deps = new Map();
    const paint = () => {
      card.innerHTML = '<div class="as-head">' + esc(S.tf("atStop", b.name || "")) + "</div>" +
        (p.near ? "" : '<p class="as-note">' + esc(S.t("atStopFar")) + "</p>") +
        row(S.t("atStopDirect"), "direct", b.direct, deps) +
        row(S.t("atStopTransfer"), "transfer", b.transfer, deps) +
        '<p class="as-note">' + esc(S.t("atStopHint")) + "</p>";
      card.hidden = false;
    };
    paint();
    await S.loadStops();
    const st = S.nearestStop(b.lat, b.lon, 150);
    if (st && S.getDepartures) {
      try {
        const d = await S.getDepartures(st.i);
        if (my !== seq) return;
        d.groups.forEach((g) => {
          if (g.boardId && b.ids.size && !b.ids.has(g.boardId)) return; /* other side of the road */
          const c = g.line.code;
          deps.set(c, (deps.get(c) || []).concat(g.times).sort((x, y) => x.ms - y.ms));
        });
        paint();
      } catch (e) { /* keep badges without times */ }
    }
    if (!timer) timer = setInterval(() => { if (!document.hidden) update(); }, 30000);
  }
  function stop() { clearInterval(timer); timer = null; }
  btn.addEventListener("click", () => { forced = !forced; update(); });
  S.updateAtStop = update;
  const prevFix = S.onGeoFix;
  let lastFixUpd = 0;
  S.onGeoFix = function () {
    if (prevFix) prevFix.apply(this, arguments);
    if (S.mode === "trip" && Date.now() - lastFixUpd > 5000) { lastFixUpd = Date.now(); update(); }
  };
  const prevMode = S.onMode;
  S.onMode = function (m) {
    if (prevMode) prevMode.apply(this, arguments);
    if (m !== "trip") { forced = false; card.hidden = true; stop(); btn.hidden = true; }
  };
  btn.hidden = true;
})();
