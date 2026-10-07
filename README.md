# Tbilisi Transit

Simple trip planner for Tbilisi: **OSM map pins**, Tbilisi-only search, [Transitous](https://transitous.org/) routes.

**Live:** https://erik-balfe.github.io/tbilisi-transit/

## Features

- From / To autocomplete (Transitous geocode + Nominatim), **bounded to Tbilisi** (≈ 41.60–41.85 N, 44.65–45.05 E)
- Leaflet + OpenStreetMap map — tap to drop **From (A)** / **To (B)** pins, drag to move
- Paste or open `geo:`, Google Maps, OSM URLs; query params `?from=lat,lon&to=lat,lon`, `?dest=…`
- Installable **PWA** with **Web Share Target** (share a Maps link into the app when installed)

## Local

```bash
python3 server.py   # http://127.0.0.1:8765/  (proxies Transitous)
```

## Attribution

- Transit data: [Transitous](https://transitous.org/) / [sources](https://transitous.org/sources/)
- Map: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors

## Query / share examples

```
https://erik-balfe.github.io/tbilisi-transit/?from=41.69274,44.80206&to=41.7221,44.79774
https://erik-balfe.github.io/tbilisi-transit/?dest=41.7151,44.8271
https://erik-balfe.github.io/tbilisi-transit/?geo=41.70,44.80
```

Share Target (installed PWA): system Share → Tbilisi Transit with a Maps URL / `geo:` / lat,lon text.
