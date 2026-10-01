// Hash deep links: #tab=playoffs&season=2025-26&comp=cif-state&div=gd2
const KEYS = ['tab', 'season', 'comp', 'div', 'g', 'school', 'show', 'round', 'q'];

export function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const state = {};
  for (const k of KEYS) if (params.get(k)) state[k] = params.get(k);
  return state;
}

export function writeHash(state, { replace = false } = {}) {
  const params = new URLSearchParams();
  for (const k of KEYS) if (state[k]) params.set(k, state[k]);
  const hash = '#' + params.toString();
  if (hash === location.hash) return false;
  if (replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  return true;
}

// Fill in defaults from the catalog and drop invalid values.
export function normalize(state, catalog) {
  const s = { tab: 'playoffs', ...state };
  const seasons = catalog.seasons.filter((x) => x.competitions.length);
  if (!seasons.some((x) => x.season === s.season)) s.season = catalog.latestSeason;
  const season = seasons.find((x) => x.season === s.season);
  const genders = catalog.genders || ['b', 'g'];
  if (!genders.includes(s.g)) s.g = s.div && genders.includes(s.div[0]) ? s.div[0] : genders[0];
  if (season) {
    if (!season.competitions.some((c) => c.id === s.comp)) s.comp = season.competitions[0].id;
    const comp = season.competitions.find((c) => c.id === s.comp);
    const divs = comp.divisions.filter((d) => d.code[0] === s.g);
    if (!divs.some((d) => d.code === s.div)) s.div = divs[0]?.code || comp.divisions[0]?.code;
  }
  return s;
}
