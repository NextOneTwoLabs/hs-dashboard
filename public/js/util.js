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

// A team page (#20): #tab=team&school=<id>, with the program (g) when there are two.
export const schoolHref = (id, g) => `#tab=team&school=${encodeURIComponent(id)}${g ? `&g=${g}` : ''}`;

// Brackets in a state's latest season, from states.json.
export const bracketCount = (row) => (row.latest || []).reduce((t, c) => t + c.divisions.length, 0);

// A bracket, optionally opened at one round (a match card's "View in bracket", #20 PR 4).
export const bracketHref = (st, season, comp, div, round = null) =>
  `#tab=playoffs&st=${st}&season=${season}&comp=${comp}${div ? `&div=${div}` : ''}${round != null ? `&round=${round}` : ''}`;

// A division is live while it is unfinished and today is near its dates.
// Today as YYYY-MM-DD in the viewer's local time zone. Game dates are local calendar dates, so the UTC date
// (toISOString) would be tomorrow in a US evening and call tonight's game "Awaiting result" (#24 review).
export function localToday(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isLive(div, today = localToday()) {
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
