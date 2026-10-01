"""List MaxPreps girls soccer tournaments for a school year, for review.

Writes archive/discovered/<season>.json with one candidate per tournament and
a state guess. Nothing is crawled or registered: a person adds approved
tournaments to public/data/sources.json.
"""
import re

from . import maxpreps, store

# State association acronyms as they appear in MaxPreps titles.
ASSOCIATIONS = {
    "ASAA": "AK", "AHSAA": "AL", "AAA": "AR", "AIA": "AZ", "CIF": "CA", "CHSAA": "CO", "CIAC": "CT",
    "DCSAA": "DC", "DIAA": "DE", "FHSAA": "FL", "GHSA": "GA", "HHSAA": "HI", "IGHSAU": "IA",
    "IDHSAA": "ID", "IHSA": "IL", "IHSAA": "IN", "KSHSAA": "KS", "KHSAA": "KY", "LHSAA": "LA",
    "MIAA": "MA", "MPSSAA": "MD", "MPA": "ME", "MHSAA": "MI", "MSHSL": "MN", "MSHSAA": "MO",
    "MHSA": "MT", "NCHSAA": "NC", "NDHSAA": "ND", "NSAA": "NE", "NHIAA": "NH", "NJSIAA": "NJ",
    "NMAA": "NM", "NIAA": "NV", "NYSPHSAA": "NY", "OHSAA": "OH", "OSSAA": "OK", "OSAA": "OR",
    "PIAA": "PA", "RIIL": "RI", "SCHSL": "SC", "SDHSAA": "SD", "TSSAA": "TN", "UIL": "TX",
    "UHSAA": "UT", "VHSL": "VA", "VPA": "VT", "WIAA": None, "WVSSAC": "WV", "WHSAA": "WY",
}
STATE_NAMES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
    "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
    "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
    "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
    "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA",
    "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
    "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington, DC": "DC", "Washington": "WA",
    "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}
# Not a state association championship: excluded from the first pass.
EXCLUDE = re.compile(r"\b(VISAA|GIAA|GAPPS|NCCSA|PPL|invitational|test|district|region|section|ncs|"
                     r"sac-joaquin|central coast|san diego|los angeles|la city|southern section|"
                     r"northern section|san francisco|oakland|cif os)\b", re.I)


def index_slugs(season):
    start, end = int(season[:4]), int(season[:4]) + 1
    yy, zz = f"{start % 100:02d}", f"{end % 100:02d}"
    return {"fall": f"girls-soccer-{yy}", "winter": f"girls-soccer-winter-{yy}-{zz}",
            "spring": f"girls-soccer-spring-{zz}"}


def guess_state(title):
    for name, code in sorted(STATE_NAMES.items(), key=lambda kv: -len(kv[0])):
        if re.search(r"\b" + re.escape(name) + r"\b", title):
            return code, "name"
    for word in re.findall(r"[A-Z]{2,9}", title):
        if word in ASSOCIATIONS and ASSOCIATIONS[word]:
            return ASSOCIATIONS[word], "association"
    return None, None


def run(sources, season, fetcher):
    base = sources["sources"]["maxpreps"]["base"]
    registered = {cfg.get("tournament") for s in sources["seasons"].values()
                  for cfg in s["competitions"].values() if cfg.get("tournament")}
    candidates = []
    for term, slug in index_slugs(season).items():
        _, html = fetcher.get(f"{base}/tournament/{slug}.htm", "maxpreps")
        for t in maxpreps.parse_index(html):
            state, how = guess_state(t["title"])
            candidates.append({
                **t, "term": term, "state": state, "stateFrom": how,
                "excluded": bool(EXCLUDE.search(t["title"])),
                "registered": t["id"] in registered,
            })
    candidates.sort(key=lambda c: (c["excluded"], c["state"] or "ZZ", c["term"], c["title"]))
    store.write_json(store.ROOT / "archive" / "discovered" / f"{season}.json",
                     {"schema": 1, "season": season, "candidates": candidates})
    for c in candidates:
        flag = "registered" if c["registered"] else ("excluded" if c["excluded"] else "")
        print(f"{c['state'] or '??':3} {c['term']:7} {c['id']:24} {flag:10} {c['title']}")
    print(f"{len(candidates)} tournaments; review archive/discovered/{season}.json")
    return 0
