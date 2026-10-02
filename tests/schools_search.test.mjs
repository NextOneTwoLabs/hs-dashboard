// #26: the one search box moved from the header into the Schools page (landing and list), the tabs are named
// Schools / School again (hash option A), the phone header is one 56 px row, and "/" focuses the box from anywhere.
// Offline. The first tests read the shipped files and the pure nav.js helpers; the rest run the real app.js and
// components/searchBox.js against a small fake DOM (focus, hidden, events, hash history), over the shared netguard
// harness, so the render order is what's tested, not a copy of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, nav, read } from './helpers/views.mjs';

const { tableMatch } = await import('../public/js/search.js');
const MATER_DEI = '2b6b45d3-4465-4750-ba48-a273b674e37c';
const LOS_GATOS = 'bdb0b593-ef7f-4c69-8c2a-e0a48c934ca7';
const html = await read('public/index.html');
const css = await read('public/css/app.css');

// ---------- The shipped markup, styles and sources ----------

test('1. the header has no search; the Schools search band sits in #main between the page head and the filter row', () => {
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.doesNotMatch(header, /search/i, 'nothing search-related is left in the header');
  const at = (s) => { const i = html.indexOf(s); assert.ok(i > 0, s); return i; };
  assert.ok(at('id="main"') < at('class="content-header"'));
  assert.ok(at('id="tabs"') < at('id="school-search"'), 'after .content-header (the page head and the sub-nav)');
  assert.ok(at('id="school-search"') < at('id="filter-bar"'), 'before the filter row');
  assert.ok(at('id="filter-bar"') < at('id="view"'), 'and outside #view, which views overwrite');
  assert.match(html, /<section class="school-search" id="school-search" aria-labelledby="find-h" hidden>/);
  assert.match(html, /<h2 class="school-search-h" id="find-h">Find a school<\/h2>/);
  // The box keeps its combobox wiring (#13) and moves as one piece.
  const band = html.slice(at('id="school-search"'), at('id="filter-bar"'));
  for (const id of ['search-input', 'search-hint', 'search-panel', 'search-list', 'search-status', 'school-search-chips']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `one #${id}`);
    assert.match(band, new RegExp(`id="${id}"`), `#${id} is in the band`);
  }
  assert.match(band, /<input type="search" class="search-input" id="search-input" role="combobox"[^>]*aria-controls="search-list" aria-expanded="false" aria-describedby="search-hint"[^>]*placeholder="School name or city…"/);   // schools only (#30)
  assert.match(band, /<span class="search-kbd" aria-hidden="true">\/<\/span>/);
  assert.deepEqual([...band.matchAll(/<button type="button" class="chip" data-fill="([^"]+)">/g)].map((m) => m[1]),
    ['Los Gatos', 'Mater Dei', 'Lakeland', 'Southlake Carroll'], 'school names only (#30: "search in schools is to find schools")');
  // The labels say Schools everywhere.
  assert.match(html, /<a class="main-nav-link" href="#tab=schools"><span>Schools<\/span><\/a>/);
  assert.match(html, /<a class="bottom-nav-link" href="#tab=schools"><span>Schools<\/span><\/a>/);
  assert.match(html, /<a class="section-label" href="#tab=schools">/);
  assert.doesNotMatch(html, />Teams</);
});

