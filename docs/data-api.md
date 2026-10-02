# Data API v1

The site reads all of its published data through a same-origin, read-only API at `/api/v1/*`. This document is the
contract for that API **as it is today**. It is checked against the code by `tests/api_docs_agree.test.mjs`, so a
route, rule or limit that changes in one place and not the others fails CI.

The code lives in:
- `api/routes.mjs`: the route table, the parameter rules and the cache policy;
- `worker.js`: the Cloudflare Worker that serves the API in production;
- `crawler/api_routes.py`: the Python twin used by `dev_server.py` and the Python tests;
- `tests/routes.json`: the golden cases both twins are checked against;
- `wrangler.toml`: the rate-limit bindings.

The planned changes (#8: `high-schools` renames, no CORS, an access gate) are not described here yet. Each will update
this document in the same pull request.

## Routes

Every route answers `GET` and `HEAD`. A body is the published file's bytes, unchanged, as `application/json`.

| Route | Published file | Season-cached |
|---|---|---|
| `/api/v1/catalog` | `/archive/catalog.json` | no |
| `/api/v1/status` | `/archive/refresh-state.json` | no |
| `/api/v1/sources` | `/data/sources.json` | no |
| `/api/v1/states` | `/archive/states.json` | no |
| `/api/v1/search-index` | `/archive/search-index.json` | no |
| `/api/v1/schools` | `/archive/schools.json` | no |
| `/api/v1/schools/{id}` | `/archive/schools/{id}.json` | no |
| `/api/v1/states/{ST}/catalog` | `/archive/states/{ST}/catalog.json` | no |
| `/api/v1/states/{ST}/schools` | `/archive/states/{ST}/schools.json` | no |
| `/api/v1/states/{ST}/seasons/{season}/games` | `/archive/states/{ST}/seasons/{season}/games.json` | yes |
| `/api/v1/seasons/{season}/games` | `/archive/seasons/{season}/games.json` | yes |
| `/api/v1/seasons/{season}/competitions/{comp}/divisions/{div}/bracket` | `/archive/brackets/{season}/{comp}/{div}.json` | yes |

What each returns:
- **`catalog`:** every state's seasons, competitions and divisions in one file (schema 2).
- **`status`:** the last crawl run that changed something: `updatedAt`, requests, blocked, budget, crawled and failed.
  `updatedAt` is when data last changed, not the last cron run.
- **`sources`:** the crawl registry (`public/data/sources.json`).
- **`states`:** coverage, one row per state, with its association, seasons and latest champions.
- **`search-index`:** compact `[id, name, city, state, apps, titles]` rows for the header search.
- **`schools`:** the full school directory. **`schools/{id}`:** one school's appearances, games and summary.
- **`states/{ST}/catalog`:** that state's seasons → competitions → divisions, with status, champion and runner-up.
- **`states/{ST}/schools`:** that state's school directory.
- **`states/{ST}/seasons/{season}/games`** and **`seasons/{season}/games`:** one state's, or every state's, games
  for a season.
- **`…/bracket`:** one normalized bracket.

## Parameters

A parameter that breaks its rule is answered **400** with the error below, before any file is read.

| Parameter | Rule | Error |
|---|---|---|
| `{season}` | `YYYY-YY`, with consecutive years (`2025-26`) | `invalid season (expected YYYY-YY)`, or `invalid season (years must be consecutive)` |
| `{ST}` | two capital letters (`TX`) | `invalid state (expected two capital letters, e.g. TX)` |
| `{comp}` | `^[a-z][a-z0-9-]{1,40}$` (`tx-uil`) | `invalid competition id` |
| `{div}` | `^[a-z0-9][a-z0-9-]{0,29}$` (`6a-d1`) | `invalid division code` |
| `{id}` | `^[a-z0-9][a-z0-9-]{2,100}$` (a MaxPreps school GUID) | `invalid school id` |

A valid parameter whose file doesn't exist is **404** `not found`.

## Answers

**Success:**
- `200` with the file, or `304` with no body when `If-None-Match` matches the file's `ETag`. HEAD never has a body.
- Headers: `Content-Type: application/json; charset=utf-8`, `ETag`, `Cache-Control` (see below),
  `Access-Control-Allow-Origin: *` and `X-Content-Type-Options: nosniff`.

**Errors** are always JSON, `{"ok": false, "error": "…"}`, with `Cache-Control: no-store` and
`Access-Control-Allow-Origin: *`. They never fall through to HTML.

| Status | Error | When |
|---|---|---|
| 400 | one of the parameter errors above | a parameter breaks its rule |
| 404 | `unknown API route` | no route matches the path |
| 404 | `not found` | the route matches but there is no such file, or storage answered with something other than JSON |
| 405 | `method not allowed` | a method other than GET or HEAD; the answer carries `Allow: GET, HEAD` |
| 429 | `rate limited` | over the rate limit; the answer carries `Retry-After: 60` |
| 503 | `storage unavailable` | the asset store failed |

**Raw data is not served:** `/archive/*` and `/data/*` answer **404** `not found` (JSON), so the page reads data only
through this API. `wrangler.toml`'s `run_worker_first` sends those paths to the Worker.

## Cache

| Answer | `Cache-Control` |
|---|---|
| a season-cached route for a season before the active one (a closed season) | `public, max-age=86400, stale-while-revalidate=86400` |
| every other success | `no-cache` (revalidate with the ETag) |
| every error | `no-store` |

The active season is `activeSeason` in `sources.json`. If it can't be read, everything is `no-cache`.

## Rate limit

| Binding | Key | Limit | Where |
|---|---|---|---|
| `RL_IP` | `CF-Connecting-IP` | 600 per 60 s | production (namespace 2001) |
| `RL_IP` | `CF-Connecting-IP` | 600 per 60 s | Workers Builds previews (namespace 2002) |

- The limit is optional: without the binding, the Worker serves without a limit.
- Over the limit, the answer is **429** `rate limited` with `Retry-After: 60`.
- Cloudflare's counters are per location and approximate.

## The local dev server

`python dev_server.py` serves the same routes through `crawler/api_routes.py`, with the same envelope, errors,
`ETag`/304 and cache policy. It sends no `Access-Control-Allow-Origin` and has no rate limit.
