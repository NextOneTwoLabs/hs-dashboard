import { api, errorHtml } from '../api.js';
import { bindFilters, stateSelect } from '../components/filters.js';
import { setHead } from '../components/pageHeader.js';
import { pageOf, resolveTab } from '../nav.js';
import { tableMatch } from '../search.js';
import { readHash } from '../state.js';
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

// The list's state select: a new state keeps the name filter (`q`); with neither, the hash says view=list, so
// the whole list survives a refresh.
export const listPatch = (q) => (key, value) => ({ st: value || null, view: value || q ? null : 'list' });
let listener = null;   // the current render's hs-query handler

export async function render({ state, statesIndex, controls, view, head, setState }) {
  const st = state.st || '';
  // The filter is the header search box (#13): it writes q= here, and the table keeps substring matching.
  let q = state.q || '';
  // The filter row (#20 PR 3): the state; the name filter is the header search box.
  controls.innerHTML = stateSelect(statesIndex, st, { all: true })
    + '<p class="filter-hint">Search by name or city in the box at the top.</p>';
  bindFilters(controls, setState, { patch: (key, value) => listPatch(q)(key, value) });
  setHead(head, { crumbs: [['Teams', '#tab=teams'], ['Schools']], title: 'Schools' });
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
    const rows = data.schools
      .filter((s) => !st || s.state === st)
      .filter((s) => tableMatch(s, q))
      .sort((a, b) => {
        const col = COLS.find((c) => c.key === sort.key);
        const av = a[sort.key] ?? '', bv = b[sort.key] ?? '';
        const d = col.type === 'num' ? av - bv : String(av).localeCompare(String(bv));
        return d * sort.dir || b.apps - a.apps || a.name.localeCompare(b.name);
      });
    const thead = COLS.map((c) => `<th data-sort="${c.key}" class="${c.type === 'num' ? 'n' : ''}"
      aria-sort="${sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}">${c.label}</th>`).join('');
    const body = rows.slice(0, 500).map((s) => `<tr><td><a href="${schoolHref(s.id)}">${esc(s.name)}</a></td><td>${esc(s.city || '')}</td>
      <td>${esc(s.state)}</td><td class="n">${s.apps}</td><td class="n">${s.titles || ''}</td><td class="num">${esc(s.last)}</td></tr>`).join('');
    const more = rows.length > 500 ? `<p class="muted" style="margin-top:10px;font-size:12px">Showing the first 500. Filter by state or name to narrow the list.</p>` : '';
    const stName = statesIndex.states.find((s) => s.code === st)?.name;
    setHead(head, { crumbs: [['Teams', '#tab=teams'], ['Schools']], title: stName ? `${stName} schools` : 'Schools',
      subtitle: `${rows.length.toLocaleString()} of ${data.count.toLocaleString()} schools with a state playoff appearance · ${covered} states covered`
        + (q.trim() ? ` · matching “${esc(q.trim())}” <button type="button" class="clear-search" data-clear-search>Clear search</button>` : '') });
    view.innerHTML = `${favs.length ? `<div class="fav-list"><span class="muted">Following:</span>${favs.map((f) => `<a class="chip accent" href="${schoolHref(f.id)}">★ ${esc(f.name)}</a>`).join('')}</div>` : ''}
      <div class="card table-wrap"><table class="data"><thead><tr>${thead}</tr></thead><tbody>${body || `<tr><td colspan="${COLS.length}" class="cell-empty">No schools match.</td></tr>`}</tbody></table></div>${more}`;
    view.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const key = th.dataset.sort;
      sort = { key, dir: sort.key === key ? -sort.dir : (COLS.find((c) => c.key === key).type === 'num' ? -1 : 1) };
      draw();
    }));
  };
  // Typing in the header box while this view is open (components/searchBox.js).
  const onQuery = (e) => {
    if (pageOf(resolveTab(readHash())) !== 'schools') { window.removeEventListener('hs-query', onQuery); return; }
    q = e.detail || '';
    // With no state and no name this is the whole list (view=list), so a refresh keeps the list.
    setState({ q: q || null, view: q || st ? null : 'list' }, { replace: true, silent: true });
    draw();
  };
  window.removeEventListener('hs-query', listener);
  listener = onQuery;
  window.addEventListener('hs-query', onQuery);
  draw();
}
