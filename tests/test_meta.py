"""#8 PR 5: `_meta` provenance on every built file.

- CommittedTree: every built file has `_meta` right after `schema`; a bracket's `_meta` is its fetch (the same
  URL and time the raw file's header and archive/links.json hold); every other document has `asOf: null`.
- RefreshChurn: a refetch of one bracket changes exactly the files it changes without `_meta` (the raw file,
  links.json, the bracket). A document built from several brackets carries no fetch time, so no catalog, feed or
  directory moves with it; and `_meta` never makes a file change on its own.

Offline: stdlib only, in a temp copy of the committed tree; tests/netguard blocks sockets.
"""
import html
import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import build  # noqa: E402
from build_lib import store  # noqa: E402
from collect import refresh  # noqa: E402

META_KEYS = ["source", "url", "asOf"]
STATUS = "refresh-state.json"
TX = "brackets/2025-26/tx-uil/6a-d1.json"


def read_tree(archive):
    return {p.relative_to(archive).as_posix(): json.loads(p.read_text(encoding="utf-8"))
            for p in sorted(archive.rglob("*.json"))}


class CommittedTree(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.docs = read_tree(store.ARCHIVE)
        cls.built = {rel: d for rel, d in cls.docs.items() if rel != STATUS}
        cls.sources = store.load_json(store.SOURCES)
        cls.base = cls.sources["sources"]["maxpreps"]["base"]
        cls.links = store.load_json(store.LINKS)

    def test_every_built_file_has_meta_second(self):
        self.assertGreater(len(self.built), 1400)
        for rel, doc in self.built.items():
            self.assertEqual(list(doc)[:2], ["schema", "_meta"], rel)
            self.assertEqual(list(doc["_meta"]), META_KEYS, rel)
            self.assertEqual(doc["_meta"]["source"], "maxpreps", rel)
        self.assertNotIn("_meta", self.docs[STATUS], "the crawl status is the freshness record")

    def test_bracket_meta_is_its_fetch(self):
        brackets = {rel: d for rel, d in self.built.items() if rel.startswith("brackets/")}
        self.assertEqual(len(brackets), 99)
        for rel, b in brackets.items():
            self.assertEqual(b["_meta"], {"source": "maxpreps", "url": b["source"]["maxpreps"],
                                          "asOf": b["source"]["fetchedAt"]}, rel)
            season, comp, code = rel[len("brackets/"):-len(".json")].split("/")
            div = self.links[season][comp]["divisions"][code]
            self.assertEqual(b["_meta"]["url"], div.get("canonical") or div.get("maxpreps"), rel)
            self.assertEqual(b["_meta"]["asOf"], div["fetchedAt"], rel)
            raw = (store.RAW / season / comp / f"{code}.html").read_text(encoding="utf-8")
            head_source = re.search(r"^<!-- source: (.*?) -->$", raw, re.M).group(1)
            head_fetched = re.search(r"^<!-- fetched: (.*?) -->$", raw, re.M).group(1)
            self.assertEqual(b["_meta"]["url"], html.unescape(head_source), rel)
            self.assertEqual(b["_meta"]["asOf"], head_fetched, rel)

    def test_built_documents_carry_no_fetch_time(self):
        others = {rel: d for rel, d in self.built.items() if not rel.startswith("brackets/")}
        self.assertGreater(len(others), 1300)
        for rel, d in others.items():
            self.assertIsNone(d["_meta"]["asOf"], rel)
            if rel.startswith("schools/"):
                self.assertEqual(d["_meta"]["url"], d["maxpreps"], rel)
            else:
                self.assertEqual(d["_meta"]["url"], self.base, rel)

    def test_school_appearances_name_their_bracket_and_carry_no_meta(self):
        schools = {rel: d for rel, d in self.built.items() if rel.startswith("schools/")}
        self.assertEqual(len(schools), 1337)
        for rel, s in schools.items():
            for a in s["appearances"]:
                for key in ("_meta", "asOf", "fetchedAt"):
                    self.assertNotIn(key, a, rel)
                bracket = self.built[f"brackets/{a['season']}/{a['competition']}/{a['division']}.json"]
                self.assertIsNotNone(bracket["_meta"]["asOf"], rel)

    def test_search_index_stays_slim(self):
        doc = self.built["search-index.json"]
        self.assertEqual(list(doc), ["schema", "_meta", "fields", "rows"])
        self.assertEqual(doc["fields"], ["id", "name", "city", "state", "apps", "titles"])
        self.assertTrue(all(len(row) == 6 for row in doc["rows"]))


class RefreshChurn(unittest.TestCase):
    """A refetch of one bracket, then a rebuild, in a temp copy of the committed tree."""

    NOW = "2026-10-08T12:00:00Z"

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        (self.tmp / "public").mkdir()
        shutil.copytree(ROOT / "archive", self.tmp / "archive")
        shutil.copytree(ROOT / "export", self.tmp / "export")
        shutil.copytree(ROOT / "public" / "data", self.tmp / "public" / "data")
        shutil.copytree(ROOT / "public" / "archive", self.tmp / "public" / "archive")
        paths = {"ROOT": self.tmp, "PUBLIC": self.tmp / "public", "ARCHIVE": self.tmp / "public" / "archive",
                 "RAW": self.tmp / "archive" / "raw", "LINKS": self.tmp / "archive" / "links.json",
                 "SOURCES": self.tmp / "public" / "data" / "sources.json",
                 "ALIASES": self.tmp / "public" / "data" / "school-aliases.json", "EXPORT": self.tmp / "export"}
        for key, value in paths.items():
            patch = mock.patch.object(store, key, value)
            patch.start()
            self.addCleanup(patch.stop)
        self.sources = store.load_json(store.SOURCES)
        self.warn = lambda msg: None
        self.assertEqual(build.build_all(self.sources, export=True, warn=self.warn), [],
                         "the committed tree is current")
        self.before = self.snapshot()

    def snapshot(self):
        return {p.relative_to(self.tmp).as_posix(): p.read_bytes()
                for p in sorted(self.tmp.rglob("*")) if p.is_file()}

    def changed(self):
        after = self.snapshot()
        return {rel for rel in after.keys() | self.before.keys() if after.get(rel) != self.before.get(rel)}

    def test_refetching_one_bracket_changes_the_same_files_as_today(self):
        div = store.load_json(store.LINKS)["2025-26"]["tx-uil"]["divisions"]["6a-d1"]
        raw = (store.RAW / "2025-26" / "tx-uil" / "6a-d1.html").read_text(encoding="utf-8")
        body = refresh._HEADER.sub("", raw)

        class Fake:
            def get(self, url, host):
                return div["canonical"], body

        crawler = refresh.Crawler(self.sources, Fake(), force=True, log=lambda *a: None)
        with mock.patch.object(refresh, "now_iso", return_value=self.NOW):
            crawler.crawl_division("2025-26", "tx-uil", "6a-d1",
                                   crawler.links["2025-26"]["tx-uil"]["divisions"]["6a-d1"])
        build.build_all(self.sources, export=True, warn=self.warn)
        self.assertEqual(self.changed(), {"archive/raw/2025-26/tx-uil/6a-d1.html", "archive/links.json",
                                          "public/archive/" + TX})
        bracket = json.loads((store.ARCHIVE / TX).read_text(encoding="utf-8"))
        self.assertEqual(bracket["_meta"]["asOf"], self.NOW)
        self.assertEqual(bracket["_meta"]["url"], div["canonical"])

    def test_meta_never_adds_a_changed_file(self):
        # A guard (it passes without `_meta` too): a content change moves only files whose content changed.
        links = store.load_json(store.LINKS)
        entry = links["2025-26"]["tx-uil"]["divisions"]["6a-d1"]
        entry.update(label="Conference 6A D1 (test)", fetchedAt=self.NOW)
        store.write_json(store.LINKS, links)
        build.build_all(self.sources, export=True, warn=self.warn)
        after = self.snapshot()

        def bare(data):
            doc = json.loads(data)
            doc.pop("_meta", None)
            return doc

        moved = [rel for rel in self.changed() if rel.startswith("public/archive/") and rel.endswith(".json")]
        self.assertIn("public/archive/" + TX, moved)
        for rel in moved:
            self.assertNotEqual(bare(after[rel]), bare(self.before[rel]), f"{rel} changed only by _meta")


if __name__ == "__main__":
    unittest.main()
