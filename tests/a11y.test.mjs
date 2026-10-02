// #11: redesign accessibility follow-ups (no DOM, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.fetch = () => { throw new Error('netguard: network access blocked in tests'); };
globalThis.location = { hash: '' };

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');
const json = async (p) => JSON.parse(await read(p));
const filters = await import('../public/js/components/filters.js');
const nav = await import('../public/js/nav.js');
const { normalize } = await import('../public/js/state.js');
const statesIndex = await json('public/archive/states.json');

// #20 PR 3 replaced the sidebar pills (whose names #11 fixed) with filter selects and toggle buttons. Each
// select is named by its visible <label for>, each button by its own text: Label in Name holds by construction.
test('1. every filter control is named by its visible label', async () => {
  const html = [filters.stateSelect(statesIndex, 'TX'), filters.stateSelect(statesIndex, null, { all: true }),
    filters.termButtons(statesIndex, 'fall'), filters.showSelect('')];
  for (const s of statesIndex.states.filter((x) => x.latestSeason)) {
    const catalog = await json(`public/archive/states/${s.code}/catalog.json`);
    for (const season of catalog.seasons.filter((x) => x.competitions.length)) {
      const st = normalize({ st: s.code, season: season.season }, catalog);
      html.push(filters.seasonSelect(catalog, st.season), filters.compSelect(season, st.comp));
      for (const comp of season.competitions) html.push(filters.divisionSelect(comp, { ...st, comp: comp.id }));
    }
  }
  const all = html.join('');
  const selects = [...all.matchAll(/<label for="([^"]+)">([^<]+)<\/label><select id="([^"]+)"/g)];
  assert.ok(selects.length > 30);
  for (const [, forId, label, id] of selects) {
    assert.equal(forId, id, `${label}: the label points at its select`);
    assert.ok(label.trim(), 'a visible label');
  }
  assert.equal((all.match(/<select /g) || []).length, selects.length, 'no select without a label');
  assert.doesNotMatch(all, /aria-label=/, 'no hidden names that differ from the visible text');
  assert.doesNotMatch(all, /pill-sub|>\d+</, 'no unexplained counts');
  assert.match(all, /<label for="f-season">School year<\/label>/);
});

test('2. "Data updated" is shown once: the header, or the footer on narrow screens, never both', async () => {
  const app = await read('public/js/app.js');
  assert.doesNotMatch(app, /status-line[^\n]*Data updated|Data updated[^\n]*status-line/, 'app.js no longer appends it to the footer line');
  const html = await read('public/index.html');
  assert.equal((html.match(/id="data-updated"/g) || []).length, 1);
  assert.match(html, /<footer class="footer">[\s\S]*id="data-updated-foot"/);
  const css = await read('public/css/app.css');
  assert.match(css, /\.footer-updated \{ display: none; \}/);
  const narrow = css.match(/@media \(max-width: 1100px\) \{([^}]*\}[^}]*\})/)[1];
  assert.match(narrow, /\.observed-top \{ display: none; \}/);
  assert.match(narrow, /\.footer-updated \{ display: inline; \}/);
  const shell = await read('public/js/shell.js');
  assert.match(shell, /data-updated-foot/);
});

test('3. the view is not an aria-live region; navigation moves focus to the page title', async () => {
  const html = await read('public/index.html');
  assert.doesNotMatch(html.match(/<div class="content-body" id="view"[^>]*>/)[0], /aria-live/);
  // Navigation (a link, a nav link, Back) moves focus to the title; an in-page control or the first load does not.
  // (Nav links are plain hash links since #20, so the old 'tab' cause is gone.)
  const f = nav.focusTitleAfter;
  assert.equal(f({ cause: 'hashchange' }), true);
  assert.equal(f({ cause: 'boot' }), false);
  assert.equal(f({ cause: 'control' }), false);
  assert.equal(f({ cause: 'hashchange', searchFocused: true }), false, 'typing in the header search keeps focus');
  // #20 PR 3: the phone drawer is gone; a filter change is an in-page control, and focus returns to it.
  assert.equal(nav.refocusId({ cause: 'control', keep: 'f-season' }), 'f-season');
  assert.equal(nav.refocusId({ cause: 'hashchange', keep: 'f-season' }), null);
  const app = await read('public/js/app.js');
  assert.match(app, /focusTitleAfter\(/);
  assert.match(app, /focusPageTitle\(\)/, 'through components/titleFocus.js since #31');
  assert.match(await read('public/js/components/titleFocus.js'), /querySelector\('\.content-title'\)/);
});
