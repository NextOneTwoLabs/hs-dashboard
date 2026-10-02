import { esc } from '../util.js';
import { patchFor } from './filters.js';

// Selects live in the filter row (components/filters.js); these are the segmented toggle buttons.

// Each button has an id, so app.js can return focus to it after the re-render (#18 item 2).
export function segmented(key, value, options, label) {
  const buttons = options
    .map(([v, text]) => `<button type="button" id="f-${key}-${esc(v)}" data-set-${key}="${esc(v)}" aria-pressed="${v === value}">${esc(text)}</button>`)
    .join('');
  return `<div class="field seg-field">${label ? `<span class="field-label">${esc(label)}</span>` : ''}<div class="seg" role="group" aria-label="${esc(label || key)}">${buttons}</div></div>`;
}

// Only shown when the catalog publishes more than one gender.
export const genderSeg = (g, catalog) =>
  (catalog.genders || ['b', 'g']).length > 1 ? segmented('g', g, [['b', 'Boys'], ['g', 'Girls']], 'Gender') : '';

// Wire [data-set-key] buttons to setState (the same resets as a select change).
export function bindControls(root, setState) {
  root.querySelectorAll('button').forEach((btn) => {
    const attr = [...btn.attributes].find((a) => a.name.startsWith('data-set-'));
    if (attr) btn.addEventListener('click', () => setState(patchFor(attr.name.slice(9), attr.value)));
  });
}
