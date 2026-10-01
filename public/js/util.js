const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function fmtDate(iso, opts = { month: 'short', day: 'numeric' }) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
}

export const fmtLongDate = (iso) => fmtDate(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export const genderLabel = (g) => (g === 'b' || g === 'boys' ? 'Boys' : 'Girls');

export const RESULT_LABEL = {
  champion: 'Champion',
  'runner-up': 'Runner-up',
  eliminated: 'Eliminated',
  alive: 'Still alive',
  unreported: 'Result not reported',
};

export function resultText(app) {
  if (app.result === 'eliminated') return `Lost in ${app.reached}`;
  return RESULT_LABEL[app.result] || app.result;
}

export const schoolHref = (id, g) => `#tab=school&school=${encodeURIComponent(id)}${g ? `&g=${g}` : ''}`;

export const bracketHref = (st, season, comp, div) =>
  `#tab=playoffs&st=${st}&season=${season}&comp=${comp}${div ? `&div=${div}` : ''}`;

// A division is live while it is unfinished and today is near its dates.
export function isLive(div, today = new Date().toISOString().slice(0, 10)) {
  if (div.status === 'complete' || div.status === 'unreported' || !div.start) return false;
  const shift = (iso, days) => new Date(Date.parse(iso) + days * 864e5).toISOString().slice(0, 10);
  return shift(div.start, -3) <= today && today <= shift(div.end || div.start, 3);
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
