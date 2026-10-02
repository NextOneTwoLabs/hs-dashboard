// The site search (#13; in the header again since #31): matching, ranking and suggestions, as pure functions
// (no DOM, no fetch). Modelled on collegedash's header search: word-prefix matching ranked exact > prefix > every
// word a prefix > initials, and example chips. It accepts a school's name, a state or a city (owner, #31: "the
// search box could accept the names and states and cities"), then events (#31 PR 2: one box for schools and
// events, schools listed first). Data: the rows of /api/v1/search-index (id, name, city, state, apps, titles),
// states.json and /api/v1/catalog.

// One normalisation rule for names, cities and queries: NFKD, strip diacritics, lowercase, split on
// any non-alphanumeric character. Each whitespace-separated chunk with its punctuation removed is
// kept too, so "pk" finds "P.K. Yonge", "oconnor" finds "O'Connor" and "am" finds "A&M".
export function normalize(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
export const wordsOf = (s) => normalize(s).split(/[^a-z0-9]+/).filter(Boolean);
export const chunksOf = (s) => normalize(s).split(/\s+/).map((c) => c.replace(/[^a-z0-9]+/g, '')).filter(Boolean);
// The same chunks with their punctuation kept ("a&m", "p.k.", "o'connor"), for punctuation-exact matches.
export const rawChunksOf = (s) => normalize(s).split(/\s+/).map((c) => c.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')).filter(Boolean);

// St/Saint and Mt/Mount are the same word (owner decision on #13), as **whole words only** (#15 item 1): a name
// word matches a query token when it starts with the token, or when the token is a whole alias word and the name
// word is its alias. So "st pius" and "saint pius" both find "St. Pius X", but "mt" doesn't prefix "Mountain"
// and "mo" doesn't find "Mt. Carmel".
const ALIAS = { st: 'saint', saint: 'st', mt: 'mount', mount: 'mt' };
const wordMatches = (word, tok) => word.startsWith(tok) || (ALIAS[tok] ? word === ALIAS[tok] : false);

// Every query token must start a different word, in any order.
function tokensPrefix(toks, words) {
  const used = new Set();
  return toks.every((t) => {
    const i = words.findIndex((w, k) => !used.has(k) && wordMatches(w, t));
    if (i < 0) return false;
    used.add(i);
    return true;
  });
}
const canon = (words) => words.map((w) => (w === 'st' ? 'saint' : w === 'mt' ? 'mount' : w)).join(' ');

export function prepare(text) {
  const words = wordsOf(text);
  return { words, chunks: chunksOf(text), raw: rawChunksOf(text), joinedWords: words.join(' '), canon: canon(words),
    initials: words.map((w) => w[0]).join('') };
}

export function parseQuery(raw) {
  const words = wordsOf(raw);
  const rawChunks = rawChunksOf(raw);
  return { raw: String(raw ?? ''), typed: String(raw ?? '').trim(), words, chunks: chunksOf(raw), canon: canon(words),
    joined: words.join(''), joinedWords: words.join(' '), punct: rawChunks.filter((c) => /[^a-z0-9]/.test(c)) };
}

// Score of one name (or city) for a query, or 0. Exact 100 > whole-name prefix 90 > punctuation-exact 85 >
// every word a prefix 80 > a punctuated query's loose chunk prefix 60 > initials 55 (3+ letters).
export function matchScore(p, q) {
  if (!q.words.length) return 0;
  if (p.canon === q.canon) return 100;
  // Whole-name prefix as typed, or with St/Mt aliases on whole words only ("mt" is not a prefix of "Mountain").
  if (p.joinedWords.startsWith(q.joinedWords) || p.canon.startsWith(`${q.canon} `)) return 90;
  // A query whose punctuation joins letters ("a&m", "p.k.", "o'connor") is matched by its joined chunks only,
  // so "a&m" finds A&M Consolidated but not "Archbishop Mitty" (an a-word and an m-word). A name with the same
  // punctuated chunk ranks above names that only share its letters, "A&M" before "Amador" (#15 item 2).
  const joinedPunct = q.words.length !== q.chunks.length;
  if (!joinedPunct && tokensPrefix(q.words, p.words)) return 80;
  if (joinedPunct && tokensPrefix(q.chunks, p.chunks)) {
    return q.punct.every((c) => p.raw.some((pc) => pc.startsWith(c))) ? 85 : 60;
  }
  if (tokensPrefix(q.chunks, p.chunks)) return 80;
  if (q.words.length === 1 && q.joined.length >= 3 && p.initials === q.joined) return 55;
  return 0;
}

// The Schools table keeps today's meaning of q= (#13 build item 1): a substring of the name or the city,
// case-insensitive, so q=ake still lists "Lake ..." schools (old and new Schools links open this list).
export function tableMatch(row, q) {
  const needle = String(q ?? '').trim().toLowerCase();
  if (!needle) return true;
  return row.name.toLowerCase().includes(needle) || (row.city || '').toLowerCase().includes(needle);
}

// A city as the search and the school list compare it (#31, Kongming: one comparison, so a city row's count is the
// number of rows its list shows): NFKD, case and punctuation folded, St/Mt aliases, within a state.
export const cityKey = (city) => prepare(city || '').canon;
export const cityMatch = (row, st, city) => row.state === st && cityKey(row.city) === cityKey(city);

// ----- Events (#31 PR 2; plan v4 and v4.1 B2) -----
// An event is a division in its state's newest school year with brackets (states.json latestSeason). Its words are
// tagged: `id` (the state's name, the association, the championship's own words), `code` (the two-letter state
// code, matched only as typed in capitals), `div` (the division's own words, plus the forms people type: "Division
// 1" also "d1", Georgia's "Division I/II" also "1"/"d1" and "2"/"d2", "Class AAAAAA"…"AA" also "6a"…"2a"), and
// `generic` (words every event shares, which never match on their own).
export const GENERIC = new Set(['state', 'states', 'championship', 'championships', 'class', 'conference', 'division', 'regional']);
const ROMAN = { i: '1', ii: '2', iii: '3', iv: '4', v: '5' };
export const EVENTS_MAX = 4;

function divWords(label) {
  const words = wordsOf(label);
  const out = [];
  words.forEach((w, i) => {
    if (GENERIC.has(w)) { out.push({ w, kind: 'generic' }); return; }
    out.push({ w, kind: 'div' });
    const n = ROMAN[w] || (/^\d+$/.test(w) ? w : null);
    if (n && words[i - 1] === 'division') {
      if (ROMAN[w]) out.push({ w: n, kind: 'div' });
      out.push({ w: `d${n}`, kind: 'div' });
    }
    if (/^a{2,6}$/.test(w)) out.push({ w: `${w.length}a`, kind: 'div' });
  });
  return out;
}

function idWords(texts) {
  const seen = new Set();
  const out = [];
  for (const w of texts.flatMap((t) => wordsOf(t))) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push({ w, kind: GENERIC.has(w) ? 'generic' : 'id' });
  }
  return out;
}

// -> { events: [{ state, season, comp, div, order, words }], states: [{ state, season, n }], latest }
export function buildEvents(catalog, statesIndex) {
  const events = [];
  const states = [];
  if (!catalog?.seasons || !statesIndex?.states) return { events, states, latest: null };
  for (const st of statesIndex.states.filter((x) => x.latestSeason)) {
    const year = catalog.seasons.find((x) => x.season === st.latestSeason);
    const mine = [];
    for (const comp of (year?.competitions || []).filter((c) => c.state === st.code)) {
      comp.divisions.forEach((div, order) => {
        const words = [{ w: st.code, kind: 'code' }, ...idWords([st.name, st.association, comp.label, comp.short]), ...divWords(div.label)];
        mine.push({ state: st, season: year.season, comp, div, order, words });
      });
    }
    if (mine.length) states.push({ state: st, season: year.season, n: mine.length });
    events.push(...mine);
  }
  return { events, states, latest: catalog.latestSeason };
}

// How one typed word matches one event word: 2 exact, 1 prefix, 0 not. A state code only as typed in capitals; a
// one-character word only as a whole division word beside another word ("Class A", "Division 1"); the state's name,
// the association and the championship by prefix from 3 letters, so "ca", "pa" and "ga" match no event.
function wordScore(tok, word, many) {
  if (word.kind === 'code') return tok.orig === word.w ? 2 : 0;
  if (tok.lc.length === 1) return many && word.kind === 'div' && tok.lc === word.w ? 2 : 0;
  if (tok.lc === word.w) return 2;
  if (!word.w.startsWith(tok.lc)) return 0;
  return word.kind === 'id' && tok.lc.length < 3 ? 0 : 1;
}

// Every typed word must match a different word of the event, exact matches first. -> null, or
// { score, kinds: the kinds matched, whole: every id/code match exact }.
function eventMatch(ev, toks) {
  const used = new Set();
  let score = 0;
  let whole = true;
  const kinds = new Set();
  for (const tok of toks) {
    let best = -1;
    let bestScore = 0;
    ev.words.forEach((word, k) => {
      if (used.has(k)) return;
      const sc = wordScore(tok, word, toks.length > 1);
      if (sc > bestScore) { best = k; bestScore = sc; }
    });
    if (best < 0) return null;
    used.add(best);
    score += bestScore;
    const kind = ev.words[best].kind;
    kinds.add(kind);
    if ((kind === 'id' || kind === 'code') && bestScore < 2) whole = false;
  }
  return { score, kinds, whole };
}

// The Events group's options: a division typed gives up to 4 events; a query that only names a state or an
// association (in full, or the code in capitals) gives that state's "All N events" row instead. Nothing for
// queries whose words are all under 2 characters, or that match only words every event shares.
export function eventItems(ev, raw) {
  if (!ev?.events.length) return [];
  const toks = String(raw ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((orig) => ({ orig, lc: orig.toLowerCase() }));
  if (!toks.length || toks.every((t) => t.lc.length < 2)) return [];
  const hits = [];
  for (const e of ev.events) {
    const m = eventMatch(e, toks);
    if (m && (m.kinds.has('id') || m.kinds.has('code') || m.kinds.has('div'))) hits.push({ e, m });
  }
  if (!hits.length) return [];
  if (!hits.some((h) => h.m.kinds.has('div'))) {
    // Only a state or an association: its whole school year, when named in full.
    const assoc = (st) => toks.some((t) => wordsOf(st.association).includes(t.lc));
    const codes = [...new Set(hits.filter((h) => h.m.whole).map((h) => h.e.state.code))];
    return ev.states.filter((s) => codes.includes(s.state.code)).slice(0, EVENTS_MAX)
      .map((s) => ({ kind: 'events', state: s.state, season: s.season, n: s.n, assoc: assoc(s.state), latest: ev.latest }));
  }
  const order = ev.states.map((s) => s.state.code);
  return hits.filter((h) => h.m.kinds.has('div'))
    .sort((a, b) => b.m.score - a.m.score || order.indexOf(a.e.state.code) - order.indexOf(b.e.state.code)
      || a.e.comp.id.localeCompare(b.e.comp.id) || a.e.order - b.e.order)
    .slice(0, EVENTS_MAX)
    .map(({ e }) => ({ kind: 'event', state: e.state, season: e.season, comp: e.comp, div: e.div }));
}

export function buildIndex(searchIndex, statesIndex, catalog = null) {
  const rows = searchIndex.rows.map((r) => Object.fromEntries(searchIndex.fields.map((f, i) => [f, r[i]])));
  for (const r of rows) {
    r._name = prepare(r.name);
    r._city = prepare(r.city || '');
  }
  // Cities: one per city name within a state, with its schools.
  const cities = new Map();
  for (const r of rows) {
    if (!r.city) continue;
    const key = `${r._city.canon}|${r.state}`;
    if (!cities.has(key)) cities.set(key, { city: r.city, state: r.state, _p: r._city, rows: [] });
    cities.get(key).rows.push(r);
  }
  const states = (statesIndex?.states || []).filter((s) => s.latestSeason)
    .map((s) => ({ code: s.code, name: s.name, canon: prepare(s.name).canon }));
  return { rows, cities: [...cities.values()], states, ev: buildEvents(catalog, statesIndex) };
}

// Fixed order for equal scores: appearances, then name, state and id, so duplicate names never reorder.
const byRank = (a, b) => b.score - a.score || b.row.apps - a.row.apps || a.row.name.localeCompare(b.row.name)
  || a.row.state.localeCompare(b.row.state) || a.row.id.localeCompare(b.row.id);
// A state's "top schools" and a city's schools: most titles, then appearances, then name.
const byTop = (a, b) => b.titles - a.titles || b.apps - a.apps || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

export const SCHOOLS_MAX = 6;
export const CITIES_MAX = 3;
export const STATE_TOP = 3;
// Example searches (#31: a school's name, a city, a state or an event).
export const CHIPS = ['Mater Dei', 'Los Gatos', 'Lakeland', 'Texas', 'Austin TX', 'CIF D1'];
export const PHONE_CHIPS = ['Mater Dei', 'Lakeland', 'Texas'];
export const NOMATCH_CHIPS = ['Mater Dei', 'Texas'];

// The whole query names a state: its full name in any case, or its two-letter code in any case. `upper` tells a
// code typed in capitals ("TX") from one typed in lowercase ("tx"), which may be the start of a name ("pa…").
function wholeState(idx, q) {
  const byName = idx.states.find((s) => s.canon === q.canon);
  if (byName) return { state: byName, lower: false };
  if (q.typed.length !== 2) return null;
  const byCode = idx.states.find((s) => s.code === q.typed.toUpperCase());
  return byCode ? { state: byCode, lower: q.typed !== byCode.code } : null;
}

// A trailing state narrows the rest of the query ("Austin TX", "Lincoln California"): its code in any case, or its
// full name. The rest must not be empty.
function trailingState(idx, raw) {
  const words = String(raw).trim().split(/\s+/);
  for (const n of [2, 1]) {
    if (words.length <= n) continue;
    const tail = words.slice(-n).join(' ');
    const state = idx.states.find((s) => s.code === tail.toUpperCase() || s.canon === prepare(tail).canon);
    if (state) return { rest: words.slice(0, -n).join(' '), state };
  }
  return null;
}

// Cities whose name is the query (exact), or starts with it by word from 3 letters; within one state when given.
function cityHits(idx, q, st = null) {
  const long = q.joined.length >= 3;
  return idx.cities.filter((c) => !st || c.state === st)
    .map((c) => ({ c, score: c._p.canon === q.canon ? 100 : long ? matchScore(c._p, q) : 0 }))
    .filter((x) => x.score)
    .sort((a, b) => b.score - a.score || b.c.rows.length - a.c.rows.length || a.c.city.localeCompare(b.c.city) || a.c.state.localeCompare(b.c.state))
    .map((x) => x.c);
}

const nameHits = (idx, q, st = null) => idx.rows.filter((r) => !st || r.state === st)
  .map((row) => ({ row, score: matchScore(row._name, q) })).filter((h) => h.score).sort(byRank).map((h) => h.row);

// -> { mode: 'help'|'list'|'nomatch', items: [...], schools: n matched by name, table: n rows the Schools table shows }
// items (#31, every option a school or a list of schools):
//   { kind: 'chip', text } | { kind: 'state', state, n } | { kind: 'school', row, why? } | { kind: 'city', city, state, n }
//   | { kind: 'all', n, q, st? } | { kind: 'event', state, season, comp, div } | { kind: 'events', state, season, n, assoc }
// Order: the state row, schools (name matches, then a state's top schools or the one matching city's schools), city
// rows, "All N matching" when it adds something, then the Events group (eventItems). A lowercase two-letter code that is also the start of names
// ("pa", "ca") puts the names first and the state row after them, so Enter opens the "Pa…" school being typed.
export function suggest(idx, raw, { phone = false } = {}) {
  const q = parseQuery(raw);
  if (!q.words.length) return { mode: 'help', items: (phone ? PHONE_CHIPS : CHIPS).map((text) => ({ kind: 'chip', text })), schools: 0, table: 0 };
  const whole = wholeState(idx, q);
  const trail = whole ? null : trailingState(idx, raw);
  const rest = trail ? parseQuery(trail.rest) : q;
  const st = trail?.state.code || null;
  // Names: the full query everywhere, plus (a trailing state) the rest within that state. Narrowing adds; it never
  // hides a full-name match such as "South Florida HEAT" in another state (Kongming).
  const names = nameHits(idx, q);
  if (trail) for (const r of nameHits(idx, rest, st)) if (!names.includes(r)) names.push(r);
  const cities = cityHits(idx, rest, st).slice(0, CITIES_MAX);
  const items = [];
  const shown = new Set();
  const addSchool = (row, why) => {
    if (shown.has(row.id) || items.filter((i) => i.kind === 'school').length >= SCHOOLS_MAX) return;
    items.push(why ? { kind: 'school', row, why } : { kind: 'school', row });
    shown.add(row.id);
  };
  let stateRow = null;
  if (whole) {
    const n = idx.rows.filter((r) => r.state === whole.state.code).length;
    stateRow = { kind: 'state', state: whole.state, n };
    if (whole.lower && names.length) {
      for (const r of names) addSchool(r);
      items.push(stateRow);
    } else {
      items.push(stateRow);
      if (names.length) for (const r of names) addSchool(r);
      else for (const r of idx.rows.filter((x) => x.state === whole.state.code).sort(byTop).slice(0, STATE_TOP)) addSchool(r, 'top');
    }
  }
  const cityRows = cities.map((c) => ({ kind: 'city', city: c.city, state: c.state, n: c.rows.length }));
  if (!whole) {
    // A query that is only a city ("San Antonio") offers the city's list first; a name match comes first otherwise.
    if (!names.length) items.push(...cityRows);
    for (const r of names) addSchool(r);
    if (cities.length === 1) for (const r of [...cities[0].rows].sort(byTop)) addSchool(r, 'city');
    if (names.length) items.push(...cityRows);
  } else {
    items.push(...cityRows);
  }
  const table = idx.rows.filter((r) => (!st || r.state === st) && tableMatch(r, rest.typed)).length;
  if (!whole && table > shown.size && !cities.some((c) => c.rows.length === table)) {
    items.push(st ? { kind: 'all', n: table, q: rest.typed, st } : { kind: 'all', n: table, q: q.typed });
  }
  // Then the Events group (#31 PR 2): schools always come first.
  const events = eventItems(idx.ev, raw);
  items.push(...events);
  if (!items.length) return { mode: 'nomatch', items: NOMATCH_CHIPS.map((text) => ({ kind: 'chip', text })), schools: 0, table: 0, events: 0 };
  // `events`: how many events the group offers (an "All N events" row counts its N).
  return { mode: 'list', items, schools: names.length, table, events: events.reduce((t, it) => t + (it.kind === 'events' ? it.n : 1), 0) };
}

// Where choosing an item goes: a school's page, a state's or a city's school list, the school list with q, an
// event's bracket, a state's Events, or a chip's text to search for. The Schools group stays in Schools and the
// Events group in Events (#30, #31). The hashes are in nav.js hrefFor's key order, so they are never rewritten.
const enc = encodeURIComponent;
export function target(item) {
  switch (item.kind) {
    case 'school': return { hash: `#tab=school&school=${enc(item.row.id)}`, focusTitle: true };
    case 'event': return { hash: `#tab=event&st=${item.state.code}&season=${enc(item.season)}&comp=${enc(item.comp.id)}&div=${enc(item.div.code)}`, focusTitle: true };
    case 'events': return { hash: `#tab=events&st=${item.state.code}${item.season === item.latest ? '' : `&season=${enc(item.season)}`}`, focusTitle: true };
    case 'state': return { hash: `#tab=schools&st=${item.state.code}` };
    case 'city': return { hash: `#tab=schools&st=${item.state}&city=${encodeURIComponent(item.city)}` };
    case 'all': return { hash: `#tab=schools${item.st ? `&st=${item.st}` : ''}&q=${encodeURIComponent(item.q)}` };
    case 'chip': return { fill: item.text };
    default: return null;
  }
}

// Enter with no active option opens the first option. On the school list the filtered table stays when the first
// option is a school or "All N" (the table is what you're filtering), and otherwise opens it (a state's or a city's
// list, or an event when no school matches). `list`: the school list (nav.js pageOf 'schools') is the page now open.
const LISTS = new Set(['state', 'city', 'event', 'events']);
export function enterTarget(result, { list = false } = {}) {
  if (result.mode !== 'list') return null;
  const first = result.items.find((it) => it.kind !== 'chip');
  if (!first) return null;
  if (list && !LISTS.has(first.kind)) return { stay: true };
  return target(first);
}

// Keyboard state for the combobox (ARIA 1.2 editable combobox with list autocomplete).
// state: { open, active }; n: number of options. Returns the next state and an action, if any:
// 'choose' (the active option), 'enter' (no active option), 'clear' (Esc on a closed list), 'closeBar' (Esc on a
// closed list with an empty box, while the phone search bar is open: #31 v4.1, Kongming B1).
export function keyStep({ open, active }, key, { alt = false, bar = false, empty = false } = {}, n = 0) {
  if (key === 'Escape' && !open && bar && empty) return { open: false, active: -1, action: 'closeBar' };
  switch (key) {
    case 'ArrowDown':
      if (!n) return { open, active };
      if (alt) return { open: true, active: open ? active : -1 };
      return { open: true, active: open ? (active + 1) % n : 0 };
    case 'ArrowUp':
      if (alt) return { open: false, active: -1 };
      if (!n) return { open, active };
      if (!open) return { open: true, active: -1 };
      return { open: true, active: active <= 0 ? n - 1 : active - 1 };
    case 'Enter':
      return open && active >= 0 ? { open: false, active: -1, action: 'choose', index: active } : { open: false, active: -1, action: 'enter' };
    case 'Escape':
      return open ? { open: false, active: -1 } : { open: false, active: -1, action: 'clear' };
    case 'Tab':
      return { open: false, active: -1 };
    default:
      return { open, active };
  }
}

// Visible text and accessible name of an option. The name starts with the visible name and includes the
// line, so duplicate names ("Lincoln" x3) read differently to a screen reader.
export function optionText(item) {
  switch (item.kind) {
    case 'school': {
      const r = item.row;
      const line = [`${r.city ? `${r.city}, ` : ''}${r.state}`, `${r.apps} appearance${r.apps === 1 ? '' : 's'}`,
        r.titles ? `${r.titles} title${r.titles === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
      const why = item.why === 'top' ? 'a top school in the state' : '';
      return { name: r.name, line: why ? `${line} · ${why}` : line };
    }
    case 'state': return { name: `All ${item.n.toLocaleString('en-US')} schools in ${item.state.name} →`, line: 'Opens the school list for the state' };
    case 'city': return { name: `${item.n === 1 ? 'The 1 school' : `All ${item.n.toLocaleString('en-US')} schools`} in ${item.city}, ${item.state} →`, line: 'Opens the school list for the city' };
    case 'all': return { name: `All ${item.n.toLocaleString('en-US')} school${item.n === 1 ? '' : 's'} matching “${item.q}”${item.st ? ` in ${item.st}` : ''} →`, line: 'Opens Schools' };
    case 'event': return { name: `${item.comp.short} · ${item.div.label}`, line: `${item.comp.label} · ${item.state.name} · ${item.season}` };
    case 'events': return { name: `All ${item.n} ${item.assoc ? `${item.state.association} ` : ''}event${item.n === 1 ? '' : 's'} in ${item.state.name}, ${item.season} →`, line: 'Opens Events for the state' };
    case 'chip': return { name: item.text, line: '' };
    default: return { name: '', line: '' };
  }
}

// The status line read after a pause in typing.
const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
export function statusText(result, raw, { list = false } = {}) {
  if (result.mode === 'help') return '';
  if (result.mode === 'nomatch') return `No school or event matches “${String(raw).trim()}”`;
  const first = result.items.find((it) => it.kind !== 'chip');
  const events = result.events ? `, ${plural(result.events, 'event')}` : '';
  if (first && (first.kind === 'state' || first.kind === 'city' || first.kind === 'events')) {
    return `${optionText(first).name.replace(/ →$/, '')} · Enter opens the list`;
  }
  if (first?.kind === 'event') return `${plural(result.events, 'event')} · Enter opens ${optionText(first).name}`;
  if (list && result.mode === 'list') return `${plural(result.table, 'school')} match${result.table === 1 ? 'es' : ''}${events} · Enter keeps the table`;
  const opens = !first ? '' : first.kind === 'all' ? ` · Enter shows them in Schools` : ` · Enter opens ${optionText(first).name}`;
  return `${plural(result.schools || result.table, 'school')}${events}${opens}`;
}

export function scopeText(idx, statesIndex, { phone = false } = {}) {
  const covered = statesIndex.states.filter((s) => s.latestSeason);
  const n = (idx ? idx.rows.length : covered.reduce((t, s) => t + s.schools, 0)).toLocaleString('en-US');
  if (phone) return `${n} schools in ${covered.length} states. Try:`;
  return `Every school with a state playoff appearance: ${n} in ${covered.length} states (${covered.map((s) => s.code).join(', ')}).`;
}
export const HINT = "Type a school's name, a city, a state or an event.";
