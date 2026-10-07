# Tbilisi Transit

Trip planner for Tbilisi: **full-bleed MapLibre + OSM map**, pin drop, [Transitous](https://transitous.org/) routes drawn on the map.

**Live:** https://erik-balfe.github.io/tbilisi-transit/

## Features

- From / To autocomplete (Transitous geocode + Nominatim), **bounded to Tbilisi** (≈ 41.60–41.85 N, 44.65–45.05 E)
- **MapLibre GL JS** + OpenStreetMap raster tiles — tap to drop **From (A)** / **To (B)** pins, drag to move (no Leaflet / no third-party map banners)
- Planned itinerary **polylines** on the map (`legGeometry.points` from Transitous), walk vs transit styling; tap an itinerary card to highlight it
- Full-viewport map; controls in a collapsible overlay (bottom sheet on mobile, floating card on desktop)
- Paste or open `geo:`, Google Maps, OSM URLs; query params `?from=lat,lon&to=lat,lon`, `?dest=…`
- Installable **PWA** with **Web Share Target**

## Local

```bash
python3 server.py   # http://127.0.0.1:8765/  (proxies Transitous)
```

## Attribution

- Transit data: [Transitous](https://transitous.org/) / [sources](https://transitous.org/sources/)
- Map: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors · rendered with [MapLibre GL JS](https://maplibre.org/)

## Query / share examples

```
https://erik-balfe.github.io/tbilisi-transit/?from=41.69274,44.80206&to=41.7221,44.79774
https://erik-balfe.github.io/tbilisi-transit/?dest=41.7151,44.8271
https://erik-balfe.github.io/tbilisi-transit/?geo=41.70,44.80
```

Share Target (installed PWA): system Share → Tbilisi Transit with a Maps URL / `geo:` / lat,lon text.
