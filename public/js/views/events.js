// The Events landing (#30): one card per division tournament in one school year, grouped by state, styled like
// the Schools landing (a "Find an event" band, filters beside the cards, a card grid).
//
// Data: /api/v1/catalog, one request for every state's seasons -> competitions -> divisions (status, champion,
// runner-up, dates, games). Filters (state, school year, status, a text query, a picked school) are in the hash
// (st, season, show, q, school), written with replaceState and no re-render, so the band keeps focus and text;
// the season of play only filters the cards, like the Schools landing's, so it is not in the hash.
//
// Requests (Kongming B1, plan v2): typing filters the cards in the browser and makes none. School suggestions come
// from /search-index, fetched once (api.js keeps it). Only picking one suggestion loads that one school file
// (/schools/{id}), so a query costs at most 1 search-index + 1 school file per pick, whatever it matches.
import { api, errorHtml } from '../api.js';
import { termButtons } from '../components/filters.js';
import { setHead } from '../components/pageHeader.js';
import { eventHref } from '../nav.js';
import { buildIndex, suggest } from '../search.js';
import { esc, fmtDate, isLive, schoolHref } from '../util.js';

const TERM = { fall: 'Fall', winter: 'Winter', spring: 'Spring' };
export const STATUS_LABEL = { complete: 'Complete', unreported: 'Results incomplete', 'in-progress': 'In progress', scheduled: 'Upcoming' };
export const SHOW = [['', 'All'], ['live', 'Live'], ['upcoming', 'Upcoming'], ['complete', 'Complete']];
export const CHIPS = ['Texas', 'CIF State', '6A', 'Division 1'];
const SCHOOLS_MAX = 5;
const ANNOUNCE_MS = 450;
let term = '';   // the season of play: filters the cards only, as on the Schools landing

// Every event of one school year, in states.json order: [{ state, events: [{ comp, div, live }] }].
export function eventsOf(catalog, statesIndex, season) {
  const s = catalog.seasons.find((x) => x.season === season);
  return statesIndex.states.filter((st) => st.latestSeason).map((st) => ({
    state: st,
    events: (s?.competitions || []).filter((c) => c.state === st.code)
      .flatMap((comp) => comp.divisions.map((div) => ({ comp, div, live: isLive(div) }))),
  })).filter((g) => g.events.length);
}

// The status filter: Live while a bracket is being played; Upcoming before it; Complete once it is finished
// (with a champion, or with results the source never reported).
export function statusMatch(ev, show) {
  if (!show) return true;
  if (show === 'live') return ev.live;
  if (show === 'upcoming') return !ev.live && (ev.div.status === 'scheduled' || ev.div.status === 'in-progress');
  if (show === 'complete') return ev.div.status === 'complete' || ev.div.status === 'unreported';
  return true;
}

