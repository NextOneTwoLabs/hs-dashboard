import { api } from './api.js';
import { normalize, readHash, writeHash } from './state.js';
import { esc, schoolHref } from './util.js';
import * as playoffs from './views/playoffs.js';
import * as results from './views/results.js';
import * as champions from './views/champions.js';
import * as schools from './views/schools.js';
import * as school from './views/school.js';

const VIEWS = { playoffs, results, champions, schools, school };
const controls = document.getElementById('controls');
const view = document.getElementById('view');
let catalog = null;
let state = {};
let renderSeq = 0;

function setState(patch, { replace = false, silent = false } = {}) {
  const next = { ...state, ...patch };
  for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
  if ('season' in patch || 'g' in patch || 'comp' in patch || 'div' in patch) delete next.round;
  state = next;
  writeHash(state, { replace });
  if (!silent) render();
}

async function render() {
  const seq = ++renderSeq;
  const raw = readHash();
  state = raw.tab === 'schools' || raw.tab === 'school' ? { ...raw, season: raw.season } : normalize(raw, catalog);
  if (!state.tab || !VIEWS[state.tab]) state.tab = 'playoffs';
  if (state.tab === 'school' && !state.school) state.tab = 'schools';
  document.querySelectorAll('#tabs [data-tab]').forEach((a) => {
    const on = a.dataset.tab === state.tab || (state.tab === 'school' && a.dataset.tab === 'schools');
    a.setAttribute('aria-selected', on);
  });
  if (state.tab === 'school' || state.tab === 'schools') document.title = 'Schools · CIF Girls Soccer';
  else document.title = 'CIF Girls Soccer';
  try {
    await VIEWS[state.tab].render({ state, catalog, controls, view, setState });
  } catch (err) {
    if (seq === renderSeq) {
      console.error(err);
      view.innerHTML = '<div class="card notice">Something went wrong rendering this page.</div>';
    }
  }
  if (seq === renderSeq) window.scrollTo({ top: 0 });
}

view.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="retry"]')) render();
});

// Keep the tab links pointing at the current season/gender.
document.getElementById('tabs').addEventListener('click', (e) => {
  const a = e.target.closest('[data-tab]');
  if (!a) return;
  e.preventDefault();
  const { season, g } = state;
  state = { tab: a.dataset.tab, season, g: a.dataset.tab === 'schools' ? undefined : g };
  writeHash(state);
  render();
});

// ----- Theme -----
document.getElementById('theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('hs-theme', next); } catch { /* ignore */ }
});

// ----- Global school search -----
const input = document.getElementById('search-input');
const list = document.getElementById('search-results');
let directory = null;
let active = -1;

async function search() {
  const q = input.value.trim().toLowerCase();
  if (!q) { list.hidden = true; return; }
  if (!directory) {
    try { directory = (await api.schools()).schools; } catch { list.innerHTML = '<li class="empty">Search unavailable</li>'; list.hidden = false; return; }
  }
  const hits = directory
    .filter((s) => s.name.toLowerCase().includes(q) || (s.city || '').toLowerCase().includes(q))
    .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || b.apps - a.apps)
    .slice(0, 8);
  active = hits.length ? 0 : -1;
  list.innerHTML = hits.length
    ? hits.map((s, i) => `<li><a href="${schoolHref(s.id)}" aria-selected="${i === 0}"><span>${esc(s.name)}</span><span class="muted">${esc(s.city || '')}</span></a></li>`).join('')
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
    catalog = await api.catalog();
  } catch {
    view.innerHTML = '<div class="card notice"><p>Couldn\'t load the catalog.</p><button class="btn" onclick="location.reload()">Try again</button></div>';
    return;
  }
  render();
  api.status().then((s) => {
    if (s?.updatedAt) {
      document.getElementById('status-line').textContent =
        `Data: CIF (cifstate.org) brackets, game data from MaxPreps · updated ${new Date(s.updatedAt).toLocaleString()}`;
    }
  }).catch(() => {});
})();
