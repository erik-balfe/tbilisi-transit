#!/usr/bin/env bash
# Assemble the deployable site: app code from this checkout + runtime data (from the `data` branch) under ./data/
# Usage: tools/assemble_site.sh <data_dir> <out_dir>
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)"; data="$1"; out="$2"
test -f "$data/manifest.json" || { echo "no manifest.json in $data" >&2; exit 1; }
rm -rf "$out"; mkdir -p "$out"
for f in index.html sw.js manifest.webmanifest app*.js app.css; do cp "$src/$f" "$out/"; done
cp -r "$src/icons" "$src/vendor" "$out/"
[ -f "$src/LICENSE" ] && cp "$src/LICENSE" "$out/"
mkdir -p "$out/data"
cp -r "$data/." "$out/data/"
rm -rf "$out/data/.git" "$out/data/README.md"
touch "$out/.nojekyll"
echo "site assembled in $out ($(du -sh "$out" | cut -f1))"
