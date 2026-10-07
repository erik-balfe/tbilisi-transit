# Tbilisi Transit

Simple mobile-friendly trip planner for Tbilisi municipal transport.

- Live data from [Transitous](https://transitous.org/) (MOTIS)
- Sources / attribution: https://transitous.org/sources/
- Times in Asia/Tbilisi

## Use

Open the GitHub Pages site (see repo Settings → Pages if the link is not live yet), or run locally:

```bash
python3 server.py
```

Then open http://127.0.0.1:8765/

## Local proxy

`server.py` serves this folder and proxies `/api/*` to Transitous with an identifying User-Agent. On GitHub Pages the page calls `https://api.transitous.org/api` directly.
