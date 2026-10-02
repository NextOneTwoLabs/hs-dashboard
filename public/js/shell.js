// Page shell: the filter row's phone disclosure (#20 PR 3) and "Data updated" in the header.
// The statewide sidebar and its phone drawer are gone: filters sit in a row above the content they filter.
// On phones the row collapses to a "Filters" button that summarises the selection and expands the panel.
import { api } from './api.js';

const bar = document.getElementById('filter-bar');
const toggle = document.getElementById('filter-toggle');

export const filtersOpen = () => bar.classList.contains('open');

export function setFiltersOpen(open, { restore = false } = {}) {
  bar.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', String(open));
  if (!open && restore) toggle.focus({ preventScroll: true });
}

// Focus stays on the toggle when the panel opens or closes (a disclosure, not a dialog).
toggle.addEventListener('click', () => setFiltersOpen(!filtersOpen()));
// Escape on the toggle or inside the open panel closes it and returns focus to the toggle.
bar.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && filtersOpen()) { e.preventDefault(); setFiltersOpen(false, { restore: true }); }
});

api.status().then((s) => {
  if (s?.updatedAt) {
    // One text, two places: the header, or (CSS, narrow screens) the footer; never both visible (#11).
    const text = `Data updated ${new Date(s.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    document.getElementById('data-updated').textContent = text;
    document.getElementById('data-updated-foot').textContent = `${text}.`;
  }
}).catch(() => {});
