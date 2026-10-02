// Pure navigation helpers (no DOM): which page a hash opens, old links, the Main nav, and links that keep context.
import { KEYS } from './state.js';
import { esc } from './util.js';

// Tabs (#20, renamed in #26, #30): two Main destinations, each with its pages (a school, an event), and About.
export const VIEW_IDS = ['schools', 'school', 'events', 'event', 'about'];

// The Main nav, in the header (wider screens) and the bottom bar (phones). Since #30 (owner: "two views: Schools
// and Events") Results and Playoffs live under Events: an event's page holds its bracket, and All games and
// Champions are Events' sub-pages.
export const MAIN_NAV = [['schools', 'Schools'], ['events', 'Events']];

// Events has three sub-pages (#30 plan v2): the event cards (the default, not written to the hash), every game of
// a state's season (was Results) and the champions grid (was Playoffs › Champions).
export const EVENTS_VIEWS = [['events', 'Events'], ['games', 'All games'], ['champions', 'Champions']];

// A school's page has three (#20 PR 2); Overview is the default and is not written to the hash.
export const TEAM_VIEWS = [['overview', 'Overview'], ['results', 'Results'], ['history', 'Playoff history']];

// The `view` values each tab accepts; anything else is dropped.
const VIEW_VALUES = { schools: ['list'], school: ['results', 'history'], events: ['games', 'champions'], event: ['games'] };

// An event's two pages (#30 PR 2): its bracket (the default, not written to the hash) and its games.
export const EVENT_VIEWS = [['bracket', 'Bracket'], ['games', 'Games']];

// The `show` values each page accepts (#30 plan v2): the event cards filter by status, All games by finished or
// upcoming; anywhere else `show` is dropped, so e.g. events&show=results can't render an empty landing.
const SHOW_VALUES = { events: ['live', 'upcoming', 'complete'], games: ['results', 'upcoming'] };
const showValuesOf = (out) => (out.tab !== 'events' ? [] : out.view === 'games' ? SHOW_VALUES.games
  : out.view ? [] : SHOW_VALUES.events);

// Old hashes in their current names, in one step (no old name maps to another old name):
//   #tab=teams[&st][&q][&view=list]           -> #tab=schools[…]          (#21–#25 links; the same parameters)
//   #tab=team&school=ID[&view][&season][&g]   -> #tab=school&school=ID[…]
//   #tab=states            -> #tab=schools               (the landing)
//   #tab=states&st=XX      -> #tab=schools&st=XX         (that state's school list, as since #21)
//   #school=ID             -> #tab=school&school=ID      (g= carries over)
//   #tab=results[&st][&season][&show][&g]     -> #tab=events&view=games[…]   (#30: All games)
//   #tab=champions[&st] and #tab=playoffs&view=champions[&st]  -> #tab=events&view=champions[…]
//   #tab=playoffs…&comp[&div][&round]         -> #tab=event…   (a bracket; a missing div is filled by normalize)
//   #tab=playoffs[&st][&season]  (no comp)    -> #tab=events[…] (the Events landing for that state; #30: it was
//                                                that state's default bracket)
// Pre-#20 #tab=schools[&st][&q] and #tab=school&school=ID are native again. One intended difference (owner,
// #26): a pre-#20 bare #tab=schools (then the full list) opens the landing; the full list is &view=list.
export function migrate(raw) {
  const out = { ...raw };
  if (!out.tab && out.school) out.tab = 'school';
  switch (out.tab) {
    case 'teams': case 'states': out.tab = 'schools'; break;
    case 'team': out.tab = 'school'; break;
    case 'results': out.tab = 'events'; out.view = 'games'; break;
    case 'champions': out.tab = 'events'; out.view = 'champions'; break;
    case 'playoffs':
      if (out.view === 'champions') out.tab = 'events';
      else if (out.comp || out.div) { out.tab = 'event'; delete out.view; }
      else { out.tab = 'events'; delete out.view; }
      break;
    default: break;
  }
  return out;
}

