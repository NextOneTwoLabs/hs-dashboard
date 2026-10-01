"""#6 (review N10): re-check MaxPreps list pages for brackets added later.

Every test drives hs.main(["--refresh", "--now", ...]) once per cron run of a
day, in a temp store with a fake fetcher (offline; derive is stubbed out).
"""
import copy
import datetime as dt
import http.client
import io
import json
import shutil
import tempfile
import unittest
import urllib.error
from email.message import Message
from pathlib import Path
from unittest import mock

from crawler import hs, maxpreps, store
from crawler.fetch import Blocked, BudgetExhausted, NotFound
try:
    from test_refresh import SOURCES, runs_on          # unittest discover -s tests
except ImportError:
    from tests.test_refresh import SOURCES, runs_on    # python -m unittest tests.test_list_recheck

FIX = Path(__file__).parent / "fixtures" / "html"
TID = "8y9aX16M0U-dwDYbnzV5Jw"
BASE = "https://www.maxpreps.com"
LIST_PATH = f"/tournament/list/{TID}/girls-soccer-winter-26-27/tx.htm"
LIST_URL = BASE + LIST_PATH
LISTED = maxpreps.parse_tournament((FIX / "maxpreps_tx_2026_list.html").read_text(encoding="utf-8"), TID)
BY_CODE = dict(zip(["4a-d1", "4a-d2", "5a-d1", "5a-d2", "6a-d1", "6a-d2"], LISTED))
IN_TERM = dt.date(2027, 1, 20)      # winter term 01-15..04-20
OFF_TERM = dt.date(2026, 10, 1)
SEASON = "2026-27"
OLD_DATED = (FIX / "maxpreps_tx_2026_6a_d1.html").read_text(encoding="utf-8")  # rounds in March 2026


def list_html(*brackets):
    return "".join(f'<a href="{b["url"]}">{b["name"]}</a>\n' for b in brackets)


def bracket_html(date, champion=False):
    cls = ' class="team matchwinner"' if champion else ' class="team"'
    box = '<div class="championbox"><span class="championname">A Hawks</span></div>' if champion else ""
    return ('<div class="rounds"><div class="round" data-round-index="0"><header class="round-header">'
            f'<span class="round-date"><abbr class="start-date" title="{date}T17:00:00">x</abbr></span>'
            '<span class="round-name" title="Final">Final</span></header><ul class="matchup-list">'
            '<li id="matchup_00000009-0000-0000-0000-000000000001" class="matchup-container"><div class="matchup">'
            f'<ul class="teams"><li{cls} data-school-id="00000001-0000-0000-0000-000000000000">'
            '<span class="name"><a href="/tx/a/a-hawks/s/">A</a></span><a class="result" href="#">1</a></li>'
            '<li class="team" data-school-id="00000002-0000-0000-0000-000000000000">'
            '<span class="name"><a href="/tx/b/b-owls/s/">B</a></span><a class="result" href="#">0</a></li>'
            f'</ul></div>{box}</li></ul></div></div>')


def entry_for(code, **extra):
    b = BY_CODE[code]
    label = "Conference " + b["name"].split("Conference ")[1]
    return {"name": b["name"], "label": label, "bracket": b["id"], "maxpreps": BASE + b["url"],
            "gender": "girls", **extra}


def known(code, complete=False):
    return entry_for(code, status="ok", complete=complete, canonical=BASE + BY_CODE[code]["url"],
                     fetchedAt="2027-01-10T06:00:00Z")


class Fake:
    """Routes URLs to an html string, a callable(day) or an exception; counts requests."""

    def __init__(self, routes, budget):
        self.routes, self.budget = routes, budget
        self.requests, self.failed = 0, []

    def get(self, url, host_key):
        if self.requests >= self.budget:
            raise BudgetExhausted(url)
        self.requests += 1
        Fake.log.append(url)
        got = self.routes.get(url, NotFound(url))
        if isinstance(got, list):  # one response per request, the last one repeats
            got = got.pop(0) if len(got) > 1 else got[0]
        if isinstance(got, Exception):
            if isinstance(got, urllib.error.HTTPError):
                self.failed.append({"url": url, "status": got.code})
            raise got
        return url, got


