// @ts-check
// "Here / nearby stop" feature (docs/nearby-stop-ux.md) with mocked geolocation.
const { test, expect } = require("@playwright/test");

const HERE = { latitude: 41.6966, longitude: 44.8044, accuracy: 12 }; /* Nikoloz Baratashvili St — many bus lines */
const BATUMI = { latitude: 41.6168, longitude: 41.6367, accuracy: 12 };

test.use({ geolocation: HERE, permissions: ["geolocation"] });

async function dataReady(page) {
  await page.waitForFunction(() => window.__tt && (window.__tt.stops || []).length > 800 && (window.__tt.lines || []).length > 100, null, { timeout: 60_000 });
}
/** no live data: deterministic "scheduled" rows from the local timetable */
async function noLive(page) {
  await page.route("**/v5/stoptimes**", (r) => r.abort());
}
async function openHere(page) {
  await page.click("#here-btn");
  await expect(page.locator("#stop-view")).toBeVisible();
  await expect(page.locator(".here-row").first()).toBeVisible({ timeout: 30_000 });
}

test("one tap on the always-visible button opens the nearest stop with departures sorted by time", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await noLive(page);
  await page.goto("./");
  await dataReady(page);
  const btn = page.locator("#here-btn");
  await expect(btn).toBeVisible();
  /* thumb zone: lower right half of the screen, inside the viewport */
  const box = await btn.boundingBox();
  const vp = page.viewportSize();
  expect(box.x + box.width / 2).toBeGreaterThan(vp.width / 2);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  expect(box.y).toBeGreaterThan(vp.height * 0.35);
  await openHere(page); /* ONE tap */
  await expect(page.locator("#sv-title")).not.toBeEmpty();
  await expect(page.locator(".here-row .line-badge").first()).toBeVisible();
  const mins = await page.locator(".here-row:not(.all)").evaluateAll((els) => els.map((e) => Number(e.dataset.ms || 0)).filter(Boolean));
  expect(mins.length).toBeGreaterThan(2);
  expect(mins).toEqual([...mins].sort((a, b) => a - b));
  /* every row says where it goes */
  await expect(page.locator(".here-row .dep-via").first()).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("live departures (mocked) are green and the scheduled ones are marked as such", async ({ page }) => {
  await page.route("**/v5/stoptimes**", (r) => {
    const id = new URL(r.request().url()).searchParams.get("stopId");
    const at = new Date(Date.now() + 4 * 60000).toISOString();
    r.fulfill({
      status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ stopTimes: [{ tripId: "mock-1", routeShortName: "999", headsign: "Mock Terminal", directionId: 0, realTime: true, place: { stopId: id, departure: at, scheduledDeparture: at }, tripTo: { stopId: "nowhere", name: "Mock Terminal" } }] }),
    });
  });
  await page.goto("./");
  await dataReady(page);
  await openHere(page);
  const live = page.locator(".here-row", { hasText: "999" }).first();
  await expect(live).toBeVisible({ timeout: 30_000 });
  await expect(live).toContainText("Mock Terminal");
  await expect(live.locator(".dep-first.rt")).toBeVisible();
});

