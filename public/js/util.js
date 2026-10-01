const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function fmtDate(iso, opts = { month: 'short', day: 'numeric' }) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
}

export const fmtLongDate = (iso) => fmtDate(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export const divShort = (code) => `D${code.slice(2)}`;
export const genderLabel = (g) => (g === 'b' || g === 'boys' ? 'Boys' : 'Girls');

export const RESULT_LABEL = {
  champion: 'Champion',
  'runner-up': 'Runner-up',
  eliminated: 'Eliminated',
  alive: 'Still alive',
};

export function resultText(app) {
  if (app.result === 'eliminated') return `Lost in ${app.reached}`;
  return RESULT_LABEL[app.result] || app.result;
}

export const schoolHref = (id, g) => `#tab=school&school=${encodeURIComponent(id)}${g ? `&g=${g}` : ''}`;

export function seasonLabel(season) {
  return season;
}

export function favorites() {
  try { return JSON.parse(localStorage.getItem('hs-favorites') || '[]'); } catch { return []; }
}
export function toggleFavorite(school) {
  const favs = favorites().filter((f) => f.id !== school.id);
  const on = favs.length === favorites().length;
  if (on) favs.push({ id: school.id, name: school.name });
  try { localStorage.setItem('hs-favorites', JSON.stringify(favs)); } catch { /* private mode */ }
  return on;
}