// An unknown or missing tab opens Schools, or an event when the link names a competition; a school's page needs
// a school (without one it opens the school list). An event with no competition or division is filled in from
// the state catalog (state.js normalize), as Playoffs was. `round` belongs to an event's bracket only, `show` to
// the pages above.
export function resolveTab(raw) {
  const out = migrate(raw);
  if (!out.tab || !VIEW_IDS.includes(out.tab)) out.tab = out.comp ? 'event' : 'schools';
  if (out.tab === 'school' && !out.school) { out.tab = 'schools'; out.view = 'list'; }
  if (out.view && !(VIEW_VALUES[out.tab] || []).includes(out.view)) delete out.view;
  if (out.round != null && out.tab !== 'event') delete out.round;
  if (out.show && !showValuesOf(out).includes(out.show)) delete out.show;
  return out;
}

// The Schools search (#26) lives on the Schools page only: the landing and the list, never a school's page.
export const hasSchoolSearch = (state) => state.tab === 'schools';

// The "/" shortcut (#26): on a Schools page it focuses the box; anywhere else it opens Schools and then
// focuses the box. Not while typing in a field, and not with Ctrl, Meta or Alt (browser and OS shortcuts).
// `e.key === '/'` matches layouts where "/" needs Shift. Returns null when the key isn't the shortcut.
export function slashAction(state, e) {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return null;
  const t = e.target;
  if (t && (t.isContentEditable || t.closest?.('input, select, textarea, [contenteditable]'))) return null;
  return hasSchoolSearch(state) ? { focus: true } : { hash: '#tab=schools', focus: true };
}

// The box's text after a render: leaving Schools clears it; on the list it shows q= unless you're typing in it;
// within Schools (landing ↔ list) it keeps what you typed.
export function boxTextAfter({ state, focused, text }) {
  if (!hasSchoolSearch(state)) return '';
  if (pageOf(state) === 'schools' && !focused) return state.q || '';
  return text;
}

// The hash an old or untidy link should be replaced with (history.replaceState, so no extra Back entry),
// or null when the link is already in its new form. The home page (no hash) is left as it is.
export function canonicalHash(raw) {
  if (!Object.keys(raw).length) return null;
  const fixed = hrefFor(resolveTab(raw));
  return fixed === hrefFor(raw) ? null : fixed;
}

// Page modules (public/js/views/<page>.js) and the tabs that show one state at a time with its catalog.
export const PAGES = ['landing', 'schools', 'team', 'events', 'playoffs', 'champions', 'results', 'about'];
// An event and Events' All games and Champions show one state at a time with its catalog; the event cards read
// every state's catalog (/api/v1/catalog) themselves.
export const needsCatalog = (state) => state.tab === 'event' || (state.tab === 'events' && !!state.view);

// The page module that renders a resolved state: Schools is the landing (views/landing.js), or the school list
// with st/q/view=list (views/schools.js); a school has its own page (views/team.js). Events is the event cards
// (views/events.js); All games and Champions keep their views (results.js, champions.js); an event is its bracket
// (views/playoffs.js).
export function pageOf(state) {
  switch (state.tab) {
    case 'schools': return state.st || state.q || state.view === 'list' ? 'schools' : 'landing';
    case 'school': return 'team';
    case 'events': return state.view === 'games' ? 'results' : state.view === 'champions' ? 'champions' : 'events';
    case 'event': return 'playoffs';
    default: return state.tab;
  }
}

// The Main destination a tab belongs to (About belongs to none).
export const sectionOf = (tab) => (tab === 'school' ? 'schools' : tab === 'event' ? 'events'
  : MAIN_NAV.some(([k]) => k === tab) ? tab : null);

// Pages with their own sub-navigation (Events › Events · All games · Champions; an event's Bracket · Games; a
// school's Overview · Results · Playoff history): there the sub-nav item is the current page and the Main item is
// aria-current="true" (the current section), so a route has exactly one aria-current="page".
export const hasSubNav = (state) => state.tab === 'events' || state.tab === 'event' || state.tab === 'school';

// The division an event's state points at in its state catalog (after normalize), or null.
export function eventOf(state, catalog) {
  const comp = catalog?.seasons.find((s) => s.season === state.season)?.competitions.find((c) => c.id === state.comp);
  const div = comp?.divisions.find((d) => d.code === state.div);
  return comp && div ? { comp, div } : null;
}

