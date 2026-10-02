# High School Soccer Dashboard: Design & Plan

## 0. Decisions (2026-10-01)
- **Scope:** CIF State playoffs only for now, with section playoffs later. Before 2026 this means the NorCal/SoCal **Regional** championships, the predecessor of the State format.
- **Gender:** **girls only** for now, set with `"genders": ["g"]` in `sources.json`. Boys can be turned back on through config.
- **Hosting:** Cloudflare Workers.
- **Fetching:** low-rate, for personal use, and never bypassing bot challenges.
  - `cifstate.prestosports.com` serves a Cloudflare challenge, so the crawler uses **`www.cifstate.org`**, which serves the same PrestoSports pages.
  - That site's AWS WAF starts challenging after about 30 rapid requests, so the crawler waits 8 s between requests and stops the run on any challenge.
- **Backfill:** the archive covers every season the site still has:
  - 2017-18, 2018-19 and 2021-22 to 2024-25 (NorCal + SoCal)
  - 2020-21 (SoCal only)
  - 2025-26 (State)
  - 2019-20 was cancelled.
- **School ID:** the MaxPreps school GUID (`data-school-id`), which beats slug-based IDs. Penalty-kick winners come from the `matchwinner` class.

Sections 1–8 below are the original proposal. The sections that changed during the build are 3 (raw HTML is trimmed to the bracket markup, and seasons are mapped to per-season paths), 4 (routes listed in the README) and 8 (the risks were resolved as described above).

## 1. What exists today

### The high school code in `zhenyisx/soccer-agent`
- **Scraper:** `cif_scraper.py` (`CifSoccerScraper`) scrapes the **CIF State Championship brackets**.
  - Index page: `cifstate.prestosports.com/sports/soccer/brkts_2026/index`.
  - It covers 10 divisions, `bd1–bd5` and `gd1–gd5`.
  - Each division page embeds a MaxPreps bracket, which the scraper parses for rounds, games, seeds, scores, venue and team URLs.
- **API and page:** a Flask blueprint (`routes/high_school.py`) serves `GET /api/high-school/cif/scores[?refresh=1]` and the page `templates/cif_dashboard.html`, which shows boys and girls tables per division.
- **Storage:** a single overwritten JSON cache, `data/high_school/cif_scores_cache.json`. It is git-ignored, so a fresh clone has **no stored data**.
- **Gaps:**
  - The season is hardcoded to 2026, and nothing keeps history.
  - There are no stable school IDs.
  - Scores like "2 (4)" are parsed as 24, so penalty-kick results are wrong.
  - Home/away is guessed from bracket order.
  - "Final" just means both scores are present.
  - There is no schedule or scheduler.
  - The page ignores seed, venue, round date and team links.
  - There are no regular-season, standings, roster or section data.

### The reference: `NextOneTwoLabs/ecnl-dashboard`
It has no build step and no database:
1. **Registry:** `public/data/sources.json` lists seasons, events, refresh policy and URL templates.
2. **Crawler:** a stdlib-only Python crawler (`archive.py`) writes a raw JSON mirror plus derived indexes into git.
   - Each derived file carries a `schema` version.
   - Rows are written one per line, so diffs stay small.
3. **API:** a Cloudflare Worker serves a read-only `/api/v1` that maps each route to one archived file.
   - It validates IDs, returns errors as `{ok:false,error}`, and passes ETags through.
   - Closed seasons get a long cache.
   - It has session-cookie and API-key rate limits.
4. **UI:** one static `index.html` (about 6k lines) with hash routing, sortable tables, match cards, bracket trees built from games, team history with an SVG chart, light/dark tokens and favourites.
5. **Ops and tests:**
   - GitHub Actions runs a match-day-aware refresh, commits the data, and the push deploys.
   - Tests include netguard (no network in tests), golden route fixtures shared by JS and Python, and a CI drift check on derived files.

## 2. Design principles
- **Same architecture as ECNL:** git-backed JSON, a thin versioned API and a static UI. Hosting stays near-free, everything works offline, and git is the history.
- **One improvement:** the UI uses native ES modules (`public/js/*.js`) instead of one 6k-line file. There is still no build step.
- **Stable IDs from day one:** a school ID is derived from the MaxPreps school slug, with a manual alias file. This makes cross-season history possible, which the current code cannot do.
- **Source adapters:** each upstream (CIF State, and later CIF sections) is a separate adapter that produces normalized records. This keeps fragile HTML parsing isolated and testable against saved HTML fixtures.

