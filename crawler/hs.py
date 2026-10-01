"""High school girls soccer crawler / deriver.

  python -m crawler.hs --refresh              crawl competitions that are live today
  python -m crawler.hs --backfill             crawl every registry season not yet complete
  python -m crawler.hs --season 2025-26       crawl one season (all states)
  python -m crawler.hs --state TX             limit any crawl to one state
  python -m crawler.hs --discover 2025-26     list MaxPreps state tournaments for review
  python -m crawler.hs --derive               rebuild public/archive from archive/raw (no network)
  python -m crawler.hs --derive --check       fail if committed derived files are stale
  python -m crawler.hs --export               also write CSV exports

Crawling always runs --derive afterwards. Complete divisions (with a
champion) are never refetched unless --force is given.

Sources: "cif" competitions are discovered through cifstate.org division
pages; "maxpreps" competitions through a MaxPreps tournament list page. Either
way the bracket itself is a MaxPreps bracket page.
"""
import argparse
import datetime as dt
import re
import sys
import time
from html import escape

from . import cif, derive, discover, divisions, maxpreps, store
from .fetch import Blocked, BudgetExhausted, Fetcher, NotFound

_HEADER = re.compile(r"^(?:<!--.*?-->\s*)+", re.S)


def now_iso():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def in_window(start, end, today, sources):
    r = sources.get("refresh", {})
    lo = dt.date.fromisoformat(start) - dt.timedelta(days=r.get("lookaheadDays", 2))
    hi = dt.date.fromisoformat(end) + dt.timedelta(days=r.get("lookbackDays", 3))
    return lo <= today <= hi


def raw_path(season, comp, code):
    return store.RAW / season / comp / f"{code}.html"


def division_gender(div, code):
    return div.get("gender") or ("boys" if code[0] == "b" else "girls")


def in_term(sources, season, comp_id, ccfg, today):
    """Is today inside the competition's playoff period for this season?

    The period comes from `refresh.termWindows[term]` ({"from": "MM-DD",
    "to": "MM-DD", "year": "start"|"end"} of the school year), or from
    `liveFrom` / `liveTo` (MM-DD) on the season entry or the competition."""
    meta = sources["competitions"][comp_id]
    term = (sources.get("refresh", {}).get("termWindows") or {}).get(meta.get("term"))
    lo = ccfg.get("liveFrom") or meta.get("liveFrom") or (term or {}).get("from")
    hi = ccfg.get("liveTo") or meta.get("liveTo") or (term or {}).get("to")
    if not lo or not hi:
        return False
    year = store.season_end_year(season) - (1 if (term or {}).get("year") == "start" else 0)
    start = dt.date.fromisoformat(f"{year}-{lo}")
    end = dt.date.fromisoformat(f"{year}-{hi}")
    if start > end:  # wraps the new year: starts in the autumn before
        start = start.replace(year=year - 1)
    return start <= today <= end


def in_recheck_slot(sources, now):
    """True for a run that started inside the daily re-check slot (UTC).

    `now` is the run's actual start time; a late or skipped cron run simply
    misses that day's re-check (fewer requests, never more)."""
    slot = sources.get("refresh", {}).get("recheckSlotUtc")
    if now is None or not slot:
        return False
    hhmm = now.astimezone(dt.timezone.utc).strftime("%H:%M")
    return slot["start"] <= hhmm <= slot["end"]


def is_live(sources, links, season, comp_id, ccfg, today, now=None):
    """Live = inside a configured window, or (no window) the stored bracket
    dates are near today and it has no champion yet.

    A registered active-season tournament whose list page is not fetched or
    still empty, or whose brackets are missing or have no dates yet, is only
    re-checked once a day (the run that starts in the re-check slot) and only
    inside its term's playoff period. Off-season runs make no requests."""
    window = ccfg.get("window")
    if window:
        return in_window(window["start"], window["end"], today, sources)
    active = season == sources["activeSeason"]
    recheck = active and in_term(sources, season, comp_id, ccfg, today) and in_recheck_slot(sources, now)
    entry = links.get(season, {}).get(comp_id)
    if not entry or not entry.get("divisions"):
        return recheck
    genders = {"boys" if g == "b" else "girls" for g in sources.get("genders", ["b", "g"])}
    for code, div in entry["divisions"].items():
        if div.get("complete") or division_gender(div, code) not in genders:
            continue
        raw = raw_path(season, comp_id, code)
        if not raw.exists():
            if recheck:
                return True
            continue
        parsed = maxpreps.parse(_HEADER.sub("", raw.read_text(encoding="utf-8")))
        dates = [r["date"] for r in parsed["rounds"] if r["date"]]
        if dates and in_window(min(dates), max(dates), today, sources):
            return True
        if not dates and recheck:
            return True
    return False


