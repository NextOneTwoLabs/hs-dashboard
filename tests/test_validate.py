"""#8 PR 4: JSON Schemas for every published file kind, and `hsdash.py validate` with its cross-checks.

- Every schema is Draft 2020-12, loads, and has a document kind; every /api/v1 route's file has a schema.
- One INVALID fixture per schema (tests/fixtures/schema-invalid/<kind>.json) must fail, at the place it says, and
  pass once that one thing is fixed, so a schema that accepts everything (or rejects everything) can't pass.
  The eight built kinds have a second one, <kind>.meta.json, with one `_meta` defect (#8 PR 5).
- The committed files validate, and so does a build written to a temp directory (not only the committed tree).
- Each cross-check catches the mistake it is for, on an otherwise valid copy of the committed files.

Offline: schemas resolve their `common.schema.json` refs from schema/ only, and tests/netguard blocks sockets.
Needs `jsonschema` (requirements-dev.txt), like CI.
"""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from build_lib import store, validate  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures" / "schema-invalid"
BASE = "https://hs-dashboard.local/schema/"
# The kinds a build writes: each requires `_meta` (status and sources are not built).
META_KINDS = ["bracket", "catalog", "games", "school", "schools", "search-index", "state-catalog", "states"]


def set_pointer(doc, pointer, value):
    parts = [p.replace("~1", "/").replace("~0", "~") for p in pointer.lstrip("/").split("/")]
    node = doc
    for part in parts[:-1]:
        node = node[int(part)] if isinstance(node, list) else node[part]
    last = parts[-1]
    if isinstance(node, list):
        node[int(last)] = value
    else:
        node[last] = value


