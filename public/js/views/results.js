import { api, errorHtml } from '../api.js';
import { bindControls, genderSeg, seasonSelect, segmented } from '../components/controls.js';
import { bindHighlight, matchCard } from '../components/match.js';
import { divShort, esc, fmtLongDate } from '../util.js';

export async function render({ state, catalog, controls, view, setState }) {
  const show = state.show || 'all';
  controls.innerHTML = [
    seasonSelect(catalog, state.season),
    genderSeg(state.g, catalog),
    segmented('show', show, [['all', 'All'], ['results', 'Results'], ['upcoming', 'Upcoming']], 'Show'),
  ].join('');
  bindControls(controls, setState);
  view.innerHTML = '<div class="card notice">Loading games…</div>';

  let data;
  try {
    data = await api.games(state.season);
  } catch (err) {
    view.innerHTML = errorHtml(err);
    return;
  }
  const comps = catalog.competitions;
  let games = data.games.filter((g) => g.division[0] === state.g);
  if (show === 'results') games = games.filter((g) => g.status === 'final');
  if (show === 'upcoming') games = games.filter((g) => g.status !== 'final');
  const days = new Map();
  for (const g of games) (days.get(g.date) || days.set(g.date, []).get(g.date)).push(g);
  const order = [...days.keys()].sort();
  if (show !== 'upcoming') order.reverse(); // most recent results first

  const html = order
    .map((date) => {
      const cards = days
        .get(date)
        .sort((a, b) => a.division.localeCompare(b.division) || a.competition.localeCompare(b.competition))
        .map((g) => {
          const href = `#tab=playoffs&season=${data.season}&comp=${g.competition}&g=${g.division[0]}&div=${g.division}`;
          const top = `<a href="${href}">${esc(comps[g.competition]?.short || '')} ${divShort(g.division)}</a><span>${esc(g.roundName || '')}</span>`;
          return matchCard(g, { g: g.division[0], top, meta: g.decidedBy === 'pk' ? '<span>Final</span><span>Decided on PKs</span>' : '' });
        })
        .join('');
      return `<section class="day"><h3>${esc(date ? fmtLongDate(date) : 'Date TBD')}</h3><div class="cards">${cards}</div></section>`;
    })
    .join('');
  view.innerHTML = `<div class="page-head"><h1 class="page">${state.g === 'b' ? 'Boys' : 'Girls'} results</h1><span class="muted">${esc(data.season)} · ${games.length} games</span></div>
    ${html || '<div class="card notice">No games match these filters.</div>'}`;
  bindHighlight(view);
}
