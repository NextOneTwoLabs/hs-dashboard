// #20 PR 1: the nav shell. Old links open their new routes, every tab renders, one current page per route,
// no old tab names in internal links, and the phone's bottom nav. Offline: no DOM library and no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
// The stubs (netguard, disk-backed /api/v1, localStorage, matchMedia) are installed by the helper on import.
import { ERRORS, LOS_GATOS, api, nav, open, read, readHash, root } from './helpers/views.mjs';

const { tableMatch, target } = await import('../public/js/search.js');

test('old links open their new route (and replaceState rewrites them)', () => {
  const cases = [
    // [old hash, expected subset of the resolved route, the page that renders it]
    ['#tab=states', { tab: 'teams', view: undefined, st: undefined }, 'states'],
    ['#tab=states&st=TX', { tab: 'teams', st: 'TX' }, 'schools'],          // intended: that state's school list
    ['#tab=schools', { tab: 'teams', view: 'list' }, 'schools'],            // the full list stays reachable
    ['#tab=schools&q=ake', { tab: 'teams', q: 'ake', view: undefined }, 'schools'],
    ['#tab=schools&st=WA&q=east', { tab: 'teams', st: 'WA', q: 'east' }, 'schools'],
    [`#tab=school&school=${LOS_GATOS}&g=g`, { tab: 'team', school: LOS_GATOS, g: 'g' }, 'team'],
    [`#school=${LOS_GATOS}`, { tab: 'team', school: LOS_GATOS }, 'team'],
    ['#tab=school', { tab: 'teams', view: 'list' }, 'schools'],
    ['#tab=champions&st=PA', { tab: 'playoffs', view: 'champions', st: 'PA' }, 'champions'],
    ['#tab=playoffs&st=TX&season=2025-26&comp=tx-uil&div=5a-d1', { tab: 'playoffs', view: undefined, div: '5a-d1' }, 'playoffs'],
    ['#tab=playoffs&view=bogus&st=TX', { tab: 'playoffs', view: undefined }, 'playoffs'],   // no view: Brackets
    ['#tab=results&st=TX&show=upcoming', { tab: 'results', show: 'upcoming' }, 'results'],
    ['#tab=about', { tab: 'about' }, 'about'],
    ['', { tab: 'teams' }, 'states'],
    ['#tab=bogus', { tab: 'teams' }, 'states'],
    ['#tab=bogus&comp=tx-uil', { tab: 'playoffs', comp: 'tx-uil' }, 'playoffs'],
  ];
  for (const [hash, want, page] of cases) {
    location.hash = hash;
    const got = nav.resolveTab(readHash());
    for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, `${hash || '(empty)'}: ${k}`);
    assert.ok(nav.VIEW_IDS.includes(got.tab), `${hash}: ${got.tab} is a tab with a view`);
    assert.equal(nav.pageOf(got), page, `${hash || '(empty)'}: page`);
  }
  const canon = (hash) => { location.hash = hash; return nav.canonicalHash(readHash()); };
  assert.equal(canon('#tab=schools&q=ake'), '#tab=teams&q=ake');
  assert.equal(canon('#tab=schools'), '#tab=teams&view=list');
  assert.equal(canon(`#school=${LOS_GATOS}`), `#tab=team&school=${LOS_GATOS}`);
  assert.equal(canon(`#tab=school&school=${LOS_GATOS}&g=g`), `#tab=team&g=g&school=${LOS_GATOS}`);
  assert.equal(canon('#tab=champions&st=PA'), '#tab=playoffs&view=champions&st=PA');
  assert.equal(canon('#tab=states&st=TX'), '#tab=teams&st=TX');
  // New-form links, and the home page with no hash, are left alone (no replaceState).
  for (const hash of ['', '#tab=teams', '#tab=teams&q=ake', '#tab=playoffs&st=TX&season=2025-26', '#tab=about', `#tab=team&school=${LOS_GATOS}`]) {
    assert.equal(canon(hash), null, hash);
  }
});

test('app.js rewrites old links with history.replaceState and renders pages through pageOf', async () => {
  const app = await read('public/js/app.js');
  assert.match(app, /const fixed = canonicalHash\(hash\);\s*if \(fixed\) history\.replaceState\(null, '', fixed\);/);
  assert.match(app, /VIEWS\[pageOf\(state\)\]\.render\(/);
  const keys = app.match(/const VIEWS = \{([^}]*)\}/)[1].split(',').map((k) => k.trim()).sort();
  assert.deepEqual(keys, [...nav.PAGES].sort(), 'app.js has a module for every page');
  assert.match(app, /needsCatalog\(raw\.tab\)/);
});

