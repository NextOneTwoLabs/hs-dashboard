import { api, errorHtml } from './api.js';
import { normalize, readHash, resolveState, writeHash } from './state.js';
import { esc, schoolHref } from './util.js';
import * as states from './views/states.js';
import * as playoffs from './views/playoffs.js';
import * as results from './views/results.js';
import * as champions from './views/champions.js';
import * as schools from './views/schools.js';
import * as school from './views/school.js';
import * as about from './views/about.js';
import { activeTab, resolveTab, tabHref } from './nav.js';
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
  if (seq === renderSeq) document.getElementById('main').scrollTo({ top: 0 }); // the content column scrolls, not the window
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

// ----- Global school search (all states) -----
const input = document.getElementById('search-input');
const list = document.getElementById('search-results');
let directory = null;
let active = -1;

async function search() {
  const q = input.value.trim().toLowerCase();
  if (!q) { list.hidden = true; return; }
  if (!directory) {
    try {
      const idx = await api.searchIndex();
      directory = idx.rows.map((r) => Object.fromEntries(idx.fields.map((f, i) => [f, r[i]])));
    } catch {
      list.innerHTML = '<li class="empty">Search unavailable</li>';
      list.hidden = false;
      return;
    }
  }
  const hits = directory
    .filter((s) => s.name.toLowerCase().includes(q) || (s.city || '').toLowerCase().includes(q))
    .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || b.apps - a.apps)
    .slice(0, 8);
  active = hits.length ? 0 : -1;
  list.innerHTML = hits.length
    ? hits.map((s, i) => `<li><a href="${schoolHref(s.id)}" aria-selected="${i === 0}"><span>${esc(s.name)}</span><span class="muted">${esc([s.city, s.state].filter(Boolean).join(', '))}</span></a></li>`).join('')
    : '<li class="empty">No schools found</li>';
  list.hidden = false;
}
input.addEventListener('input', search);
input.addEventListener('keydown', (e) => {
  const links = [...list.querySelectorAll('a')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!links.length) return;
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
    links.forEach((a, i) => a.setAttribute('aria-selected', i === active));
  } else if (e.key === 'Enter' && links[active]) {
    location.hash = links[active].getAttribute('href');
    input.value = '';
    list.hidden = true;
    input.blur();
  } else if (e.key === 'Escape') {
    list.hidden = true;
    input.blur();
  }
});
list.addEventListener('click', () => { list.hidden = true; input.value = ''; });
document.addEventListener('click', (e) => { if (!e.target.closest('#search')) list.hidden = true; });
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.target.closest('input, select, textarea')) { e.preventDefault(); input.focus(); }
});

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
