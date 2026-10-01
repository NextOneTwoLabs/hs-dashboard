# CIF Girls Soccer Dashboard

California high school girls soccer postseason dashboard: CIF State Championship
brackets (2026 onward) and the NorCal / SoCal Regional Championships before them
(2018–2025), with results, a champions grid and per-school playoff histories.

The architecture follows [ecnl-dashboard](https://github.com/NextOneTwoLabs/ecnl-dashboard):

- **Data:** a stdlib-only Python crawler writes raw and derived JSON into git.
- **API:** a Cloudflare Worker serves that JSON as a read-only `/api/v1`.
- **UI:** a static page with no build step.

Design notes are in [docs/DESIGN.md](docs/DESIGN.md).

## Layout

```
public/data/sources.json      registry: seasons, competitions, cifstate.org paths, refresh windows, genders
crawler/                      hs.py (CLI), cif.py + maxpreps.py (parsers), derive.py, fetch.py, store.py
archive/links.json            discovered CIF division pages -> MaxPreps bracket URLs
archive/raw/<season>/<comp>/<div>.html   trimmed MaxPreps bracket markup (provenance; never served)
public/archive/               derived, served via /api/v1 (catalog, brackets, seasons, schools)
export/<season>/*.csv         human-readable exports
api/routes.mjs, worker.js     Cloudflare Worker (route table twin: crawler/api_routes.py)
public/index.html, js/, css/  UI (ES modules, no bundler)
tests/                        parser fixtures, golden routes, worker contract tests
```

## Data flow

1. `sources.json` gives each season's competition path, e.g. `brkts_2026` or `NorCal_brkts_2025`.
2. The crawler fetches `https://www.cifstate.org/sports/soccer/<path>/index` to discover division pages.
3. Each division page embeds a MaxPreps bracket widget, and the crawler fetches that bracket.
4. Only the bracket's `<div class="rounds">` markup is kept under `archive/raw/`.
5. `derive.py` rebuilds everything under `public/archive/` from the raw files. It is deterministic and uses no network, and CI fails if the committed output is stale.

Notes on the data:
- Schools are identified by their **MaxPreps school GUID**, which stays stable across seasons. Duplicates can be merged in `public/data/school-aliases.json`.
- Winners come from MaxPreps' winner/loser markup, so games decided on **penalty kicks** have the correct winner (`decidedBy: "pk"`). In records they count as draws.
- `"genders": ["g"]` in `sources.json` limits crawling, derived output and the UI to girls. Add `"b"` to bring the boys side back. Boys brackets already in `archive/raw/` will be published without refetching.

## Commands

```bash
python -m crawler.hs --refresh            # crawl competitions whose window is open (no-op otherwise)
python -m crawler.hs --backfill           # crawl every registry season not yet complete
python -m crawler.hs --season 2025-26     # one season
python -m crawler.hs --derive --export    # rebuild public/archive and export/ from raw (offline)
python -m crawler.hs --derive --check     # drift check (CI)
python dev_server.py                      # http://localhost:8787, same /api/v1 as the Worker
PYTHONPATH=tests/netguard python -m unittest discover -s tests -p 'test_*.py'
node --test "tests/*.test.mjs"
npx wrangler dev                          # Worker locally
npx wrangler deploy                       # deploy to Cloudflare
```

## Fetching policy

Fetching is low-rate and done for personal use:
- **Delays:** 8 s between requests to cifstate.org and 4 s to MaxPreps.
- **Budget:** each run has a request limit (60 by default).
- **Refetching:** a division whose bracket has a champion is never fetched again.
- **Bot challenges:** an AWS WAF or Cloudflare challenge response stops the run. The crawler never tries to solve or bypass one.
- **Domain:** `cifstate.prestosports.com` is behind a Cloudflare challenge, so the crawler uses the official `www.cifstate.org` domain, which serves the same pages.
- **MaxPreps:** `robots.txt` allows `/tournament/`. The crawler does not fetch `/school/`, `/team/` or `/contest/` pages.

## API (`/api/v1`, GET/HEAD, JSON)

| Route | Returns |
|---|---|
| `/catalog` | seasons → competitions → divisions, with status, champion and runner-up |
| `/status` | last crawl: time, requests, blocked, failures |
| `/sources` | the registry |
| `/seasons/{YYYY-YY}/games` | every game of a season, for the Results tab |
| `/seasons/{YYYY-YY}/competitions/{comp}/divisions/{gd1..}/bracket` | normalized bracket |
| `/schools` | school directory, for search |
| `/schools/{id}` | one school's appearances, games and summary |

- **Errors:** always `{ok:false, error}` with `Cache-Control: no-store`. The API returns 400, 404, 405 (with an `Allow` header) and 429.
- **Caching:** closed seasons are cacheable for a day. Everything else uses `no-cache` with ETags.
