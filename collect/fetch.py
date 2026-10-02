"""Polite, low-rate HTTP fetching (stdlib only).

Every host gets a fixed delay between requests, the whole run has a request
budget, and bot-protection responses (AWS WAF / Cloudflare challenges) stop
the run instead of being retried: we never try to solve a challenge.
"""
import time
import urllib.error
import urllib.request

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)


class Blocked(Exception):
    """The site answered with a bot challenge; stop for this run."""


class BudgetExhausted(Exception):
    pass


class NotFound(Exception):
    pass


class Fetcher:
    def __init__(self, delays=None, max_requests=60, opener=None):
        self.delays = delays or {}
        self.max_requests = max_requests
        self.requests = 0
        self.failed = []
        self._last = {}
        self._open = opener or urllib.request.urlopen

    def _wait(self, host):
        delay = self.delays.get(host, 3)
        last = self._last.get(host)
        if last is not None:
            remaining = delay - (time.monotonic() - last)
            if remaining > 0:
                time.sleep(remaining)
        self._last[host] = time.monotonic()

    def get(self, url, host_key):
        """Return (final_url, text). Raises NotFound, Blocked, BudgetExhausted."""
        attempts = 3
        for attempt in range(attempts):
            if self.requests >= self.max_requests:
                raise BudgetExhausted(url)
            self._wait(host_key)
            self.requests += 1
            req = urllib.request.Request(url, headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            })
            try:
                with self._open(req, timeout=30) as resp:
                    if resp.status == 202 or resp.headers.get("x-amzn-waf-action"):
                        raise Blocked(url)
                    body = resp.read().decode("utf-8", errors="replace")
                    return resp.geturl(), body
            except urllib.error.HTTPError as e:
                if e.headers.get("cf-mitigated") or e.headers.get("x-amzn-waf-action"):
                    raise Blocked(url) from e
                if e.code == 404:
                    raise NotFound(url) from e
                if e.code < 500 or attempt == attempts - 1:
                    self.failed.append({"url": url, "status": e.code})
                    raise
            except urllib.error.URLError:
                if attempt == attempts - 1:
                    self.failed.append({"url": url, "status": "network"})
                    raise
            time.sleep(2 ** attempt * 2)
        raise RuntimeError("unreachable")
