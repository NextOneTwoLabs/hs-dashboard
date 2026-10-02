// #20 PR 4: the shared match card. Clear teams, scores, date and competition; a status that tells final, missing
// and upcoming games apart; a "PK win" tag with hidden words and the draw-convention note; team links, match
// details and "View in bracket" at the exact round; a header that doesn't wrap the date. Offline: the view harness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOS_GATOS, open, read } from './helpers/views.mjs';

const card = await import('../public/js/components/match.js');
const team = await import('../public/js/views/team.js');
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const all = (els) => els.map((e) => e.innerHTML).join('');
const cards = (html) => html.split('<div class="match"').slice(1);

test('1. the status tells final, missing, upcoming and overdue games apart', () => {
  const s = card.statusOf ?? (() => ({}));
  const today = '2026-10-01';
  assert.deepEqual(s({ status: 'final' }, today), { kind: 'final', text: 'Final' });
  assert.deepEqual(s({ status: 'final', decidedBy: 'unreported' }, today), { kind: 'final', text: 'Final · score not reported' });
  assert.deepEqual(s({ status: 'unreported', date: '2026-03-01' }, today), { kind: 'unreported', text: 'Result not reported' });
  assert.deepEqual(s({ status: 'scheduled', date: '2026-10-08' }, today), { kind: 'scheduled', text: 'Scheduled' });
  assert.deepEqual(s({ status: 'scheduled', date: '2026-10-01' }, today), { kind: 'scheduled', text: 'Scheduled' }, 'today is still upcoming');
  assert.deepEqual(s({ status: 'scheduled', date: '2026-09-30' }, today), { kind: 'awaiting', text: 'Awaiting result' }, 'a past date with no result');
  assert.deepEqual(s({ status: 'bye' }, today), { kind: 'bye', text: 'Bye' });
});

test('2. one card: header, team links, winner, PK win (with hidden words), note, details and bracket links', () => {
  const game = {
    status: 'final', winner: 'top', decidedBy: 'pk', date: '2024-02-29', matchUrl: 'https://www.maxpreps.com/x/match/y',
    top: { schoolId: 'aaa-111', name: 'Winters', seed: 6, score: 1 }, bottom: { id: 'bbb-222', name: 'Lowell', seed: 2, score: 1 },
  };
  const html = card.matchCard(game, { head: 'NorCal · Division 5 · Regional Semifinals', date: 'Feb 29', g: 'g', bracket: '#tab=event&round=1' });
  assert.match(html, /<div class="match-top"><span class="match-head">NorCal · Division 5 · Regional Semifinals<\/span><span class="match-date">Feb 29<\/span><\/div>/);
  assert.match(html, /<div class="team-row win" data-school="aaa-111">[\s\S]*?href="#tab=school&school=aaa-111&g=g"[\s\S]*?<span class="score">1<span class="pk">PK win<span class="sr-only"> \(won on penalty kicks\)<\/span><\/span>/);
  assert.match(html, /<div class="team-row lose" data-school="bbb-222">[\s\S]*?href="#tab=school&school=bbb-222&g=g"/, 'the opponent links to its school page');
  assert.match(html, /<span class="match-status status-final">Final<\/span>/);
  assert.match(html, /<a href="https:\/\/www\.maxpreps\.com\/x\/match\/y" rel="noopener" target="_blank">Match details <span aria-hidden="true">↗<\/span><\/a>/);
  assert.match(html, /<a href="#tab=event&amp;round=1">View in bracket <span aria-hidden="true">→<\/span><\/a>/);
  assert.match(html, /<div class="match-note">Level after full time, decided on penalty kicks · counts as a draw in playoff records<\/div>/);
  const compact = card.matchCard(game, { compact: true });
  assert.match(compact, /<span class="pk">PK<span class="sr-only"> \(won on penalty kicks\)<\/span><\/span>/, 'brackets keep the short tag');
  assert.match(compact, />Details <span aria-hidden="true">↗<\/span>/);
  assert.doesNotMatch(compact, /match-top|View in bracket/);
  const tbd = card.matchCard({ status: 'scheduled', date: '2099-01-01', top: { id: 'aaa-111', name: 'Winters' }, bottom: null });
  assert.match(text(tbd), /Winters To be decided Scheduled/);
  assert.doesNotMatch(tbd, /match-note/, 'no PK note on other games');
});

test('3. state Results: every card links to its bracket round; PK games carry the note; no old footer', async () => {
  const { view } = await open('#tab=events&view=games&st=CA');
  const list = cards(view.innerHTML);
  assert.ok(list.length > 50, `cards: ${list.length}`);
  for (const c of list) {
    assert.match(c, /<span class="match-head">[^<]+ · [^<]+<\/span>/, 'division · round in the header');
    assert.match(c, /href="#tab=event&amp;st=CA&amp;season=2025-26&amp;comp=ca-cif-state&amp;div=gd\d&amp;round=\d+">View in bracket/, 'the exact round');
    assert.match(c, /<span class="match-status status-(final|unreported|scheduled|awaiting|bye)">/);
  }
  const pk = list.filter((c) => c.includes('class="pk"'));
  assert.ok(pk.length >= 2, `PK games: ${pk.length}`);
  for (const c of pk) assert.match(c, /counts as a draw in playoff records/);
  assert.doesNotMatch(view.innerHTML, /match-meta|Decided on PKs/);
  const tx = await open('#tab=events&view=games&st=TX');
  assert.match(text(tx.view.innerHTML), /Conference 5A D1 · State Finals Walnut Grove Smithson Valley Result not reported View in bracket/);
});

