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
```

Share Target (installed PWA): system Share → Tbilisi Transit with a Maps URL / `geo:` / lat,lon text.
