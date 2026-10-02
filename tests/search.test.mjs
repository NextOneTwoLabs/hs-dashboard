// Header search (#13): matching, ranking, suggestions and keyboard steps on the real search index (offline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let requests = 0;
globalThis.fetch = () => { requests += 1; throw new Error('netguard: network access blocked in tests'); };

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');
const json = async (p) => JSON.parse(await read(p));
const s = await import('../public/js/search.js');
const searchIndex = await json('public/archive/search-index.json');
const statesIndex = await json('public/archive/states.json');
const schoolsDir = await json('public/archive/schools.json');
const idx = s.buildIndex(searchIndex, statesIndex);

const kinds = (r) => r.items.map((it) => it.kind);
const names = (r, kind = 'school') => r.items.filter((it) => it.kind === kind).map((it) => s.optionText(it).name);

test('ranking: exact > prefix > every word a prefix, with a fixed tie-break', () => {
  const mat = s.suggest(idx, 'mat');
  assert.deepEqual(names(mat), ['Mater Dei', 'Mater Dei Catholic', 'Mater Lakes Academy']);
  assert.deepEqual(kinds(mat), ['school', 'school', 'school', 'all'], '#30: schools only, no city (Mattawa, WA) option');
  const lake = s.suggest(idx, 'lake');
  assert.equal(lake.items.filter((it) => it.kind === 'school').length, s.SCHOOLS_MAX);
  assert.ok(names(lake).every((n) => n.startsWith('Lake ')), 'prefix matches come first');
  // Duplicates ("Lincoln" x3): a fixed order, and each accessible name carries its city and state.
  const lincoln = s.suggest(idx, 'lincoln').items.filter((it) => it.kind === 'school' && it.row.name === 'Lincoln');
  assert.deepEqual(lincoln.map((it) => `${it.row.city}, ${it.row.state}`), ['San Diego, CA', 'Stockton, CA', 'Lincoln, CA']);
  assert.equal(new Set(lincoln.map((it) => s.optionText(it).line)).size, 3);
  for (const it of lincoln) assert.match(s.optionText(it).line, new RegExp(`^${it.row.city}, ${it.row.state}`));
  assert.deepEqual(s.suggest(idx, 'lincoln').items.map((it) => it.row?.id), s.suggest(idx, 'Lincoln').items.map((it) => it.row?.id));
});

test('one normalisation rule: punctuation, accents, St/Saint and Mt/Mount', () => {
  const first = (q) => s.suggest(idx, q).items.find((it) => it.kind === 'school')?.row.name;
  for (const q of ['st pius', 'st. pius', 'saint pius', 'St Pius X']) assert.equal(first(q), 'St. Pius X Catholic', q);
  for (const q of ['pk yonge', 'p.k.', 'p.k. yonge', 'PK']) assert.equal(first(q), 'P.K. Yonge', q);
  for (const q of ['oconnor', "o'connor", "O’Connor"]) assert.equal(first(q), "O'Connor", q);
  assert.equal(first('a&m'), 'A&M Consolidated');
  assert.ok(!names(s.suggest(idx, 'a&m')).includes('Archbishop Mitty'), '"a&m" is one chunk, not an a-word and an m-word');
  for (const q of ['mt zion', 'mt. zion', 'mount zion']) assert.deepEqual(names(s.suggest(idx, q)), ['Mt. Zion', 'Mt. Zion'], q);
  const pete = s.suggest(idx, 'St. Petersburg');
  assert.deepEqual(names(pete), ['St. Petersburg', 'St. Petersburg Catholic']);
  assert.deepEqual(names(s.suggest(idx, 'saint petersburg')), ['St. Petersburg', 'St. Petersburg Catholic']);
  assert.equal(s.normalize('Écija'), 'ecija');
  assert.deepEqual(s.wordsOf("Washington-Wilkes O'Connor"), ['washington', 'wilkes', 'o', 'connor']);
  assert.deepEqual(s.chunksOf('P.K. Yonge'), ['pk', 'yonge']);
});

