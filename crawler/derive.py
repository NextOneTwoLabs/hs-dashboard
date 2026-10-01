"""Build every served file under public/archive from archive/raw.

Pure function of (sources.json, archive/links.json, archive/raw/**, school
aliases): no network and no wall-clock timestamps, so CI can rebuild it and
fail on drift.
"""
import csv
import io
import re

from . import cif, maxpreps, store

SCHEMA = 1
_HEADER = re.compile(r"^(?:<!--.*?-->\s*)+", re.S)


def _school_ref(side):
    if not side:
        return None
    return {"id": side["schoolId"], "name": side["name"], "seed": side["seed"]}


def _school_key(side, merge):
    sid = side.get("schoolId")
    if not sid and side.get("path"):
        sid = side["path"].strip("/").replace("/", "-")
    return merge.get(sid, sid) if sid else None


def load_brackets(sources, links):
    """Yield normalized bracket dicts in registry order."""
    genders = sources.get("genders", ["b", "g"])
    for season, scfg in sources["seasons"].items():
        for comp_id in scfg["competitions"]:
            entry = links.get(season, {}).get(comp_id, {})
            for code, div in sorted(entry.get("divisions", {}).items()):
                if code[0] not in genders:
                    continue
                raw = store.RAW / season / comp_id / f"{code}.html"
                if not raw.exists():
                    continue
                html = _HEADER.sub("", raw.read_text(encoding="utf-8"))
                parsed = maxpreps.parse(html)
                yield {
                    "schema": SCHEMA,
                    "season": season,
                    "competition": comp_id,
                    "division": {"code": code, "gender": "boys" if code[0] == "b" else "girls",
                                 "level": int(code[2:]), "label": cif.division_label(code)},
                    "source": {"cif": div.get("cif"), "maxpreps": div.get("canonical") or div.get("maxpreps"),
                               "fetchedAt": div.get("fetchedAt")},
                    "champion": parsed["champion"],
                    "rounds": parsed["rounds"],
                    "games": parsed["games"],
                }


def _outcome(game, side):
    mine, theirs = game[side], game["bottom" if side == "top" else "top"]
    if game["status"] != "final":
        return None
    won = game["winner"] == side
    if game["decidedBy"] == "pk":
        return "D", ("W" if won else "L")
    return ("W" if won else "L"), None


