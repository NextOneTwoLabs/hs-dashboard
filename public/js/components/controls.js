import { esc } from '../util.js';

export function seasonSelect(catalog, current, { withAll = false } = {}) {
  const opts = catalog.seasons
    .filter((s) => s.competitions.length)
    .map((s) => `<option value="${esc(s.season)}"${s.season === current ? ' selected' : ''}>${esc(s.season)}</option>`)
    .join('');
  return `<div class="field"><label for="season-select">Season</label>
    <select id="season-select" data-set="season">${withAll ? '<option value="">All seasons</option>' : ''}${opts}</select></div>`;
}

export function segmented(key, value, options, label) {
  const buttons = options
    .map(([v, text]) => `<button type="button" data-set-${key}="${esc(v)}" aria-pressed="${v === value}">${esc(text)}</button>`)
    .join('');
  return `<div class="field">${label ? `<label>${esc(label)}</label>` : ''}<div class="seg" role="group" aria-label="${esc(label || key)}">${buttons}</div></div>`;
}

// Only shown when the catalog publishes more than one gender.
export const genderSeg = (g, catalog) =>
  (catalog.genders || ['b', 'g']).length > 1 ? segmented('g', g, [['b', 'Boys'], ['g', 'Girls']], 'Gender') : '';

// Wire [data-set=key] selects and [data-set-key] buttons to setState.
export function bindControls(root, setState) {
  root.querySelectorAll('select[data-set]').forEach((sel) => {
    sel.addEventListener('change', () => setState({ [sel.dataset.set]: sel.value }));
  });
  root.querySelectorAll('button').forEach((btn) => {
    const attr = [...btn.attributes].find((a) => a.name.startsWith('data-set-'));
    if (attr) btn.addEventListener('click', () => setState({ [attr.name.slice(9)]: attr.value }));
  });
}
