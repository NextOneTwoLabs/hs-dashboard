// docs/data-api.md, the two route tables (api/routes.mjs and crawler/api_routes.py), tests/routes.json, worker.js and
// wrangler.toml say the same thing (#8 PR 1, modelled on collegedash's tests/api_docs_agree.test.mjs).
//
//     node --test tests/api_docs_agree.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, cachePolicy } from '../api/routes.mjs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
// API_DOCS_PATH (a file path) lets a reviewer point the test at an edited copy of the docs.
const DOCS = process.env.API_DOCS_PATH
  ? readFileSync(process.env.API_DOCS_PATH, 'utf8').replace(/\r\n/g, '\n')
  : read('docs/data-api.md');
// The Worker's API code: worker.js dispatches, api/data-api.mjs answers, api/data-reader.mjs reads storage (#8 PR 2).
const WORKER = ['worker.js', 'api/data-api.mjs', 'api/data-reader.mjs'].map(read).join('\n');
const TOML = read('wrangler.toml');
const ROUTES_MJS = read('api/routes.mjs');
const ROUTES_PY = read('crawler/api_routes.py');
const GOLDEN = JSON.parse(read('tests/routes.json'));

// The rows of the markdown table under a "## Heading".
function table(heading) {
  const start = DOCS.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `docs have a "## ${heading}" section`);
  const end = DOCS.indexOf('\n## ', start + 4);
  const lines = DOCS.slice(start, end < 0 ? undefined : end).split('\n').filter((l) => l.startsWith('|'));
  return lines.slice(2).map((l) => l.slice(1, -1).split(' | ').map((c) => c.trim()));
}
const code = (cell) => (cell.match(/`([^`]+)`/g) || []).map((c) => c.slice(1, -1));

const SAMPLE = { season: '2025-26', ST: 'TX', comp: 'tx-uil', div: '6a-d1', id: '2b6b45d3-4465-4750-ba48-a273b674e37c' };
const fill = (tpl) => tpl.replace(/\{(\w+)\}/g, (_, k) => SAMPLE[k]);
const DOC_ROUTES = table('Routes').map(([route, file, cached]) => ({ route: code(route)[0], file: code(file)[0], cached: cached === 'yes' }));

// The Python twin, asked through the same function dev_server.py uses.
function pyResolve(cases) {
  const out = execFileSync('python', ['-c', [
    'import json, sys',
    'from crawler import api_routes',
    'cases = json.load(sys.stdin)',
    'print(json.dumps([api_routes.resolve(m, p) for m, p in cases["resolve"]] + [api_routes.cache_policy(s, a) for s, a in cases["cache"]]))',
  ].join('\n')], { cwd: fileURLToPath(root), input: JSON.stringify(cases), encoding: 'utf8' });
  return JSON.parse(out);
}

test('every documented route resolves to its documented file, in both twins', () => {
  assert.ok(DOC_ROUTES.length >= 10);
  const py = pyResolve({ resolve: DOC_ROUTES.map((r) => ['GET', fill(r.route)]), cache: [] });
  DOC_ROUTES.forEach((r, i) => {
    const path = fill(r.route);
    const want = { status: 200, asset: fill(r.file), season: r.cached ? SAMPLE.season : null };
    assert.deepEqual(resolve('GET', path), want, `${r.route} (api/routes.mjs)`);
    assert.deepEqual(py[i], want, `${r.route} (crawler/api_routes.py)`);
    assert.equal(resolve('HEAD', path).status, 200, `${r.route} answers HEAD`);
  });
});

test('no route exists in code or golden cases that the docs leave out', () => {
  const inMjs = (ROUTES_MJS.match(/\{ re: /g) || []).length;
  const block = ROUTES_PY.slice(ROUTES_PY.indexOf('_ROUTES = ['), ROUTES_PY.indexOf('\n]\n'));
  const inPy = (block.match(/re\.compile\(/g) || []).length;
  assert.equal(inMjs, DOC_ROUTES.length, 'api/routes.mjs has as many routes as the docs');
  assert.equal(inPy, DOC_ROUTES.length, 'crawler/api_routes.py has as many routes as the docs');
  const patterns = DOC_ROUTES.map((r) => ({ ...r, re: new RegExp(`^${r.route.replace(/\{\w+\}/g, '[^/]+')}$`) }));
  for (const c of GOLDEN.routes.filter((x) => x.status === 200)) {
    const row = patterns.find((p) => p.re.test(c.path));
    assert.ok(row, `${c.path} (tests/routes.json) is a documented route`);
    assert.equal(c.season !== null, row.cached, `${c.path}: season-cached matches the docs`);
  }
});

test('each documented parameter rule gives its documented 400 error, in both twins', () => {
  const rows = table('Parameters');
  const bad = { season: ['2025', '2025-27'], ST: ['tx'], comp: ['CIF'], div: ['6A_D1'], id: ['AB'] };
  const where = { season: '/api/v1/seasons/{season}/games', ST: '/api/v1/states/{ST}/catalog',
    comp: '/api/v1/seasons/2025-26/competitions/{comp}/divisions/gd1/bracket',
    div: '/api/v1/seasons/2025-26/competitions/tx-uil/divisions/{div}/bracket', id: '/api/v1/schools/{id}' };
  assert.deepEqual(rows.map((r) => code(r[0])[0].slice(1, -1)).sort(), Object.keys(bad).sort());
  const cases = [];
  for (const row of rows) {
    const name = code(row[0])[0].slice(1, -1);
    for (const value of bad[name]) cases.push({ path: where[name].replace(`{${name}}`, value), errors: code(row[2]) });
  }
  const py = pyResolve({ resolve: cases.map((c) => ['GET', c.path]), cache: [] });
  cases.forEach((c, i) => {
    for (const got of [resolve('GET', c.path), py[i]]) {
      assert.equal(got.status, 400, c.path);
      assert.ok(c.errors.includes(got.error), `${c.path}: "${got.error}" is one of the documented errors`);
    }
  });
});

test('every error the Worker and the route tables can send is documented', () => {
  const rows = table('Answers').map(([status, error]) => [Number(status), code(error)[0]]);
  const documented = new Set(rows.map(([s, e]) => `${s} ${e}`));
  const fromWorker = [...WORKER.matchAll(/jsonError\((\d{3}), '([^']+)'/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.ok(fromWorker.length >= 4);
  for (const e of fromWorker) assert.ok(documented.has(e), `worker.js "${e}" is in the errors table`);
  assert.ok(documented.has(`404 ${resolve('GET', '/api/v1/nope').error}`));
  assert.ok(documented.has(`405 ${resolve('POST', '/api/v1/catalog').error}`));
  assert.match(DOCS, /`Allow: GET, HEAD`/);
  assert.match(WORKER, /Allow: 'GET, HEAD'/);
  assert.match(DOCS, /`Retry-After: 60`/);
  assert.match(WORKER, /'Retry-After': '60'/);
  // Errors are no-store, and the envelope is {ok:false, error}.
  assert.match(DOCS, /`\{"ok": false, "error": "…"\}`, with `Cache-Control: no-store`/);
  assert.match(WORKER, /JSON\.stringify\(\{ ok: false, error \}\)[\s\S]*'Cache-Control': 'no-store'/);
});

test('the documented cache policy is the code\'s, in both twins and in tests/routes.json', () => {
  const rows = table('Cache');
  const closed = code(rows.find((r) => /closed season/.test(r[0]))[1])[0];
  const other = code(rows.find((r) => /every other success/.test(r[0]))[1])[0];
  const errors = code(rows.find((r) => /every error/.test(r[0]))[1])[0];
  assert.equal(cachePolicy('2025-26', '2026-27'), closed);
  assert.equal(cachePolicy('2026-27', '2026-27'), other);
  assert.equal(cachePolicy(null, '2026-27'), other);
  assert.equal(cachePolicy('2025-26', null), other, 'no active season: everything no-cache');
  assert.deepEqual(pyResolve({ resolve: [], cache: [['2025-26', '2026-27'], ['2026-27', '2026-27'], [null, '2026-27'], ['2025-26', null]] }),
    [closed, other, other, other]);
  for (const c of GOLDEN.cachePolicy) assert.ok([closed, other].includes(c.expect), `tests/routes.json cachePolicy "${c.expect}" is documented`);
  assert.equal(errors, 'no-store');
});

test('the documented rate limits are the ones wrangler.toml binds', () => {
  const rows = table('Rate limit').map(([name, key, limit, where]) => ({ name: code(name)[0], key: code(key)[0], limit, where }));
  const bound = [...TOML.matchAll(/\[\[(previews\.)?ratelimits\]\]\nname = "(\w+)"\nnamespace_id = "(\d+)"\nsimple = \{ limit = (\d+), period = (\d+) \}/g)]
    .map((m) => ({ preview: !!m[1], name: m[2], ns: m[3], limit: `${Number(m[4]).toLocaleString('en-US')} per ${m[5]} s` }));
  assert.equal(rows.length, bound.length, 'one docs row per bound limiter');
  for (const b of bound) {
    const row = rows.find((r) => r.name === b.name && /preview/i.test(r.where) === b.preview);
    assert.ok(row, `${b.name} (${b.preview ? 'preview' : 'production'}) is documented`);
    assert.equal(row.limit, b.limit, `${b.name} limit`);
    assert.match(row.where, new RegExp(`namespace ${b.ns}\\b`), `${b.name} namespace`);
    assert.ok(WORKER.includes(`env.${b.name}`), `worker.js uses env.${b.name}`);
    assert.ok(WORKER.includes(`'${row.key}'`), `worker.js keys ${b.name} by ${row.key}`);
  }
});

test('headers and the raw-data block are as documented', () => {
  for (const h of ["'Access-Control-Allow-Origin', '*'", "'X-Content-Type-Options', 'nosniff'", "'ETag'"]) {
    assert.ok(WORKER.includes(h), `worker.js sets ${h}`);
  }
  assert.match(DOCS, /`Access-Control-Allow-Origin: \*`/);
  assert.match(DOCS, /`X-Content-Type-Options: nosniff`/);
  assert.match(WORKER, /pathname\.startsWith\('\/archive'\) \|\| pathname\.startsWith\('\/data'\)\) return jsonError\(404, 'not found'\)/);
  assert.match(DOCS, /`\/archive\/\*` and `\/data\/\*` answer \*\*404\*\* `not found`/);
  for (const p of ['/api/*', '/archive*', '/data*']) assert.ok(TOML.includes(`"${p}"`), `run_worker_first lists ${p}`);
});
