"""`python hsdash.py validate` (#8 PR 4): every published file against its JSON Schema, plus cross-checks.

  python hsdash.py validate            the committed files: public/archive/** and public/data/sources.json
  python hsdash.py validate --fresh    a build written to a temp directory (the committed tree is not read)
  python hsdash.py validate --archive DIR

Schemas are `schema/*.schema.json` (Draft 2020-12, as collegedash's), checked with the `jsonschema` package. It is a
dev and CI dependency only (requirements-dev.txt): the crawler and the build stay stdlib-only, and this module
imports it when it runs, not when it is imported.

A schema pins one file's shape. The cross-checks cover what a schema can't see:
  - every file under the archive is a known kind, and the files a site needs are there;
  - a file's path agrees with its content (a bracket's season, competition and division; a school's id);
  - a bracket's game ids are unique, every `next` is a later game in the same bracket, every round is listed,
    a winner is a team that is there, a bye has one team, and the champion won the final;
  - the catalogs (per state and catalog.json) list every bracket once, and their division counts, status,
    champion, runner-up and dates are the bracket's; catalog.json is the state catalogs combined;
  - states.json agrees with each state's catalog and directory;
  - the directories' counts add up, the state directories make up the full one, each row matches its school
    file, and the search index is the directory's rows;
  - a school's summary adds up from its appearances, and each appearance is in its bracket;
  - the games feeds hold each bracket's non-bye games, and the all-states feed is the state feeds combined;
  - every school a game names has a school file.
"""
import argparse
import json
import re
import sys
import tempfile
from collections import Counter
from pathlib import Path

from build_lib import store

SCHEMA_DIR = store.ROOT / "schema"
DRAFT = "https://json-schema.org/draft/2020-12/schema"

# A file's kind from its path under the archive (first match wins).
KINDS = [
    (re.compile(r"catalog\.json"), "catalog"),
    (re.compile(r"refresh-state\.json"), "status"),
    (re.compile(r"states\.json"), "states"),
    (re.compile(r"search-index\.json"), "search-index"),
    (re.compile(r"schools\.json"), "schools"),
    (re.compile(r"schools/[^/]+\.json"), "school"),
    (re.compile(r"states/[A-Z]{2}/catalog\.json"), "state-catalog"),
    (re.compile(r"states/[A-Z]{2}/schools\.json"), "schools"),
    (re.compile(r"states/[A-Z]{2}/seasons/\d{4}-\d{2}/games\.json"), "games"),
    (re.compile(r"seasons/\d{4}-\d{2}/games\.json"), "games"),
    (re.compile(r"brackets/\d{4}-\d{2}/[^/]+/[^/]+\.json"), "bracket"),
]
SOURCES_KIND = "sources"
# What a build always writes; refresh-state.json comes from a crawl, so only the committed tree must have it.
BUILT = ["catalog.json", "states.json", "search-index.json", "schools.json"]
MAX_SCHEMA_ERRORS = 5   # per file


class MissingDependency(RuntimeError):
    pass


def kind_of(rel):
    for pattern, kind in KINDS:
        if pattern.fullmatch(rel):
            return kind
    return None


def document_kinds():
    return sorted({k for _, k in KINDS} | {SOURCES_KIND})


def load_schemas():
    """{name: schema} for every schema/*.schema.json, `name` being the file name without `.schema.json`."""
    return {p.name[: -len(".schema.json")]: json.loads(p.read_text(encoding="utf-8"))
            for p in sorted(SCHEMA_DIR.glob("*.schema.json"))}


def validators(schemas=None):
    """{name: Draft202012Validator}, resolving `common.schema.json#/…` refs from the local files only."""
    try:
        from jsonschema import Draft202012Validator
        from referencing import Registry, Resource
        from referencing.jsonschema import DRAFT202012
    except ImportError as e:   # pragma: no cover - exercised by hand
        raise MissingDependency("hsdash.py validate needs the jsonschema package: "
                                "python -m pip install -r requirements-dev.txt") from e
    schemas = schemas or load_schemas()
    registry = Registry().with_resources(
        (s["$id"], Resource.from_contents(s, default_specification=DRAFT202012)) for s in schemas.values())
    out = {}
    for name, schema in schemas.items():
        Draft202012Validator.check_schema(schema)
        out[name] = Draft202012Validator(schema, registry=registry)
    return out