class Schemas(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schemas = validate.load_schemas()
        cls.checkers = validate.validators(cls.schemas)

    def test_every_schema_is_draft_2020_12_with_its_own_id(self):
        self.assertGreaterEqual(len(self.schemas), 11)
        for name, schema in self.schemas.items():
            self.assertEqual(schema["$schema"], validate.DRAFT, name)
            self.assertEqual(schema["$id"], f"{BASE}{name}.schema.json", name)
            self.assertTrue(schema.get("title") and schema.get("description"), f"{name}: says what it is")

    def test_one_schema_per_document_kind(self):
        self.assertEqual(sorted(set(self.schemas) - {"common"}), validate.document_kinds())

    def test_every_api_route_file_has_a_schema(self):
        rows = json.loads((ROOT / "tests" / "routes.json").read_text(encoding="utf-8"))
        rows = rows["routes"]
        assets = sorted({r["asset"] for r in rows if r.get("asset")})
        self.assertTrue(assets)
        for asset in assets:
            if asset == "/data/sources.json":
                continue
            self.assertTrue(asset.startswith("/archive/"), asset)
            self.assertIsNotNone(validate.kind_of(asset[len("/archive/"):]), asset)

    def test_the_api_docs_list_every_schema(self):
        docs = (ROOT / "docs" / "data-api.md").read_text(encoding="utf-8")
        table = docs[docs.index("| Schema | Files |"):].split("\n\n")[0]
        names = sorted(row.split("|")[1].strip().strip("`") for row in table.splitlines()[2:])
        self.assertEqual(names, validate.document_kinds())

    def test_meta_source_is_the_registry(self):
        sources = store.load_json(store.SOURCES)
        self.assertEqual(self.schemas["common"]["$defs"]["metaSource"]["enum"], sorted(sources["sources"]))

    def test_built_kinds_require_meta(self):
        for kind in META_KINDS:
            schema = self.schemas[kind]
            self.assertIn("_meta", schema["required"], kind)
            want = "fetchMeta" if kind == "bracket" else "buildMeta"
            self.assertEqual(schema["properties"]["_meta"], {"$ref": f"common.schema.json#/$defs/{want}"}, kind)
        for kind in ("status", "sources"):
            self.assertNotIn("_meta", self.schemas[kind].get("required", []), kind)
            self.assertNotIn("_meta", self.schemas[kind].get("properties", {}), kind)

    def test_refs_resolve_locally_only(self):
        # A schema that refers outside schema/ fails to resolve instead of being fetched.
        from referencing.exceptions import Unresolvable
        probe = {"$schema": validate.DRAFT, "$id": f"{BASE}probe.schema.json",
                 "$ref": "https://example.invalid/elsewhere.schema.json"}
        checkers = validate.validators({**self.schemas, "probe": probe})
        with self.assertRaises(Unresolvable):
            list(checkers["probe"].iter_errors({}))


class InvalidFixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.checkers = validate.validators()

    def test_one_fixture_per_document_kind(self):
        # <kind>.json for every kind; <kind>.meta.json (one `_meta` defect) for the eight built kinds.
        names = [p.name for p in FIXTURES.glob("*.json")]
        self.assertEqual(sorted(n for n in names if n.count(".") == 1), [f"{k}.json" for k in validate.document_kinds()])
        self.assertEqual(sorted(n for n in names if n.endswith(".meta.json")), [f"{k}.meta.json" for k in META_KINDS])

    def test_each_fixture_fails_where_it_says_and_passes_once_fixed(self):
        for path in sorted(FIXTURES.glob("*.json")):
            kind = path.name.split(".")[0]
            with self.subTest(fixture=path.name):
                fx = json.loads(path.read_text(encoding="utf-8"))
                checker = self.checkers[kind]
                errors = list(checker.iter_errors(fx["document"]))
                self.assertTrue(errors, f"{path.name} must be rejected: {fx['why']}")
                for e in errors:
                    self.assertTrue(e.json_path.startswith(fx["errorAt"]),
                                    f"{path.name}: unexpected error at {e.json_path}: {e.message}")
                if "message" in fx:
                    self.assertTrue(any(fx["message"] in e.message for e in errors),
                                    f"{path.name}: no error says {fx['message']!r}")
                fixed = copy.deepcopy(fx["document"])
                set_pointer(fixed, fx["fix"]["at"], fx["fix"]["value"])
                self.assertEqual([e.message for e in checker.iter_errors(fixed)], [],
                                 f"{path.name}: valid once {fx['fix']['at']} is fixed")


class CommittedAndFreshTrees(unittest.TestCase):
    def test_committed_files_validate(self):
        self.assertEqual(validate.validate_archive(store.ARCHIVE), [])

    def test_a_fresh_build_in_a_temp_directory_validates(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "archive"
            self.assertEqual(validate.validate_fresh(into=out), [])
            built = [p for p in out.rglob("*.json")]
            committed = [p for p in store.ARCHIVE.rglob("*.json") if p.name != "refresh-state.json"]
            self.assertEqual(len(built), len(committed), "the temp build is a whole build")
            self.assertFalse((out / "refresh-state.json").exists(), "a build writes no crawl status")

    def test_cli(self):
        env = dict(os.environ, PYTHONPATH=str(ROOT / "tests" / "netguard"), PYTHONDONTWRITEBYTECODE="1")
        r = subprocess.run([sys.executable, "hsdash.py", "validate"], cwd=ROOT, env=env,
                           capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("is valid", r.stdout)
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "stray.txt").write_text("x", encoding="utf-8")
            r = subprocess.run([sys.executable, "hsdash.py", "validate", "--archive", tmp], cwd=ROOT, env=env,
                               capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(r.returncode, 1)
        self.assertIn("stray.txt: not a published file kind", r.stderr)
        self.assertIn("catalog.json: missing", r.stderr)

    def test_ci_runs_validate_on_the_committed_tree_and_a_fresh_build(self):
        ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        self.assertIn("python -m pip install -r requirements-dev.txt", ci)
        self.assertIn("python hsdash.py validate\n", ci)
        self.assertIn("python hsdash.py validate --fresh", ci)
        reqs = (ROOT / "requirements-dev.txt").read_text(encoding="utf-8")
        pins = [line.split("#")[0].strip() for line in reqs.splitlines() if line.split("#")[0].strip()]
        self.assertTrue(any(p.startswith("jsonschema==") for p in pins))
        for pin in pins:
            self.assertRegex(pin, r"^[A-Za-z0-9_.-]+==[0-9][0-9A-Za-z.]*$", "every dev dependency is pinned")

    def test_the_build_and_crawler_stay_stdlib_only(self):
        for rel in ["build.py", "build_lib/store.py", "build_lib/divisions.py", *[f"collect/{p.name}" for p in (ROOT / "collect").glob("*.py")]]:
            src = (ROOT / rel).read_text(encoding="utf-8")
            self.assertNotIn("jsonschema", src, rel)
            self.assertNotIn("referencing", src, rel)


class CrossChecks(unittest.TestCase):
    """Each check on an otherwise valid copy of the committed files: only the edited document is copied."""

    @classmethod
    def setUpClass(cls):
        cls.docs, problems = validate.read_tree(store.ARCHIVE)
        assert not problems, problems
        cls.sources = store.load_json(store.SOURCES)
        cls.merge = (store.load_json(store.ALIASES, {}) or {}).get("merge", {})
        cls.TX = "brackets/2025-26/tx-uil/6a-d1.json"

    def run_checks(self, docs=None, sources=None):
        return validate.cross_checks(docs or self.docs, sources or self.sources, self.merge)

    def edit(self, rel, fn):
        docs = dict(self.docs)
        docs[rel] = copy.deepcopy(docs[rel])
        fn(docs[rel])
        return docs

    def assertCaught(self, problems, *needles):
        text = "\n".join(problems)
        for needle in needles:
            self.assertIn(needle, text)

    def test_the_committed_files_pass(self):
        self.assertEqual(self.run_checks(), [])

    def test_bracket_next_must_be_a_later_game_in_the_same_bracket(self):
        self.assertCaught(self.run_checks(self.edit(self.TX, lambda b: b["games"][0].update(next="not-a-game"))),
                          "next not-a-game is not a game in this bracket")
        def backwards(b):
            later = next(g for g in b["games"] if g["round"] == 1)
            later["next"] = b["games"][0]["id"]
        self.assertCaught(self.run_checks(self.edit(self.TX, backwards)), "is not in a later round")

    def test_bracket_ids_rounds_and_byes(self):
        def dup(b):
            b["games"][1]["id"] = b["games"][0]["id"]
        self.assertCaught(self.run_checks(self.edit(self.TX, dup)), "is used 2 times")
        self.assertCaught(self.run_checks(self.edit(self.TX, lambda b: b["games"][0].update(round=9))),
                          "round 9 is not in rounds")
        self.assertCaught(self.run_checks(self.edit(self.TX, lambda b: b["games"][0].update(status="bye"))),
                          "a bye must have exactly one team")

    def test_the_champion_won_the_final(self):
        def runner_up(b):
            final = [g for g in b["games"] if g["round"] == b["rounds"][-1]["index"]][0]
            loser = final["bottom" if final["winner"] == "top" else "top"]
            b["champion"] = {"schoolId": loser["schoolId"], "name": loser["name"], "fullName": loser["name"]}
        self.assertCaught(self.run_checks(self.edit(self.TX, runner_up)), "did not win a final-round game")

    def test_a_bracket_lives_at_its_own_path(self):
        docs = dict(self.docs)
        docs["brackets/2025-26/tx-uil/6a-d9.json"] = docs.pop(self.TX)
        self.assertCaught(self.run_checks(docs), "brackets/2025-26/tx-uil/6a-d9.json: its content is " + self.TX)

    def test_catalog_divisions_agree_with_their_brackets(self):
        def played(c):
            c["seasons"][0]["competitions"][0]["divisions"][0]["played"] -= 1
        self.assertCaught(self.run_checks(self.edit("states/TX/catalog.json", played)), "played is 62, the bracket says 63",
                          "catalog.json: 2025-26 competitions differ from the state catalogs")
        def drop(c):
            c["seasons"][0]["competitions"][0]["divisions"].pop(0)
        self.assertCaught(self.run_checks(self.edit("states/TX/catalog.json", drop)), "listed 0 times in the state catalogs")

    def test_states_index_agrees_with_catalogs_and_directories(self):
        def count(s):
            next(r for r in s["states"] if r["code"] == "TX")["schools"] += 1
        self.assertCaught(self.run_checks(self.edit("states.json", count)), "states.json: TX schools 385, its directory has 384")

    def test_directories_and_search_index_add_up(self):
        self.assertCaught(self.run_checks(self.edit("schools.json", lambda d: d.update(count=d["count"] + 1))),
                          "schools.json: count 1338, 1337 rows")
        self.assertCaught(self.run_checks(self.edit("states/TX/schools.json", lambda d: d["schools"].pop())),
                          "states/TX/schools.json: count 384, 383 rows", "rows are not schools.json's TX rows")
        self.assertCaught(self.run_checks(self.edit("search-index.json", lambda d: d["rows"][0].__setitem__(1, "Renamed"))),
                          "search-index.json: rows are not schools.json's")

    def test_a_school_adds_up_and_plays_in_its_brackets(self):
        rel = "schools/bdb0b593-ef7f-4c69-8c2a-e0a48c934ca7.json"   # Los Gatos
        self.assertCaught(self.run_checks(self.edit(rel, lambda s: s["summary"].update(titles=3))), "summary")
        def elsewhere(s):
            s["appearances"][0]["division"] = "gd1"
        self.assertCaught(self.run_checks(self.edit(rel, elsewhere)), "the school does not play in that bracket")

    def test_games_feeds_hold_the_brackets_games(self):
        rel = "states/TX/seasons/2025-26/games.json"
        self.assertCaught(self.run_checks(self.edit(rel, lambda f: f["games"].pop())),
                          f"{rel}: {len(self.docs[rel]['games']) - 1} games, the brackets have {len(self.docs[rel]['games'])}",
                          "seasons/2025-26/games.json: not the 2025-26 state feeds combined")
        def stranger(f):
            f["games"][0]["top"]["id"] = "zzz-not-a-school"
        self.assertCaught(self.run_checks(self.edit(rel, stranger)), "(zzz-not-a-school) has no school file")

    def test_meta_agrees_with_the_document(self):
        def asof(b):
            b["_meta"]["asOf"] = "2020-01-01T00:00:00Z"
        self.assertCaught(self.run_checks(self.edit(self.TX, asof)), f"{self.TX}: _meta is")
        rel = "schools/bdb0b593-ef7f-4c69-8c2a-e0a48c934ca7.json"   # Los Gatos
        def school_url(s):
            s["_meta"]["url"] = "https://www.maxpreps.com/x"
        self.assertCaught(self.run_checks(self.edit(rel, school_url)), f"{rel}: _meta is")
        def base(c):
            c["_meta"]["url"] = "https://example.com"
        self.assertCaught(self.run_checks(self.edit("catalog.json", base)), "catalog.json: _meta is")

    def test_sources_registry_is_consistent(self):
        sources = copy.deepcopy(self.sources)
        sources["seasons"]["2026-27"]["competitions"]["xx-nowhere"] = {"path": "x"}
        self.assertCaught(self.run_checks(sources=sources), "2026-27 lists xx-nowhere, which is not registered")

    def test_schema_errors_skip_the_cross_checks(self):
        docs = self.edit(self.TX, lambda b: b.update(season="2025"))
        problems = validate.validate_documents(docs, self.sources, {"merge": self.merge})
        self.assertTrue(problems[0].startswith(self.TX + ": $.season:"), problems[0])
        self.assertEqual(problems[-1], "cross-checks skipped: 1 file(s) failed their schema")


if __name__ == "__main__":
    unittest.main()