def http_error(url, code):
    return urllib.error.HTTPError(url, code, "error", Message(), io.BytesIO(b""))


class Store:
    def __init__(self, divisions, raw=None, list_status="ok"):
        self.divisions, self.raw, self.list_status = divisions, raw or {}, list_status

    def __enter__(self):
        self.dir = Path(tempfile.mkdtemp())
        d = self.dir
        sources = copy.deepcopy(SOURCES)
        sources["seasons"][SEASON]["competitions"]["tx-uil"] = {"tournament": TID, "list": LIST_PATH}
        (d / "sources.json").write_text(json.dumps(sources), encoding="utf-8")
        self.patches = [mock.patch.object(store, k, v) for k, v in {
            "SOURCES": d / "sources.json", "RAW": d / "raw", "LINKS": d / "links.json",
            "ARCHIVE": d / "archive"}.items()]
        self.patches.append(mock.patch.object(hs.derive, "build_all", return_value=[]))
        for p in self.patches:
            p.start()
        links = {SEASON: {"tx-uil": {"status": self.list_status, "divisions": self.divisions}}}
        store.write_json(store.LINKS, links)   # the crawler's own format, so "unchanged" means byte-identical
        for code, html in self.raw.items():
            path = store.RAW / SEASON / "tx-uil" / f"{code}.html"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(html, encoding="utf-8")
        return self

    def __exit__(self, *exc):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    def links(self):
        return json.loads(store.LINKS.read_text(encoding="utf-8"))[SEASON]["tx-uil"]

    def snapshot(self):
        files = sorted(p for p in self.dir.rglob("*") if p.is_file() and p.name != "sources.json")
        return {str(p.relative_to(self.dir)): p.read_bytes() for p in files}

    def run_day(self, day, routes, budget=60, logs=None):
        """One hs.main() per cron run; returns {HH:MM: [urls fetched]}."""
        per_run = {}
        for now in runs_on(day):
            Fake.log = []
            with mock.patch.object(hs, "Fetcher", lambda delays, b, _r=routes: Fake(_r, min(b, budget))), \
                    mock.patch("builtins.print", lambda *a, **k: logs.append(" ".join(map(str, a))) if logs is not None else None):
                self.result = hs.main(["--refresh", "--now", now.isoformat()])
            if Fake.log:
                per_run[now.strftime("%H:%M")] = Fake.log
        return per_run


def all_urls(per_run):
    return [u for urls in per_run.values() for u in urls]


