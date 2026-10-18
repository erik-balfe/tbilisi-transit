/*
 * Trip options with transfers: how often each line runs, how long you wait at a transfer, a score that prefers
 * frequent lines and short, safe connections, and the map labels (Board / Transfer / Alight) for the selected option.
 */
(function () {
  const S = window.__tt;
  const esc = S.escapeHtml;
  const RT_PREFIX = "ge-tbilisi-transport-company_1:";
  const PAL = ["#2563eb", "#ea580c", "#9333ea", "#0d9488", "#db2777", "#ca8a04"];
  const RARE_MIN = 90; /* assumed gap (min) of a line with fewer than two departures around the trip time */
  S.legPalette = (k) => PAL[k % PAL.length];

  const sid = (p) => (p && p.stopId ? String(p.stopId).replace(RT_PREFIX, "") : "");
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tbilisi" });
  const minFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tbilisi", hour: "2-digit", minute: "2-digit", hour12: false });
  const tbMin = (ms) => { const p = minFmt.format(new Date(ms)).split(":"); return Number(p[0]) % 24 * 60 + Number(p[1]); };
  const isTransit = (l) => (l.mode || "WALK").toUpperCase() !== "WALK";

  /** how often the line runs around this leg's departure → {every: minutes|null, n} (null = fewer than 2 departures nearby) */
  async function legFreq(leg) {
    if (leg._freq !== undefined) return leg._freq;
    leg._freq = null;
    const l = S.lineFromRouteId ? S.lineFromRouteId(leg.routeId) : null;
    if (!l || !leg.from || !leg.to) return null;
    let ld;
    try { ld = await S.loadLine(l.key); } catch (e) { return null; }
    const a = sid(leg.from), b = sid(leg.to);
    let hit = null;
    ld.dirs.forEach((dir) => {
      if (hit) return;
      const i = dir.stops.findIndex((s) => s.id === a);
      if (i < 0) return;
      if (dir.stops.findIndex((s, x) => x > i && s.id === b) < 0) return;
      hit = { dir, i };
    });
    if (!hit) return null;
    const st = Date.parse(leg.startTime);
    if (!st || dayFmt.format(new Date(st)) !== dayFmt.format(new Date())) return null; /* the timetable index is for today */
    const at = tbMin(st);
    const times = S.sched.startsToday(hit.dir).map((t) => t + hit.dir.off[hit.i]).filter((m) => m >= at - 45 && m <= at + 75).sort((x, y) => x - y)
      .filter((m, i, arr) => i === 0 || m - arr[i - 1] > 0.75);
    const gaps = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    gaps.sort((x, y) => x - y);
    leg._freq = { n: times.length, every: gaps.length ? Math.max(1, Math.round(gaps[Math.floor(gaps.length / 2)])) : null };
    return leg._freq;
  }

  /** Fill leg._every / leg._wait and it._score for every option (waits for the line files, but never longer than ~2.5 s) */
  S.enrichItineraries = async function (list) {
    const legs = [];
    (list || []).forEach((it) => (it.legs || []).forEach((l) => { if (isTransit(l)) legs.push(l); }));
    try {
      await Promise.race([Promise.all(legs.map(legFreq)), new Promise((r) => setTimeout(r, 2500))]);
    } catch (e) { /* scores without frequencies */ }
    (list || []).forEach((it) => {
      const ls = it.legs || [];
      let prev = null, walkBetween = 0, score = (Date.parse(it.endTime) - Date.now()) / 60000, nT = 0;
      ls.forEach((l) => {
        if (!isTransit(l)) { if (prev) walkBetween += (l.duration || 0) / 60; return; }
        const f = l._freq;
        l._every = f && f.every ? f.every : null;
        const H = l._every || (f ? RARE_MIN : 60);
        if (!S.isMetroMode(l.mode)) score += Math.min(20, H / 4); /* a rare line costs you when something slips */
        if (prev) {
          nT++;
          l._wait = Math.max(0, Math.round((Date.parse(l.startTime) - Date.parse(prev.endTime)) / 60000 - walkBetween));
          if (l._wait < 4) score += ((4 - l._wait) / 4) * H * 0.5; /* a tight connection may be missed */
        }
        prev = l; walkBetween = 0;
      });
      it._score = score + 8 * nT;
    });
  };

  /* —— map labels —— */
  let markers = [];
  S.clearTripMarkers = function () { markers.forEach((m) => m.remove()); markers = []; };
  function stepEl(kind, parts, color) {
    const el = document.createElement("div");
    el.className = "tt-step " + kind.toLowerCase();
    el.style.setProperty("--step", color);
    el.innerHTML = '<span class="st-kind">' + esc(S.t("step" + kind)) + "</span>" +
      parts.lines.map((c) => '<span class="st-badge" style="background:' + c[1] + ";color:" + S.textOn(c[1]) + '">' + esc(c[0]) + "</span>").join('<span class="st-arrow">›</span>') +
      '<span class="st-name">' + esc(parts.name) + "</span>";
    return el;
  }
  /** Board / Transfer / Alight labels of one option, each with the line number in the colour of its leg */
  S.drawTripMarkers = function (it) {
    S.clearTripMarkers();
    if (!it || !window.maplibregl) return;
    const tl = (it.legs || []).filter(isTransit);
    if (!tl.length) return;
    const col = (l, k) => S.legColor(l, S.legPalette(k));
    const name = (p, fallback) => (p && p.name && p.name !== "START" && p.name !== "END" ? p.name : S.displayName(fallback));
    /* label hangs towards the middle of the trip, so it never runs off the screen edge */
    const pts = [];
    tl.forEach((l) => { pts.push(l.from.lon, l.to.lon); });
    const midLon = pts.reduce((a, b) => a + b, 0) / pts.length;
    const add = (kind, p, parts, color) => {
      if (!p || typeof p.lat !== "number") return;
      const anchor = p.lon > midLon ? "right" : "left";
      markers.push(new maplibregl.Marker({ element: stepEl(kind, parts, color), anchor }).setLngLat([p.lon, p.lat]).addTo(S.map));
    };
    tl.forEach((l, k) => {
      const c = col(l, k);
      if (k === 0) add("Board", l.from, { lines: [[S.legName(l), c]], name: name(l.from, S.fromPlace) }, c);
      const next = tl[k + 1];
      if (next) {
        const c2 = col(next, k + 1);
        const d = S.distM(l.to.lat, l.to.lon, next.from.lat, next.from.lon);
        if (d < 80) add("Transfer", l.to, { lines: [[S.legName(l), c], [S.legName(next), c2]], name: name(l.to) }, c2);
        else {
          add("Transfer", l.to, { lines: [[S.legName(l), c]], name: name(l.to) }, c);
          add("Board", next.from, { lines: [[S.legName(next), c2]], name: name(next.from) }, c2);
        }
      } else add("Alight", l.to, { lines: [[S.legName(l), c]], name: name(l.to, S.toPlace) }, c);
    });
  };
})();