test('q=ake still lists "Lake…" schools, with the table count (old and new links, and the search targets)', async () => {
  const { schools } = await api.schools();
  const want = schools.filter((s) => tableMatch(s, 'ake')).length;
  assert.equal(want, 59);
  for (const hash of ['#tab=schools&q=ake', '#tab=teams&q=ake']) {
    const { view, head } = await open(hash);
    assert.match(view.innerHTML, />Lake [^<]+<\/a>/, `${hash}: a Lake… school`);
    assert.equal((view.innerHTML.match(/<tr><td><a href="#tab=team&school=/g) || []).length, want, `${hash}: rows`);
    assert.match(head.innerHTML, new RegExp(`${want} of 1,337 schools`));
  }
  // The header search's city and "All N" options open the same list.
  const city = target({ kind: 'city', city: { city: 'San Antonio' } }).hash;
  const all = target({ kind: 'all', n: want, q: 'ake' }).hash;
  assert.equal(city, '#tab=teams&q=San%20Antonio');
  assert.equal(all, '#tab=teams&q=ake');
  for (const hash of [city, all]) { location.hash = hash; assert.equal(nav.pageOf(nav.resolveTab(readHash())), 'schools'); }
  assert.equal(target({ kind: 'school', row: { id: LOS_GATOS } }).hash, `#tab=team&school=${LOS_GATOS}`);
});

test('every tab (VIEW_IDS) and every page renders: no throw, a heading, no error state', async () => {
  const routes = [
    '#tab=teams', '#tab=teams&view=list', '#tab=teams&st=TX', `#tab=team&school=${LOS_GATOS}`,
    '#tab=results&st=CA', '#tab=playoffs&st=CA', '#tab=playoffs&view=champions&st=CA', '#tab=about',
  ];
  const tabs = new Set();
  const pages = new Set();
  for (const hash of routes) {
    const { state, head, made: els } = await open(hash);
    tabs.add(state.tab);
    pages.add(nav.pageOf(state));
    const h1 = head.innerHTML.match(/<h1 class="content-title" tabindex="-1">([^<]*)<\/h1>/);
    assert.ok(h1 && h1[1].trim(), `${hash}: a non-empty page title`);
    for (const e of els) assert.doesNotMatch(e.innerHTML, ERRORS, `${hash}: no error state`);
  }
  assert.deepEqual([...tabs].sort(), [...nav.VIEW_IDS].sort(), 'every VIEW_IDS value is covered');
  assert.deepEqual([...pages].sort(), [...nav.PAGES].sort(), 'every page module is covered');
});

// Scope: the Main nav and the sub-nav (Playoffs, or a team's). The breadcrumb's last item also carries
// aria-current="page" on purpose (WAI-ARIA breadcrumb pattern, its own <nav>); it is outside this check.
test('one aria-current="page" per route across the Main nav and the sub-nav', async () => {
  const cases = [
    ['#tab=teams', 'Teams', null], ['#tab=teams&q=ake', 'Teams', null], [`#tab=team&school=${LOS_GATOS}`, 'Teams', 'Overview'],
    [`#tab=team&view=results&school=${LOS_GATOS}`, 'Teams', 'Results'], [`#tab=team&view=history&school=${LOS_GATOS}`, 'Teams', 'Playoff history'],
    ['#tab=results&st=CA', 'Results', null], ['#tab=playoffs&st=CA', 'Playoffs', 'Brackets'],
    ['#tab=playoffs&view=champions&st=CA', 'Playoffs', 'Champions'], ['#tab=about', null, null],
  ];
  const current = (html, value) => [...html.matchAll(new RegExp(`aria-current="${value}">(?:<svg[\\s\\S]*?</svg>)?(?:<span>)?([^<]+)`, 'g'))].map((m) => m[1]);
  for (const [hash, section, sub] of cases) {
    location.hash = hash;
    const state = nav.resolveTab(readHash());
    const main = nav.mainNavHtml(state);
    const subNav = nav.subNavHtml(state);
    const pages = [...current(main, 'page'), ...current(subNav, 'page')];
    if (!section) { assert.deepEqual(pages, [], `${hash}: About is not a Main destination`); continue; }
    assert.deepEqual(pages, [sub || section], `${hash}: exactly one current page`);
    // On a page with a sub-nav, the Main item marks the current section instead.
    assert.deepEqual(current(main, 'true'), sub ? [section] : [], `${hash}: section`);
    assert.equal((main.match(/<a /g) || []).length, 3, 'Teams · Results · Playoffs (no Standings: owner, option B)');
    assert.doesNotMatch(main, /Standings/);
  }
  // Main nav links keep context; Teams starts fresh.
  location.hash = '#tab=results&st=TX&season=2025-26&g=g';
  const r = nav.mainNavHtml(nav.resolveTab(readHash()));
  assert.match(r, /href="#tab=playoffs&amp;st=TX&amp;season=2025-26&amp;g=g"/);
  assert.match(r, /href="#tab=teams"/);
  location.hash = '#tab=playoffs&st=TX&season=2025-26&g=g';
  assert.match(nav.subNavHtml(nav.resolveTab(readHash())), /href="#tab=playoffs&amp;view=champions&amp;st=TX&amp;season=2025-26&amp;g=g"/);
  // Both Main navs are labelled "Main", the sub-nav "Playoffs", and app.js fills each from the same helpers.
  const html = await read('public/index.html');
  assert.match(html, /<nav class="header-nav" aria-label="Main" id="main-nav">/);
  assert.match(html, /<nav class="bottom-nav" aria-label="Main" id="bottom-nav">/);
  assert.match(html, /<nav class="view-tabs" aria-label="Playoffs" id="tabs" hidden>/);
  const app = await read('public/js/app.js');
  assert.match(app, /mainNav\.innerHTML = mainNavHtml\(state\);/);
  assert.match(app, /bottomNav\.innerHTML = mainNavHtml\(state, \{ cls: 'bottom-nav-link' \}\);/);
  assert.match(app, /subNav\.innerHTML = subNavHtml\(state\);/);
});

test('internal links use the new routes: no old tab names outside the old-link map in nav.js', async () => {
  const files = ['public/index.html'];
  const walk = async (dir) => {
    for (const d of await readdir(new URL(dir, root), { withFileTypes: true })) {
      if (d.isDirectory()) await walk(`${dir}${d.name}/`);
      else if (d.name.endsWith('.js') && `${dir}${d.name}` !== 'public/js/nav.js') files.push(`${dir}${d.name}`);
    }
  };
  await walk('public/js/');
  assert.ok(files.length > 15);
  const OLD = /tab=(states|schools|school|champions)(?![\w-])|tab:\s*'(states|schools|school|champions)'/;
  for (const f of files) {
    (await read(f)).split('\n').forEach((line, i) => assert.doesNotMatch(line, OLD, `${f}:${i + 1}`));
  }
});

test('phones: the bottom nav replaces the header nav, and hides while the search box has focus', async () => {
  const css = await read('public/css/app.css');
  const block = (start) => {   // the body of an @media block, by brace matching
    let i = css.indexOf(start);
    assert.ok(i >= 0, start);
    i = css.indexOf('{', i) + 1;
    let depth = 1;
    const from = i;
    for (; depth && i < css.length; i++) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
    return css.slice(from, i - 1);
  };
  const before = css.slice(0, css.indexOf('@media (max-width: 768px)'));
  assert.match(before, /\.bottom-nav \{ display: none; \}/, 'no bottom nav on wider screens');
  const phone = block('@media (max-width: 768px)');
  assert.match(phone, /\.header-nav \{ display: none; \}/, 'no header nav on phones');
  assert.match(phone, /\.bottom-nav \{\s*display: grid;[^}]*position: fixed;[^}]*bottom: 0;/);
  assert.match(phone, /body:has\(#search-input:focus\) \.bottom-nav, body\.search-focus \.bottom-nav \{ display: none; \}/);
  assert.match(phone, /\.bottom-nav-link \{[^}]*min-height: 48px;/, 'touch targets');
  const box = await read('public/js/components/searchBox.js');
  assert.match(box, /addEventListener\('focus', \(\) => document\.body\.classList\.add\('search-focus'\)\)/);
  assert.match(box, /addEventListener\('blur', \(\) => document\.body\.classList\.remove\('search-focus'\)\)/);
  // The drawer is modal on phones: both Main navs go inert behind it.
  const shell = await read('public/js/shell.js');
  assert.match(shell, /getElementById\('main-nav'\), document\.getElementById\('bottom-nav'\)/);
});

test('About is in the footer at every width; the title has a visible keyboard focus ring (#18)', async () => {
  const html = await read('public/index.html');
  assert.match(html, /<footer class="footer">[\s\S]*<a class="footer-about" href="#tab=about">About the data<\/a>[\s\S]*<\/footer>/);
  const css = await read('public/css/app.css');
  assert.doesNotMatch(css, /\.footer-about \{[^}]*display: none/);
  assert.doesNotMatch(css, /\.content-title:focus \{ outline: none; \}/);
  assert.match(css, /\.content-title:focus-visible \{ outline: 2px solid var\(--accent-text\);/);
  // League standings aren't covered: said once on About (owner, option B).
  const { view } = await open('#tab=about');
  assert.match(view.innerHTML, /league standings aren't covered/);
  assert.match(view.innerHTML, /playoff record/);
});