class ListRecheck(unittest.TestCase):
    def test_ok_list_rechecked_once_a_day(self):
        routes = {LIST_URL: list_html(*LISTED)}
        routes.update({BASE + b["url"]: bracket_html("2027-02-20") for b in LISTED})
        with Store({"6a-d1": known("6a-d1")}, raw={"6a-d1": OLD_DATED}) as st:
            per_run = st.run_day(IN_TERM, routes)
            self.assertEqual(all_urls(per_run).count(LIST_URL), 1)
            self.assertEqual(list(per_run)[0], "06:00")
            self.assertEqual(sorted(st.links()["divisions"]), sorted(BY_CODE))
            # The 5 new brackets are fetched once each; the known, out-of-window one is not.
            for code, b in BY_CODE.items():
                self.assertEqual(all_urls(per_run).count(BASE + b["url"]), 0 if code == "6a-d1" else 1, code)

    def test_new_divisions_fetched_within_budget(self):
        routes = {LIST_URL: list_html(*LISTED)}
        routes.update({BASE + b["url"]: bracket_html("2027-03-20") for b in LISTED})
        with Store({"6a-d1": known("6a-d1")}, raw={"6a-d1": OLD_DATED}) as st:
            per_run = st.run_day(IN_TERM, routes, budget=3)
            # 06:00: list + 2 brackets; 06:30: the other 3 (not tomorrow's slot).
            self.assertEqual({k: len(v) for k, v in per_run.items()}, {"06:00": 3, "06:30": 3})
            self.assertTrue(all(d.get("status") == "ok" for d in st.links()["divisions"].values()))

    def test_relist_only_fetches_list(self):
        # Kongming's X2 case: known, incomplete, dated divisions outside the window.
        divs = {"6a-d1": known("6a-d1"), "6a-d2": known("6a-d2")}
        routes = {LIST_URL: list_html(BY_CODE["6a-d1"], BY_CODE["6a-d2"])}
        with Store(divs, raw={"6a-d1": OLD_DATED, "6a-d2": OLD_DATED}) as st:
            before = st.snapshot()
            per_run = st.run_day(IN_TERM, routes)
            self.assertEqual(all_urls(per_run), [LIST_URL])
            self.assertEqual(st.snapshot(), before)

    def test_quiet_recheck_writes_nothing(self):
        # Every division complete: the list is still re-checked once (the accepted risk is gone),
        # and an unchanged list writes nothing at all.
        routes = {LIST_URL: list_html(BY_CODE["6a-d1"])}
        with Store({"6a-d1": known("6a-d1", complete=True)}, raw={"6a-d1": OLD_DATED}) as st:
            before = st.snapshot()
            per_run = st.run_day(IN_TERM, routes)
            self.assertEqual(all_urls(per_run), [LIST_URL])
            self.assertEqual(st.snapshot(), before)

    def test_no_recheck_off_term(self):
        routes = {LIST_URL: list_html(*LISTED)}
        with Store({"6a-d1": known("6a-d1")}, raw={"6a-d1": OLD_DATED}) as st:
            self.assertEqual(st.run_day(OFF_TERM, routes), {})

    def test_renamed_bracket_keeps_code(self):
        renamed = dict(BY_CODE["6a-d1"], name="2026 Soccer Conference 6A Division 1")
        logs = []
        with Store({"6a-d1": known("6a-d1")}, raw={"6a-d1": OLD_DATED}) as st:
            st.run_day(IN_TERM, {LIST_URL: list_html(renamed)}, logs=logs)
            divs = st.links()["divisions"]
            self.assertEqual(list(divs), ["6a-d1"])
            self.assertEqual(divs["6a-d1"]["name"], renamed["name"])
            self.assertEqual(divs["6a-d1"]["status"], "ok")
        self.assertTrue(any("renamed" in line for line in logs), logs)

    def test_dropped_bracket_kept(self):
        logs = []
        routes = {LIST_URL: list_html(BY_CODE["5a-d1"]), BASE + BY_CODE["5a-d1"]["url"]: bracket_html("2027-03-20")}
        with Store({"6a-d1": known("6a-d1")}, raw={"6a-d1": OLD_DATED}) as st:
            st.run_day(IN_TERM, routes, logs=logs)
            divs = st.links()["divisions"]
            self.assertEqual(sorted(divs), ["5a-d1", "6a-d1"])
            self.assertEqual(divs["6a-d1"]["status"], "ok")
            self.assertTrue((store.RAW / SEASON / "tx-uil" / "6a-d1.html").exists())
        self.assertTrue(any("no longer listed" in line for line in logs), logs)

    def test_recheck_404_or_empty_keeps_ok(self):
        for response in (NotFound(LIST_URL), "<html>no brackets</html>", http_error(LIST_URL, 503)):
            with self.subTest(response=type(response).__name__):
                with Store({"6a-d1": known("6a-d1")}, raw={"6a-d1": OLD_DATED}) as st:
                    before = st.snapshot()
                    per_run = st.run_day(IN_TERM, {LIST_URL: response})
                    self.assertEqual(all_urls(per_run), [LIST_URL])
                    self.assertEqual(st.links()["status"], "ok")
                    self.assertEqual(st.snapshot(), before)

    def test_slug_collision_not_merged(self):
        other = {"id": "OTHERBRACKETID000000000", "name": "2026 Soccer Conference 6A D1",
                 "url": f"/tournament/{TID}/OTHERBRACKETID000000000/girls-soccer-winter-25-26/other.htm"}
        logs = []
        with Store({"6a-d1": known("6a-d1")}, raw={"6a-d1": OLD_DATED}) as st:
            st.run_day(IN_TERM, {LIST_URL: list_html(BY_CODE["6a-d1"], other)}, logs=logs)
            self.assertEqual(st.links()["divisions"], {"6a-d1": known("6a-d1")})
        self.assertTrue(any("not merged" in line for line in logs), logs)

    def test_replaced_bracket_repointed(self):
        new = {"id": "NEWBRACKETID00000000000", "name": "2026 Soccer Conference 6A D1",
               "url": f"/tournament/{TID}/NEWBRACKETID00000000000/girls-soccer-winter-25-26/new.htm"}
        routes = {LIST_URL: list_html(new), BASE + new["url"]: bracket_html("2027-03-20")}
        with Store({"6a-d1": known("6a-d1")}, raw={"6a-d1": OLD_DATED}) as st:
            per_run = st.run_day(IN_TERM, routes)
            d = st.links()["divisions"]["6a-d1"]
            self.assertEqual((d["bracket"], d["status"]), (new["id"], "ok"))
            self.assertEqual(all_urls(per_run).count(BASE + new["url"]), 1)
        # A complete division is never re-pointed.
        with Store({"6a-d1": known("6a-d1", complete=True)}, raw={"6a-d1": OLD_DATED}) as st:
            per_run = st.run_day(IN_TERM, routes)
            self.assertEqual(st.links()["divisions"]["6a-d1"]["bracket"], BY_CODE["6a-d1"]["id"])
            self.assertEqual(all_urls(per_run), [LIST_URL])


