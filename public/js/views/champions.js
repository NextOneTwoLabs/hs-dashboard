import { bindControls, genderSeg } from '../components/controls.js';
import { esc, schoolHref } from '../util.js';

// Season-by-season grid of champions per division, straight from the catalog.
export async function render({ state, catalog, controls, view, setState }) {
  controls.innerHTML = genderSeg(state.g, catalog);
  bindControls(controls, setState);

  const rows = [];
  let maxLevel = 0;
  for (const s of catalog.seasons) {
    if (!s.competitions.length) {
      if (s.note) rows.push({ season: s.season, note: s.note });
      continue;
    }
    for (const c of s.competitions) {
      const divs = new Map(c.divisions.filter((d) => d.gender[0] === state.g).map((d) => [d.level, d]));
      maxLevel = Math.max(maxLevel, ...divs.keys());
      rows.push({ season: s.season, comp: c, divs });
    }
  }
  const levels = Array.from({ length: maxLevel }, (_, i) => i + 1);
  const head = `<tr><th>Season</th><th>Championship</th>${levels.map((l) => `<th>Division ${l}</th>`).join('')}</tr>`;
  const body = rows
    .map((r) => {
      if (r.note) return `<tr><td>${esc(r.season)}</td><td colspan="${levels.length + 1}" class="cell-empty">${esc(r.note)}</td></tr>`;
      const cells = levels
        .map((l) => {
          const d = r.divs.get(l);
          if (!d) return '<td class="cell-empty">—</td>';
          const link = `#tab=playoffs&season=${r.season}&comp=${r.comp.id}&g=${state.g}&div=${d.code}`;
          if (!d.champion) return `<td><a href="${link}">${d.status === 'scheduled' ? 'Scheduled' : 'In progress'}</a></td>`;
          return `<td><div class="cell-champ"><a href="${schoolHref(d.champion.id, state.g)}">${esc(d.champion.name)}</a></div>
            <div class="cell-runner">def. ${d.runnerUp ? `<a href="${schoolHref(d.runnerUp.id, state.g)}" class="muted">${esc(d.runnerUp.name)}</a>` : '—'} · <a href="${link}" class="muted">bracket</a></div></td>`;
        })
        .join('');
      return `<tr><td class="num">${esc(r.season)}</td><td>${esc(r.comp.short)}</td>${cells}</tr>`;
    })
    .join('');
  view.innerHTML = `<div class="page-head"><h1 class="page">${state.g === 'b' ? 'Boys' : 'Girls'} champions</h1>
      <span class="muted">CIF State (2026–) and NorCal / SoCal Regional (2018–2025)</span></div>
    <div class="card table-wrap"><table class="data"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}
