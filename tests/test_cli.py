"""#8 PR 3: the data-layer move. The new CLI (`python hsdash.py …`) and the old one (`python -m crawler.hs …`, now a
shim) must give byte-identical results while both exist, and the move must not change any published file.

Each run happens in its own temporary copy of the code and the inputs (public/data, archive/), with no
public/archive or export/ to start from, so the two outputs are built from scratch and compared file by file,
then with the committed tree. No network: the fetcher is never reached (a build is offline, and the refresh runs
on a date when nothing is live), and tests/netguard blocks sockets anyway.
"""
import filecmp
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CODE = ["collect", "build_lib", "crawler", "build.py", "hsdash.py", "dev_server.py", "api/__init__.py", "api/routes.py"]
INPUTS = ["public/data", "archive"]
# Written by a crawl, not by a build, so a from-scratch build doesn't produce it.
NOT_BUILT = {"refresh-state.json"}


def copy_tree(dest):
    for rel in CODE + INPUTS:
        src = ROOT / rel
        if not src.exists():
            continue
        (dest / rel).parent.mkdir(parents=True, exist_ok=True)
        if src.is_dir():
            shutil.copytree(src, dest / rel, ignore=shutil.ignore_patterns("__pycache__"))
        else:
            shutil.copy2(src, dest / rel)


def run(cwd, *args):
    env = dict(os.environ, PYTHONPATH=str(ROOT / "tests" / "netguard"), PYTHONDONTWRITEBYTECODE="1")
    return subprocess.run([sys.executable, *args], cwd=cwd, env=env, capture_output=True, text=True, encoding="utf-8")


def files(root):
    return sorted(str(p.relative_to(root)).replace(os.sep, "/") for p in root.rglob("*") if p.is_file())


class CliParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.old, cls.new = Path(cls.tmp.name) / "old", Path(cls.tmp.name) / "new"
        for d in (cls.old, cls.new):
            copy_tree(d)
        cls.old_build = run(cls.old, "-m", "crawler.hs", "--derive", "--export")
        cls.new_build = run(cls.new, "hsdash.py", "build", "--export")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_build_succeeds_with_the_same_output_text(self):
        self.assertEqual(self.old_build.returncode, 0, self.old_build.stderr)
        self.assertEqual(self.new_build.returncode, 0, self.new_build.stderr)
        self.assertEqual(self.new_build.stdout, self.old_build.stdout)
        self.assertEqual(self.new_build.stderr, self.old_build.stderr)

    def test_old_and_new_build_are_byte_identical(self):
        for tree in ("public/archive", "export"):
            a, b = self.old / tree, self.new / tree
            self.assertEqual(files(a), files(b), tree)
            self.assertGreater(len(files(a)), 1 if tree == "export" else 1000, tree)
            match, mismatch, errors = filecmp.cmpfiles(a, b, files(a), shallow=False)
            self.assertEqual((mismatch, errors), ([], []), tree)

    def test_the_move_changes_no_published_file(self):
        for tree in ("public/archive", "export"):
            built, committed = self.new / tree, ROOT / tree
            self.assertEqual(set(files(committed)) - set(files(built)), NOT_BUILT if tree == "public/archive" else set(), tree)
            self.assertEqual(set(files(built)) - set(files(committed)), set(), tree)
            match, mismatch, errors = filecmp.cmpfiles(built, committed, files(built), shallow=False)
            self.assertEqual((mismatch, errors), ([], []), f"{tree}: the committed files and a fresh build differ")

    def test_check_mode_agrees(self):
        # CI's drift check, old and new, on the copies built above: both up to date, same output.
        old, new = run(self.old, "-m", "crawler.hs", "--derive", "--check", "--export"), run(self.new, "hsdash.py", "build", "--check", "--export")
        self.assertEqual((old.returncode, new.returncode), (0, 0), new.stderr)
        self.assertEqual(new.stdout, old.stdout)
        self.assertIn("derived files are up to date", new.stdout)

    def test_an_offline_refresh_leaves_links_and_data_alone(self):
        # Nothing is live on this date, so neither CLI fetches; both end with a build that writes nothing.
        before = (self.new / "archive" / "links.json").read_bytes()
        args = ["--today", "2026-07-15", "--now", "2026-07-15T12:00Z"]
        new = run(self.new, "hsdash.py", "refresh", *args)
        old = run(self.old, "-m", "crawler.hs", "--refresh", *args)
        self.assertEqual((old.returncode, new.returncode), (0, 0), new.stderr)
        self.assertEqual(new.stdout, old.stdout)
        self.assertIn("no competition is live today; nothing to fetch", new.stdout)
        self.assertEqual((self.new / "archive" / "links.json").read_bytes(), before)
        self.assertFalse((self.new / "public" / "archive" / "refresh-state.json").exists(), "a quiet run writes no state")


class Layout(unittest.TestCase):
    def test_subcommands_map_to_the_engine_flags(self):
        sys.path.insert(0, str(ROOT))
        import hsdash
        argv = lambda *a: hsdash.legacy_argv(hsdash.parser().parse_args(list(a)))
        self.assertEqual(argv("build", "--check", "--export"), ["--derive", "--check", "--export"])
        self.assertEqual(argv("refresh", "--export"), ["--refresh", "--export"])
        self.assertEqual(argv("refresh", "--today", "2026-07-15", "--now", "2026-07-15T12:00Z"),
                         ["--refresh", "--today", "2026-07-15", "--now", "2026-07-15T12:00Z"])
        self.assertEqual(argv("backfill", "--export"), ["--backfill", "--export"])
        self.assertEqual(argv("season", "2025-26", "--state", "TX", "--force"), ["--season", "2025-26", "--state", "TX", "--force"])
        self.assertEqual(argv("discover", "2026-27", "--max-requests", "3"), ["--discover", "2026-27", "--max-requests", "3"])

    def test_only_the_shim_is_left_in_crawler(self):
        left = sorted(p.name for p in (ROOT / "crawler").glob("*.py"))
        self.assertEqual(left, ["__init__.py", "hs.py"])
        shim = (ROOT / "crawler" / "hs.py").read_text(encoding="utf-8")
        self.assertIn("from collect.refresh import main", shim)
        # No code outside the shim imports the old package.
        for path in [*ROOT.glob("*.py"), *(ROOT / "collect").glob("*.py"), *(ROOT / "build_lib").glob("*.py"),
                     *(ROOT / "api").glob("*.py"), *(ROOT / "tests").glob("test_*.py")]:
            text = path.read_text(encoding="utf-8")
            self.assertNotRegex(text, r"(?m)^\s*(from crawler\b|import crawler\b)", str(path.relative_to(ROOT)))

    def test_workflows_call_hsdash(self):
        ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
        refresh = (ROOT / ".github" / "workflows" / "refresh.yml").read_text(encoding="utf-8")
        self.assertIn("python hsdash.py build --check --export", ci)
        self.assertIn('python hsdash.py discover "$season"', refresh)
        self.assertIn("python hsdash.py ${{ inputs.mode || 'refresh' }} --export", refresh)
        self.assertNotIn("crawler.hs", ci + refresh)


if __name__ == "__main__":
    unittest.main()
