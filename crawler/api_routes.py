"""Python twin of api/routes.mjs (used by dev_server.py and the tests)."""
import re

_ID = r"([^/]+)"
_ROUTES = [
    (re.compile(r"^/api/v1/catalog$"), None, lambda p: "/archive/catalog.json", None),
    (re.compile(r"^/api/v1/status$"), None, lambda p: "/archive/refresh-state.json", None),
    (re.compile(r"^/api/v1/sources$"), None, lambda p: "/data/sources.json", None),
    (re.compile(r"^/api/v1/schools$"), None, lambda p: "/archive/schools.json", None),
    (re.compile(rf"^/api/v1/schools/{_ID}$"), None,
     lambda p: f"/archive/schools/{p[0]}.json", lambda p: valid_id(p[0])),
    (re.compile(rf"^/api/v1/seasons/{_ID}/games$"), 0,
     lambda p: f"/archive/seasons/{p[0]}/games.json", lambda p: valid_season(p[0])),
    (re.compile(rf"^/api/v1/seasons/{_ID}/competitions/{_ID}/divisions/{_ID}/bracket$"), 0,
     lambda p: f"/archive/brackets/{p[0]}/{p[1]}/{p[2]}.json",
     lambda p: valid_season(p[0]) or valid_comp(p[1]) or valid_div(p[2])),
]


def valid_season(s):
    if not re.fullmatch(r"\d{4}-\d{2}", s):
        return "invalid season (expected YYYY-YY)"
    if (int(s[:4]) + 1) % 100 != int(s[5:]):
        return "invalid season (years must be consecutive)"
    return None


def valid_comp(c):
    return None if re.fullmatch(r"[a-z][a-z0-9-]{1,40}", c) else "invalid competition id"


def valid_div(d):
    return None if re.fullmatch(r"[bg]d[1-9]", d) else "invalid division code (expected bd1-bd9 or gd1-gd9)"


def valid_id(i):
    return None if re.fullmatch(r"[a-z0-9][a-z0-9-]{2,100}", i) else "invalid school id"


def resolve(method, path):
    for pattern, season_idx, asset, check in _ROUTES:
        m = pattern.match(path)
        if not m:
            continue
        if method not in ("GET", "HEAD"):
            return {"status": 405, "error": "method not allowed"}
        params = m.groups()
        bad = check(params) if check else None
        if bad:
            return {"status": 400, "error": bad}
        return {"status": 200, "asset": asset(params),
                "season": params[season_idx] if season_idx is not None else None}
    return {"status": 404, "error": "unknown API route"}


def cache_policy(season, active_season):
    if season and active_season and season < active_season:
        return "public, max-age=86400, stale-while-revalidate=86400"
    return "no-cache"
