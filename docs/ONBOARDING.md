# Onboarding other states: plan for review

Status: **proposal (2026-10-01)**. Nothing below has been built or crawled yet. The only
change made so far is the US-wide wording on the site and in the README.

## 1. What I found

MaxPreps hosts the **official state championship brackets** for nearly every state
association. Its girls soccer tournament index is organized by season and term, and
`/tournament/` is allowed by MaxPreps' robots.txt:

| MaxPreps index page | Term | School year |
|---|---|---|
| `/tournament/girls-soccer-25.htm` | fall 2025 | 2025-26 |
| `/tournament/girls-soccer-winter-25-26.htm` | winter 2025-26 | 2025-26 |
| `/tournament/girls-soccer-spring-26.htm` | spring 2026 | 2025-26 |
| `/tournament/girls-soccer-26.htm` | fall 2026 (**in progress now**) | 2026-27 |

Each tournament has a list page (`/tournament/list/<id>/...`) naming its brackets, e.g.
UIL Texas "Conference 6A D1 … 4A D2". Each bracket uses **the same markup the current
California parser reads**. I checked a Texas 6A bracket: rounds, dates, penalty-kick
games and school GUIDs all came through unchanged.

### State association championships found for 2025-26

| Term | States (association) |
|---|---|
| Fall (25) | AZ (AIA, moving to fall in 2026-27), CT (CIAC), DC (DCSAA), ID (IDHSAA), IN (IHSAA), KY (KHSAA), MA (MIAA), MD (MPSSAA), ME (MPA), MN (MSHSL), MT (MHSA), NH (NHIAA), NJ (NJSIAA), NM (NMAA)\*, NV (NIAA), NY (NYSPHSAA), OH (OHSAA), OR (OSAA), PA (PIAA), RI (RIIL), SD (SDHSAA), TN (TSSAA), UT (UHSAA), VT (VPA), WA (WIAA), WV (WVSSAC) |
| Winter (7) | CA (CIF State + 10 sections), FL (FHSAA)\*, HI (HHSAA), LA (LHSAA), MS (MHSAA)\*, TX (UIL), AZ (AIA, 2025-26) |
| Spring (18) | AK (ASAA), AL (AHSAA)\*, AR (AAA), CO (CHSAA), DE (DIAA), GA (GHSA), IA (IGHSAU), IL (IHSA), KS (KSHSAA), MI (MHSAA), MO (MSHSAA), NC (NCHSAA)\*, ND (NDHSAA), NE (NSAA), OK (OSSAA), SC (SCHSL), VA (VHSL), WI (WIAA) |

- **That's 49 states plus DC.** Wyoming (WHSAA, spring) is the only state not found in the MaxPreps index, so it needs another source or waits.
- **\* = needs confirming:** the tournament title doesn't name the state. I matched it from its class names, e.g. FHSAA uses 7A–1A and MHSAA uses "Class I, 4A–7A".
- **Also listed but excluded from the first pass:** private and independent associations (VISAA, GIAA, GAPPS, NCCSA, PPL), invitationals, a "test" tournament, and sub-state rounds (Florida districts, Virginia region brackets, New York sections).

## 2. Proposed scope for the first pass
- **Competitions:** one competition per state, the **state association's state championship**, girls only.
- **Seasons:** **2025-26** first, then **2026-27 live**, since the fall states are playing now, then a backfill to 2017-18.
- **California:** stays as it is. Its CIF sections, such as Southern Section and North Coast Section, are a later phase.

## 3. Changes needed

### Data model
- **State:** a new dimension. Competition IDs become `<state>-<association>`, e.g. `tx-uil` or `ga-ghsa`.
  - California's IDs become `ca-cif-state`, `ca-cif-norcal` and `ca-cif-socal`.
  - The UI will keep accepting old links that use `cif-state`.
- **Divisions:** become free-form per state. The code is a slug of the bracket name, such as `6a-d1`, `class-aaa`, `1b-2b` or `d1`, and each division gets an explicit label, sort order and gender.
  - The current `gd1`-style codes and the assumption that the first letter is the gender go away.