class Failures(unittest.TestCase):
    def test_failed_new_division_falls_back_to_slot(self):
        # 4a-d1 answers 500, 4a-d2 is blocked. A sibling (5a-d1) is in its date window, so the
        # competition is live by dates on every run: the failed ones must still wait for the slot.
        u500, ublk, usib = (BASE + BY_CODE[c]["url"] for c in ("4a-d1", "4a-d2", "5a-d1"))
        routes = {LIST_URL: list_html(*(BY_CODE[c] for c in ("4a-d1", "4a-d2", "5a-d1"))),
                  u500: http_error(u500, 500), ublk: Blocked(ublk), usib: bracket_html("2027-01-20")}
        divs = {"4a-d1": entry_for("4a-d1"), "4a-d2": entry_for("4a-d2"), "5a-d1": known("5a-d1")}
        with Store(divs, raw={"5a-d1": bracket_html("2027-01-20")}) as st:
            day1 = all_urls(st.run_day(IN_TERM, routes))
            self.assertEqual(st.result, 0)
            d = st.links()["divisions"]
            self.assertEqual((d["4a-d1"]["status"], d["4a-d1"]["errorCode"]), ("error", 500))
            self.assertEqual(d["4a-d2"]["status"], "blocked")
            # First attempt (00:00) plus the 06:00 re-check: at most 1 attempt outside the slot.
            self.assertEqual((day1.count(u500), day1.count(ublk)), (2, 2))
            self.assertGreater(day1.count(usib), 20)      # the sibling keeps updating
            day2 = st.run_day(IN_TERM + dt.timedelta(days=1), routes)
            self.assertEqual((all_urls(day2).count(u500), all_urls(day2).count(ublk)), (1, 1))
            self.assertIn(u500, day2["06:00"])

    def test_repeat_failure_is_quiet(self):
        u500 = BASE + BY_CODE["4a-d1"]["url"]
        routes = {LIST_URL: list_html(BY_CODE["4a-d1"]), u500: http_error(u500, 500)}
        with Store({"4a-d1": entry_for("4a-d1", status="error", errorCode=500)}) as st:
            before = st.snapshot()
            per_run = st.run_day(IN_TERM, routes)
            self.assertEqual(all_urls(per_run).count(u500), 1)
            self.assertEqual(st.snapshot(), before)   # no links.json change, no refresh-state.json
        # A new failure (a different code) is not quiet.
        with Store({"4a-d1": entry_for("4a-d1", status="error", errorCode=503)}) as st:
            st.run_day(IN_TERM, routes)
            self.assertTrue((store.ARCHIVE / "refresh-state.json").exists())
            self.assertEqual(st.links()["divisions"]["4a-d1"]["errorCode"], 500)


