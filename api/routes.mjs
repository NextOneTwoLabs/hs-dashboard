// /api/v1 route table: maps a request path to one archived JSON asset.
// Twin of crawler/api_routes.py; both are checked against tests/routes.json.

const ID = '([^/]+)';

const ROUTES = [
  { re: /^\/api\/v1\/catalog$/, asset: () => '/archive/catalog.json' },
  { re: /^\/api\/v1\/status$/, asset: () => '/archive/refresh-state.json' },
  { re: /^\/api\/v1\/sources$/, asset: () => '/data/sources.json' },
  { re: /^\/api\/v1\/states$/, asset: () => '/archive/states.json' },
  { re: /^\/api\/v1\/search-index$/, asset: () => '/archive/search-index.json' },
  { re: /^\/api\/v1\/schools$/, asset: () => '/archive/schools.json' },
  { re: new RegExp(`^/api/v1/schools/${ID}$`), asset: ([id]) => `/archive/schools/${id}.json`, check: ([id]) => validId(id) },
  { re: new RegExp(`^/api/v1/states/${ID}/catalog$`), asset: ([st]) => `/archive/states/${st}/catalog.json`, check: ([st]) => validState(st) },
  { re: new RegExp(`^/api/v1/states/${ID}/schools$`), asset: ([st]) => `/archive/states/${st}/schools.json`, check: ([st]) => validState(st) },
  { re: new RegExp(`^/api/v1/states/${ID}/seasons/${ID}/games$`), season: 1,
    asset: ([st, s]) => `/archive/states/${st}/seasons/${s}/games.json`, check: ([st, s]) => validState(st) || validSeason(s) },
  { re: new RegExp(`^/api/v1/seasons/${ID}/games$`), season: 0,
    asset: ([s]) => `/archive/seasons/${s}/games.json`, check: ([s]) => validSeason(s) },
  { re: new RegExp(`^/api/v1/seasons/${ID}/competitions/${ID}/divisions/${ID}/bracket$`), season: 0,
    asset: ([s, c, d]) => `/archive/brackets/${s}/${c}/${d}.json`,
    check: ([s, c, d]) => validSeason(s) || validComp(c) || validDiv(d) },
];

export function validSeason(s) {
  if (!/^\d{4}-\d{2}$/.test(s)) return 'invalid season (expected YYYY-YY)';
  const start = Number(s.slice(0, 4));
  if ((start + 1) % 100 !== Number(s.slice(5))) return 'invalid season (years must be consecutive)';
  return null;
}
export function validState(st) {
  return /^[A-Z]{2}$/.test(st) ? null : 'invalid state (expected two capital letters, e.g. TX)';
}
export function validComp(c) {
  return /^[a-z][a-z0-9-]{1,40}$/.test(c) ? null : 'invalid competition id';
}
export function validDiv(d) {
  return /^[a-z0-9][a-z0-9-]{0,29}$/.test(d) ? null : 'invalid division code';
}
export function validId(id) {
  return /^[a-z0-9][a-z0-9-]{2,100}$/.test(id) ? null : 'invalid school id';
}

// -> { status: 200, asset, season } | { status: 4xx, error }
export function resolve(method, pathname) {
  for (const route of ROUTES) {
    const m = route.re.exec(pathname);
    if (!m) continue;
    if (method !== 'GET' && method !== 'HEAD') return { status: 405, error: 'method not allowed' };
    const params = m.slice(1);
    const bad = route.check ? route.check(params) : null;
    if (bad) return { status: 400, error: bad };
    return { status: 200, asset: route.asset(params), season: route.season === undefined ? null : params[route.season] };
  }
  return { status: 404, error: 'unknown API route' };
}

// Closed seasons never change, so let browsers keep them for a day.
export function cachePolicy(season, activeSeason) {
  if (season && activeSeason && season < activeSeason) {
    return 'public, max-age=86400, stale-while-revalidate=86400';
  }
  return 'no-cache';
}