- **Season:** remains the **school year** (`2025-26`), whatever the term, with the term (`fall` / `winter` / `spring`) recorded on the competition. The current fall states are 2026-27.
- **Parser:** gains multi-view brackets.
  - Big states such as Texas split a 64-team bracket into two half views plus a separate "Final Four" championship view. Today `trim()` keeps only the first view, so the Texas state final and champion are missed.
  - The parser will merge all views and keep third-place games separate.
- **Raw storage:** stays at one trimmed file per bracket. Mascot images and other markup are stripped to keep it around 15 KB, which keeps a full backfill near 40 MB.

### Discovery
- **Discovery command:** a new `crawler.hs --discover <season>` reads the three MaxPreps index pages for that school year and writes **candidate** tournaments to `archive/discovered/<season>.json`.
  - Each candidate records the title, the MaxPreps ID and a guessed state, taken from the title and from the school paths (`/tx/...`) in its first bracket.
- **Registry:** I review the candidates and add the approved ones to `sources.json` as `states.<ST>.seasons.<season>.tournament = <MaxPreps id>`.
  - Nothing is crawled until it's in the registry, the same rule California follows today.
- **Brackets:** each tournament's list page names its brackets, and those map to divisions.

### Refresh
- **Live windows:** the dates come from the bracket's own round dates. A competition is live while it has unplayed games and today is within a few days of a round, so there's no need to hand-maintain windows for 50 states.
- **Cron:** the GitHub cron runs **all year**, because fall, winter and spring tournaments overlap. Off-season runs make no requests.
- **Weekly discovery:** a weekly run checks the current school year's index pages so new tournaments get flagged for review.

### API (v1, additive: existing routes keep working)

| New route | Returns |
|---|---|
| `/api/v1/states` | coverage: each state, its association, seasons and current status |
| `/api/v1/states/{ST}/catalog` | that state's seasons → competitions → divisions, with champions |
| `/api/v1/states/{ST}/seasons/{season}/games` | games for one state and season |
| `/api/v1/states/{ST}/schools` | that state's school directory |
| `/api/v1/search-index` | compact name, state and ID index for the header search (about 1 MB for around 20k schools) |

- **Brackets:** keep the existing route. The competition ID now contains the state.
- **Why split per state:** a single catalog or school list for 50 states would be several MB.

### UI
- **Home (new "States" tab):** a US overview with a grid of states, each showing its association, term, latest champion per division and a **live** badge while its tournament is running.
- **State picker:** in the controls row. Brackets, Results and Champions become per state.
- **Schools:** a state filter, and the header search covers all states.
- **Labels:** each state's own division names, e.g. "Conference 6A D1" or "Class AAA".

## 4. Request volume and politeness
- **Per state and season:** about one list page plus each of its brackets. Most states have 3–8 brackets; Texas has 6, Florida 7, Washington 5 and Pennsylvania 4.
- **Per season:** about **50 list pages and ~300 brackets**.
- **Pace:** at 4 s each on MaxPreps, one school year takes about 25 minutes. The full backfill (2017-18 to 2026-27) is about 3,000 requests.
- **How it runs:** the backfill is spread over several runs with the existing per-run budget. The rules stay the same: a bracket with a champion is never refetched, and any bot challenge stops the run.

## 5. Rollout
1. **Model and parser:** state, free-form divisions, term, multi-view brackets and the California ID migration. Includes tests using saved Texas and Florida bracket pages, and **no new data**.
2. **Pilot, 5 states, 2025-26:** TX (multi-view), FL (7 classes, winter), GA (spring), PA (fall) and WA (odd class names like 1B/2B).
   - I check the brackets, champions and school pages against the source.
   - **You review the result on a preview before it ships.**
3. **All states, 2025-26:** the remaining 44 plus DC, after confirming the \* states.
4. **Live 2026-27:** the fall states (in progress now), then winter and spring as they start.
5. **Backfill** to 2017-18.
6. **Later:** CA sections, private associations, Wyoming, boys.

## 6. Decisions for you
1. **California IDs:** rename them to `ca-cif-*` now, while the site is new, keeping the old links working? (Recommended.)
2. **Private and independent associations:** exclude them in the first pass? (Recommended.)
3. **Pilot states:** TX, FL, GA, PA and WA, or do you prefer others?
4. **Backfill depth:** back to 2017-18 like California, or fewer seasons to start?
