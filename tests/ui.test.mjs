// UI redesign (#5, #20): navigation, filter rows and accessibility checks on pure modules (no DOM, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.fetch = () => { throw new Error('netguard: network access blocked in tests'); };
globalThis.location = { hash: '' };

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');
const json = async (p) => JSON.parse(await read(p));

const { readHash, resolveState, normalize } = await import('../public/js/state.js');
const { resolveTab, navHref, hrefFor, listHref, sectionOf, needsCatalog, MAIN_NAV } = await import('../public/js/nav.js');
const filters = await import('../public/js/components/filters.js');
const { pageHeadHtml } = await import('../public/js/components/pageHeader.js');

const statesIndex = await json('public/archive/states.json');
const catalogs = Object.fromEntries(await Promise.all(statesIndex.states.filter((s) => s.latestSeason)
  .map(async (s) => [s.code, await json(`public/archive/states/${s.code}/catalog.json`)])));

// What app.js does with a hash: tab rules, then (state tabs) the state and its catalog defaults.
function open(hash) {
  globalThis.location.hash = hash;
  let raw = resolveTab(readHash());
  if (needsCatalog(raw.tab)) {
    raw = resolveState(raw, statesIndex);
    raw = normalize(raw, catalogs[raw.st]);
  }
  return raw;
}

// #20 renamed the tabs (states/schools -> teams, school -> team, champions -> playoffs&view=champions); the
// old names still open the same content. The full old-links table is in nav_shell.test.mjs.
test('old links still open the same view and state', () => {
  const school = '000472c2-dee8-4be6-bcdd-c0ff8a4582aa';
  const cases = [
    // [hash, expected subset]
    ['#tab=playoffs&season=2025-26&comp=cif-state&div=gd1', { tab: 'playoffs', st: 'CA', comp: 'ca-cif-state', season: '2025-26', div: 'gd1' }],
    ['#tab=playoffs&st=TX&season=2025-26&comp=tx-uil&div=5a-d1', { tab: 'playoffs', st: 'TX', comp: 'tx-uil', div: '5a-d1' }],
    ['#tab=results&st=TX&show=upcoming', { tab: 'results', st: 'TX', show: 'upcoming' }],
    ['#tab=results&st=GA&season=2025-26&show=results', { tab: 'results', st: 'GA', season: '2025-26', show: 'results' }],
    ['#tab=schools&q=lake', { tab: 'teams', q: 'lake' }],
    ['#tab=schools&st=WA&q=east', { tab: 'teams', st: 'WA', q: 'east' }],
    [`#tab=school&school=${school}`, { tab: 'team', school }],
    [`#school=${school}`, { tab: 'team', school }],
    ['', { tab: 'teams' }],
    ['#tab=bogus', { tab: 'teams' }],
    ['#tab=bogus&comp=tx-uil', { tab: 'playoffs', st: 'TX', comp: 'tx-uil' }],
    ['#tab=school', { tab: 'teams', view: 'list' }],
    ['#tab=about', { tab: 'about' }],
    ['#tab=champions&st=pa', { tab: 'playoffs', view: 'champions', st: 'PA' }],
  ];
  for (const [hash, want] of cases) {
    const got = open(hash);
    for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, `${hash || '(empty)'}: ${k}`);
  }
});

test('filters keep writing the same hash keys (show, q) and nav links keep context', () => {
  const results = open('#tab=results&st=TX&show=upcoming');
  assert.match(filters.showSelect(results.show), /<option value="upcoming" selected>Upcoming<\/option>/);
  assert.deepEqual(filters.patchFor('show', ''), { show: null }, '"All games" drops show');
  assert.deepEqual(filters.patchFor('show', 'results'), { show: 'results' });
  assert.equal(listHref({ st: 'TX', q: 'lake' }), '#tab=teams&st=TX&q=lake');
  assert.equal(listHref(), '#tab=teams&view=list');
  assert.equal(navHref('playoffs', { st: 'TX', season: '2025-26', g: 'g' }), '#tab=playoffs&st=TX&season=2025-26&g=g');
  assert.equal(navHref('results', { st: 'TX', season: '2025-26', g: 'g' }), '#tab=results&st=TX&season=2025-26&g=g');
  assert.equal(navHref('teams', { st: 'TX' }), '#tab=teams');
  assert.equal(hrefFor({ tab: 'playoffs', view: 'champions', st: 'TX' }), '#tab=playoffs&view=champions&st=TX');
  assert.equal(sectionOf('team'), 'teams');
  assert.equal(sectionOf('about'), null);
  assert.deepEqual(MAIN_NAV.map(([t]) => t), ['teams', 'results', 'playoffs']);
  for (const [t] of MAIN_NAV) assert.equal(resolveTab({ tab: t }).tab, t);
});

test('the filter rows are built from states.json and the state catalog only (no requests)', async () => {
  const src = await read('public/js/components/filters.js');
  assert.doesNotMatch(src, /from '\.\.\/api\.js'|fetch\(/);
  // Every select for every state and school year, with fetch blocked.
  for (const [code, catalog] of Object.entries(catalogs)) {
    for (const season of catalog.seasons.filter((s) => s.competitions.length)) {
      const st = normalize({ st: code, season: season.season }, catalog);
      filters.seasonSelect(catalog, st.season);
      for (const comp of season.competitions) {
        filters.compSelect(season, comp.id);
        assert.ok(filters.divisionSelect(comp, { ...st, comp: comp.id }), `${code} ${season.season} ${comp.id}: divisions`);
      }
    }
    filters.stateSelect(statesIndex, code);
    filters.termNote(statesIndex, code);
  }
  filters.termButtons(statesIndex, '');
});

// WCAG relative luminance and contrast ratio.
const lum = (hex) => {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('a pressed toggle (season of play, round, gender) meets 4.5:1 in light and dark', async () => {
  const css = await read('public/css/app.css');
  assert.match(css, /\.seg button\[aria-pressed="true"\] \{ background: var\(--accent\); color: var\(--accent-contrast\); \}/);
  const block = (sel) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
  const val = (b, name) => b.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))[1];
  for (const sel of [':root, [data-theme="light"] {', '[data-theme="dark"] {']) {
    const b = block(sel);
    const active = ratio(val(b, '--accent-contrast'), val(b, '--accent'));
    assert.ok(active >= 4.5, `${sel} pressed toggle: ${active.toFixed(2)}`);
    const label = ratio(val(b, '--text-secondary'), val(b, '--bg-surface'));
    assert.ok(label >= 4.5, `${sel} filter labels on the row: ${label.toFixed(2)}`);
  }
});

test('the filter toggle, tabs and page header use link and ARIA semantics', async () => {
  const html = await read('public/index.html');
  assert.doesNotMatch(html, /role="tab/);
  assert.match(html, /<nav class="view-tabs" aria-label="Playoffs" id="tabs" hidden>/);
  assert.match(html, /id="filter-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="controls"/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(filters.termButtons(statesIndex, 'fall'), /<button type="button" id="f-term-fall" data-term="fall" aria-pressed="true">Fall<\/button>/);
  const head = pageHeadHtml({ crumbs: [['All states', '#tab=teams'], ['Texas', '#tab=playoffs&st=TX'], ['2025-26']], title: '6A D1', subtitle: 'UIL' });
  assert.match(head, /<a href="#tab=teams">All states<\/a>.*<span class="breadcrumb-current" aria-current="page">2025-26<\/span>/s);
  assert.match(head, /<h1 class="content-title" tabindex="-1">6A D1<\/h1>/);
  const css = await read('public/css/app.css');
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.bracket-wrap \{ overflow-x: auto;/);
});
