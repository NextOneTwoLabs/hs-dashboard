import re
import unittest
from pathlib import Path

from crawler import cif, discover, divisions, maxpreps

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
        self.assertTrue(self.html.startswith('<div id="view_'))
        self.assertTrue(self.html.endswith("</div>"))
        self.assertNotIn("<img", self.html)
        self.assertLess(len(self.html), 30_000)

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


def raw(name):
    return re.sub(r"^(?:<!--.*?-->\s*)+", "", read(name), flags=re.S)


class MultiViewBrackets(unittest.TestCase):
    def test_texas_halves_and_championship_view_merge(self):
        b = maxpreps.parse(raw("maxpreps_tx_2026_6a_d1.html"))
        self.assertEqual([r["name"] for r in b["rounds"]],
                         ["Bi-District", "Area", "Regional Semifinals", "Regional Finals",
                          "State Semifinals", "State Finals"])
        per_round = [sum(1 for g in b["games"] if g["round"] == i) for i in range(6)]
        self.assertEqual(per_round, [32, 16, 8, 4, 2, 1])
        self.assertEqual(b["champion"]["name"], "Round Rock")
        by_id = {g["id"]: g for g in b["games"]}
        for g in b["games"]:
            if g["next"]:
                self.assertEqual(by_id[g["next"]]["round"], g["round"] + 1)
        # Slots are unique per round, second half after the first.
        for i in range(6):
            slots = sorted(g["slot"] for g in b["games"] if g["round"] == i)
            self.assertEqual(slots, list(range(len(slots))))

    def test_play_in_view_comes_first(self):
        b = maxpreps.parse(raw("maxpreps_wa_2025_3a.html"))
        self.assertEqual([r["name"] for r in b["rounds"]],
                         ["Play-in", "First Round", "Quarterfinals", "Semifinals", "Finals"])
        self.assertEqual(sum(1 for g in b["games"] if g["round"] == 0), 4)
        self.assertEqual(b["champion"]["name"], "Bellevue")


class MaxPrepsListings(unittest.TestCase):
    def test_tournament_brackets(self):
        found = maxpreps.parse_tournament(read("maxpreps_tx_2026_list.html"), "8y9aX16M0U-dwDYbnzV5Jw")
        self.assertEqual(len(found), 6)
        self.assertIn("2026 Soccer Conference 6A D1", [b["name"] for b in found])

    def test_season_index(self):
        found = maxpreps.parse_index(read("maxpreps_index_spring_26.html"))
        titles = [t["title"] for t in found]
        self.assertIn("2026 GHSA State Girls Soccer Championships (Georgia)", titles)
        self.assertTrue(all(t["seasonSlug"] == "girls-soccer-spring-26" for t in found))


class Divisions(unittest.TestCase):
    def test_labels_and_codes(self):
        cases = {
            "2026 Soccer Conference 6A D1": ("Conference 6A D1", "6a-d1"),
            "Class 7A Tournament": ("Class 7A", "7a"),
            "1B/2B": ("1B/2B", "1b-2b"),
            "7A Girls Soccer Playoffs": ("7A", "7a"),
            "A-3A Girls": ("A-3A", "a-3a"),
        }
        for name, (label, code) in cases.items():
            self.assertEqual(divisions.clean_label(name), label)
            self.assertEqual(divisions.code_for(label), code)
        self.assertEqual(divisions.clean_label("2026 GHSA Girls 6A", drop=["GHSA"]), "6A")

    def test_order(self):
        labels = ["1A", "Conference 6A D2", "1B/2B", "Conference 6A D1", "1A-3A", "4A", "Division 2", "Division 1"]
        ordered = sorted(labels, key=divisions.order_key)
        self.assertEqual(ordered[:2], ["Conference 6A D1", "Conference 6A D2"])
        self.assertLess(ordered.index("4A"), ordered.index("1A-3A"))
        self.assertLess(ordered.index("1A-3A"), ordered.index("1A"))
        self.assertLess(ordered.index("1A"), ordered.index("1B/2B"))
        self.assertLess(ordered.index("Division 1"), ordered.index("Division 2"))


class Discovery(unittest.TestCase):
    def test_state_guess(self):
        self.assertEqual(discover.guess_state("2026 GHSA State Girls Soccer Championships (Georgia)")[0], "GA")
        self.assertEqual(discover.guess_state("2026 UIL Texas Girls Soccer State Championships")[0], "TX")
        self.assertEqual(discover.guess_state("2025 PIAA Girls Soccer Championships")[0], "PA")
        self.assertEqual(discover.guess_state("2025 DCSAA Girls Soccer State Tournament: Washington, DC")[0], "DC")
        self.assertIsNone(discover.guess_state("2026 Girls Soccer Championships")[0])
        self.assertTrue(discover.EXCLUDE.search("2026 VISAA State Girls Soccer Tournament"))

    def test_index_slugs(self):
        self.assertEqual(discover.index_slugs("2025-26"), {
            "fall": "girls-soccer-25", "winter": "girls-soccer-winter-25-26", "spring": "girls-soccer-spring-26"})


if __name__ == "__main__":
    unittest.main()
