import { esc, schoolHref } from '../util.js';

function teamRow(game, side, g) {
  const t = game[side];
  if (!t) {
    const label = game.status === 'bye' ? 'Bye' : 'TBD';
    return `<div class="team-row tbd"><span class="seed"></span><span class="tname">${label}</span><span class="score"></span></div>`;
  }
  if (game.status === 'bye') {
    const id = t.id ?? t.schoolId;
    const name = id ? `<a class="tname" href="${schoolHref(id, g)}" title="${esc(t.name)}">${esc(t.name)}</a>` : `<span class="tname">${esc(t.name)}</span>`;
    return `<div class="team-row" data-school="${esc(id || '')}"><span class="seed">${esc(t.seed ?? '')}</span>${name}<span class="score"></span></div>`;
  }
  const cls = game.winner ? (game.winner === side ? 'win' : 'lose') : '';
  const id = t.id ?? t.schoolId;
  const name = id ? `<a class="tname" href="${schoolHref(id, g)}" title="${esc(t.name)}">${esc(t.name)}</a>` : `<span class="tname">${esc(t.name)}</span>`;
  const pk = game.decidedBy === 'pk' && game.winner === side ? '<span class="pk" title="Won on penalty kicks">PK</span>' : '';
  const score = t.score ?? (game.status === 'final' && game.winner === side ? 'W' : '');
  return `<div class="team-row ${cls}" data-school="${esc(id || '')}">
    <span class="seed">${esc(t.seed ?? '')}</span>${name}<span class="score">${esc(score)}${pk}</span></div>`;
}

export function matchCard(game, { top = '', meta = '', g = null } = {}) {
  const ids = [game.top, game.bottom].map((t) => t?.id ?? t?.schoolId).filter(Boolean).join(' ');
  return `<div class="match" data-schools="${esc(ids)}">
    ${top ? `<div class="match-top">${top}</div>` : ''}
    ${teamRow(game, 'top', g)}${teamRow(game, 'bottom', g)}
    ${meta ? `<div class="match-meta">${meta}</div>` : ''}
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
