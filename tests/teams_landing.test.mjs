// #20 PR 5: the Teams landing, "Schools" since #26 (followed schools with how they are kept, browse by state;
// the search moved into the page in #26, tests/schools_search.test.mjs), #15 search items 1–3, the viewer's local date, and a linked bracket round on desktop.
// Offline: the shared view harness. The time zone is fixed so the local-date test means the same everywhere.
process.env.TZ = 'America/Los_Angeles';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VIEWS, el, nav, open, read, readHash, root } from './helpers/views.mjs';

const s = await import('../public/js/search.js');
const util = await import('../public/js/util.js');
const card = await import('../public/js/components/match.js');
const json = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const idx = s.buildIndex(await json('public/archive/search-index.json'), await json('public/archive/states.json'));
const names = (q) => s.suggest(idx, q).items.filter((it) => it.kind === 'school').map((it) => it.row.name);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// Since #26 the page is "Schools" and its search (with the chips) is the #school-search band above the view
// (tests/schools_search.test.mjs); the view keeps followed schools and browse by state.
test('1. the Schools landing: followed schools and how they are kept, browse by state', async () => {
  location.hash = '#tab=schools';
  assert.equal(nav.pageOf(nav.resolveTab(readHash())), 'landing');
  localStorage.removeItem('hs-favorites');
  const empty = await open('#tab=schools');
  assert.match(empty.head.innerHTML, /<h1 class="content-title" tabindex="-1">Schools<\/h1>/);
  assert.match(empty.head.innerHTML, /Find a girls soccer program and its playoff record\./);
  const html = empty.view.innerHTML;
  assert.doesNotMatch(html, /<input|data-fill|id="find-h"/, 'the search and its chips are not in the view');
  assert.match(html, /<h2 class="landing-h" id="followed-h">Followed schools<\/h2><p class="muted">No followed schools yet\.<\/p>/);
  assert.match(text(html), /Followed schools are saved in this browser only\. Clearing site data, private browsing or another device starts empty\. Use ☆ Follow on any school page\./);
  localStorage.setItem('hs-favorites', JSON.stringify([{ id: 'bdb0b593-ef7f-4c69-8c2a-e0a48c934ca7', name: 'Los Gatos' }]));
  const followed = (await open('#tab=schools')).view.innerHTML;
  assert.match(followed, /<a href="#tab=school&amp;school=bdb0b593-ef7f-4c69-8c2a-e0a48c934ca7"><span class="crest crest-sm" aria-hidden="true">LG<\/span>Los Gatos<\/a>/);
  localStorage.removeItem('hs-favorites');
  // Browse by state: one card per covered state; every number says what it counts.
  const cards = html.split('<article class="card state-card">').slice(1);
  assert.equal(cards.length, 6);
  assert.match(text(cards[0]), /California CIF · Winter season 335 schools in playoff records · 5 brackets in 2025-26 Schools Events Champions Games/);
  // #30: a state card's links open that state under Events (written in the new form at the source).
  assert.match(cards[0], /<a href="#tab=events&amp;st=CA">Events<\/a><a href="#tab=events&amp;view=champions&amp;st=CA">Champions<\/a><a href="#tab=events&amp;view=games&amp;st=CA">Games<\/a>/);
  assert.match(cards[0], /<h3><a href="#tab=schools&amp;st=CA">California<\/a>/, 'a state opens its school list');
  assert.match(empty.head.innerHTML, /href="#tab=schools&view=list">All 1,337 schools/);
  // The q/st list is unchanged.
  for (const hash of ['#tab=schools&q=ake', '#tab=schools&st=TX', '#tab=schools&view=list']) {
    location.hash = hash;
    assert.equal(nav.pageOf(nav.resolveTab(readHash())), 'schools', hash);
  }
  // The landing no longer drives the box through an event: the chips live in the band, beside the box.
  const landing = await read('public/js/views/landing.js');
  assert.doesNotMatch(landing, /hs-search-fill|data-fill/);
});

