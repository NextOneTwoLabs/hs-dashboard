// Pure navigation helpers (no DOM): which view a hash opens, and links that keep context.
import { KEYS } from './state.js';

export const VIEW_IDS = ['states', 'playoffs', 'results', 'champions', 'schools', 'school', 'about'];

// The content-header view tabs. "playoffs" keeps its hash value; it is labelled Brackets.
export const VIEW_TABS = [
  ['states', 'States'], ['playoffs', 'Brackets'], ['results', 'Results'], ['champions', 'Champions'], ['schools', 'Schools'],
];

// Same rules as before the redesign: an unknown or missing tab opens States, or Brackets when
// the link names a competition; a school page needs a school. "#school=<id>" opens it too.
export function resolveTab(raw) {
  const out = { ...raw };
  if (!out.tab && out.school) out.tab = 'school';
  if (!out.tab || !VIEW_IDS.includes(out.tab)) out.tab = out.comp ? 'playoffs' : 'states';
  if (out.tab === 'school' && !out.school) out.tab = 'schools';
  return out;
}

// The tab a view highlights (a school page belongs to Schools; About to none).
export const activeTab = (tab) => (tab === 'school' ? 'schools' : tab);

// Whether a finished render should move focus to the page title (#11). Navigation does (a link, Back/Forward,
// a view tab); the first load and in-page controls don't, nor does a render while the user types in the header
// search or works in the phone's filter drawer.
export function focusTitleAfter({ cause, searchFocused = false, drawerOpen = false } = {}) {
  if (searchFocused || drawerOpen) return false;
  return cause === 'hashchange' || cause === 'tab';
}

export function hrefFor(state) {
  const params = new URLSearchParams();
  for (const k of KEYS) if (state[k]) params.set(k, state[k]);
  return '#' + params.toString();
}

// A view tab keeps the state, season and gender that make sense for it.
export function tabHref(tab, { st, season, g } = {}) {
  if (tab === 'states') return hrefFor({ tab });
  if (tab === 'schools') return hrefFor({ tab, st });
  return hrefFor({ tab, st, season, g });   // the same context the tab click handler always kept
}
