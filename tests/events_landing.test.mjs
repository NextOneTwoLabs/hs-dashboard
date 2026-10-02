// #30 PR 1: the Events landing (one card per division tournament in one school year, grouped by state), its
// filters (no "Find an event" band since #31 PR 2), its requests, and Events' sub-pages. Offline: the shared view
// harness (netguard fetch over the local files through api/routes.mjs, no DOM library).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LOS_GATOS, api, nav, open, read, root } from './helpers/views.mjs';
import { resolve as route } from '../api/routes.mjs';

const json = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const catalog = await json('public/archive/catalog.json');
const statesIndex = await json('public/archive/states.json');
const ev = await import('../public/js/views/events.js');
const util = await import('../public/js/util.js');
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// Every request the page makes goes through fetch: count them per path (the harness's fetch does the work).
const counts = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const path = new URL(String(input), 'http://hs.test').pathname;
  counts.set(path, (counts.get(path) || 0) + 1);
  return realFetch(input, init);
};
const count = (path) => counts.get(path) || 0;
const total = () => [...counts.values()].reduce((t, n) => t + n, 0);

// #31 PR 2 (owner: remove the in-page "Find an event" band; the header search's Events group finds events). This
// test runs first, so nothing has loaded the search index yet.
test('1. no "Find an event" band: no second search box, and the page makes no search request', async () => {
  const before = total();
  const { view } = await open('#tab=events');
  const html = view.innerHTML;
  assert.doesNotMatch(html, /Find an event|id="event-q"|role="search"|event-search|data-fill=|event-schools/, 'no band, box, chips or school finder');
  assert.equal(count('/api/v1/search-index'), 0, 'the header box loads the index, not the page');
  assert.equal(total() - before, 1, 'the catalog, and nothing else');
  const src = await read('public/js/views/events.js');
  assert.doesNotMatch(src, /searchIndex|search\.js|textMatch|schoolFinder/, 'no text filter and no school finder');
  assert.equal((src.match(/api\.school\(/g) || []).length, 1, 'only the hash school= (one file)');
  // A school from a link costs its one file.
  await open(`#tab=events&school=${LOS_GATOS}`);
  assert.equal(count(`/api/v1/schools/${LOS_GATOS}`), 1);
});

test('2. the landing: the newest school year, one card per division, grouped by state in states.json order', async () => {
  const { view, head, controls, state } = await open('#tab=events');
  assert.equal(nav.pageOf(state), 'events');
  assert.match(head.innerHTML, /<h1 class="content-title" tabindex="-1">Events<\/h1>/);
  assert.equal(controls.innerHTML, '', 'the filters sit beside the cards; the filter row hides');
  const html = view.innerHTML;
  assert.ok(html.startsWith('<div class="landing-browse-row">'), 'the filters come first (#31 PR 2: no band)');
  // The cards are drawn into #event-groups (a child the view writes after its filters).
  const groups = ev.eventsOf(catalog, statesIndex, catalog.latestSeason);
  const season = catalog.seasons.find((s) => s.season === catalog.latestSeason);
  const divisions = season.competitions.reduce((t, c) => t + c.divisions.length, 0);
  assert.equal(groups.reduce((t, g) => t + g.events.length, 0), divisions);
  assert.equal(divisions, 35);
  assert.deepEqual(groups.map((g) => g.state.code), statesIndex.states.filter((s) => s.latestSeason).map((s) => s.code));
  assert.equal(catalog.latestSeason, '2025-26');
});

test('3. a card says what its catalog division says, and links to the event in the new form', () => {
  const [ca] = ev.eventsOf(catalog, statesIndex, '2025-26');
  const first = ca.events[0];
  const html = ev.eventCardHtml(ca.state, first, '2025-26');
  const d = first.div;
  assert.match(html, /<h3><a href="#tab=event&amp;st=CA&amp;season=2025-26&amp;comp=ca-cif-state&amp;div=gd1">State · Division 1<\/a><\/h3>/);
  assert.match(text(html), /CIF State Championships · Winter 2025-26/);
  assert.match(text(html), new RegExp(`Complete Mar 3 – Mar 14 · ${d.played} of ${d.games} games`));
  assert.match(text(html), new RegExp(`Champion ${d.champion.name} · runner-up ${d.runnerUp.name}`));
  assert.match(html, /href="#tab=school&amp;school=[^"]+&amp;g=g">Mater Dei<\/a>/);
  assert.match(html, /<a href="#tab=event&amp;view=games&amp;st=CA&amp;season=2025-26&amp;comp=ca-cif-state&amp;div=gd1">Games<\/a>/, 'the event\'s Games tab (PR 2)');
  // Every card of the year, against its catalog row.
  for (const g of ev.eventsOf(catalog, statesIndex, '2025-26')) {
    for (const e of g.events) {
      const card = text(ev.eventCardHtml(g.state, e, '2025-26'));
      assert.match(card, new RegExp(`${e.div.played} of ${e.div.games} games`), `${e.comp.id} ${e.div.code}`);
      assert.ok(card.includes(ev.STATUS_LABEL[e.div.status]), `${e.comp.id} ${e.div.code}: status`);
      if (e.div.champion) assert.ok(card.includes(e.div.champion.name), `${e.comp.id} ${e.div.code}: champion`);
    }
  }
});

test('4. the filters: state, school year, status and a school from a link', async () => {
  const all = ev.eventsOf(catalog, statesIndex, '2025-26').flatMap((g) => g.events.map((e) => ({ ...e, state: g.state })));
  const pick = (fn) => all.filter(fn).map((e) => `${e.comp.id}/${e.div.code}`);
  assert.deepEqual(pick((e) => ev.statusMatch(e, 'live')), [], 'nothing is being played on the data date');
  assert.equal(pick((e) => ev.statusMatch(e, 'complete')).length, 35, 'every 2025-26 bracket is finished');
  const lg = await api.school(LOS_GATOS);
  assert.deepEqual(pick((e) => ev.schoolMatch(e, lg, '2025-26')), ['ca-cif-state/gd1'], 'Los Gatos played State D1 in 2025-26');
  // #31 PR 2: "This school's events →" (#tab=events&school=ID) shows that school's events, in its latest year
  // with one when it didn't play in the newest.
  const seasons = catalog.seasons.filter((s) => s.competitions.length).map((s) => s.season);
  assert.equal(ev.schoolSeason(lg, seasons, '2025-26'), '2025-26');
  assert.equal(ev.schoolSeason({ appearances: [{ season: '2022-23' }, { season: '2023-24' }] }, seasons, '2025-26'), '2023-24');
  assert.equal(ev.schoolSeason(null, seasons, '2025-26'), '2025-26');
  // The page opens on that year (the cards are drawn into #event-groups, which this DOM-less harness doesn't keep).
  const selected = (html) => html.match(/<select id="ev-season"[^]*?<option value="([^"]+)" selected>/)?.[1];
  assert.equal(selected((await open(`#tab=events&school=${LOS_GATOS}`)).view.innerHTML), '2025-26');
  const old = (await json('public/archive/schools.json')).schools.find((r) => r.last === '2018-19');
  const oldFile = await api.school(old.id);
  assert.equal(selected((await open(`#tab=events&school=${old.id}`)).view.innerHTML), '2018-19', `${old.name}: its last year`);
  assert.ok(all.length && ev.eventsOf(catalog, statesIndex, '2018-19').flatMap((g) => g.events).some((e) => ev.schoolMatch(e, oldFile, '2018-19')),
    `${old.name}: that year has its event`);
  assert.equal(selected((await open(`#tab=events&season=2024-25&school=${old.id}`)).view.innerHTML), '2024-25', 'a season in the link wins');
  assert.equal(ev.eventsOf(catalog, statesIndex, '2024-25').reduce((t, g) => t + g.events.length, 0),
    catalog.seasons.find((s) => s.season === '2024-25').competitions.reduce((t, c) => t + c.divisions.length, 0));
  // The hash's filters reach the page; an invalid state or school year falls back (no empty page).
  for (const hash of ['#tab=events&st=TX', '#tab=events&season=2024-25', '#tab=events&show=complete', '#tab=events&st=ZZ&season=1999-00',
    `#tab=events&school=${LOS_GATOS}`, '#tab=events&q=6a']) {
    const { view } = await open(hash);
    assert.match(view.innerHTML, /id="event-groups"/, hash);
  }
});