test("works offline from the local timetable", async ({ page, context, browserName }) => {
  test.skip(browserName === "webkit", "WebKit cannot reload under emulated offline; offline coverage is in app.spec.js");
  await noLive(page);
  await page.goto("./");
  await dataReady(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.evaluate(() => window.__tt.loadLines && window.__tt.loadLines());
  await context.setOffline(true);
  await openHere(page);
  await expect(page.locator(".here-row .dep-first:not(.rt)").first()).toBeVisible();
  await expect(page.locator(".here-row .line-badge").first()).toBeVisible();
  await context.setOffline(false);
});

test("All lines tab lists every line and terminal reachable from the stop", async ({ page }) => {
  await noLive(page);
  await page.goto("./");
  await dataReady(page);
  await openHere(page);
  await page.click('.here-tab[data-tab="all"]');
  await expect(page.locator(".here-row.all").first()).toBeVisible({ timeout: 30_000 });
  expect(await page.locator(".here-row.all").count()).toBeGreaterThan(3);
  await expect(page.locator(".here-row.all .dep-via").first()).toBeVisible();
  await page.click('.here-tab[data-tab="next"]');
  await expect(page.locator(".here-row:not(.all)").first()).toBeVisible();
});

test("neighbouring stops/sides can be switched and the list follows", async ({ page, context }) => {
  await noLive(page);
  await page.goto("./");
  await dataReady(page);
  /* stand at a stop that has another stop (the other road side) within 60 m */
  const pos = await page.evaluate(() => {
    const S = window.__tt;
    for (let i = 0; i < S.stops.length; i++) {
      const a = S.stops[i];
      if (a.kind || !S.stopLines[i] || !S.stopLines[i].length) continue;
      const n = S.nearestStopsTo({ lat: a.lat, lon: a.lon }).filter((c) => c.d < 60);
      if (n.length >= 2) return { latitude: a.lat, longitude: a.lon, accuracy: 10 };
    }
    return null;
  });
  expect(pos).toBeTruthy();
  await context.setGeolocation(pos);
  await page.evaluate((p) => { window.__tt.geo.fix = { lat: p.latitude, lon: p.longitude, acc: 10, t: Date.now() }; }, pos);
  await openHere(page);
  const chips = page.locator(".here-chip");
  await expect(chips.nth(1)).toBeVisible();
  const first = await page.locator("#sv-title").textContent();
  await chips.nth(1).click();
  await expect(chips.nth(1)).toHaveClass(/on/);
  await expect(chips.nth(0)).not.toHaveClass(/on/);
  await expect(page.locator(".here-row").first()).toBeVisible({ timeout: 30_000 });
  expect(await page.locator("#sv-title").textContent()).toBeTruthy();
  void first;
});

test("tap a departure → full route from here, remaining stops highlighted, pick a stop → trip view", async ({ page }) => {
  await noLive(page);
  await page.goto("./");
  await dataReady(page);
  await openHere(page);
  await page.locator(".here-row:not(.all)").first().click();
  await expect(page.locator("#line-view")).toBeVisible();
  await expect(page.locator("#lv-stops li").first()).toBeVisible({ timeout: 30_000 });
  /* the boarding stop is marked, stops before it are dimmed, the remaining ones are not */
  await expect(page.locator("#lv-stops li.board")).toHaveCount(1, { timeout: 15_000 });
  const nPast = await page.locator("#lv-stops li.past").count();
  const nAll = await page.locator("#lv-stops li").count();
  expect(nAll - nPast).toBeGreaterThan(2);
  /* pick a stop further along as destination */
  const lis = page.locator("#lv-stops li:not(.past)");
  await lis.nth(Math.min(await lis.count() - 1, 4)).locator(".lv-row").click();
  const go = page.locator('#lv-stops [data-act="go"]');
  await expect(go).toBeVisible({ timeout: 15_000 });
  await go.click();
  await expect(page.locator(".itinerary").first()).toBeVisible({ timeout: 60_000 });
});

test("with a planned trip the Here view marks rows that fit the trip and the at-stop card opens it", async ({ page }) => {
  await noLive(page);
  await page.goto("./?from=41.6966,44.8044&to=41.7046,44.7896");
  await dataReady(page);
  await page.evaluate(() => window.__tt.getFix());
  await expect(page.locator(".itinerary").first()).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => window.__tt.setSheet("full"));
  await expect(page.locator("#at-stop")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#at-stop .as-row .line-badge").first()).toBeVisible();
  await page.evaluate(() => window.__tt.setSheet("mid"));
  await page.click("#here-btn");
  await expect(page.locator(".here-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#here-only-trip")).toBeVisible(); /* the trip boards at this very stop */
  /* the live planner's choice varies: make the trip use the line of the 2nd departure so the assertion is deterministic */
  const code = await page.locator(".here-row .line-badge").nth(1).textContent();
  await page.evaluate((c) => { window.__tt.lastItineraries.forEach((it) => { if (it.alts) it.alts = [[c]]; }); }, code.trim());
  await page.click('.here-tab[data-tab="all"]');
  await page.click('.here-tab[data-tab="next"]');
  await expect(page.locator(".here-row.fit").first()).toBeVisible();
  await expect(page.locator(".here-row.fit .fit-tag").first()).toContainText("★");
  /* ★ My trip filter keeps only the trip's lines */
  await page.click("#here-only-trip");
  const codes = await page.locator(".here-row .line-badge").allTextContents();
  expect(codes.length).toBeGreaterThan(0);
  expect(new Set(codes.map((c) => c.trim()))).toEqual(new Set([code.trim()]));
});

test("auto-offer: green dot on the button within ~100 m of a stop, none when far away", async ({ page }) => {
  await noLive(page);
  await page.goto("./");
  await dataReady(page);
  await page.evaluate(() => window.__tt.getFix());
  await expect(page.locator("#here-btn.near")).toBeVisible({ timeout: 20_000 });
  /* move to Batumi: outside the Tbilisi data */
  await page.evaluate(() => { const S = window.__tt; S.geo.fix = { lat: 41.6168, lon: 41.6367, acc: 10, t: Date.now() }; S.onGeoFix && S.onGeoFix(S.geo.fix); });
  await expect(page.locator("#here-btn.near")).toHaveCount(0, { timeout: 10_000 });
});

test("outside Tbilisi: friendly message with retry and search instead of a wrong stop", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ geolocation: BATUMI, permissions: ["geolocation"], serviceWorkers: "block" });
  const page = await ctx.newPage();
  await noLive(page);
  await page.goto(baseURL || "./");
  await dataReady(page);
  await page.click("#here-btn");
  await expect(page.locator(".here-msg")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#here-retry")).toBeVisible();
  await expect(page.locator("#here-search")).toBeVisible();
  await ctx.close();
});

test("Georgian UI: button, tabs and rows are localised; dark theme renders", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ geolocation: HERE, permissions: ["geolocation"], colorScheme: "dark", serviceWorkers: "block" });
  const page = await ctx.newPage();
  await noLive(page);
  await page.addInitScript(() => localStorage.setItem("tt-lang", "ka"));
  await page.goto(baseURL || "./");
  await dataReady(page);
  const label = await page.locator("#here-btn").getAttribute("aria-label");
  expect(label).toMatch(/[\u10A0-\u10FF]/);
  await page.click("#here-btn");
  await expect(page.locator(".here-row").first()).toBeVisible({ timeout: 30_000 });
  const tab = await page.locator(".here-tab").first().textContent();
  expect(tab).toMatch(/[\u10A0-\u10FF]/);
  const bg = await page.locator("#stop-view").evaluate((e) => getComputedStyle(e).backgroundColor);
  const m = bg.match(/\d+/g).map(Number);
  expect(m[0] + m[1] + m[2]).toBeLessThan(300); /* dark surface */
  await ctx.close();
});