// #30, owner: "search in schools is to find schools". No state, association or city options: the search never
// leads anywhere but a school or the school list. A city's schools are the "All N schools matching" row.
test('schools only: no state, association or city option, and nothing outside Schools', () => {
  const ALLOWED = new Set(['school', 'all', 'chip']);
  for (const q of ['Texas', 'TX', 'tx', 'UIL', 'CIF', 'tex', 'san antonio', 'St Petersburg', 'mat', 'lake', 's', 'zzzz', '']) {
    const r = s.suggest(idx, q);
    for (const it of r.items) {
      assert.ok(ALLOWED.has(it.kind), `${q}: a ${it.kind} option`);
      const t = s.target(it);
      if (t.hash) assert.match(t.hash, /^#tab=(school&school=|schools&q=)/, `${q}: ${t.hash} stays in Schools`);
    }
    const e = s.enterTarget(r);
    if (e?.hash) assert.match(e.hash, /^#tab=(school&school=|schools&q=)/, `${q}: Enter stays in Schools`);
  }
  assert.equal(s.suggest(idx, 'Texas').mode, 'nomatch', 'no school is named Texas');
  const sa = s.suggest(idx, 'san antonio');
  assert.deepEqual(kinds(sa), ['all'], 'a city: its schools in the list');
  assert.equal(sa.items[0].n, 17);
  assert.deepEqual(s.enterTarget(sa), { hash: '#tab=schools&q=san%20antonio' });
  for (const kind of ['state', 'city']) assert.equal(s.target({ kind, state: { code: 'TX' }, city: { city: 'Austin' } }), null, kind);
});

test('short queries: at most 6 schools plus "All N"', () => {
  const r = s.suggest(idx, 's');
  assert.equal(r.items.filter((it) => it.kind === 'school').length, 6);
  assert.deepEqual(kinds(r).slice(6), ['all']);
  assert.ok(r.items.at(-1).n > 6);
});

test('chips and the no-match panel', () => {
  const help = s.suggest(idx, '');
  assert.equal(help.mode, 'help');
  assert.deepEqual(help.items.map((it) => it.text), s.CHIPS);
  assert.deepEqual(s.suggest(idx, '', { phone: true }).items.map((it) => it.text), s.PHONE_CHIPS);
  for (const chip of [...s.CHIPS, ...s.NOMATCH_CHIPS]) assert.equal(s.suggest(idx, chip).mode, 'list', `chip ${chip} finds something`);
  const none = s.suggest(idx, 'zzzz');
  assert.equal(none.mode, 'nomatch');
  assert.deepEqual(none.items.map((it) => it.text), s.NOMATCH_CHIPS);
  assert.equal(s.statusText(none, 'zzzz'), 'No school matches “zzzz”');
  assert.match(s.scopeText(idx, statesIndex), /^Every school with a state playoff appearance: 1,337 in 6 states \(CA, FL, GA, PA, TX, WA\)\.$/);
});

test('the Schools table keeps substring matching for q= (old links)', () => {
  const rows = (q) => schoolsDir.schools.filter((r) => s.tableMatch(r, q));
  assert.ok(rows('ake').some((r) => r.name.startsWith('Lake ')), 'q=ake still lists a "Lake ..." school');
  assert.equal(rows('ake').length, s.suggest(idx, 'ake').items.find((it) => it.kind === 'all').n);
  assert.ok(rows('Mattawa').some((r) => r.name === 'Wahluke'), 'q= matches the city too');
  assert.equal(rows('').length, schoolsDir.schools.length);
  assert.equal(rows('LAKE').length, rows('lake').length);
});

// #20, #26, #30: a school opens its school page; "All N" opens the school list under Schools.
test('targets: what choosing an option or Enter does on each view', () => {
  const mat = s.suggest(idx, 'mat');
  assert.deepEqual(s.target(mat.items[0]), { hash: '#tab=school&school=2b6b45d3-4465-4750-ba48-a273b674e37c', focusTitle: true });
  assert.deepEqual(s.target(mat.items.at(-1)), { hash: '#tab=schools&q=mat' });
  assert.deepEqual(s.target({ kind: 'chip', text: 'Lakeland' }), { fill: 'Lakeland' });
  assert.deepEqual(s.enterTarget(mat, { list: true }), { stay: true });
  assert.deepEqual(s.enterTarget(mat, { list: false }), s.target(mat.items[0]));
  assert.deepEqual(s.enterTarget(s.suggest(idx, 'san antonio')), { hash: '#tab=schools&q=san%20antonio' });
  assert.deepEqual(s.enterTarget(s.suggest(idx, 'ake')), { hash: '#tab=schools&q=ake' });
  assert.equal(s.enterTarget(s.suggest(idx, 'zzzz')), null);
  assert.equal(s.enterTarget(s.suggest(idx, '')), null);
  assert.match(s.statusText(s.suggest(idx, 'ake'), 'ake', { list: true }), /^59 schools match · Enter keeps the table$/);
});

test('keyboard steps (ARIA 1.2 combobox)', () => {
  const k = (st, key, mods = {}, n = 4) => s.keyStep(st, key, mods, n);
  assert.deepEqual(k({ open: false, active: -1 }, 'ArrowDown'), { open: true, active: 0 });
  assert.deepEqual(k({ open: true, active: 3 }, 'ArrowDown'), { open: true, active: 0 });       // wraps
  assert.deepEqual(k({ open: true, active: 0 }, 'ArrowUp'), { open: true, active: 3 });         // wraps
  assert.deepEqual(k({ open: false, active: -1 }, 'ArrowUp'), { open: true, active: -1 });      // opens, no move
  assert.deepEqual(k({ open: false, active: -1 }, 'ArrowDown', { alt: true }), { open: true, active: -1 });
  assert.deepEqual(k({ open: true, active: 2 }, 'ArrowUp', { alt: true }), { open: false, active: -1 });
  assert.deepEqual(k({ open: true, active: 2 }, 'Enter'), { open: false, active: -1, action: 'choose', index: 2 });
  assert.deepEqual(k({ open: true, active: -1 }, 'Enter'), { open: false, active: -1, action: 'enter' });
  assert.deepEqual(k({ open: true, active: 1 }, 'Escape'), { open: false, active: -1 });
  assert.deepEqual(k({ open: false, active: -1 }, 'Escape'), { open: false, active: -1, action: 'clear' });
  assert.deepEqual(k({ open: true, active: 1 }, 'Tab'), { open: false, active: -1 });
  assert.deepEqual(k({ open: false, active: -1 }, 'ArrowDown', {}, 0), { open: false, active: -1 });
});

test('the panel markup: combobox, listbox options with aria-selected, one status, hint by aria-describedby', async () => {
  const { panelHtml } = await import('../public/js/components/searchPanel.js');
  const r = s.suggest(idx, 'mat');
  const html = panelHtml(r, { active: 1, raw: 'mat', idx, statesIndex });
  assert.match(html, /role="listbox" id="search-list" aria-label="Suggestions"/);
  const opts = [...html.matchAll(/<div role="option" id="([^"]+)" class="qopt[^"]*" aria-selected="(true|false)"/g)];
  assert.equal(opts.length, r.items.length, 'every actionable row, "All N" included, is an option');
  assert.deepEqual(opts.map((m) => m[2]), r.items.map((_, i) => String(i === 1)));
  assert.match(html, /role="group" aria-label="Schools"/);
  assert.doesNotMatch(html, /aria-label="Places"/, '#30: no places group');
  assert.doesNotMatch(html, /<mark/, 'no highlighting (owner decision)');
  assert.match(html, /Mater Dei<\/span><span class="sr-only">, <\/span><span class="qopt-sub">Santa Ana, CA/);
  const help = panelHtml(s.suggest(idx, ''), { active: -1, raw: '', idx, statesIndex });
  assert.match(help, /role="group" aria-label="Examples"/);
  assert.equal((help.match(/role="option"/g) || []).length, s.CHIPS.length, 'chips are options');
  assert.ok(help.indexOf('qhelp') < help.indexOf('role="listbox"'), 'the help text is outside the listbox');

  const index = await read('public/index.html');
  assert.match(index, /id="search-input"[^>]*role="combobox"/);
  for (const attr of ['aria-autocomplete="list"', 'aria-controls="search-list"', 'aria-expanded="false"', 'aria-describedby="search-hint"', 'enterkeyhint="search"']) {
    assert.ok(new RegExp(`id="search-input"[^>]*${attr}`).test(index), attr);
  }
  assert.equal((index.match(/role="status"/g) || []).length, 1);
  const schools = await read('public/js/views/schools.js');
  assert.doesNotMatch(schools, /id="filter"|<input/, 'no second search box in the Schools sidebar');
  const box = await read('public/js/components/searchBox.js');
  assert.match(box, /mousedown/);
  assert.match(box, /preventDefault/);
  assert.match(await read('public/css/app.css'), /dvh/);
});

test('search makes no requests of its own', () => {
  s.suggest(idx, 'mat');
  s.suggest(idx, '');
  s.buildIndex(searchIndex, statesIndex);
  assert.equal(requests, 0);
});
