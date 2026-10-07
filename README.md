# Tbilisi Transit

Simple mobile-friendly trip planner for Tbilisi municipal transport.

- Live data from [Transitous](https://transitous.org/) (MOTIS)
- Sources / attribution: https://transitous.org/sources/
- Times in Asia/Tbilisi

## Live site

**https://erik-balfe.github.io/tbilisi-transit/**

If that URL 404s, enable GitHub Pages once (branch deploy — no Actions):

1. Open **https://github.com/erik-balfe/tbilisi-transit/settings/pages**
2. Under **Build and deployment → Source**, choose **Deploy from a branch**
3. Branch: **main** · Folder: **/ (root)** → **Save**
4. Wait ~1 minute, then reload the live URL above

## Local

```bash
python3 server.py
```

Then open http://127.0.0.1:8765/

`server.py` proxies `/api/*` to Transitous. On GitHub Pages the page calls `https://api.transitous.org/api` directly.
