// Pure navigation helpers (no DOM): which page a hash opens, old links, the Main nav, and links that keep context.
import { KEYS } from './state.js';
import { esc } from './util.js';

// Tabs (#20): three Main destinations, the team page (part of Teams) and About.
export const VIEW_IDS = ['teams', 'team', 'results', 'playoffs', 'about'];

// The Main nav, in the header (wider screens) and the bottom bar (phones). Standings is left out for now
// (owner decision on #20, option B).
export const MAIN_NAV = [['teams', 'Teams'], ['results', 'Results'], ['playoffs', 'Playoffs']];

// Playoffs has two sub-pages; Brackets is the default and is not written to the hash.
export const PLAYOFF_VIEWS = [['brackets', 'Brackets'], ['champions', 'Champions']];

// A team page has three (#20 PR 2); Overview is the default and is not written to the hash.
export const TEAM_VIEWS = [['overview', 'Overview'], ['results', 'Results'], ['history', 'Playoff history']];

// The `view` values each tab accepts; anything else is dropped.
const VIEW_VALUES = { teams: ['list'], team: ['results', 'history'], playoffs: ['champions'] };

// Old hashes (before #20) in their new names. Each old tab maps to a page that renders the same content:
//   #tab=states            -> #tab=teams                (the state overview)
//   #tab=states&st=XX      -> #tab=teams&st=XX          (that state's school list: an intended change)
//   #tab=schools[&st][&q]  -> #tab=teams[&st][&q]       (the school list; a plain #tab=schools keeps the full list)
//   #tab=school&school=ID  -> #tab=team&school=ID       (g= carries over); "#school=ID" too
//   #tab=champions&st=XX   -> #tab=playoffs&view=champions&st=XX
export function migrate(raw) {
  const out = { ...raw };
  if (!out.tab && out.school) out.tab = 'team';
  switch (out.tab) {
    case 'states': out.tab = 'teams'; break;
    case 'schools': out.tab = 'teams'; if (!out.st && !out.q) out.view = 'list'; break;
    case 'school': out.tab = 'team'; break;
    case 'champions': out.tab = 'playoffs'; out.view = 'champions'; break;
    default: break;
  }
  return out;
}

// An unknown or missing tab opens Teams, or Playoffs when the link names a competition; a team page needs
// a school (without one it opens the school list).
export function resolveTab(raw) {
  const out = migrate(raw);
  if (!out.tab || !VIEW_IDS.includes(out.tab)) out.tab = out.comp ? 'playoffs' : 'teams';
  if (out.tab === 'team' && !out.school) { out.tab = 'teams'; out.view = 'list'; }
  if (out.view && !(VIEW_VALUES[out.tab] || []).includes(out.view)) delete out.view;
  return out;
}

// The hash an old or untidy link should be replaced with (history.replaceState, so no extra Back entry),
// or null when the link is already in its new form. The home page (no hash) is left as it is.
export function canonicalHash(raw) {
  if (!Object.keys(raw).length) return null;
  const fixed = hrefFor(resolveTab(raw));
  return fixed === hrefFor(raw) ? null : fixed;
}

// Page modules (public/js/views/<page>.js) and the tabs that show one state at a time with its catalog.
export const PAGES = ['landing', 'schools', 'team', 'playoffs', 'champions', 'results', 'about'];
export const needsCatalog = (tab) => tab === 'playoffs' || tab === 'results';

// The page module that renders a resolved state: Teams is the landing (views/landing.js, #20 PR 5), or the
// school list with st/q/view=list; a team has its own page (views/team.js); Playoffs › Champions is the grid.
export function pageOf(state) {
  switch (state.tab) {
    case 'teams': return state.st || state.q || state.view === 'list' ? 'schools' : 'landing';
    case 'team': return 'team';
    case 'playoffs': return state.view === 'champions' ? 'champions' : 'playoffs';
    default: return state.tab;
  }
}

