// #20 PR 3: filter rows replace the statewide sidebar. Compact selects above the content they filter; on
// phones a "Filters" disclosure with a summary; the school year apart from the season of play; no unexplained
// counts; a filter change keeps focus on its control (#18 items 1 and 2). Offline: the shared view harness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { open, read, root } from './helpers/views.mjs';

const filters = await import('../public/js/components/filters.js').catch(() => ({}));   // each test fails on its own before PR 3
const schools = await import('../public/js/views/schools.js');
const selected = (html, id) => html.match(new RegExp(`<select id="${id}"[^>]*>[\\s\\S]*?<option value="([^"]*)" selected>`))?.[1];
const labelOf = (html, id) => html.match(new RegExp(`<label for="${id}">([^<]+)</label>`))?.[1];

test('1. the statewide sidebar is gone; a filter row sits above the content it filters', async () => {
  const html = await read('public/index.html');
  assert.doesNotMatch(html, /id="sidebar"|<aside|id="sidebar-toggle"|drawer/, 'no sidebar, toggle or drawer');
  await assert.rejects(access(new URL('public/js/components/sidebar.js', root)), 'the sidebar pills module is gone');
  const order = ['class="content-header"', 'id="filter-bar"', 'id="view"'].map((s) => html.indexOf(s));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], `header, filters, content: ${order}`);
  assert.match(html, /<button class="filter-toggle" id="filter-toggle" type="button" aria-expanded="false" aria-controls="controls">/);
  assert.match(html, /<div class="controls" id="controls" role="group" aria-label="Filters"><\/div>/);
  const css = await read('public/css/app.css');
  assert.match(css, /\.filter-toggle \{ display: none; \}/, 'wider screens: the row, no toggle');
  const phone = css.slice(css.indexOf('@media (max-width: 768px)'));
  assert.match(phone, /\.filter-toggle \{\s*display: flex;/, 'phones: the toggle');
  assert.match(phone, /\.filter-bar:not\(\.open\) \.controls \{ display: none; \}/, 'phones: the panel opens on demand');
  // Found in the 320 px sweep: "CIF NorCal Regional Championships" widened the open panel to 380 px.
  assert.match(phone, /\.controls select \{ flex: 1 1 0; width: 0; min-width: 0;/, 'a long option cannot widen the panel');
});

// #30 PR 2: an event's championship, divisions and school year are on its page (tests/event_page.test.mjs has
// the rest); the filter row keeps only the gender toggle, shown when a state covers both.
test('2. An event (was Playoffs, #30): championship, divisions and school year on the page; an empty filter row', async () => {
  const { controls, view } = await open('#tab=event&st=CA&season=2024-25');
  assert.equal(controls.innerHTML, '', 'girls only: nothing in the filter row, so it hides');
  const html = view.innerHTML;
  assert.equal(labelOf(html, 'f-season'), 'School year');
  assert.equal(selected(html, 'f-season'), '2024-25');
  assert.equal(labelOf(html, 'f-comp'), 'Championship');
  assert.equal(selected(html, 'f-comp'), 'ca-cif-norcal');
  assert.match(html, /<option value="ca-cif-socal">CIF SoCal Regional Championships<\/option>/);
  assert.match(html, /<a class="pill" href="[^"]*div=gd1[^"]*" aria-current="true">D1<\/a>/);
  assert.doesNotMatch(html, /id="f-st"|id="f-div"/, 'the state comes from the breadcrumb; divisions are links');
  const one = await open('#tab=event&st=CA&season=2025-26');
  assert.doesNotMatch(one.view.innerHTML, /id="f-comp"/, 'no championship select when the year has one');
  assert.match(one.view.innerHTML, /<span class="field-label event-comp-name">CIF State Championships<\/span>/);
});

