// #20 PR 2: the team page. Its own nav (Overview · Results · Playoff history), no statewide sidebar, latest
// playoff game and season summary first, a history table instead of the chart, playoff-record labels.
// Offline: the shared view harness (no DOM library, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { LOS_GATOS, nav, open, read, readHash, root } from './helpers/views.mjs';

const team = (view = null, extra = '') => `#tab=team${view ? `&view=${view}` : ''}&school=${LOS_GATOS}${extra}`;
const PK_SCHOOL = '01e250af-f9de-4e2b-8e1a-11cc0a1fd241';         // 2023-24: drew 1–1 with Lowell, won on PKs
const UNREPORTED_SCHOOL = '0e9106ab-0712-45d0-81e4-5b3a74c060e2';  // 2025-26: a State Final with no result
const NO_SCORE_SCHOOL = '18c40063-4e26-4c6e-90db-b7919e0be74f';    // 2025-26: lost to London, score not reported
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('1. search → Los Gatos opens the team page, with no statewide sidebar', async () => {
  location.hash = `#tab=school&school=${LOS_GATOS}`;   // the old link, and the search target's route
  const state = nav.resolveTab(readHash());
  assert.equal(nav.pageOf(state), 'team');
  assert.equal(nav.hasSidebar(state), false);
  for (const hash of ['#tab=teams', '#tab=teams&q=ake', '#tab=results&st=CA', '#tab=playoffs&st=CA']) {
    location.hash = hash;
    assert.equal(nav.hasSidebar(nav.resolveTab(readHash())), true, hash);
  }
  for (const view of [null, 'results', 'history']) {
    const { controls, view: v, head } = await open(team(view));
    assert.equal(controls.innerHTML, '', `${view}: no sidebar controls`);
    assert.doesNotMatch(v.innerHTML + head.innerHTML, /class="pill"/, `${view}: no state pills`);
  }
  const app = await read('public/js/app.js');
  assert.match(app, /document\.body\.classList\.toggle\('no-sidebar', !sidebar\);/);
  assert.match(app, /if \(!sidebar\) closeDrawer\(\{ restore: false \}\);/);
  const css = await read('public/css/app.css');
  assert.match(css, /body\.no-sidebar #sidebar, body\.no-sidebar #sidebar-toggle \{ display: none; \}/);
  await assert.rejects(access(new URL('public/js/views/school.js', root)), 'the old school page is gone');
});

test('2. an unmistakable identity: name, place, sport, the season\'s competition, Follow (saved in this browser)', async () => {
  const { head } = await open(team());
  assert.match(head.innerHTML, /<h1 class="content-title" tabindex="-1">Los Gatos<\/h1>/);
  assert.match(text(head.innerHTML), /Los Gatos, CA · Girls soccer · 2025-26: CIF State Championships, Division 1 \(seed 3\)/);
  assert.match(text(head.innerHTML), /Teams › California › Los Gatos/);
  assert.match(head.innerHTML, /<span class="crest">LG<\/span>/);
  assert.match(head.innerHTML, /id="fav" type="button" aria-pressed="false" aria-describedby="fav-note">☆ Follow</);
  assert.match(head.innerHTML, /id="fav-note">Saved in this browser only</);
  const older = await open(team(null, '&season=2023-24'));
  assert.match(text(older.head.innerHTML), /2023-24: CIF NorCal Regional Championships, Division 3 \(seed 2\)/);
});

test('3. the team nav keeps the school, program and season; it is distinct from the Main nav', async () => {
  location.hash = team('results', '&season=2023-24&g=g');
  const state = nav.resolveTab(readHash());
  assert.equal(nav.subNavLabel(state), 'Team');
  const sub = nav.subNavHtml(state);
  const links = [...sub.matchAll(/<a class="view-tab" href="([^"]+)"( aria-current="page")?>([^<]+)<\/a>/g)];
  assert.deepEqual(links.map((m) => m[3]), ['Overview', 'Results', 'Playoff history']);
  assert.deepEqual(links.filter((m) => m[2]).map((m) => m[3]), ['Results']);
  for (const [, href] of links) {
    const p = new URLSearchParams(href.replace(/&amp;/g, '&').slice(1));
    assert.equal(p.get('school'), LOS_GATOS, href);
    assert.equal(p.get('season'), '2023-24', href);
    assert.equal(p.get('g'), 'g', href);
  }
  // The Main nav marks the section, the team nav the page: one aria-current="page".
  const main = nav.mainNavHtml(state);
  assert.match(main, /aria-current="true">(?:<svg[\s\S]*?<\/svg>)?<span>Teams</);
  assert.doesNotMatch(main, /aria-current="page"/);
  // Refresh and Back render from the hash alone: the season and tab come back.
  const cases = [
    [team('results', '&season=2023-24'), '2023-24 playoff results', /Rio Americano/, /Bishop O'Dowd/],
    [team('results'), '2025-26 playoff results', /Bishop O'Dowd/, /Rio Americano/],
  ];
  for (const [hash, title, want, not] of cases) {
    location.hash = hash;
    assert.equal(nav.canonicalHash(readHash()), null, `${hash} is already canonical (no rewrite)`);
    const { view } = await open(hash);
    assert.match(view.innerHTML, new RegExp(`<h2 class="section-h">${title}</h2>`), hash);
    assert.match(text(view.innerHTML), want, hash);
    assert.doesNotMatch(text(view.innerHTML), not, hash);
  }
  // The season select keeps the tab and replaces the history entry (no Back flood).
  const src = await read('public/js/views/team.js');
  assert.match(src, /setState\(\{ season: select\.value \}, \{ replace: true \}\)/);
});

test('4. Overview: latest playoff game and season summary first; no progression chart', async () => {
  const { view } = await open(team());
  const html = view.innerHTML;
  const order = ['Latest playoff game', 'Season summary · playoff record', 'Playoff journey', 'Recent playoff games'].map((h) => html.indexOf(h));
  assert.ok(order.every((i) => i > 0), `all four sections: ${order}`);
  assert.deepEqual([...order].sort((p, q) => p - q), order, 'DOM order is the reading order on every width');
  assert.doesNotMatch(html, /class="chart"|<svg|How far they went/);
  await assert.rejects(access(new URL('public/js/components/chart.js', root)), 'the depth chart is gone');
  const latest = html.slice(html.indexOf('Latest playoff game'), html.indexOf('Season summary'));
  assert.match(text(latest), /Regional Semifinals · Mar 5/);
  assert.match(text(latest), /Los Gatos 1 .*Bishop O'Dowd 2/);
  const summary = text(html.slice(html.indexOf('Season summary'), html.indexOf('Playoff journey')));
  assert.match(summary, /Seed 3 Furthest round Regional Semifinals Playoff W-L-D 1-1-0/);
  assert.match(summary, /league standings and regular-season games aren't covered/);
  assert.match(text(html), /Round I Won 3–1 v Vacaville Regional Semifinals Lost 1–2 v Bishop O'Dowd Finish Lost in Regional Semifinals/);
  // The season select appears only where it changes the page, and only with more than one season.
  assert.match(html, /<select id="team-season"><option value="2025-26" selected>2025-26<\/option><option value="2023-24">2023-24<\/option><\/select>/);
  const css = await read('public/css/app.css');
  assert.match(css, /grid-template-areas: "latest summary" "journey recent";/);
});

test('5. Playoff history: one compact table for all seasons, same names for the same finish', async () => {
  const { view } = await open(team('history'));
  const html = view.innerHTML;
  assert.doesNotMatch(html, /team-season/, 'no season select: history covers every season');
  const again = await open(team('history', '&season=2023-24'));
  assert.equal(again.view.innerHTML, html, 'the season in the hash does not change the table');
  assert.match(html, /<caption>Every recorded state playoff appearance \(California coverage: 2017-18 to 2025-26\)<\/caption>/);
  assert.equal((html.match(/<th scope="col"/g) || []).length, 5);
  assert.deepEqual([...html.matchAll(/<th scope="col"[^>]*>([^<]+)</g)].map((m) => m[1]), ['Season', 'Competition', 'Seed', 'Furthest round', 'Playoff W-L-D']);
  const rows = [...html.matchAll(/<tr role="row">\s*<th scope="row"[\s\S]*?<\/tr>/g)].map((m) => text(m[0]).trim());
  assert.deepEqual(rows, [
    '2025-26 CIF State Championships · Division 1 3 Regional Semifinals (lost) 1-1-0',
    '2023-24 CIF NorCal Regional Championships · Division 3 2 Regional Semifinals (lost) 1-1-0',
  ]);
  assert.match(html, new RegExp(`href="#tab=team&amp;season=2023-24&amp;g=g&amp;school=${LOS_GATOS}"`), 'a season opens that season\'s Overview');
  const notes = text(html);
  assert.match(notes, /No recorded appearance in 2024-25, 2022-23, 2021-22, 2020-21, 2019-20, 2018-19, 2017-18\./);
  assert.match(notes, /not that the team didn't play/);
  assert.match(notes, /2019-20: Regional championships cancelled \(COVID-19\)\./);
  assert.match(notes, /penalty kicks count as a draw \(D\) in the playoff record/);
  const css = await read('public/css/app.css');
  assert.match(css, /@media \(max-width: 560px\) \{\s*table\.history thead \{ display: none; \}/, 'stacked rows on phones');
});

test('6. Results: match cards name the PK winner, keep the draw, and tell missing results from scores', async () => {
  const pk = await open(`#tab=team&view=results&season=2023-24&school=${PK_SCHOOL}`);
  const card = pk.view.innerHTML.slice(pk.view.innerHTML.indexOf('Regional Semifinals') - 400);
  assert.match(card, /<div class="team-row win"[\s\S]*?<span class="score">1<span class="pk" title="Won on penalty kicks">PK<span class="sr-only"> \(won on penalty kicks\)<\/span><\/span>/,
    'the PK tag says what it means to screen readers too');
  assert.match(text(card), /Final · decided on PKs A draw in the playoff record/);
  const hist = await open(`#tab=team&view=history&school=${PK_SCHOOL}`);
  assert.match(text(hist.view.innerHTML), /2023-24 .* \d+-\d+-[1-9]/, 'the shootout is a D in the record');
  const unrep = await open(`#tab=team&view=results&season=2025-26&school=${UNREPORTED_SCHOOL}`);
  assert.match(text(unrep.view.innerHTML), /State Finals · Apr 9 .* Result not reported/);
  const noScore = await open(`#tab=team&view=results&season=2025-26&school=${NO_SCORE_SCHOOL}`);
  assert.match(text(noScore.view.innerHTML), /Final Score not reported/);
});

// #22 review B1: a school file's row has no status and `res` is null both for a game never reported and for
// one not played yet. While the team is alive, its last open row is the next game.
test('7. a live season: the next game is "Scheduled" (or "Opponent to be decided"), not "Result not reported"', async () => {
  const team = (await import('../public/js/views/team.js'));
  const s = { id: 'synthetic-team', name: 'Synthetic', city: 'Town', state: 'PA' };
  const game = (round, roundName, date, opp, gf, ga, res) => ({ round, roundName, date, opp, gf, ga, res, pk: null });
  const live = (opp) => ({
    season: '2026-27', state: 'PA', competition: 'pa-piaa', division: '2a', divisionLabel: 'Class 2A', gender: 'girls',
    seed: 3, result: 'alive', reached: 'Quarterfinals', w: 1, l: 0, d: 0,
    games: [game(0, 'First Round', '2026-11-01', { id: 'opp-a', name: 'Opp A', seed: 6 }, 2, 0, 'W'),
      game(1, 'Quarterfinals', '2099-11-08', opp, null, null, null)],
  });
  for (const [opp, want] of [[{ id: 'opp-b', name: 'Opp B', seed: 2 }, /Scheduled/], [null, /Scheduled.*Opponent to be decided/]]) {
    const a = live(opp);
    const ctx = { s, a, own: [a], comps: {}, catalog: null, g: 'g' };
    const ov = text(team.overviewHtml(ctx));
    const latest = ov.slice(ov.indexOf('Latest playoff game'), ov.indexOf('Season summary'));
    assert.match(latest, want, 'latest playoff game card');
    assert.doesNotMatch(ov, /result not reported/i, 'nowhere on Overview');
    assert.match(ov, opp ? /Quarterfinals Scheduled v Opp B/ : /Quarterfinals Scheduled · opponent to be decided/, 'journey');
    assert.match(ov, /Scheduled · Nov 8 · 2026-27/, 'recent games');
    const res = text(team.resultsHtml(ctx));
    assert.match(res, want, 'Results');
    assert.doesNotMatch(res, /Result not reported/);
    assert.equal(team.rowStatus(a, a.games[1]), 'scheduled');
  }
  // The same open row in a finished bracket, or an earlier open row in a live one, was never reported.
  const done = { ...live({ id: 'opp-b', name: 'Opp B', seed: 2 }), result: 'unreported' };
  assert.match(text(team.resultsHtml({ s, a: done, own: [done], comps: {}, g: 'g' })), /Result not reported/);
  assert.doesNotMatch(text(team.resultsHtml({ s, a: done, own: [done], comps: {}, g: 'g' })), /Scheduled/);
  const twoOpen = live({ id: 'opp-b', name: 'Opp B', seed: 2 });
  twoOpen.games[0] = game(0, 'First Round', '2026-11-01', { id: 'opp-a', name: 'Opp A', seed: 6 }, null, null, null);
  assert.equal(team.rowStatus(twoOpen, twoOpen.games[0]), 'unreported');
  assert.equal(team.rowStatus(twoOpen, twoOpen.games[1]), 'scheduled');
});

test('8. #21 notes: the old "tab" focus cause is gone', () => {
  assert.equal(nav.focusTitleAfter({ cause: 'tab' }), false);
  assert.equal(nav.focusTitleAfter({ cause: 'hashchange' }), true);
});
