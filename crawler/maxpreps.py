"""Parsers for MaxPreps tournament pages.

The bracket markup gives, per round, the matchups with both teams' MaxPreps
school GUID, seed, score and a matchwinner/matchloser class, plus the id of
the matchup the winner advances to. Winners are taken from those classes or
the "(W)" outcome mark, so games decided on penalty kicks (equal scores) still
resolve correctly; without either, unequal scores decide. Byes come only from
the is-bye class. Each main-bracket winner is then checked against who
actually plays in the next round (see _reconcile), which also corrects
MaxPreps' next-matchup ids where they are wrong.

Large brackets are split into several views: a main view holding two halves,
and a championship view (e.g. Texas "Final Four"). parse() merges them.
"""
import re

from . import dom

NULL_GUID = "00000000-0000-0000-0000-000000000000"
_SCORE = re.compile(r"^\s*(\d+)\s*(?:\((\d+)\))?\s*$")
_DIV_OPEN = re.compile(r"<div\b|</div\s*>", re.I)
_VIEW_START = re.compile(r'<div id="view_[^"]*"[^>]*data-view-id=')
_STRIP = [re.compile(p, re.S) for p in (
    r'<span class="mascotimage"\s*>.*?</span>',
    r'<footer class="matchup-footer"\s*>.*?</footer>',
    r"<img\b[^>]*>",
)]


def _guid(value):
    value = (value or "").strip().lower()
    return None if not value or value == NULL_GUID else value


def _element(html, start):
    depth = 0
    for m in _DIV_OPEN.finditer(html, start):
        depth += -1 if m.group(0).startswith("</") else 1
        if depth == 0:
            return html[start:m.end()]
    return None


def trim(html):
    """Keep only the bracket markup: every bracket view, without page chrome,
    mascot images or link footers. Returns None if there is no bracket."""
    starts = [m.start() for m in _VIEW_START.finditer(html)]
    if not starts:
        start = html.find('<div class="rounds"')
        starts = [start] if start >= 0 else []
    parts = [p for p in (_element(html, s) for s in starts) if p]
    if not parts:
        return None
    out = "\n".join(parts)
    for pattern in _STRIP:
        out = pattern.sub("", out)
    return out


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


def state_from_path(path):
    if not path:
        return None
    return path.split("/")[1].upper()


def _team(li):
    name_el = li.find("span", cls="name")
    link = name_el.find("a") if name_el else None
    seed_el = li.find("span", cls="seed")
    result = li.find("a", cls="result")
    score = pk = None
    m = _SCORE.match(result.text() if result else "")
    if m:
        score = int(m.group(1))
        pk = int(m.group(2)) if m.group(2) else None
    seed_text = seed_el.text() if seed_el else ""
    outcome = li.find("span", cls="outcome")
    return {
        "schoolId": _guid(li.get("data-school-id")),
        "name": name_el.text() if name_el else "",
        "seed": int(seed_text) if seed_text.isdigit() else None,
        "score": score,
        "pk": pk,
        "path": school_path(link.get("href") if link else None),
        "won": "matchwinner" in li.classes,
        "lost": "matchloser" in li.classes,
        # "(W)" after a tied score marks the shootout winner; it agrees with matchwinner where both exist.
        "outcomeWon": bool(outcome and outcome.text().strip() == "(W)"),
        "matchUrl": result.get("href") if result else None,
    }


def _winner(top, bottom):
    """(side, source) from MaxPreps' own markers, or (None, None).

    Sources: "marker" (matchwinner/matchloser), "outcome" (the "(W)" span),
    "score" (no marker, unequal scores). When both teams are marked as losers
    (seen in a PK game and on every bye) the markers say nothing."""
    if top and top["won"] and not (bottom and bottom["won"]):
        return "top", "marker"
    if bottom and bottom["won"] and not (top and top["won"]):
        return "bottom", "marker"
    if top and top["outcomeWon"] and not (bottom and bottom["outcomeWon"]):
        return "top", "outcome"
    if bottom and bottom["outcomeWon"] and not (top and top["outcomeWon"]):
        return "bottom", "outcome"
    if top and bottom and top["lost"] != bottom["lost"]:
        return ("bottom" if top["lost"] else "top"), "marker"
    if top and bottom and top["score"] is not None and bottom["score"] is not None and top["score"] != bottom["score"]:
        return ("top" if top["score"] > bottom["score"] else "bottom"), "score"
    return None, None


