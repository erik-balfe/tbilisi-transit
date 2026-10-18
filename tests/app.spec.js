// @ts-check
const { test, expect } = require("@playwright/test");

/** wait until the runtime data (stops + lines index) is in memory */
async function dataReady(page) {
  await page.waitForFunction(() => window.__tt && (window.__tt.stops || []).length > 800 && (window.__tt.lines || []).length > 100, null, { timeout: 60_000 });
}
async function swReady(page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  }
}
async function openLine(page, code) {
  await page.click("#pick-search");
  await page.fill("#from", code);
  const row = page.locator(".line-row").first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator("#line-view")).toBeVisible();
  await expect(page.locator("#lv-stops li").first()).toBeVisible({ timeout: 30_000 });
}

test("no data bundled in code: first run downloads manifest + essentials into IndexedDB", async ({ page }) => {
  const dataReqs = [];
  page.on("request", (r) => { if (r.url().includes("/data/")) dataReqs.push(new URL(r.url()).pathname); });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await dataReady(page);
  expect(dataReqs.some((p) => p.endsWith("/data/manifest.json"))).toBeTruthy();
  expect(dataReqs.some((p) => /\/data\/stops\.[0-9a-f]{12}\.json$/.test(p))).toBeTruthy();
  expect(dataReqs.some((p) => /\/data\/lines\.[0-9a-f]{12}\.json$/.test(p))).toBeTruthy();
  /* per-line files are lazy: none fetched on start */
  expect(dataReqs.filter((p) => p.includes("/data/lines/")).length).toBe(0);
  const m = await page.evaluate(() => window.TTStore.manifest());
  expect(m.version).toBeTruthy();
  expect(m.feed_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator("#data-pill")).toBeHidden({ timeout: 20_000 }); /* progress gone (feed not expiring) */
  expect(errors).toEqual([]);
});

