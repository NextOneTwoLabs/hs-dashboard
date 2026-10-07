"""#36: the team's two agent seats live in the repo (.claude/agents/), so they survive session restarts.

kongming (the Reviewer) is pinned to Opus. yide (the Engineer) has no `model:` key: the TPM picks the model per task
from the issue's tier label. The frontmatter is simple `key: value` lines, parsed by hand (no YAML dependency).
"""
import unittest
from pathlib import Path

AGENTS = Path(__file__).resolve().parent.parent / ".claude" / "agents"


def frontmatter(name):
    path = AGENTS / f"{name}.md"
    assert path.is_file(), f"missing {path}"
    lines = path.read_text(encoding="utf-8").splitlines()
    assert lines and lines[0] == "---", f"{name}: file must start with '---'"
    end = lines.index("---", 1)
    fields = {}
    for line in lines[1:end]:
        key, sep, value = line.partition(":")
        assert sep, f"{name}: bad frontmatter line {line!r}"
        fields[key.strip()] = value.strip()
    return fields


class AgentSeatsTest(unittest.TestCase):
    def test_files_exist(self):
        for name in ("kongming", "yide"):
            self.assertTrue((AGENTS / f"{name}.md").is_file(), name)

    def test_names_match_and_have_description(self):
        for name in ("kongming", "yide"):
            fm = frontmatter(name)
            self.assertEqual(fm.get("name"), name)
            self.assertTrue(fm.get("description"), f"{name}: description is empty")

    def test_kongming_is_pinned_to_opus(self):
        self.assertEqual(frontmatter("kongming").get("model"), "opus")

    def test_yide_has_no_model_key(self):
        self.assertNotIn("model", frontmatter("yide"))


if __name__ == "__main__":
    unittest.main()
