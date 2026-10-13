#!/usr/bin/env python3
"""Build offline line data for stop/line lookup from the TTC GTFS zip.

Usage: python3 tools/build_lines.py path/to/ge_tbilisi-transport-company.gtfs.zip [--no-fetch]

Outputs (all small, gzip-friendly, lazy-loaded per line by the app):
  data/lines.json          index: lines (code, type, colour, terminals EN/KA), weekday masks per service,
                           and per merged stop (same order as data/stops.json) the line indices serving it
  data/lines/<key>.json    one file per line: per direction ordered stops (id, names, lat/lon), offsets in
                           minutes from the first stop, scheduled start times per service, and an encoded
                           polyline shape with the shape vertex index of every stop
  data/stops.json          rebuilt with an extra column: GTFS stop ids of every merged stop

The GTFS feed has no shapes.txt, so shapes come from Transitous (/api/v5/trip, OSM-matched geometry),
fetched once per direction at build time and cached in tools/.shape-cache/. If a fetch fails the
shape falls back to straight lines between stops.
"""
import hashlib, csv, io, json, math, os, sys, zipfile, collections, datetime, time, urllib.request, urllib.parse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(os.environ.get("TT_SHAPE_CACHE") or Path(__file__).resolve().parent / ".shape-cache")
OUT = Path(os.environ.get("TT_OUT") or ROOT / "data")
THROTTLE = float(os.environ.get("TT_THROTTLE", "0.4"))  # seconds between MOTIS requests per worker (be polite)
FEED = "ge-tbilisi-transport-company_"
UA = "TbilisiTransitBuild/1.0 (+https://github.com/erik-balfe/tbilisi-transit)"

