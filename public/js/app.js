import { api, errorHtml } from './api.js';
import { normalize, readHash, resolveState, writeHash } from './state.js';
import * as states from './views/states.js';
import * as playoffs from './views/playoffs.js';
import * as results from './views/results.js';
import * as champions from './views/champions.js';
import * as schools from './views/schools.js';
import * as school from './views/school.js';
import * as about from './views/about.js';
import { canonicalHash, focusTitleAfter, hasSubNav, mainNavHtml, needsCatalog, pageOf, resolveTab, subNavHtml } from './nav.js';
import { initSearch } from './components/searchBox.js';
import './shell.js';

// Page modules by pageOf(): until #20's new views land, the new tabs render these (see nav.js).
const VIEWS = { states, playoffs, results, champions, schools, school, about };
const head = document.getElementById('page-head');
const controls = document.getElementById('controls');
const view = document.getElementById('view');
const mainNav = document.getElementById('main-nav');
const bottomNav = document.getElementById('bottom-nav');
const subNav = document.getElementById('tabs');
let statesIndex = null;
let state = {};
let renderSeq = 0;

function setState(patch, { replace = false, silent = false } = {}) {
  const next = { ...state, ...patch };
  for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
  if ('season' in patch || 'g' in patch || 'comp' in patch || 'div' in patch || 'st' in patch) delete next.round;
  state = next;
  writeHash(state, { replace });
  if (!silent) render();
}

// cause: 'hashchange' (a link, a Main nav link, Back/Forward), 'boot' (first load) or 'control' (an in-page
// control such as the season select or round pills). Only navigation moves focus to the new page's title (#11).
async function render(cause = 'control') {
  const seq = ++renderSeq;
  const hash = readHash();
  // Old links (Schools, School, States, Champions; nav.js migrate) open their new route; replaceState, so Back
  // has no extra entry.
  const fixed = canonicalHash(hash);
  if (fixed) history.replaceState(null, '', fixed);
  let raw = resolveTab(hash);
  let catalog = null;
  // Results and Playoffs (Brackets, Champions) show one state at a time and need its catalog.
  if (needsCatalog(raw.tab)) {
    raw = resolveState(raw, statesIndex);
    try {
      catalog = await api.stateCatalog(raw.st);
    } catch (err) {
      if (seq === renderSeq) view.innerHTML = errorHtml(err);
      return;
    }
    if (seq !== renderSeq) return;
    raw = normalize(raw, catalog);
  }
  state = raw;
  // The Main nav (header and phone bottom bar) and the Playoffs sub-nav: one aria-current="page" per route.
  mainNav.innerHTML = mainNavHtml(state);
  bottomNav.innerHTML = mainNavHtml(state, { cls: 'bottom-nav-link' });
  subNav.innerHTML = subNavHtml(state);
  subNav.hidden = !hasSubNav(state);
  const stateName = catalog ? ` · ${catalog.name}` : '';
  document.title = state.tab === 'team' || state.tab === 'teams'
    ? 'Teams · High School Girls Soccer' : `High School Girls Soccer${stateName}`;
  try {
    await VIEWS[pageOf(state)].render({ state, catalog, statesIndex, controls, view, head, setState });
  } catch (err) {
    if (seq === renderSeq) {
      console.error(err);
      view.innerHTML = '<div class="card notice">Something went wrong rendering this page.</div>';
    }
  }
  if (seq === renderSeq) {
    document.getElementById('main').scrollTo({ top: 0 }); // the content column scrolls, not the window
    window.dispatchEvent(new CustomEvent('hs-rendered'));  // the header search syncs its box (#13)
    // The view is not an aria-live region (#11): after navigation, focus moves to the page title, which a
    // screen reader then reads, instead of the whole page being announced.
    if (focusTitleAfter({ cause, searchFocused: document.activeElement?.id === 'search-input',
      drawerOpen: document.getElementById('layout').classList.contains('drawer') })) {
      document.querySelector('.content-title')?.focus({ preventScroll: true });
    }
  }
}

view.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="retry"]')) render();
});

// ----- Theme -----
document.getElementById('theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('hs-theme', next); } catch { /* ignore */ }
});

// ----- The one search box, in the header (#13): components/searchBox.js -----
initSearch({ getStatesIndex: () => statesIndex });

// ----- Boot -----
window.addEventListener('hashchange', () => render('hashchange'));
(async function boot() {
  try {
    statesIndex = await api.states();
  } catch {
    view.innerHTML = '<div class="card notice"><p>Couldn\'t load the dashboard.</p><button class="btn" onclick="location.reload()">Try again</button></div>';
    return;
  }
  const covered = statesIndex.states.filter((s) => s.latestSeason);
  document.getElementById('status-line').textContent =
    `Coverage: ${covered.length} states (${covered.map((s) => s.code).join(', ')}), more coming. Brackets from state associations via MaxPreps.`;
  render('boot');
  // "Data updated" is written once, by shell.js (header, or footer on narrow screens; #11).
})();