def build_all(sources, check=False, export=False):
    links = store.load_json(store.LINKS, {}) or {}
    aliases = store.load_json(store.ALIASES, {}) or {}
    merge = aliases.get("merge", {})
    out = {}
    brackets = list(load_brackets(sources, links))

    schools = {}
    season_games = {}
    catalog_seasons = {s: {"season": s, "note": cfg.get("note"), "competitions": []}
                       for s, cfg in sources["seasons"].items()}
    comp_index = {}

    for b in brackets:
        season, comp, code = b["season"], b["competition"], b["division"]["code"]
        out[f"brackets/{season}/{comp}/{code}.json"] = b
        rounds = {r["index"]: r for r in b["rounds"]}
        last_round = max(rounds) if rounds else 0

        # Catalog entry.
        key = (season, comp)
        if key not in comp_index:
            comp_meta = sources["competitions"][comp]
            comp_index[key] = {"id": comp, "label": comp_meta["label"], "short": comp_meta["short"],
                               "divisions": []}
            catalog_seasons[season]["competitions"].append(comp_index[key])
        finals = [g for g in b["games"] if g["round"] == last_round and g["status"] == "final"]
        runner = None
        if b["champion"] and finals:
            g = finals[0]
            runner = _school_ref(g["bottom" if g["winner"] == "top" else "top"])
        played = sum(1 for g in b["games"] if g["status"] == "final")
        dates = [r["date"] for r in b["rounds"] if r["date"]]
        comp_index[key]["divisions"].append({
            **b["division"],
            "games": len(b["games"]), "played": played,
            "status": "complete" if b["champion"] else ("in-progress" if played else "scheduled"),
            "champion": {"id": b["champion"]["schoolId"], "name": b["champion"]["name"]} if b["champion"] else None,
            "runnerUp": {"id": runner["id"], "name": runner["name"]} if runner else None,
            "start": min(dates) if dates else None, "end": max(dates) if dates else None,
        })

        # Flat season game list (Results tab).
        for g in b["games"]:
            season_games.setdefault(season, []).append({
                "id": g["id"], "competition": comp, "division": code, "round": g["round"],
                "roundName": rounds.get(g["round"], {}).get("name"), "date": g["date"],
                "status": g["status"], "decidedBy": g["decidedBy"], "winner": g["winner"],
                "top": _game_side(g["top"], merge), "bottom": _game_side(g["bottom"], merge),
            })

        # School appearances.
        per_school = {}
        for g in sorted(b["games"], key=lambda x: (x["round"], x["slot"])):
            for side in ("top", "bottom"):
                team = g[side]
                if not team:
                    continue
                sid = _school_key(team, merge)
                if not sid:
                    continue
                s = schools.setdefault(sid, {"id": sid, "names": {}, "path": None, "fullName": None,
                                             "appearances": []})
                s["names"][season] = team["name"]
                s["path"] = team["path"] or s["path"]
                app = per_school.get(sid)
                if app is None:
                    app = per_school[sid] = {
                        "season": season, "competition": comp, "division": code, "seed": team["seed"],
                        "rounds": last_round + 1, "w": 0, "l": 0, "d": 0, "gf": 0, "ga": 0, "games": []}
                    s["appearances"].append(app)
                other = g["bottom" if side == "top" else "top"]
                res = _outcome(g, side)
                row = {"round": g["round"], "roundName": rounds.get(g["round"], {}).get("name"),
                       "date": g["date"], "opp": _game_side(other, merge),
                       "gf": team["score"], "ga": other["score"] if other else None,
                       "res": res[0] if res else None, "pk": res[1] if res else None}
                app["games"].append(row)
                if res:
                    app[res[0].lower()] += 1
                    app["gf"] += team["score"] or 0
                    app["ga"] += (other["score"] if other else 0) or 0
        if b["champion"]:
            cid = merge.get(b["champion"]["schoolId"], b["champion"]["schoolId"])
            if cid in schools:
                schools[cid]["fullName"] = b["champion"]["fullName"]

        for sid, app in per_school.items():
            last = app["games"][-1]
            app["reachedRound"] = last["round"]
            app["reached"] = last["roundName"]
            if last["res"] is None:
                app["result"] = "alive"
            elif last["round"] == last_round and (last["res"] == "W" or last["pk"] == "W"):
                app["result"] = "champion"
            elif last["round"] == last_round:
                app["result"] = "runner-up"
            elif last["res"] == "W" or last["pk"] == "W":
                app["result"] = "alive"
            else:
                app["result"] = "eliminated"
            # 0..1 progress through the bracket, for the history chart.
            app["depth"] = round((last["round"] + (1 if app["result"] == "champion" else 0)) / app["rounds"], 3)

    directory = []
    for sid, s in sorted(schools.items(), key=lambda kv: kv[0]):
        latest_season = max(s["names"])
        name = s["names"][latest_season]
        apps = sorted(s["appearances"], key=lambda a: (a["season"], a["competition"]))
        titles = sum(1 for a in apps if a["result"] == "champion")
        best = max(apps, key=lambda a: (a["depth"], a["season"]))
        summary = {"appearances": len(apps), "titles": titles,
                   "finals": sum(1 for a in apps if a["result"] in ("champion", "runner-up")),
                   "w": sum(a["w"] for a in apps), "l": sum(a["l"] for a in apps),
                   "d": sum(a["d"] for a in apps)}
        city = maxpreps.city_from_path(s["path"])
        out[f"schools/{sid}.json"] = {
            "schema": SCHEMA, "id": sid, "name": name, "fullName": s["fullName"], "city": city,
            "maxpreps": (sources["sources"]["maxpreps"]["base"] + s["path"]) if s["path"] else None,
            "summary": summary,
            "best": {k: best[k] for k in ("season", "competition", "division", "result", "reached")},
            "appearances": apps,
        }
        directory.append({"id": sid, "name": name, "city": city,
                          "gender": sorted({a["division"][0] for a in apps}),
                          "apps": len(apps), "titles": titles,
                          "last": apps[-1]["season"]})
    out["schools.json"] = {"schema": SCHEMA, "count": len(directory), "schools": directory}

    for season, games in season_games.items():
        games.sort(key=lambda g: (g["date"] or "", g["competition"], g["division"], g["round"]))
        out[f"seasons/{season}/games.json"] = {"schema": SCHEMA, "season": season, "games": games}

    seasons_with_data = [s for s in catalog_seasons.values() if s["competitions"]]
    out["catalog.json"] = {
        "schema": SCHEMA,
        "activeSeason": sources["activeSeason"],
        "latestSeason": max((s["season"] for s in seasons_with_data), default=None),
        "genders": sources.get("genders", ["b", "g"]),
        "competitions": sources["competitions"],
        "seasons": sorted(catalog_seasons.values(), key=lambda s: s["season"], reverse=True),
    }

    files = {store.ARCHIVE / rel: store.dumps(obj) for rel, obj in out.items()}
    if export:
        for b in brackets:
            files[store.EXPORT / b["season"] / f"{b['competition']}-{b['division']['code']}.csv"] = _csv(b)

    changed = []
    # Prune derived files that are no longer produced (e.g. a gender switched off).
    for sub in ("brackets", "schools", "seasons"):
        for path in sorted((store.ARCHIVE / sub).rglob("*.json")):
            if path not in files:
                changed.append(str(path.relative_to(store.ROOT)) + " (stale)")
                if not check:
                    path.unlink()
    for path, text in sorted(files.items()):
        if check:
            try:
                same = path.read_text(encoding="utf-8") == text
            except FileNotFoundError:
                same = False
            if not same:
                changed.append(str(path.relative_to(store.ROOT)))
        elif store.write_text(path, text):
            changed.append(str(path.relative_to(store.ROOT)))
    return changed


def _game_side(side, merge):
    if not side:
        return None
    return {"id": _school_key(side, merge), "name": side["name"], "seed": side["seed"],
            "score": side["score"]}


def _csv(b):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    names = {r["index"]: r["name"] for r in b["rounds"]}
    w.writerow(["season", "competition", "division", "round", "round_name", "date", "status",
                "decided_by", "top_seed", "top_school", "top_score", "bottom_seed", "bottom_school",
                "bottom_score", "winner"])
    for g in b["games"]:
        t, o = g["top"] or {}, g["bottom"] or {}
        w.writerow([b["season"], b["competition"], b["division"]["code"], g["round"], names.get(g["round"]),
                    g["date"], g["status"], g["decidedBy"] or "", t.get("seed"), t.get("name"), t.get("score"),
                    o.get("seed"), o.get("name"), o.get("score"), g["winner"] or ""])
    return buf.getvalue()