// The text query matches every word against the event's names: state, association, championship, division and
// its champion or runner-up (so "Mater Dei" finds the events it won). Schools come from the suggestions.
export function textMatch(ev, state, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [state.code, state.name, state.association, state.associationName, ev.comp.label, ev.comp.short,
    ev.div.label, ev.div.code, ev.div.champion?.name, ev.div.runnerUp?.name].filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

// The school part of the Events search (B1): suggestions from the one search index, loaded at most once; a
// school's file only when one is picked. The view uses nothing else to reach schools.
export function schoolFinder(statesIndex) {
  let idx = null;
  let loading = null;
  const load = () => {
    if (idx) return Promise.resolve(idx);
    loading ||= api.searchIndex().then((si) => { idx = buildIndex(si, statesIndex); return idx; })
      .catch(() => { loading = null; return null; });
    return loading;
  };
  return {
    load,
    async suggestions(q) {
      if (String(q || '').trim().length < 2) return [];
      const i = await load();
      return i ? suggest(i, q).items.filter((it) => it.kind === 'school').slice(0, SCHOOLS_MAX).map((it) => it.row) : [];
    },
    pick: (id) => api.school(id),   // the one school file a pick costs
  };
}

// A picked school's events: its appearances in that school year.
export const schoolMatch = (ev, school, season) => !school
  || school.appearances.some((a) => a.season === season && a.competition === ev.comp.id && a.division === ev.div.code);

export function eventCardHtml(state, ev, season) {
  const { comp, div } = ev;
  const href = eventHref({ st: state.code, season, comp: comp.id, div: div.code });
  const dates = div.start ? `${fmtDate(div.start)} – ${fmtDate(div.end)}` : 'Dates to be announced';
  const badge = ev.live ? '<span class="badge live"><span aria-hidden="true">● </span>Live</span>'
    : `<span class="badge status-${esc(div.status)}">${esc(STATUS_LABEL[div.status] || div.status)}</span>`;
  const g = div.gender[0];
  const champ = div.champion
    ? `<p class="event-champ"><span class="trophy">Champion</span><a href="${esc(schoolHref(div.champion.id, g))}">${esc(div.champion.name)}</a>${div.runnerUp ? ` · runner-up ${esc(div.runnerUp.name)}` : ''}</p>`
    : '';
  return `<article class="card state-card event-card">
      <h3><a href="${esc(href)}">${esc(comp.short)} · ${esc(div.label)}</a></h3>
      <p class="muted">${esc(comp.label)} · ${esc(TERM[comp.term] || '')} ${esc(season)}</p>
      <p class="muted event-meta">${badge}<span>${esc(dates)} · ${div.played} of ${div.games} games</span></p>
      ${champ}
      <p class="state-links"><a href="${esc(href)}">Bracket</a><a href="${esc(eventHref({ st: state.code, season, comp: comp.id, div: div.code, view: 'games' }))}">Games</a></p>
    </article>`;
}

function selectHtml(id, key, label, value, options) {
  return `<div class="field"><label for="${id}">${label}</label><select id="${id}" data-filter="${key}">${options
    .map(([v, l]) => `<option value="${esc(v)}"${v === (value || '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
}

export async function render({ state, statesIndex, controls, view, head, setState }) {
  setHead(head, { crumbs: [['Events']], title: 'Events', subtitle: 'State championship tournaments: brackets, games and champions.' });
  controls.innerHTML = '';   // the filters sit beside the cards they filter; the filter row hides
  view.innerHTML = '<div class="card notice">Loading events…</div>';
  let catalog;
  try {
    catalog = await api.catalog();
  } catch (err) {
    view.innerHTML = errorHtml(err);
    return;
  }
  const seasons = catalog.seasons.filter((s) => s.competitions.length).map((s) => s.season);
  const covered = statesIndex.states.filter((s) => s.latestSeason);
  const f = {
    st: covered.some((s) => s.code === state.st) ? state.st : '',
    season: seasons.includes(state.season) ? state.season : catalog.latestSeason,
    show: state.show || '',
    q: state.q || '',
  };
  let school = null;
  if (state.school) {
    try { school = await api.school(state.school); } catch { school = null; }
  }

  view.innerHTML = `<section class="event-search" aria-labelledby="find-event-h">
      <div class="card event-search-card">
        <h2 class="event-search-h" id="find-event-h">Find an event</h2>
        <p class="event-search-lead">Type a state, an association, a division or a school.</p>
        <div class="search" role="search" aria-label="Search events">
          <label class="sr-only" for="event-q">Search events</label>
          <input type="search" class="search-input" id="event-q" value="${esc(f.q)}" placeholder="State, association, division or school…" autocomplete="off" spellcheck="false" aria-describedby="event-q-hint">
          <span class="sr-only" id="event-q-hint">Filters the events below as you type. Schools that match are listed under the box; choose one to see its events.</span>
        </div>
        <div class="event-schools" id="event-schools"></div>
        <div class="chips event-search-chips" id="event-chips" role="group" aria-label="Example searches">${CHIPS.map((c) => `<button type="button" class="chip" data-fill="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      </div>
    </section>
    <div class="landing-browse-row"><h2 class="section-h" id="events-h"></h2><div class="browse-tools">
      ${selectHtml('ev-st', 'st', 'State', f.st, [['', 'All states'], ...covered.map((s) => [s.code, s.name])])}
      ${selectHtml('ev-season', 'season', 'School year', f.season, seasons.map((s) => [s, s]))}
      <div class="field seg-field"><span class="field-label" id="ev-show-label">Status</span><div class="seg" role="group" aria-labelledby="ev-show-label">${SHOW.map(([v, l]) => `<button type="button" id="ev-show-${v || 'all'}" data-show="${v}" aria-pressed="${v === f.show}">${l}</button>`).join('')}</div></div>
      <div id="ev-term">${termButtons(statesIndex, term)}</div>
    </div></div>
    <div id="event-picked"></div>
    <div id="event-groups"></div>
    <span class="sr-only" role="status" id="event-status"></span>`;

  const $ = (sel) => view.querySelector(sel);
  const input = $('#event-q');
  const finder = schoolFinder(statesIndex);
  let timer = null;

  const write = () => setState({ st: f.st || null, season: f.season === catalog.latestSeason ? null : f.season,
    show: f.show || null, q: f.q || null, school: school?.id || null }, { replace: true, silent: true });

  function draw() {
    const groups = eventsOf(catalog, statesIndex, f.season)
      .filter((g) => !f.st || g.state.code === f.st)
      .map((g) => ({ ...g, events: g.events.filter((ev) => (!term || ev.comp.term === term) && statusMatch(ev, f.show)
        && textMatch(ev, g.state, f.q) && schoolMatch(ev, school, f.season)) }))
      .filter((g) => g.events.length);
    const n = groups.reduce((t, g) => t + g.events.length, 0);
    $('#events-h').textContent = `${f.season} events`;
    $('#event-picked').innerHTML = school
      ? `<p class="event-picked">Events of <a href="${esc(schoolHref(school.id))}">${esc(school.name)}</a> <button type="button" class="chip" id="event-unpick"><span aria-hidden="true">✕ </span>Show every school</button></p>`
      : '';
    $('#event-groups').innerHTML = n
      ? groups.map((g) => `<section class="event-state-group" aria-labelledby="ev-${g.state.code}-h">
          <div class="event-state"><h3 id="ev-${g.state.code}-h">${esc(g.state.name)}</h3><span class="muted">${esc(g.state.association)} · ${esc(g.state.terms.map((t) => TERM[t] || t).join(' and '))} season · ${g.events.length} event${g.events.length === 1 ? '' : 's'}</span></div>
          <div class="state-cards" role="list">${g.events.map((ev) => `<div role="listitem">${eventCardHtml(g.state, ev, f.season)}</div>`).join('')}</div>
        </section>`).join('')
      : `<div class="card notice"><p>No events match these filters.</p><button type="button" class="btn" id="event-clear">Clear filters</button></div>`;
    return n;
  }

  function announce(n) {
    clearTimeout(timer);
    timer = setTimeout(() => { const s = $('#event-status'); if (s) s.textContent = `${n} event${n === 1 ? '' : 's'}`; }, ANNOUNCE_MS);
  }

  // School suggestions: from the search index (one request, the first time), never one request per school.
  async function drawSchools() {
    const q = f.q;
    const rows = await finder.suggestions(q);
    const box = $('#event-schools');
    if (!box || q !== f.q) return;   // typing moved on
    box.innerHTML = rows.length
      ? `<p class="event-schools-h" id="event-schools-h">Schools: choose one to see its events</p><ul class="event-schools-list" aria-labelledby="event-schools-h">${rows
        .map((r) => `<li><button type="button" class="chip" data-school="${esc(r.id)}">${esc(r.name)}<span class="muted"> · ${esc([r.city, r.state].filter(Boolean).join(', '))}</span></button></li>`).join('')}</ul>`
      : '';
  }

  async function pick(id) {
    try { school = await finder.pick(id); } catch { return; }   // the one school file this pick costs
    // A school with no event in the shown year opens its latest year with one.
    if (!school.appearances.some((a) => a.season === f.season)) {
      const latest = school.appearances.map((a) => a.season).filter((s) => seasons.includes(s)).sort().at(-1);
      if (latest) { f.season = latest; $('#ev-season').value = latest; }
    }
    f.q = '';
    input.value = '';
    drawSchools();
    write();
    announce(draw());
    $('#event-unpick')?.focus();
  }

  input.addEventListener('focus', () => { finder.load(); });   // the search index, once, ahead of typing
  input.addEventListener('input', () => {
    f.q = input.value;
    write();
    announce(draw());
    drawSchools();
  });
  view.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-filter]');
    if (!sel) return;
    f[sel.dataset.filter] = sel.value;
    write();
    announce(draw());
  });
  view.addEventListener('click', (e) => {
    const t = e.target;
    const showBtn = t.closest('[data-show]');
    if (showBtn) {
      f.show = showBtn.dataset.show;
      view.querySelectorAll('[data-show]').forEach((b) => b.setAttribute('aria-pressed', String(b === showBtn)));
      write();
      announce(draw());
      return;
    }
    const termBtn = t.closest('[data-term]');
    if (termBtn) {
      term = termBtn.dataset.term;
      view.querySelectorAll('[data-term]').forEach((b) => b.setAttribute('aria-pressed', String(b === termBtn)));
      announce(draw());
      return;
    }
    const chip = t.closest('[data-fill]');
    if (chip) {
      input.value = chip.dataset.fill;
      f.q = input.value;
      input.focus();
      write();
      announce(draw());
      drawSchools();
      return;
    }
    const sch = t.closest('[data-school]');
    if (sch) { pick(sch.dataset.school); return; }
    if (t.closest('#event-unpick')) {
      school = null;
      write();
      announce(draw());
      input.focus();
      return;
    }
    if (t.closest('#event-clear')) {
      Object.assign(f, { st: '', show: '', q: '' });
      school = null;
      term = '';
      input.value = '';
      $('#ev-st').value = '';
      view.querySelectorAll('[data-show]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.show === '')));
      view.querySelectorAll('[data-term]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.term === '')));
      drawSchools();
      write();
      announce(draw());
      input.focus();
    }
  });
  draw();
}
