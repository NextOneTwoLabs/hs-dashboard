import { bindControls, genderSeg } from '../components/controls.js';
import { bindFilters, stateSelect, termNote } from '../components/filters.js';
import { setHead } from '../components/pageHeader.js';
import { hrefFor } from '../nav.js';
import { bracketHref, esc, schoolHref } from '../util.js';

// Season-by-season grid of a state's champions, one column per division.
export async function render({ state, catalog, statesIndex, controls, view, head, setState }) {
  // The filter row (#20 PR 3): every school year is in the grid, so only the state (and gender) filter it.
  controls.innerHTML = stateSelect(statesIndex, state.st) + genderSeg(state.g, catalog) + termNote(statesIndex, state.st);
  bindFilters(controls, setState);
  bindControls(controls, setState);
  setHead(head, {
    crumbs: [['All states', '#tab=schools'], [catalog.name, hrefFor({ tab: 'playoffs', st: state.st })], ['Champions']],
    title: `${catalog.name} champions`,
    subtitle: `${esc(catalog.associationName)} (${esc(catalog.association)})`,
  });

  // Columns: every division code seen, ordered by its most recent position.
  const columns = new Map();
  const rows = [];
  for (const s of catalog.seasons) {
    if (!s.competitions.length) {
      if (s.note) rows.push({ season: s.season, note: s.note });
      continue;
    }
    for (const c of s.competitions) {
      const divs = new Map(c.divisions.filter((d) => d.gender[0] === state.g).map((d) => [d.code, d]));
      for (const d of divs.values()) if (!columns.has(d.code)) columns.set(d.code, d);
      rows.push({ season: s.season, comp: c, divs });
    }
  }
  const cols = [...columns.values()].sort((a, b) => a.order - b.order);
  const multiComp = new Set(rows.filter((r) => r.comp).map((r) => r.comp.id)).size > 1;
  const thead = `<tr><th>Season</th>${multiComp ? '<th>Championship</th>' : ''}${cols.map((d) => `<th>${esc(d.label)}</th>`).join('')}</tr>`;
  const body = rows
    .map((r) => {
      if (r.note) return `<tr><td class="num">${esc(r.season)}</td><td colspan="${cols.length + (multiComp ? 1 : 0)}" class="cell-empty">${esc(r.note)}</td></tr>`;
      const cells = cols
        .map((col) => {
          const d = r.divs.get(col.code);
          if (!d) return '<td class="cell-empty">—</td>';
          const link = bracketHref(state.st, r.season, r.comp.id, d.code);
          if (!d.champion) {
            const text = d.status === 'scheduled' ? 'Scheduled' : d.status === 'unreported' ? 'Not reported' : 'In progress';
            return `<td><a href="${link}">${text}</a></td>`;
          }
          return `<td><div class="cell-champ"><a href="${schoolHref(d.champion.id, state.g)}">${esc(d.champion.name)}</a></div>
            <div class="cell-runner">def. ${d.runnerUp ? `<a href="${schoolHref(d.runnerUp.id, state.g)}" class="muted">${esc(d.runnerUp.name)}</a>` : '—'} · <a href="${link}" class="muted">bracket</a></div></td>`;
        })
        .join('');
      return `<tr><td class="num">${esc(r.season)}</td>${multiComp ? `<td>${esc(r.comp.short)}</td>` : ''}${cells}</tr>`;
    })
    .join('');
  view.innerHTML = `<div class="card table-wrap"><table class="data"><thead>${thead}</thead><tbody>${body}</tbody></table></div>`;
}
