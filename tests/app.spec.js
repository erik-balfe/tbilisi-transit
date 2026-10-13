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
  const stored = await page.evaluate(() => window.TTStore.linesStored());
  expect(stored.done).toBeGreaterThanOrEqual(1);
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

test("offline: reload works from cache, stops + line view from IndexedDB, no polling", async ({ page, context }) => {
  await page.goto("./");
  await dataReady(page);
  await swReady(page);
  await dataReady(page);
  await openLine(page, "314");                   /* caches the line file */
  await page.waitForTimeout(500);
  await context.setOffline(true);
  const reqs = [];
  page.on("request", (r) => reqs.push(r.url()));
  await page.reload();
  await dataReady(page);
  await expect(page.locator("#offline-pill")).toBeVisible();
  await openLine(page, "314");
  /* scheduled departures from the local timetable at a stop */
  await page.locator("#lv-stops li").nth(1).click().catch(() => {});
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
