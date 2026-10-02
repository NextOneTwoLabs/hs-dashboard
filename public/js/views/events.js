// The Events landing (#30): one card per division tournament in one school year, grouped by state, styled like
// the Schools landing (filters beside the cards, a card grid). Since #31 PR 2 the header search finds events
// (its Events group), so the page has no "Find an event" band and no text filter.
//
// Data: /api/v1/catalog, one request for every state's seasons -> competitions -> divisions (status, champion,
// runner-up, dates, games). Filters (state, school year, status, a school from a link such as a school page's
// "This school's events →") are in the hash (st, season, show, school), written with replaceState and no
// re-render, so a control keeps focus; the season of play only filters the cards, like the Schools landing's, so
// it is not in the hash. A school costs its one file (/schools/{id}).
import { api, errorHtml } from '../api.js';
import { termButtons } from '../components/filters.js';
import { setHead } from '../components/pageHeader.js';
import { eventHref } from '../nav.js';
import { esc, fmtDate, isLive, schoolHref } from '../util.js';

const TERM = { fall: 'Fall', winter: 'Winter', spring: 'Spring' };
export const STATUS_LABEL = { complete: 'Complete', unreported: 'Results incomplete', 'in-progress': 'In progress', scheduled: 'Upcoming' };
export const SHOW = [['', 'All'], ['live', 'Live'], ['upcoming', 'Upcoming'], ['complete', 'Complete']];
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

// A school's events: its appearances in that school year.
export const schoolMatch = (ev, school, season) => !school
  || school.appearances.some((a) => a.season === season && a.competition === ev.comp.id && a.division === ev.div.code);

// The school year to show for a school from a link with no season: the newest year if the school played in it,
// else its latest year with an event, so "This school's events →" never opens an empty page.
export function schoolSeason(school, seasons, latest) {
  if (!school || school.appearances.some((a) => a.season === latest)) return latest;
  return school.appearances.map((a) => a.season).filter((s) => seasons.includes(s)).sort().at(-1) || latest;
}

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
  let school = null;
  if (state.school) {
    try { school = await api.school(state.school); } catch { school = null; }
  }
  const f = {
    st: covered.some((s) => s.code === state.st) ? state.st : '',
    season: seasons.includes(state.season) ? state.season : schoolSeason(school, seasons, catalog.latestSeason),
    show: state.show || '',
  };

  view.innerHTML = `<div class="landing-browse-row"><h2 class="section-h" id="events-h"></h2><div class="browse-tools">
      ${selectHtml('ev-st', 'st', 'State', f.st, [['', 'All states'], ...covered.map((s) => [s.code, s.name])])}
      ${selectHtml('ev-season', 'season', 'School year', f.season, seasons.map((s) => [s, s]))}
      <div class="field seg-field"><span class="field-label" id="ev-show-label">Status</span><div class="seg" role="group" aria-labelledby="ev-show-label">${SHOW.map(([v, l]) => `<button type="button" id="ev-show-${v || 'all'}" data-show="${v}" aria-pressed="${v === f.show}">${l}</button>`).join('')}</div></div>
      <div id="ev-term">${termButtons(statesIndex, term)}</div>
    </div></div>
    <div id="event-picked"></div>
    <div id="event-groups"></div>
    <span class="sr-only" role="status" id="event-status"></span>`;

  const $ = (sel) => view.querySelector(sel);
  let timer = null;

  const write = () => setState({ st: f.st || null, season: f.season === catalog.latestSeason ? null : f.season,
    show: f.show || null, school: school?.id || null }, { replace: true, silent: true });

  function draw() {
    const groups = eventsOf(catalog, statesIndex, f.season)
      .filter((g) => !f.st || g.state.code === f.st)
      .map((g) => ({ ...g, events: g.events.filter((ev) => (!term || ev.comp.term === term) && statusMatch(ev, f.show)
        && schoolMatch(ev, school, f.season)) }))
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
    // The removed button took focus with it: focus goes to the first filter.
    if (t.closest('#event-unpick')) {
      school = null;
      write();
      announce(draw());
      $('#ev-st').focus();
      return;
    }
    if (t.closest('#event-clear')) {
      Object.assign(f, { st: '', show: '' });
      school = null;
      term = '';
      $('#ev-st').value = '';
      view.querySelectorAll('[data-show]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.show === '')));
      view.querySelectorAll('[data-term]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.term === '')));
      write();
      announce(draw());
      $('#ev-st').focus();
    }
  });
  draw();
}