test('3. All games (was Results), Champions, the school list and Schools each filter with their own row', async () => {
  const res = await open('#tab=events&view=games&st=TX&show=upcoming');
  assert.deepEqual(['f-st', 'f-season', 'f-show'].map((id) => selected(res.controls.innerHTML, id)), ['TX', '2025-26', 'upcoming']);
  const champs = await open('#tab=events&view=champions&st=PA');
  assert.equal(selected(champs.controls.innerHTML, 'f-st'), 'PA');
  assert.doesNotMatch(champs.controls.innerHTML, /id="f-season"/, 'every school year is in the champions grid');
  const list = await open('#tab=schools&st=WA&q=east');
  assert.equal(selected(list.controls.innerHTML, 'f-st'), 'WA');
  assert.match(list.controls.innerHTML, /<option value="">All states<\/option>/);
  const all = await open('#tab=schools&view=list');
  assert.equal(selected(all.controls.innerHTML, 'f-st'), '');
  // The list's state select keeps the name filter, and the whole list stays the whole list.
  assert.deepEqual(schools.listPatch('ake')('st', 'TX'), { st: 'TX', view: null });
  assert.deepEqual(schools.listPatch('ake')('st', ''), { st: null, view: null });
  assert.deepEqual(schools.listPatch('')('st', ''), { st: null, view: 'list' });
  // #20 PR 5: the landing's season-of-play toggle filters only the state cards, so it moved beside them (the
  // "Browse by state" heading) and the page's filter row is empty and hidden.
  const landing = await open('#tab=schools');
  assert.equal(landing.controls.innerHTML, '');
  assert.match(landing.view.innerHTML, /<div class="landing-browse-row"><h2 class="section-h" id="browse-h">Browse by state<\/h2><div class="field seg-field"><span class="field-label" id="f-term-label">Season of play<\/span>/);
  assert.match(landing.view.innerHTML, /<button type="button" id="f-term-all" data-term="" aria-pressed="true">All<\/button>/);
  const about = await open('#tab=about');
  assert.equal(about.controls.innerHTML, '', 'nothing to filter on About: the row hides');
});

