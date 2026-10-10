/* Tbilisi Transit service worker — offline-first shell, capped tile cache, network-only APIs */
const VERSION = "tt-shell-v7";
const SHELL_CACHE = VERSION;
const TILE_CACHE = "tt-tiles-v1";      /* only tiles the user actually viewed */
const TILE_MAX = 1500;                  /* ~25–40 MB worst case */
const TILE_FRESH_MS = 7 * 24 * 3600e3;  /* revalidate tiles older than a week */
const SHELL = [
  "./",
  "./index.html",
  "./app.css",
  "./app-data.js",
  "./app-ui.js",
  "./app-map.js",
  "./app-live.js",
  "./app-share.js",
  "./app-plan.js",
  "./manifest.webmanifest",
  "./data/stops.json",
  "./vendor/maplibre/maplibre-gl.js",
  "./vendor/maplibre/maplibre-gl.css",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimTiles() {
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  if (keys.length <= TILE_MAX) return;
  /* Cache keys keep insertion order → drop the oldest */
  await Promise.all(keys.slice(0, keys.length - TILE_MAX).map((k) => c.delete(k)));
}

async function tileFetch(event) {
  const req = event.request;
  const c = await caches.open(TILE_CACHE);
  const hit = await c.match(req);
  const stamp = hit ? Number(hit.headers.get("x-tt-cached") || 0) : 0;
  const refresh = async () => {
    const res = await fetch(req, { mode: "cors", credentials: "omit" });
    if (res.ok) {
      const body = await res.clone().blob();
      const headers = new Headers(res.headers);
      headers.set("x-tt-cached", String(Date.now()));
      await c.delete(req);
      await c.put(req, new Response(body, { status: 200, headers }));
      trimTiles();
    }
    return res;
  };
  if (hit) {
    if (Date.now() - stamp > TILE_FRESH_MS) event.waitUntil(refresh().catch(() => {}));
    return hit;
  }
  try { return await refresh(); } catch (e) { return hit || Response.error(); }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  /* APIs: network only (the app keeps its own offline copies of recent trips) */
  if (url.hostname.endsWith("transitous.org") || url.hostname.endsWith("nominatim.openstreetmap.org") || url.pathname.startsWith("/api/")) {
    return;
  }

  /* OSM raster tiles: cache tiles the user viewed (no bulk prefetch), stale-while-revalidate after 7 d */
  if (url.hostname.endsWith("tile.openstreetmap.org")) {
    event.respondWith(tileFetch(event));
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has("probe")) return; /* connectivity probe: always network */

  /* Navigations: cache-first shell (instant open), update in background */
  if (req.mode === "navigate") {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (c) => {
        const hit = (await c.match("./index.html")) || (await c.match("./"));
        const net = fetch(req).then((res) => { if (res.ok) c.put("./index.html", res.clone()); return res; });
        if (hit) { event.waitUntil(net.catch(() => {})); return hit; }
        return net;
      })
    );
    return;
  }

  /* Same-origin assets: cache-first, then stale-while-revalidate */
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; });
      if (hit) { event.waitUntil(net.catch(() => {})); return hit; }
      return net;
    })
  );
});