// The Main destination a tab belongs to (About belongs to none).
export const sectionOf = (tab) => (tab === 'team' ? 'teams' : MAIN_NAV.some(([k]) => k === tab) ? tab : null);

// Pages with their own sub-navigation (Playoffs › Brackets · Champions; a team's Overview · Results · Playoff
// history): there the sub-nav item is the current page and the Main item is aria-current="true" (the current
// section), so a route has exactly one aria-current="page".
export const hasSubNav = (state) => state.tab === 'playoffs' || state.tab === 'team';
export const subNavLabel = (state) => (state.tab === 'team' ? 'Team' : 'Playoffs');

// Whether a finished render should move focus to the page title (#11). Navigation does (a link, a nav link,
// Back/Forward); the first load and in-page controls (the filter row, #20 PR 3) don't, nor does a render while
// the user types in the header search.
export function focusTitleAfter({ cause, searchFocused = false } = {}) {
  if (searchFocused) return false;
  return cause === 'hashchange';
}

// After an in-page control's re-render, the control to focus again: the same id, if it is still on the page
// (#18 items 1 and 2: a filter select or toggle button keeps focus instead of falling back to the body).
export const refocusId = ({ cause, keep }) => (cause === 'control' && keep ? keep : null);

export function hrefFor(state) {
  const params = new URLSearchParams();
  for (const k of KEYS) if (state[k]) params.set(k, state[k]);
  return '#' + params.toString();
}

// The school list: filtered by state and/or name, or the whole list.
export const listHref = ({ st, q } = {}) => hrefFor({ tab: 'teams', view: st || q ? null : 'list', st, q });

// A Main nav link keeps the state, season and gender that make sense for it.
export function navHref(key, { st, season, g } = {}) {
  if (key === 'teams') return hrefFor({ tab: 'teams' });
  return hrefFor({ tab: key, st, season, g });
}

const ICON = {
  teams: '<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/>',
  results: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  playoffs: '<path d="M4 5h4v5H4zM4 14h4v5H4zM8 7.5h4v9H8M12 12h4M16 9.5h4v5h-4z"/>',
};
const icon = (key) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[key]}</svg>`;

// The Main nav's links (the same markup in the header nav and the phone's bottom nav).
export function mainNavHtml(state, { cls = 'main-nav-link' } = {}) {
  const here = sectionOf(state.tab);
  const current = hasSubNav(state) ? 'true' : 'page';
  return MAIN_NAV.map(([key, label]) => `<a class="${cls}" href="${esc(navHref(key, state))}"${key === here ? ` aria-current="${current}"` : ''}>`
    + `${icon(key)}<span>${label}</span></a>`).join('');
}

// A team page link. Every team tab keeps the school, the program (g) and the season: Playoff history shows
// all seasons, but keeps the season so Overview and Results come back to it.
export const teamHref = (school, { view = null, season = null, g = null } = {}) =>
  hrefFor({ tab: 'team', view: view === 'overview' ? null : view, school, season, g });

// Playoffs › Brackets · Champions, or a team's Overview · Results · Playoff history. Empty on other pages.
export function subNavHtml(state) {
  if (!hasSubNav(state)) return '';
  const { st, season, g } = state;
  if (state.tab === 'team') {
    const now = state.view || 'overview';
    return TEAM_VIEWS.map(([key, label]) => `<a class="view-tab" href="${esc(teamHref(state.school, { view: key, season, g }))}"`
      + `${key === now ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  }
  const now = state.view === 'champions' ? 'champions' : 'brackets';
  return PLAYOFF_VIEWS.map(([key, label]) => {
    const href = hrefFor({ tab: 'playoffs', view: key === 'brackets' ? null : key, st, season, g });
    return `<a class="view-tab" href="${esc(href)}"${key === now ? ' aria-current="page"' : ''}>${label}</a>`;
  }).join('');
}
