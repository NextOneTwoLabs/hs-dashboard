// #20 PR 1: the nav shell. Old links open their new routes, every tab renders, one current page per route,
// no old tab names in internal links, and the phone's bottom nav. Offline: no DOM library and no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
// The stubs (netguard, disk-backed /api/v1, localStorage, matchMedia) are installed by the helper on import.
import { ERRORS, LOS_GATOS, api, nav, open, read, readHash, root } from './helpers/views.mjs';

const { tableMatch, target } = await import('../public/js/search.js');

// #26 (owner: hash option A): tab=schools / tab=school are canonical; every older form still opens its content.
test('old links open their new route (and replaceState rewrites them)', () => {
  const cases = [
    // [old hash, expected subset of the resolved route, the page that renders it]
    // #21–#25 links (tab=teams / tab=team), with every parameter they could carry
    ['#tab=teams', { tab: 'schools', view: undefined, st: undefined }, 'landing'],
    ['#tab=teams&view=list', { tab: 'schools', view: 'list' }, 'schools'],
    ['#tab=teams&st=TX', { tab: 'schools', st: 'TX' }, 'schools'],
    ['#tab=teams&q=ake', { tab: 'schools', q: 'ake', view: undefined }, 'schools'],
    ['#tab=teams&st=WA&q=east', { tab: 'schools', st: 'WA', q: 'east' }, 'schools'],
    [`#tab=team&school=${LOS_GATOS}`, { tab: 'school', school: LOS_GATOS, view: undefined }, 'team'],
    [`#tab=team&view=results&school=${LOS_GATOS}`, { tab: 'school', view: 'results', school: LOS_GATOS }, 'team'],
    [`#tab=team&view=history&season=2023-24&g=g&school=${LOS_GATOS}`, { tab: 'school', view: 'history', season: '2023-24', g: 'g', school: LOS_GATOS }, 'team'],
    ['#tab=team', { tab: 'schools', view: 'list' }, 'schools'],                 // a team link with no school
    // Pre-#20 links: native again, except the bare #tab=schools (the intended difference: now the landing)
    ['#tab=schools', { tab: 'schools', view: undefined }, 'landing'],
    ['#tab=schools&q=ake', { tab: 'schools', q: 'ake', view: undefined }, 'schools'],
    ['#tab=schools&st=WA&q=east', { tab: 'schools', st: 'WA', q: 'east' }, 'schools'],
    [`#tab=school&school=${LOS_GATOS}&g=g`, { tab: 'school', school: LOS_GATOS, g: 'g' }, 'team'],
    [`#school=${LOS_GATOS}`, { tab: 'school', school: LOS_GATOS }, 'team'],
    [`#school=${LOS_GATOS}&g=g`, { tab: 'school', school: LOS_GATOS, g: 'g' }, 'team'],
    ['#tab=school', { tab: 'schools', view: 'list' }, 'schools'],               // a school link with no school
    ['#tab=states', { tab: 'schools', view: undefined, st: undefined }, 'landing'],
    ['#tab=states&st=TX', { tab: 'schools', st: 'TX' }, 'schools'],          // that state's school list (since #21)
    // #30: Results, Playoffs and Champions live under Events (one step each, no old name to another old name)
    ['#tab=champions&st=PA', { tab: 'events', view: 'champions', st: 'PA' }, 'champions'],
    ['#tab=playoffs&view=champions&st=PA', { tab: 'events', view: 'champions', st: 'PA' }, 'champions'],
    ['#tab=playoffs&st=TX&season=2025-26&comp=tx-uil&div=5a-d1', { tab: 'event', view: undefined, comp: 'tx-uil', div: '5a-d1' }, 'playoffs'],
    ['#tab=playoffs&st=CA&season=2025-26&comp=ca-cif-state&div=gd1&round=1', { tab: 'event', div: 'gd1', round: '1' }, 'playoffs'],
    ['#tab=playoffs&st=CA&season=2024-25&comp=ca-cif-norcal', { tab: 'event', comp: 'ca-cif-norcal', div: undefined }, 'playoffs'],
    ['#tab=playoffs&view=bogus&st=TX', { tab: 'events', view: undefined, st: 'TX' }, 'events'],   // no comp: the Events landing
    ['#tab=playoffs&st=TX&season=2024-25', { tab: 'events', st: 'TX', season: '2024-25' }, 'events'],
    ['#tab=playoffs', { tab: 'events', st: undefined }, 'events'],
    ['#tab=results&st=TX&show=upcoming', { tab: 'events', view: 'games', show: 'upcoming' }, 'results'],
    ['#tab=results&st=GA&season=2025-26&show=results&g=g', { tab: 'events', view: 'games', season: '2025-26', show: 'results', g: 'g' }, 'results'],
    ['#tab=about', { tab: 'about' }, 'about'],
    ['', { tab: 'schools' }, 'landing'],
    ['#tab=bogus', { tab: 'schools' }, 'landing'],
    ['#tab=bogus&comp=tx-uil', { tab: 'event', comp: 'tx-uil' }, 'playoffs'],
    // An event with no championship or division: normalize (state.js) fills both from the state catalog.
    ['#tab=event', { tab: 'event', comp: undefined, div: undefined }, 'playoffs'],
    // round belongs to an event's bracket, show to the Events landing and All games (Kongming, plan v2)
    ['#tab=events&round=2', { tab: 'events', round: undefined }, 'events'],
    ['#tab=results&st=TX&round=2', { tab: 'events', view: 'games', round: undefined }, 'results'],
    ['#tab=events&show=results', { tab: 'events', show: undefined }, 'events'],
    ['#tab=events&show=live', { tab: 'events', show: 'live' }, 'events'],
    ['#tab=events&view=games&show=complete', { tab: 'events', view: 'games', show: undefined }, 'results'],
    ['#tab=events&view=champions&show=upcoming', { tab: 'events', view: 'champions', show: undefined }, 'champions'],
    ['#tab=event&st=CA&comp=ca-cif-state&div=gd1&show=upcoming', { tab: 'event', show: undefined }, 'playoffs'],
  ];
  for (const [hash, want, page] of cases) {
    location.hash = hash;
    const got = nav.resolveTab(readHash());
    for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, `${hash || '(empty)'}: ${k}`);
    assert.ok(nav.VIEW_IDS.includes(got.tab), `${hash}: ${got.tab} is a tab with a view`);
    assert.equal(nav.pageOf(got), page, `${hash || '(empty)'}: page`);
  }
  const canon = (hash) => { location.hash = hash; return nav.canonicalHash(readHash()); };
  assert.equal(canon('#tab=teams&q=ake'), '#tab=schools&q=ake');
  assert.equal(canon('#tab=teams&view=list'), '#tab=schools&view=list');
  assert.equal(canon('#tab=teams'), '#tab=schools');
  assert.equal(canon(`#tab=team&view=history&season=2023-24&g=g&school=${LOS_GATOS}`), `#tab=school&view=history&season=2023-24&g=g&school=${LOS_GATOS}`);
  assert.equal(canon('#tab=team'), '#tab=schools&view=list');
  assert.equal(canon('#tab=school'), '#tab=schools&view=list');
  assert.equal(canon(`#school=${LOS_GATOS}`), `#tab=school&school=${LOS_GATOS}`);
  assert.equal(canon('#tab=champions&st=PA'), '#tab=events&view=champions&st=PA');
  assert.equal(canon('#tab=states&st=TX'), '#tab=schools&st=TX');
  assert.equal(canon('#tab=results&st=TX&show=upcoming'), '#tab=events&view=games&st=TX&show=upcoming');
  assert.equal(canon('#tab=playoffs&st=TX&season=2025-26&comp=tx-uil&div=5a-d1'), '#tab=event&st=TX&season=2025-26&comp=tx-uil&div=5a-d1');
  assert.equal(canon('#tab=playoffs&st=CA&season=2024-25&comp=ca-cif-norcal'), '#tab=event&st=CA&season=2024-25&comp=ca-cif-norcal',
    'a competition with no division keeps the competition (normalize fills the division)');
  assert.equal(canon('#tab=playoffs&st=TX'), '#tab=events&st=TX');
  assert.equal(canon('#tab=events&show=results'), '#tab=events');
  // #31 PR 2: Events has no text filter since "Find an event" went; the header search finds events.
  assert.equal(canon('#tab=events&q=6a'), '#tab=events');
  assert.equal(canon('#tab=events&st=TX&q=6a'), '#tab=events&st=TX');
  assert.equal(canon('#tab=events&view=games&st=TX&q=x'), '#tab=events&view=games&st=TX');
  assert.equal(canon('#tab=schools&q=ake'), null, 'q= stays on the school list');
  // New-form links, and the home page with no hash, are left alone (no replaceState).
  for (const hash of ['', '#tab=schools', '#tab=schools&q=ake', '#tab=schools&view=list', '#tab=events', '#tab=events&st=TX&show=live',
    '#tab=events&view=games&st=TX&season=2025-26&show=upcoming', '#tab=events&view=champions&st=PA', '#tab=event',
    '#tab=event&st=TX&season=2025-26&comp=tx-uil&div=5a-d1&round=2',
    '#tab=about', `#tab=school&school=${LOS_GATOS}`, `#tab=school&g=g&school=${LOS_GATOS}`]) {
    assert.equal(canon(hash), null, hash);
  }
});

