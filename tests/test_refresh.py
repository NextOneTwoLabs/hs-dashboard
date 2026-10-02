"""Live detection and the daily re-check slot (offline; fake fetcher, temp store)."""
import copy
import datetime as dt
import json
import re
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from build_lib import store
from collect import refresh as hs   # #8 PR 3: was crawler/hs.py
from collect.fetch import NotFound

ROOT = Path(__file__).parent.parent
SOURCES = json.loads((ROOT / "public" / "data" / "sources.json").read_text(encoding="utf-8"))
UTC = dt.timezone.utc


def _field(spec, lo, hi):
    out = set()
    for part in spec.split(","):
        step = 1
        if "/" in part:
            part, step = part.split("/")
            step = int(step)
        if part == "*":
            a, b = lo, hi
        elif "-" in part:
            a, b = map(int, part.split("-"))
        else:
            a = b = int(part)
        out.update(range(a, b + 1, step))
    return out


def daily_cron_times():
    """(hour, minute) of every run of the daily crons in refresh.yml (day-of-week '*')."""
    text = (ROOT / ".github" / "workflows" / "refresh.yml").read_text(encoding="utf-8")
    times = set()
    for spec in re.findall(r'cron:\s*"([^"]+)"', text):
        minute, hour, dom, month, dow = spec.split()
        if (dom, month, dow) != ("*", "*", "*"):
            continue  # the weekly discover run
        times.update((h, m) for h in _field(hour, 0, 23) for m in _field(minute, 0, 59))
    return sorted(times)


def runs_on(day):
    return [dt.datetime(day.year, day.month, day.day, h, m, tzinfo=UTC) for h, m in daily_cron_times()]


def in_slot(now):
    slot = SOURCES["refresh"]["recheckSlotUtc"]
    return slot["start"] <= now.strftime("%H:%M") <= slot["end"]


class FakeFetcher:
    def __init__(self):
        self.urls = []

    def get(self, url, host_key):
        self.urls.append(url)
        if "/tournament/list/" in url:
            raise NotFound(url)
        return url, DATELESS


class TempLinks:
    def __init__(self, links, raw=None):
        self.links, self.raw = links, raw or {}

    def __enter__(self):
        self.dir = Path(tempfile.mkdtemp())
        self.patches = [mock.patch.object(store, "RAW", self.dir / "raw"),
                        mock.patch.object(store, "LINKS", self.dir / "links.json")]
        for p in self.patches:
            p.start()
        store.LINKS.write_text(json.dumps(self.links), encoding="utf-8")
        for rel, html in self.raw.items():
            path = store.RAW / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(html, encoding="utf-8")
        return self

    def __exit__(self, *exc):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.dir, ignore_errors=True)


def with_2026_27(**comps):
    sources = copy.deepcopy(SOURCES)
    sources["seasons"]["2026-27"]["competitions"].update(comps)
    return sources


GA = {"tournament": "t-ga", "list": "/tournament/list/t-ga/girls-soccer-spring-27/ga.htm"}
WA = {"tournament": "t-wa", "list": "/tournament/list/t-wa/girls-soccer-26/wa.htm"}
WA_DIV = {"gender": "girls", "maxpreps": "https://www.maxpreps.com/tournament/t-wa/b4a/wa-4a.htm"}
DATELESS = ('<div class="rounds"><div class="round" data-round-index="0"><header class="round-header">'
            '<span class="round-name" title="First Round">First Round</span></header><ul class="matchup-list">'
            '<li id="matchup_00000001-0000-0000-0000-000000000001" class="matchup-container"><div class="matchup">'
            '<ul class="teams"><li class="team" data-school-id="00000001-0000-0000-0000-000000000000">'
            '<span class="name"><a href="/wa/x/x-hawks/soccer/">X</a></span></li></ul></div></li></ul></div></div>')