class ReviewK1K2(unittest.TestCase):
    """Kongming's PR #7 review: K1 (a live bracket must not freeze after one error) and
    K2 (read-time and parse errors must leave a status instead of crashing the run)."""

    def test_live_bracket_error_retried_next_run(self):
        # 5a-d1 is fetched and in its date window, so it is crawled on every run. Its 15th fetch
        # (the 15:00 run) answers 500; the 15:30 run must fetch it again, not wait for 06:00.
        u = BASE + BY_CODE["5a-d1"]["url"]
        html = bracket_html("2027-01-20")
        routes = {LIST_URL: list_html(BY_CODE["5a-d1"]), u: [html] * 14 + [http_error(u, 500)] + [html]}
        with Store({"5a-d1": known("5a-d1")}, raw={"5a-d1": html}) as st:
            per_run = st.run_day(IN_TERM, routes)
            self.assertIn(u, per_run["15:00"])
            self.assertIn(u, per_run["15:30"])
            self.assertEqual(st.links()["divisions"]["5a-d1"]["status"], "ok")

    def test_read_errors_recorded(self):
        # Errors raised while reading the body (not URLError): timeout, reset, IncompleteRead.
        cases = {"4a-d1": TimeoutError("The read operation timed out"),
                 "4a-d2": ConnectionResetError(10054, "reset by peer"),
                 "5a-d1": http.client.IncompleteRead(b"partial")}
        routes = {LIST_URL: list_html(*(BY_CODE[c] for c in cases))}
        routes.update({BASE + BY_CODE[c]["url"]: e for c, e in cases.items()})
        with Store({c: entry_for(c) for c in cases}) as st:
            urls = all_urls(st.run_day(IN_TERM, routes))
            self.assertEqual(st.result, 0)
            for c in cases:
                d = st.links()["divisions"][c]
                self.assertEqual((d["status"], d["errorCode"]), ("error", "network"), c)
                self.assertEqual(urls.count(BASE + BY_CODE[c]["url"]), 2, c)  # first run + the 06:00 retry

    def test_parse_error_recorded(self):
        # Markup the parser can't read (a non-numeric round index) is recorded, not a crash.
        u = BASE + BY_CODE["4a-d1"]["url"]
        bad = '<div class="rounds"><div class="round" data-round-index="first"><ul></ul></div></div>'
        routes = {LIST_URL: list_html(BY_CODE["4a-d1"]), u: bad}
        with Store({"4a-d1": entry_for("4a-d1")}) as st:
            urls = all_urls(st.run_day(IN_TERM, routes))
            self.assertEqual(st.result, 0)
            d = st.links()["divisions"]["4a-d1"]
            self.assertEqual((d["status"], d["errorCode"]), ("error", "parse"))
            self.assertEqual(urls.count(u), 2)
            self.assertFalse((store.RAW / SEASON / "tx-uil" / "4a-d1.html").exists())


class RefreshState(unittest.TestCase):
    def test_crawling_run_writes_refresh_state(self):
        u = BASE + BY_CODE["5a-d1"]["url"]
        routes = {LIST_URL: list_html(BY_CODE["5a-d1"]), u: bracket_html("2027-01-20")}
        with Store({"5a-d1": known("5a-d1")}, raw={"5a-d1": bracket_html("2027-01-20")}) as st:
            st.run_day(IN_TERM, routes)
            state = json.loads((store.ARCHIVE / "refresh-state.json").read_text(encoding="utf-8"))
            self.assertEqual(state["crawled"], [f"{SEASON}/tx-uil/5a-d1"])

    def test_rotation_deterministic(self):
        comps = [f"st{i}" for i in range(8)]
        day = dt.datetime(2027, 1, 20, 6, 0, tzinfo=dt.timezone.utc)
        self.assertEqual(hs.recheck_order(comps, day), hs.recheck_order(list(reversed(comps)), day))
        orders = {tuple(hs.recheck_order(comps, day + dt.timedelta(days=i))) for i in range(7)}
        self.assertGreater(len(orders), 1)


if __name__ == "__main__":
    unittest.main()