zpath = sys.argv[1]
FETCH = "--no-fetch" not in sys.argv
z = zipfile.ZipFile(zpath)
def rows(name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"))

def dist(a, b):
    dy = (a[0] - b[0]) * 111320
    dx = (a[1] - b[1]) * 111320 * math.cos(math.radians(41.7))
    return math.hypot(dx, dy)

# —— polyline (precision 5 out, any in) ——
def decode(enc, prec):
    f = 10 ** prec; i = lat = lng = 0; out = []
    while i < len(enc):
        for k in (0, 1):
            sh = res = 0
            while True:
                b = ord(enc[i]) - 63; i += 1; res |= (b & 0x1f) << sh; sh += 5
                if b < 0x20: break
            d = ~(res >> 1) if res & 1 else res >> 1
            if k == 0: lat += d
            else: lng += d
        out.append((lat / f, lng / f))
    return out
def encode(pts):
    out = []; plat = plng = 0
    for lat, lng in pts:
        ilat, ilng = round(lat * 1e5), round(lng * 1e5)
        for d in (ilat - plat, ilng - plng):
            v = ~(d << 1) if d < 0 else d << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            out.append(chr(v + 63))
        plat, plng = ilat, ilng
    return "".join(out)
def simplify(pts, tol=4.0):
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    def perp(p, a, b):
        ax, ay = 0, 0
        bx = (b[1] - a[1]) * 83000; by = (b[0] - a[0]) * 111320
        px = (p[1] - a[1]) * 83000; py = (p[0] - a[0]) * 111320
        L = bx * bx + by * by
        if L == 0: return math.hypot(px, py)
        t = max(0, min(1, (px * bx + py * by) / L))
        return math.hypot(px - t * bx, py - t * by)
    while stack:
        s, e = stack.pop(); md = 0; mi = -1
        for i in range(s + 1, e):
            d = perp(pts[i], pts[s], pts[e])
            if d > md: md, mi = d, i
        if md > tol and mi > 0:
            keep[mi] = True; stack += [(s, mi), (mi, e)]
    return [p for p, k in zip(pts, keep) if k]

# —— names ——
tr_stop = collections.defaultdict(dict); tr_route = collections.defaultdict(dict)
for r in rows("translations.txt"):
    if r["table_name"] == "stops" and r["field_name"] == "stop_name": tr_stop[r["record_id"]][r["language"]] = r["translation"]
    if r["table_name"] == "routes" and r["field_name"] == "route_long_name": tr_route[r["record_id"]][r["language"]] = r["translation"]

stops = {}
for s in rows("stops.txt"):
    sid = s["stop_id"]; ka = s["stop_name"].strip()
    stops[sid] = {"id": sid, "ka": ka, "en": (tr_stop.get(sid, {}).get("en") or ka).strip(),
                  "lat": float(s["stop_lat"]), "lon": float(s["stop_lon"]), "code": s.get("stop_code", "").strip(),
                  "kind": 1 if "metro" in sid.lower() else (2 if "gondola" in sid.lower() else 0)}

# —— merged stops (same rules as build_stops.py) + ids column ——
groups = []
for s in stops.values():
    for g in groups:
        if g["en"] == s["en"] and g["kind"] == s["kind"] and dist((g["lat"], g["lon"]), (s["lat"], s["lon"])) < 250:
            g["pts"].append((s["lat"], s["lon"])); g["ids"].append(s["id"])
            if s["code"]: g["codes"].append(s["code"])
            break
    else:
        groups.append({"en": s["en"], "ka": s["ka"], "lat": s["lat"], "lon": s["lon"], "kind": s["kind"],
                       "pts": [(s["lat"], s["lon"])], "codes": [s["code"]] if s["code"] else [], "ids": [s["id"]]})
merged = []
for g in groups:
    lat = sum(p[0] for p in g["pts"]) / len(g["pts"]); lon = sum(p[1] for p in g["pts"]) / len(g["pts"])
    merged.append([g["en"], g["ka"], round(lat, 5), round(lon, 5), " ".join(g["codes"]), g["kind"],
                   " ".join(i[2:] if i.startswith("1:") else i for i in g["ids"])])
merged.sort(key=lambda r: (-r[5], r[0]))
stop_to_merged = {}
for mi, m in enumerate(merged):
    for i in m[6].split(" "):
        stop_to_merged["1:" + i] = mi

# —— services ——
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
svc_mask = {}; svc_range = {}
for r in rows("calendar.txt"):
    svc_mask[r["service_id"]] = sum(1 << i for i, d in enumerate(DAYS) if r[d] == "1")
    svc_range[r["service_id"]] = (r["start_date"], r["end_date"])

# —— trips + stop_times ——
trips = {}
for t in rows("trips.txt"):
    trips[t["trip_id"]] = t
def hm(s):
    h, m, sec = s.split(":"); return int(h) * 60 + int(m) + (1 if int(sec) >= 30 else 0)
seqs = collections.defaultdict(list)
print("reading stop_times…", file=sys.stderr)
for r in rows("stop_times.txt"):
    seqs[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"], hm(r["departure_time"] or r["arrival_time"])))
by_dir = collections.defaultdict(list)
for tid, st in seqs.items():
    st.sort(); t = trips.get(tid)
    if not t: continue
    by_dir[(t["route_id"], t["direction_id"] or "0")].append((tid, st))

routes = list(rows("routes.txt"))
def rkey(rid): return rid.split(":", 1)[1] if ":" in rid else rid
def colour(r):
    c = (r.get("route_color") or "").upper()
    rt = r["route_type"]
    if rt == "1": return "#e5484d" if c == "FF505B" else "#2fa86b"
    if rt == "6": return "#f0a020"
    return "#2fa86b" if c == "00B38B" else "#3b82f6"
def code(r):
    rt = r["route_type"]; n = r["route_short_name"]
    if rt == "1": return "M" + n
    if rt == "6": return "G" + n
    return n

# —— pick a date for each service in the feed window (for Transitous trip ids) ——
def date_for(svc):
    s, e = svc_range[svc]; d = max(datetime.date.today(), datetime.date(int(s[:4]), int(s[4:6]), int(s[6:])))
    end = datetime.date(int(e[:4]), int(e[4:6]), int(e[6:]))
    while d <= end:
        if svc_mask[svc] >> d.weekday() & 1: return d
        d += datetime.timedelta(days=1)
    return None

def fetch_shape(tid, start_min, svc):
    CACHE.mkdir(parents=True, exist_ok=True)
    miss = CACHE / (tid.replace(":", "_").replace("/", "_") + ".404")
    if miss.exists(): return None
    cf = CACHE / (tid.replace(":", "_").replace("/", "_") + ".json")
    if cf.exists():
        return json.loads(cf.read_text())
    if not FETCH: return None
    d = date_for(svc)
    if not d or start_min >= 24 * 60: return None
    tt = "%s_%02d:%02d_%s%s" % (d.strftime("%Y%m%d"), start_min // 60, start_min % 60, FEED, tid)
    url = "https://api.transitous.org/api/v5/trip?tripId=" + urllib.parse.quote(tt, safe="")
    for attempt in range(3):
        time.sleep(THROTTLE)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            data = json.loads(urllib.request.urlopen(req, timeout=30).read())
            pts = []
            for leg in data.get("legs", []):
                g = leg.get("legGeometry") or {}
                p = decode(g.get("points", ""), g.get("precision", 6))
                pts += p if not pts else p[1:]
            if len(pts) >= 2:
                cf.write_text(json.dumps(pts))
                return pts
            return None
        except Exception as ex:
            if getattr(ex, "code", None) == 404:
                miss.write_text(""); return None
            time.sleep(2 + attempt * 3)
    return None

jobs = []
lines = []
for r in sorted(routes, key=lambda r: (r["route_type"] != "1", r["route_type"] != "6", int("".join(c for c in r["route_short_name"] if c.isdigit()) or 0))):
    rid = r["route_id"]
    dirs = []
    for dkey in ("0", "1"):
        tl = by_dir.get((rid, dkey))
        if not tl: continue
        pat = collections.Counter(tuple(s[1] for s in st) for _, st in tl)
        dom = pat.most_common(1)[0][0]
        first = dom[0]
        # offsets: median per stop over trips with the dominant pattern
        offs = [[] for _ in dom]
        cands = {}
        for tid, st in tl:
            if tuple(s[1] for s in st) == dom:
                t0 = st[0][2]
                for i, s in enumerate(st): offs[i].append(s[2] - t0)
                svc = trips[tid]["service_id"]
                c = cands.get(svc)
                if t0 < 22 * 60 and (c is None or abs(t0 - 12 * 60) < abs(c[1] - 12 * 60)):
                    cands[svc] = (tid, t0, svc)
        # weekday services first (Transitous' current feed matches those best), then the rest
        rep = sorted(cands.values(), key=lambda c: (-bin(svc_mask.get(c[2], 0) & 0b11111).count("1"), c[2]))
        off = [sorted(o)[len(o) // 2] for o in offs]
        starts = collections.defaultdict(list)
        for tid, st in tl:
            for sq, sid, tm in st:
                if sid == first:
                    starts[trips[tid]["service_id"]].append(tm); break
        times = {svc: sorted(set(v)) for svc, v in starts.items()}
        dirs.append({"dkey": dkey, "stops": list(dom), "off": off, "times": times, "rep": rep,
                     "headsign": trips[tl[0][0]]["trip_headsign"]})
    if not dirs: continue
    if len(dirs) == 2 and dirs[0]["stops"] == dirs[1]["stops"]:
        # feed quirk (metro): both direction_ids carry the same stop order → synthesize the return direction
        a = dirs[0]; tot = a["off"][-1]
        dirs[1] = {"dkey": "1", "stops": a["stops"][::-1], "off": [tot - o for o in a["off"][::-1]],
                   "times": a["times"], "rep": a["rep"], "headsign": "", "reverse_of": a}
    lines.append({"r": r, "dirs": dirs})
    for d in dirs:
        jobs.append(d)

print(len(lines), "lines,", len(jobs), "directions", file=sys.stderr)
def do(d):
    if "reverse_of" in d: return True
    d["shape"] = None
    for tid, t0, svc in d["rep"][:5]:
        d["shape"] = fetch_shape(tid, t0, svc)
        if d["shape"] is not None: break
    return d["shape"] is not None
with ThreadPoolExecutor(2) as ex:
    ok = sum(ex.map(do, jobs))
for d in jobs:
    if "reverse_of" in d:
        sh = d["reverse_of"].get("shape"); d["shape"] = sh[::-1] if sh else None
print("shapes ok:", ok, "/", len(jobs), file=sys.stderr)

def snap(shape, stop_pts):
    """index of nearest shape vertex for each stop, monotonic"""
    idx = []; lo = 0
    for p in stop_pts:
        best, bd = lo, 1e18
        for i in range(lo, len(shape)):
            dd = dist(shape[i], p)
            if dd < bd: bd, best = dd, i
            if dd > bd + 3000 and i > best + 50: break
        idx.append(best); lo = best
    return idx

def delta(arr):
    out = []; prev = 0
    for v in arr: out.append(v - prev); prev = v
    return out

outdir = OUT / "lines"; outdir.mkdir(parents=True, exist_ok=True)
for f in outdir.glob("*.json"): f.unlink()
index_lines = []
stop_lines = collections.defaultdict(set)
total = 0
hsh = hashlib.sha1()
for li, L in enumerate(lines):
    r = L["r"]; key = rkey(r["route_id"])
    ldirs = []; terms = []
    for d in L["dirs"]:
        pts = [(stops[s]["lat"], stops[s]["lon"]) for s in d["stops"]]
        shape = d.get("shape")
        if shape:
            # make sure the shape actually reaches the stops; otherwise fall back
            if dist(shape[0], pts[0]) > 800 or dist(shape[-1], pts[-1]) > 800: shape = None
        shape = simplify(shape, 4.0) if shape else pts
        si = snap(shape, pts)
        ldirs.append({
            "d": int(d["dkey"]),
            "s": [[s[2:] if s.startswith("1:") else s, stops[s]["en"], stops[s]["ka"], round(stops[s]["lat"], 5), round(stops[s]["lon"], 5)] for s in d["stops"]],
            "o": d["off"],
            "t": {svc: delta(v) for svc, v in d["times"].items()},
            "p": encode(shape), "si": si, "real": bool(d.get("shape")),
        })
        last = stops[d["stops"][-1]]
        terms.append([last["en"], last["ka"], d["dkey"]])
        for s in d["stops"]:
            if s in stop_to_merged: stop_lines[stop_to_merged[s]].add(li)
    body = json.dumps({"v": 1, "id": r["route_id"], "dirs": ldirs}, ensure_ascii=False, separators=(",", ":"))
    (outdir / (key + ".json")).write_text(body, encoding="utf-8"); total += len(body.encode()); hsh.update(body.encode())
    en = tr_route.get(r["route_id"], {}).get("en") or r["route_long_name"]
    index_lines.append([key, code(r), int(r["route_type"]), colour(r), en.strip(), r["route_long_name"].strip(),
                        [[t[0], t[1], int(t[2])] for t in terms]])

idx = {"v": 1, "built": hsh.hexdigest()[:10], "source": "TTC GTFS via Transitous (tbilisi-gtfs)", "feed": FEED,
       "svc": svc_mask, "lines": index_lines,
       "stopLines": [sorted(stop_lines.get(i, [])) for i in range(len(merged))]}
(OUT / "lines.json").write_text(json.dumps(idx, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
(OUT / "stops.json").write_text(json.dumps({"v": 2, "source": "TTC GTFS via Transitous (tbilisi-gtfs)", "stops": merged},
                                          ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("lines.json", (OUT / "lines.json").stat().st_size, "bytes; per-line total", total, "bytes;",
      "stops.json", (OUT / "stops.json").stat().st_size, file=sys.stderr)