def _decided_by(game):
    top, bottom = game["top"], game["bottom"]
    scored = bool(top and bottom and top["score"] is not None and bottom["score"] is not None)
    if not game["winner"]:
        return None
    if not scored:
        return "unreported"
    return "pk" if top["score"] == bottom["score"] else None


def _reconcile(games, warnings):
    """Check each main-bracket winner against who actually plays in the next round.

    Matching is by school GUID only, and only main games are used (placement
    views keep their own local round indices). The team found in the next
    round wins over MaxPreps' markers and the score; `next` is pointed at the
    game that team plays in. Disagreements are reported in `warnings`."""
    main = [g for g in games if "place" not in g]
    by_round = {}
    for g in main:
        by_round.setdefault(g["round"], []).append(g)
    for g in main:
        later = by_round.get(g["round"] + 1)
        if not later or g["status"] == "bye":
            continue
        where = f"round {g['round'] + 1} game {g['slot'] + 1}"
        sides = [s for s in ("top", "bottom") if g[s]]
        if any(not g[s]["schoolId"] for s in sides):
            if g["winner"] is None:
                continue
            warnings.append(f"{where}: a team has no school id; winner not checked")
            continue
        found = {}
        for s in sides:
            sid = g[s]["schoolId"]
            for nxt in later:
                if sid in [(nxt[k] or {}).get("schoolId") for k in ("top", "bottom")]:
                    found[s] = nxt
        if len(found) != 1:
            if len(found) == 2:
                warnings.append(f"{where}: both teams appear in the next round; winner not changed")
            continue
        side, nxt = next(iter(found.items()))
        name = g[side]["name"]
        if g["winner"] is None:
            warnings.append(f"{where}: no winner marked; {name} plays in the next round, so {name} won")
            g["winner"], g["_from"], g["status"] = side, "advancer", "final"
        elif g["winner"] != side:
            warnings.append(f"{where}: {g[g['winner']]['name']} is marked the winner, "
                            f"but {name} plays in the next round; using {name}")
            g["winner"], g["_from"] = side, "advancer"
        top, bottom = g["top"], g["bottom"]
        if (top and bottom and top["score"] is not None and bottom["score"] is not None
                and top["score"] != bottom["score"] and (top["score"] > bottom["score"]) != (side == "top")):
            warnings.append(f"{where}: {name} advanced despite the lower score; scores kept")
        g["decidedBy"] = _decided_by(g)
        g["next"] = nxt["id"]


def _side(team):
    if team is None or (not team["name"] and not team["schoolId"]):
        return None
    return {k: team[k] for k in ("schoolId", "name", "seed", "score", "pk", "path")}


