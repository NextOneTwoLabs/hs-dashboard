// Sidebar pill groups (collegedash .pill / .pill-row), as pure HTML builders.
// Pills that navigate are links with aria-current; a pill that only filters the page is a
// button with aria-pressed. Counts are shown small, with their unit for screen readers.
// Everything here is built from states.json and the current state's catalog: no fetches.
import { bracketHref, esc } from '../util.js';
import { hrefFor } from '../nav.js';

export function pillLink(href, label, { current = false, count = null, unit = '', name = label } = {}) {
  const sr = count != null ? `${name}, ${count} ${unit}`.trim() : name;
  return `<a class="pill" href="${esc(href)}"${current ? ' aria-current="true"' : ''} aria-label="${esc(sr)}">`
    + `${esc(label)}${count != null ? `<span class="pill-sub" aria-hidden="true">${esc(count)}</span>` : ''}</a>`;
}

export function pillButton(attrs, label, { pressed = false, count = null, unit = '', name = label } = {}) {
  const sr = count != null ? `${name}, ${count} ${unit}`.trim() : name;
  return `<button type="button" class="pill" ${attrs} aria-pressed="${pressed}" aria-label="${esc(sr)}">`
    + `${esc(label)}${count != null ? `<span class="pill-sub" aria-hidden="true">${esc(count)}</span>` : ''}</button>`;
}

export function group(label, pills, { id } = {}) {
  const gid = id || `grp-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return `<div class="browse-label" id="${gid}">${esc(label)}</div><div class="pill-row" role="group" aria-labelledby="${gid}">${pills}</div>`;
}

const covered = (statesIndex) => statesIndex.states.filter((s) => s.latestSeason);

// Brackets in a state's latest season, from states.json.
export const bracketCount = (row) => (row.latest || []).reduce((t, c) => t + c.divisions.length, 0);

// State pills. `hrefOf(code)` builds each link; `all` adds an "All" pill with that href.
// `count`: 'brackets' (latest season, from states.json), 'schools', or null.
export function statePills(statesIndex, current, hrefOf, { all = null, count = 'brackets' } = {}) {
  const rows = covered(statesIndex);
  const pills = rows.map((s) => {
    const n = count === 'brackets' ? bracketCount(s) : count === 'schools' ? s.schools : null;
    const unit = count === 'brackets' ? `bracket${n === 1 ? '' : 's'} in ${s.latestSeason}` : count === 'schools' ? 'schools' : '';
    return pillLink(hrefOf(s.code), s.code, { current: s.code === current, count: n, unit, name: s.name });
  }).join('');
  const allPill = all != null ? pillLink(all, 'All', { current: !current, name: 'All states' }) : '';
  return group('State', allPill + pills);
}

// Competition pills (e.g. CA State / NorCal / SoCal), only when a season has more than one.
export function compPills(season, state) {
  const comps = season?.competitions || [];
  if (comps.length < 2) return '';
  return group('Championship', comps.map((c) =>
    pillLink(hrefFor({ tab: 'playoffs', st: state.st, season: state.season, comp: c.id, g: state.g }), c.short,
      { current: c.id === state.comp, name: c.label })).join(''));
}

// Division pills: no count for now (owner decision on #5; team counts need data the catalog lacks).
export function divisionPills(comp, state) {
  if (!comp) return '';
  const divs = comp.divisions.filter((d) => d.gender[0] === state.g);
  return group('Division', divs.map((d) =>
    pillLink(bracketHref(state.st, state.season, comp.id, d.code), shortLabel(d.label),
      { current: d.code === state.div, name: d.label })).join('') || '<span class="side-empty">No divisions</span>');
}

export const shortLabel = (label) => label.replace(/^(Class|Conference) /, '');

// Results "Show" filter: links that keep writing the `show` hash key.
export function showPills(state) {
  const show = state.show || 'all';
  return group('Show', [['all', 'All'], ['results', 'Results'], ['upcoming', 'Upcoming']].map(([v, label]) =>
    pillLink(hrefFor({ tab: 'results', st: state.st, season: state.season, g: state.g, show: v === 'all' ? null : v }), label,
      { current: show === v, name: `Show ${label.toLowerCase()}` })).join(''));
}

// Season-of-play filter on the States view: it only filters the cards, so it is a button.
export function termPills(statesIndex, term) {
  const rows = covered(statesIndex);
  const terms = [['fall', 'Fall'], ['winter', 'Winter'], ['spring', 'Spring']].filter(([t]) => rows.some((s) => s.terms.includes(t)));
  return group('Season of play', pillButton('data-term=""', 'All', { pressed: !term, name: 'All seasons of play' })
    + terms.map(([t, label]) => {
      const n = rows.filter((s) => s.terms.includes(t)).length;
      return pillButton(`data-term="${t}"`, label, { pressed: term === t, count: n, unit: `state${n === 1 ? '' : 's'}` });
    }).join(''));
}
