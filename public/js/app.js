import { api, errorHtml } from './api.js';
import { normalize, readHash, resolveState, writeHash } from './state.js';
import * as states from './views/states.js';
import * as playoffs from './views/playoffs.js';
import * as results from './views/results.js';
import * as champions from './views/champions.js';
import * as schools from './views/schools.js';
import * as school from './views/school.js';
import * as about from './views/about.js';
import { activeTab, resolveTab, tabHref } from './nav.js';
import { initSearch } from './components/searchBox.js';
import './shell.js';

const VIEWS = { states, playoffs, results, champions, schools, school, about };
const head = document.getElementById('page-head');
// Tabs that show one state at a time and need that state's catalog.
const STATE_TABS = new Set(['playoffs', 'results', 'champions']);
const controls = document.getElementById('controls');
const view = document.getElementById('view');
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

async function render() {
  const seq = ++renderSeq;
  let raw = resolveTab(readHash());
  let catalog = null;
  if (STATE_TABS.has(raw.tab)) {
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
  document.querySelectorAll('#tabs [data-tab]').forEach((a) => {
    a.href = tabHref(a.dataset.tab, state);
    if (a.dataset.tab === activeTab(state.tab)) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const stateName = catalog ? ` · ${catalog.name}` : '';
  document.title = state.tab === 'school' || state.tab === 'schools'
    ? 'Schools · High School Girls Soccer' : `High School Girls Soccer${stateName}`;
  try {
    await VIEWS[state.tab].render({ state, catalog, statesIndex, controls, view, head, setState });
  } catch (err) {
    if (seq === renderSeq) {
      console.error(err);
      view.innerHTML = '<div class="card notice">Something went wrong rendering this page.</div>';
    }
  }
  if (seq === renderSeq) {
    document.getElementById('main').scrollTo({ top: 0 }); // the content column scrolls, not the window
    window.dispatchEvent(new CustomEvent('hs-rendered'));  // the header search syncs its box (#13)
  }
}

view.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="retry"]')) render();
});

// Tab links keep the current state and season.
document.getElementById('tabs').addEventListener('click', (e) => {
  const a = e.target.closest('[data-tab]');
  if (!a) return;
  e.preventDefault();
  const tab = a.dataset.tab;
  const { st, season, g } = state;
  state = tab === 'states' ? { tab } : tab === 'schools' ? { tab, st } : { tab, st, season, g };
  writeHash(state);
  render();
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
window.addEventListener('hashchange', render);
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
  render();
  api.status().then((s) => {
    if (s?.updatedAt) {
      document.getElementById('status-line').textContent += ` Data updated ${new Date(s.updatedAt).toLocaleString()}.`;
    }
  }).catch(() => {});
})();
