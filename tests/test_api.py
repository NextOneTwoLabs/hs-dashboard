import json
import unittest
from pathlib import Path

from api import routes as api_routes   # #8 PR 3: was crawler/api_routes.py
from build_lib import store
from collect import fetch

CASES = json.loads((Path(__file__).parent / "routes.json").read_text(encoding="utf-8"))


class Routes(unittest.TestCase):
    def test_golden_routes(self):
        for case in CASES["routes"]:
            with self.subTest(case["method"] + " " + case["path"]):
                got = api_routes.resolve(case["method"], case["path"])
                self.assertEqual(got["status"], case["status"])
                if case["status"] == 200:
                    self.assertEqual(got["asset"], case["asset"])
                    self.assertEqual(got["season"], case["season"])

    def test_cache_policy(self):
        for case in CASES["cachePolicy"]:
            self.assertEqual(api_routes.cache_policy(case["season"], case["active"]), case["expect"])


class Store(unittest.TestCase):
    def test_rows_one_per_line(self):
        text = store.dumps({"schema": 1, "rows": [{"a": 1}, {"a": 2}], "map": {"x": {"b": 1}}})
        self.assertEqual(text, '{\n  "schema": 1,\n  "rows": [\n    {"a":1},\n    {"a":2}\n  ],\n'
                               '  "map": {\n    "x": {"b":1}\n  }\n}\n')
        self.assertEqual(json.loads(text)["rows"][1]["a"], 2)


class LiveDetection(unittest.TestCase):
    """Uses the committed archive (no network)."""

    def live(self, season, comp, day):
        import datetime as dt
        from collect import refresh as hs
        sources = store.load_json(store.SOURCES)
        links = store.load_json(store.LINKS)
        cfg = sources["seasons"][season]["competitions"][comp]
        return hs.is_live(sources, links, season, comp, cfg, dt.date.fromisoformat(day))

    def test_window(self):
        self.assertTrue(self.live("2025-26", "ca-cif-state", "2026-03-10"))
        self.assertFalse(self.live("2025-26", "ca-cif-state", "2026-10-01"))

    def test_unfetched_disabled_gender_is_not_live(self):
        # CA regionals list boys divisions that are never fetched (girls only).
        self.assertFalse(self.live("2023-24", "ca-cif-norcal", "2026-10-01"))

    def test_complete_maxpreps_tournament_is_not_live(self):
        self.assertFalse(self.live("2025-26", "pa-piaa", "2025-11-15"))


class FakeResponse:
    def __init__(self, status, headers=None, body=b""):
        self.status, self.headers, self._body = status, headers or {}, body

    def read(self):
        return self._body

    def geturl(self):
        return "https://example.test/final"

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Fetcher(unittest.TestCase):
    def test_waf_challenge_stops_run(self):
        f = fetch.Fetcher({"h": 0}, opener=lambda req, timeout: FakeResponse(202, {"x-amzn-waf-action": "challenge"}))
        with self.assertRaises(fetch.Blocked):
            f.get("https://example.test/", "h")
        self.assertEqual(f.requests, 1)  # never retried

    def test_budget(self):
        f = fetch.Fetcher({"h": 0}, max_requests=1, opener=lambda req, timeout: FakeResponse(200, body=b"ok"))
        self.assertEqual(f.get("https://example.test/", "h")[1], "ok")
        with self.assertRaises(fetch.BudgetExhausted):
            f.get("https://example.test/", "h")


if __name__ == "__main__":
    unittest.main()
