"""Build every served file under public/archive from archive/raw (#8 PR 3: was crawler/derive.py).

Run it as `python hsdash.py build [--check] [--export]` (the old `python -m crawler.hs --derive` still works).

Pure function of (sources.json, archive/links.json, archive/raw/**, school
aliases): no network and no wall-clock timestamps, so CI can rebuild it and
fail on drift.

Outputs (all schema 1 unless noted):
  catalog.json                         every state's seasons -> competitions -> divisions
  states.json                          coverage index, one row per state
  states/<ST>/catalog.json             one state's catalog
  states/<ST>/schools.json             one state's school directory
  states/<ST>/seasons/<season>/games.json
  seasons/<season>/games.json          all states (kept for the original v1 route)
  brackets/<season>/<comp>/<div>.json  normalized bracket
  schools.json                         full school directory (all states)
  schools/<id>.json                    one school's appearances
  search-index.json                    compact rows for the header search

Every file carries `_meta` {source, url, asOf} right after `schema` (#8 PR 5). A bracket's is its fetch (the
MaxPreps page and when); a document built from several brackets has `asOf: null`, so a refetch of one bracket
changes that bracket's files only.
"""
import csv
import io
import re
import sys
from collections import Counter

from build_lib import divisions, store
from collect import maxpreps   # the bracket-page parser: the build reads raw MaxPreps views

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


def _bracket_state(games):
    states = Counter()
    for g in games:
        for side in ("top", "bottom"):
            st = maxpreps.state_from_path((g[side] or {}).get("path"))
            if st:
                states[st] += 1
    return states.most_common(1)[0][0] if states else None


def load_brackets(sources, links, warn=None, errors=None):
    """Yield normalized bracket dicts in registry order.

    Problems that make a registered bracket disappear from the site are
    appended to `errors` (so --check fails); parser notes go to `warn`."""
    genders = {"boys" if g == "b" else "girls" for g in sources.get("genders", ["b", "g"])}
    for season, scfg in sources["seasons"].items():
        for comp_id in scfg["competitions"]:
            meta = sources["competitions"][comp_id]
            entry = links.get(season, {}).get(comp_id, {})
            for code, div in sorted(entry.get("divisions", {}).items()):
                gender = div.get("gender") or divisions.cif_division(code)[0]
                if gender not in genders:
                    continue
                raw = store.RAW / season / comp_id / f"{code}.html"
                if not raw.exists():
                    continue
                parsed = maxpreps.parse(_HEADER.sub("", raw.read_text(encoding="utf-8")))
                if meta["source"] == "maxpreps":
                    found = _bracket_state(parsed["games"])
                    if found and found != meta["state"]:
                        msg = (f"skipped {season}/{comp_id}/{code}: wrong state, schools are in {found}, "
                               f"expected {meta['state']}")
                        if warn:
                            warn(msg)
                        if errors is not None:
                            errors.append(msg)
                        continue
                if warn:
                    for note in parsed["warnings"]:
                        warn(f"{season}/{comp_id}/{code}: {note}")
                # A game whose date had passed when we fetched it, with both teams set
                # but no result, was never reported by the source.
                fetched = (div.get("fetchedAt") or "")[:10]
                for g in parsed["games"]:
                    if (g["status"] == "scheduled" and g["top"] and g["bottom"] and g["date"]
                            and fetched and g["date"] < fetched):
                        g["status"] = "unreported"
                label = div.get("label") or divisions.cif_division(code)[1]
                yield {
                    "schema": SCHEMA,
                    "season": season,
                    "state": meta["state"],
                    "competition": comp_id,
                    "division": {"code": code, "gender": gender, "label": label},
                    "source": {"cif": div.get("cif"), "maxpreps": div.get("canonical") or div.get("maxpreps"),
                               "fetchedAt": div.get("fetchedAt")},
                    "champion": parsed["champion"],
                    "rounds": parsed["rounds"],
                    "games": parsed["games"],
                }


def _outcome(game, side):
    # Byes and unplayed games add nothing to a record.
    if game["status"] != "final":
        return None
    won = game["winner"] == side
    if game["decidedBy"] == "pk":
        return "D", ("W" if won else "L")
    return ("W" if won else "L"), None


def _shown(path):
    """A path for messages: relative to the repo, or as is outside it (a temp build)."""
    try:
        return str(path.relative_to(store.ROOT))
    except ValueError:
        return str(path)