test('5. API unchanged: the landing reads /catalog, and every api.js path is an existing route', async () => {
  assert.ok(count('/api/v1/catalog') >= 1, 'the landing read the catalog');
  assert.equal(count('/api/v1/catalog'), 1, 'once per page session (api.js keeps it)');
  const calls = [api.catalog, api.status, api.states, () => api.stateCatalog('TX'), () => api.stateGames('TX', '2025-26'),
    api.schools, api.searchIndex, () => api.school(LOS_GATOS), () => api.bracket('2025-26', 'tx-uil', '6a-d1')];
  for (const call of calls) await call();
  for (const path of counts.keys()) assert.equal(route('GET', path).status, 200, `${path} is a route in api/routes.mjs`);
  const src = await read('public/js/api.js');
  const paths = [...src.matchAll(/fetchJSON\(`?'?([^'`)]+)/g)].map((m) => m[1]).filter((p) => p.startsWith('/'));
  assert.ok(paths.includes('/catalog'));
  const golden = (await json('tests/routes.json')).routes.map((r) => r.path);
  for (const p of paths) {
    const sample = p.replace('${st}', 'TX').replace('${season}', '2025-26').replace('${comp}', 'tx-uil').replace('${div}', '6a-d1')
      .replace('${encodeURIComponent(id', LOS_GATOS);
    assert.equal(route('GET', `/api/v1${sample}`).status, 200, `api.js ${p}`);
  }
  assert.ok(golden.includes('/api/v1/catalog'), '/catalog is in the golden routes');
});