## 3. Data layer

### Layout
```
public/data/sources.json                registry: seasons, competitions, divisions, refresh windows
public/archive/raw/<source>/<season>/<division>.html     raw HTML snapshot (provenance; re-parse without re-fetch)
public/archive/brackets/<season>/<division>.json         normalized bracket   (schema:1)
public/archive/schools.json                              school directory     (schema:1)
public/archive/schools/<schoolId>.json                   school history       (schema:1)
public/archive/seasons/<season>/summary.json             champions, finalists, counts per division
public/archive/refresh-state.json                        last run that changed something: requests, failures
public/data/school-aliases.json                          manual merge/rename overrides
export/<season>/<division>.csv                           human-readable export
```

### Registry (`sources.json`)
```json
{ "activeSeason": "2025-26",
  "seasons": { "2025-26": { "endYear": 2026,
     "competitions": { "cif-state": {
        "label": "CIF State Championships",
        "indexUrl": "https://cifstate.prestosports.com/sports/soccer/brkts_2026/index",
        "window": { "start": "2026-02-28", "end": "2026-03-08" },
        "divisions": ["bd1","bd2","bd3","bd4","bd5","gd1","gd2","gd3","gd4","gd5"] } } } },
  "refresh": { "everyMinutes": 30, "outsideWindow": "skip" } }
```
- Seasons are labelled `YYYY-YY`, because the high school winter season spans two calendar years. The season-specific URL lives here rather than in code.

### Normalized bracket (`brackets/<season>/<division>.json`)
```json
{ "schema": 1, "season": "2025-26", "competition": "cif-state",
  "division": { "code": "bd1", "gender": "boys", "level": 1, "label": "Boys Division 1" },
  "source": { "url": "...", "maxprepsUrl": "...", "fetchedAt": "..." },
  "rounds": [{ "index": 0, "name": "Regional First Round", "date": "2026-03-03" }],
  "games": [{
    "id": "bd1-r0-m3", "round": 0, "date": "2026-03-03", "time": "18:00", "venue": "...",
    "status": "final|scheduled|in_progress|postponed|forfeit",
    "top":    { "schoolId": "mater-dei-santa-ana-ca", "name": "Mater Dei", "seed": 1, "score": 2, "pk": 4 },
    "bottom": { "schoolId": "...", "name": "...", "seed": 8, "score": 2, "pk": 3 },
    "winner": "top", "home": "top|bottom|null" }] }
```
- Teams are recorded as `top` and `bottom`. `home` is filled in only when the source states it. This fixes the current home/away guess.
- Penalty-kick scores are kept in a separate `pk` field. `winner` is computed by the parser.

### School directory and history
- `schools.json` lists each school once: `{id, name, city?, section?, maxprepsUrl, aliases[]}`.
- Each school's history file holds one row per season:
  `{season, competition, division, seed, reached, champion, w, l, t, gf, ga, games:[gameId...]}`.

### Crawler (`crawler/`, Python 3.12, stdlib only)
- **Commands:**
  - `hs.py --refresh`: fetches only competitions whose window is open, and skips quickly otherwise.
  - `--season 2024-25`: backfill.
  - `--reparse`: rebuild from raw HTML with no network.
  - `--derive`: rebuild schools and histories.
  - `--check`: drift check for CI.
  - `--export`: CSV.
- **Ported from `cif_scraper.py`:** the fixes listed above.
- **Patterns borrowed from ECNL:** atomic writes, a request budget, retry with backoff, and only writing files that changed.
- **Scheduling:** a GitHub Actions cron runs every 30 minutes from 15:00 to 06:00 UTC. It is a no-op outside a competition window, plus a weekly sweep. It commits with `git add -A`.

## 4. API layer (Cloudflare Worker, `/api/v1`, read-only)

| Route | Returns |
|---|---|
| `GET /api/v1/catalog` | `sources.json` (seasons, competitions, divisions) |
| `GET /api/v1/status` | `refresh-state.json`. `updatedAt` is when data last changed (a crawl, a new failure, a budget stop), not the last cron run: quiet runs write nothing, so watch run health on the Actions page |
| `GET /api/v1/seasons/{season}/summary` | champions and finalists for each division |
| `GET /api/v1/seasons/{season}/competitions/{comp}/divisions/{code}/bracket` | normalized bracket |
| `GET /api/v1/schools` | school directory, used for search |
| `GET /api/v1/schools/{schoolId}` | school history |