test('4. brackets: compact cards with the MaxPreps match page, and no link back to the bracket itself', async () => {
  const { made } = await open('#tab=event&st=CA&season=2025-26&comp=ca-cif-state&div=gd1');
  const html = all(made);
  const list = cards(html);
  assert.ok(list.length >= 7, `bracket cards: ${list.length}`);
  const details = list.filter((c) => /href="https:\/\/www\.maxpreps\.com\/[^"]+\/match\/[^"]+" rel="noopener" target="_blank">Details/.test(c));
  assert.equal(details.length, list.length, 'every CA D1 game has its match page');
  assert.doesNotMatch(html, /View in bracket/);
  assert.match(html, /<span class="pk">PK<span class="sr-only"> \(won on penalty kicks\)<\/span><\/span>/, 'Santa Margarita won on PKs');
  assert.match(html, /counts as a draw in playoff records/);
});

test('5. a team\'s cards: competition · division · round, the date, and its bracket at that round', async () => {
  const { view } = await open(`#tab=school&view=results&school=${LOS_GATOS}`);
  const list = cards(view.innerHTML);
  assert.equal(list.length, 2);
  assert.match(list[0], /<span class="match-head">State · Division 1 · Regional Semifinals<\/span><span class="match-date">Mar 5<\/span>/);
  assert.match(list[0], /href="#tab=event&amp;st=CA&amp;season=2025-26&amp;comp=ca-cif-state&amp;div=gd1&amp;round=1">View in bracket/);
  assert.match(list[1], /&amp;round=0">View in bracket/);
  assert.match(list[0], /href="#tab=school&school=[^"]+&g=g" title="Bishop O&#39;Dowd"/, 'the opponent links to its school page');
});

// #22 review notes, taken in PR 4: "Scheduled" only for the appearance's last row; a past-dated open row in a
// live season is "Awaiting result".
test('6. a live team: only the last row is scheduled, and a past date with no result is awaiting a result', () => {
  const s = { id: 'synthetic-team', name: 'Synthetic', city: 'Town', state: 'PA' };
  const row = (round, date, res) => ({ round, roundName: `Round ${round + 1}`, date, opp: { id: `opp-${round}`, name: `Opp ${round}`, seed: 1 }, gf: res ? 1 : null, ga: res ? 0 : null, res, pk: null });
  const a = { season: '2026-27', state: 'PA', competition: 'pa-piaa', division: '2a', divisionLabel: 'Class 2A', gender: 'girls', seed: 3,
    result: 'alive', reached: 'Round 3', w: 1, l: 0, d: 0, games: [row(0, '2026-11-01', null), row(1, '2026-11-05', 'W'), row(2, '2026-11-08', null)] };
  assert.equal(team.rowStatus(a, a.games[0]), 'unreported', 'an open row that is not the last row');
  assert.equal(team.rowStatus(a, a.games[2]), 'scheduled');
  assert.deepEqual(team.gameStatus(a, a.games[2], '2026-11-01'), { kind: 'scheduled', text: 'Scheduled' });
  assert.deepEqual(team.gameStatus(a, a.games[2], '2026-11-10'), { kind: 'awaiting', text: 'Awaiting result' });
  const ctx = { s, a, own: [a], comps: {}, catalog: null, g: 'g', today: '2026-11-10' };
  const ov = text(team.overviewHtml(ctx));
  assert.match(ov.slice(ov.indexOf('Latest playoff game'), ov.indexOf('Season summary')), /Awaiting result/);
  assert.match(ov, /Round 3 Awaiting result v Opp 2/, 'journey');
  assert.match(ov, /Awaiting result · Nov 8 · 2026-27/, 'recent games');
  assert.match(ov, /Round 1 v Opp 0 · result not reported/, 'the earlier open row was never reported');
  assert.match(text(team.resultsHtml({ ...ctx, today: '2026-11-01' })), /Opp 2 .*Scheduled/);
});

test('7. the card header keeps the date on one line at 320 px; statuses meet contrast', async () => {
  const css = await read('public/css/app.css');
  assert.match(css, /\.match-head \{ min-width: 0; flex: 1 1 auto;/);
  assert.match(css, /\.match-date \{ flex: none; white-space: nowrap; \}/);
  assert.match(css, /\.match-foot \{[^}]*flex-wrap: wrap;[^}]*color: var\(--text-secondary\);/, 'the footer wraps and uses the 4.5:1 text token');
  assert.doesNotMatch(css, /\.match-meta/);
});
