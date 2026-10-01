import { api, errorHtml } from '../api.js';
import { bindControls, genderSeg, seasonSelect, segmented, stateSelect } from '../components/controls.js';
import { bindHighlight, matchCard } from '../components/match.js';
import { bracketHref, esc, fmtLongDate } from '../util.js';

export async function render({ state, catalog, statesIndex, controls, view, setState }) {
  const show = state.show || 'all';
  controls.innerHTML = [
    stateSelect(statesIndex, state.st),
    seasonSelect(catalog, state.season),
    genderSeg(state.g, catalog),
    segmented('show', show, [['all', 'All'], ['results', 'Results'], ['upcoming', 'Upcoming']], 'Show'),
  ].join('');
  bindControls(controls, (patch) => setState(patch.st ? { ...patch, season: null } : patch));
  view.innerHTML = '<div class="card notice">Loading games…</div>';

  let data;
  try {
    data = await api.stateGames(state.st, state.season);
  } catch (err) {
    view.innerHTML = errorHtml(err);
    return;
  }
  const short = Object.fromEntries(catalog.seasons.flatMap((s) => s.competitions.map((c) => [c.id, c.short])));
  const multiComp = new Set(data.games.map((g) => g.competition)).size > 1;
  let games = data.games.filter((g) => (g.gender || 'girls')[0] === state.g);
  if (show === 'results') games = games.filter((g) => g.status === 'final');
  if (show === 'upcoming') games = games.filter((g) => g.status === 'scheduled');
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
          const label = `${multiComp ? `${esc(short[g.competition] || '')} ` : ''}${esc(g.divisionLabel || g.division)}`;
          const top = `<a href="${bracketHref(data.state, data.season, g.competition, g.division)}">${label}</a><span>${esc(g.roundName || '')}</span>`;
          const meta = g.status === 'unreported' ? '<span>Result not reported</span>'
            : g.decidedBy === 'pk' ? '<span>Final</span><span>Decided on PKs</span>' : '';
          return matchCard(g, { g: (g.gender || 'girls')[0], top, meta });
        })
        .join('');
      return `<section class="day"><h3>${esc(date ? fmtLongDate(date) : 'Date TBD')}</h3><div class="cards">${cards}</div></section>`;
    })
    .join('');
  view.innerHTML = `<div class="page-head"><h1 class="page">${esc(catalog.name)} results</h1><span class="muted">${esc(catalog.association)} · ${esc(data.season)} · ${games.length} games</span></div>
    ${html || '<div class="card notice">No games match these filters.</div>'}`;
  bindHighlight(view);
}