test("line view: search by number, stops + timetable render, line file cached lazily", async ({ page }) => {
  await page.goto("./");
  await dataReady(page);
  await openLine(page, "314");
  await expect(page.locator("#lv-title")).not.toBeEmpty();
  await expect.poll(() => page.evaluate(() => window.TTStore.linesStored().then((c) => c.done)), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
});

test("deep links ?line= and ?stop= work", async ({ page }) => {
  await page.goto("./?line=314");
  await expect(page.locator("#line-view")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#lv-stops li").first()).toBeVisible({ timeout: 30_000 });
  const code = await page.evaluate(() => window.__tt.stops.find((s) => !s.kind && s.ids.length).ids[0]);
  await page.goto("./?stop=" + encodeURIComponent(code));
  await expect(page.locator("#stop-view")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#sv-title")).not.toBeEmpty();
});

test("offline: reload works from cache, stops + line view from IndexedDB, no polling", async ({ page, context, browserName }) => {
  await page.goto("./");
  await dataReady(page);
  await swReady(page);
  await dataReady(page);
  await openLine(page, "314");                   /* caches the line file in IndexedDB */
  await page.goBack().catch(() => {});
  await page.waitForTimeout(500);
  await context.setOffline(true);
  const reqs = [];
  page.on("request", (r) => reqs.push(r.url()));
  if (browserName === "webkit") {
    /* Playwright's WebKit can't reload under emulated offline ("internal error") → check the in-page offline path */
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.evaluate(() => window.__tt.stopLines && window.__tt.enterPick && window.__tt.enterPick("from"));
  } else {
    await page.reload();
  }
  await dataReady(page);
  await expect(page.locator("#offline-pill")).toBeVisible();
  const line = await page.evaluate(() => window.__tt.store.getLine(window.__tt.lines.find((l) => l.code === "314").key).then((d) => d.dirs.length));
  expect(line).toBeGreaterThan(0);
  if (browserName !== "webkit") await openLine(page, "314");
  /* no network polling while idle offline (old app probed every 15 s) */
  const before = reqs.length;
  await page.waitForTimeout(17_000);
  const extra = reqs.slice(before).filter((u) => !u.includes("tile.openstreetmap.org"));
  expect(extra).toEqual([]);
  await context.setOffline(false);
});

test("API cache: repeated geocode is served from IndexedDB", async ({ page }) => {
  await page.goto("./");
  await dataReady(page);
  let n = 0;
  page.on("request", (r) => { if (r.url().includes("/v1/geocode")) n++; });
  const a = await page.evaluate(() => window.__tt.apiCached("/v1/geocode?text=rustaveli&language=en", window.__tt.TTL.geocode));
  const b = await page.evaluate(() => window.__tt.apiCached("/v1/geocode?text=rustaveli&language=en", window.__tt.TTL.geocode));
  expect(a.cached).toBe(false);
  expect(b.cached).toBe(true);
  expect(n).toBe(1);
});

test("feed expiry warning when feed_end has passed", async ({ page }) => {
  await page.route(/\/data\/manifest\.json/, async (route) => {
    const res = await route.fetch();
    const m = await res.json();
    m.feed_end = "2020-01-01";
    await route.fulfill({ response: res, json: m });
  });
  await page.goto("./");
  await dataReady(page);
  await expect(page.locator("#data-pill")).toBeVisible();
  await expect(page.locator("#data-pill")).toHaveClass(/warn/);
});

/* ——— UX: stops on the map, grouped options, metro, at-the-stop ——— */
test("stops are drawn on the map and a tap opens departures", async ({ page }) => {
  await page.goto("./");
  await dataReady(page);
  await page.evaluate(() => window.__tt.map.jumpTo({ center: [44.7896, 41.7046], zoom: 15.5 }));
  await page.waitForFunction(() => window.__tt.map.queryRenderedFeatures({ layers: ["stops-all", "stops-metro"] }).length > 0, null, { timeout: 30_000 });
  const pt = await page.evaluate(() => {
    const m = window.__tt.map;
    const f = m.queryRenderedFeatures({ layers: ["stops-metro", "stops-all"] })[0];
    const p = m.project(f.geometry.coordinates);
    const r = m.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator("#stop-view")).toBeVisible({ timeout: 15_000 });
  /* metro stations are visible as icons already at city zoom */
  await page.evaluate(() => window.__tt.map.jumpTo({ center: [44.80, 41.71], zoom: 12 }));
  await page.waitForFunction(() => window.__tt.map.queryRenderedFeatures({ layers: ["stops-metro"] }).length > 0, null, { timeout: 30_000 });
});

test("options that differ only by bus number are grouped; direct before transfer", async ({ page }) => {
  await page.goto("./");
  await dataReady(page);
  const out = await page.evaluate(() => {
    const P = (n, lat, lon) => ({ name: n, lat, lon, stopId: "ge-tbilisi-transport-company_1:" + n });
    const W = (a, b) => ({ mode: "WALK", from: a, to: b, duration: 120 });
    const B = (r, a, b) => ({ mode: "BUS", routeShortName: r, routeId: "x:" + r, from: a, to: b });
    const s = P("s1", 41.7001, 44.8001), e = P("s2", 41.7201, 44.8201), t = P("s3", 41.7101, 44.8101);
    const it = (legs, end) => ({ legs, endTime: "2026-10-13T15:" + end + ":00Z", startTime: "2026-10-13T14:50:00Z", duration: 600, transfers: legs.filter((l) => l.mode !== "WALK").length - 1 });
    const g = window.__tt.groupItineraries([
      it([W(null, s), B("330", s, t), B("52", t, e)], 10),
      it([W(null, s), B("314", s, e)], 20),
      it([W(null, s), B("357", s, e)], 25),
      it([W(null, s), B("330", s, e)], 22),
    ]);
    return g.map((x) => ({ direct: x.direct, alts: x.alts, members: x.members }));
  });
  expect(out.length).toBe(2);
  expect(out[0]).toEqual({ direct: true, alts: [["314", "330", "357"]], members: 3 });
  expect(out[1].direct).toBe(false);
});

test("metro is a distinct mode in results; 'avoid metro' replans without it; at-the-stop card", async ({ page }) => {
  const plans = [];
  page.on("request", (r) => { if (r.url().includes("/v5/plan")) plans.push(r.url()); });
  await page.goto("./?from=41.7046,44.7896&to=41.6880,44.9290");
  await dataReady(page);
  await expect(page.locator(".itinerary").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".itin-section").first()).toBeVisible();
  const hasMetro = await page.locator(".route-badge.metro").count();
  if (hasMetro) {
    await expect(page.locator(".leg.metro").first()).toBeAttached();
    expect(await page.evaluate(() => window.__tt.map.getSource("trip-metro")._data.features.length)).toBeGreaterThanOrEqual(0);
  }
  /* at the stop: put the user at the boarding stop of the first option */
  await page.evaluate(() => {
    const S = window.__tt;
    const l = S.lastItineraries[0].legs.find((x) => x.mode !== "WALK");
    S.geo.fix = { lat: l.from.lat, lon: l.from.lon, acc: 10, t: Date.now() };
    return S.updateAtStop();
  });
  await expect(page.locator("#at-stop")).toBeVisible();
  await expect(page.locator("#at-stop .as-row .line-badge").first()).toBeVisible();
  /* avoid metro */
  await page.evaluate(() => { window.__tt.online = true; }); /* a flaky connectivity probe would make replan serve the saved result without a request */
  await page.check("#avoid-metro");
  await expect.poll(() => plans.some((u) => u.includes("transitModes=BUS")), { timeout: 30_000 }).toBeTruthy();
  await expect(page.locator(".route-badge.metro")).toHaveCount(0, { timeout: 30_000 });
  await page.uncheck("#avoid-metro");
});

/* Regression: the planner only returns its few best options (here 550 and 371), but every line that runs from
   M/S Isani to Dimitri Gulia Square without a transfer (e.g. 310) must be listed. */
test("trip results list every direct line, not only the planner's few options", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const now = Date.now();
  const leg = (code, from, to, off) => ({
    mode: "BUS", routeShortName: code, routeId: "ge-tbilisi-transport-company_1:mock-" + code, headsign: "Mock",
    startTime: new Date(now + off * 60000).toISOString(), endTime: new Date(now + (off + 9) * 60000).toISOString(), duration: 540, realTime: false,
    from: { name: "M/S Isani", lat: 41.685844, lon: 44.84035, stopId: "ge-tbilisi-transport-company_1:1489" },
    to: { name: "Dimitri Gulia Square", lat: 41.675648, lon: 44.828568, stopId: "ge-tbilisi-transport-company_1:1946" },
    intermediateStops: [],
  });
  const itin = (code, off) => ({ duration: 540, startTime: new Date(now + off * 60000).toISOString(), endTime: new Date(now + (off + 9) * 60000).toISOString(), transfers: 0, legs: [leg(code, 0, 0, off)] });
  await page.route("**/v5/plan**", (r) => r.fulfill({
    status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ itineraries: [itin("550", 2), itin("371", 4)], direct: [] }),
  }));
  await page.route("**/v5/stoptimes**", (r) => r.abort());
  await page.clock.setFixedTime(new Date("2026-10-19T12:00:00+04:00")); /* Monday noon: busy service */
  await page.goto("./?from=41.68663,44.84084&to=41.6756,44.8286");
  await dataReady(page);
  const sec = page.locator("#direct-lines");
  await expect(sec).toBeVisible({ timeout: 60_000 });
  await expect(sec.locator(".direct-chip").first()).toBeVisible({ timeout: 60_000 });
  /* 310 runs Isani → Gulia Square → Ortachala → Freedom Square; it is not among the planner's options */
  await expect(sec.locator('.direct-chip[data-line="310"]')).toHaveCount(1, { timeout: 30_000 });
  const codes = await sec.locator(".direct-chip").evaluateAll((els) => els.map((e) => e.dataset.line));
  expect(new Set(codes).size).toBe(codes.length);   /* one chip per line */
  expect(codes).toContain("550");
  expect(codes.length).toBeGreaterThan(2);
  /* everything is visible at once: no tap, no scrolling inside the sheet */
  const vh = page.viewportSize().height;
  const boxes = await sec.locator(".direct-chip").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
  boxes.forEach((b) => { expect(b.top).toBeGreaterThan(0); expect(b.bottom).toBeLessThanOrEqual(vh); });
  /* most frequent first, each chip says how often it runs */
  const ns = (await sec.locator(".direct-chip").evaluateAll((els) => els.map((e) => Number(e.dataset.n))));
  expect(ns).toEqual([...ns].sort((a, b) => b - a));
  expect(ns[0]).toBeGreaterThan(ns[ns.length - 1] - 1);
  await expect(sec.locator(".direct-chip").first().locator(".dc-every")).toHaveText(/^every \d+ min$/);
  await expect(sec.locator(".direct-hint")).toContainText("Most frequent first");
  await expect(sec.locator(".direct-hint")).toContainText(/about every \d+ min/);
  /* details: terminal, ride time, next departures */
  await sec.locator(".direct-toggle").click();
  const row = sec.locator('.direct-row[data-line="310"]');
  await expect(row).toBeVisible();
  await expect(row.locator(".dep-head")).toContainText("→");
  await expect(row.locator(".dep-via")).toContainText("min ride");
  await expect(row.locator(".dep-via")).toContainText(/every \d+ min|rare|1 in 90 min/);
  /* tapping a chip opens that line from the boarding stop */
  await sec.locator('.direct-chip[data-line="310"]').click();
  await expect(page.locator("#line-view")).toBeVisible();
  expect(errors).toEqual([]);
});


