import { api, errorHtml } from '../api.js';
import { bindControls, stateSelect } from '../components/controls.js';
import { esc, favorites, schoolHref } from '../util.js';

const COLS = [
  { key: 'name', label: 'School', type: 'text' },
  { key: 'city', label: 'City', type: 'text' },
  { key: 'state', label: 'State', type: 'text' },
  { key: 'apps', label: 'Appearances', type: 'num' },
  { key: 'titles', label: 'Titles', type: 'num' },
  { key: 'last', label: 'Last appearance', type: 'text' },
];
let sort = { key: 'titles', dir: -1 };

export async function render({ state, statesIndex, controls, view, setState }) {
  const st = state.st || '';
  controls.innerHTML = stateSelect(statesIndex, st, { withAll: true })
    + `<div class="field"><label for="filter">Filter</label><input id="filter" class="text-input" type="search" value="${esc(state.q || '')}" placeholder="Name or city"></div>`;
  bindControls(controls, setState);
  const filter = controls.querySelector('#filter');
  view.innerHTML = '<div class="card notice">Loading schools…</div>';
  let data;
  try {
    data = await api.schools();
  } catch (err) {
    view.innerHTML = errorHtml(err);
    return;
  }
  const favs = favorites();
  const covered = statesIndex.states.filter((s) => s.latestSeason).length;
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    const rows = data.schools
      .filter((s) => !st || s.state === st)
      .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.city || '').toLowerCase().includes(q))
      .sort((a, b) => {
        const col = COLS.find((c) => c.key === sort.key);
        const av = a[sort.key] ?? '', bv = b[sort.key] ?? '';
        const d = col.type === 'num' ? av - bv : String(av).localeCompare(String(bv));
        return d * sort.dir || b.apps - a.apps || a.name.localeCompare(b.name);
      });
    const head = COLS.map((c) => `<th data-sort="${c.key}" class="${c.type === 'num' ? 'n' : ''}"
      aria-sort="${sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}">${c.label}</th>`).join('');
    const body = rows.slice(0, 500).map((s) => `<tr><td><a href="${schoolHref(s.id)}">${esc(s.name)}</a></td><td>${esc(s.city || '')}</td>
      <td>${esc(s.state)}</td><td class="n">${s.apps}</td><td class="n">${s.titles || ''}</td><td class="num">${esc(s.last)}</td></tr>`).join('');
    const more = rows.length > 500 ? `<p class="muted" style="margin-top:10px;font-size:12px">Showing the first 500. Filter by state or name to narrow the list.</p>` : '';
    view.innerHTML = `<div class="page-head"><h1 class="page">Schools</h1><span class="muted">${rows.length.toLocaleString()} of ${data.count.toLocaleString()} schools with a state playoff appearance · ${covered} states covered</span></div>
      ${favs.length ? `<div class="fav-list"><span class="muted">Following:</span>${favs.map((f) => `<a class="chip accent" href="${schoolHref(f.id)}">★ ${esc(f.name)}</a>`).join('')}</div>` : ''}
      <div class="card table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${COLS.length}" class="cell-empty">No schools match.</td></tr>`}</tbody></table></div>${more}`;
    view.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const key = th.dataset.sort;
      sort = { key, dir: sort.key === key ? -sort.dir : (COLS.find((c) => c.key === key).type === 'num' ? -1 : 1) };
      draw();
    }));
  };
  filter.addEventListener('input', () => {
    setState({ q: filter.value || null }, { replace: true, silent: true });
    draw();
  });
  draw();
}
