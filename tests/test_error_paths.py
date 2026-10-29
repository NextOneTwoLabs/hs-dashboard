"""#9: read-time and parse errors on MaxPreps list pages and the CIF index/division paths
are logged and skipped (status and existing data kept), never a crash. Same pattern as the
bracket pages in test_list_recheck.py. Offline: fake fetcher, temp store."""
import datetime as dt
import http.client
import json
import unittest
import urllib.error
from unittest import mock

from build_lib import store
from collect import cif, maxpreps
from collect import refresh as hs
from test_refresh import GA, SOURCES, TempLinks, with_2026_27

SEASON = "2026-27"
GA_LIST = "https://www.maxpreps.com" + GA["list"]
CIF_INDEX = SOURCES["sources"]["cif"]["base"] + SOURCES["seasons"][SEASON]["competitions"]["ca-cif-state"]["path"] + "/index"
CIF_DIV = "https://www.cifstate.org/sports/soccer/brkts_2027/gd1"
READ_ERRORS = [TimeoutError("The read operation timed out"), http.client.IncompleteRead(b"partial"),
               ConnectionResetError(104, "reset by peer"), urllib.error.URLError("down")]


class Fetch:
    def __init__(self, response):
        self.response, self.urls = response, []

    def get(self, url, host_key):
        self.urls.append(url)
        if isinstance(self.response, Exception):
            raise self.response
        return url, self.response


def links_text():
    return store.LINKS.read_text(encoding="utf-8")


class ListPage(unittest.TestCase):
    def crawl(self, response, entry):
        sources = with_2026_27(**{"ga-ghsa": GA})
        links = {SEASON: {"ga-ghsa": entry}}
        with TempLinks(links):
            before = links_text()
            logs = []
            crawler = hs.Crawler(sources, Fetch(response), log=lambda *a: logs.append(" ".join(map(str, a))))
            crawler.slot, crawler.today = True, dt.date(2027, 4, 20)   # the daily re-check run, in term
            crawler.crawl(SEASON, "ga-ghsa", True, "relist")
            return logs, before == links_text(), json.loads(links_text())[SEASON]["ga-ghsa"], crawler

    def test_read_error_keeps_status(self):
        for err in READ_ERRORS:
            for entry in ({"divisions": {}}, {"status": "ok", "divisions": {"b1": {"bracket": "x", "complete": True}}}):
                with self.subTest(err=type(err).__name__, status=entry.get("status")):
                    logs, unchanged, after, crawler = self.crawl(err, dict(entry))
                    self.assertTrue(unchanged)
                    self.assertEqual(after.get("status"), entry.get("status"))
                    self.assertTrue(any("tournament list failed" in line for line in logs), logs)

    def test_parse_error_keeps_status_and_brackets(self):
        entry = {"status": "ok", "divisions": {"b1": {"bracket": "x", "complete": True}}}
        with mock.patch.object(maxpreps, "parse_tournament", side_effect=ValueError("bad markup")):
            for e in ({"divisions": {}}, entry):
                with self.subTest(status=e.get("status")):
                    logs, unchanged, after, crawler = self.crawl("<html></html>", json.loads(json.dumps(e)))
                    self.assertTrue(unchanged)
                    self.assertEqual(after, e)
                    self.assertTrue(any("could not parse the tournament list" in line for line in logs), logs)


class CifPaths(unittest.TestCase):
    def crawl(self, response, entry):
        links = {SEASON: {"ca-cif-state": entry}}
        with TempLinks(links):
            before = links_text()
            logs = []
            crawler = hs.Crawler(SOURCES, Fetch(response), log=lambda *a: logs.append(" ".join(map(str, a))))
            crawler.crawl(SEASON, "ca-cif-state", True)
            return logs, before == links_text(), json.loads(links_text())[SEASON]["ca-cif-state"], crawler

    def test_index_read_error_keeps_status(self):
        errors = READ_ERRORS + [urllib.error.HTTPError(CIF_INDEX, 500, "error", None, None)]
        for err in errors:
            with self.subTest(err=type(err).__name__):
                logs, unchanged, after, crawler = self.crawl(err, {"status": "pending", "divisions": {}})
                self.assertTrue(unchanged)
                self.assertEqual(after["status"], "pending")
                self.assertTrue(any("index failed" in line for line in logs), logs)

    def test_index_parse_error_keeps_status(self):
        with mock.patch.object(cif, "parse_index", side_effect=ValueError("bad markup")):
            logs, unchanged, after, crawler = self.crawl("<html></html>", {"status": "pending", "divisions": {}})
        self.assertTrue(unchanged)
        self.assertEqual(after, {"status": "pending", "divisions": {}})
        self.assertTrue(any("could not parse the index" in line for line in logs), logs)

    def division(self):
        return {"status": "ok", "divisions": {"gd1": {"cif": CIF_DIV, "gender": "girls"}}}

    def test_division_read_error_recorded(self):
        for err in READ_ERRORS:
            with self.subTest(err=type(err).__name__):
                logs, unchanged, after, crawler = self.crawl(err, self.division())
                d = after["divisions"]["gd1"]
                self.assertEqual((d["status"], d["errorCode"]), ("error", "network"))
                self.assertNotIn("maxpreps", d)

    def test_division_parse_error_recorded(self):
        with mock.patch.object(cif, "parse_division", side_effect=ValueError("bad markup")):
            logs, unchanged, after, crawler = self.crawl("<html></html>", self.division())
        d = after["divisions"]["gd1"]
        self.assertEqual((d["status"], d["errorCode"]), ("error", "parse"))
        self.assertNotIn("maxpreps", d)
        self.assertEqual(crawler.new_failures, [f"{SEASON}/ca-cif-state/gd1: error parse"])


if __name__ == "__main__":
    unittest.main()
