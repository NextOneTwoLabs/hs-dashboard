// #31: one search box in the site header, on every page (owner: "the search box should appear at header"). It
// accepts a school's name, a state or a city; every option is a school or a list of schools. On phones it is a
// search button that opens a full-width bar (Escape: the list, then the text, then the bar). "/" focuses it
// everywhere. The page title gets focus after navigation without a ring (data-scripted-focus).
// (#26 put the box in a Schools page band; this file grew from its tests.)
// Offline. The first tests read the shipped files and the pure nav.js helpers; the rest run the real app.js and
// components/searchBox.js against a small fake DOM (focus, hidden, events, hash history), over the shared netguard
// harness, so the render order is what's tested, not a copy of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, nav, read } from './helpers/views.mjs';

const { tableMatch, cityMatch } = await import('../public/js/search.js');
const MATER_DEI = '2b6b45d3-4465-4750-ba48-a273b674e37c';
const LOS_GATOS = 'bdb0b593-ef7f-4c69-8c2a-e0a48c934ca7';
const html = await read('public/index.html');
const css = await read('public/css/app.css');

// ---------- The shipped markup, styles and sources ----------

test('1. one search box, in the header, between the Main nav and the right group; no Schools band', () => {
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  const at = (s) => { const i = header.indexOf(s); assert.ok(i > 0, s); return i; };
  assert.ok(at('id="main-nav"') < at('id="search"') && at('id="search"') < at('class="header-right"'));
  assert.match(header, /<div class="header-search search" id="search" role="search" aria-label="Search schools">/);
  for (const id of ['search-input', 'search-hint', 'search-panel', 'search-list', 'search-status', 'search-close', 'search-toggle']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `one #${id}`);
    assert.match(header, new RegExp(`id="${id}"`), `#${id} is in the header`);
  }
  assert.match(header, /<input type="search" class="search-input" id="search-input" role="combobox"[^>]*aria-controls="search-list" aria-expanded="false" aria-describedby="search-hint"[^>]*placeholder="School, city or state…"/);
  // Phones: the button names the bar it opens (Kongming v4: aria-controls is the bar, present at all times).
  assert.match(header, /<button class="header-search-toggle" id="search-toggle" type="button" aria-label="Search schools" aria-expanded="false" aria-controls="search">/);
  assert.match(header, /<button type="button" class="header-search-close" id="search-close">Close<\/button>/);
  assert.doesNotMatch(html, /id="school-search"|Find a school|school-search-chips/, 'the Schools band is gone');
  assert.equal((html.match(/role="search"/g) || []).length, 1, 'one search landmark in the page shell');
});

