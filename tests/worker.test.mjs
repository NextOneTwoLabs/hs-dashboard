// Worker contract tests against the committed archive (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, cachePolicy } from '../api/routes.mjs';
import worker from '../worker.js';

globalThis.fetch = () => { throw new Error('netguard: network access blocked in tests'); };

const root = new URL('../', import.meta.url);
const cases = JSON.parse(await readFile(new URL('tests/routes.json', root), 'utf8'));

// Mimics the Workers static-assets binding: JSON files with ETags, 404 otherwise.
const env = {
  ASSETS: {
    async fetch(req) {
      const { pathname } = new URL(req.url);
      try {
        const body = await readFile(fileURLToPath(new URL('public' + pathname, root)));
        const etag = '"' + createHash('sha1').update(body).digest('hex').slice(0, 16) + '"';
        if (req.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
        return new Response(req.method === 'HEAD' ? null : body, { status: 200, headers: { 'Content-Type': 'application/json', ETag: etag } });
      } catch {
        return new Response('not found', { status: 404 });
      }
    },
  },
};
const call = (path, init) => worker.fetch(new Request('https://hs.example' + path, init), env);

test('golden routes resolve identically to the Python twin', () => {
  for (const c of cases.routes) {
    const got = resolve(c.method, c.path);
    assert.equal(got.status, c.status, `${c.method} ${c.path}`);
    if (c.status === 200) {
      assert.equal(got.asset, c.asset);
      assert.equal(got.season, c.season);
    }
  }
});

test('cache policy', () => {
  for (const c of cases.cachePolicy) assert.equal(cachePolicy(c.season, c.active), c.expect);
});

test('catalog is served as JSON', async () => {
  const res = await call('/api/v1/catalog');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /application\/json/);
  const body = await res.json();
  assert.equal(body.schema, 2);
  assert.ok(body.seasons.length > 0);
  assert.ok(body.states.CA);
});

test('state routes serve coverage, per-state catalog, games and schools', async () => {
  const states = await (await call('/api/v1/states')).json();
  const codes = states.states.map((s) => s.code);
  for (const st of ['CA', 'TX']) assert.ok(codes.includes(st), st);
  const tx = await (await call('/api/v1/states/TX/catalog')).json();
  assert.equal(tx.state, 'TX');
  assert.equal(tx.association, 'UIL');
  const divs = tx.seasons.find((s) => s.season === '2025-26').competitions[0].divisions;
  assert.equal(divs[0].label, 'Conference 6A D1');
  const games = await call('/api/v1/states/TX/seasons/2025-26/games');
  assert.equal(games.status, 200);
  assert.equal(games.headers.get('Cache-Control'), 'public, max-age=86400, stale-while-revalidate=86400');
  assert.ok((await games.json()).games.every((g) => g.state === 'TX'));
  const idx = await (await call('/api/v1/search-index')).json();
  assert.deepEqual(idx.fields, ['id', 'name', 'city', 'state', 'apps', 'titles']);
  assert.equal((await call('/api/v1/states/ZZ/catalog')).status, 404);
  assert.equal((await call('/api/v1/states/tx/catalog')).status, 400);
});

test('closed season bracket is cacheable and supports ETag revalidation', async () => {
  const path = '/api/v1/seasons/2025-26/competitions/ca-cif-state/divisions/gd1/bracket';
  const res = await call(path);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=86400, stale-while-revalidate=86400');
  const b = await res.json();
  assert.equal(b.champion.name, 'Mater Dei');
  const again = await call(path, { headers: { 'If-None-Match': res.headers.get('ETag') } });
  assert.equal(again.status, 304);
});

test('errors are JSON and never fall through to HTML', async () => {
  for (const [path, init, status] of [
    ['/api/v1/seasons/2025-26/competitions/ca-cif-state/divisions/gd9/bracket', undefined, 404],
    ['/api/v1/seasons/bad/games', undefined, 400],
    ['/api/v1/catalog', { method: 'POST' }, 405],
    ['/archive/catalog.json', undefined, 404],
    ['/data/sources.json', undefined, 404],
  ]) {
    const res = await call(path, init);
    assert.equal(res.status, status, path);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal((await res.json()).ok, false);
  }
  assert.equal((await call('/api/v1/catalog', { method: 'POST' })).headers.get('Allow'), 'GET, HEAD');
});

test('rate limit binding is honored when present', async () => {
  const limited = { ...env, RL_IP: { limit: async () => ({ success: false }) } };
  const res = await worker.fetch(new Request('https://hs.example/api/v1/catalog'), limited);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '60');
});
