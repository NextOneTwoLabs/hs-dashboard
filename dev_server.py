"""Local offline server: the page plus the same /api/v1 routes as worker.js.

  python dev_server.py [--port 8787]
"""
import argparse
import hashlib
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from crawler.api_routes import cache_policy, resolve

PUBLIC = Path(__file__).resolve().parent / "public"


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body, headers):
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, status, error, extra=None):
        body = json.dumps({"ok": False, "error": error}).encode()
        self._send(status, body, {"Content-Type": "application/json; charset=utf-8",
                                  "Cache-Control": "no-store", **(extra or {})})

    def _api(self, path):
        route = resolve(self.command, path)
        if route["status"] == 405:
            return self._error(405, route["error"], {"Allow": "GET, HEAD"})
        if route["status"] != 200:
            return self._error(route["status"], route["error"])
        file = PUBLIC / route["asset"].lstrip("/")
        if not file.is_file():
            return self._error(404, "not found")
        body = file.read_bytes()
        etag = '"' + hashlib.sha1(body).hexdigest()[:16] + '"'
        active = json.loads((PUBLIC / "data" / "sources.json").read_text(encoding="utf-8"))["activeSeason"]
        headers = {"Content-Type": "application/json; charset=utf-8", "ETag": etag,
                   "Cache-Control": cache_policy(route["season"], active)}
        if self.headers.get("If-None-Match") == etag:
            return self._send(304, b"", headers)
        self._send(200, body, headers)

    def _static(self, path):
        if path.startswith(("/archive", "/data")):
            return self._error(404, "not found")
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        file = (PUBLIC / rel).resolve()
        if PUBLIC not in file.parents or not file.is_file():
            return self._error(404, "not found")
        ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        if file.suffix in (".js", ".mjs"):
            ctype = "text/javascript"
        self._send(200, file.read_bytes(), {"Content-Type": ctype + ("; charset=utf-8" if ctype.startswith("text") else ""),
                                            "Cache-Control": "no-cache"})

    def _dispatch(self):
        path = unquote(urlsplit(self.path).path)
        if path.startswith("/api/"):
            return self._api(path)
        if self.command not in ("GET", "HEAD"):
            return self._error(405, "method not allowed", {"Allow": "GET, HEAD"})
        return self._static(path)

    do_GET = do_HEAD = do_POST = do_PUT = do_DELETE = _dispatch

    def log_message(self, fmt, *args):
        pass


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8787)
    args = p.parse_args()
    print(f"serving http://localhost:{args.port}")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
