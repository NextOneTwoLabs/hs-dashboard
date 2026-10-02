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
const catalog = await json('public/archive/catalog.json');
const idx = s.buildIndex(searchIndex, statesIndex, catalog);

const EVENT_KINDS = new Set(['event', 'events']);
const kinds = (r) => r.items.map((it) => it.kind);
// The Schools group only (#31 PR 2: the Events group comes after it).
const schoolKinds = (r) => kinds(r).filter((k) => !EVENT_KINDS.has(k));
// The Events group: an event as "ST comp/div", a state's row as "all ST N".
const evs = (q) => s.suggest(idx, q).items.filter((it) => EVENT_KINDS.has(it.kind))
  .map((it) => (it.kind === 'event' ? `${it.state.code} ${it.comp.id}/${it.div.code}` : `all ${it.state.code} ${it.n}`));
// Name matches only (a state's "top" schools and a city's schools carry `why`).
const names = (r, kind = 'school') => r.items.filter((it) => it.kind === kind && !it.why).map((it) => s.optionText(it).name);

test('ranking: exact > prefix > every word a prefix, with a fixed tie-break', () => {
  const mat = s.suggest(idx, 'mat');
  assert.deepEqual(names(mat), ['Mater Dei', 'Mater Dei Catholic', 'Mater Lakes Academy']);
  assert.deepEqual(kinds(mat), ['school', 'school', 'school', 'school', 'city', 'all'], '#31: then Mattawa, WA (prefix "mat") and its school');
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

// #31 (owner: "the search box could accept the names and states and cities"; plan v2 + Kongming's notes): the
// Schools group's options are schools or lists of schools, and its targets are in Schools (#30: "search in
// schools is to find schools"). #31 PR 2: the Events group comes after it, and its targets are in Events.
test('the Schools group stays in Schools, the Events group in Events, and schools come first', async () => {
  const SCHOOLS = new Set(['school', 'state', 'city', 'all', 'chip']);
  const { hrefFor, resolveTab } = await import('../public/js/nav.js');
  const params = (hash) => Object.fromEntries(new URLSearchParams(hash.slice(1)));
  for (const q of ['Texas', 'TX', 'tx', 'UIL', 'CIF', 'tex', 'san antonio', 'St Petersburg', 'mat', 'lake', 's', 'zzzz', '',
    'Austin TX', 'Lincoln CA', 'Washington', 'ca', 'pa', 'CIF D1', '6A', 'Class A', 'D1', 'Georgia 6A']) {
    const r = s.suggest(idx, q);
    let inEvents = false;
    for (const it of r.items) {
      const t = s.target(it);
      if (EVENT_KINDS.has(it.kind)) {
        inEvents = true;
        assert.match(t.hash, it.kind === 'event' ? /^#tab=event&st=[A-Z]{2}&season=\d{4}-\d{2}&comp=[\w-]+&div=[\w-]+$/ : /^#tab=events&st=[A-Z]{2}$/, `${q}: ${t.hash} stays in Events`);
        assert.equal(hrefFor(resolveTab(params(t.hash))), t.hash, `${q}: ${t.hash} is canonical (no rewrite)`);
        continue;
      }
      assert.ok(SCHOOLS.has(it.kind), `${q}: a ${it.kind} option`);
      assert.ok(!inEvents, `${q}: schools come before events`);
      if (t.hash) assert.match(t.hash, /^#tab=(school&school=|schools&(st=[A-Z]{2}(&city=[^&]+)?$|(st=[A-Z]{2}&)?q=))/, `${q}: ${t.hash} stays in Schools`);
    }
    assert.ok(r.items.filter((it) => EVENT_KINDS.has(it.kind)).length <= s.EVENTS_MAX, `${q}: ${s.EVENTS_MAX} events at most`);
    assert.ok(r.items.filter((it) => it.kind === 'state').length <= 1, `${q}: one state row at most`);
    assert.ok(r.items.filter((it) => it.kind === 'school').length <= s.SCHOOLS_MAX, `${q}: ${s.SCHOOLS_MAX} schools at most`);
    assert.ok(r.items.filter((it) => it.kind === 'city').length <= s.CITIES_MAX, `${q}: ${s.CITIES_MAX} cities at most`);
  }
});

test('states: "Texas", "TX" and "tx" open the Texas list first, then its top 3 schools', () => {
  for (const q of ['Texas', 'texas', 'TX', 'tx']) {
    const r = s.suggest(idx, q);
    assert.deepEqual(schoolKinds(r), ['state', 'school', 'school', 'school'], q);
    assert.deepEqual(evs(q), q === 'tx' ? [] : ['all TX 6'], `${q}: the Events row only from the name or the code in capitals`);
    assert.equal(r.items[0].n, 384);
    assert.deepEqual(s.target(r.items[0]), { hash: '#tab=schools&st=TX' });
    assert.deepEqual(r.items.slice(1, 4).map((it) => [it.row.name, it.why]), [['Celina', 'top'], ['Kingwood', 'top'], ['Lake Creek', 'top']], q);
    assert.deepEqual(s.enterTarget(r), { hash: '#tab=schools&st=TX' }, `${q}: Enter opens the list`);
  }
  // Kongming: "California" is a state and a school; "Washington" a state, schools and a city (Washington, GA).
  assert.deepEqual(s.suggest(idx, 'California').items.map((it) => it.kind === 'school' ? it.row.name : it.kind), ['state', 'California', 'events']);
  const wa = s.suggest(idx, 'Washington');
  assert.equal(wa.items[0].kind, 'state');
  assert.equal(wa.items[0].state.code, 'WA');
  assert.deepEqual(names(wa), ['Washington', 'Washington Union', 'Washington-Wilkes']);
  assert.deepEqual(wa.items.filter((it) => it.kind === 'city').map((it) => [it.city, it.state, it.n]), [['Washington', 'GA', 1]]);
  // A lowercase code that starts names ("pa", "ca"): the names first, then the state row, so Enter opens the name.
  for (const [q, code] of [['pa', 'PA'], ['ca', 'CA']]) {
    const r = s.suggest(idx, q);
    assert.equal(r.items[0].kind, 'school', q);
    assert.equal(r.items.at(-1).kind, 'state', q);
    assert.equal(r.items.at(-1).state.code, code);
    assert.equal(s.enterTarget(r).focusTitle, true, `${q}: Enter opens the first school`);
  }
  assert.equal(s.suggest(idx, 'PA').items[0].kind, 'state', 'in capitals the code is the state');
});

test('cities: one row per city (exact count), the city\'s schools, and "All N" only when it adds something', () => {
  const lake = s.suggest(idx, 'Lakeland');
  assert.deepEqual(lake.items.map((it) => it.kind === 'school' ? it.row.name : `${it.kind}:${it.city || it.q}${it.state ? `,${it.state}` : ''}:${it.n}`),
    ['Lakeland Christian', 'city:Lakeland,FL:5', 'city:Lakeland,GA:1', 'all:Lakeland:6']);
  assert.deepEqual(s.target(lake.items[1]), { hash: '#tab=schools&st=FL&city=Lakeland' });
  const austin = s.suggest(idx, 'Austin');
  assert.deepEqual(names(austin), ['Austin', 'Fort Bend Austin', 'Liberal Arts & Science Academy - Austin']);
  assert.deepEqual(austin.items.filter((it) => it.why === 'city').map((it) => it.row.name), ['Anderson', 'Lake Travis', 'McCallum']);
  assert.deepEqual(austin.items.filter((it) => it.kind === 'city').map((it) => it.n), [9]);
  assert.equal(austin.items.at(-1).kind, 'all');
  assert.equal(austin.items.at(-1).n, 10);
  // A city alone: its list first, then its schools; no "All N" that repeats the city's count.
  const sa = s.suggest(idx, 'san antonio');
  assert.equal(sa.items[0].kind, 'city');
  assert.equal(sa.items[0].n, 17);
  assert.deepEqual(s.enterTarget(sa), { hash: '#tab=schools&st=TX&city=San%20Antonio' });
  assert.ok(!sa.items.some((it) => it.kind === 'all'));
  // Row counts equal the rows the list shows: the same comparison (search.js cityMatch) on schools.json.
  for (const q of ['Lakeland', 'Austin', 'san antonio', 'Washington', 'Lincoln CA', 'mat']) {
    for (const it of s.suggest(idx, q).items.filter((x) => x.kind === 'city')) {
      assert.equal(schoolsDir.schools.filter((r) => s.cityMatch(r, it.state, it.city)).length, it.n, `${q}: ${it.city}, ${it.state}`);
    }
  }
  for (const st of statesIndex.states.filter((x) => x.latestSeason)) {
    const row = s.suggest(idx, st.name).items[0];
    assert.equal(schoolsDir.schools.filter((r) => r.state === st.code).length, row.n, `${st.name}: the state row's count is the list's`);
  }
});

test('a trailing state narrows the rest, and adds to (never hides) full-name matches', () => {
  const atx = s.suggest(idx, 'Austin TX');
  assert.deepEqual(atx.items.filter((it) => it.kind === 'city').map((it) => [it.city, it.state]), [['Austin', 'TX']]);
  assert.deepEqual(s.target(atx.items.at(-1)), { hash: '#tab=schools&st=TX&q=Austin' });
  const lin = s.suggest(idx, 'Lincoln CA');
  assert.deepEqual(lin.items.filter((it) => it.kind === 'school' && !it.why).map((it) => `${it.row.name}, ${it.row.city}`),
    ['Lincoln, San Diego', 'Lincoln, Stockton', 'Lincoln, Lincoln']);
  assert.deepEqual(lin.items.filter((it) => it.kind === 'city').map((it) => [it.city, it.n]), [['Lincoln', 2]]);
  // Synthetic: a school whose name holds a state word but sits in another state is still found by its full name.
  const synthetic = s.buildIndex({ fields: ['id', 'name', 'city', 'state', 'apps', 'titles'],
    rows: [['x-1', 'South Florida Prep', 'Atlanta', 'GA', 1, 0], ['x-2', 'South Fork', 'Stuart', 'FL', 1, 0]] }, statesIndex);
  const sf = s.suggest(synthetic, 'south florida');
  assert.deepEqual(sf.items.filter((it) => it.kind === 'school').map((it) => it.row.name), ['South Florida Prep', 'South Fork']);
});

// #31 PR 2 (plan v4 "Events", v4.1 B2): an event is a division in its state's newest school year; noise queries
// give no Events group.
test('events: specific words only, state codes in capitals, Georgia\'s classes, at most 4 rows', async () => {
  // B2: every word under 2 characters, words every event shares, lowercase codes and school names: no Events group.
  for (const q of ['s', 'a', 'd', 'st', 'st pius', 'class', 'state', 'states', 'division', 'championship', 'regional', 'conference',
    'ca', 'pa', 'wa', 'fl', 'ga', 'tx', 'mater', 'Mater Dei', 'tex', 'Austin TX', 'zzzz']) {
    assert.deepEqual(evs(q), [], q);
  }
  // The specific ones.
  assert.deepEqual(evs('Class 7A'), ['FL fl-fhsaa/7a']);
  assert.deepEqual(evs('Division 1'), ['CA ca-cif-state/gd1', 'GA ga-ghsa/a-division-i'], 'TX "6A D1" matches only through d1');
  for (const q of ['GHSA Division I', 'Georgia D1', 'georgia division 1']) assert.deepEqual(evs(q), ['GA ga-ghsa/a-division-i'], q);
  assert.deepEqual(evs('GHSA Division II'), ['GA ga-ghsa/a-division-ii']);
  assert.deepEqual(evs('Georgia 6A'), ['GA ga-ghsa/aaaaaa'], 'Class AAAAAA is 6A');
  assert.deepEqual(evs('Georgia 2A'), ['GA ga-ghsa/aa']);
  assert.deepEqual(evs('Class A'), ['GA ga-ghsa/a-division-i', 'GA ga-ghsa/a-division-ii'], 'one letter: a whole division word, beside another word');
  assert.deepEqual(evs('GHSA private'), ['GA ga-ghsa/private']);
  assert.deepEqual(evs('CIF D1'), ['CA ca-cif-state/gd1']);
  assert.deepEqual(evs('Texas 6A'), ['TX tx-uil/6a-d1', 'TX tx-uil/6a-d2']);
  assert.deepEqual(evs('6A'), ['FL fl-fhsaa/6a', 'GA ga-ghsa/aaaaaa', 'TX tx-uil/6a-d1', 'TX tx-uil/6a-d2']);
  assert.deepEqual(evs('WA 1B'), ['WA wa-wiaa/1b-2b']);
  assert.equal(evs('D1').length, s.EVENTS_MAX, 'D1 matches 5 events: 4 are shown');
  assert.deepEqual(evs('aaa')[0], 'GA ga-ghsa/aaa', 'an exact word before a longer one');
  // A state or an association alone: that school year's "All N events" row, from the name in any case or the code
  // in capitals.
  for (const q of ['Texas', 'texas', 'TX', 'UIL', 'uil', 'Texas UIL']) assert.deepEqual(evs(q), ['all TX 6'], q);
  assert.deepEqual(evs('CIF'), ['all CA 5']);
  assert.deepEqual(evs('CIF State'), ['all CA 5'], 'a generic word beside a specific one');
  assert.deepEqual(evs('Washington'), ['all WA 5']);
  assert.deepEqual(evs('PA'), ['all PA 4']);
  const row = (q) => s.suggest(idx, q).items.find((it) => it.kind === 'events');
  assert.equal(s.optionText(row('Texas')).name, 'All 6 events in Texas, 2025-26 →');
  assert.equal(s.optionText(row('UIL')).name, 'All 6 UIL events in Texas, 2025-26 →');
  assert.deepEqual(s.target(row('Texas')), { hash: '#tab=events&st=TX', focusTitle: true });
  // Counts: a row's N is the cards the Events page shows for that state and year.
  const { eventsOf } = await import('../public/js/views/events.js');
  for (const st of statesIndex.states.filter((x) => x.latestSeason)) {
    const r = row(st.name);
    const page = eventsOf(catalog, statesIndex, st.latestSeason).find((g) => g.state.code === st.code);
    assert.equal(r.n, page.events.length, `${st.name}: the row's count is the page's`);
    assert.equal(r.season, st.latestSeason);
  }
  // An event's option: the labels shown don't change; it opens the bracket.
  const cif = s.suggest(idx, 'CIF D1');
  assert.deepEqual(s.optionText(cif.items[0]), { name: 'State · Division 1', line: 'CIF State Championships · California · 2025-26' });
  assert.deepEqual(s.enterTarget(cif), { hash: '#tab=event&st=CA&season=2025-26&comp=ca-cif-state&div=gd1', focusTitle: true });
  assert.deepEqual(s.enterTarget(cif, { list: true }), s.enterTarget(cif), 'on the school list too: no school matches, so the event opens');
  // Kongming (#35): on the school list, when the first option is a school or "All N matching", Enter stays on the
  // table, even with an Events group below it; an event never opens from there.
  for (const [q, first] of [['Class A', 'school'], ['CIF', 'all'], ['UIL', 'all'], ['mat', 'school']]) {
    const r = s.suggest(idx, q);
    assert.equal(r.items[0].kind, first, `${q}: the first option is a ${first}`);
    if (q !== 'mat') assert.ok(r.items.some((it) => EVENT_KINDS.has(it.kind)), `${q}: with an Events group below`);
    assert.deepEqual(s.enterTarget(r, { list: true }), { stay: true }, `${q}: Enter on the list keeps the table`);
    assert.notEqual(s.enterTarget(r).hash?.startsWith('#tab=event'), true, `${q}: off the list, Enter opens the first option, not an event`);
  }
  assert.equal(s.statusText(cif, 'CIF D1'), '1 event · Enter opens State · Division 1');
  assert.match(s.statusText(s.suggest(idx, 'UIL'), 'UIL'), /, 6 events · /, 'a state\'s row counts its events');
  // Without the catalog, schools still work and there is no Events group.
  const bare = s.buildIndex(searchIndex, statesIndex);
  assert.deepEqual(s.suggest(bare, 'Texas').items.filter((it) => EVENT_KINDS.has(it.kind)), []);
  assert.equal(s.suggest(bare, 'CIF D1').mode, 'nomatch');
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
  assert.equal(s.statusText(none, 'zzzz'), 'No school or event matches “zzzz”');
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
  assert.deepEqual(s.enterTarget(s.suggest(idx, 'san antonio')), { hash: '#tab=schools&st=TX&city=San%20Antonio' });
  assert.deepEqual(s.enterTarget(s.suggest(idx, 'ake')), { hash: '#tab=schools&q=ake' });
  // On the list, Enter keeps the table, unless the first option is a state's or a city's list.
  assert.deepEqual(s.enterTarget(s.suggest(idx, 'Texas'), { list: true }), { hash: '#tab=schools&st=TX' });
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
  // #31 v4.1 (Kongming B1), the phone bar: Escape closes the list, then clears the text, then closes the bar.
  assert.deepEqual(k({ open: true, active: 1 }, 'Escape', { bar: true, empty: false }), { open: false, active: -1 }, '1. the list');
  assert.deepEqual(k({ open: false, active: -1 }, 'Escape', { bar: true, empty: false }), { open: false, active: -1, action: 'clear' }, '2. the text');
  assert.deepEqual(k({ open: false, active: -1 }, 'Escape', { bar: true, empty: true }), { open: false, active: -1, action: 'closeBar' }, '3. the bar');
  assert.deepEqual(k({ open: true, active: -1 }, 'Escape', { bar: true, empty: true }), { open: false, active: -1 }, 'the list first, even when empty');
  assert.deepEqual(k({ open: false, active: -1 }, 'Escape', { bar: false, empty: true }), { open: false, active: -1, action: 'clear' }, 'desktop: never the bar');
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
  // #31 PR 2: one Events group after the schools, for an event and a state's "All N events" alike.
  const both = panelHtml(s.suggest(idx, 'Texas'), { raw: 'Texas', idx, statesIndex });
  assert.equal((both.match(/role="group" aria-label="Events"/g) || []).length, 1);
  assert.ok(both.indexOf('aria-label="Schools"') < both.indexOf('aria-label="Events"'));
  assert.match(panelHtml(s.suggest(idx, '6A'), { raw: '6A', idx, statesIndex }), /role="group" aria-label="Events"><div class="qgroup-label" aria-hidden="true">Events<\/div>/);
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
  s.suggest(idx, 'CIF D1');
  s.buildIndex(searchIndex, statesIndex, catalog);
  assert.equal(requests, 0);
});
