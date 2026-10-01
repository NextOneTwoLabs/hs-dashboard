import { bracketHref, esc, isLive, schoolHref } from '../util.js';

const TERM = { fall: 'Fall', winter: 'Winter', spring: 'Spring' };

// US overview: one card per covered state with its latest champions.
export async function render({ statesIndex, controls, view }) {
  controls.innerHTML = '';
  const covered = statesIndex.states.filter((s) => s.latestSeason);
  const schools = covered.reduce((t, s) => t + s.schools, 0);
  const cards = covered
    .map((s) => {
      const divs = s.latest.flatMap((c) => c.divisions.map((d) => ({ ...d, comp: c.competition, short: c.short })));
      const multi = s.latest.length > 1;
      const live = divs.some((d) => isLive(d));
      const rows = divs
        .map((d) => `<li><a class="muted" href="${bracketHref(s.code, s.latestSeason, d.comp, d.code)}">${multi ? `${esc(d.short)} ` : ''}${esc(d.label)}</a>
          <span>${d.champion ? `<a href="${schoolHref(d.champion.id, 'g')}">${esc(d.champion.name)}</a>` : `<span class="muted">${d.status === 'unreported' ? 'Not reported' : 'In progress'}</span>`}</span></li>`)
        .join('');
      return `<article class="card state-card">
        <header><div><h2><a href="${bracketHref(s.code, s.latestSeason, s.latest[0]?.competition)}">${esc(s.name)}</a></h2>
          <div class="muted">${esc(s.association)} · ${s.terms.map((t) => TERM[t] || t).join(', ')} season</div></div>
          ${live ? '<span class="chip accent">● Live</span>' : ''}</header>
        <div class="state-meta muted">${esc(s.latestSeason)} champions · ${s.seasons.length} season${s.seasons.length === 1 ? '' : 's'} · ${s.schools} schools</div>
        <ul class="champ-list">${rows}</ul>
        <footer><a href="#tab=champions&st=${s.code}">All champions</a><a href="#tab=results&st=${s.code}">Results</a></footer>
      </article>`;
    })
    .join('');
  view.innerHTML = `<div class="page-head"><h1 class="page">State championships</h1>
      <span class="muted">${covered.length} states · ${schools.toLocaleString()} schools · girls soccer · more states coming</span></div>
    <div class="state-grid">${cards}</div>`;
}