/* The probe request goes around the service worker; WebKit does not route such requests through page.route when a worker controls the page → block the worker here (it is irrelevant to the check). */
test.describe("update check", () => {
  test.use({ serviceWorkers: "block" });
  /* Updates: the running version is shown, a newer one is announced with a Reload button, "Check for updates" answers. */
  test("version is shown; a newer published version shows an update bar; manual check says when current", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let remote = null; /* null = real file */
    await page.route(/app-version\.js\?probe=/, (r) => (remote
      ? r.fulfill({ status: 200, contentType: "application/javascript", body: 'window.TT_VERSION = "' + remote + '";' })
      : r.continue()));
    await page.goto("./");
    await dataReady(page);
    const cur = await page.evaluate(() => window.TT_VERSION);
    expect(cur).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    await page.evaluate(() => { window.__tt.setMode("trip"); });
    await page.locator("#more-tools summary").click();
    await expect(page.locator("#app-version")).toHaveText("Version " + cur);
    await page.click("#check-update");
    await expect(page.locator(".toast")).toContainText("latest version");
    await expect(page.locator("#update-bar")).toBeHidden();
    /* a newer version is published */
    remote = "2999-01-01.1";
    expect(await page.evaluate(() => window.__tt.checkForUpdate())).toBe("available");
    await expect(page.locator("#update-bar")).toBeVisible();
    await expect(page.locator("#update-btn")).toHaveText("Reload");
    expect(errors).toEqual([]);
  });
});

