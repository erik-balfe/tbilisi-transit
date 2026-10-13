#!/usr/bin/env python3
"""Validate a TTC GTFS feed + freshly built data, and publish it as content-hashed files + manifest.json.

Usage: python3 tools/publish_data.py <gtfs.zip> <build_dir> <data_dir>
  build_dir  output of build_stops.py/build_lines.py (TT_OUT): stops.json, lines.json, lines/<key>.json
  data_dir   checkout of the `data` branch; updated in place:
             manifest.json, stops.<h>.json, lines.<h>.json, lines/<key>.<h>.json
Files of the previous generation are kept (clients holding the old manifest can still lazy-load lines);
anything older is removed. Exits 1 (loudly) if the feed or the build looks invalid.
Prints `changed=true|false` (also appended to $GITHUB_OUTPUT when set).
"""
import csv, datetime, hashlib, io, json, os, shutil, sys, zipfile
from pathlib import Path

def fail(msg):
    print("::error::" + msg if os.environ.get("GITHUB_ACTIONS") else "ERROR: " + msg, file=sys.stderr)
    sys.exit(1)

zpath, build, data = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])

# —— validate feed ——
try:
    z = zipfile.ZipFile(zpath)
except Exception as e:
    fail("GTFS zip unreadable: %s" % e)
names = set(z.namelist())
for need in ("stops.txt", "routes.txt", "trips.txt", "stop_times.txt", "calendar.txt"):
    if need not in names: fail("GTFS missing " + need)
def rows(n): return csv.DictReader(io.TextIOWrapper(z.open(n), encoding="utf-8-sig"))
starts, ends = [], []
for r in rows("calendar.txt"):
    starts.append(r["start_date"]); ends.append(r["end_date"])
if not ends: fail("calendar.txt is empty")
feed_start, feed_end = min(starts), max(ends)
if "feed_info.txt" in names:
    for r in rows("feed_info.txt"):
        feed_start = r.get("feed_start_date") or feed_start
        feed_end = r.get("feed_end_date") or feed_end
iso = lambda d: "%s-%s-%s" % (d[:4], d[4:6], d[6:8])
feed_start, feed_end = iso(feed_start), iso(feed_end)
today = datetime.date.today().isoformat()
if feed_end < today: fail("feed already expired (feed_end %s < %s)" % (feed_end, today))

# —— validate build ——
try:
    stops = json.loads((build / "stops.json").read_text())
    lines = json.loads((build / "lines.json").read_text())
except Exception as e:
    fail("build output unreadable: %s" % e)
ns, nl = len(stops.get("stops", [])), len(lines.get("lines", []))
if ns < 800: fail("too few stops: %d" % ns)
if nl < 100: fail("too few lines: %d" % nl)
if len(lines.get("stopLines", [])) != ns: fail("stopLines does not match stops")
for l in lines["lines"]:
    if not (build / "lines" / (l[0] + ".json")).exists(): fail("missing line file " + l[0])

# —— hash + stage ——
def h(b): return hashlib.sha256(b).hexdigest()[:12]
files, blobs = {}, {}
def add(key, src, stem, sub=""):
    b = src.read_bytes(); hh = h(b)
    path = (sub + "/" if sub else "") + stem + "." + hh + ".json"
    files[key] = {"path": path, "hash": hh, "size": len(b)}
    blobs[path] = b
add("stops", build / "stops.json", "stops")
add("lines", build / "lines.json", "lines")
for l in lines["lines"]:
    add("line:" + l[0], build / "lines" / (l[0] + ".json"), l[0], "lines")

old = {}
mf = data / "manifest.json"
if mf.exists():
    try: old = json.loads(mf.read_text())
    except Exception: old = {}
sig = lambda m: {k: v["hash"] for k, v in (m.get("files") or {}).items()}
changed = sig(old) != sig({"files": files}) or old.get("feed_end") != feed_end or old.get("feed_start") != feed_start

def out(v):
    print("changed=" + ("true" if v else "false"))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f: f.write("changed=%s\n" % ("true" if v else "false"))

if not changed:
    out(False); sys.exit(0)

version = h(json.dumps(sig({"files": files}), sort_keys=True).encode() + feed_end.encode())
manifest = {
    "v": 1, "version": version, "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "feed_start": feed_start, "feed_end": feed_end, "stops": ns, "lines": nl,
    "source": "TTC GTFS via Transitous (https://transitous.org/sources/), shapes © OpenStreetMap contributors",
    "files": files,
}
keep = set(blobs) | {v["path"] for v in (old.get("files") or {}).values()}
data.mkdir(parents=True, exist_ok=True)
for p, b in blobs.items():
    dst = data / p; dst.parent.mkdir(parents=True, exist_ok=True)
    if not dst.exists(): dst.write_bytes(b)
for f in list(data.glob("*.json")) + list(data.glob("lines/*.json")):
    rel = f.relative_to(data).as_posix()
    if rel != "manifest.json" and rel not in keep: f.unlink()
if old: (data / "manifest.prev.json").write_text(json.dumps(old, separators=(",", ":")))
mf.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")))
print("published version %s: %d stops, %d lines, feed %s → %s, %d files" % (version, ns, nl, feed_start, feed_end, len(files)), file=sys.stderr)
out(True)