test('4. a change resets what depends on it, so old links and new choices land on valid pages', async () => {
  assert.deepEqual(filters.patchFor('st', 'TX'), { st: 'TX', season: null, comp: null, div: null });
  assert.deepEqual(filters.patchFor('season', '2023-24'), { season: '2023-24', comp: null, div: null });
  assert.deepEqual(filters.patchFor('comp', 'ca-cif-socal'), { comp: 'ca-cif-socal', div: null });
  assert.deepEqual(filters.patchFor('div', 'gd2'), { div: 'gd2' });
  assert.deepEqual(filters.patchFor('g', 'b'), { g: 'b', comp: null, div: null });
  // Old deep links still select the right event (st, season, comp, div keep their meaning).
  const ca = await open('#tab=playoffs&season=2025-26&comp=cif-state&div=gd1');
  assert.deepEqual([ca.state.st, selected(ca.view.innerHTML, 'f-season'), ca.state.div], ['CA', '2025-26', 'gd1']);
  const tx = await open('#tab=event&st=TX&season=2025-26&comp=tx-uil&div=5a-d1');
  assert.match(tx.view.innerHTML, /div=5a-d1[^"]*" aria-current="true">Conference 5A D1</);
});

test('5. phones: the "Filters" toggle summarises the selection', async () => {
  const { controls } = await open('#tab=events&view=games&st=CA&season=2024-25');
  assert.equal(filters.summaryOf(controls.innerHTML), 'California · 2024-25 · All games');
  // The same HTML read back from the DOM writes selected="".
  assert.equal(filters.summaryOf(controls.innerHTML.replace(/ selected>/g, ' selected="">')), 'California · 2024-25 · All games');
  assert.equal(filters.summaryOf(filters.termButtons({ states: [{ latestSeason: 'x', terms: ['fall'] }] }, 'fall')), 'Fall', 'a pressed toggle');
  assert.equal(filters.summaryOf((await open('#tab=events&view=games&st=TX&show=upcoming')).controls.innerHTML), 'Texas · 2025-26 · Upcoming');
  const app = await read('public/js/app.js');
  assert.match(app, /filterSummary\.textContent = summaryOf\(controls\.innerHTML\);/);
  assert.match(app, /new MutationObserver\(syncFilters\)\.observe\(controls/);
});

test('6. #18: a filter select or toggle keeps focus after the re-render; the panel is a disclosure', async () => {
  const app = await read('public/js/app.js');
  assert.match(app, /const keep = document\.activeElement\?\.closest\?\.\('#filter-bar, #view'\) \? document\.activeElement\.id \|\| null : null;/);
  assert.match(app, /if \(!silent\) render\('control', \{ keep \}\);/);
  assert.match(app, /const again = refocusId\(\{ cause, keep \}\);/);
  assert.match(app, /if \(cause === 'hashchange'\) setFiltersOpen\(false\);/, 'navigating closes the phone panel; a filter change keeps it open');
  // Every control has an id to come back to.
  const { controls } = await open('#tab=events&view=games&st=CA&season=2024-25');
  assert.deepEqual([...controls.innerHTML.matchAll(/<select id="([^"]+)"/g)].map((m) => m[1]), ['f-st', 'f-season', 'f-show']);
  const ev = await open('#tab=event&st=CA&season=2024-25');   // an event's selects are in #view, which keeps focus too
  assert.deepEqual([...ev.view.innerHTML.matchAll(/<select id="([^"]+)"/g)].map((m) => m[1]), ['f-comp', 'f-season']);
  assert.match((await import('../public/js/components/controls.js')).segmented('g', 'g', [['b', 'Boys'], ['g', 'Girls']], 'Gender'),
    /<button type="button" id="f-g-g" data-set-g="g" aria-pressed="true">Girls<\/button>/);
  const states = await read('public/js/views/landing.js');   // the Schools landing (#20 PR 5, #26; was states.js)
  assert.match(states, /draw\(b\.id\);/, 'the landing\'s season-of-play buttons redraw and refocus themselves');
  const shell = await read('public/js/shell.js');
  assert.match(shell, /toggle\.setAttribute\('aria-expanded', String\(open\)\);/);
  assert.match(shell, /e\.key === 'Escape' && filtersOpen\(\)\) \{ e\.preventDefault\(\); setFiltersOpen\(false, \{ restore: true \}\); \}/);
});

// #23 review B1: the bracket's round pills (named in #18 item 1) re-render the bracket through setState, so they
// need ids for focus to come back to the pressed pill instead of falling to <body>.
test('7. the bracket\'s round pills keep focus: each has a stable id that survives the re-render', async () => {
  const pills = (els) => {
    const html = els.map((e) => e.innerHTML).join('');
    return [...html.matchAll(/<button type="button" class="pill"([^>]*) data-round="(\d+)" aria-pressed="(true|false)">/g)]
      .map((m) => ({ id: m[1].match(/ id="([^"]+)"/)?.[1] ?? null, round: m[2], pressed: m[3] }));
  };
  const first = pills((await open('#tab=event&st=CA&season=2024-25')).made);
  assert.ok(first.length >= 3, `round pills rendered: ${first.length}`);
  for (const p of first) assert.equal(p.id, `round-${p.round}`, `round ${p.round} has an id`);
  assert.equal(new Set(first.map((p) => p.id)).size, first.length, 'ids are unique');
  // Pressing round 0 re-renders with round=0 in the hash: the same ids are there, now with round 0 pressed.
  const again = pills((await open('#tab=event&st=CA&season=2024-25&round=0')).made);
  assert.deepEqual(again.map((p) => p.id), first.map((p) => p.id));
  assert.equal(again.find((p) => p.round === '0').pressed, 'true');
  const src = await read('public/js/views/playoffs.js');
  assert.match(src, /btn\.addEventListener\('click', \(\) => setState\(\{ round: btn\.dataset\.round \}, \{ replace: true \}\)\)/,
    'a pill press goes through setState, which keeps the focused id (the pill is inside #view)');
  // Non-blocking notes: Escape works with focus on the toggle too. Since #26 the school list's row has no "box at
  // the top" hint: the box is right above it, in the Schools search band.
  const shell = await read('public/js/shell.js');
  assert.match(shell, /bar\.addEventListener\('keydown'/, 'Escape is handled on the whole filter bar, toggle included');
  const list = await open('#tab=schools&view=list');
  assert.doesNotMatch(list.controls.innerHTML, /filter-hint|box at the top/);
  assert.doesNotMatch(list.controls.innerHTML, /filter-term/);
});

// #23 review B2: at 320 px the landing's four "Season of play" buttons beside the 92 px label column ran past the
// panel (Spring at 289–358 against an edge at 304) and `.seg { overflow: hidden }` cut it to "Sp".
test('8. phones: a toggle group stacks under its label and wraps, so no button is cut off', async () => {
  const landing = await open('#tab=schools');   // the toggle is beside the state cards since #20 PR 5
  assert.match(landing.view.innerHTML, /<div class="field seg-field"><span class="field-label" id="f-term-label">Season of play<\/span><div class="seg"/);
  const { segmented } = await import('../public/js/components/controls.js');
  assert.match(segmented('g', 'g', [['b', 'Boys'], ['g', 'Girls']], 'Gender'), /^<div class="field seg-field">/, 'the gender toggle too');
  const css = await read('public/css/app.css');
  const phone = css.slice(css.indexOf('@media (max-width: 768px)'));
  assert.match(phone, /\.controls \.seg-field \{ flex-direction: column; align-items: stretch;/, 'the label sits above the buttons');
  assert.match(phone, /\.controls \.seg \{ display: flex; flex-wrap: wrap; overflow: visible; \}/, 'the group wraps and is not clipped');
  assert.match(phone, /\.controls \.seg button \{ flex: 1 1 auto;/, 'the buttons share the full width');
});