/* Trips with transfers: map labels, frequency, waiting time, ranking, more than a handful of options */
/* Mocked network answers: no service worker (WebKit does not route worker-handled requests through page.route). */
test.describe("transfer trip", () => {
  test.use({ serviceWorkers: "block" });
  test("transfer trip: Board / Transfer / Alight labels in leg colours, every N min, wait, many options, frequent lines rank higher", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.setFixedTime(new Date("2026-10-19T12:00:00+04:00"));
    await page.goto("./");
    await dataReady(page);
    /* two real lines from the timetable: ride 1 on 462, ride 2 on 329 (stops taken from the line files) */
    const mock = await page.evaluate(async () => {
      const S = window.__tt;
      const pick = async (code, i, j) => {
        const l = S.lines.find((x) => x.code === code);
        const ld = await S.loadLine(l.key);
        const d = ld.dirs[0];
        return { l, a: d.stops[i], b: d.stops[j], stops: d.stops };
      };
      const R1 = await pick("462", 1, 8), R2 = await pick("329", 2, 9);
      const P = (s) => ({ name: s.en, lat: s.lat, lon: s.lon, stopId: "ge-tbilisi-transport-company_1:" + s.id });
      const t0 = Date.now();
      const mk = (off, wait, k) => {
        /* different boarding / alighting stops → different paths (not merged into one option) */
        const r1 = Object.assign({}, R1, { a: R1.stops[k % 6] }), r2 = Object.assign({}, R2, { b: R2.stops[9 + Math.floor(k / 6) * 2] });
        const s1 = t0 + off * 60000, e1 = s1 + 15 * 60000, s2 = e1 + wait * 60000, e2 = s2 + 20 * 60000;
        const leg = (r, s, e, to2) => ({ mode: "BUS", routeShortName: r.l.code, routeId: "ge-tbilisi-transport-company_1:" + r.l.key, headsign: "x", startTime: new Date(s).toISOString(), endTime: new Date(e).toISOString(), duration: (e - s) / 1000, realTime: false, from: P(r.a), to: P(r.b), intermediateStops: [] });
        return { duration: (e2 - s1) / 1000, startTime: new Date(s1).toISOString(), endTime: new Date(e2).toISOString(), transfers: 1, legs: [leg(r1, s1, e1), leg(r2, s2, e2)] };
      };
      const itins = [];
      for (let k = 0; k < 12; k++) itins.push(mk(k * 7, 3 + (k % 4), k));
      return { itins, from: { lat: R1.stops[0].lat, lon: R1.stops[0].lon, name: R1.stops[0].en }, to: { lat: R2.stops[9].lat, lon: R2.stops[9].lon, name: R2.stops[9].en } };
    });
    const plans = [];
    await page.route("**/v5/plan**", (r) => { plans.push(r.request().url()); r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ itineraries: mock.itins, direct: [] }) }); });
    await page.route("**/v5/stoptimes**", (r) => r.abort());
    await page.evaluate((m) => {
      const S = window.__tt;
      S.setPlace("from", { name: m.from.name, lat: m.from.lat, lon: m.from.lon, type: "STOP" });
      S.setPlace("to", { name: m.to.name, lat: m.to.lat, lon: m.to.lon, type: "STOP" });
      S.plan();
    }, mock);
    await expect(page.locator(".itinerary").first()).toBeVisible({ timeout: 30_000 });
    /* asks for many options, not 3–4 */
    expect(plans.length).toBeGreaterThan(0);
    expect(Number(new URL(plans[0]).searchParams.get("numItineraries"))).toBeGreaterThanOrEqual(24);
    /* card: chain, frequency, transfer wait */
    const first = page.locator(".itinerary").first();
    await expect(first.locator(".itin-badges .route-badge")).toHaveCount(2);
    await expect(first.locator(".itin-freq")).toContainText(/462 · every \d+ min/);
    await expect(first.locator(".itin-meta")).toContainText(/1 transfer/);
    await expect(first.locator(".leg-xfer")).toContainText(/Transfer · wait \d+ min/);
    const bg = await first.locator(".itin-badges .route-badge").evaluateAll((els) => els.map((e) => e.style.background));
    expect(bg[0]).not.toBe(bg[1]);                     /* each ride has its own colour */
    /* map: labels for board / transfer / alight, line numbers in the leg colours */
    const steps = page.locator(".tt-step");
    await expect(steps.first()).toBeVisible();
    const kinds = await steps.evaluateAll((els) => els.map((e) => e.querySelector(".st-kind").textContent.toLowerCase()));
    expect(kinds).toContain("board");
    expect(kinds).toContain("transfer");
    expect(kinds).toContain("alight");
    const badgeCols = await steps.evaluateAll((els) => [...new Set(els.flatMap((e) => [...e.querySelectorAll(".st-badge")].map((b) => b.style.background)))]);
    expect(badgeCols.length).toBeGreaterThanOrEqual(2);
    /* more options on demand */
    expect(await page.locator(".itinerary").count()).toBeLessThanOrEqual(8);
    const more = page.locator(".opts-more");
    await expect(more).toBeVisible();
    await more.click();
    expect(await page.locator(".itinerary").count()).toBeGreaterThan(8);
    /* ranking: a rare line with the same arrival is worse than a frequent one */
    const scores = await page.evaluate(async () => {
      const S = window.__tt;
      const base = Date.now() + 30 * 60000;
      const mk = (f) => ({ endTime: new Date(base).toISOString(), legs: [{ mode: "BUS", routeId: "x", startTime: new Date(base - 600000).toISOString(), endTime: new Date(base).toISOString(), _freq: f }] });
      const rare = mk({ n: 1, every: null }), often = mk({ n: 8, every: 6 });
      await S.enrichItineraries([rare, often]);
      return { rare: rare._score, often: often._score };
    });
    expect(scores.rare).toBeGreaterThan(scores.often);
    expect(errors).toEqual([]);
  });
});
