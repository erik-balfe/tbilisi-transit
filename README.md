# Tbilisi Transit

Trip planner for Tbilisi: **full-bleed MapLibre + OSM map**, pin drop, [Transitous](https://transitous.org/) routes drawn on the map.

**Live:** https://erik-balfe.github.io/tbilisi-transit/

## Features

- **Center-pin picker** (Yandex.Taxi style): move the map under a fixed pin, address bubble, **From here → To here → routes** with no extra taps
- **Search mode** for typing: full-screen fields + suggestions above the keyboard (`visualViewport`, `interactive-widget=resizes-content`); recents, *My location*, *Choose on map*
- **Offline stop search** from bundled TTC GTFS stops (`data/stops.json`, built by `tools/build_stops.py`), plus Transitous geocode + Nominatim online, bounded to Tbilisi
- All route options drawn at once in distinct colours (red / green / blue / amber / purple…), walk legs dashed gray
- **Live vehicles** on the selected option: Transitous `/api/v1/map/trips` segments (realtime-adjusted from TTC vehicle GPS where available, else scheduled), interpolated every second, refreshed every 15 s
- Live **show-me** button (`watchPosition`, accuracy circle, heading), follow / recenter / off
- **Stops & lines** ([design](docs/stops-lines-ux.md)): one search box understands line numbers (`314`, `M1`, `G2`) — lines first, then stops, then places. Line view: shape in line colour, direction switch by terminal, ordered stops with next times, live vehicles of that line. Stop view (tap a stop dot at z ≥ 15, the clock button in search, or the **Nearby** row when location is known): departures grouped by line + direction, live vs scheduled, auto-refresh 30 s. Departure → line from *this* stop with the remaining part highlighted and that bus's times; **Go here** plans a trip. Back / Android back unwinds stop ↔ line and returns to the planned trip. Offline: shapes, stops and timetable from bundled GTFS (`data/lines.json` + lazy `data/lines/<id>.json`, built by `tools/build_lines.py`, warmed into the SW cache in the background)
- Light + dark theme follow the system; accent from CSS `AccentColor` when the browser exposes it
- MapLibre GL JS (self-hosted in `vendor/`) + OpenStreetMap raster tiles; one-finger double-tap-drag zoom, pinch, pan
- **Offline-first PWA**: precached shell + MapLibre + stops, capped cache of tiles you viewed (no bulk prefetch), saved recent trips viewable offline, offline indicator; Web Share Target for Maps / `geo:` links

## Local

```bash
python3 server.py   # http://127.0.0.1:8765/  (proxies Transitous)
```

## Attribution

- Transit data: [Transitous](https://transitous.org/) / [sources](https://transitous.org/sources/)
- Map: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors · rendered with [MapLibre GL JS](https://maplibre.org/) (BSD-3, `vendor/maplibre/LICENSE.txt`)
- Stops: TTC GTFS ([tbilisi-gtfs](https://gitlab.spline.de/spline/transitous/tbilisi-gtfs)) as used by Transitous

## Query / share examples

```
https://erik-balfe.github.io/tbilisi-transit/?from=41.69274,44.80206&to=41.7221,44.79774
https://erik-balfe.github.io/tbilisi-transit/?dest=41.7151,44.8271
https://erik-balfe.github.io/tbilisi-transit/?geo=41.70,44.80
https://erik-balfe.github.io/tbilisi-transit/?line=314
https://erik-balfe.github.io/tbilisi-transit/?stop=1241
```

Rebuild data after a GTFS update: `python3 tools/build_lines.py ge_tbilisi-transport-company.gtfs.zip` (also rewrites `data/stops.json`; shapes are fetched once from Transitous and cached in `tools/.shape-cache/`).

Share Target (installed PWA): system Share → Tbilisi Transit with a Maps URL / `geo:` / lat,lon text.

## Data architecture (no data in the code)

- Timetable data is **not** in this branch. The `data` workflow (daily 02:17 UTC + manual) downloads the TTC GTFS from
  Transitous, runs `tools/build_stops.py` + `tools/build_lines.py`, validates it (`tools/publish_data.py`, fails on an
  expired/broken feed) and commits content-hashed files + `manifest.json` to the `data` branch — only when something changed.
- The `pages` workflow deploys `main` + the `data` branch (under `/data/`) to GitHub Pages (same origin → no CORS).
- The app (`app-store.js`) keeps the data in IndexedDB, renders from it instantly, checks the manifest in the background
  (start, ≤ daily, on reconnect) and downloads only files whose hash changed. Per-line files are lazy; "Keep all lines
  offline" downloads all of them. API responses are cached per endpoint (TTL + stale fallback).
- Tests: `npm ci && tools/assemble_site.sh <data-checkout> _site && npx playwright test` (CI: `ci` workflow).
