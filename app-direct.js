/*
 * Direct lines for a planned trip: every line that runs from a stop near From to a stop near To without a transfer.
 * Built from the local timetable (line files in IndexedDB), so nothing is left out and it works offline;
 * live departures (Transitous stoptimes) upgrade the times afterwards.
 * The route planner (Transitous /v5/plan) only returns its few best options; this list is the complete set.
 */
(function () {
  const S = window.__tt;
  const $ = S.$;
  const esc = S.escapeHtml;
  const BOARD_M = 300;      /* max straight-line distance From → boarding stop */
  const ALIGHT_M = 400;     /* max straight-line distance alighting stop → To */
  const WALK_M_PER_MIN = 80 / 1.3; /* crow-flies metres per minute (80 m/min on the street, 1.3 detour factor) */
    const MAX_BOARD_STOPS = 4;
  let seq = 0;
  let last = null; /* {key, entries} for instant re-render (language switch) */

  const walkMin = (m) => Math.max(1, Math.round(m / WALK_M_PER_MIN));
  const tbMsOf = (min) => Date.now() + (min - S.tbNow().min) * 60000;

  /** Pure: all direct (line, direction, boarding stop, alighting stop) options → [{line, di, term, bid, bi, boardStop, alightStop, walkA, walkB, mins}] */
  S.findDirect = async function (from, to) {
    await S.loadLines();
    const near = (S.stops || []).map((s) => ({ s, d: S.distM(from.lat, from.lon, s.lat, s.lon) }))
      .filter((c) => c.d <= BOARD_M).sort((a, b) => a.d - b.d).slice(0, MAX_BOARD_STOPS);
    const best = new Map(); /* line key → best option */
    await Promise.all(near.map(async (c) => {
      const ids = new Set(c.s.ids);
      const lines = (S.stopLines[c.s.i] || []).map((li) => S.lines[li]).filter(Boolean);
      await Promise.all(lines.map(async (l) => {
        let ld;
        try { ld = await S.loadLine(l.key); } catch (e) { return; }
        ld.dirs.forEach((dir, di) => {
          const j = dir.stops.findIndex((s) => ids.has(s.id));
          if (j < 0 || j >= dir.stops.length - 1) return;
          let k = -1, kd = ALIGHT_M + 1;
          for (let x = j + 1; x < dir.stops.length; x++) {
            const st = dir.stops[x];
            const d = S.distM(to.lat, to.lon, st.lat, st.lon);
            if (d < kd) { kd = d; k = x; }
          }
          if (k < 0) return;
          const o = {
            line: l, di, dir, bid: dir.stops[j].id, bi: c.s.i, j, k, boardStop: dir.stops[j], alightStop: dir.stops[k],
            term: dir.stops[dir.stops.length - 1], walkA: c.d, walkB: kd,
            mins: Math.max(1, Math.round(dir.off[k] - dir.off[j])),
          };
          const p = best.get(l.key);
          if (!p || o.walkA + o.walkB < p.walkA + p.walkB - 1) best.set(l.key, o);
        });
      }));
    }));
    return [...best.values()];
  };

  /** scheduled times (ms) at the boarding stop of an option; only those the rider can still reach on foot */
  function localTimes(o, n) {
    const need = Date.now() + walkMin(o.walkA) * 60000 - 60000;
    const out = [];
    S.sched.nextAt(o.dir, o.j, 40).forEach((m) => { const ms = tbMsOf(m); if (ms >= need && out.length < n) out.push({ ms, rt: false }); });
    return out;
  }
  /** local schedule + live rows of the same line at the same stop (live wins within 90 s) */
  function mergeTimes(o, flat) {
    const need = Date.now() + walkMin(o.walkA) * 60000 - 60000;
    const live = (flat || []).filter((e) => e.line && e.line.key === o.line.key && (!e.boardId || e.boardId === o.bid) && e.ms >= need)
      .map((e) => ({ ms: e.ms, rt: !!e.rt }));
    const sched = localTimes(o, 6).filter((t) => !live.some((l) => Math.abs(l.ms - t.ms) <= 90000));
    return live.concat(sched).sort((a, b) => a.ms - b.ms).filter((t, i, arr) => i === 0 || t.ms - arr[i - 1].ms > 45000).slice(0, 3);
  }

  const WINDOW_MIN = 90;
  /** scheduled departures at the boarding stop in the next 90 min → {n, every(min|null), mins:[minute-of-day]} */
  function frequency(o) {
    const now = S.tbNow().min;
    const mins = S.sched.nextAt(o.dir, o.j, 120).filter((m) => m - now <= WINDOW_MIN)
      .filter((m, i, arr) => i === 0 || m - arr[i - 1] > 0.75);
    const n = mins.length;
    const every = n >= 2 ? Math.max(1, Math.round((mins[n - 1] - mins[0]) / (n - 1))) : null;
    return { n, every, mins };
  }
  const nextLabel = (t) => {
    const m = Math.round((t.ms - Date.now()) / 60000);
    return m > WINDOW_MIN ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tbilisi" }).format(new Date(t.ms)) : S.tf("inMin", Math.max(0, m));
  };
  const everyLabel = (f) => (f.every ? S.tf("directEvery", f.every) : f.n === 1 ? S.t("directFew") : S.t("directRare"));
  /** any of the lines: pooled departures → average gap in minutes, or null */
  function combinedEvery(entries) {
    const all = [].concat.apply([], entries.map((e) => e.f.mins)).sort((a, b) => a - b);
    return all.length >= 2 ? Math.max(1, Math.round((all[all.length - 1] - all[0]) / (all.length - 1))) : null;
  }

  function rowEl(e) {
    const o = e.o, t = e.times;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dep-row here-row direct-row" + (t.length && t[0].rt ? " has-live" : "");
    const walk = o.walkA >= 60 ? " · " + S.tf("directWalk", walkMin(o.walkA)) : "";
    const more = t.length > 1 ? " · " + S.tf("directThen", t.slice(1).map((x) => Math.max(0, Math.round((x.ms - Date.now()) / 60000))).join(", ")) : "";
    b.innerHTML = S.lineBadge(o.line, "lg") +
      '<span class="dep-main"><span class="dep-head">' + esc(S.tf("toTerminal", S.stopName(o.term))) + "</span>" +
      '<span class="dep-via"><i>' + esc(S.tf("directRide", o.mins)) + "</i> · " + esc(everyLabel(e.f)) + esc(walk) + esc(more) + "</span></span>" +
      (t.length
        ? '<span class="dep-first' + (t[0].rt ? " rt" : "") + (t[0].ms - Date.now() < 90000 ? " soon" : "") + '">' +
          (t[0].rt ? '<i class="rt-dot" aria-label="' + esc(S.t("live")) + '"></i>' : "") +
          '<span class="dep-min">' + esc(S.tf("inMin", Math.max(0, Math.round((t[0].ms - Date.now()) / 60000)))) + "</span>" +
          '<span class="dep-kind">' + esc(t[0].rt ? S.t("live") : S.t("scheduled")) + "</span></span>"
        : '<span class="dep-first"><span class="dep-kind">' + esc(S.t("directNone")) + "</span></span>");
    b.dataset.line = o.line.code;
    b.addEventListener("click", () => openOpt(o, t));
    return b;
  }

  function openOpt(o, t) {
    S.openLine(o.line.key, { boardStop: o.bi, termId: o.term.id, dirIdx: o.di, depMs: t.length ? t[0].ms : undefined, depRt: t.length ? t[0].rt : undefined });
  }
  /** compact chip: badge, minutes to the next departure, how often it runs */
  function chipEl(e) {
    const o = e.o, t = e.times;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "direct-chip";
    b.dataset.line = o.line.code;
    b.dataset.n = String(e.f.n);
    if (e.f.every) b.dataset.every = String(e.f.every);
    b.innerHTML = S.lineBadge(o.line, "lg") +
      '<span class="dc-next' + (t.length && t[0].rt ? " rt" : "") + '">' + (t.length && t[0].rt ? '<i class="rt-dot"></i>' : "") + esc(t.length ? nextLabel(t[0]) : "—") + "</span>" +
      '<span class="dc-every">' + esc(everyLabel(e.f)) + "</span>";
    b.setAttribute("aria-label", o.line.code + " → " + S.stopName(o.term) + ", " + everyLabel(e.f));
    b.addEventListener("click", () => openOpt(o, t));
    return b;
  }

  function sectionEl() {
    let el = $("direct-lines");
    if (!el) {
      el = document.createElement("section");
      el.id = "direct-lines";
      el.className = "direct-lines";
    }
    if (el.parentNode !== S.resultsEl || S.resultsEl.firstChild !== el) S.resultsEl.insertBefore(el, S.resultsEl.firstChild);
    return el;
  }
  let detail = false; /* rows with terminal / ride / next times */
  function paint(entries) {
    const el = sectionEl();
    if (!entries.length) { el.remove(); return; }
    el.innerHTML = '<h3 class="itin-section">' + esc(S.tf("directAll", entries.length)) + '</h3><p class="direct-hint">' + esc(S.tf("directHint", { every: combinedEvery(entries) })) + '</p><div class="direct-chips"></div>';
    const chips = el.querySelector(".direct-chips");
    entries.forEach((e) => chips.appendChild(chipEl(e)));
    const tg = document.createElement("button");
    tg.type = "button"; tg.className = "here-more direct-toggle"; tg.setAttribute("aria-expanded", detail ? "true" : "false");
    tg.textContent = S.t(detail ? "directHideDetails" : "directShowDetails");
    tg.addEventListener("click", () => { detail = !detail; paint(entries); });
    el.appendChild(tg);
    if (detail) {
      const list = document.createElement("div");
      list.className = "direct-list";
      entries.forEach((e) => list.appendChild(rowEl(e)));
      el.appendChild(list);
    }
  }
  /* most departures in the next 90 min first (most frequent line on top), then the soonest */
  const order = (a, b) => b.f.n - a.f.n || (a.times.length ? a.times[0].ms : 1e15) - (b.times.length ? b.times[0].ms : 1e15) || a.o.walkA - b.o.walkA;

  /** Show / refresh the "all direct lines" section on top of the trip results */
  S.paintDirectLines = async function () {
    const from = S.fromPlace, to = S.toPlace;
    const my = ++seq;
    if (!from || !to || S.mode !== "trip") { const el = $("direct-lines"); if (el) el.remove(); return; }
    const key = S.placeKey(from) + ">" + S.placeKey(to);
    if (last && last.key === key && Date.now() - last.at < 20000) paint(last.entries);
    else {
      const sk = sectionEl();
      sk.innerHTML = '<h3 class="itin-section">' + esc(S.t("directAllLoading")) + '</h3><div class="skeleton sm"></div>';
    }
    let found;
    try { found = await S.findDirect(from, to); } catch (e) { console.warn("direct", e); if (my === seq) { const el = $("direct-lines"); if (el) el.remove(); } return; }
    if (my !== seq) return;
    const entries = found.map((o) => ({ o, f: frequency(o), times: localTimes(o, 3) })).sort(order);
    last = { key, entries, at: Date.now() };
    paint(entries);
    if (!S.online || !entries.length) return;
    /* live upgrade: one stoptimes board per boarding stop */
    const idxs = [...new Set(entries.map((e) => e.o.bi))];
    const boards = new Map();
    await Promise.all(idxs.map((i) => S.getDepartures(i).then((d) => boards.set(i, d)).catch(() => {})));
    if (my !== seq) return;
    entries.forEach((e) => { const d = boards.get(e.o.bi); e.times = mergeTimes(e.o, d && !d.offline ? d.flat : null); });
    entries.sort(order);
    last = { key, entries, at: Date.now() };
    paint(entries);
  };
  /* refresh countdowns while the trip is on screen */
  setInterval(() => { if (!document.hidden && S.mode === "trip" && last && $("direct-lines")) paint(last.entries); }, 30000);
})();