test('6. All games and Champions under Events: the same content, new crumbs and titles', async () => {
  const games = await open('#tab=events&view=games&st=TX&season=2025-26');
  assert.equal(nav.pageOf(games.state), 'results');
  assert.match(text(games.head.innerHTML), /Events › Texas › 2025-26 games Texas games/);
  assert.match(games.head.innerHTML, /<a href="#tab=events">Events<\/a>.*<a href="#tab=events&amp;st=TX">Texas<\/a>/s);
  assert.match(games.view.innerHTML, /<section class="day">/);
  const champs = await open('#tab=events&view=champions&st=PA');
  assert.match(text(champs.head.innerHTML), /Events › Pennsylvania › Champions Pennsylvania champions/);
  assert.match(champs.view.innerHTML, /<table class="data">/);
  const bracket = await open('#tab=event&st=TX&season=2025-26&comp=tx-uil&div=6a-d1');
  assert.match(text(bracket.head.innerHTML), /Events › Texas › 2025-26 State · Conference 6A D1/);
  // Links are written in their new form at the source (Kongming): a match card's "View in bracket".
  assert.equal(util.bracketHref('TX', '2025-26', 'tx-uil', '6a-d1', 2), '#tab=event&st=TX&season=2025-26&comp=tx-uil&div=6a-d1&round=2');
  assert.match(games.view.innerHTML, /href="#tab=event&amp;st=TX&amp;season=2025-26&amp;comp=tx-uil&amp;div=[^"]+&amp;round=\d+">View in bracket/);
});

test('7. styles: the cards and a two-item phone bar, and no band rules left', async () => {
  const css = await read('public/css/app.css');
  assert.doesNotMatch(css, /\.event-search|\.event-schools|\.school-search/, 'both bands are gone (#31)');
  assert.match(css, /\.event-picked \.chip \{/, 'the school chip from a link keeps its style');
  assert.match(css, /\.bottom-nav \{\s*display: grid; grid-template-columns: repeat\(2, 1fr\);/);
  assert.match(css, /\.event-card \.event-meta \{/);
});