test('2. #15 item 1: St/Saint and Mt/Mount are aliases for whole words only', () => {
  assert.ok(!names('mt').includes('Mountain View'), '"mt" does not prefix "Mountain"');
  assert.equal(names('mt')[0], 'Mt. Carmel');
  assert.ok(!names('mo').includes('Mt. Carmel'), '"mo" does not find "Mt."');
  assert.ok(names('mo').includes('Mountain View'));
  for (const q of ['mt zion', 'mount zion', 'mount z']) assert.deepEqual(names(q), ['Mt. Zion', 'Mt. Zion'], q);
  for (const q of ['st pius', 'saint pius']) assert.equal(names(q)[0], 'St. Pius X Catholic', q);
  assert.ok(names('st').includes('St. Francis') && names('st').includes('Saint Francis'), '"st" finds both spellings');
});

test('3. #15 item 2: a punctuation-exact match ranks above names that only share its letters', () => {
  const q = s.parseQuery('a&m');
  const score = (name) => s.matchScore(s.prepare(name), q);
  assert.ok(score('A&M Consolidated') >= 85, `A&M Consolidated: ${score('A&M Consolidated')}`);
  assert.equal(score('Texas A&M Prep'), 85, 'the punctuated chunk inside a name');
  assert.equal(score('Amador Valley'), 60, 'only the letters');
  assert.ok(score('A&M Consolidated') > score('Amarillo'));
  assert.equal(names('a&m')[0], 'A&M Consolidated');
  assert.equal(s.matchScore(s.prepare('Amador Valley'), s.parseQuery('am')), 90, 'a plain query is unchanged (whole-name prefix)');
  assert.equal(names('p.k.')[0], 'P.K. Yonge');
});

test('4. #15 item 3: text typed while the school list loads is applied when it arrives', async () => {
  location.hash = '#tab=schools&view=list';
  const ctx = { state: nav.resolveTab(readHash()), statesIndex: await json('public/archive/states.json'),
    controls: el(), view: el(), head: el(), setState: () => {} };
  const rendering = VIEWS.schools.render(ctx);
  window.dispatchEvent(new CustomEvent('hs-query', { detail: 'ake' }));   // before the list has loaded
  await rendering;
  assert.match(ctx.head.innerHTML, /59 of 1,337 schools .* matching “ake”/);
  assert.equal((ctx.view.innerHTML.match(/<tr><td><a href="#tab=school&school=/g) || []).length, 59);
});

test('5. the viewer\'s local date, not UTC, decides "Awaiting result" and "Live"', async () => {
  // 10:30 pm on Mar 5 in California is already Mar 6 in UTC.
  const lateEvening = new Date('2026-03-06T06:30:00Z');
  assert.equal(util.localToday(lateEvening), '2026-03-05');
  assert.equal(lateEvening.toISOString().slice(0, 10), '2026-03-06', 'what the UTC date would have said');
  const tonight = { status: 'scheduled', date: '2026-03-05' };
  assert.deepEqual(card.statusOf(tonight, util.localToday(lateEvening)), { kind: 'scheduled', text: 'Scheduled' }, 'tonight\'s game is not overdue');
  assert.equal(util.isLive({ status: 'scheduled', start: '2026-03-08', end: '2026-03-10' }, util.localToday(lateEvening)), true);
  const src = (await read('public/js/util.js')) + (await read('public/js/components/match.js'));
  assert.match(src, /export function isLive\(div, today = localToday\(\)\)/);
  assert.match(src, /const todayIso = \(\) => localToday\(\);/);
  assert.doesNotMatch(src, /today = new Date\(\)\.toISOString\(\)|todayIso = \(\) => new Date\(\)\.toISOString\(\)/);
});

test('6. a linked round is marked, and scrolled into view, on wider screens', async () => {
  const marked = (made) => [...made.map((e) => e.innerHTML).join('').matchAll(/<section class="round([^"]*)" aria-label="([^"]+)">/g)]
    .filter((m) => m[1].includes('picked')).map((m) => m[2]);
  assert.deepEqual(marked((await open('#tab=event&st=CA&season=2025-26&comp=ca-cif-state&div=gd1&round=1')).made), ['Regional Semifinals']);
  assert.deepEqual(marked((await open('#tab=event&st=CA&season=2025-26&comp=ca-cif-state&div=gd1')).made), [], 'no round in the link, none marked');
  const src = await read('public/js/views/playoffs.js');
  assert.match(src, /if \(!matchMedia\('\(max-width: 768px\)'\)\.matches\) host\.querySelector\('\.round\.picked'\)\?\.scrollIntoView\(/);
  const css = await read('public/css/app.css');
  assert.match(css, /\.round\.picked \.round-head \{[^}]*background: var\(--accent-surface\);/);
});
