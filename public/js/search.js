// The Schools search (#13; on the Schools page since #26): matching, ranking and suggestions, as pure functions
// (no DOM, no fetch). Modelled on collegedash's header search: word-prefix matching ranked exact > prefix > every
// word a prefix > initials, and example chips. Since #30 it suggests schools only (owner: "search in schools is
// to find schools"): no state, association or city options, so it never leads to another page; a city still
// finds its schools through the "All N schools matching" row, which opens the school list.
// Data: the rows of /api/v1/search-index (id, name, city, state, apps, titles) and states.json.

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

export function buildIndex(searchIndex, statesIndex) {
  const rows = searchIndex.rows.map((r) => Object.fromEntries(searchIndex.fields.map((f, i) => [f, r[i]])));
  for (const r of rows) r._name = prepare(r.name);
  return { rows };
}

// Fixed order for equal scores: appearances, then name, state and id, so duplicate names never reorder.
const byRank = (a, b) => b.score - a.score || b.row.apps - a.row.apps || a.row.name.localeCompare(b.row.name)
  || a.row.state.localeCompare(b.row.state) || a.row.id.localeCompare(b.row.id);

export const SCHOOLS_MAX = 6;
// Example searches are school names (#30: the search finds schools).
export const CHIPS = ['Mater Dei', 'Los Gatos', 'Lakeland', 'Southlake Carroll', 'St. Pius X'];
export const PHONE_CHIPS = ['Mater Dei', 'Los Gatos', 'Lakeland'];
export const NOMATCH_CHIPS = ['Mater Dei', 'Los Gatos'];

// -> { mode: 'help'|'list'|'nomatch', items: [...], schools: n matched by name, table: n rows the Schools table shows }
// items: { kind: 'chip', text } | { kind: 'school', row } | { kind: 'all', n, q }   (schools only since #30)
export function suggest(idx, raw, { phone = false } = {}) {
  const q = parseQuery(raw);
  if (!q.words.length) return { mode: 'help', items: (phone ? PHONE_CHIPS : CHIPS).map((text) => ({ kind: 'chip', text })), schools: 0, table: 0 };
  const hits = idx.rows.map((row) => ({ row, score: matchScore(row._name, q) })).filter((h) => h.score).sort(byRank);
  const table = idx.rows.filter((r) => tableMatch(r, q.typed)).length;
  const items = hits.slice(0, SCHOOLS_MAX).map((h) => ({ kind: 'school', row: h.row }));
  if (table > items.length) items.push({ kind: 'all', n: table, q: q.typed });
  if (!items.length) return { mode: 'nomatch', items: NOMATCH_CHIPS.map((text) => ({ kind: 'chip', text })), schools: 0, table: 0 };
  return { mode: 'list', items, schools: hits.length, table };
}

// Where choosing an item goes: a school's page, the school list, or a chip's text to search for.
export function target(item) {
  switch (item.kind) {
    case 'school': return { hash: `#tab=school&school=${encodeURIComponent(item.row.id)}`, focusTitle: true };
    case 'all': return { hash: `#tab=schools&q=${encodeURIComponent(item.q)}` };
    case 'chip': return { fill: item.text };
    default: return null;
  }
}

// Enter with no active option (collegedash's rule, on our views): on the school list the filtered table stays;
// elsewhere the first school opens, or the list with q when no name matches (e.g. a city's schools).
// `list`: the school list (Schools with st/q, nav.js pageOf) is the page now open.
export function enterTarget(result, { list = false } = {}) {
  if (result.mode !== 'list') return null;
  if (list) return { stay: true };
  const first = result.items.find((it) => it.kind === 'school');
  if (first) return target(first);
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
  const first = result.items.find((it) => it.kind === 'school') || result.items.find((it) => it.kind !== 'chip');
  const opens = !first ? '' : first.kind === 'all' ? ` · Enter shows them in Schools` : ` · Enter opens ${optionText(first).name}`;
  const n = result.schools || result.table;
  return `${n.toLocaleString('en-US')} school${n === 1 ? '' : 's'}${opens}`;
}

export function scopeText(idx, statesIndex, { phone = false } = {}) {
  const covered = statesIndex.states.filter((s) => s.latestSeason);
  const n = (idx ? idx.rows.length : covered.reduce((t, s) => t + s.schools, 0)).toLocaleString('en-US');
  if (phone) return `${n} schools in ${covered.length} states. Try:`;
  return `Every school with a state playoff appearance: ${n} in ${covered.length} states (${covered.map((s) => s.code).join(', ')}).`;
}
export const HINT = "Type a school's name, or its city for the school list.";
