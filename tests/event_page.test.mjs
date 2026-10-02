// #30 PR 2: an event's page. Bracket · Games (N) tabs named by the event, the championship, division pills and the
// school year on the page, the Games tab from the bracket's own games, and the bracket unchanged. Offline: the
// shared view harness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nav, open, read, readHash, root } from './helpers/views.mjs';

const json = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const pages = await import('../public/js/views/playoffs.js');
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const CA = '#tab=event&st=CA&season=2025-26&comp=ca-cif-state&div=gd1';
const matches = (html) => (html.match(/<div class="match(?: [^"]*)?"/g) || []).length;   // one per card
const bracketOf = (made) => made.find((e) => e.innerHTML.includes('class="bracket"') || e.innerHTML.includes('class="day"'))?.innerHTML || '';

test('1. the sub-nav: Bracket · Games (15), named by the event, one current page, Main "Events" the section', async () => {
  const catalog = await json('public/archive/states/CA/catalog.json');
  for (const [hash, current] of [[CA, 'Bracket'], [`${CA}&view=games`, 'Games (15)']]) {
    location.hash = hash;
    const state = nav.resolveTab(readHash());
    const sub = nav.subNavHtml(state, catalog);
    const links = [...sub.matchAll(/<a class="view-tab" href="([^"]+)"( aria-current="page")?>([^<]+)<\/a>/g)];
    assert.deepEqual(links.map((m) => m[3]), ['Bracket', 'Games (15)'], 'the count is inside the link text');
    assert.deepEqual(links.filter((m) => m[2]).map((m) => m[3]), [current], hash);
    assert.equal(links[0][1], '#tab=event&amp;st=CA&amp;season=2025-26&amp;comp=ca-cif-state&amp;div=gd1');
    assert.equal(links[1][1], '#tab=event&amp;view=games&amp;st=CA&amp;season=2025-26&amp;comp=ca-cif-state&amp;div=gd1');
    assert.equal(nav.subNavLabel(state, catalog), 'CIF State Championships Division 1 2025-26');
    assert.ok(nav.hasSubNav(state));
    assert.match(nav.mainNavHtml(state), /aria-current="true">(?:<svg[\s\S]*?<\/svg>)?<span>Events</);
  }
  assert.equal(nav.subNavLabel({ tab: 'event' }, null), 'Event', 'before the catalog is known');
});

test('2. the head: championship · division, the summary line and the MaxPreps link', async () => {
  const { head } = await open(CA);
  assert.match(head.innerHTML, /<h1 class="content-title" tabindex="-1">State · Division 1<\/h1>/);
  assert.match(text(head.innerHTML), /Events › California › 2025-26 State · Division 1 CIF State Championships · 16 teams · Mar 3 – Mar 14, 2026 · 15 of 15 games played MaxPreps bracket/);
});

