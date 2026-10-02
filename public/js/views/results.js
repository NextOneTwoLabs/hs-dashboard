import { api, errorHtml } from '../api.js';
import { bindControls, genderSeg } from '../components/controls.js';
import { bindFilters, seasonSelect, showSelect, stateSelect, termNote } from '../components/filters.js';
import { bindHighlight, matchCard } from '../components/match.js';
import { setHead } from '../components/pageHeader.js';
import { eventsHref } from '../nav.js';
import { bracketHref, esc, fmtLongDate } from '../util.js';

export async function render({ state, catalog, statesIndex, controls, view, head, setState }) {
  const show = state.show || 'all';
  // The filter row (#20 PR 3): state, school year, which games; the season of play as text.
  controls.innerHTML = [
    stateSelect(statesIndex, state.st),
    seasonSelect(catalog, state.season),
    showSelect(state.show),
    genderSeg(state.g, catalog),
    termNote(statesIndex, state.st),
  ].join('');
  bindFilters(controls, setState);
  bindControls(controls, setState);
  // Events › All games (#30; was Results): Events › the state's events › the school year's games.
  const crumbs = [['Events', '#tab=events'], [catalog.name, eventsHref('events', { st: state.st })], [`${state.season} games`]];
  setHead(head, { crumbs, title: `${catalog.name} games`, subtitle: `${esc(catalog.association)} · ${esc(state.season)}` });
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
          // The shared card (#20 PR 4): competition · round in the header (the day is the section heading),
          // status in the footer, and "View in bracket" to the game's round.
          return matchCard(g, { g: (g.gender || 'girls')[0], head: `${label}${g.roundName ? ` · ${esc(g.roundName)}` : ''}`,
            bracket: bracketHref(data.state, data.season, g.competition, g.division, g.round) });
        })
        .join('');
      return `<section class="day"><h3>${esc(date ? fmtLongDate(date) : 'Date TBD')}</h3><div class="cards">${cards}</div></section>`;
    })
    .join('');
  setHead(head, { crumbs, title: `${catalog.name} games`,
    subtitle: `${esc(catalog.association)} · ${esc(data.season)} · ${games.length} games` });
  view.innerHTML = html || '<div class="card notice">No games match these filters.</div>';
  bindHighlight(view);
}