def parse(html):
    """Return {"rounds": [...], "games": [...], "champion": {...}|None}.

    Views are merged in document order. The halves of a split bracket share
    round indices, with the second half's games slotted after the first's, and
    a championship view's rounds follow the main view's. Views for another
    place (e.g. a third-place game) keep their games, marked with "place"."""
    root = dom.parse(html)
    views = [n for n in root.find_all("div") if n.get("data-view-id")]
    # Play-in games come before the main bracket, a championship view after it.
    views.sort(key=lambda v: 0 if "play-in" in (v.get("data-view-type") or "")
               else 2 if "championship" in (v.get("data-view-type") or "") else 1)
    if not views:
        if root.find("div", cls="rounds") is None:
            raise ValueError("no bracket found")
        views = [root]
    rounds, games = {}, []
    champion = None
    offset = 0
    for view in views:
        try:
            place = int(view.get("data-place", "1"))
        except ValueError:
            place = 1
        main = place in (-1, 1)
        play_in = "play-in" in (view.get("data-view-type") or "")
        base = offset if main else 0
        slots = {}
        local_max = -1
        for r in view.find_all("div", cls="round"):
            local = int(r.get("data-round-index", 0))
            local_max = max(local_max, local)
            index = base + local
            name_el = r.find("span", cls="round-name")
            date_el = r.find("abbr", cls="start-date")
            date = ((date_el.get("title") or "")[:10] if date_el else None) or None
            if main:
                name = (name_el.get("title") or name_el.text()) if name_el else ""
                if play_in and (not name or re.fullmatch(r"Round \d+", name)):
                    name = "Play-in"
                entry = rounds.setdefault(index, {"index": index, "name": name or f"Round {index + 1}",
                                                  "date": date})
                if date and (entry["date"] is None or date < entry["date"]):
                    entry["date"] = date
            for li in r.find_all("li", cls="matchup-container"):
                teams_ul = li.find("ul", cls="teams")
                teams = [_team(t) for t in teams_ul.find_all("li", cls="team")] if teams_ul else []
                while len(teams) < 2:
                    teams.append(None)
                top, bottom = teams[0], teams[1]
                slot = slots.get(index, 0)
                slots[index] = slot + 1
                game = {
                    "id": li.get("id", "").replace("matchup_", "").lower() or None,
                    "round": index,
                    "slot": slot,
                    "date": date,
                    "status": "scheduled",
                    "decidedBy": None,
                    "top": _side(top),
                    "bottom": _side(bottom),
                    "winner": None,
                    "next": _guid(li.get("data-winners-next-matchup-id")),
                    "matchUrl": next((t["matchUrl"] for t in (top, bottom) if t and t["matchUrl"]), None),
                }
                present = [s for s in ("top", "bottom") if game[s]]
                if "is-bye" in li.classes and len(present) == 1:
                    # Only MaxPreps' own is-bye marks a bye: a one-team game without it is still waiting.
                    game.update(status="bye", winner=present[0], _from="bye")
                else:
                    winner, source = _winner(top, bottom)
                    if winner and game[winner] is None:
                        winner = source = None
                    if winner:
                        game.update(status="final", winner=winner, _from=source)
                        game["decidedBy"] = _decided_by(game)
                if not main:
                    game["place"] = place
                box = li.find(cls="championbox")
                if box is not None and main:
                    full = box.find("span", cls="championname")
                    game["_box"] = full.text() if full else ""
                games.append(game)
        if main:
            offset = base + local_max + 1
    rounds = [rounds[i] for i in sorted(rounds)]
    warnings = []
    _reconcile(games, warnings)
    # A champion needs the champion box, a winner marker or "(W)". A winner taken from the
    # score alone never makes one: the bracket would be marked complete and never refetched.
    champion = None
    for g in games:
        if "_box" in g and g["winner"] and g["status"] == "final" and (g.get("_from") != "score" or g["_box"].strip()):
            won = g[g["winner"]]
            champion = {"schoolId": won["schoolId"], "name": won["name"], "fullName": g["_box"] or won["name"]}
    if champion is None and rounds:
        final = [g for g in games if g["round"] == rounds[-1]["index"] and g["status"] == "final"
                 and g["winner"] and "place" not in g]
        if len(final) == 1 and final[0].get("_from") in ("marker", "outcome"):
            won = final[0][final[0]["winner"]]
            champion = {"schoolId": won["schoolId"], "name": won["name"], "fullName": won["name"]}
    for g in games:
        g.pop("_from", None)
        g.pop("_box", None)
    return {"rounds": rounds, "games": games, "champion": champion, "warnings": warnings}


_TOURNAMENT = re.compile(r'href="(/tournament/list/([A-Za-z0-9_-]+)/([a-z0-9-]+)/[^"]+\.htm)"[^>]*>\s*([^<]+?)\s*<')


def parse_index(html):
    """Tournaments on a season index page (e.g. /tournament/girls-soccer-25.htm)."""
    seen, out = set(), []
    for url, tid, season_slug, title in _TOURNAMENT.findall(html):
        if tid in seen:
            continue
        seen.add(tid)
        out.append({"id": tid, "title": dom.parse(title).text(), "url": url.replace("&amp;", "&"),
                    "seasonSlug": season_slug})
    return out


def parse_tournament(html, tid):
    """Brackets listed on a tournament page: [{id, name, url}] in page order."""
    pattern = re.compile(r'href="(/tournament/' + re.escape(tid)
                         + r'/([A-Za-z0-9_-]+)/[^"]+\.htm)"[^>]*>\s*([^<]+?)\s*<')
    seen, out = set(), []
    for url, bid, name in pattern.findall(html):
        if bid in seen:
            continue
        seen.add(bid)
        out.append({"id": bid, "name": dom.parse(name).text(), "url": url.replace("&amp;", "&")})
    return out
