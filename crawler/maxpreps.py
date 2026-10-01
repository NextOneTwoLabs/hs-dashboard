"""Parsers for MaxPreps tournament pages.

The bracket markup gives, per round, the matchups with both teams' MaxPreps
school GUID, seed, score and a matchwinner/matchloser class, plus the id of
the matchup the winner advances to. Winners are taken from those classes, so
games decided on penalty kicks (equal scores) still resolve correctly.

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
    return {
        "schoolId": _guid(li.get("data-school-id")),
        "name": name_el.text() if name_el else "",
        "seed": int(seed_text) if seed_text.isdigit() else None,
        "score": score,
        "pk": pk,
        "path": school_path(link.get("href") if link else None),
        "won": "matchwinner" in li.classes,
        "lost": "matchloser" in li.classes,
        "matchUrl": result.get("href") if result else None,
    }


def _winner(top, bottom):
    if top and top["won"]:
        return "top"
    if bottom and bottom["won"]:
        return "bottom"
    if top and top["lost"] and bottom:
        return "bottom"
    if bottom and bottom["lost"] and top:
        return "top"
    return None


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
                winner = _winner(top, bottom)
                scored = bool(top and bottom and top["score"] is not None and bottom["score"] is not None)
                decided_by = None
                if scored and top["score"] == bottom["score"] and winner:
                    decided_by = "pk"
                elif winner and not scored:
                    decided_by = "unreported"
                slot = slots.get(index, 0)
                slots[index] = slot + 1
                game = {
                    "id": li.get("id", "").replace("matchup_", "").lower() or None,
                    "round": index,
                    "slot": slot,
                    "date": date,
                    "status": "final" if winner else "scheduled",
                    "decidedBy": decided_by,
                    "top": _side(top),
                    "bottom": _side(bottom),
                    "winner": winner,
                    "next": _guid(li.get("data-winners-next-matchup-id")),
                    "matchUrl": next((t["matchUrl"] for t in (top, bottom) if t and t["matchUrl"]), None),
                }
                if not main:
                    game["place"] = place
                games.append(game)
                box = li.find(cls="championbox")
                if box is not None and winner and main:
                    won = game[winner]
                    full = box.find("span", cls="championname")
                    champion = {"schoolId": won["schoolId"], "name": won["name"],
                                "fullName": full.text() if full else won["name"]}
        if main:
            offset = base + local_max + 1
    rounds = [rounds[i] for i in sorted(rounds)]
    if champion is None and rounds:
        final = [g for g in games if g["round"] == rounds[-1]["index"] and g["winner"] and "place" not in g]
        if len(final) == 1:
            won = final[0][final[0]["winner"]]
            champion = {"schoolId": won["schoolId"], "name": won["name"], "fullName": won["name"]}
    return {"rounds": rounds, "games": games, "champion": champion}


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