class RecheckSlot(unittest.TestCase):
    def test_cron_has_a_run_in_recheck_slot(self):
        # If the cron changes, a pending tournament must still be re-checked once a day.
        times = daily_cron_times()
        self.assertTrue(times)
        inside = [t for t in times if in_slot(dt.datetime(2027, 1, 1, *t, tzinfo=UTC))]
        self.assertEqual(len(inside), 1, inside)

    def test_is_live_term_gate(self):
        sources = with_2026_27(**{"ga-ghsa": GA, "wa-wiaa": WA})
        cases = [
            # (competition, links entry, raw files, day, expected live runs that day)
            ("ga-ghsa", None, {}, dt.date(2026, 10, 1), 0),                    # spring state, October
            ("ga-ghsa", None, {}, dt.date(2027, 4, 20), 1),                    # inside its term: once a day
            ("ga-ghsa", {"status": "pending", "divisions": {}}, {}, dt.date(2026, 10, 1), 0),
            ("ga-ghsa", {"status": "pending", "divisions": {}}, {}, dt.date(2027, 4, 20), 1),
            ("wa-wiaa", {"status": "ok", "divisions": {"4a": WA_DIV}},
             {"2026-27/wa-wiaa/4a.html": DATELESS}, dt.date(2026, 11, 1), 1),   # dateless bracket in term
            ("wa-wiaa", {"status": "ok", "divisions": {"4a": WA_DIV}},
             {"2026-27/wa-wiaa/4a.html": DATELESS}, dt.date(2026, 8, 1), 0),    # dateless bracket off-season
        ]
        for comp, entry, raw, day, expected in cases:
            with self.subTest(comp=comp, entry=entry and entry["status"], day=day):
                links = {"2026-27": {comp: entry}} if entry else {}
                with TempLinks(links, raw):
                    ccfg = sources["seasons"]["2026-27"]["competitions"][comp]
                    live = [now for now in runs_on(day)
                            if hs.is_live(sources, links, "2026-27", comp, ccfg, day, now=now)]
                    self.assertEqual(len(live), expected, live)
                    # The list page or bracket is fetched exactly that many times across the day.
                    fetcher = FakeFetcher()
                    crawler = hs.Crawler(sources, fetcher, log=lambda *a: None)
                    for _ in live:
                        crawler.crawl("2026-27", comp, True)
                    self.assertLessEqual(len(fetcher.urls), expected)

    def test_slot_uses_actual_start_time(self):
        # A run that starts late (after the slot) does not re-check; one at 06:00 does.
        sources = with_2026_27(**{"ga-ghsa": GA})
        ccfg = sources["seasons"]["2026-27"]["competitions"]["ga-ghsa"]
        day = dt.date(2027, 4, 20)
        with TempLinks({}):
            on = hs.is_live(sources, {}, "2026-27", "ga-ghsa", ccfg, day, now=dt.datetime(2027, 4, 20, 6, 0, tzinfo=UTC))
            late = hs.is_live(sources, {}, "2026-27", "ga-ghsa", ccfg, day, now=dt.datetime(2027, 4, 20, 6, 41, tzinfo=UTC))
        self.assertEqual((on, late), (True, False))

    def test_dated_brackets_unchanged(self):
        # The existing CA window still decides on its own.
        ccfg = SOURCES["seasons"]["2026-27"]["competitions"]["ca-cif-state"]
        now = dt.datetime(2027, 3, 1, 17, 0, tzinfo=UTC)
        self.assertTrue(hs.is_live(SOURCES, {}, "2026-27", "ca-cif-state", ccfg, now.date(), now=now))


class ScoreOnlyFinal(unittest.TestCase):
    def test_score_only_final_is_not_complete(self):
        html = ('<div class="rounds"><div class="round" data-round-index="0"><header class="round-header">'
                '<span class="round-date"><abbr class="start-date" title="2026-03-03T17:00:00">x</abbr></span>'
                '<span class="round-name" title="Final">Final</span></header><ul class="matchup-list">'
                '<li id="matchup_00000009-0000-0000-0000-000000000001" class="matchup-container"><div class="matchup"><ul class="teams">'
                '<li class="team" data-school-id="00000001-0000-0000-0000-000000000000"><span class="name"><a href="/tx/a/a-hawks/s/">A</a></span><a class="result" href="#">1</a></li>'
                '<li class="team" data-school-id="00000002-0000-0000-0000-000000000000"><span class="name"><a href="/tx/b/b-owls/s/">B</a></span><a class="result" href="#">0</a></li>'
                '</ul></div></li></ul></div></div>')

        class Fetch:
            def get(self, url, host_key):
                return url, html

        with TempLinks({}):
            crawler = hs.Crawler(SOURCES, Fetch(), log=lambda *a: None)
            div = {"maxpreps": "https://www.maxpreps.com/x.htm", "gender": "girls"}
            crawler.crawl_division("2026-27", "tx-uil", "6a-d1", div)
            self.assertIs(div["complete"], False)
            parsed = hs.maxpreps.parse(html)
            self.assertEqual((parsed["games"][0]["winner"], parsed["champion"]), ("top", None))


if __name__ == "__main__":
    unittest.main()