test('2. no view writes into the band: views never touch the document, the box or its ids', async () => {
  for (const page of nav.PAGES) {
    const src = (await read(`public/js/views/${page}.js`)).replace(/^\s*\/\/.*$/gm, '');   // code, not comments
    // The band's ids and classes (the Events band's own `event-search` and its `.search-input` look are fine).
    assert.doesNotMatch(src, /school-search|id="search-|#search-(input|panel|status)|'search-(input|panel|status)'|hs-search-fill/, `${page}.js`);
    assert.doesNotMatch(src, /\bdocument\./, `${page}.js writes only its head, controls and view`);
  }
  const app = await read('public/js/app.js');
  // The band is shown before the view renders, and the search syncs (hs-rendered) before the title-focus step.
  const i = (re) => { const m = app.search(re); assert.ok(m > 0, String(re)); return m; };
  assert.ok(i(/schoolSearch\.hidden = !hasSchoolSearch\(state\);/) < i(/await VIEWS\[pageOf\(state\)\]\.render/));
  assert.ok(i(/window\.dispatchEvent\(new CustomEvent\('hs-rendered'\)\)/) < i(/if \(focusTitleAfter\(\{ cause, searchFocused:/),
    'hs-rendered is dispatched before focusTitleAfter, which then leaves focus in the box');
  assert.match(app, /searchChips\.hidden = pageOf\(state\) !== 'landing';/);
});

test('3. CSS: a 56 px phone header, nothing tied to the old 112 px, no fixed panel, the bottom bar hides while typing', () => {
  assert.doesNotMatch(css, /\.header-search/, 'the header search rules are gone');
  assert.doesNotMatch(css, /112px|--header-height:\s*112/, 'nothing sized from the two-row phone header');
  const phone = css.slice(css.indexOf('@media (max-width: 768px) {'), css.indexOf('@media (max-width: 400px) { .header-left'));
  assert.match(phone, /:root \{ --header-height: 56px;/);
  assert.doesNotMatch(phone, /grid-template-areas:\s*"[^"]*search/, 'no second header row for the box');
  // --header-height is used only by the fixed header's height and the layout's top padding.
  assert.deepEqual([...css.matchAll(/[^\n]*var\(--header-height\)[^\n]*/g)].map((m) => m[0].trim()),
    ['height: var(--header-height); padding: 0 20px;', '.layout { display: flex; height: 100vh; padding-top: var(--header-height); }']);
  // The suggestions panel hangs under the box everywhere (absolute), never at a fixed top under the header.
  for (const [, body] of css.matchAll(/\.qpanel \{([^}]*)\}/g)) assert.doesNotMatch(body, /position: fixed|var\(--header-height\)/);
  assert.match(phone, /\.qpanel \{[^}]*max-height: max\(160px, calc\(var\(--vvh, 100dvh\) - var\(--qpanel-top, 200px\) - 12px\)\);/);
  assert.match(phone, /body:has\(#search-input:focus\) \.bottom-nav, body\.search-focus \.bottom-nav \{ display: none; \}/);
  assert.match(phone, /\.search-kbd \{ display: none; \}/);
  assert.match(css, /\.school-search \{ padding: 14px 28px 0; \}/);
});

test('4. nav.js: the band\'s pages, the "/" shortcut and the box\'s text after a render', () => {
  const st = (hash) => nav.resolveTab(Object.fromEntries(new URLSearchParams(hash.slice(1))));
  for (const h of ['#tab=schools', '#tab=schools&view=list', '#tab=schools&q=ake', '#tab=schools&st=TX']) assert.equal(nav.hasSchoolSearch(st(h)), true, h);
  for (const h of [`#tab=school&school=${LOS_GATOS}`, '#tab=events&view=games', '#tab=events', '#tab=event', '#tab=about']) assert.equal(nav.hasSchoolSearch(st(h)), false, h);
  const body = { closest: () => null };
  const field = (tag) => ({ closest: (sel) => (sel.split(',').map((s) => s.trim()).includes(tag) ? {} : null) });
  const key = (k, extra = {}) => ({ key: k, target: body, ...extra });
  assert.deepEqual(nav.slashAction(st('#tab=events&view=games'), key('/')), { hash: '#tab=schools', focus: true });
  assert.deepEqual(nav.slashAction(st('#tab=schools&q=ake'), key('/')), { focus: true });
  assert.deepEqual(nav.slashAction(st('#tab=schools'), key('/', { shiftKey: true })), { focus: true }, 'layouts where "/" needs Shift');
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) assert.equal(nav.slashAction(st('#tab=events&view=games'), key('/', { [mod]: true })), null, mod);
  for (const tag of ['input', 'select', 'textarea']) assert.equal(nav.slashAction(st('#tab=events&view=games'), key('/', { target: field(tag) })), null, tag);
  assert.equal(nav.slashAction(st('#tab=events&view=games'), key('/', { target: { isContentEditable: true, closest: () => null } })), null);
  assert.equal(nav.slashAction(st('#tab=events&view=games'), key('?')), null);
  assert.equal(nav.slashAction(st('#tab=events&view=games'), { key: 'Divide', code: 'NumpadDivide', target: body }), null);
  // Leaving Schools clears the box; the list shows q= unless you are typing; the landing keeps your text.
  const after = (hash, focused, text) => nav.boxTextAfter({ state: st(hash), focused, text });
  assert.equal(after('#tab=events&view=games', true, 'mat'), '');
  assert.equal(after(`#tab=school&school=${LOS_GATOS}`, false, 'mat'), '');
  assert.equal(after('#tab=schools&q=mat', false, 'whatever'), 'mat', 'the list after Back shows its q');
  assert.equal(after('#tab=schools&view=list', false, 'mat'), '', 'the whole list: an empty box');
  assert.equal(after('#tab=schools&q=ake', true, 'ake'), 'ake', 'typing keeps your text');
  assert.equal(after('#tab=schools', true, 'ake'), 'ake');
  assert.equal(after('#tab=schools', false, 'ake'), 'ake');
});

// ---------- The real app.js and searchBox.js on a fake DOM ----------

let activeEl = null;
const docListeners = new Map();
class El {
  constructor(id = '', tag = 'div', parent = null) {
    Object.assign(this, { id, tagName: tag, parent, dataset: {}, attrs: {}, listeners: new Map(), textContent: '', value: '', isContentEditable: false, _hidden: false, _html: '' });
    this.style = { setProperty() {} };
    const cls = new Set();
    this.classList = { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, on) => (on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c), contains: (c) => cls.has(c) };
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); }
  get hidden() { return this._hidden; }
  // A focused element that becomes hidden loses focus, as in a browser.
  set hidden(v) { this._hidden = !!v; if (this._hidden && activeEl && activeEl.inside(this)) activeEl.blur(); }
  inside(other) { for (let e = this; e; e = e.parent) if (e === other) return true; return false; }
  shown() { for (let e = this; e; e = e.parent) if (e._hidden) return false; return true; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener() {}
  fire(type, ev = {}) {
    Object.assign(ev, { type, target: ev.target ?? this, defaultPrevented: false });
    ev.preventDefault = () => { ev.defaultPrevented = true; };
    for (const fn of this.listeners.get(type) || []) fn(ev);
    if (['keydown', 'click', 'input'].includes(type)) for (const fn of docListeners.get(type) || []) fn(ev);   // bubbles
    return ev;
  }
  focus() {
    if (!this.shown() || activeEl === this) return;   // a hidden element can't take focus
    const prev = activeEl;
    activeEl = this;
    prev?.fire('blur');
    this.fire('focus');
  }
  blur() { if (activeEl === this) { activeEl = body; this.fire('blur'); } }
  closest(sel) {
    for (const s of sel.split(',').map((x) => x.trim())) {
      if (s === this.tagName || (s.startsWith('#') && s.slice(1) === this.id)) return this;
      const data = s.match(/^\[data-([\w-]+)\]$/);
      if (data && data[1].replace(/-(\w)/g, (_, c) => c.toUpperCase()) in this.dataset) return this;
    }
    return null;
  }
  querySelector(sel) { return /^#[\w-]+$/.test(sel) && this._html.includes(`id="${sel.slice(1)}"`) ? new El(sel.slice(1), 'div', this) : null; }
  querySelectorAll() { return []; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  scrollIntoView() {}
  scrollTo() {}
  getBoundingClientRect() { return { top: 120, bottom: 164, left: 0, right: 600 }; }
}
const body = new El('', 'body');
activeEl = body;
const els = new Map();
const add = (id, tag = 'div', parent = null) => { const e = new El(id, tag, parent); els.set(id, e); return e; };
for (const id of ['header', 'main-nav', 'data-updated', 'theme-toggle', 'layout', 'page-head', 'tabs', 'filter-bar',
  'filter-toggle', 'filter-summary', 'controls', 'view', 'status-line', 'data-updated-foot', 'bottom-nav']) add(id);
const main = add('main');
const band = add('school-search', 'section', main);
band.hidden = true;
const input = add('search-input', 'input', band);
const panel = add('search-panel', 'div', band);
panel.hidden = true;
add('search-status', 'span', band);
const chips = add('school-search-chips', 'div', band);
const title = new El('', 'h1', main);   // the page's .content-title (one stand-in, written by setHead into #page-head)
globalThis.document = {
  body, title: '', documentElement: { style: { setProperty() {} }, dataset: {} },
  get activeElement() { return activeEl; },
  getElementById: (id) => els.get(id) ?? null,
  querySelector: (sel) => (sel === '.content-title' && els.get('page-head').innerHTML.includes('class="content-title"') ? title : null),
  addEventListener: (type, fn) => { if (!docListeners.has(type)) docListeners.set(type, []); docListeners.get(type).push(fn); },
};
globalThis.MutationObserver = class { observe() {} };
// Hash history: setting location.hash (a link) adds an entry and fires hashchange in a later task;
// pushState/replaceState change it silently; back() fires hashchange.
const entries = ['#tab=events&view=games&st=TX'];
let hash = entries[0];
const fireHashchange = () => setImmediate(() => window.dispatchEvent(new Event('hashchange')));
globalThis.location = {
  origin: 'http://hs.test', href: 'http://hs.test/',
  get hash() { return hash; },
  set hash(v) { v = v ? (String(v).startsWith('#') ? String(v) : `#${v}`) : ''; if (v === hash) return; hash = v; entries.push(v); fireHashchange(); },
};
globalThis.history = {
  pushState: (_s, _t, h) => { hash = h; entries.push(h); },
  replaceState: (_s, _t, h) => { hash = h; entries[entries.length - 1] = h; },
  back: () => { entries.pop(); hash = entries.at(-1); fireHashchange(); },
};

const tick = () => new Promise((r) => setImmediate(r));
// Resolves after app.js has finished a render: hs-rendered, then its title-focus and refocus steps.
// Fails (instead of hanging) when no render finishes within 5 s.
const rendered = () => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { window.removeEventListener('hs-rendered', f); reject(new Error(`no render finished (at ${location.hash})`)); }, 5000);
  const f = () => { clearTimeout(timer); window.removeEventListener('hs-rendered', f); setImmediate(resolve); };
  window.addEventListener('hs-rendered', f);
});
async function until(cond, what) {
  for (let i = 0; i < 400; i++) { if (cond()) return; await new Promise((r) => setTimeout(r, 5)); }
  assert.fail(`timed out waiting for ${what}`);
}
async function go(h) {
  if (location.hash === h) return;   // a link to the current hash fires no hashchange
  const p = rendered();
  location.hash = h;
  await p;
}
async function back() { const p = rendered(); history.back(); await p; }
const press = (key, mods = {}, target = activeEl) => target.fire('keydown', { key, ctrlKey: false, metaKey: false, altKey: false, ...mods, target });
async function type(text) {
  input.value = text;
  input.fire('input');
  await until(() => !panel.hidden && panel.innerHTML.includes('role="option"'), `suggestions for "${text}"`);
}
const h1 = () => els.get('page-head').innerHTML.match(/<h1 class="content-title"[^>]*>([^<]*)</)?.[1];
const rows = () => (els.get('view').innerHTML.match(/<tr><td><a href="#tab=school&school=/g) || []).length;
const { schools } = await api.schools();
const want = (q) => schools.filter((s) => tableMatch(s, q)).length;

let booted = null;
const boot = () => (booted ??= (async () => { const p = rendered(); await import('../public/js/app.js'); await p; })());

test('5. "/" from Results opens Schools and leaves focus in the box (not on the page title)', async () => {
  await boot();
  assert.equal(h1(), 'Texas games', 'booted on Events › All games (was Results)');
  assert.equal(band.hidden, true, 'no search band on Results');
  const p = rendered();
  const ev = press('/');
  assert.equal(ev.defaultPrevented, true, 'the "/" is not typed anywhere');
  await p;
  assert.equal(location.hash, '#tab=schools');
  assert.equal(h1(), 'Schools');
  assert.equal(band.hidden, false);
  assert.equal(chips.hidden, false, 'the landing shows the example chips');
  assert.equal(document.activeElement, input, 'focus ends in #search-input');
  assert.notEqual(document.activeElement, title);
  assert.equal(document.title, 'Schools · High School Girls Soccer');
  // On a Schools page "/" just focuses the box.
  title.focus();
  const n = entries.length;
  assert.equal(press('/').defaultPrevented, true);
  assert.equal(document.activeElement, input);
  await tick();
  assert.equal(location.hash, '#tab=schools');
  assert.equal(entries.length, n, 'no navigation');
});

test('6. "/" with Ctrl, Meta or Alt, or while typing in a field, does nothing', async () => {
  await boot();
  await go('#tab=events&view=games&st=TX');
  const before = location.hash;
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(press('/', { [mod]: true }, body).defaultPrevented, false, mod);
  }
  const select = new El('f-st', 'select', main);
  select.focus();
  assert.equal(press('/', {}, select).defaultPrevented, false, 'in a select');
  await tick(); await tick();
  assert.equal(location.hash, before, 'still on Results');
  assert.equal(document.activeElement, select);
  // In the box itself "/" is a character, not the shortcut.
  await go('#tab=schools');
  input.focus();
  assert.equal(press('/', {}, input).defaultPrevented, false);
});

test('7. landing → list: the text, the focus and the box stay; the table shows tableMatch rows', async () => {
  await boot();
  await go('#tab=schools');
  input.focus();
  await type('ake');
  const p = rendered();
  press('Enter', {}, input);   // "All N schools matching" on the landing: the list with q=ake
  await p;
  assert.equal(location.hash, '#tab=schools&q=ake');
  assert.equal(h1(), 'Schools');
  assert.equal(document.activeElement, input, 'focus stays in the box');
  assert.equal(input.value, 'ake', 'the text stays');
  assert.equal(document.getElementById('search-input'), input, 'the same element: nothing re-rendered it');
  assert.equal(band.hidden, false);
  assert.equal(chips.hidden, true, 'no chips on the list');
  assert.equal(rows(), want('ake'));
  assert.equal(rows(), 59);
  // Typing on the list filters the table in place (q= replaced, no new history entry).
  const n = entries.length;
  input.value = 'lake';
  input.fire('input');
  await until(() => rows() === want('lake'), 'the table to refilter');
  assert.equal(location.hash, '#tab=schools&q=lake');
  assert.equal(entries.length, n);
  assert.match(els.get('page-head').innerHTML, new RegExp(`${want('lake')} of 1,337 schools .* matching “lake”`));
});

test('8. the keyboard path: "/" from Results → "mat" → Enter → Mater Dei → Back', async () => {
  await boot();
  await go('#tab=events&view=games&st=TX');
  let p = rendered();
  press('/', {}, body);
  await p;
  assert.equal(document.activeElement, input);
  assert.equal(input.value, '', 'a fresh box');
  await type('mat');
  p = rendered();
  press('Enter', {}, input);
  await p;
  assert.equal(location.hash, `#tab=school&school=${MATER_DEI}`);
  assert.equal(h1(), 'Mater Dei Monarchs', 'the first school for "mat" (search.test.mjs targets)');
  assert.equal(document.activeElement, title, 'a school chosen from search focuses its page title');
  assert.equal(band.hidden, true, 'no search band on a school page');
  assert.equal(input.value, '');
  assert.equal(document.title, 'Schools · High School Girls Soccer');
  assert.match(els.get('main-nav').innerHTML, /aria-current="true">(?:<svg[\s\S]*?<\/svg>)?<span>Schools</, 'the Schools section stays marked');
  await back();
  assert.equal(location.hash, '#tab=schools');
  assert.equal(h1(), 'Schools');
  assert.equal(band.hidden, false);
  assert.equal(document.activeElement, title, 'Back focuses the page title');
});

test('9. the box clears when leaving Schools and shows q= when Back returns to the list', async () => {
  await boot();
  await go('#tab=schools&q=mat');
  assert.equal(input.value, 'mat', 'a list link fills the box with its q');
  assert.equal(rows(), want('mat'));
  await go(`#tab=school&school=${MATER_DEI}`);
  assert.equal(input.value, '', 'cleared on the school page');
  await back();
  assert.equal(location.hash, '#tab=schools&q=mat');
  assert.equal(input.value, 'mat', 'Back to the list shows its q');
  // Typed text on the landing, then Results through the Main nav, then Schools: an empty box.
  await go('#tab=schools');
  input.focus();
  input.value = 'xyz';
  input.fire('input');
  input.blur();   // clicking a nav link moves focus off the box
  await go('#tab=events&view=games');
  assert.equal(input.value, '', 'leaving Schools clears it');
  await go('#tab=schools');
  assert.equal(input.value, '', 'Schools via the nav starts empty');
  // The whole list (view=list) has no filter, so the box is empty there.
  await go('#tab=schools&view=list');
  assert.equal(input.value, '');
  assert.equal(rows(), 500, 'the first 500 of the whole list');
});

test('10. the landing chips fill the box and open its suggestions', async () => {
  await boot();
  await go('#tab=schools');
  const chip = new El('', 'button', chips);
  chip.dataset.fill = 'Mater Dei';
  chips.fire('click', { target: chip });
  await until(() => !panel.hidden && panel.innerHTML.includes('Mater Dei'), 'the chip\'s suggestions');
  assert.equal(input.value, 'Mater Dei');
  assert.equal(document.activeElement, input);
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  input.blur();
});

test('11. every old link opens its route through app.js, rewritten in place (no extra Back entry)', async () => {
  await boot();
  const cases = [
    // [old hash, rewritten hash, page title]
    ['#tab=teams', '#tab=schools', 'Schools'],
    ['#tab=teams&view=list', '#tab=schools&view=list', 'Schools'],
    ['#tab=teams&st=TX', '#tab=schools&st=TX', 'Texas schools'],
    ['#tab=teams&q=ake', '#tab=schools&q=ake', 'Schools'],
    [`#tab=team&school=${LOS_GATOS}`, `#tab=school&school=${LOS_GATOS}`, 'Los Gatos'],
    [`#tab=team&view=results&school=${LOS_GATOS}`, `#tab=school&view=results&school=${LOS_GATOS}`, 'Los Gatos'],
    [`#tab=team&view=history&season=2023-24&g=g&school=${LOS_GATOS}`, `#tab=school&view=history&season=2023-24&g=g&school=${LOS_GATOS}`, 'Los Gatos'],
    ['#tab=team', '#tab=schools&view=list', 'Schools'],
    ['#tab=school', '#tab=schools&view=list', 'Schools'],
    [`#school=${LOS_GATOS}`, `#tab=school&school=${LOS_GATOS}`, 'Los Gatos'],
    ['#tab=states', '#tab=schools', 'Schools'],
    ['#tab=states&st=TX', '#tab=schools&st=TX', 'Texas schools'],
    ['#tab=champions&st=PA', '#tab=events&view=champions&st=PA', 'Pennsylvania champions'],
    ['#tab=results&st=TX', '#tab=events&view=games&st=TX', 'Texas games'],
    ['#tab=playoffs&st=TX&season=2025-26&comp=tx-uil&div=5a-d1', '#tab=event&st=TX&season=2025-26&comp=tx-uil&div=5a-d1', 'Conference 5A D1'],
    ['#tab=playoffs&st=TX', '#tab=events&st=TX', 'Events'],
    ['#tab=bogus', '#tab=schools', 'Schools'],
  ];
  for (const [old, now, heading] of cases) {
    await go('#tab=about');
    const n = entries.length;
    await go(old);
    assert.equal(location.hash, now, old);
    assert.equal(entries.length, n + 1, `${old}: one entry, rewritten by replaceState`);
    if (heading) assert.equal(h1(), heading, old);
  }
  // Already-canonical links are left alone, including the pre-#20 bare #tab=schools (now the landing).
  for (const [h, heading] of [['#tab=schools', 'Schools'], [`#tab=school&school=${LOS_GATOS}`, 'Los Gatos'], ['#tab=schools&q=ake', 'Schools']]) {
    await go('#tab=about');
    await go(h);
    assert.equal(location.hash, h);
    assert.equal(h1(), heading, h);
  }
  await go('#tab=schools');
  assert.equal(chips.hidden, false, 'the bare #tab=schools is the landing');
});
