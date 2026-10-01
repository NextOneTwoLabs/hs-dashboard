// Single entry point for /api/v1, memoized per page session.
const memo = new Map();

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function fetchJSON(path) {
  if (memo.has(path)) return memo.get(path);
  const p = fetch('/api/v1' + path, { headers: { Accept: 'application/json' } }).then(async (res) => {
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) throw new ApiError(res.status, body?.error || `HTTP ${res.status}`);
    return body;
  });
  memo.set(path, p);
  p.catch(() => memo.delete(path)); // allow retry
  return p;
}

export const api = {
  catalog: () => fetchJSON('/catalog'),
  status: () => fetchJSON('/status'),
  schools: () => fetchJSON('/schools'),
  school: (id) => fetchJSON(`/schools/${encodeURIComponent(id)}`),
  games: (season) => fetchJSON(`/seasons/${season}/games`),
  bracket: (season, comp, div) => fetchJSON(`/seasons/${season}/competitions/${comp}/divisions/${div}/bracket`),
};

export function errorHtml(err) {
  const missing = err?.status === 404;
  return `<div class="card notice">
    <p>${missing ? 'That page has no data yet.' : "Couldn't load data right now."}</p>
    ${missing ? '' : '<button class="btn" data-action="retry">Try again</button>'}
  </div>`;
}