def schema_problems(validator, doc, where):
    errors = sorted(validator.iter_errors(doc), key=lambda e: (list(e.absolute_path), e.message))
    out = []
    for e in errors[:MAX_SCHEMA_ERRORS]:
        msg = e.message if len(e.message) <= 200 else e.message[:200] + "…"
        out.append(f"{where}: {e.json_path}: {msg}")
    if len(errors) > MAX_SCHEMA_ERRORS:
        out.append(f"{where}: … and {len(errors) - MAX_SCHEMA_ERRORS} more schema errors")
    return out


def read_tree(archive):
    """({rel: document}, [problems]) for every file under the archive."""
    docs, problems = {}, []
    for path in sorted(p for p in Path(archive).rglob("*") if p.is_file()):
        rel = path.relative_to(archive).as_posix()
        if kind_of(rel) is None:
            problems.append(f"{rel}: not a published file kind (schema/ has no schema for it)")
            continue
        try:
            docs[rel] = json.loads(path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            problems.append(f"{rel}: not valid JSON ({e})")
    return docs, problems


def validate_documents(docs, sources, aliases, *, status_required=True, checkers=None):
    """Problems (strings) for a set of archive documents and the registry; [] when all is well."""
    checkers = checkers or validators()
    problems = []
    for rel in BUILT + (["refresh-state.json"] if status_required else []):
        if rel not in docs:
            problems.append(f"{rel}: missing")
    problems += schema_problems(checkers[SOURCES_KIND], sources, "data/sources.json")
    bad = set()
    for rel, doc in docs.items():
        found = schema_problems(checkers[kind_of(rel)], doc, rel)
        if found:
            bad.add(rel)
            problems += found
    if problems:
        # Cross-checks read fields a schema guarantees; on a malformed tree they would only add noise.
        return problems + [f"cross-checks skipped: {len(bad) or 'some'} file(s) failed their schema"]
    return cross_checks(docs, sources, (aliases or {}).get("merge", {}))


# ---------- cross-checks ----------

def _by_kind(docs, kind):
    return {rel: d for rel, d in docs.items() if kind_of(rel) == kind}


def _bracket_summary(b):
    """What a catalog division says about its bracket (raw MaxPreps ids, as build.py writes them)."""
    main = [g for g in b["games"] if "place" not in g]
    last = max(r["index"] for r in b["rounds"])
    runner = None
    finals = [g for g in main if g["round"] == last and g["status"] == "final"]
    if b["champion"] and finals:
        g = finals[0]
        loser = g["bottom" if g["winner"] == "top" else "top"]
        runner = {"id": loser["schoolId"], "name": loser["name"]} if loser else None
    dates = [r["date"] for r in b["rounds"] if r["date"]]
    return {
        "code": b["division"]["code"], "gender": b["division"]["gender"], "label": b["division"]["label"],
        "games": sum(1 for g in b["games"] if g["status"] != "bye"),
        "played": sum(1 for g in b["games"] if g["status"] == "final"),
        "champion": {"id": b["champion"]["schoolId"], "name": b["champion"]["name"]} if b["champion"] else None,
        "runnerUp": runner, "start": min(dates) if dates else None, "end": max(dates) if dates else None,
    }


def _check_bracket(rel, b, sources, p):
    want = f"brackets/{b['season']}/{b['competition']}/{b['division']['code']}.json"
    if rel != want:
        p.append(f"{rel}: its content is {want}")
    comp = sources["competitions"].get(b["competition"])
    if comp is None:
        p.append(f"{rel}: competition {b['competition']} is not in sources.json")
    elif comp["state"] != b["state"]:
        p.append(f"{rel}: state {b['state']}, but {b['competition']} is a {comp['state']} competition")
    if b["competition"] not in sources["seasons"].get(b["season"], {}).get("competitions", {}):
        p.append(f"{rel}: {b['competition']} is not registered for {b['season']} in sources.json")
    index = [r["index"] for r in b["rounds"]]
    if index != list(range(len(index))):
        p.append(f"{rel}: rounds are {index}, not 0..{len(index) - 1}")
    ids = Counter(g["id"] for g in b["games"] if g["id"])
    for gid, n in ids.items():
        if n > 1:
            p.append(f"{rel}: game id {gid} is used {n} times")
    by_id = {g["id"]: g for g in b["games"] if g["id"]}
    for g in b["games"]:
        label = g["id"] or "round %d slot %d" % (g["round"], g["slot"])
        where = f"{rel}: game {label}"
        if g["round"] not in index:
            p.append(f"{where}: round {g['round']} is not in rounds")
        if g["winner"] and g[g["winner"]] is None:
            p.append(f"{where}: the winner ({g['winner']}) has no team")
        if g["status"] == "bye" and sum(1 for s in ("top", "bottom") if g[s]) != 1:
            p.append(f"{where}: a bye must have exactly one team")
        if g["decidedBy"] == "pk" and not (g["top"] and g["bottom"] and g["top"]["score"] is not None
                                           and g["top"]["score"] == g["bottom"]["score"]):
            p.append(f"{where}: decided on PKs without a level score")
        if g["next"]:
            nxt = by_id.get(g["next"])
            if nxt is None:
                p.append(f"{where}: next {g['next']} is not a game in this bracket")
            elif nxt["round"] <= g["round"]:
                p.append(f"{where}: next {g['next']} is not in a later round")
    if b["champion"]:
        last = max(index)
        finals = [g for g in b["games"] if g["round"] == last and "place" not in g and g["status"] == "final"]
        if not any(g[g["winner"]]["schoolId"] == b["champion"]["schoolId"] for g in finals):
            p.append(f"{rel}: champion {b['champion']['name']} did not win a final-round game")


def _check_catalogs(docs, brackets, sources, p):
    by_key = {(b["season"], b["competition"], b["division"]["code"]): rel for rel, b in brackets.items()}
    listed = Counter()
    state_cats = _by_kind(docs, "state-catalog")
    for rel, c in state_cats.items():
        st = rel.split("/")[1]
        if c["state"] != st:
            p.append(f"{rel}: state is {c['state']}")
        meta = sources["states"].get(st)
        if meta is None:
            p.append(f"{rel}: {st} is not in sources.json")
        elif {k: c[k] for k in meta} != meta:
            p.append(f"{rel}: name or association differs from sources.json")
        if c["activeSeason"] != sources["activeSeason"]:
            p.append(f"{rel}: activeSeason {c['activeSeason']}, sources.json says {sources['activeSeason']}")
        with_data = [s["season"] for s in c["seasons"] if s["competitions"]]
        if c["latestSeason"] != (max(with_data) if with_data else None):
            p.append(f"{rel}: latestSeason {c['latestSeason']} is not its newest season with brackets")
        for s in c["seasons"]:
            for comp in s["competitions"]:
                if comp["state"] != st:
                    p.append(f"{rel}: {s['season']} {comp['id']} is a {comp['state']} competition")
                for i, d in enumerate(comp["divisions"]):
                    key = (s["season"], comp["id"], d["code"])
                    listed[key] += 1
                    where = f"{rel}: {s['season']} {comp['id']} {d['code']}"
                    if d["order"] != i:
                        p.append(f"{where}: order {d['order']}, position {i}")
                    if key not in by_key:
                        p.append(f"{where}: no bracket file")
                        continue
                    b = brackets[by_key[key]]
                    want = _bracket_summary(b)
                    for field, value in want.items():
                        if d[field] != value:
                            p.append(f"{where}: {field} is {d[field]!r}, the bracket says {value!r}")
                    if (d["status"] == "complete") != bool(b["champion"]):
                        p.append(f"{where}: status {d['status']}, but the bracket "
                                 + ("has a champion" if b["champion"] else "has no champion"))
    for key, rel in by_key.items():
        if listed[key] != 1:
            p.append(f"{rel}: listed {listed[key]} times in the state catalogs")

    cat = docs.get("catalog.json")
    if cat is None:
        return
    if cat["states"] != sources["states"]:
        p.append("catalog.json: states differ from sources.json")
    want_comps = {cid: {k: v for k, v in m.items() if k != "source"} for cid, m in sources["competitions"].items()}
    if cat["competitions"] != want_comps:
        p.append("catalog.json: competitions differ from sources.json (without `source`)")
    if cat["activeSeason"] != sources["activeSeason"]:
        p.append(f"catalog.json: activeSeason {cat['activeSeason']}, sources.json says {sources['activeSeason']}")
    combined = {}
    for rel, c in sorted(state_cats.items()):
        for s in c["seasons"]:
            entry = combined.setdefault(s["season"], {"notes": {}, "competitions": {}})
            if s["note"]:
                entry["notes"][c["state"]] = s["note"]
            for comp in s["competitions"]:
                entry["competitions"][comp["id"]] = comp
    got = {s["season"]: s for s in cat["seasons"]}
    if set(got) != set(combined):
        p.append(f"catalog.json: seasons {sorted(got)}, the state catalogs have {sorted(combined)}")
    for season in sorted(set(got) & set(combined)):
        if got[season]["notes"] != combined[season]["notes"]:
            p.append(f"catalog.json: {season} notes differ from the state catalogs")
        mine = {comp["id"]: comp for comp in got[season]["competitions"]}
        if mine != combined[season]["competitions"]:
            p.append(f"catalog.json: {season} competitions differ from the state catalogs")
    with_data = [s["season"] for s in cat["seasons"] if s["competitions"]]
    if cat["latestSeason"] != (max(with_data) if with_data else None):
        p.append(f"catalog.json: latestSeason {cat['latestSeason']} is not its newest season with brackets")


def _check_states(docs, sources, p):
    idx = docs.get("states.json")
    if idx is None:
        return
    codes = [r["code"] for r in idx["states"]]
    if codes != sorted(sources["states"]):
        p.append(f"states.json: states {codes}, sources.json has {sorted(sources['states'])}")
    for row in idx["states"]:
        st = row["code"]
        cat = docs.get(f"states/{st}/catalog.json")
        directory = docs.get(f"states/{st}/schools.json")
        if cat is None or directory is None:
            p.append(f"states.json: {st} has no catalog or directory")
            continue
        if row["schools"] != directory["count"]:
            p.append(f"states.json: {st} schools {row['schools']}, its directory has {directory['count']}")
        if row["latestSeason"] != cat["latestSeason"]:
            p.append(f"states.json: {st} latestSeason {row['latestSeason']}, its catalog says {cat['latestSeason']}")
        if row["seasons"] != [s["season"] for s in cat["seasons"] if s["competitions"]]:
            p.append(f"states.json: {st} seasons differ from its catalog")
        latest = next((s for s in cat["seasons"] if s["season"] == cat["latestSeason"]), None)
        want = [{"competition": c["id"], "short": c["short"],
                 "divisions": [{k: d[k] for k in ("code", "label", "status", "champion", "start", "end")}
                               for d in c["divisions"]]}
                for c in (latest["competitions"] if latest else [])]
        if row["latest"] != want:
            p.append(f"states.json: {st} latest divisions differ from its catalog's {cat['latestSeason']}")


def _check_directories(docs, schools, p):
    full = docs.get("schools.json")
    if full is None:
        return
    rows = full["schools"]
    if full["count"] != len(rows):
        p.append(f"schools.json: count {full['count']}, {len(rows)} rows")
    ids = [r["id"] for r in rows]
    if ids != sorted(set(ids)):
        p.append("schools.json: ids are not unique and sorted")
    if set(ids) != set(schools):
        missing, extra = sorted(set(ids) - set(schools)), sorted(set(schools) - set(ids))
        p.append(f"schools.json: rows without a school file {missing[:5]}, school files without a row {extra[:5]}")
    for r in rows:
        s = schools.get(r["id"])
        if s is None:
            continue
        apps = s["appearances"]
        want = {"name": s["name"], "city": s["city"], "state": s["state"],
                "gender": sorted({a["gender"][0] for a in apps}), "apps": len(apps),
                "titles": s["summary"]["titles"], "last": max(a["season"] for a in apps)}
        for field, value in want.items():
            if r[field] != value:
                p.append(f"schools.json: {r['id']} {field} is {r[field]!r}, its school file says {value!r}")
    for rel, d in _by_kind(docs, "schools").items():
        if rel == "schools.json":
            continue
        st = rel.split("/")[1]
        if d.get("state") != st:
            p.append(f"{rel}: state is {d.get('state')}")
        if d["count"] != len(d["schools"]):
            p.append(f"{rel}: count {d['count']}, {len(d['schools'])} rows")
        if d["schools"] != [r for r in rows if r["state"] == st]:
            p.append(f"{rel}: rows are not schools.json's {st} rows")
    index = docs.get("search-index.json")
    if index is not None:
        want = [[r["id"], r["name"], r["city"], r["state"], r["apps"], r["titles"]] for r in rows]
        if index["rows"] != want:
            p.append("search-index.json: rows are not schools.json's (id, name, city, state, apps, titles)")


def _check_schools(schools, brackets, merge, p):
    by_key = {(b["season"], b["competition"], b["division"]["code"]): b for b in brackets.values()}
    for sid, s in schools.items():
        rel = f"schools/{sid}.json"
        if s["id"] != sid:
            p.append(f"{rel}: id is {s['id']}")
        apps = s["appearances"]
        tally = {"appearances": len(apps), "titles": sum(a["result"] == "champion" for a in apps),
                 "finals": sum(a["result"] in ("champion", "runner-up") for a in apps),
                 "w": sum(a["w"] for a in apps), "l": sum(a["l"] for a in apps), "d": sum(a["d"] for a in apps)}
        if s["summary"] != tally:
            p.append(f"{rel}: summary {s['summary']}, the appearances add up to {tally}")
        best = s["best"]
        if not any(all(a[k] == best[k] for k in best) for a in apps):
            p.append(f"{rel}: best is not one of its appearances")
        for a in apps:
            where = f"{rel}: {a['season']} {a['competition']} {a['division']}"
            res = Counter(g["res"] for g in a["games"])
            if (a["w"], a["l"], a["d"]) != (res["W"], res["L"], res["D"]):
                p.append(f"{where}: W-L-D {a['w']}-{a['l']}-{a['d']}, its games say {res['W']}-{res['L']}-{res['D']}")
            b = by_key.get((a["season"], a["competition"], a["division"]))
            if b is None:
                p.append(f"{where}: no bracket file")
                continue
            if a["state"] != b["state"]:
                p.append(f"{where}: state {a['state']}, the bracket's is {b['state']}")
            teams = {merge.get(t["schoolId"], t["schoolId"]) for g in b["games"] for t in (g["top"], g["bottom"])
                     if t and t["schoolId"]}
            if sid not in teams:
                p.append(f"{where}: the school does not play in that bracket")


def _check_games(docs, brackets, schools, merge, p):
    by_key = {(b["season"], b["competition"], b["division"]["code"]): b for b in brackets.values()}
    feeds = _by_kind(docs, "games")
    state_feeds, season_feeds = {}, {}
    for rel, f in feeds.items():
        parts = rel.split("/")
        if parts[0] == "states":
            st, season = parts[1], parts[3]
            if f.get("state") != st or f["season"] != season:
                p.append(f"{rel}: says {f.get('state')} {f['season']}")
            state_feeds[(st, season)] = f
        else:
            season = parts[1]
            if "state" in f or f["season"] != season:
                p.append(f"{rel}: says {f.get('state')} {f['season']}")
            season_feeds[season] = f
        for g in f["games"]:
            if parts[0] == "states" and g["state"] != parts[1]:
                p.append(f"{rel}: game {g['id']} is a {g['state']} game")
            b = by_key.get((f["season"], g["competition"], g["division"]))
            if b is None:
                p.append(f"{rel}: game {g['id']}: no bracket {g['competition']} {g['division']}")
            elif g["id"] and g["id"] not in {x["id"] for x in b["games"]}:
                p.append(f"{rel}: game {g['id']} is not in its bracket")
            for side in ("top", "bottom"):
                t = g[side]
                if t and t["id"] and t["id"] not in schools:
                    p.append(f"{rel}: game {g['id']}: {t['name']} ({t['id']}) has no school file")
    # Each bracket's non-bye games are in its state's feed.
    want = Counter()
    for b in brackets.values():
        want[(b["state"], b["season"])] += sum(1 for g in b["games"] if g["status"] != "bye")
    got = Counter({k: len(f["games"]) for k, f in state_feeds.items()})
    for key in sorted(set(want) | set(got)):
        if want[key] != got[key]:
            p.append(f"states/{key[0]}/seasons/{key[1]}/games.json: {got[key]} games, the brackets have {want[key]}")
    # The all-states feed is the state feeds combined.
    key = lambda g: json.dumps(g, sort_keys=True)
    for season in sorted({s for _, s in state_feeds} | set(season_feeds)):
        combined = Counter(key(g) for (st, s), f in state_feeds.items() if s == season for g in f["games"])
        mine = Counter(key(g) for g in season_feeds.get(season, {"games": []})["games"])
        if season not in season_feeds or combined != mine:
            p.append(f"seasons/{season}/games.json: not the {season} state feeds combined")
    # Champions are schools too.
    for rel, b in brackets.items():
        if b["champion"] and b["champion"]["schoolId"]:
            cid = merge.get(b["champion"]["schoolId"], b["champion"]["schoolId"])
            if cid not in schools:
                p.append(f"{rel}: champion {cid} has no school file")


def _check_sources(sources, p):
    for cid, comp in sources["competitions"].items():
        if comp["state"] not in sources["states"]:
            p.append(f"data/sources.json: competition {cid} is in {comp['state']}, which is not registered")
    for season, cfg in sources["seasons"].items():
        for cid in cfg["competitions"]:
            if cid not in sources["competitions"]:
                p.append(f"data/sources.json: {season} lists {cid}, which is not registered")
    for old, new in sources["aliases"].items():
        if new not in sources["competitions"]:
            p.append(f"data/sources.json: alias {old} -> {new}, which is not registered")


def cross_checks(docs, sources, merge):
    p = []
    _check_sources(sources, p)
    brackets = _by_kind(docs, "bracket")
    schools = {rel[len("schools/"):-len(".json")]: d for rel, d in _by_kind(docs, "school").items()}
    for rel, b in sorted(brackets.items()):
        _check_bracket(rel, b, sources, p)
    _check_catalogs(docs, brackets, sources, p)
    _check_states(docs, sources, p)
    _check_directories(docs, schools, p)
    _check_schools(schools, brackets, merge, p)
    _check_games(docs, brackets, schools, merge, p)
    return p


# ---------- entry points ----------

def validate_archive(archive, *, status_required=True, sources_path=None, aliases_path=None):
    sources = store.load_json(sources_path or store.SOURCES)
    aliases = store.load_json(aliases_path or store.ALIASES, {}) or {}
    docs, problems = read_tree(Path(archive))
    return problems + validate_documents(docs, sources, aliases, status_required=status_required)


def validate_fresh(into=None):
    """Build into a temp directory (or `into`, which is kept) and validate that build. A crawl's
    refresh-state.json is not part of a build, so it is not required."""
    import build
    sources = store.load_json(store.SOURCES)
    if into is not None:
        build.build_all(sources, archive=Path(into), warn=lambda msg: None)
        return validate_archive(into, status_required=False)
    with tempfile.TemporaryDirectory(prefix="hsdash-validate-") as tmp:
        archive = Path(tmp) / "archive"
        build.build_all(sources, archive=archive, warn=lambda msg: None)
        return validate_archive(archive, status_required=False)


def main(argv=None):
    p = argparse.ArgumentParser(prog="hsdash.py validate", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    where = p.add_mutually_exclusive_group()
    where.add_argument("--fresh", action="store_true", help="validate a build written to a temp directory")
    where.add_argument("--archive", type=Path, help="validate this directory instead of public/archive")
    args = p.parse_args(argv)
    try:
        if args.fresh:
            label, problems = "a fresh build (temp directory)", validate_fresh()
        elif args.archive:
            label, problems = str(args.archive), validate_archive(args.archive, status_required=False)
        else:
            label, problems = "public/archive and public/data/sources.json", validate_archive(store.ARCHIVE)
    except MissingDependency as e:
        print(e, file=sys.stderr)
        return 2
    if problems:
        print(f"validate: {len(problems)} problem(s) in {label}:", file=sys.stderr)
        for line in problems:
            print("  " + line, file=sys.stderr)
        return 1
    print(f"validate: {label} is valid")
    return 0
