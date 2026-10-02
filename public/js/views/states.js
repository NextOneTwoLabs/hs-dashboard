import { setHead } from '../components/pageHeader.js';
import { bracketCount, statePills, termPills } from '../components/sidebar.js';
import { hrefFor, listHref } from '../nav.js';
import { bracketHref, esc, fmtDate, isLive, schoolHref } from '../util.js';

const TERM = { fall: 'Fall', winter: 'Winter', spring: 'Spring' };
let term = '';   // the season-of-play filter only filters this page, so it is not in the hash

// US overview: one card per covered state (collegedash card, neutral band) with its latest champions.
export async function render({ statesIndex, controls, view, head }) {
  const covered = statesIndex.states.filter((s) => s.latestSeason);
  const draw = () => {
    const list = covered.filter((s) => !term || s.terms.includes(term));
    const schools = list.reduce((t, s) => t + s.schools, 0);
    const seasons = [...new Set(list.map((s) => s.latestSeason))].sort().reverse();
    // A state pill opens that state's brackets (owner decision on #5).
    controls.innerHTML = termPills(statesIndex, term)
      + statePills(statesIndex, null, (code) => hrefFor({ tab: 'playoffs', st: code }), { all: hrefFor({ tab: 'teams' }) })
      + '<p class="side-note">Counts are brackets in each state\'s latest season. A state opens its brackets.</p>';
    controls.querySelectorAll('[data-term]').forEach((b) => b.addEventListener('click', () => { term = b.dataset.term; draw(); }));
    setHead(head, {
      crumbs: [['Teams']],
      title: 'State championships',
      subtitle: `Girls soccer · ${list.length} of ${covered.length} states · ${schools.toLocaleString()} schools${seasons.length ? ` · ${esc(seasons.join(', '))}` : ''}`,
      // The whole school list stays one link away (an old plain Schools link opens it too).
      right: `<a href="${listHref()}">All ${covered.reduce((t, s) => t + s.schools, 0).toLocaleString()} schools <span aria-hidden="true">→</span></a>`,
    });
    view.innerHTML = `<div class="grid cards">${list.map(card).join('')}</div>`;
  };
  draw();
}

function card(s) {
  const divs = s.latest.flatMap((c) => c.divisions.map((d) => ({ ...d, comp: c.competition, short: c.short })));
  const multi = s.latest.length > 1;
  const live = divs.some((d) => isLive(d));
  const ends = divs.map((d) => d.end).filter(Boolean).sort();
  const rows = divs
    .map((d) => `<li><a class="d" href="${bracketHref(s.code, s.latestSeason, d.comp, d.code)}">${multi ? `${esc(d.short)} ` : ''}${esc(d.label)}</a>
      <span class="c">${d.champion ? `<a href="${schoolHref(d.champion.id, 'g')}">${esc(d.champion.name)}</a>` : `<span class="d">${d.status === 'unreported' ? 'Not reported' : 'In progress'}</span>`}</span></li>`)
    .join('');
  const n = bracketCount(s);
  return `<article class="card pcard">
    <div class="band"><h2><a href="${hrefFor({ tab: 'playoffs', st: s.code })}">${esc(s.name)}</a><span class="nick">${esc(s.associationName || s.association)}</span></h2>
      <span class="badges"><span class="badge">${esc(s.terms.map((t) => TERM[t] || t).join(', '))} · ${esc(s.association)}</span>${live ? '<span class="badge live"><span aria-hidden="true">● </span>Live</span>' : ''}</span></div>
    <div class="stripe" aria-hidden="true"></div>
    <div class="body">
      <div class="meta">${esc(s.latestSeason)} champions</div>
      <div class="facts">
        <div><div class="label">Brackets</div><div class="value">${n}</div></div>
        <div><div class="label">Schools</div><div class="value">${s.schools.toLocaleString()}</div></div>
        <div><div class="label">Seasons</div><div class="value">${s.seasons.length}</div></div>
        <div><div class="label">Last final</div><div class="value">${esc(fmtDate(ends.at(-1)) || '—')}</div></div>
      </div>
      <ul class="champ-list">${rows}</ul>
    </div>
    <div class="foot"><span><a href="${listHref({ st: s.code })}">Schools</a> · <a href="${hrefFor({ tab: 'playoffs', view: 'champions', st: s.code })}">All champions</a> · <a href="#tab=results&st=${s.code}">Results</a></span>
      <a href="${hrefFor({ tab: 'playoffs', st: s.code })}">Brackets →</a></div>
  </article>`;
}
