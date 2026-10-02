// #8 PR 2: the API split changes no answer. Every request below goes to the frozen pre-split worker
// (tests/fixtures/worker-v1/) and to the current worker.js, against the same fake asset store and limiter,
// and the two answers must match: status, every header, and the body bytes. Offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import current from '../worker.js';
import frozen from './fixtures/worker-v1/worker.mjs';

globalThis.fetch = () => { throw new Error('netguard: network access blocked in tests'); };

const root = new URL('../', import.meta.url);
const cases = JSON.parse(await readFile(new URL('tests/routes.json', root), 'utf8'));

// The Workers static-assets binding, as in worker.test.mjs, plus failure modes.
function assets(mode = 'ok') {
  return {
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (mode === 'throw' && pathname !== '/data/sources.json') throw new Error('storage down');
      if (mode === '500' && pathname !== '/data/sources.json') return new Response('oops', { status: 500 });
      if (mode === 'html' && pathname !== '/data/sources.json') {
        return new Response('<!doctype html><p>app', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      try {
        const body = await readFile(fileURLToPath(new URL('public' + pathname, root)));
        const etag = '"' + createHash('sha1').update(body).digest('hex').slice(0, 16) + '"';
        if (req.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
        const type = pathname.endsWith('.json') ? 'application/json' : pathname.endsWith('.html') ? 'text/html' : 'application/octet-stream';
        return new Response(req.method === 'HEAD' ? null : body, { status: 200, headers: { 'Content-Type': type, ETag: etag } });
      } catch {
        return new Response('not found', { status: 404 });
      }
    },
  };
}
const refuse = { limit: async () => ({ success: false }) };
const allow = { limit: async () => ({ success: true }) };

async function snapshot(res) {
  const headers = [...res.headers.entries()].sort(([a], [b]) => a.localeCompare(b));
  const body = Buffer.from(await res.arrayBuffer()).toString('base64');
  return { status: res.status, headers, body };
}

async function same(path, init = {}, env = { ASSETS: assets() }) {
  const req = () => new Request('https://hs.example' + path, init);
  const [a, b] = await Promise.all([frozen.fetch(req(), env), current.fetch(req(), env)]);
  const [sa, sb] = [await snapshot(a), await snapshot(b)];
  assert.deepEqual(sb, sa, `${init.method || 'GET'} ${path}`);
  return sa;
}

test('every golden route and method answers exactly as before (GET and HEAD)', async () => {
  for (const c of cases.routes) {
    await same(c.path, { method: c.method });
    if (c.status === 200) await same(c.path, { method: 'HEAD' });
  }
});

test('ETag revalidation (304) and the cache policy are unchanged', async () => {
  for (const path of ['/api/v1/seasons/2025-26/competitions/ca-cif-state/divisions/gd1/bracket',   // closed season
    '/api/v1/states/TX/catalog', '/api/v1/status']) {
    const first = await same(path);
    const etag = first.headers.find(([k]) => k === 'etag')?.[1];
    assert.ok(etag, path);
    const again = await same(path, { headers: { 'If-None-Match': etag } });
    assert.equal(again.status, 304);
  }
});

test('every error answer is unchanged: 400, 404, 405, 429, 503 and the raw-data block', async () => {
  const errors = [
    ['/api/v1/seasons/2025/games'], ['/api/v1/states/tx/catalog'], ['/api/v1/schools/AB'],          // 400
    ['/api/v1/seasons/2025-26/competitions/CIF/divisions/gd1/bracket'],
    ['/api/v1/seasons/2025-26/competitions/tx-uil/divisions/6A_D1/bracket'],
    ['/api/v1/nope'], ['/api/v2/catalog'], ['/api/'],                                                 // 404 unknown route
    ['/api/v1/states/ZZ/catalog'], ['/api/v1/seasons/2025-26/competitions/ca-cif-state/divisions/gd9/bracket'], // 404 no file
    ['/api/v1/catalog', { method: 'POST' }], ['/api/v1/catalog', { method: 'DELETE' }],               // 405
    ['/archive/catalog.json'], ['/data/sources.json'], ['/archive'], ['/data'],                        // raw data
  ];
  for (const [path, init] of errors) await same(path, init);
  // 404 when storage answers HTML for a JSON route.
  await same('/api/v1/catalog', {}, { ASSETS: assets('html') });
  // 429 over the limit, and served with a limiter that allows.
  await same('/api/v1/catalog', {}, { ASSETS: assets(), RL_IP: refuse });
  await same('/api/v1/catalog', { headers: { 'CF-Connecting-IP': '203.0.113.7' } }, { ASSETS: assets(), RL_IP: allow });
  // 503 when storage throws or fails.
  await same('/api/v1/catalog', {}, { ASSETS: assets('throw') });
  await same('/api/v1/catalog', {}, { ASSETS: assets('500') });
});

test('non-API paths still go to the static assets unchanged', async () => {
  for (const path of ['/', '/index.html', '/css/app.css', '/assets/logo.svg', '/missing.png']) await same(path);
});