// Kongming (#30 plan v2): the old-link map is one step and one way, so resolving twice changes nothing and the
// canonical hash of a resolved link is itself.
test('old links resolve in one step: resolveTab is idempotent and the canonical hash is stable', () => {
  const old = ['#tab=champions', '#tab=champions&st=PA', '#tab=playoffs&view=champions&st=CA', '#tab=results',
    '#tab=results&st=TX&show=upcoming&g=g', '#tab=playoffs&st=CA&season=2025-26&comp=ca-cif-state&div=gd1&round=1',
    '#tab=playoffs&st=CA&season=2024-25&comp=ca-cif-norcal', '#tab=playoffs&st=TX', '#tab=playoffs', '#tab=bogus&comp=tx-uil',
    '#tab=event', '#tab=teams&q=ake', `#tab=team&view=history&school=${LOS_GATOS}`, '#tab=states&st=TX', `#school=${LOS_GATOS}`,
    '#tab=events&show=results&round=3', '#tab=events&view=nope', '#tab=events&q=6a', '#tab=events&st=TX&q=6a&show=live'];
  for (const hash of old) {
    location.hash = hash;
    const once = nav.resolveTab(readHash());
    assert.deepEqual(nav.resolveTab(once), once, `${hash}: resolving twice changes nothing`);
    assert.ok(nav.VIEW_IDS.includes(once.tab), `${hash}: lands on a real tab (${once.tab})`);
    location.hash = nav.hrefFor(once);
    assert.equal(nav.canonicalHash(readHash()), null, `${hash}: its canonical form is canonical`);
  }
});

