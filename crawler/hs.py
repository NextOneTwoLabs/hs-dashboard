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
import hashlib
import http.client
import re
import sys
import time
import urllib.error
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


# A division whose last attempt failed is retried only by the daily re-check run.
FAILED = ("error", "blocked", "no-bracket", "missing")
_REASONS = ("dates", "new", "pending", "relist")  # strongest first


def _bracket_dates(season, comp_id, code):
    raw = raw_path(season, comp_id, code)
    if not raw.exists():
        return None
    parsed = maxpreps.parse(_HEADER.sub("", raw.read_text(encoding="utf-8")))
    return [r["date"] for r in parsed["rounds"] if r["date"]]


def live_reason(sources, links, season, comp_id, ccfg, today, now=None):
    """Why a competition should be crawled on this run, or None.

    "dates"   inside a configured window, or a stored bracket's dates are near today
    "new"     (active season, in term) a listed division never attempted: any run
    "pending" (re-check run only) list page not fetched or empty, or a bracket
              that is missing, failed, or has no dates yet
    "relist"  (re-check run only) a MaxPreps list page that is "ok": fetch it again
              for brackets added later

    Re-check runs are the one cron run a day that starts in the slot, and only
    inside the term's playoff period. Off-season runs make no requests."""
    window = ccfg.get("window")
    if window:
        return "dates" if in_window(window["start"], window["end"], today, sources) else None
    active = season == sources["activeSeason"]
    term = active and in_term(sources, season, comp_id, ccfg, today)
    recheck = term and in_recheck_slot(sources, now)
    entry = links.get(season, {}).get(comp_id)
    if not entry or not entry.get("divisions"):
        return "pending" if recheck else None
    found = set()
    genders = {"boys" if g == "b" else "girls" for g in sources.get("genders", ["b", "g"])}
    for code, div in entry["divisions"].items():
        if div.get("complete") or division_gender(div, code) not in genders:
            continue
        status = div.get("status")
        dates = _bracket_dates(season, comp_id, code)
        if dates is None:
            if status is None and term:
                found.add("new")
            elif recheck:
                found.add("pending")
            continue
        if dates and in_window(min(dates), max(dates), today, sources):
            return "dates"
        if not dates and recheck:
            found.add("pending")
    for reason in _REASONS:
        if reason in found:
            return reason
    if recheck and sources["competitions"][comp_id].get("source") == "maxpreps" and entry.get("status") == "ok":
        return "relist"
    return None


def is_live(sources, links, season, comp_id, ccfg, today, now=None):
    """True when live_reason() gives any reason to crawl on this run."""
    return live_reason(sources, links, season, comp_id, ccfg, today, now) is not None


def recheck_order(comp_ids, now):
    """A rotation of the re-check-only competitions that is fixed for a given day,
    so a short budget doesn't skip the same states every day."""
    day = now.astimezone(dt.timezone.utc).date().isoformat()
    return sorted(comp_ids, key=lambda c: hashlib.sha1(f"{c}|{day}".encode()).hexdigest())


