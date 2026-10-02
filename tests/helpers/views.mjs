// Shared harness for view tests (#20): renders a page module offline, with no DOM library and no network.
// - Netguard plus a disk-backed /api/v1: a same-origin GET goes through the real route table (api/routes.mjs)
//   to its public/ file; any other origin, unknown route or method throws.
// - localStorage, matchMedia, window and location are stubbed before any app module is imported.
// - Only view modules and pure modules are imported (app.js, shell.js and searchBox.js bind to the real DOM).
import { readFile } from 'node:fs/promises';
import { resolve as route } from '../../api/routes.mjs';

export const root = new URL('../../', import.meta.url);
export const read = (p) => readFile(new URL(p, root), 'utf8');

const ORIGIN = 'http://hs.test';
globalThis.location = { hash: '', origin: ORIGIN, href: `${ORIGIN}/` };
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input), ORIGIN);
  const method = String(init.method || 'GET').toUpperCase();
  if (url.origin !== ORIGIN) throw new Error(`netguard: network access blocked in tests (${url.href})`);
  const r = route(method, url.pathname);
  if (method !== 'GET' || r.status !== 200) throw new Error(`netguard: ${method} ${url.pathname} -> ${r.status}`);
  const body = await readFile(new URL(`public${r.asset}`, root));
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };

export const nav = await import('../../public/js/nav.js');
export const { readHash, resolveState, normalize } = await import('../../public/js/state.js');
export const { api } = await import('../../public/js/api.js');
export const VIEWS = {};
for (const page of nav.PAGES ?? []) VIEWS[page] = await import(`../../public/js/views/${page}.js`);   // ?? : tests fail one by one on older code
export const statesIndex = await api.states();

// A tiny element stub: innerHTML plus no-op queries and listeners. querySelector finds nothing, except an
// id the view just wrote (#bracket-host, #fav, #team-season), which gets a child stub. Every element made is
// kept, so an error written into a child (e.g. the bracket host) is still seen.
let made = [];
export function el() {
  const e = {
    innerHTML: '', textContent: '', hidden: false, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelector: (sel) => (/^#[\w-]+$/.test(sel) && e.innerHTML.includes(`id="${sel.slice(1)}"`) ? el() : null),
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null, focus() {},
  };
  made.push(e);
  return e;
}
export const ERRORS = /That page has no data yet|Couldn't load data right now|Something went wrong/;

// What app.js render() does with a hash, against the stubs.
export async function open(hash) {
  location.hash = hash;
  let state = nav.resolveTab(readHash());
  let catalog = null;
  if (nav.needsCatalog(state.tab)) {
    state = resolveState(state, statesIndex);
    catalog = await api.stateCatalog(state.st);
    state = normalize(state, catalog);
  }
  made = [];
  const ctx = { state, catalog, statesIndex, controls: el(), view: el(), head: el(), setState: () => {} };
  await VIEWS[nav.pageOf(state)].render(ctx);
  return { state, ...ctx, made };
}

export const LOS_GATOS = 'bdb0b593-ef7f-4c69-8c2a-e0a48c934ca7';
