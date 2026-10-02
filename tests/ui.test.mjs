// UI redesign (#5): navigation, sidebar pills and accessibility checks on pure modules (no DOM, no network).
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
const sidebar = await import('../public/js/components/sidebar.js');
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

test('filters keep writing the same hash keys (show, q) and tabs keep context', () => {
  const results = open('#tab=results&st=TX&show=upcoming');
  const show = sidebar.showPills(results);
  assert.match(show, /href="#tab=results&amp;st=TX&amp;season=2025-26&amp;g=g&amp;show=upcoming" aria-current="true"/);
  assert.match(show, /href="#tab=results&amp;st=TX&amp;season=2025-26&amp;g=g"/);   // "All" drops show
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

test('state pills count brackets (and schools); division pills have no count', () => {
  const pills = sidebar.statePills(statesIndex, 'TX', (c) => hrefFor({ tab: 'playoffs', st: c }));
  const expected = { CA: 5, FL: 7, GA: 8, PA: 4, TX: 6, WA: 5 };
  for (const [code, n] of Object.entries(expected)) {
    const name = statesIndex.states.find((s) => s.code === code).name;
    // #11: the accessible name starts with the visible code (Label in Name).
    assert.match(pills, new RegExp(`aria-label="${code}, ${name}, ${n} brackets in 2025-26">${code}<span class="pill-sub" aria-hidden="true">${n}</span>`), code);
  }
  assert.match(pills, /href="#tab=playoffs&amp;st=TX" aria-current="true"/);
  assert.equal((pills.match(/aria-current/g) || []).length, 1);

  const schools = sidebar.statePills(statesIndex, null, (c) => hrefFor({ tab: 'schools', st: c }), { all: '#tab=schools', count: 'schools' });
  assert.match(schools, /aria-label="TX, Texas, 384 schools">TX<span class="pill-sub" aria-hidden="true">384<\/span>/);
  assert.match(schools, /href="#tab=schools" aria-current="true" aria-label="All states">All</);

  const tx = open('#tab=playoffs&st=TX');
  const comp = catalogs.TX.seasons.find((s) => s.season === tx.season).competitions.find((c) => c.id === tx.comp);
  const divs = sidebar.divisionPills(comp, tx);
  assert.equal((divs.match(/class="pill"/g) || []).length, 6);
  assert.doesNotMatch(divs, /pill-sub/);
  assert.match(divs, /aria-current="true" aria-label="6A D1, Conference 6A D1">6A D1</);
});

test('the sidebar is built from states.json and the state catalog only (no requests)', async () => {
  const src = await read('public/js/components/sidebar.js');
  assert.doesNotMatch(src, /from '\.\.\/api\.js'|fetch\(/);
  // Every view's sidebar groups for every state and season, with fetch blocked.
  for (const [code, catalog] of Object.entries(catalogs)) {
    for (const season of catalog.seasons.filter((s) => s.competitions.length)) {
      const st = normalize({ st: code, season: season.season }, catalog);
      for (const comp of season.competitions) {
        sidebar.compPills(season, { ...st, comp: comp.id });
        sidebar.divisionPills(comp, { ...st, comp: comp.id });
      }
      sidebar.showPills(st);
    }
    sidebar.statePills(statesIndex, code, (c) => `#tab=playoffs&st=${c}`);
  }
  sidebar.termPills(statesIndex, '');
});

// WCAG relative luminance and contrast ratio.
const lum = (hex) => {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('pill counts meet 4.5:1 contrast in light and dark, at full opacity', async () => {
  const css = await read('public/css/app.css');
  const rule = css.match(/\.pill \.pill-sub \{([^}]*)\}/)[1];
  assert.doesNotMatch(rule, /opacity/);
  const token = rule.match(/color:\s*var\((--[\w-]+)\)/)[1];
  const block = (sel) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
  const val = (b, name) => b.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))[1];
  for (const sel of [':root, [data-theme="light"] {', '[data-theme="dark"] {']) {
    const b = block(sel);
    const c = ratio(val(b, token), val(b, '--bg-surface'));
    assert.ok(c >= 4.5, `${sel} ${token} on surface: ${c.toFixed(2)}`);
    const active = ratio(val(b, '--accent-contrast'), val(b, '--accent'));
    assert.ok(active >= 4.5, `${sel} active pill: ${active.toFixed(2)}`);
  }
});

test('pills, tabs and the drawer toggle use link and ARIA semantics', async () => {
  const html = await read('public/index.html');
  assert.doesNotMatch(html, /role="tab/);
  assert.match(html, /<nav class="view-tabs" aria-label="Playoffs" id="tabs" hidden>/);
  assert.match(html, /id="sidebar-toggle"[^>]*aria-controls="sidebar"[^>]*aria-expanded=/);
  assert.match(html, /viewport-fit=cover/);
  const term = sidebar.termPills(statesIndex, 'fall');
  assert.match(term, /<button type="button" class="pill" data-term="fall" aria-pressed="true" aria-label="Fall, 2 states">/);
  assert.match(sidebar.pillLink('#x', 'TX', { current: true, count: 6, unit: 'brackets', name: 'Texas' }),
    /^<a class="pill" href="#x" aria-current="true" aria-label="TX, Texas, 6 brackets">TX<span class="pill-sub" aria-hidden="true">6<\/span><\/a>$/);
  const head = pageHeadHtml({ crumbs: [['All states', '#tab=states'], ['Texas', '#tab=playoffs&st=TX'], ['2025-26']], title: '6A D1', subtitle: 'UIL' });
  assert.match(head, /<a href="#tab=states">All states<\/a>.*<span class="breadcrumb-current" aria-current="page">2025-26<\/span>/s);
  assert.match(head, /<h1 class="content-title" tabindex="-1">6A D1<\/h1>/);
  const css = await read('public/css/app.css');
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.bracket-wrap \{ overflow-x: auto;/);
});
