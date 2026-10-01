"""derive.build_all over saved fixtures, in a temporary store (offline)."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from crawler import derive, store

FIX = Path(__file__).parent / "fixtures" / "html"
FETCHED = "2026-10-01T20:00:00Z"

STATES = {
    "FL": {"name": "Florida", "association": "FHSAA", "associationName": "Florida High School Athletic Association"},
    "GA": {"name": "Georgia", "association": "GHSA", "associationName": "Georgia High School Association"},
    "TX": {"name": "Texas", "association": "UIL", "associationName": "University Interscholastic League"},
}
COMPS = {
    "fl-fhsaa": {"state": "FL", "source": "maxpreps", "term": "winter", "gender": "girls", "label": "FHSAA", "short": "State"},
    "ga-ghsa": {"state": "GA", "source": "maxpreps", "term": "spring", "gender": "girls", "label": "GHSA", "short": "State"},
    "tx-uil": {"state": "TX", "source": "maxpreps", "term": "winter", "gender": "girls", "label": "UIL", "short": "State"},
}


class TempStore:
    """Point every store path at a temp dir and register the given raw fixtures."""

    def __init__(self, brackets):
        self.brackets = brackets  # [(comp, code, label, fixture)]

    def __enter__(self):
        self.dir = Path(tempfile.mkdtemp())
        root = self.dir
        paths = {"ROOT": root, "PUBLIC": root / "public", "ARCHIVE": root / "public" / "archive",
                 "RAW": root / "archive" / "raw", "LINKS": root / "archive" / "links.json",
                 "ALIASES": root / "public" / "data" / "school-aliases.json", "EXPORT": root / "export"}
        self.patches = [mock.patch.object(store, k, v) for k, v in paths.items()]
        for p in self.patches:
            p.start()
        links = {"2025-26": {}}
        for comp, code, label, fixture in self.brackets:
            dest = store.RAW / "2025-26" / comp / f"{code}.html"
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(FIX / fixture, dest)
            entry = links["2025-26"].setdefault(comp, {"status": "ok", "divisions": {}})
            entry["divisions"][code] = {"label": label, "gender": "girls", "fetchedAt": FETCHED, "complete": True}
        store.LINKS.parent.mkdir(parents=True, exist_ok=True)
        store.LINKS.write_text(json.dumps(links), encoding="utf-8")
        comps = sorted({b[0] for b in self.brackets})
        self.sources = {
            "genders": ["g"], "activeSeason": "2026-27", "aliases": {},
            "sources": {"maxpreps": {"base": "https://www.maxpreps.com"}},
            "states": {st: STATES[st] for st in sorted({COMPS[c]["state"] for c in comps})},
            "competitions": {c: COMPS[c] for c in comps},
            "seasons": {"2025-26": {"competitions": {c: {} for c in comps}}},
        }
        return self

    def __exit__(self, *exc):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    def read(self, rel):
        return json.loads((store.ARCHIVE / rel).read_text(encoding="utf-8"))

    def appearances(self, comp, code):
        out = {}
        for path in (store.ARCHIVE / "schools").glob("*.json"):
            s = json.loads(path.read_text(encoding="utf-8"))
            for a in s["appearances"]:
                if a["competition"] == comp and a["division"] == code:
                    out[s["name"]] = a
        return out


def division(ts, st, code):
    cat = ts.read(f"states/{st}/catalog.json")
    return next(d for s in cat["seasons"] for c in s["competitions"] for d in c["divisions"] if d["code"] == code)


class DeriveReviewFixes(unittest.TestCase):
    def test_records_skip_byes_and_no_alive_when_finished(self):
        with TempStore([("ga-ghsa", "a-division-ii", "Class A Division II", "maxpreps_ga_2026_a_div_ii.html"),
                        ("tx-uil", "4a-d2", "Conference 4A D2", "maxpreps_tx_2026_4a_d2.html")]) as ts:
            derive.build_all(ts.sources, warn=lambda m: None)
            treutlen = ts.appearances("ga-ghsa", "a-division-ii")["Treutlen"]
            # Bye in round 1 (no result), then lost 0-2 to Irwin County: one loss, not two.
            self.assertEqual((treutlen["w"], treutlen["l"]), (0, 1))
            self.assertEqual(treutlen["games"][0]["res"], "BYE")
            ga = division(ts, "GA", "a-division-ii")
            self.assertEqual((ga["games"], ga["played"]), (23, 23))
            tx = ts.appearances("tx-uil", "4a-d2")
            self.assertEqual([n for n, a in tx.items() if a["result"] == "alive"], [])
            self.assertEqual(division(ts, "TX", "4a-d2")["played"], 63)

    def test_unreported_last_game_in_finished_bracket(self):
        with TempStore([("tx-uil", "5a-d1", "Conference 5A D1", "maxpreps_tx_2026_5a_d1.html")]) as ts:
            derive.build_all(ts.sources, warn=lambda m: None)
            apps = ts.appearances("tx-uil", "5a-d1")
            self.assertEqual([n for n, a in apps.items() if a["result"] == "alive"], [])
            self.assertEqual(apps["Walnut Grove"]["result"], "unreported")
            self.assertEqual(apps["Colleyville Heritage"]["result"], "eliminated")

    def test_wrong_state_bracket_fails_check(self):
        # A Texas bracket registered under Florida is skipped; --check must report it, not only warn.
        with TempStore([("fl-fhsaa", "1a", "Class 1A", "maxpreps_tx_2026_4a_d2.html")]) as ts:
            changed = derive.build_all(ts.sources, check=True, warn=lambda m: None)
            self.assertTrue(any("wrong state" in c for c in changed), changed[:5])


if __name__ == "__main__":
    unittest.main()
