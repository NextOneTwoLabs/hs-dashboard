"""Parser for MaxPreps tournament bracket pages.

The bracket markup gives, per round, the matchups with both teams' MaxPreps
school GUID, seed, score and a matchwinner/matchloser class, plus the id of
the matchup the winner advances to. Winners are taken from those classes, so
games decided on penalty kicks (equal scores) still resolve correctly.
"""
import re

from . import dom

NULL_GUID = "00000000-0000-0000-0000-000000000000"
_SCORE = re.compile(r"^\s*(\d+)\s*(?:\((\d+)\))?\s*$")
_DIV_OPEN = re.compile(r"<div\b|</div\s*>", re.I)


def _guid(value):
    value = (value or "").strip().lower()
    return None if not value or value == NULL_GUID else value


def trim(html):
    """Keep only the bracket's <div class="rounds"> element (raw provenance
    without ~150 KB of page chrome). Returns None if there is no bracket."""
    start = html.find('<div class="rounds"')
    if start < 0:
        return None
    depth = 0
    for m in _DIV_OPEN.finditer(html, start):
        depth += -1 if m.group(0).startswith("</") else 1
        if depth == 0:
            return html[start:m.end()]
    return None


def school_path(href):
    """'/ca/davis/davis-sr-blue-devils/soccer/winter/25-26/schedule/' ->
    '/ca/davis/davis-sr-blue-devils'."""
    parts = [p for p in (href or "").split("/") if p]
    if len(parts) >= 3 and len(parts[0]) == 2:
        return "/" + "/".join(parts[:3])
    return None


def city_from_path(path):
    if not path:
        return None
    return path.split("/")[2].replace("-", " ").title()


def _team(li):
    name_el = li.find("span", cls="name")
    link = name_el.find("a") if name_el else None
    seed_el = li.find("span", cls="seed")
    result = li.find("a", cls="result")
    score = pk = None
    result_text = result.text() if result else ""
    m = _SCORE.match(result_text)
    if m:
        score = int(m.group(1))
        pk = int(m.group(2)) if m.group(2) else None
    seed_text = seed_el.text() if seed_el else ""
    path = school_path(link.get("href") if link else None)
    return {
        "schoolId": _guid(li.get("data-school-id")),
        "name": name_el.text() if name_el else "",
        "seed": int(seed_text) if seed_text.isdigit() else None,
        "score": score,
        "pk": pk,
        "path": path,
        "won": "matchwinner" in li.classes,
        "lost": "matchloser" in li.classes,
        "matchUrl": result.get("href") if result else None,
    }


def parse(html):
    """Return {"rounds": [...], "games": [...], "champion": {...}|None}."""
    root = dom.parse(html)
    rounds_el = root.find("div", cls="rounds")
    if rounds_el is None:
        raise ValueError("no bracket found")
    rounds, games = [], []
    champion = None
    for r in rounds_el.find_all("div", cls="round"):
        index = int(r.get("data-round-index", len(rounds)))
        name_el = r.find("span", cls="round-name")
        date_el = r.find("abbr", cls="start-date")
        date = (date_el.get("title") or "")[:10] if date_el else None
        rounds.append({
            "index": index,
            "name": (name_el.get("title") or name_el.text()) if name_el else f"Round {index + 1}",
            "date": date or None,
        })
        for li in r.find_all("li", cls="matchup-container"):
            teams_ul = li.find("ul", cls="teams")
            teams = [_team(t) for t in teams_ul.find_all("li", cls="team")] if teams_ul else []
            while len(teams) < 2:
                teams.append(None)
            top, bottom = teams[0], teams[1]
            winner = None
            if top and top["won"]:
                winner = "top"
            elif bottom and bottom["won"]:
                winner = "bottom"
            elif top and top["lost"] and bottom:
                winner = "bottom"
            elif bottom and bottom["lost"] and top:
                winner = "top"
            scored = bool(top and bottom and top["score"] is not None and bottom["score"] is not None)
            decided_by = None
            if scored and top["score"] == bottom["score"] and winner:
                decided_by = "pk"
            elif winner and not scored:
                decided_by = "unreported"
            match_url = next((t["matchUrl"] for t in (top, bottom) if t and t["matchUrl"]), None)
            game = {
                "id": li.get("id", "").replace("matchup_", "").lower() or None,
                "round": index,
                "slot": int(li.get("data-matchup-index", 0)),
                "date": date or None,
                "status": "final" if winner else "scheduled",
                "decidedBy": decided_by,
                "top": _side(top),
                "bottom": _side(bottom),
                "winner": winner,
                "next": _guid(li.get("data-winners-next-matchup-id")),
                "matchUrl": match_url,
            }
            games.append(game)
            box = li.find(cls="championbox")
            if box is not None and winner:
                won = game[winner]
                full = box.find("span", cls="championname")
                champion = {"schoolId": won["schoolId"], "name": won["name"],
                            "fullName": full.text() if full else won["name"]}
    rounds.sort(key=lambda x: x["index"])
    if champion is None and games:
        final = [g for g in games if g["round"] == rounds[-1]["index"] and g["winner"]]
        if len(final) == 1:
            won = final[0][final[0]["winner"]]
            champion = {"schoolId": won["schoolId"], "name": won["name"], "fullName": won["name"]}
    return {"rounds": rounds, "games": games, "champion": champion}


def _side(team):
    if team is None or (not team["name"] and not team["schoolId"]):
        return None
    return {k: team[k] for k in ("schoolId", "name", "seed", "score", "pk", "path")}