test('2. views never write the box; the Events band is a second landmark with its own name', async () => {
  for (const page of nav.PAGES) {
    const src = (await read(`public/js/views/${page}.js`)).replace(/^\s*\/\/.*$/gm, '');   // code, not comments
    assert.doesNotMatch(src, /school-search|id="search-|#search-(input|panel|status)|'search-(input|panel|status)'|hs-search-fill/, `${page}.js`);
    assert.doesNotMatch(src, /\bdocument\./, `${page}.js writes only its head, controls and view`);
  }
  assert.match(await read('public/js/views/events.js'), /<div class="search" role="search" aria-label="Search events">/);
  const app = await read('public/js/app.js');
  const i = (re) => { const m = app.search(re); assert.ok(m > 0, String(re)); return m; };
  assert.ok(i(/window\.dispatchEvent\(new CustomEvent\('hs-rendered'\)\)/) < i(/if \(focusTitleAfter\(\{ cause, searchFocused:/),
    'hs-rendered is dispatched before focusTitleAfter, which then leaves focus in the box');
  assert.doesNotMatch(app, /schoolSearch|searchChips|hasSchoolSearch/);
});

test('3. CSS: the header box and its room, the panel kept on screen, the phone bar, the title ring', () => {
  assert.match(css, /\.header-search \{ position: relative; flex: 1 1 360px; min-width: 180px; max-width: 440px;/);
  assert.match(css, /@media \(max-width: 1180px\) \{[^}]*\.main-nav-link svg \{ display: none; \}[\s\S]*?\.header-divider, \.section-label \{ display: none; \}/,
    'the label goes below 1181 px, for the box');
  assert.match(css, /@media \(max-width: 1024px\) \{ \.header-right \.header-link \{ display: none; \} \}/);
  // Kongming v4: the panel stays inside the viewport (769–1024 px: it ends at the box's right edge).
  assert.match(css, /\.header-search \.qpanel \{ left: 0; right: auto; width: max\(100%, 460px\); max-width: calc\(100vw - 32px\);/);
  assert.match(css, /@media \(max-width: 1024px\) \{ \.header-search \.qpanel \{ left: auto; right: 0; \} \}/);
  const phone = css.slice(css.indexOf('@media (max-width: 768px) {'), css.indexOf('@media (max-width: 400px) { .header-left'));
  assert.match(phone, /:root \{ --header-height: 56px;/);
  assert.match(phone, /\.header-search \{ display: none; position: fixed; top: var\(--header-height\); left: 0; right: 0;/);
  assert.match(phone, /\.header\.search-open \.header-search \{ display: flex; \}/);
  assert.match(phone, /body\.search-open \.bottom-nav \{ display: none; \}/, 'the bottom bar stays hidden while the bar is open');
  assert.match(phone, /body:has\(#search-input:focus\) \.bottom-nav, body\.search-focus \.bottom-nav \{ display: none; \}/);
  assert.match(phone, /\.header-search-toggle \{ display: inline-flex;[^}]*width: 40px; height: 40px;/);
  assert.doesNotMatch(css, /112px|\.school-search\b/, 'no two-row header, no Schools band');
  // The title: no ring on a scripted focus; the #18 ring for any other focus.
  assert.match(css, /\.content-title\[data-scripted-focus\]:focus-visible \{ outline: none; \}/);
  assert.match(css, /\.content-title:focus-visible \{ outline: 2px solid var\(--accent-text\);/);
  for (const [, body] of css.matchAll(/\.qpanel \{([^}]*)\}/g)) assert.doesNotMatch(body, /position: fixed/);
});

test('4. nav.js: "/" everywhere, the box\'s text after a render, and the `city` key', () => {
  const st = (hash) => nav.resolveTab(Object.fromEntries(new URLSearchParams(hash.slice(1))));
  const body = { closest: () => null };
  const field = (tag) => ({ closest: (sel) => (sel.split(',').map((s) => s.trim()).includes(tag) ? {} : null) });
  const key = (k, extra = {}) => ({ key: k, target: body, ...extra });
  for (const h of ['#tab=events&view=games', '#tab=schools', `#tab=school&school=${LOS_GATOS}`, '#tab=event', '#tab=about']) {
    assert.deepEqual(nav.slashAction(st(h), key('/')), { focus: true }, `${h}: in place, no navigation`);
  }
  assert.deepEqual(nav.slashAction(st('#tab=schools'), key('/', { shiftKey: true })), { focus: true }, 'layouts where "/" needs Shift');
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) assert.equal(nav.slashAction(st('#tab=events&view=games'), key('/', { [mod]: true })), null, mod);
  for (const tag of ['input', 'select', 'textarea']) assert.equal(nav.slashAction(st('#tab=events&view=games'), key('/', { target: field(tag) })), null, tag);
  assert.equal(nav.slashAction(st('#tab=events&view=games'), key('/', { target: { isContentEditable: true, closest: () => null } })), null);
  assert.equal(nav.slashAction(st('#tab=events&view=games'), key('?')), null);
  // The text: cleared on any navigation, except Schools landing ↔ list; the list shows q= unless you type.
  const after = (hash, focused, text) => nav.boxTextAfter({ state: st(hash), focused, text });
  assert.equal(after('#tab=events&view=games', true, 'mat'), '');
  assert.equal(after(`#tab=school&school=${LOS_GATOS}`, false, 'mat'), '');
  assert.equal(after('#tab=event&st=CA', false, 'mat'), '');
  assert.equal(after('#tab=schools&q=mat', false, 'whatever'), 'mat', 'the list after Back shows its q');
  assert.equal(after('#tab=schools&view=list', false, 'mat'), '', 'the whole list: an empty box');
  assert.equal(after('#tab=schools&q=ake', true, 'ake'), 'ake', 'typing keeps your text');
  assert.equal(after('#tab=schools', true, 'ake'), 'ake');
  // `city` (Kongming v2): kept only on the school list with a state; idempotent, and canonical when kept.
  assert.equal(st('#tab=schools&st=TX&city=Austin').city, 'Austin');
  for (const h of ['#tab=schools&city=Austin', `#tab=school&school=${LOS_GATOS}&city=Austin`, '#tab=events&city=Austin', '#tab=event&st=TX&city=Austin']) {
    assert.equal(st(h).city, undefined, h);
  }
  for (const h of ['#tab=schools&st=TX&city=Austin', '#tab=schools&city=Austin', '#tab=events&city=X']) {
    const once = st(h);
    assert.deepEqual(nav.resolveTab(once), once, `${h}: resolving twice changes nothing`);
    assert.equal(nav.canonicalHash(Object.fromEntries(new URLSearchParams(nav.hrefFor(once).slice(1)))), null, h);
  }
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
  contains(other) { return !!other?.inside?.(this); }
  shown() { for (let e = this; e; e = e.parent) if (e._hidden) return false; return true; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener() {}
  fire(type, ev = {}) {
    Object.assign(ev, { type, target: ev.target ?? this, defaultPrevented: false });
    ev.preventDefault = () => { ev.defaultPrevented = true; };
    for (const fn of this.listeners.get(type) || []) fn(ev);
    if (['keydown', 'click', 'input', 'pointerdown'].includes(type)) for (const fn of docListeners.get(type) || []) fn(ev);   // bubbles
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
  getBoundingClientRect() { return { top: 12, bottom: 50, left: 400, right: 800 }; }
}
const body = new El('', 'body');
activeEl = body;
const els = new Map();
const add = (id, tag = 'div', parent = null) => { const e = new El(id, tag, parent); els.set(id, e); return e; };
const header = add('header', 'header');
for (const id of ['main-nav', 'data-updated', 'theme-toggle']) add(id, 'div', header);
for (const id of ['layout', 'page-head', 'tabs', 'filter-bar', 'filter-toggle', 'filter-summary', 'controls', 'view', 'status-line',
  'data-updated-foot', 'bottom-nav']) add(id);
const main = add('main');
const box = add('search', 'div', header);
const input = add('search-input', 'input', box);
const panel = add('search-panel', 'div', box);
panel.hidden = true;
add('search-status', 'span', box);
const closeBtn = add('search-close', 'button', box);
const toggle = add('search-toggle', 'button', header);
const title = new El('', 'h1', main);   // the page's .content-title (one stand-in, written by setHead into #page-head)
globalThis.document = {
  body, title: '', documentElement: { style: { setProperty() {} }, dataset: {} },
  get activeElement() { return activeEl; },
  getElementById: (id) => els.get(id) ?? null,
  querySelector: (sel) => (sel === '.content-title' && els.get('page-head').innerHTML.includes('class="content-title"') ? title : null),
  addEventListener: (type, fn) => { if (!docListeners.has(type)) docListeners.set(type, []); docListeners.get(type).push(fn); },
};
globalThis.MutationObserver = class { observe() {} };
// One media query object, so a test can switch to a phone width before the search reads it.
const mq = { matches: false, addEventListener() {}, removeEventListener() {} };
globalThis.matchMedia = () => mq;
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

test('5. "/" focuses the header box in place, on any page (no navigation)', async () => {
  await boot();
  assert.equal(h1(), 'Texas games', 'booted on Events › All games');
  for (const h of ['#tab=events&view=games&st=TX', `#tab=school&school=${LOS_GATOS}`, '#tab=about', '#tab=schools']) {
    await go(h);
    body.focus();
    const n = entries.length;
    const ev = press('/', {}, body);
    assert.equal(ev.defaultPrevented, true, `${h}: the "/" is not typed anywhere`);
    assert.equal(document.activeElement, input, `${h}: focus in #search-input`);
    await tick();
    assert.equal(location.hash, h, `${h}: no navigation`);
    assert.equal(entries.length, n);
    input.blur();
  }
});

test('6. "/" with Ctrl, Meta or Alt, or while typing in a field, does nothing', async () => {
  await boot();
  await go('#tab=events&view=games&st=TX');
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(press('/', { [mod]: true }, body).defaultPrevented, false, mod);
  }
  const select = new El('f-st', 'select', main);
  select.focus();
  assert.equal(press('/', {}, select).defaultPrevented, false, 'in a select');
  assert.equal(document.activeElement, select);
  input.focus();
  assert.equal(press('/', {}, input).defaultPrevented, false, 'in the box itself "/" is a character');
  input.blur();
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
  assert.equal(document.activeElement, input, 'focus stays in the box');
  assert.equal(input.value, 'ake', 'the text stays');
  assert.equal(rows(), want('ake'));
  assert.equal(rows(), 59);
  // Typing on the list filters the table in place (q= replaced, no new history entry).
  const n = entries.length;
  input.value = 'lake';
  input.fire('input');
  await until(() => rows() === want('lake'), 'the table to refilter');
  assert.equal(location.hash, '#tab=schools&q=lake');
  assert.equal(entries.length, n);
  input.blur();
});

test('8. the keyboard path: "/" on All games → "mat" → Enter → Mater Dei (title, no ring) → Back', async () => {
  await boot();
  await go('#tab=events&view=games&st=TX');
  press('/', {}, body);
  assert.equal(document.activeElement, input);
  assert.equal(input.value, '', 'a fresh box');
  await type('mat');
  const p = rendered();
  press('Enter', {}, input);
  await p;
  assert.equal(location.hash, `#tab=school&school=${MATER_DEI}`);
  assert.equal(h1(), 'Mater Dei Monarchs', 'the first school for "mat"');
  assert.equal(document.activeElement, title, 'a school chosen from search focuses its page title');
  assert.equal(title.getAttribute('data-scripted-focus'), '', 'marked as a scripted focus: no ring (B2)');
  assert.equal(input.value, '');
  await back();
  assert.equal(location.hash, '#tab=events&view=games&st=TX');
  assert.equal(document.activeElement, title, 'Back focuses the page title');
  body.focus();
  assert.equal(title.getAttribute('data-scripted-focus'), null, 'the mark goes when the title loses focus');
});

test('9. the box clears on navigation, except Schools landing ↔ list; Back to the list shows q=', async () => {
  await boot();
  await go('#tab=schools&q=mat');
  assert.equal(input.value, 'mat', 'a list link fills the box with its q');
  await go(`#tab=school&school=${MATER_DEI}`);
  assert.equal(input.value, '', 'cleared on the school page');
  await back();
  assert.equal(location.hash, '#tab=schools&q=mat');
  assert.equal(input.value, 'mat', 'Back to the list shows its q');
  await go('#tab=event&st=CA');
  assert.equal(input.value, '', 'cleared on an event page');
  await go('#tab=schools');
  assert.equal(input.value, '', 'Schools from elsewhere starts empty');
});

test('10. a state row and a city row open those lists, with the counts they said; typing on a city list drops the city', async () => {
  await boot();
  await go('#tab=schools');
  input.focus();
  await type('Texas');
  assert.match(panel.innerHTML, /All 384 schools in Texas →/);
  let p = rendered();
  press('Enter', {}, input);
  await p;
  assert.equal(location.hash, '#tab=schools&st=TX');
  assert.equal(rows(), 384, 'the row\'s count is the list\'s');
  input.focus();
  await type('san antonio');
  assert.match(panel.innerHTML, /All 17 schools in San Antonio, TX →/);
  p = rendered();
  press('Enter', {}, input);
  await p;
  assert.equal(location.hash, '#tab=schools&st=TX&city=San%20Antonio');
  assert.equal(rows(), 17);
  assert.equal(rows(), schools.filter((r) => cityMatch(r, 'TX', 'San Antonio')).length);
  assert.equal(h1(), 'San Antonio, TX schools');
  assert.match(els.get('page-head').innerHTML, /<a href="#tab=schools&amp;st=TX">Texas<\/a>.*>San Antonio</s, 'Schools › Texas › San Antonio');
  // Typing on a city's list starts a name search in the state: the city goes.
  input.focus();
  input.value = 'lake';
  input.fire('input');
  await until(() => !location.hash.includes('city='), 'the city to go');
  assert.equal(location.hash, '#tab=schools&st=TX&q=lake');
  input.blur();
});

test('11. phones: the search button opens the bar; Escape closes the list, then clears, then closes the bar', async () => {
  await boot();
  await go(`#tab=school&school=${LOS_GATOS}`);
  mq.matches = true;
  try {
    toggle.fire('click');
    assert.ok(header.classList.contains('search-open'), 'the bar is open');
    assert.ok(body.classList.contains('search-open'), 'the bottom bar is hidden while it is open');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(document.activeElement, input, 'focus in the box');
    await type('mat');
    press('Escape', {}, input);
    assert.equal(panel.hidden, true, '1. the list closes');
    assert.equal(input.value, 'mat');
    press('Escape', {}, input);
    assert.equal(input.value, '', '2. the text clears');
    assert.ok(header.classList.contains('search-open'), 'the bar is still open');
    press('Escape', {}, input);
    assert.ok(!header.classList.contains('search-open'), '3. the bar closes');
    assert.equal(document.activeElement, toggle, 'focus back on the search button');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.ok(!body.classList.contains('search-open'));
    // Close: at once, keeping the text.
    toggle.fire('click');
    input.value = 'xyz';
    closeBtn.fire('click');
    assert.ok(!header.classList.contains('search-open'));
    assert.equal(input.value, 'xyz', 'Close keeps the text');
    assert.equal(document.activeElement, toggle);
    // A tap outside: closes without clearing, and the bottom bar stays hidden until then, even off the box.
    toggle.fire('click');
    body.focus();
    assert.ok(body.classList.contains('search-open'), 'still hidden with focus off the box');
    main.fire('pointerdown', { target: main });
    assert.ok(!header.classList.contains('search-open'), 'a tap outside closes the bar');
    assert.equal(input.value, 'xyz');
    // "/" on a phone opens the bar first.
    press('/', {}, body);
    assert.ok(header.classList.contains('search-open'));
    assert.equal(document.activeElement, input);
    closeBtn.fire('click');
    input.value = '';
  } finally {
    mq.matches = false;
  }
});

test('12. desktop: Escape closes the list, then clears; it never closes anything else', async () => {
  await boot();
  input.focus();
  await type('mat');
  press('Escape', {}, input);
  assert.equal(panel.hidden, true);
  press('Escape', {}, input);
  assert.equal(input.value, '');
  press('Escape', {}, input);
  assert.equal(document.activeElement, input, 'focus stays');
  assert.ok(!header.classList.contains('search-open'));
  input.blur();
});

test('13. every old link opens its route through app.js, rewritten in place (no extra Back entry)', async () => {
  await boot();
  const cases = [
    // [old hash, rewritten hash, page title]
    ['#tab=teams', '#tab=schools', 'Schools'],
    ['#tab=teams&view=list', '#tab=schools&view=list', 'Schools'],
    ['#tab=teams&st=TX', '#tab=schools&st=TX', 'Texas schools'],
    ['#tab=teams&q=ake', '#tab=schools&q=ake', 'Schools'],
    [`#tab=team&school=${LOS_GATOS}`, `#tab=school&school=${LOS_GATOS}`, 'Los Gatos'],
    [`#tab=team&view=history&season=2023-24&g=g&school=${LOS_GATOS}`, `#tab=school&view=history&season=2023-24&g=g&school=${LOS_GATOS}`, 'Los Gatos'],
    ['#tab=team', '#tab=schools&view=list', 'Schools'],
    ['#tab=school', '#tab=schools&view=list', 'Schools'],
    [`#school=${LOS_GATOS}`, `#tab=school&school=${LOS_GATOS}`, 'Los Gatos'],
    ['#tab=states&st=TX', '#tab=schools&st=TX', 'Texas schools'],
    ['#tab=champions&st=PA', '#tab=events&view=champions&st=PA', 'Pennsylvania champions'],
    ['#tab=results&st=TX', '#tab=events&view=games&st=TX', 'Texas games'],
    ['#tab=playoffs&st=TX&season=2025-26&comp=tx-uil&div=5a-d1', '#tab=event&st=TX&season=2025-26&comp=tx-uil&div=5a-d1', 'State · Conference 5A D1'],
    ['#tab=playoffs&st=TX', '#tab=events&st=TX', 'Events'],
    ['#tab=schools&city=Austin', '#tab=schools', 'Schools'],   // a city needs its state (#31)
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
  for (const [h, heading] of [['#tab=schools', 'Schools'], [`#tab=school&school=${LOS_GATOS}`, 'Los Gatos'], ['#tab=schools&st=TX&city=Austin', 'Austin, TX schools']]) {
    await go('#tab=about');
    await go(h);
    assert.equal(location.hash, h, `${h} is canonical`);
    assert.equal(h1(), heading, h);
  }
});

test('14. requests: one search-index for a whole session of searching, and states and cities cost nothing', async () => {
  await boot();
  // Every search above ran in this one session. api.js keeps one copy (fetchJSON memo); count through the source.
  const box = await read('public/js/components/searchBox.js');
  assert.equal((box.match(/api\.searchIndex\(\)/g) || []).length, 1, 'one place loads it, once (loading ||=)');
  assert.match(box, /if \(idx\) return Promise\.resolve\(idx\);/);
  const src = await read('public/js/search.js');
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ''), /fetch\(|api\./, 'matching states and cities makes no request');
});
