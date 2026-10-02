// Filter rows (#20 PR 3): compact selects in a row above the content they filter, replacing the statewide
// sidebar pills. Built from states.json and the state's catalog only (no fetches), as pure HTML.
// - The school year (2025-26) is its own select; the season of play (Fall / Winter / Spring) is plain text.
// - No counts: every option is a name, so nothing needs explaining.
// - A select change is an in-page control (app.js keeps focus on it after the re-render, #18 item 1).
import { esc } from '../util.js';

const TERM = { fall: 'Fall', winter: 'Winter', spring: 'Spring' };
const covered = (statesIndex) => statesIndex.states.filter((s) => s.latestSeason);

// One labelled select. `options`: [[value, label], ...]; `value` is selected.
export function selectField(key, label, value, options) {
  const opts = options.map(([v, text]) => `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(text)}</option>`).join('');
  return `<div class="field"><label for="f-${key}">${esc(label)}</label><select id="f-${key}" data-set="${key}">${opts}</select></div>`;
}

// State: every covered state by name; `all` adds "All states" (value '').
export function stateSelect(statesIndex, current, { all = false } = {}) {
  const opts = covered(statesIndex).map((s) => [s.code, s.name]);
  return selectField('st', 'State', current || '', all ? [['', 'All states'], ...opts] : opts);
}

// School year: the catalog's seasons that have brackets.
export function seasonSelect(catalog, current) {
  return selectField('season', 'School year', current, catalog.seasons.filter((s) => s.competitions.length).map((s) => [s.season, s.season]));
}

// Championship (e.g. CIF State / NorCal / SoCal): only when the school year has more than one.
export function compSelect(season, current) {
  const comps = season?.competitions || [];
  return comps.length < 2 ? '' : selectField('comp', 'Championship', current, comps.map((c) => [c.id, c.label]));
}

// Division, in the catalog's order, for the selected gender.
export function divisionSelect(comp, state) {
  const divs = (comp?.divisions || []).filter((d) => d.gender[0] === state.g);
  return divs.length ? selectField('div', 'Division', state.div, divs.map((d) => [d.code, d.label])) : '';
}

// Results: which games to show (the `show` hash key, unchanged).
export const showSelect = (show) => selectField('show', 'Show', show || '', [['', 'All games'], ['results', 'Results'], ['upcoming', 'Upcoming']]);

// The season of play, as text beside the school year: "Winter season".
export function termNote(statesIndex, st) {
  const row = statesIndex.states.find((s) => s.code === st);
  const terms = (row?.terms || []).map((t) => TERM[t] || t);
  return terms.length ? `<p class="filter-term">${esc(terms.join(' and '))} season</p>` : '';
}

// The landing page's season-of-play filter: toggle buttons that only filter the cards (no counts).
export function termButtons(statesIndex, term) {
  const rows = covered(statesIndex);
  const terms = [['', 'All'], ...Object.entries(TERM).filter(([t]) => rows.some((s) => s.terms.includes(t)))];
  const buttons = terms.map(([t, label]) => `<button type="button" id="f-term-${t || 'all'}" data-term="${t}" aria-pressed="${t === (term || '')}">${esc(label)}</button>`).join('');
  return `<div class="field seg-field"><span class="field-label" id="f-term-label">Season of play</span><div class="seg" role="group" aria-labelledby="f-term-label">${buttons}</div></div>`;
}

// What a change also clears, so the next level falls back to its default (state.js normalize):
// a new state or school year picks that year's first championship and division, and so on.
const RESET = { st: ['season', 'comp', 'div'], season: ['comp', 'div'], comp: ['div'], g: ['comp', 'div'] };
export function patchFor(key, value) {
  const patch = { [key]: value || null };
  for (const k of RESET[key] || []) patch[k] = null;
  return patch;
}

// Wire the row's selects to setState (one patch per change).
export function bindFilters(root, setState, { patch = patchFor } = {}) {
  root.querySelectorAll('select[data-set]').forEach((sel) => {
    sel.addEventListener('change', () => setState(patch(sel.dataset.set, sel.value)));
  });
}

// The phone toggle's summary: the selected option of each select and the pressed buttons, in order.
// Built from the row's HTML as rendered (app.js), so it always matches the controls.
export function summaryOf(html) {
  const bits = [];
  for (const m of String(html).matchAll(/<select[^>]*>([\s\S]*?)<\/select>|<button[^>]*aria-pressed="true"[^>]*>([^<]*)<\/button>/g)) {
    if (m[2] != null) { bits.push(m[2]); continue; }
    // The browser serialises the attribute as selected="" when the HTML is read back from the DOM.
    const sel = m[1].match(/<option[^>]*\sselected(?:="[^"]*")?[^>]*>([^<]*)<\/option>/) || m[1].match(/<option[^>]*>([^<]*)<\/option>/);
    if (sel) bits.push(sel[1]);
  }
  return bits.map((b) => b.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')).join(' · ');
}