class Crawler:
    def __init__(self, sources, fetcher, force=False, log=print):
        self.sources = sources
        self.fetcher = fetcher
        self.force = force
        self.log = log
        self.links = store.load_json(store.LINKS, {}) or {}
        self.crawled = []
        self.cif_base = sources["sources"]["cif"]["base"]
        self.mp_base = sources["sources"]["maxpreps"]["base"]
        self.genders = {"boys" if g == "b" else "girls" for g in sources.get("genders", ["b", "g"])}

    def save_links(self):
        store.write_json(store.LINKS, dict(sorted(self.links.items())))

    def crawl(self, season, comp_id, live):
        meta = self.sources["competitions"][comp_id]
        cfg = self.sources["seasons"][season]["competitions"][comp_id]
        entry = self.links.setdefault(season, {}).setdefault(comp_id, {"divisions": {}})
        status = entry.get("status")
        if status == "missing" and not live and not self.force:
            return
        if status != "ok" or self.force:
            if meta["source"] == "cif":
                self._discover_cif(season, comp_id, cfg, entry, live)
            else:
                self._discover_maxpreps(season, comp_id, meta, cfg, entry, live)
        for code, div in sorted(entry["divisions"].items()):
            if division_gender(div, code) in self.genders:
                self.crawl_division(season, comp_id, code, div)

    def _discover_cif(self, season, comp_id, cfg, entry, live):
        url = self.cif_base + cfg["path"] + "/index"
        try:
            _, html = self.fetcher.get(url, "cif")
        except NotFound:
            entry["status"] = "pending" if live else "missing"
            self.log(f"{season} {comp_id}: index not found ({entry['status']})")
            self.save_links()
            return
        found = cif.parse_index(html, cfg["path"], self.cif_base)
        entry["status"] = "ok" if found else "pending"
        for code, div_url in found.items():
            gender, _ = divisions.cif_division(code)
            entry["divisions"].setdefault(code, {}).update({"cif": div_url, "gender": gender})
        self.save_links()

    def _discover_maxpreps(self, season, comp_id, meta, cfg, entry, live):
        try:
            _, html = self.fetcher.get(self.mp_base + cfg["list"], "maxpreps")
        except NotFound:
            entry["status"] = "pending" if live else "missing"
            self.log(f"{season} {comp_id}: tournament list not found ({entry['status']})")
            self.save_links()
            return
        drop = [self.sources["states"][meta["state"]]["association"]]
        found = maxpreps.parse_tournament(html, cfg["tournament"])
        entry["status"] = "ok" if found else "pending"
        for b in found:
            label = divisions.clean_label(b["name"], drop=drop)
            code = divisions.code_for(label)
            entry["divisions"].setdefault(code, {}).update({
                "name": b["name"], "label": label, "bracket": b["id"],
                "maxpreps": self.mp_base + b["url"], "gender": meta.get("gender", "girls")})
        self.log(f"{season} {comp_id}: {len(found)} brackets")
        self.save_links()

    def crawl_division(self, season, comp_id, code, div):
        raw = raw_path(season, comp_id, code)
        # A bracket with a champion never changes again.
        if div.get("complete") and raw.exists() and not self.force:
            return
        if not div.get("maxpreps"):
            try:
                _, html = self.fetcher.get(div["cif"], "cif")
            except NotFound:
                div["status"] = "missing"
                self.save_links()
                return
            link = cif.parse_division(html)
            if not link:
                div["status"] = "no-bracket"
                self.save_links()
                return
            div["maxpreps"] = link
            self.save_links()
        final_url, html = self.fetcher.get(div["maxpreps"], "maxpreps")
        bracket_html = maxpreps.trim(html)
        if bracket_html is None:
            div["status"] = "no-bracket"
            self.save_links()
            return
        parsed = maxpreps.parse(bracket_html)
        fetched = now_iso()
        header = (f"<!-- source: {escape(final_url)} -->\n"
                  f"<!-- fetched: {fetched} -->\n")
        store.write_text(raw, header + bracket_html + "\n")
        div.update({"status": "ok", "canonical": final_url, "fetchedAt": fetched,
                    "complete": parsed["champion"] is not None})
        self.save_links()
        self.crawled.append(f"{season}/{comp_id}/{code}")
        self.log(f"{season} {comp_id} {code}: {len(parsed['games'])} games"
                 + (f", champion {parsed['champion']['name']}" if parsed["champion"] else ""))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--refresh", action="store_true")
    p.add_argument("--backfill", action="store_true")
    p.add_argument("--season")
    p.add_argument("--state", help="two-letter state code, e.g. TX")
    p.add_argument("--discover", metavar="SEASON")
    p.add_argument("--force", action="store_true")
    p.add_argument("--max-requests", type=int)
    p.add_argument("--derive", action="store_true")
    p.add_argument("--check", action="store_true")
    p.add_argument("--export", action="store_true")
    p.add_argument("--today", help="override today's date (YYYY-MM-DD) for --refresh")
    p.add_argument("--now", help="override the run's start time (ISO, UTC) for --refresh, e.g. 2027-04-20T06:00Z")
    args = p.parse_args(argv)

    sources = store.load_json(store.SOURCES)
    delays = {k: v["delaySeconds"] for k, v in sources["sources"].items()}
    if args.discover:
        fetcher = Fetcher(delays, 10 if args.max_requests is None else args.max_requests)
        return discover.run(sources, args.discover, fetcher)

    crawling = args.refresh or args.backfill or args.season
    if not crawling and not args.derive and not args.export:
        p.print_help()
        return 2

    if crawling:
        started = time.monotonic()
        # The run's actual start time decides the daily re-check slot.
        now = (dt.datetime.fromisoformat(args.now.replace("Z", "+00:00")) if args.now
               else dt.datetime.now(dt.timezone.utc))
        if now.tzinfo is None:
            now = now.replace(tzinfo=dt.timezone.utc)
        today = dt.date.fromisoformat(args.today) if args.today else now.astimezone(dt.timezone.utc).date()
        budget = sources["refresh"]["maxRequests"] if args.max_requests is None else args.max_requests
        fetcher = Fetcher(delays, budget)
        crawler = Crawler(sources, fetcher, force=args.force)
        plan = []
        for season, scfg in sources["seasons"].items():
            if args.season and season != args.season:
                continue
            for comp_id, ccfg in scfg["competitions"].items():
                if args.state and sources["competitions"][comp_id]["state"] != args.state.upper():
                    continue
                live = is_live(sources, crawler.links, season, comp_id, ccfg, today, now=now)
                if args.refresh and not live:
                    continue
                plan.append((season, comp_id, live))
        blocked = exhausted = False
        if args.refresh and not plan:
            print("no competition is live today; nothing to fetch")
        for season, comp_id, live in plan:
            try:
                crawler.crawl(season, comp_id, live)
            except Blocked as e:
                blocked = True
                print(f"blocked by bot protection at {e}; stopping this run", file=sys.stderr)
                break
            except BudgetExhausted:
                exhausted = True
                print("request budget exhausted; continue in the next run", file=sys.stderr)
                break
        if plan:
            store.write_json(store.ARCHIVE / "refresh-state.json", {
                "schema": 1,
                "updatedAt": now_iso(),
                "mode": "refresh" if args.refresh else ("backfill" if args.backfill else "season"),
                "requests": fetcher.requests,
                "blocked": blocked,
                "budgetExhausted": exhausted,
                "crawled": crawler.crawled,
                "failed": fetcher.failed,
                "durationSeconds": round(time.monotonic() - started, 1),
            })

    changed = derive.build_all(sources, check=args.check, export=args.export)
    if args.check:
        if changed:
            print("derived files are stale:\n  " + "\n  ".join(changed), file=sys.stderr)
            return 1
        print("derived files are up to date")
    elif changed:
        print(f"derived: {len(changed)} file(s) written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
