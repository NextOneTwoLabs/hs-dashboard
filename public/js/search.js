// Header search (#13): matching, ranking and suggestions, as pure functions (no DOM, no fetch).
// Modelled on collegedash's header search: word-prefix matching ranked exact > prefix > every word
// a prefix > initials, a "place" line for whole state names, codes and cities, and example chips.
// Data: the rows of /api/v1/search-index (id, name, city, state, apps, titles) and states.json.

// One normalisation rule for names, cities and queries: NFKD, strip diacritics, lowercase, split on
// any non-alphanumeric character. Each whitespace-separated chunk with its punctuation removed is
// kept too, so "pk" finds "P.K. Yonge", "oconnor" finds "O'Connor" and "am" finds "A&M".
export function normalize(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
export const wordsOf = (s) => normalize(s).split(/[^a-z0-9]+/).filter(Boolean);
export const chunksOf = (s) => normalize(s).split(/\s+/).map((c) => c.replace(/[^a-z0-9]+/g, '')).filter(Boolean);

// St/Saint and Mt/Mount are the same word (owner decision on #13). A name word matches a query token
// when it, or its alias, starts with the token: "st pius" and "saint pius" both find "St. Pius X".
const ALIAS = { st: 'saint', saint: 'st', mt: 'mount', mount: 'mt' };
const wordMatches = (word, tok) => word.startsWith(tok) || (ALIAS[word] ? ALIAS[word].startsWith(tok) : false);

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
  return { words, chunks: chunksOf(text), canon: canon(words), initials: words.map((w) => w[0]).join('') };
}

export function parseQuery(raw) {
  const words = wordsOf(raw);
  return { raw: String(raw ?? ''), typed: String(raw ?? '').trim(), words, chunks: chunksOf(raw), canon: canon(words),
    joined: words.join('') };
}

// Score of one name (or city) for a query, or 0. Exact 100 > whole-name prefix 90 > every word a prefix 80 >
// initials 55 (3+ letters), as in collegedash.
export function matchScore(p, q) {
  if (!q.words.length) return 0;
  if (p.canon === q.canon) return 100;
  if (p.canon.startsWith(q.canon)) return 90;
  // A query whose punctuation joins letters ("a&m", "p.k.", "o'connor") is matched by its joined chunks only,
  // so "a&m" finds A&M Consolidated but not "Archbishop Mitty" (an a-word and an m-word).
  const joinedPunct = q.words.length !== q.chunks.length;
  if (!joinedPunct && tokensPrefix(q.words, p.words)) return 80;
  if (tokensPrefix(q.chunks, p.chunks)) return 80;
  if (q.words.length === 1 && q.joined.length >= 3 && p.initials === q.joined) return 55;
  return 0;
}

// The Schools table keeps today's meaning of q= (#13 build item 1): a substring of the name or the city,
// case-insensitive, so q=ake still lists "Lake ..." schools (old Schools links open this list under Teams, #20).
export function tableMatch(row, q) {
  const needle = String(q ?? '').trim().toLowerCase();
  if (!needle) return true;
  return row.name.toLowerCase().includes(needle) || (row.city || '').toLowerCase().includes(needle);
}

export function buildIndex(searchIndex, statesIndex) {
  const rows = searchIndex.rows.map((r) => Object.fromEntries(searchIndex.fields.map((f, i) => [f, r[i]])));
  for (const r of rows) {
    r._name = prepare(r.name);
    r._city = prepare(r.city || '');
  }
  const cities = new Map();
  for (const r of rows) {
    if (!r.city) continue;
    const key = `${r._city.canon}|${r.state}`;
    if (!cities.has(key)) cities.set(key, { city: r.city, state: r.state, n: 0, _p: r._city });
    cities.get(key).n += 1;
  }
  const states = statesIndex.states.filter((s) => s.latestSeason).map((s) => ({
    code: s.code, name: s.name, association: s.association, associationName: s.associationName,
    _name: prepare(s.name).canon, _assoc: prepare(s.association).canon, schools: s.schools,
  }));
  return { rows, cities: [...cities.values()], states };
}

// Fixed order for equal scores: appearances, then name, state and id, so duplicate names never reorder.
const byRank = (a, b) => b.score - a.score || b.row.apps - a.row.apps || a.row.name.localeCompare(b.row.name)
  || a.row.state.localeCompare(b.row.state) || a.row.id.localeCompare(b.row.id);

export const SCHOOLS_MAX = 6;
export const PLACES_MAX = 3;
export const CHIPS = ['Mater Dei', 'Texas', 'San Antonio', 'Lakeland', 'UIL'];
export const PHONE_CHIPS = ['Mater Dei', 'Texas', 'San Antonio'];
export const NOMATCH_CHIPS = ['Mater Dei', 'Texas'];

// A state is offered only for a whole state name, its code typed in capitals ("TX", never "tx" or "T"),
// or its association's name ("UIL"). A city is offered by word prefix from 3 letters, otherwise only exactly.
function placeHits(idx, q) {
  const states = idx.states.filter((s) => (q.canon && (s._name === q.canon || s._assoc === q.canon))
    || (/^[A-Z]{2}$/.test(q.typed) && s.code === q.typed));
  const long = q.joined.length >= 3;
  const cities = idx.cities
    .map((c) => ({ c, score: c._p.canon === q.canon ? 100 : long ? matchScore(c._p, q) : 0 }))
    .filter((x) => x.score)
    .sort((a, b) => b.score - a.score || b.c.n - a.c.n || a.c.city.localeCompare(b.c.city) || a.c.state.localeCompare(b.c.state))
    .map((x) => x.c);
  return { states, cities };
}

