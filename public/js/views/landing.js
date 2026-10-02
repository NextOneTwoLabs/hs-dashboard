// The Schools landing (#20 PR 5; "Schools" and the search on this page since #26): return to followed schools
// and browse by state. The "Find a school" search band above this page is index.html's #school-search, owned by
// components/searchBox.js: no view writes into it, so typed text and focus survive the move to the list. With
// st/q/view=list the Schools tab is the school list instead (views/schools.js).
import { termButtons } from '../components/filters.js';
import { setHead } from '../components/pageHeader.js';
import { eventsHref, listHref, teamHref } from '../nav.js';
import { bracketCount, esc, favorites, isLive } from '../util.js';

const TERM = { fall: 'Fall', winter: 'Winter', spring: 'Spring' };
export const FOLLOW_NOTE = 'Followed schools are saved in this browser only. Clearing site data, private browsing or another device starts empty. Use ☆ Follow on any school page.';
let term = '';   // the season-of-play filter only filters this page's state cards, so it is not in the hash

// "Followed schools": links back to each school's page, and how following is kept.
export function followedHtml(favs) {
  const list = favs.length
    ? `<ul class="followed">${favs.map((f) => `<li><a href="${esc(teamHref(f.id))}"><span class="crest crest-sm" aria-hidden="true">${esc(initials(f.name))}</span>${esc(f.name)}</a></li>`).join('')}</ul>`
    : '<p class="muted">No followed schools yet.</p>';
  return `<section class="card card-pad landing-followed" aria-labelledby="followed-h">
      <h2 class="landing-h" id="followed-h">Followed schools</h2>${list}
      <p class="note">${esc(FOLLOW_NOTE)}</p>
    </section>`;
}

// "Browse by state": one compact card per covered state; every number says what it counts.
export function stateCardHtml(s) {
  const live = s.latest.some((c) => c.divisions.some((d) => isLive(d)));
  const n = bracketCount(s);
  return `<article class="card state-card">
      <h3><a href="${esc(listHref({ st: s.code }))}">${esc(s.name)}</a>${live ? ' <span class="badge live"><span aria-hidden="true">● </span>Live</span>' : ''}</h3>
      <p class="muted">${esc(s.association)} · ${esc(s.terms.map((t) => TERM[t] || t).join(' and '))} season</p>
      <p class="muted">${s.schools.toLocaleString()} schools in playoff records · ${n} bracket${n === 1 ? '' : 's'} in ${esc(s.latestSeason)}</p>
      <p class="state-links"><a href="${esc(listHref({ st: s.code }))}">Schools</a><a href="${esc(eventsHref('events', { st: s.code }))}">Events</a><a href="${esc(eventsHref('champions', { st: s.code }))}">Champions</a><a href="${esc(eventsHref('games', { st: s.code }))}">Games</a></p>
    </article>`;
}

const initials = (name) => name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export async function render({ statesIndex, controls, view, head }) {
  const covered = statesIndex.states.filter((s) => s.latestSeason);
  const total = covered.reduce((t, s) => t + s.schools, 0);
  setHead(head, {
    crumbs: [['Schools']],
    title: 'Schools',
    subtitle: 'Find a girls soccer program and its playoff record.',
    // The whole school list stays one link away (a pre-#20 bare Schools link opens this landing, #26).
    right: `<a href="${listHref()}">All ${total.toLocaleString()} schools <span aria-hidden="true">→</span></a>`,
  });
  // The season of play filters only the state cards, so its toggle sits beside them ("filters next to the content
  // they filter"); the page's filter row stays empty and hides.
  controls.innerHTML = '';
  const draw = (focusId = null) => {
    const list = covered.filter((s) => !term || s.terms.includes(term));
    view.innerHTML = `<div class="landing-top">${followedHtml(favorites())}</div>
      <div class="landing-browse-row"><h2 class="section-h" id="browse-h">Browse by state</h2>${termButtons(statesIndex, term)}</div>
      <div class="state-cards" role="list" aria-labelledby="browse-h">${list.map((s) => `<div role="listitem">${stateCardHtml(s)}</div>`).join('')}</div>
      <p class="note">Each state is covered from its state association's championship brackets. A school appears here once it has a state playoff game on record.</p>`;
    view.querySelectorAll('[data-term]').forEach((b) => b.addEventListener('click', () => {
      term = b.dataset.term;
      draw(b.id);   // the pressed button keeps focus after the cards re-render (#18 item 2)
    }));
    if (focusId) view.querySelector(`#${focusId}`)?.focus();
  };
  draw();
}
