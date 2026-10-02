// The shared match card (#20 PR 4), used by brackets, state Results and a team's Overview and Results.
// - Header: competition · round on the left (wraps), the date on the right (never wraps).
// - Two team rows: seed, name (a link to that team's page), score; the winner in bold; a "PK win" tag when a
//   shootout decided it.
// - Footer: the status (Final, Result not reported, Scheduled, Awaiting result, Bye), then "Match details ↗"
//   (MaxPreps, when the bracket has the match page) and "View in bracket →" (to the exact round).
// - A PK game also says that it counts as a draw in playoff records (the source's convention).
import { esc, localToday, schoolHref } from '../util.js';

export const PK_NOTE = 'Level after full time, decided on penalty kicks · counts as a draw in playoff records';
const todayIso = () => localToday();   // the viewer's local date, not UTC (#24 review)

// What the card says about the game. `today` decides whether a scheduled game's date has passed: then it is
// awaiting a result rather than upcoming.
export function statusOf(game, today = todayIso()) {
  if (game.status === 'bye') return { kind: 'bye', text: 'Bye' };
  if (game.status === 'unreported') return { kind: 'unreported', text: 'Result not reported' };
  if (game.status === 'scheduled') {
    return game.date && game.date < today ? { kind: 'awaiting', text: 'Awaiting result' } : { kind: 'scheduled', text: 'Scheduled' };
  }
  if (game.decidedBy === 'unreported') return { kind: 'final', text: 'Final · score not reported' };
  return { kind: 'final', text: 'Final' };
}

function teamRow(game, side, g, compact) {
  const t = game[side];
  if (!t) {
    const label = game.status === 'bye' ? 'Bye' : 'To be decided';
    return `<div class="team-row tbd"><span class="seed"></span><span class="tname">${label}</span><span class="score"></span></div>`;
  }
  const id = t.id ?? t.schoolId;
  const name = id ? `<a class="tname" href="${schoolHref(id, g)}" title="${esc(t.name)}">${esc(t.name)}</a>` : `<span class="tname">${esc(t.name)}</span>`;
  if (game.status === 'bye') {
    return `<div class="team-row" data-school="${esc(id || '')}"><span class="seed">${esc(t.seed ?? '')}</span>${name}<span class="score"></span></div>`;
  }
  const cls = game.winner ? (game.winner === side ? 'win' : 'lose') : '';
  // The tag says it in words; brackets are narrow, so there it is "PK" with the same hidden text.
  const pk = game.decidedBy === 'pk' && game.winner === side
    ? `<span class="pk">${compact ? 'PK' : 'PK win'}<span class="sr-only"> (won on penalty kicks)</span></span>` : '';
  const score = t.score ?? (game.status === 'final' && game.winner === side ? 'W' : '');
  return `<div class="team-row ${cls}" data-school="${esc(id || '')}">
    <span class="seed">${esc(t.seed ?? '')}</span>${name}<span class="score">${esc(score)}${pk}</span></div>`;
}

// head: the header's left part (HTML the caller escaped), e.g. "State · Division 1 · Regional Semifinals".
// date: shown on the right. bracket: a "View in bracket" href. compact: the narrow bracket card.
export function matchCard(game, { head = '', date = '', g = null, bracket = null, compact = false, today } = {}) {
  const ids = [game.top, game.bottom].map((t) => t?.id ?? t?.schoolId).filter(Boolean).join(' ');
  const status = statusOf(game, today);
  const links = [
    game.matchUrl ? `<a href="${esc(game.matchUrl)}" rel="noopener" target="_blank">${compact ? 'Details' : 'Match details'} <span aria-hidden="true">↗</span></a>` : '',
    bracket ? `<a href="${esc(bracket)}">View in bracket <span aria-hidden="true">→</span></a>` : '',
  ].filter(Boolean).join('');
  return `<div class="match" data-schools="${esc(ids)}">
    ${head || date ? `<div class="match-top"><span class="match-head">${head}</span>${date ? `<span class="match-date">${esc(date)}</span>` : ''}</div>` : ''}
    ${teamRow(game, 'top', g, compact)}${teamRow(game, 'bottom', g, compact)}
    <div class="match-foot"><span class="match-status status-${status.kind}">${esc(status.text)}</span>${links ? `<span class="match-links">${links}</span>` : ''}</div>
    ${game.decidedBy === 'pk' && status.kind === 'final' ? `<div class="match-note">${esc(PK_NOTE)}</div>` : ''}
  </div>`;
}

// Hovering a team highlights every match that school played.
export function bindHighlight(root) {
  const clear = () => root.querySelectorAll('.hl').forEach((el) => el.classList.remove('hl'));
  root.addEventListener('mouseover', (e) => {
    const row = e.target.closest('.team-row[data-school]');
    clear();
    const id = row?.dataset.school;
    if (!id) return;
    root.querySelectorAll('.match').forEach((m) => {
      if (m.dataset.schools.split(' ').includes(id)) m.classList.add('hl');
    });
    root.querySelectorAll(`.team-row[data-school="${CSS.escape(id)}"]`).forEach((r) => r.classList.add('hl'));
  });
  root.addEventListener('mouseleave', clear);
}