test('3. the controls on the page: championship, division pills (links, one current), school year', async () => {
  const older = await open('#tab=event&st=CA&season=2024-25&comp=ca-cif-socal&div=gd3');
  const html = older.view.innerHTML;
  assert.match(html, /<select id="f-comp" data-set="comp"><option value="ca-cif-norcal">CIF NorCal Regional Championships<\/option><option value="ca-cif-socal" selected>CIF SoCal Regional Championships<\/option><\/select>/);
  const pills = [...html.matchAll(/<a class="pill" href="([^"]+)"( aria-current="true")?>([^<]+)<\/a>/g)];
  assert.deepEqual(pills.map((m) => m[3]), ['D1', 'D2', 'D3', 'D4', 'D5']);
  assert.deepEqual(pills.filter((m) => m[2]).map((m) => m[3]), ['D3'], 'exactly the current division');
  assert.match(html, /<nav class="pill-row event-divs-pills" aria-label="Divisions">/);
  for (const [href] of pills.map((m) => [m[1]])) assert.match(href, /^#tab=event&amp;st=CA&amp;season=2024-25&amp;comp=ca-cif-socal&amp;div=gd\d&amp;g=g$/);
  assert.match(html, /<select id="f-season" data-set="season">/);
  assert.equal(older.controls.innerHTML, '', 'girls only: the filter row hides');
  // The pills keep the tab: on Games they open each division's Games.
  const games = await open('#tab=event&view=games&st=CA&season=2024-25&comp=ca-cif-socal&div=gd3');
  assert.match(games.view.innerHTML, /<a class="pill" href="#tab=event&amp;view=games&amp;st=CA&amp;season=2024-25&amp;comp=ca-cif-socal&amp;div=gd1&amp;g=g">D1<\/a>/);
  // Other labels stay whole.
  const tx = await open('#tab=event&st=TX&season=2025-26&comp=tx-uil&div=6a-d1');
  assert.match(tx.view.innerHTML, /aria-current="true">Conference 6A D1<\/a>/);
  assert.match(tx.view.innerHTML, /<span class="field-label event-comp-name">UIL State Championships<\/span>/, 'one championship: its name, no select');
  // A new school year keeps the championship and division (normalize falls back if that year lacks them); a new
  // championship opens its first division.
  assert.deepEqual(pages.eventPatch('season', '2023-24'), { season: '2023-24', round: null });
  assert.deepEqual(pages.eventPatch('comp', 'ca-cif-norcal'), { comp: 'ca-cif-norcal', div: null });
  const kept = await open('#tab=event&st=CA&season=2023-24&comp=ca-cif-socal&div=gd3');
  assert.deepEqual([kept.state.comp, kept.state.div], ['ca-cif-socal', 'gd3']);
  const fellBack = await open('#tab=event&st=CA&season=2025-26&comp=ca-cif-socal&div=gd3');
  assert.deepEqual([fellBack.state.comp, fellBack.state.div], ['ca-cif-state', 'gd3'], '2025-26 has CIF State only; its D3 is kept');
});

test('4. the Games tab: the bracket\'s games without byes, newest day first, each to its round in the bracket', async () => {
  const b = await json('public/archive/brackets/2025-26/ca-cif-state/gd1.json');
  const { made } = await open(`${CA}&view=games`);
  const html = bracketOf(made);
  const cards = matches(html);
  assert.equal(cards, b.games.filter((g) => g.status !== 'bye').length);
  assert.equal(cards, 15);
  const days = [...html.matchAll(/<section class="day"><h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(days, ['Saturday, March 14, 2026', 'Saturday, March 7, 2026', 'Thursday, March 5, 2026', 'Tuesday, March 3, 2026']);
  assert.match(html, /<span class="match-head">State Final<\/span>/);
  assert.match(html, /href="#tab=event&amp;st=CA&amp;season=2025-26&amp;comp=ca-cif-state&amp;div=gd1&amp;round=3">View in bracket/);
  assert.doesNotMatch(html, /class="bracket"/, 'not the bracket');
  // A bracket with byes leaves them out (GA A Division II has 8).
  const withBye = await json('public/archive/brackets/2025-26/ga-ghsa/a-division-ii.json');
  const byes = withBye.games.filter((g) => g.status === 'bye').length;
  assert.equal(byes, 8);
  assert.equal(matches(pages.gamesHtml(withBye, { st: 'GA' })), withBye.games.length - byes);
});

test('5. the Bracket tab is the bracket as before: every main game, the round pills, the champion', async () => {
  const b = await json('public/archive/brackets/2025-26/ca-cif-state/gd1.json');
  const { made } = await open(CA);
  const html = bracketOf(made);
  assert.match(html, /<div class="champ-banner"><span class="label trophy">Champion<\/span>/);
  assert.equal([...html.matchAll(/<button type="button" class="pill" id="round-\d+"/g)].length, b.rounds.length);
  assert.equal([...html.matchAll(/<section class="round/g)].length, b.rounds.length);
  for (const g of b.games.filter((x) => x.place == null && x.status !== 'bye')) {
    for (const side of [g.top, g.bottom].filter(Boolean)) assert.ok(html.includes(side.name.replace(/'/g, '&#39;')), side.name);
  }
  const src = await read('public/js/views/playoffs.js');
  assert.match(src, /host\.innerHTML = bracketHtml\(bracket, state\);/);
});

// Found in the 320 px sweep: "CIF SoCal Regional Championships" made the page 365 px wide.
test('6b. phones: a long championship name cannot widen the page', async () => {
  const css = await read('public/css/app.css');
  assert.match(css, /\.event-divs select \{ min-width: 0; max-width: 100%; \}/);
  assert.match(css, /\.event-divs \.field select \{ flex: 1 1 0; width: 0; \}/);
});

test('6. the Events cards open an event\'s Bracket and Games tabs', async () => {
  const ev = await import('../public/js/views/events.js');
  const catalog = await json('public/archive/catalog.json');
  const statesIndex = await json('public/archive/states.json');
  const [ca] = ev.eventsOf(catalog, statesIndex, '2025-26');
  const html = ev.eventCardHtml(ca.state, ca.events[0], '2025-26');
  assert.match(html, /<a href="#tab=event&amp;st=CA&amp;season=2025-26&amp;comp=ca-cif-state&amp;div=gd1">Bracket<\/a><a href="#tab=event&amp;view=games&amp;st=CA&amp;season=2025-26&amp;comp=ca-cif-state&amp;div=gd1">Games<\/a>/);
  location.hash = '#tab=event&view=games&st=CA&comp=ca-cif-state&div=gd1';
  assert.equal(nav.resolveTab(readHash()).view, 'games', 'view=games is kept on an event');
  location.hash = '#tab=event&view=champions&st=CA';
  assert.equal(nav.resolveTab(readHash()).view, undefined, 'other views are dropped');
});