def build_all(sources, check=False, export=False, warn=None, archive=None):
    """`archive` writes the served files somewhere else than public/archive, e.g. a temp directory for
    `hsdash.py validate --fresh` (#8 PR 4). The inputs are always the repo's."""
    warn = warn or (lambda msg: print("warning: " + msg, file=sys.stderr))
    archive = archive or store.ARCHIVE
    links = store.load_json(store.LINKS, {}) or {}
    aliases = store.load_json(store.ALIASES, {}) or {}
    merge = aliases.get("merge", {})
    out = {}
    errors = []
    brackets = list(load_brackets(sources, links, warn, errors))

    schools = {}
    games_by = {}            # (state, season) -> games
    catalog = {}             # state -> season -> {season, note, competitions:[...]}
    comp_index = {}

    for st in sources["states"]:
        catalog[st] = {}
        for season, scfg in sources["seasons"].items():
            note = (scfg.get("notes") or {}).get(st)
            if note:
                catalog[st][season] = {"season": season, "note": note, "competitions": []}

    for b in brackets:
        season, st, comp, code = b["season"], b["state"], b["competition"], b["division"]["code"]
        out[f"brackets/{season}/{comp}/{code}.json"] = b
        main_games = [g for g in b["games"] if "place" not in g]
        rounds = {r["index"]: r for r in b["rounds"]}
        last_round = max(rounds) if rounds else 0

        key = (season, comp)
        if key not in comp_index:
            meta = sources["competitions"][comp]
            comp_index[key] = {"id": comp, "state": st, "label": meta["label"], "short": meta["short"],
                               "term": meta.get("term"), "divisions": []}
            catalog[st].setdefault(season, {"season": season, "note": None, "competitions": []})
            catalog[st][season]["competitions"].append(comp_index[key])
        finals = [g for g in main_games if g["round"] == last_round and g["status"] == "final"]
        runner = None
        if b["champion"] and finals:
            g = finals[0]
            runner = _school_ref(g["bottom" if g["winner"] == "top" else "top"])
        played = sum(1 for g in b["games"] if g["status"] == "final")
        # A bracket is finished once it has a champion or nothing is left to play.
        finished = bool(b["champion"]) or not any(g["status"] == "scheduled" for g in main_games)
        dates = [r["date"] for r in b["rounds"] if r["date"]]
        comp_index[key]["divisions"].append({
            **b["division"],
            "games": sum(1 for g in b["games"] if g["status"] != "bye"), "played": played,
            "status": ("complete" if b["champion"]
                       else "unreported" if any(g["status"] == "unreported" for g in main_games)
                       and not any(g["status"] == "scheduled" for g in main_games)
                       else "in-progress" if played else "scheduled"),
            "champion": {"id": b["champion"]["schoolId"], "name": b["champion"]["name"]} if b["champion"] else None,
            "runnerUp": {"id": runner["id"], "name": runner["name"]} if runner else None,
            "start": min(dates) if dates else None, "end": max(dates) if dates else None,
        })

        for g in b["games"]:
            if g["status"] == "bye":
                continue  # not a game: the results feed skips it
            games_by.setdefault((st, season), []).append({
                "id": g["id"], "state": st, "competition": comp, "division": code,
                "divisionLabel": b["division"]["label"], "gender": b["division"]["gender"], "round": g["round"],
                "roundName": rounds.get(g["round"], {}).get("name") if "place" not in g else "Third place",
                "date": g["date"], "status": g["status"], "decidedBy": g["decidedBy"], "winner": g["winner"],
                "top": _game_side(g["top"], merge), "bottom": _game_side(g["bottom"], merge),
            })

        # School appearances.
        per_school = {}
        for g in sorted(b["games"], key=lambda x: ("place" in x, x["round"], x["slot"])):
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
                        "season": season, "state": st, "competition": comp, "division": code,
                        "divisionLabel": b["division"]["label"], "gender": b["division"]["gender"],
                        "seed": team["seed"], "rounds": last_round + 1,
                        "w": 0, "l": 0, "d": 0, "gf": 0, "ga": 0, "games": []}
                    s["appearances"].append(app)
                other = g["bottom" if side == "top" else "top"]
                res = _outcome(g, side)
                row = {"round": g["round"],
                       "roundName": rounds.get(g["round"], {}).get("name") if "place" not in g else "Third place",
                       "date": g["date"], "opp": _game_side(other, merge),
                       "gf": team["score"], "ga": other["score"] if other else None,
                       "res": "BYE" if g["status"] == "bye" else res[0] if res else None,
                       "pk": res[1] if res else None}
                if "place" in g:
                    row["place"] = g["place"]
                app["games"].append(row)
                if res:
                    app[res[0].lower()] += 1
                    app["gf"] += team["score"] or 0
                    app["ga"] += (other["score"] if other else 0) or 0
        if b["champion"]:
            cid = merge.get(b["champion"]["schoolId"], b["champion"]["schoolId"])
            if cid in schools:
                schools[cid]["fullName"] = b["champion"]["fullName"]

        for app in per_school.values():
            # The team's last game: main bracket first, never a bye.
            main = ([r for r in app["games"] if "place" not in r and r["res"] != "BYE"]
                    or [r for r in app["games"] if r["res"] != "BYE"] or app["games"])
            last = main[-1]
            app["reachedRound"] = last["round"]
            app["reached"] = last["roundName"]
            won_last = last["res"] == "W" or last["pk"] == "W"
            if last["res"] is None or last["res"] == "BYE":
                # Still playing, or (in a finished bracket) a result the source never reported.
                app["result"] = "unreported" if finished else "alive"
            elif last["round"] == last_round and not b["champion"]:
                app["result"] = "unreported"
            elif last["round"] == last_round and won_last:
                app["result"] = "champion"
            elif last["round"] == last_round:
                app["result"] = "runner-up"
            elif won_last:
                app["result"] = "alive"
            else:
                app["result"] = "eliminated"
            # 0..1 progress through the bracket, for the history chart.
            app["depth"] = round((last["round"] + (1 if app["result"] == "champion" else 0)) / app["rounds"], 3)

    # Order divisions within each competition (largest class first, then D1, D2...).
    for comp in comp_index.values():
        comp["divisions"].sort(key=lambda d: divisions.order_key(d["label"]))
        for i, d in enumerate(comp["divisions"]):
            d["order"] = i

    directory = []
    for sid, s in sorted(schools.items(), key=lambda kv: kv[0]):
        name = s["names"][max(s["names"])]
        apps = sorted(s["appearances"], key=lambda a: (a["season"], a["competition"]))
        titles = sum(1 for a in apps if a["result"] == "champion")
        best = max(apps, key=lambda a: (a["depth"], a["season"]))
        summary = {"appearances": len(apps), "titles": titles,
                   "finals": sum(1 for a in apps if a["result"] in ("champion", "runner-up")),
                   "w": sum(a["w"] for a in apps), "l": sum(a["l"] for a in apps),
                   "d": sum(a["d"] for a in apps)}
        city = maxpreps.city_from_path(s["path"])
        state = maxpreps.state_from_path(s["path"]) or apps[-1]["state"]
        out[f"schools/{sid}.json"] = {
            "schema": SCHEMA, "id": sid, "name": name, "fullName": s["fullName"], "city": city, "state": state,
            "maxpreps": (sources["sources"]["maxpreps"]["base"] + s["path"]) if s["path"] else None,
            "summary": summary,
            "best": {k: best[k] for k in ("season", "competition", "division", "divisionLabel", "result", "reached")},
            "appearances": apps,
        }
        directory.append({"id": sid, "name": name, "city": city, "state": state,
                          "gender": sorted({a["gender"][0] for a in apps}),
                          "apps": len(apps), "titles": titles, "last": apps[-1]["season"]})
    out["schools.json"] = {"schema": SCHEMA, "count": len(directory), "schools": directory}
    out["search-index.json"] = {
        "schema": SCHEMA, "fields": ["id", "name", "city", "state", "apps", "titles"],
        "rows": [[d["id"], d["name"], d["city"], d["state"], d["apps"], d["titles"]] for d in directory],
    }

    all_games = {}
    for (st, season), games in games_by.items():
        games.sort(key=lambda g: (g["date"] or "", g["competition"], g["division"], g["round"]))
        out[f"states/{st}/seasons/{season}/games.json"] = {"schema": SCHEMA, "state": st, "season": season,
                                                           "games": games}
        all_games.setdefault(season, []).extend(games)
    for season, games in all_games.items():
        games.sort(key=lambda g: (g["date"] or "", g["state"], g["competition"], g["division"], g["round"]))
        out[f"seasons/{season}/games.json"] = {"schema": SCHEMA, "season": season, "games": games}

    competitions = {cid: {k: v for k, v in meta.items() if k != "source"}
                    for cid, meta in sources["competitions"].items()}
    states_rows, all_seasons = [], {}
    for st, smeta in sorted(sources["states"].items()):
        seasons = sorted(catalog[st].values(), key=lambda s: s["season"], reverse=True)
        with_data = [s for s in seasons if s["competitions"]]
        latest = with_data[0] if with_data else None
        out[f"states/{st}/catalog.json"] = {
            "schema": SCHEMA, "state": st, **smeta, "activeSeason": sources["activeSeason"],
            "latestSeason": latest["season"] if latest else None,
            "genders": sources.get("genders", ["b", "g"]), "seasons": seasons,
        }
        st_schools = [d for d in directory if d["state"] == st]
        out[f"states/{st}/schools.json"] = {"schema": SCHEMA, "state": st, "count": len(st_schools),
                                            "schools": st_schools}
        terms = sorted({sources["competitions"][c]["term"] for c in sources["competitions"]
                        if sources["competitions"][c]["state"] == st})
        states_rows.append({
            "code": st, **smeta, "terms": terms,
            "seasons": [s["season"] for s in with_data],
            "latestSeason": latest["season"] if latest else None,
            "latest": [{"competition": c["id"], "short": c["short"],
                        "divisions": [{k: d[k] for k in ("code", "label", "status", "champion", "start", "end")}
                                      for d in c["divisions"]]}
                       for c in (latest["competitions"] if latest else [])],
            "schools": len(st_schools),
        })
        for s in seasons:
            merged = all_seasons.setdefault(s["season"], {"season": s["season"], "notes": {}, "competitions": []})
            if s["note"]:
                merged["notes"][st] = s["note"]
            merged["competitions"].extend(s["competitions"])
    out["states.json"] = {"schema": SCHEMA, "activeSeason": sources["activeSeason"],
                          "genders": sources.get("genders", ["b", "g"]),
                          "aliases": sources.get("aliases", {}), "competitions": competitions,
                          "states": states_rows}
    seasons_with_data = [s for s in all_seasons.values() if s["competitions"]]
    out["catalog.json"] = {
        "schema": 2,
        "activeSeason": sources["activeSeason"],
        "latestSeason": max((s["season"] for s in seasons_with_data), default=None),
        "genders": sources.get("genders", ["b", "g"]),
        "states": sources["states"],
        "competitions": competitions,
        "seasons": sorted(all_seasons.values(), key=lambda s: s["season"], reverse=True),
    }

    base = sources["sources"]["maxpreps"]["base"]
    out = {rel: _with_meta(rel, obj, base) for rel, obj in out.items()}
    files = {archive / rel: store.dumps(obj) for rel, obj in out.items()}
    if export:
        for b in brackets:
            files[store.EXPORT / b["season"] / f"{b['competition']}-{b['division']['code']}.csv"] = _csv(b)

    # Under --check a skipped bracket fails CI instead of silently vanishing from the site.
    changed = list(errors) if check else []
    # Prune derived files that are no longer produced (e.g. a gender switched off).
    managed = [archive / sub for sub in ("brackets", "schools", "seasons", "states")]
    if export:
        managed.append(store.EXPORT)
    for folder in managed:
        for path in sorted(folder.rglob("*.*")) if folder.exists() else []:
            if path.is_file() and path not in files:
                changed.append(_shown(path) + " (stale)")
                if not check:
                    path.unlink()
    for path, text in sorted(files.items()):
        if check:
            try:
                same = path.read_text(encoding="utf-8") == text
            except FileNotFoundError:
                same = False
            if not same:
                changed.append(_shown(path))
        elif store.write_text(path, text):
            changed.append(_shown(path))
    if not check:
        for folder in managed:
            for d in sorted(folder.rglob("*"), reverse=True) if folder.exists() else []:
                if d.is_dir() and not any(d.iterdir()):
                    d.rmdir()
    return changed


