import unittest
from pathlib import Path

from crawler import cif, maxpreps

FIX = Path(__file__).parent / "fixtures" / "html"
BASE = "https://www.cifstate.org/sports/soccer/"


def read(name):
    return (FIX / name).read_text(encoding="utf-8")


def team(name, seed, score, cls, sid):
    return (f'<li class="team {cls}" data-school-id="{sid}"><span class="seed">{seed}</span>'
            f'<span class="name"><a href="/ca/town/{name.lower()}-hawks/soccer/winter/25-26/schedule/">{name}</a></span>'
            f'<a class="result" href="https://www.maxpreps.com/x">{score}</a></li>')


def bracket(*matchups):
    items = "".join(
        f'<li data-matchup-index="{i}" id="matchup_{i:08d}-0000-0000-0000-000000000001" class="matchup-container">'
        f'<div class="matchup"><ul class="teams">{m}</ul></div></li>' for i, m in enumerate(matchups))
    return ('<div class="rounds"><div class="round" data-round-index="0"><header class="round-header">'
            '<span class="round-date"><abbr class="start-date" title="2026-03-03T17:00:00">Mar 3</abbr></span>'
            f'<span class="round-name" title="Final">Final</span></header><ul class="matchup-list">{items}</ul></div></div>')


class DivisionCodes(unittest.TestCase):
    def test_variants(self):
        self.assertEqual(cif.division_code("bd1"), "bd1")
        self.assertEqual(cif.division_code("boysd1"), "bd1")
        self.assertEqual(cif.division_code("GD3"), "gd3")
        self.assertEqual(cif.division_code("girls-div-5"), "gd5")
        self.assertIsNone(cif.division_code("index"))
        self.assertIsNone(cif.division_code("bd10"))


class CifPages(unittest.TestCase):
    def test_state_index(self):
        found = cif.parse_index(read("cif_state_2026_index.html"), "brkts_2026", BASE)
        self.assertEqual(list(found), ["bd1", "bd2", "bd3", "bd4", "bd5", "gd1", "gd2", "gd3", "gd4", "gd5"])
        self.assertEqual(found["gd2"], BASE + "brkts_2026/gd2")

    def test_regional_index_with_irregular_slug(self):
        found = cif.parse_index(read("cif_socal_2022_index.html"), "SoCal_brkts_2022", BASE)
        self.assertEqual(found["bd1"], BASE + "SoCal_brkts_2022/boysd1")
        self.assertEqual(len(found), 10)

    def test_division_widget_link(self):
        link = cif.parse_division(read("cif_state_2026_bd1.html"))
        self.assertTrue(link.startswith("https://www.maxpreps.com/tournament/view.aspx?tournamentid="))
        self.assertIsNone(cif.parse_division("<html><body>no widget</body></html>"))


class MaxPrepsBracket(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = maxpreps.trim(read("maxpreps_2026_bd1.html"))
        cls.b = maxpreps.parse(cls.html)

    def test_trim_keeps_only_bracket(self):
        self.assertTrue(self.html.startswith('<div class="rounds"'))
        self.assertTrue(self.html.endswith("</div>"))
        self.assertLess(len(self.html), 60_000)

    def test_rounds(self):
        self.assertEqual([r["name"] for r in self.b["rounds"]],
                         ["Round I", "Regional Semifinals", "Regional Finals", "State Final"])
        self.assertEqual(self.b["rounds"][0]["date"], "2026-03-03")

    def test_games_and_champion(self):
        self.assertEqual(len(self.b["games"]), 15)
        self.assertEqual(self.b["champion"]["name"], "Mater Dei")
        self.assertEqual(self.b["champion"]["fullName"], "Mater Dei Monarchs")
        final = [g for g in self.b["games"] if g["round"] == 3][0]
        self.assertEqual(final["winner"], "bottom")
        self.assertIsNone(final["next"])
        first = self.b["games"][0]
        self.assertEqual(first["top"]["path"], "/ca/davis/davis-sr-blue-devils")
        self.assertEqual(first["next"], "66719792-004c-48e1-9838-9fedbd365d27")
        self.assertTrue(all(g["status"] == "final" for g in self.b["games"]))

    def test_pk_winner_from_class_not_score(self):
        b = maxpreps.parse(bracket(team("Alpha", 1, "1", "matchloser", "a" * 8 + "-0000-0000-0000-000000000000")
                                   + team("Beta", 2, "1", "matchwinner", "b" * 8 + "-0000-0000-0000-000000000000")))
        g = b["games"][0]
        self.assertEqual((g["winner"], g["decidedBy"]), ("bottom", "pk"))

    def test_score_with_pk_in_parens(self):
        b = maxpreps.parse(bracket(team("Alpha", 1, "2 (4)", "matchwinner", "a" * 8 + "-0000-0000-0000-000000000000")
                                   + team("Beta", 2, "2 (3)", "matchloser", "b" * 8 + "-0000-0000-0000-000000000000")))
        g = b["games"][0]
        self.assertEqual((g["top"]["score"], g["top"]["pk"]), (2, 4))
        self.assertEqual(g["decidedBy"], "pk")

    def test_unplayed_matchup(self):
        b = maxpreps.parse(bracket(team("Alpha", 1, "", "", "a" * 8 + "-0000-0000-0000-000000000000")))
        g = b["games"][0]
        self.assertEqual(g["status"], "scheduled")
        self.assertIsNone(g["bottom"])
        self.assertIsNone(g["winner"])
        self.assertIsNone(b["champion"])

    def test_no_bracket(self):
        self.assertIsNone(maxpreps.trim("<html></html>"))
        with self.assertRaises(ValueError):
            maxpreps.parse("<div></div>")


if __name__ == "__main__":
    unittest.main()
