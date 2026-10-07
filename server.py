#!/usr/bin/env python3
"""Serve Tbilisi Transit UI and proxy Transitous API (sets User-Agent; avoids CORS quirks)."""
from __future__ import annotations

import argparse
import http.client
import json
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
API_BASE = "https://api.transitous.org/api"
USER_AGENT = "TbilisiTransitUI/1.0 (Erik; local tools)"
DEFAULT_PORT = 8765


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        if self.path.startswith("/api/"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.end_headers()
            return
        self.send_error(404)

    def do_GET(self) -> None:
        if self.path.startswith("/api/"):
            self._proxy()
            return
        if self.path in ("/", "/index.html"):
            self.path = "/index.html"
        return super().do_GET()

    def _proxy(self) -> None:
        # /api/... -> https://api.transitous.org/api/...
        parsed = urllib.parse.urlparse(self.path)
        upstream = API_BASE + parsed.path[len("/api") :]
        if parsed.query:
            upstream += "?" + parsed.query
        req = urllib.request.Request(
            upstream,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            method="GET",
        )
        ctx = ssl.create_default_context()
        try:
            with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
                body = resp.read()
                ctype = resp.headers.get("Content-Type", "application/json")
                self.send_response(resp.status)
                self.send_header("Content-Type", ctype)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as e:
            body = e.read() if e.fp else b""
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            payload = json.dumps({"error": str(e)}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)


def main() -> None:
    p = argparse.ArgumentParser(description="Tbilisi Transit UI + Transitous proxy")
    p.add_argument("--port", "-p", type=int, default=DEFAULT_PORT)
    p.add_argument("--host", default="127.0.0.1")
    args = p.parse_args()
    http.client._MAXHEADERS = max(http.client._MAXHEADERS, 200)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Tbilisi Transit UI → http://{args.host}:{args.port}/", flush=True)
    print(f"API proxy         → http://{args.host}:{args.port}/api/… → {API_BASE}/…", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)


if __name__ == "__main__":
    main()
