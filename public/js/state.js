// Hash deep links: #tab=playoffs&st=TX&season=2025-26&comp=tx-uil&div=6a-d1
// `view` is a sub-page of a tab (#20): teams&view=list, playoffs&view=champions.
export const KEYS = ['tab', 'view', 'st', 'season', 'comp', 'div', 'g', 'school', 'show', 'round', 'q'];

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

let lastState = null;
try { lastState = localStorage.getItem('hs-state'); } catch { /* private mode */ }

// Pick the state for a state-scoped tab: explicit, from the competition id
// (old links like comp=cif-state are mapped through the aliases), remembered,
// or the first covered state with data.
export function resolveState(raw, statesIndex) {
  const codes = statesIndex.states.filter((s) => s.latestSeason).map((s) => s.code);
  const out = { ...raw };
  if (out.comp && statesIndex.aliases?.[out.comp]) out.comp = statesIndex.aliases[out.comp];
  if (out.st) out.st = out.st.toUpperCase();
  if (!codes.includes(out.st)) {
    const fromComp = out.comp?.slice(0, 2).toUpperCase();
    out.st = codes.includes(fromComp) ? fromComp : codes.includes(lastState) ? lastState : codes[0];
  }
  try { localStorage.setItem('hs-state', out.st); lastState = out.st; } catch { /* ignore */ }
  return out;
}

// Fill in defaults from a state's catalog and drop invalid values.
export function normalize(state, catalog) {
  const s = { ...state };
  const seasons = catalog.seasons.filter((x) => x.competitions.length);
  if (!seasons.some((x) => x.season === s.season)) s.season = catalog.latestSeason;
  const season = seasons.find((x) => x.season === s.season);
  const genders = catalog.genders || ['b', 'g'];
  if (!genders.includes(s.g)) s.g = genders[0];
  if (season) {
    if (!season.competitions.some((c) => c.id === s.comp)) s.comp = season.competitions[0].id;
    const comp = season.competitions.find((c) => c.id === s.comp);
    const divs = comp.divisions.filter((d) => d.gender[0] === s.g);
    if (!divs.some((d) => d.code === s.div)) s.div = divs[0]?.code || comp.divisions[0]?.code;
  }
  return s;
}
