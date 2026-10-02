// #11: redesign accessibility follow-ups (no DOM, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.fetch = () => { throw new Error('netguard: network access blocked in tests'); };
globalThis.location = { hash: '' };

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');
const json = async (p) => JSON.parse(await read(p));
const sidebar = await import('../public/js/components/sidebar.js');
const nav = await import('../public/js/nav.js');
const { normalize } = await import('../public/js/state.js');
const statesIndex = await json('public/archive/states.json');

// Every pill's accessible name starts with its visible text (WCAG 2.5.3, Label in Name).
function pills(html) {
  return [...html.matchAll(/<(a|button) [^>]*class="pill"[^>]*aria-label="([^"]*)"[^>]*>(.*?)<\/\1>/g)]
    .map((m) => ({ name: m[2], visible: m[3].replace(/<span class="pill-sub"[^>]*>.*?<\/span>/, '').replace(/<[^>]+>/g, '') }));
}

test('1. pill accessible names start with the visible text', async () => {
  const html = [];
  html.push(sidebar.statePills(statesIndex, 'TX', (c) => `#tab=playoffs&st=${c}`));
  html.push(sidebar.statePills(statesIndex, null, (c) => `#tab=schools&st=${c}`, { all: '#tab=schools', count: 'schools' }));
  html.push(sidebar.termPills(statesIndex, 'fall'));
  for (const s of statesIndex.states.filter((x) => x.latestSeason)) {
    const catalog = await json(`public/archive/states/${s.code}/catalog.json`);
    for (const season of catalog.seasons.filter((x) => x.competitions.length)) {
      const st = normalize({ st: s.code, season: season.season }, catalog);
      html.push(sidebar.compPills(season, st), sidebar.showPills(st));
      for (const comp of season.competitions) html.push(sidebar.divisionPills(comp, { ...st, comp: comp.id }));
    }
  }
  const all = pills(html.join(''));
  assert.ok(all.length > 50);
  for (const p of all) assert.ok(p.name.startsWith(p.visible), `"${p.name}" starts with "${p.visible}"`);
  const tx = pills(html[0]).find((p) => p.visible === 'TX');
  assert.equal(tx.name, 'TX, Texas, 6 brackets in 2025-26');
  assert.equal(pills(html[1]).find((p) => p.visible === 'TX').name, 'TX, Texas, 384 schools');
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
  assert.equal(f({ cause: 'hashchange', drawerOpen: true }), false, 'a phone drawer keeps focus');
  const app = await read('public/js/app.js');
  assert.match(app, /focusTitleAfter\(/);
  assert.match(app, /\.content-title/);
});
