// #20 PR 5: the Teams landing (find a team through the one header search, followed teams with how they are
// kept, browse by state), #15 search items 1–3, the viewer's local date, and a linked bracket round on desktop.
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

test('1. the Teams landing: find a team (no second box), followed teams and how they are kept, browse by state', async () => {
  location.hash = '#tab=teams';
  assert.equal(nav.pageOf(nav.resolveTab(readHash())), 'landing');
  localStorage.removeItem('hs-favorites');
  const empty = await open('#tab=teams');
  assert.match(empty.head.innerHTML, /<h1 class="content-title" tabindex="-1">Teams<\/h1>/);
  assert.match(empty.head.innerHTML, /Find a girls soccer team and its playoff record\./);
  const html = empty.view.innerHTML;
  assert.match(html, /<h2 class="landing-h" id="find-h">Find a team<\/h2>/);
  assert.deepEqual([...html.matchAll(/<button type="button" class="chip" data-fill="([^"]+)">/g)].map((m) => m[1]),
    ['Los Gatos', 'Mater Dei', 'San Antonio', 'Texas']);
  assert.doesNotMatch(html, /<input/, 'the chips use the header search; there is no second search box');
  assert.match(html, /<h2 class="landing-h" id="followed-h">Followed teams<\/h2><p class="muted">No followed teams yet\.<\/p>/);
  assert.match(text(html), /Followed teams are saved in this browser only\. Clearing site data, private browsing or another device starts empty\. Use ☆ Follow on any team page\./);
  localStorage.setItem('hs-favorites', JSON.stringify([{ id: 'bdb0b593-ef7f-4c69-8c2a-e0a48c934ca7', name: 'Los Gatos' }]));
  const followed = (await open('#tab=teams')).view.innerHTML;
  assert.match(followed, /<a href="#tab=team&amp;school=bdb0b593-ef7f-4c69-8c2a-e0a48c934ca7"><span class="crest crest-sm" aria-hidden="true">LG<\/span>Los Gatos<\/a>/);
  localStorage.removeItem('hs-favorites');
  // Browse by state: one card per covered state; every number says what it counts.
  const cards = html.split('<article class="card state-card">').slice(1);
  assert.equal(cards.length, 6);
  assert.match(text(cards[0]), /California CIF · Winter season 335 schools in playoff records · 5 brackets in 2025-26 Schools Brackets Champions Results/);
  assert.match(cards[0], /<h3><a href="#tab=teams&amp;st=CA">California<\/a>/, 'a state opens its school list');
  assert.match(empty.head.innerHTML, /href="#tab=teams&view=list">All 1,337 schools/);
  // The q/st list is unchanged.
  for (const hash of ['#tab=teams&q=ake', '#tab=teams&st=TX', '#tab=teams&view=list']) {
    location.hash = hash;
    assert.equal(nav.pageOf(nav.resolveTab(readHash())), 'schools', hash);
  }
  // The chips fill the one header search box.
  const landing = await read('public/js/views/landing.js');
  assert.match(landing, /window\.dispatchEvent\(new CustomEvent\('hs-search-fill', \{ detail: b\.dataset\.fill \}\)\)/);
  const box = await read('public/js/components/searchBox.js');
  assert.match(box, /window\.addEventListener\('hs-search-fill', async \(e\) => \{\s*choose\(\{ kind: 'chip', text: String\(e\.detail \|\| ''\) \}\);/);
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
  location.hash = '#tab=teams&view=list';
  const ctx = { state: nav.resolveTab(readHash()), statesIndex: await json('public/archive/states.json'),
    controls: el(), view: el(), head: el(), setState: () => {} };
  const rendering = VIEWS.schools.render(ctx);
  window.dispatchEvent(new CustomEvent('hs-query', { detail: 'ake' }));   // before the list has loaded
  await rendering;
  assert.match(ctx.head.innerHTML, /59 of 1,337 schools .* matching “ake”/);
  assert.equal((ctx.view.innerHTML.match(/<tr><td><a href="#tab=team&school=/g) || []).length, 59);
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
  assert.deepEqual(marked((await open('#tab=playoffs&st=CA&season=2025-26&comp=ca-cif-state&div=gd1&round=1')).made), ['Regional Semifinals']);
  assert.deepEqual(marked((await open('#tab=playoffs&st=CA&season=2025-26&comp=ca-cif-state&div=gd1')).made), [], 'no round in the link, none marked');
  const src = await read('public/js/views/playoffs.js');
  assert.match(src, /if \(!matchMedia\('\(max-width: 768px\)'\)\.matches\) host\.querySelector\('\.round\.picked'\)\?\.scrollIntoView\(/);
  const css = await read('public/css/app.css');
  assert.match(css, /\.round\.picked \.round-head \{[^}]*background: var\(--accent-surface\);/);
});
