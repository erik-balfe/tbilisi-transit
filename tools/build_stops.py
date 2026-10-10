#!/usr/bin/env python3
"""Build data/stops.json (offline stop search) from the TTC GTFS zip.

Usage: python3 tools/build_stops.py path/to/ge_tbilisi-transport-company.gtfs.zip
Output rows: [name_en, name_ka, lat, lon, "code1 code2", kind]  kind: 0 bus stop, 1 metro, 2 gondola
Same-name stops within ~250 m (opposite sides of a road) are merged.
"""
import csv, io, json, math, sys, zipfile, collections
from pathlib import Path

zpath = sys.argv[1]
z = zipfile.ZipFile(zpath)
def rows(name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"))

tr = collections.defaultdict(dict)
for r in rows("translations.txt"):
    if r["table_name"] == "stops" and r["field_name"] == "stop_name":
        tr[r["record_id"]][r["language"]] = r["translation"]

def dist(a, b):
    dy = (a[0] - b[0]) * 111320
    dx = (a[1] - b[1]) * 111320 * math.cos(math.radians(41.7))
    return math.hypot(dx, dy)

groups = []
for s in rows("stops.txt"):
    sid = s["stop_id"]
    ka = s["stop_name"].strip()
    en = (tr.get(sid, {}).get("en") or ka).strip()
    lat, lon = float(s["stop_lat"]), float(s["stop_lon"])
    kind = 1 if "metro" in sid.lower() else (2 if "gondola" in sid.lower() else 0)
    code = s.get("stop_code", "").strip()
    for g in groups:
        if g["en"] == en and g["kind"] == kind and dist((g["lat"], g["lon"]), (lat, lon)) < 250:
            g["pts"].append((lat, lon))
            if code:
                g["codes"].append(code)
            break
    else:
        groups.append({"en": en, "ka": ka, "lat": lat, "lon": lon, "kind": kind,
                       "pts": [(lat, lon)], "codes": [code] if code else []})

out = []
for g in groups:
    lat = sum(p[0] for p in g["pts"]) / len(g["pts"])
    lon = sum(p[1] for p in g["pts"]) / len(g["pts"])
    out.append([g["en"], g["ka"], round(lat, 5), round(lon, 5), " ".join(g["codes"]), g["kind"]])
out.sort(key=lambda r: (-r[5], r[0]))
dest = Path(__file__).resolve().parent.parent / "data" / "stops.json"
dest.write_text(json.dumps({"v": 1, "source": "TTC GTFS via Transitous (tbilisi-gtfs)", "stops": out},
                           ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(len(out), "stops ->", dest, dest.stat().st_size, "bytes")
