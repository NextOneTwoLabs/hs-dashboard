import { api, errorHtml } from '../api.js';
import { bindControls, segmented } from '../components/controls.js';
import { esc, favorites, schoolHref } from '../util.js';

const COLS = [
  { key: 'name', label: 'School', type: 'text' },
  { key: 'city', label: 'City', type: 'text' },
  { key: 'apps', label: 'Appearances', type: 'num' },
  { key: 'titles', label: 'Titles', type: 'num' },
  { key: 'last', label: 'Last appearance', type: 'text' },
];
let sort = { key: 'titles', dir: -1 };

export async function render({ state, catalog, controls, view, setState }) {
  const multi = (catalog.genders || ['b', 'g']).length > 1;
  const g = multi ? state.g || 'all' : 'all';
  controls.innerHTML = (multi ? segmented('g', g, [['all', 'All'], ['b', 'Boys'], ['g', 'Girls']], 'Program') : '')
    + `<div class="field"><label for="filter">Filter</label><input id="filter" type="search" value="${esc(state.q || '')}" placeholder="Name or city"
        style="height:32px;padding:0 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-surface-alt);color:var(--text-primary);font:inherit"></div>`;
  bindControls(controls, (p) => setState({ ...p, g: p.g === 'all' ? null : p.g }));
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
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    const rows = data.schools
      .filter((s) => g === 'all' || s.gender.includes(g))
      .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.city || '').toLowerCase().includes(q))
      .sort((a, b) => {
        const col = COLS.find((c) => c.key === sort.key);
        const av = a[sort.key] ?? '', bv = b[sort.key] ?? '';
        const d = col.type === 'num' ? av - bv : String(av).localeCompare(String(bv));
        return d * sort.dir || b.apps - a.apps || a.name.localeCompare(b.name);
      });
    const head = COLS.map((c) => `<th data-sort="${c.key}" class="${c.type === 'num' ? 'n' : ''}"
      aria-sort="${sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}">${c.label}</th>`).join('');
    const body = rows.slice(0, 400).map((s) => `<tr><td><a href="${schoolHref(s.id)}">${esc(s.name)}</a></td><td>${esc(s.city || '')}</td>
      <td class="n">${s.apps}</td><td class="n">${s.titles || ''}</td><td class="num">${esc(s.last)}</td></tr>`).join('');
    view.innerHTML = `<div class="page-head"><h1 class="page">Schools</h1><span class="muted">${rows.length} of ${data.count} schools with a state playoff appearance · California only so far</span></div>
      ${favs.length ? `<div class="fav-list"><span class="muted">Following:</span>${favs.map((f) => `<a class="chip accent" href="${schoolHref(f.id)}">★ ${esc(f.name)}</a>`).join('')}</div>` : ''}
      <div class="card table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="5" class="cell-empty">No schools match.</td></tr>'}</tbody></table></div>`;
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
