/*
 * Live vehicles on the selected itinerary.
 * Source: Transitous (MOTIS) GET /api/v1/map/trips — trip segments between stops inside a bbox
 * for a time window. Each segment carries departure/arrival (realtime-adjusted when the TTC
 * GTFS-RT feed covers the trip: Transitous derives trip updates from TTC vehicle GPS) and a
 * `realTime` flag. We interpolate each vehicle along its current segment polyline every second
 * and refetch every 15 s. realTime=false → shown as "scheduled" (ghost style), honestly labelled.
 */
(function () {
  const S = window.__tt;
  const $ = S.$;
  const map = S.map;
  if (!map) return;

  const REFRESH_MS = 15000;
  let timer = null, tick = null, seq = 0;
  let segs = [];           /* [{tripId, route, rt, dep, arr, coords, cum, total, color, mine}] */
  const markers = new Map(); /* tripId -> Marker */
  let ctx = null;          /* {legs:[{routeId, dir, routeShortName, tripId, color}], bbox} */

  function chip(text, cls) {
    const el = $("vehicle-chip");
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
    el.className = "vehicle-chip" + (cls ? " " + cls : "");
  }

  function dirOf(tripId, routeId) {
    if (!tripId || !routeId) return null;
    const i = tripId.indexOf(routeId + "-");
    return i >= 0 ? tripId.charAt(i + routeId.length + 1) : null;
  }

  function buildCtx(it, color) {
    const legs = [];
    let minLat = 90, minLon = 180, maxLat = -90, maxLon = -180;
    (it.legs || []).forEach((leg) => {
      const m = (leg.mode || "WALK").toUpperCase();
      if (m === "WALK" || !leg.routeId) return;
      legs.push({ routeId: leg.routeId, dir: dirOf(leg.tripId, leg.routeId), routeShortName: leg.routeShortName || leg.displayName || "", tripId: leg.tripId, mode: m });
      S.legCoords(leg).forEach(([lon, lat]) => {
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
      });
    });
    if (!legs.length) return null;
    /* pad ~2.5 km upstream so approaching vehicles are visible */
    const pad = 0.025;
    return { legs, color, min: [minLat - pad, minLon - pad * 1.3], max: [maxLat + pad, maxLon + pad * 1.3] };
  }

  function prep(coords) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) {
      cum.push(cum[i - 1] + S.distM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
    }
    return { cum, total: cum[cum.length - 1] || 0 };
  }
  function pointAt(s, frac) {
    const target = s.total * Math.max(0, Math.min(1, frac));
    const c = s.coords, cum = s.cum;
    for (let i = 1; i < c.length; i++) {
      if (cum[i] >= target) {
        const seg = cum[i] - cum[i - 1] || 1;
        const f = (target - cum[i - 1]) / seg;
        return [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * f, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * f];
      }
    }
    return c[c.length - 1];
  }

  async function fetchSegments() {
    if (!ctx || document.hidden || !S.online) return;
    const my = ++seq;
    const now = Date.now();
    const start = new Date(now - 60000).toISOString();
    const end = new Date(now + 90000).toISOString();
    const path = "/v1/map/trips?min=" + ctx.min.map((v) => v.toFixed(4)).join(",") +
      "&max=" + ctx.max.map((v) => v.toFixed(4)).join(",") +
      "&zoom=16&startTime=" + encodeURIComponent(start) + "&endTime=" + encodeURIComponent(end);
    let data;
    try { data = await S.apiGet(path, { timeout: 12000 }); } catch (e) { return; }
    if (my !== seq || !ctx) return;
    const out = [];
    (Array.isArray(data) ? data : []).forEach((sg) => {
      const tr = (sg.trips || [])[0];
      if (!tr || !sg.polyline) return;
      const leg = ctx.legs.find((l) => tr.tripId.indexOf(l.routeId + "-") >= 0 &&
        (l.dir == null || dirOf(tr.tripId, l.routeId) === l.dir));
      if (!leg) return;
      const coords = S.decodePolyline(sg.polyline, 5);
      if (coords.length < 2) return;
      const pr = prep(coords);
      out.push({
        tripId: tr.tripId, route: tr.routeShortName || leg.routeShortName, rt: !!sg.realTime,
        dep: Date.parse(sg.departure), arr: Date.parse(sg.arrival), coords, cum: pr.cum, total: pr.total,
        mine: tr.tripId === leg.tripId, mode: leg.mode,
      });
    });
    segs = out;
    render();
  }

  function render() {
    if (!ctx) return;
    const now = Date.now();
    /* one position per trip: segment containing now, else dwelling at next segment start */
    const best = new Map();
    segs.forEach((s) => {
      let pos = null, rank = 9;
      if (now >= s.dep && now <= s.arr) { pos = pointAt(s, (now - s.dep) / Math.max(1, s.arr - s.dep)); rank = 0; }
      else if (now < s.dep && s.dep - now < 90000) { pos = s.coords[0]; rank = 1 + (s.dep - now) / 1e6; }
      if (!pos) return;
      const cur = best.get(s.tripId);
      if (!cur || rank < cur.rank) best.set(s.tripId, { pos, rank, s });
    });
    let live = 0, sched = 0;
    const seen = new Set();
    best.forEach(({ pos, s }, id) => {
      seen.add(id);
      if (s.rt) live++; else sched++;
      let mk = markers.get(id);
      if (!mk) {
        const el = document.createElement("div");
        el.className = "veh";
        el.innerHTML = '<span class="veh-num"></span>';
        mk = new maplibregl.Marker({ element: el, anchor: "center" });
        markers.set(id, mk);
        mk.setLngLat(pos).addTo(map);
      } else {
        mk.setLngLat(pos);
      }
      const el = mk.getElement();
      el.style.setProperty("--veh", ctx.color);
      el.style.setProperty("--veh-text", S.textOn(ctx.color));
      el.classList.toggle("rt", s.rt);
      el.classList.toggle("sched", !s.rt);
      el.classList.toggle("mine", s.mine);
      el.classList.toggle("metro", s.mode === "SUBWAY" || s.mode === "METRO");
      el.querySelector(".veh-num").textContent = s.route;
      el.title = s.route + " · " + (s.rt ? S.t("live") : S.t("scheduled")) + (s.mine ? " · " + S.t("yourBus") : "");
    });
    markers.forEach((mk, id) => { if (!seen.has(id)) { mk.remove(); markers.delete(id); } });
    const parts = [];
    if (live) parts.push(S.tf("vehLive", live));
    if (sched) parts.push(S.tf("vehSched", sched));
    if (parts.length) chip("● " + parts.join(" · "), live ? "is-live" : "is-sched");
    else chip(segs.length || S.online ? S.t("vehNone") : "", "is-none");
  }

  S.stopVehicles = function () {
    ctx = null; segs = []; ++seq;
    clearInterval(timer); clearInterval(tick); timer = tick = null;
    markers.forEach((mk) => mk.remove());
    markers.clear();
    chip("");
  };
  /** Start for the selected itinerary (index into S.lastItineraries) */
  S.showVehicles = function (idx) {
    S.stopVehicles();
    const it = (S.lastItineraries || [])[idx];
    if (!it || S.mode !== "trip") return;
    ctx = buildCtx(it, S.itinColor(idx));
    if (!ctx) return;
    fetchSegments();
    timer = setInterval(fetchSegments, REFRESH_MS);
    tick = setInterval(render, 1000);
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ctx) fetchSegments(); });
})();