test('app.js rewrites old links with history.replaceState and renders pages through pageOf', async () => {
  const app = await read('public/js/app.js');
  assert.match(app, /const fixed = canonicalHash\(hash\);\s*if \(fixed\) history\.replaceState\(null, '', fixed\);/);
  assert.match(app, /VIEWS\[pageOf\(state\)\]\.render\(/);
  const keys = app.match(/const VIEWS = \{([^}]*)\}/)[1].split(',').map((k) => k.trim()).sort();
  assert.deepEqual(keys, [...nav.PAGES].sort(), 'app.js has a module for every page');
  assert.match(app, /needsCatalog\(raw\)/);
});

test('q=ake still lists "Lake…" schools, with the table count (old and new links, and the search targets)', async () => {
  const { schools } = await api.schools();
  const want = schools.filter((s) => tableMatch(s, 'ake')).length;
  assert.equal(want, 59);
  for (const hash of ['#tab=schools&q=ake', '#tab=teams&q=ake']) {
    const { view, head } = await open(hash);
    assert.match(view.innerHTML, />Lake [^<]+<\/a>/, `${hash}: a Lake… school`);
    assert.equal((view.innerHTML.match(/<tr><td><a href="#tab=school&school=/g) || []).length, want, `${hash}: rows`);
    assert.match(head.innerHTML, new RegExp(`${want} of 1,337 schools`));
  }
  // The search's "All N" option opens the same list.
  const all = target({ kind: 'all', n: want, q: 'ake' }).hash;
  assert.equal(all, '#tab=schools&q=ake');
  location.hash = all;
  assert.equal(nav.pageOf(nav.resolveTab(readHash())), 'schools');
  // #31: a city's row opens that city's list (with its state), not a name search.
  assert.equal(target({ kind: 'city', city: 'San Antonio', state: 'TX', n: 17 }).hash, '#tab=schools&st=TX&city=San%20Antonio');
  assert.equal(target({ kind: 'school', row: { id: LOS_GATOS } }).hash, `#tab=school&school=${LOS_GATOS}`);
});

test('every tab (VIEW_IDS) and every page renders: no throw, a heading, no error state', async () => {
  const routes = [
    '#tab=schools', '#tab=schools&view=list', '#tab=schools&st=TX', `#tab=school&school=${LOS_GATOS}`,
    '#tab=events', '#tab=events&view=games&st=CA', '#tab=event&st=CA', '#tab=events&view=champions&st=CA', '#tab=about',
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

// Scope: the Main nav and the sub-nav (Events', or a school's). The breadcrumb's last item also carries
// aria-current="page" on purpose (WAI-ARIA breadcrumb pattern, its own <nav>); it is outside this check.
test('one aria-current="page" per route across the Main nav and the sub-nav', async () => {
  const cases = [
    ['#tab=schools', 'Schools', null], ['#tab=schools&q=ake', 'Schools', null], [`#tab=school&school=${LOS_GATOS}`, 'Schools', 'Overview'],
    [`#tab=school&view=results&school=${LOS_GATOS}`, 'Schools', 'Results'], [`#tab=school&view=history&school=${LOS_GATOS}`, 'Schools', 'Playoff history'],
    ['#tab=events', 'Events', 'Events'], ['#tab=events&view=games&st=CA', 'Events', 'All games'],
    ['#tab=events&view=champions&st=CA', 'Events', 'Champions'], ['#tab=event&st=CA', 'Events', 'Bracket'], ['#tab=event&view=games&st=CA', 'Events', 'Games'], ['#tab=about', null, null],
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
    assert.equal((main.match(/<a /g) || []).length, 2, 'Schools · Events (#30: "two views: Schools and Events")');
    assert.doesNotMatch(main, /Standings|Teams|Results|Playoffs/);
  }
  // Main nav links open their section fresh; Events' sub-nav keeps the state, season and gender.
  location.hash = '#tab=events&view=games&st=TX&season=2025-26&g=g';
  const r = nav.mainNavHtml(nav.resolveTab(readHash()));
  assert.match(r, /href="#tab=events"/);
  assert.match(r, /href="#tab=schools"/);
  const sub = nav.subNavHtml(nav.resolveTab(readHash()));
  assert.match(sub, /href="#tab=events&amp;st=TX&amp;season=2025-26&amp;g=g">Events</);
  assert.match(sub, /href="#tab=events&amp;view=games&amp;st=TX&amp;season=2025-26&amp;g=g" aria-current="page">All games</);
  assert.match(sub, /href="#tab=events&amp;view=champions&amp;st=TX&amp;g=g">Champions</);
  assert.equal(nav.subNavLabel(nav.resolveTab(readHash())), 'Events');
  // Both Main navs are labelled "Main", the sub-nav "Events", and app.js fills each from the same helpers.
  const html = await read('public/index.html');
  assert.match(html, /<nav class="header-nav" aria-label="Main" id="main-nav">/);
  assert.match(html, /<nav class="bottom-nav" aria-label="Main" id="bottom-nav">/);
  assert.match(html, /<nav class="view-tabs" aria-label="Events" id="tabs" hidden>/);
  assert.equal((html.match(/class="bottom-nav-link"/g) || []).length, 2);
  const app = await read('public/js/app.js');
  assert.match(app, /mainNav\.innerHTML = mainNavHtml\(state\);/);
  assert.match(app, /bottomNav\.innerHTML = mainNavHtml\(state, \{ cls: 'bottom-nav-link' \}\);/);
  assert.match(app, /subNav\.innerHTML = subNavHtml\(state, catalog\);/);
  assert.match(app, /subNav\.setAttribute\('aria-label', subNavLabel\(state, catalog\)\);/, 'an event\'s sub-nav is named by the event');
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
  // Since #26 the old names are teams/team (#21–#25) besides states/champions; schools/school are canonical again.
  // Since #30 results/playoffs are old too: links are written in their Events form at the source (Kongming).
  const OLD = /tab=(states|teams|team|champions|results|playoffs)(?![\w-])|tab:\s*'(states|teams|team|champions|results|playoffs)'/;
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
  // #20 PR 3: the modal phone drawer is gone (filters are an inline disclosure), so nothing goes inert.
  const shell = await read('public/js/shell.js');
  assert.doesNotMatch(shell, /\.inert = /);
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