def _with_meta(rel, doc, base):
    """`doc` with `_meta` as its second key (#8 PR 5). Only a bracket carries a fetch time, so a refetch
    moves that one bracket and no document built from several: their `asOf` is null."""
    if rel.startswith("brackets/"):
        meta = {"source": "maxpreps", "url": doc["source"]["maxpreps"], "asOf": doc["source"]["fetchedAt"]}
    elif rel.startswith("schools/"):
        meta = {"source": "maxpreps", "url": doc["maxpreps"], "asOf": None}
    else:
        meta = {"source": "maxpreps", "url": base, "asOf": None}
    return {"schema": doc["schema"], "_meta": meta, **{k: v for k, v in doc.items() if k != "schema"}}


def _game_side(side, merge):
    if not side:
        return None
    return {"id": _school_key(side, merge), "name": side["name"], "seed": side["seed"],
            "score": side["score"]}


def _csv(b):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    names = {r["index"]: r["name"] for r in b["rounds"]}
    w.writerow(["season", "state", "competition", "division", "round", "round_name", "date", "status",
                "decided_by", "top_seed", "top_school", "top_score", "bottom_seed", "bottom_school",
                "bottom_score", "winner"])
    for g in b["games"]:
        t, o = g["top"] or {}, g["bottom"] or {}
        w.writerow([b["season"], b["state"], b["competition"], b["division"]["label"], g["round"],
                    names.get(g["round"]) if "place" not in g else "Third place",
                    g["date"], g["status"], g["decidedBy"] or "", t.get("seed"), t.get("name"), t.get("score"),
                    o.get("seed"), o.get("name"), o.get("score"), g["winner"] or ""])
    return buf.getvalue()