- **Validation:**
  - Season: `^\d{4}-\d{2}$`, with consecutive years.
  - Division code: `^[bg]d[1-9]$`.
  - School ID: `^[a-z0-9-]{3,80}$`.
- **Errors and caching:** same conventions as ECNL.
  - Errors are `{ok:false,error}` with `no-store`.
  - 400, 404, 405 and 503 are returned. A missing asset never falls through to HTML.
  - Default caching is `no-cache` with ETags. Closed seasons get `max-age=86400, stale-while-revalidate`.
- **Local twin:** `dev_server.py` serves the same routes from disk for offline development, checked against shared golden cases in `tests/routes.json`.
- **Rate limits:** ECNL's session cookie and API-key layer is an optional phase-3 port. The data is small and public, so a single IP rate limit is enough at first.

## 5. UI layer (`public/`, static, ES modules, no build)
- **Header:** season picker, gender toggle (Boys/Girls), search box (`/` shortcut) and theme toggle.
- **Tabs, using hash routes:**
  1. **State Playoffs** (`#tab=playoffs&season=&div=gd2`):
     - A division picker and a bracket tree per division, with a seed, score and PK badge on each match.
     - A live/final/upcoming status, the venue and date on hover or tap, and a highlight of a school's path.
     - Phone layout: a round-by-round list instead of the tree.
  2. **Results** (`#tab=results&date=`): date-grouped match cards across divisions, with an upcoming/results/all filter.
  3. **Champions** (`#tab=champions`): a season-by-season grid of champions and finalists for each division.
  4. **School page** (`#school=<id>`):
     - An "at a glance" card: best finish, titles, appearances.
     - The playoff path for this season, a history table, and a finishing-round SVG chart.
     - A follow star (`localStorage`).
- **Routes since #20:** the Main nav is Teams · Results · Playoffs (header nav; a bottom bar on phones).
  - `#tab=teams` (the school list with `st`, `q` or `view=list`), `#tab=team&school=<id>`, `#tab=results`,
    `#tab=playoffs` (`view=champions` for Champions) and `#tab=about`.
  - The old Schools, School, States and Champions links (and `#school=<id>`) still open the same content; `public/js/nav.js` maps them.
- **Reused from ECNL:**
  - The light/dark CSS token set.
  - The column-definition table renderer (sortable).
  - The match card and glance-panel patterns.
  - `historyChartSvg`, the `fetchJSON` error handling, and hash deep links.
- **Modules:** `api.js` (fetch and cache), `router.js`, `views/{playoffs,results,champions,school}.js` and `components/{bracket,table,matchCard,chart}.js`.

## 6. Repo layout
```
crawler/  hs.py  sources/cif_state.py  normalize.py  derive.py  io.py
api/      data-api.mjs  archive-reader.mjs
worker.js  wrangler.toml  dev_server.py
public/   index.html  css/  js/  data/  archive/
tests/    fixtures/html/  routes.json  *.test.mjs  test_*.py  netguard/
.github/workflows/ refresh.yml  ci.yml
docs/     DESIGN.md  data-api.md
```

## 7. Plan (milestones)
1. **M1 Data:**
   - Port the CIF State adapter with its fixes, using HTML fixtures.
   - Write the normalized brackets for 2025-26 and backfill earlier seasons that exist.
   - Derive schools and histories.
   - Unit tests.
2. **M2 API:** Worker routes plus the local dev server, golden route tests and the cache policy.
3. **M3 UI:** playoffs bracket, results, champions and school page; responsive layout and dark mode.
4. **M4 Ops:** GitHub Actions refresh, CI (tests and drift check), and Cloudflare deploy.
5. **M5 (optional):** CIF section playoffs (e.g. CIF-SS, NCS, CCS, SDS), which turn this from "state finals" into a real high school dashboard. Also league standings, if a usable public source exists.

## 8. Risks and open questions
- **Source access:** a plain `curl` to `cifstate.prestosports.com` returned **HTTP 403** today for 2024–2026. It looks like bot protection.
  - The existing scraper may now fail too. This has to be confirmed before M1 (browser-like headers, or a manual or Selenium snapshot).
- **MaxPreps terms:** the bracket data comes from MaxPreps, whose terms restrict automated scraping.
  - Options: use only the CIF-hosted pages, a low-rate fetch for personal use, or look for an official feed.
- **Thin scope:** state finals alone give about 10 brackets a year. The dashboard becomes much more valuable with section playoffs (M5).
- **Hosting:** Cloudflare like ECNL (recommended), or keep it inside the soccer-agent Flask app.
