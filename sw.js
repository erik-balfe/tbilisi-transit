/* Tbilisi Transit — cache shell; network for API */
const CACHE = "tt-shell-v2";
const SHELL = [
  "./",
  "./index.html",
  "./app.css",
  "./app-data.js",
  "./app-ui.js",
  "./app-map.js",
  "./app-share.js",
  "./app-plan.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Always network for Transitous / Nominatim
  if (
    url.hostname.includes("transitous.org") ||
    url.hostname.includes("nominatim.openstreetmap.org") ||
    url.pathname.includes("/api/")
  ) {
    event.respondWith(fetch(req));
    return;
  }

  // OSM tiles: network-first, fall back to cache
  if (url.hostname.includes("tile.openstreetmap.org")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // App shell: cache-first
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && (url.origin === self.location.origin || url.hostname === "unpkg.com")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
