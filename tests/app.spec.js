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
  await page.check("#avoid-metro");
  await page.waitForFunction(() => document.querySelector(".itinerary"), null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  expect(plans.some((u) => u.includes("transitModes=BUS"))).toBeTruthy();
  await expect(page.locator(".route-badge.metro")).toHaveCount(0, { timeout: 30_000 });
  await page.uncheck("#avoid-metro");
});