class Crawler:
    def __init__(self, sources, fetcher, force=False, log=None):
        self.sources = sources
        self.fetcher = fetcher
        self.force = force
        self.log = log or (lambda *a: print(*a))
        self.links = store.load_json(store.LINKS, {}) or {}
        self.crawled = []
        self.new_failures = []   # failures that changed a division's status (a repeat is quiet)
        self.slot = False        # this run started in the daily re-check slot
        self.today = None
        self.repeat_blocked = False  # a bracket that was already "blocked" was blocked again
        self.cif_base = sources["sources"]["cif"]["base"]
        self.mp_base = sources["sources"]["maxpreps"]["base"]
        self.genders = {"boys" if g == "b" else "girls" for g in sources.get("genders", ["b", "g"])}

    def save_links(self):
        store.write_json(store.LINKS, dict(sorted(self.links.items())))

    def crawl(self, season, comp_id, live, reason=None):
        """Crawl one competition. `reason` comes from live_reason() on --refresh
        runs and limits what is fetched; None (backfill, --season) crawls every
        incomplete division as before."""
        meta = self.sources["competitions"][comp_id]
        cfg = self.sources["seasons"][season]["competitions"][comp_id]
        entry = self.links.setdefault(season, {}).setdefault(comp_id, {"divisions": {}})
        status = entry.get("status")
        if status == "missing" and not live and not self.force:
            return
        relist = (reason is not None and self.slot and meta["source"] == "maxpreps" and status == "ok"
                  and season == self.sources["activeSeason"] and self.today is not None
                  and in_term(self.sources, season, comp_id, cfg, self.today))
        if status != "ok" or self.force or relist:
            if meta["source"] == "cif":
                self._discover_cif(season, comp_id, cfg, entry, live)
            else:
                self._discover_maxpreps(season, comp_id, meta, cfg, entry, live)
        for code, div in sorted(entry["divisions"].items()):
            if division_gender(div, code) in self.genders and self._should_fetch(season, comp_id, code, div, reason):
                self.crawl_division(season, comp_id, code, div)

    def _should_fetch(self, season, comp_id, code, div, reason):
        if reason is None or self.force:
            return True
        status = div.get("status")
        if status in FAILED and not _bracket_dates(season, comp_id, code):
            # Failed or blocked with no usable bracket yet: only the daily re-check retries it.
            # A bracket that has dates keeps the date rules, so one blip during its live window
            # is retried on the next run instead of the next day.
            return self.slot
        if status is None:
            return True           # newly listed: attempted once
        if reason == "dates":
            return True
        if reason == "pending":   # only what has no usable dates yet
            return not _bracket_dates(season, comp_id, code)
        return False              # "new" / "relist": nothing else

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
        """Fetch the tournament's list page and register its brackets.

        On a re-check of an "ok" list nothing is ever deleted or downgraded:
        brackets are matched by MaxPreps bracket id first, so a rename keeps its
        division code; a bracket no longer listed is kept (warning); a different
        bracket whose label maps to a taken code is not merged (warning), unless
        the code's own bracket is gone from the list and its division is not
        complete, in which case the code is re-pointed to the new bracket."""
        was_ok = entry.get("status") == "ok"
        where = f"{season} {comp_id}"
        try:
            _, html = self.fetcher.get(self.mp_base + cfg["list"], "maxpreps")
        except NotFound:
            if was_ok:
                self.log(f"warning: {where}: tournament list not found on re-check; keeping {len(entry['divisions'])} brackets")
                return
            entry["status"] = "pending" if live else "missing"
            self.log(f"{where}: tournament list not found ({entry['status']})")
            self.save_links()
            return
        except (OSError, http.client.HTTPException) as e:  # HTTPError, URLError, timeouts, resets
            self.log(f"warning: {where}: tournament list failed ({getattr(e, 'code', 'network')}); status kept")
            return
        drop = [self.sources["states"][meta["state"]]["association"]]
        found = maxpreps.parse_tournament(html, cfg["tournament"])
        if not found and was_ok:
            self.log(f"warning: {where}: tournament list is empty on re-check; keeping {len(entry['divisions'])} brackets")
            return
        entry["status"] = "ok" if found else "pending"
        divs = entry["divisions"]
        by_id = {d.get("bracket"): code for code, d in divs.items() if d.get("bracket")}
        listed = {b["id"] for b in found}
        for b in found:
            label = divisions.clean_label(b["name"], drop=drop)
            fields = {"name": b["name"], "label": label, "bracket": b["id"],
                      "maxpreps": self.mp_base + b["url"], "gender": meta.get("gender", "girls")}
            code = by_id.get(b["id"])
            if code is not None:
                if divs[code].get("name") != b["name"]:
                    self.log(f"warning: {where}: bracket {code} renamed to {b['name']!r}; code kept")
                divs[code].update(fields)
                continue
            code = divisions.code_for(label)
            old = divs.get(code)
            old_id = (old or {}).get("bracket")
            if old is None or old_id is None:
                divs.setdefault(code, {}).update(fields)
            elif old_id not in listed and not old.get("complete"):
                self.log(f"warning: {where}: bracket {code} replaced on MaxPreps ({old_id} -> {b['id']}); re-pointed")
                for k in ("status", "errorCode", "fetchedAt", "canonical", "complete"):
                    old.pop(k, None)
                old.update(fields)
                by_id[b["id"]] = code
            else:
                self.log(f"warning: {where}: {b['name']!r} maps to code {code}, which is bracket {old_id}; not merged")
        for code, d in sorted(divs.items()):
            if d.get("bracket") and d["bracket"] not in listed and was_ok:
                self.log(f"warning: {where}: bracket {code} is no longer listed; kept")
        self.log(f"{where}: {len(found)} brackets")
        self.save_links()

    def _fail(self, season, comp_id, code, div, status, error_code=None):
        """Record a failed attempt before anything propagates. A repeat of the
        same failure changes nothing, so it makes no commit."""
        repeat = div.get("status") == status and div.get("errorCode") == error_code
        if status == "blocked":
            self.repeat_blocked = repeat
        div["status"] = status
        if error_code is None:
            div.pop("errorCode", None)
        else:
            div["errorCode"] = error_code
        self.save_links()
        if not repeat:
            self.new_failures.append(f"{season}/{comp_id}/{code}: {status}"
                                     + (f" {error_code}" if error_code is not None else ""))
        self.log(f"{season} {comp_id} {code}: {status}" + (f" ({error_code})" if error_code is not None else "")
                 + (" (again)" if repeat else ""))

    def _get(self, season, comp_id, code, div, url, host_key):
        """fetcher.get for one division: (final_url, html), or None after recording
        the failure. Blocked is recorded and re-raised (the run stops);
        BudgetExhausted leaves the division untouched (no request was made)."""
        try:
            return self.fetcher.get(url, host_key)
        except NotFound:
            self._fail(season, comp_id, code, div, "missing")
        except Blocked:
            self._fail(season, comp_id, code, div, "blocked")
            raise
        except urllib.error.HTTPError as e:
            self._fail(season, comp_id, code, div, "error", e.code)
        except (OSError, http.client.HTTPException):
            # URLError, and errors while reading the body: timeouts, resets, IncompleteRead.
            self._fail(season, comp_id, code, div, "error", "network")
        return None

    def crawl_division(self, season, comp_id, code, div):
        raw = raw_path(season, comp_id, code)
        # A bracket with a champion never changes again.
        if div.get("complete") and raw.exists() and not self.force:
            return
        if not div.get("maxpreps"):
            got = self._get(season, comp_id, code, div, div["cif"], "cif")
            if got is None:
                return
            link = cif.parse_division(got[1])
            if not link:
                self._fail(season, comp_id, code, div, "no-bracket")
                return
            div["maxpreps"] = link
            self.save_links()
        got = self._get(season, comp_id, code, div, div["maxpreps"], "maxpreps")
        if got is None:
            return
        final_url, html = got
        try:
            bracket_html = maxpreps.trim(html)
            parsed = maxpreps.parse(bracket_html) if bracket_html is not None else None
        except Exception as e:  # unfamiliar markup must not crash the run (or be retried every run)
            self.log(f"{season} {comp_id} {code}: could not parse the bracket page ({type(e).__name__}: {e})")
            self._fail(season, comp_id, code, div, "error", "parse")
            return
        if bracket_html is None:
            self._fail(season, comp_id, code, div, "no-bracket")
            return
        fetched = now_iso()
        header = (f"<!-- source: {escape(final_url)} -->\n"
                  f"<!-- fetched: {fetched} -->\n")
        store.write_text(raw, header + bracket_html + "\n")
        div.pop("errorCode", None)
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
        crawler.slot = bool(args.refresh) and in_recheck_slot(sources, now)
        crawler.today = today
        plan = []
        for season, scfg in sources["seasons"].items():
            if args.season and season != args.season:
                continue
            for comp_id, ccfg in scfg["competitions"].items():
                if args.state and sources["competitions"][comp_id]["state"] != args.state.upper():
                    continue
                reason = live_reason(sources, crawler.links, season, comp_id, ccfg, today, now=now)
                if args.refresh and not reason:
                    continue
                # Only --refresh limits what a crawl fetches; backfill and --season crawl everything.
                plan.append((season, comp_id, reason is not None, reason if args.refresh else None))
        # Competitions live by their dates first, then the re-check-only ones in a daily rotation.
        dated = [p for p in plan if p[3] in ("dates", None)]
        others = [p for p in plan if p[3] not in ("dates", None)]
        rank = {c: i for i, c in enumerate(recheck_order(sorted({p[1] for p in others}), now))}
        plan = dated + sorted(others, key=lambda p: (rank[p[1]], p[0]))  # keyed by (season, comp)
        blocked = exhausted = False
        done = 0
        if args.refresh and not plan:
            print("no competition is live today; nothing to fetch")
        for season, comp_id, live, reason in plan:
            try:
                crawler.crawl(season, comp_id, live, reason)
                done += 1
            except Blocked as e:
                blocked = True
                print(f"blocked by bot protection at {e}; stopping this run", file=sys.stderr)
                break
            except BudgetExhausted:
                exhausted = True
                print("request budget exhausted; continue in the next run", file=sys.stderr)
                break
        # Re-check-only competitions this run did not finish (budget or bot challenge).
        skipped = sum(1 for p in (plan[done:] if blocked or exhausted else []) if p[3] not in ("dates", None))
        # Written only when the run did something, so a quiet daily re-check (or a repeat of
        # the same failure) makes no commit. updatedAt is when data last changed, not the last run.
        if plan and (crawler.crawled or crawler.new_failures or exhausted or (blocked and not crawler.repeat_blocked)):
            store.write_json(store.ARCHIVE / "refresh-state.json", {
                "schema": 1,
                "updatedAt": now_iso(),
                "mode": "refresh" if args.refresh else ("backfill" if args.backfill else "season"),
                "requests": fetcher.requests,
                "blocked": blocked,
                "budgetExhausted": exhausted,
                "recheckSkipped": skipped,
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