// The sub-nav's name: an event's is the event itself ("CIF State Championships Division 1 2025-26").
export function subNavLabel(state, catalog = null) {
  if (state.tab === 'school') return 'School';
  if (state.tab === 'event') {
    const ev = eventOf(state, catalog);
    return ev ? `${ev.comp.label} ${ev.div.label} ${state.season}` : 'Event';
  }
  return 'Events';
}

// Whether a finished render should move focus to the page title (#11). Navigation does (a link, a nav link,
// Back/Forward); the first load and in-page controls (the filter row, #20 PR 3) don't, nor does a render while
// the user types in the Schools search, or right after "/" put focus there (#26).
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
export const listHref = ({ st, q } = {}) => hrefFor({ tab: 'schools', view: st || q ? null : 'list', st, q });

// A Main nav link opens its section's first page, fresh (Schools since #26, Events since #30).
export function navHref(key) {
  return hrefFor({ tab: key });
}

// Events' own pages: the event cards, All games and Champions keep the state, season and gender they make
// sense with.
export function eventsHref(view, { st, season, g } = {}) {
  if (view === 'champions') return hrefFor({ tab: 'events', view, st, g });
  return hrefFor({ tab: 'events', view: view === 'events' ? null : view, st, season, g });
}

const ICON = {
  schools: '<path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6"/>',   // a schoolhouse (#26)
  events: '<path d="M4 5h4v5H4zM4 14h4v5H4zM8 7.5h4v9H8M12 12h4M16 9.5h4v5h-4z"/>',   // a bracket
};
const icon = (key) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[key]}</svg>`;

// The Main nav's links (the same markup in the header nav and the phone's bottom nav).
export function mainNavHtml(state, { cls = 'main-nav-link' } = {}) {
  const here = sectionOf(state.tab);
  const current = hasSubNav(state) ? 'true' : 'page';
  return MAIN_NAV.map(([key, label]) => `<a class="${cls}" href="${esc(navHref(key))}"${key === here ? ` aria-current="${current}"` : ''}>`
    + `${icon(key)}<span>${label}</span></a>`).join('');
}

// A school's page link (#tab=school since #26). Every tab keeps the school, the program (g) and the season:
// Playoff history shows all seasons, but keeps the season so Overview and Results come back to it.
export const teamHref = (school, { view = null, season = null, g = null } = {}) =>
  hrefFor({ tab: 'school', view: view === 'overview' ? null : view, school, season, g });

// An event's page: one division's tournament in one school year (#30). A missing division (or competition) is
// filled in from the state catalog by normalize, as Playoffs did.
export const eventHref = ({ st, season, comp, div, round = null, g = null, view = null }) =>
  hrefFor({ tab: 'event', view, st, season, comp, div, round: round == null ? null : String(round), g });

// Events › Events · All games · Champions, an event's Bracket · Games (N), or a school's Overview · Results ·
// Playoff history. Empty elsewhere. The count of an event's games is inside the link, read as "Games (15)".
export function subNavHtml(state, catalog = null) {
  if (!hasSubNav(state)) return '';
  const { st, season, g } = state;
  if (state.tab === 'event') {
    const now = state.view || 'bracket';
    const n = eventOf(state, catalog)?.div.games;
    return EVENT_VIEWS.map(([key, label]) => {
      const href = eventHref({ st, season, comp: state.comp, div: state.div, g, view: key === 'bracket' ? null : key });
      return `<a class="view-tab" href="${esc(href)}"${key === now ? ' aria-current="page"' : ''}>${label}${key === 'games' && n != null ? ` (${n})` : ''}</a>`;
    }).join('');
  }
  if (state.tab === 'school') {
    const now = state.view || 'overview';
    return TEAM_VIEWS.map(([key, label]) => `<a class="view-tab" href="${esc(teamHref(state.school, { view: key, season, g }))}"`
      + `${key === now ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  }
  const now = state.view || 'events';
  return EVENTS_VIEWS.map(([key, label]) => `<a class="view-tab" href="${esc(eventsHref(key, { st, season, g }))}"`
    + `${key === now ? ' aria-current="page"' : ''}>${label}</a>`).join('');
}