// -> { mode: 'help'|'list'|'nomatch', items: [...], schools: n matched by name, table: n rows the Schools table shows }
// items: { kind: 'chip', text } | { kind: 'school', row } | { kind: 'state', state } | { kind: 'city', city } | { kind: 'all', n, q }
export function suggest(idx, raw, { phone = false } = {}) {
  const q = parseQuery(raw);
  if (!q.words.length) return { mode: 'help', items: (phone ? PHONE_CHIPS : CHIPS).map((text) => ({ kind: 'chip', text })), schools: 0, table: 0 };
  const hits = idx.rows.map((row) => ({ row, score: matchScore(row._name, q) })).filter((h) => h.score).sort(byRank);
  const { states, cities } = placeHits(idx, q);
  const table = idx.rows.filter((r) => tableMatch(r, q.typed)).length;
  const items = hits.slice(0, SCHOOLS_MAX).map((h) => ({ kind: 'school', row: h.row }));
  items.push(...states.map((state) => ({ kind: 'state', state })));
  items.push(...cities.slice(0, PLACES_MAX).map((city) => ({ kind: 'city', city })));
  const shown = items.filter((it) => it.kind === 'school').length;
  if (table > shown) items.push({ kind: 'all', n: table, q: q.typed });
  if (!items.length) return { mode: 'nomatch', items: NOMATCH_CHIPS.map((text) => ({ kind: 'chip', text })), schools: 0, table: 0 };
  return { mode: 'list', items, schools: hits.length, table };
}

// Where choosing an item goes: a hash, or a chip's text to search for.
export function target(item) {
  switch (item.kind) {
    case 'school': return { hash: `#tab=team&school=${encodeURIComponent(item.row.id)}`, focusTitle: true };
    case 'state': return { hash: `#tab=playoffs&st=${item.state.code}` };
    case 'city': return { hash: `#tab=teams&q=${encodeURIComponent(item.city.city)}` };
    case 'all': return { hash: `#tab=teams&q=${encodeURIComponent(item.q)}` };
    case 'chip': return { fill: item.text };
    default: return null;
  }
}

// Enter with no active option (collegedash's rule, on our views): on the school list the filtered table stays;
// elsewhere the first school opens, or the first place when the query names only places, or the list with q.
// `list`: the school list (Teams with st/q, nav.js pageOf) is the page now open.
export function enterTarget(result, { list = false } = {}) {
  if (result.mode !== 'list') return null;
  if (list) return { stay: true };
  const first = result.items.find((it) => it.kind === 'school');
  if (first) return target(first);
  const place = result.items.find((it) => it.kind === 'state' || it.kind === 'city');
  if (place) return target(place);
  const all = result.items.find((it) => it.kind === 'all');
  return all ? target(all) : null;
}

// Keyboard state for the combobox (ARIA 1.2 editable combobox with list autocomplete).
// state: { open, active }; n: number of options. Returns the next state and an action, if any:
// 'choose' (the active option), 'enter' (no active option), 'clear' (Esc on a closed list).
export function keyStep({ open, active }, key, { alt = false } = {}, n = 0) {
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
      return { name: r.name, line };
    }
    case 'state': return { name: item.state.name, line: `${item.state.association} brackets · ${item.state.schools.toLocaleString('en-US')} schools` };
    case 'city': return { name: `${item.city.city}, ${item.city.state}`, line: `${item.city.n} school${item.city.n === 1 ? '' : 's'} in this city` };
    case 'all': return { name: `All ${item.n.toLocaleString('en-US')} school${item.n === 1 ? '' : 's'} matching “${item.q}” →`, line: 'Opens Schools' };
    case 'chip': return { name: item.text, line: '' };
    default: return { name: '', line: '' };
  }
}

// The status line read after a pause in typing.
export function statusText(result, raw, { list = false } = {}) {
  if (list && result.mode === 'list') return `${result.table.toLocaleString('en-US')} schools match · Enter keeps the table`;
  if (result.mode === 'help') return '';
  if (result.mode === 'nomatch') return `No school matches “${String(raw).trim()}”`;
  const places = result.items.filter((it) => it.kind === 'state' || it.kind === 'city').length;
  const bits = [];
  if (result.schools) bits.push(`${result.schools} school${result.schools === 1 ? '' : 's'}`);
  if (places) bits.push(`${places} place${places === 1 ? '' : 's'}`);
  const first = result.items.find((it) => it.kind === 'school') || result.items.find((it) => it.kind !== 'chip');
  const opens = !first ? '' : first.kind === 'all' ? ` · Enter shows them in Schools` : ` · Enter opens ${optionText(first).name}`;
  return `${bits.join(' and ') || `${result.table.toLocaleString('en-US')} school${result.table === 1 ? '' : 's'}`}${opens}`;
}

export function scopeText(idx, statesIndex, { phone = false } = {}) {
  const covered = statesIndex.states.filter((s) => s.latestSeason);
  const n = (idx ? idx.rows.length : covered.reduce((t, s) => t + s.schools, 0)).toLocaleString('en-US');
  if (phone) return `${n} schools in ${covered.length} states. Try:`;
  return `Every school with a state playoff appearance: ${n} in ${covered.length} states (${covered.map((s) => s.code).join(', ')}).`;
}
export const HINT = 'Type a school, a city, a state or an association.';
