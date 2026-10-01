# High School Girls Soccer Dashboard

A US high school girls soccer postseason dashboard: state championship brackets,
results, a champions grid and per-school playoff histories, state by state.

**Coverage:**
- **California (CIF):** the CIF State Championships (2026 onward) and the NorCal / SoCal Regional Championships before them (2018–2025).
- **2025-26 pilot:** Florida (FHSAA), Georgia (GHSA), Pennsylvania (PIAA), Texas (UIL) and Washington (WIAA).

The other states are being onboarded; the plan is in [docs/ONBOARDING.md](docs/ONBOARDING.md).

The architecture follows [ecnl-dashboard](https://github.com/NextOneTwoLabs/ecnl-dashboard):

- **Data:** a stdlib-only Python crawler writes raw and derived JSON into git.
- **API:** a Cloudflare Worker serves that JSON as a read-only `/api/v1`.
- **UI:** a static page with no build step.

Design notes are in [docs/DESIGN.md](docs/DESIGN.md).

## Layout

```
public/data/sources.json      registry: states, competitions, seasons -> CIF paths / MaxPreps tournament ids
crawler/                      hs.py (CLI), cif.py + maxpreps.py (parsers), divisions.py, discover.py, derive.py
archive/links.json            discovered division pages -> MaxPreps bracket URLs, fetch status
archive/raw/<season>/<comp>/<div>.html   trimmed MaxPreps bracket markup (provenance; never served)
archive/discovered/<season>.json         MaxPreps tournament candidates for review (--discover)
public/archive/               derived, served via /api/v1
export/<season>/*.csv         human-readable exports
api/routes.mjs, worker.js     Cloudflare Worker (route table twin: crawler/api_routes.py)
public/index.html, js/, css/  UI (ES modules, no bundler)
tests/                        parser fixtures, golden routes, worker contract tests
```

## Data flow

1. `sources.json` lists each state, its competitions (ID `<state>-<association>`, e.g. `tx-uil` or `ca-cif-state`) and, per school year, where each competition's brackets come from.
   - **`cif` source:** a cifstate.org path such as `brkts_2026`. The crawler reads that index for division pages, and each division page embeds a MaxPreps bracket widget.
   - **`maxpreps` source:** a MaxPreps tournament ID plus its list page. The list page names each division's bracket.
2. Every bracket is a MaxPreps bracket page. The crawler keeps only its bracket views (two halves, a championship view and play-in views, without page chrome) under `archive/raw/`.
3. `derive.py` rebuilds everything under `public/archive/` from the raw files.
   - It is deterministic and uses no network, and CI fails if the committed output is stale.
   - It skips any MaxPreps bracket whose schools aren't mostly in the expected state, which guards against a wrongly registered tournament.

Notes on the data:
- **Seasons** are school years (`2025-26`), whether a state plays in the fall, winter or spring.
- **Divisions** use each state's own names, e.g. "Conference 6A D1", "Class 7A", "1B/2B" or "Division 1". They are ordered largest class first, then D1, D2.
- **Schools** are identified by their **MaxPreps school GUID**, which stays stable across seasons. Duplicates can be merged in `public/data/school-aliases.json`.
- **Winners** come from MaxPreps' winner/loser markup or its "(W)" shootout mark, so games decided on **penalty kicks** have the correct winner (`decidedBy: "pk"`). In records they count as draws.
  - Without a marker, unequal scores decide the game. A winner from the score alone never names a champion, so such a bracket keeps being refetched.
  - Every main-bracket winner is checked against who actually plays in the next round (matched by school GUID; placement games excluded). That team wins over the markers and the score, `next` is pointed at its game, and derive prints a warning.
- **Byes** (`status: "bye"`) come only from MaxPreps' `is-bye` marker. They are not games: no W/L, not in `played`, not in the results feed; school pages list them as "Bye".
- **Unreported games:** a game whose date had passed when it was fetched but has no result is marked `unreported`. Example: Texas 5A D1 2026, whose final was never scored on MaxPreps. In a finished bracket (a champion, or nothing left to play) a school whose last game is unreported shows "Result not reported", never "Still alive".
- **Gender:** `"genders": ["g"]` in `sources.json` limits crawling, derived output and the UI to girls.

## Commands

```bash
python -m crawler.hs --refresh            # crawl competitions that are live today (no-op otherwise)
python -m crawler.hs --backfill           # crawl every registry season not yet complete
python -m crawler.hs --season 2025-26     # one season (add --state TX for one state)
python -m crawler.hs --discover 2026-27   # list MaxPreps tournaments for review (3 requests)
python -m crawler.hs --derive --export    # rebuild public/archive and export/ from raw (offline)
python -m crawler.hs --derive --check     # drift check (CI)
python dev_server.py                      # http://localhost:8787, same /api/v1 as the Worker
PYTHONPATH=tests/netguard python -m unittest discover -s tests -p 'test_*.py'
node --test "tests/*.test.mjs"
npx wrangler dev                          # Worker locally
```

## Adding a state

1. Run `python -m crawler.hs --discover <season>` and find the state association's tournament in `archive/discovered/<season>.json`.
2. Add the state to `states`, a `<st>-<association>` competition with `"source": "maxpreps"` and its `term`, and the season entry `{ "tournament": "<id>", "list": "<list url>" }` to `public/data/sources.json`.
3. Run `python -m crawler.hs --season <season> --state <ST> --export`, then check the brackets on the dev server.

## Fetching policy

Fetching is low-rate and done for personal use:
- **Delays:** 8 s between requests to cifstate.org and 4 s to MaxPreps.
- **Budget:** each run has a request limit (60 by default).
- **Refetching:** a division whose bracket has a champion is never fetched again.
- **Bot challenges:** an AWS WAF or Cloudflare challenge response stops the run. The crawler never tries to solve or bypass one.
- **CIF domain:** `cifstate.prestosports.com` is behind a Cloudflare challenge, so the crawler uses the official `www.cifstate.org` domain, which serves the same pages.
- **MaxPreps:** `robots.txt` allows `/tournament/`. The crawler does not fetch `/school/`, `/team/` or `/contest/` pages.

## API (`/api/v1`, GET/HEAD, JSON)

| Route | Returns |
|---|---|
| `/states` | coverage: each state, its association, seasons and latest champions |
| `/states/{ST}/catalog` | that state's seasons → competitions → divisions, with status, champion and runner-up |
| `/states/{ST}/seasons/{YYYY-YY}/games` | that state's games for one season |
| `/states/{ST}/schools` | that state's school directory |
| `/seasons/{YYYY-YY}/competitions/{comp}/divisions/{div}/bracket` | normalized bracket |
| `/schools/{id}` | one school's appearances, games and summary |
| `/schools` | full school directory |
| `/search-index` | compact `[id, name, city, state, apps, titles]` rows for search |
| `/catalog` | every state's catalog in one file (schema 2) |
| `/seasons/{YYYY-YY}/games` | every state's games for a season |
| `/status` | last crawl: time, requests, blocked, failures |
| `/sources` | the registry |

- **Errors:** always `{ok:false, error}` with `Cache-Control: no-store`. The API returns 400, 404, 405 (with an `Allow` header) and 429.
- **Caching:** closed seasons are cacheable for a day. Everything else uses `no-cache` with ETags.
