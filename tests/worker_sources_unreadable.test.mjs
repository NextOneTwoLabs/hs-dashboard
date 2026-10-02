// #19 review note 2, taken in #8 PR 3: the "sources.json can't be read, so every season is no-cache" path.
// activeSeason() memoizes per isolate, so in worker_split.test.mjs both workers have cached the season after the
// first request and this path is never compared. Here the modules are fresh: node --test runs each file in its own
// process, so these are the first requests both workers see, and the reader is also imported with a query string
// (its own module instance, whatever ran before). Offline: storage is a stub over public/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

globalThis.fetch = () => { throw new Error('netguard: network access blocked in tests'); };

const root = new URL('../', import.meta.url);
const CLOSED = '/api/v1/seasons/2025-26/competitions/ca-cif-state/divisions/gd1/bracket';   // 2025-26 < active 2026-27
const LONG = 'public, max-age=86400, stale-while-revalidate=86400';

// sources.json: 'throw' (storage error), '404', 'garbage' (not JSON) or 'ok'; every other file is served from disk.
function assets(sources) {
  return {
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === '/data/sources.json' && sources !== 'ok') {
        if (sources === 'throw') throw new Error('storage down');
        if (sources === '404') return new Response('not found', { status: 404 });
        return new Response('{not json', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      try {
        const body = await readFile(fileURLToPath(new URL('public' + pathname, root)));
        return new Response(req.method === 'HEAD' ? null : body, { status: 200, headers: { 'Content-Type': 'application/json' } });
      } catch {
        return new Response('not found', { status: 404 });
      }
    },
  };
}

test('fresh workers, sources.json unreadable: a closed season is no-cache, the same in the old and new worker', async () => {
  // First requests in this process: neither worker has a memoized season yet.
  const [{ default: current }, { default: frozen }] = await Promise.all([import('../worker.js'), import('./fixtures/worker-v1/worker.mjs')]);
  for (const mode of ['throw', '404', 'garbage']) {
    const env = { ASSETS: assets(mode) };
    const req = () => new Request('https://hs.example' + CLOSED);
    const [a, b] = await Promise.all([frozen.fetch(req(), env), current.fetch(req(), env)]);
    assert.equal(b.status, 200, mode);
    assert.equal(b.headers.get('Cache-Control'), 'no-cache', `${mode}: every season is open when the active season is unknown`);
    assert.equal(b.headers.get('Cache-Control'), a.headers.get('Cache-Control'), `${mode}: same as the pre-split worker`);
    assert.equal(Buffer.from(await b.arrayBuffer()).toString(), Buffer.from(await a.arrayBuffer()).toString(), mode);
  }
  // A failed read is not memoized: once sources.json can be read, the closed season gets the long cache.
  const env = { ASSETS: assets('ok') };
  const [a, b] = await Promise.all([frozen.fetch(new Request('https://hs.example' + CLOSED), env), current.fetch(new Request('https://hs.example' + CLOSED), env)]);
  assert.equal(b.headers.get('Cache-Control'), LONG);
  assert.equal(a.headers.get('Cache-Control'), LONG);
});

test('the reader alone, freshly imported: unreadable gives null and is retried; readable is read once', async () => {
  const reader = await import(`../api/data-reader.mjs?fresh=${Date.now()}`);   // its own module instance
  let reads = 0;
  const env = (mode) => ({ ASSETS: { fetch: (req) => { reads += 1; return assets(mode).fetch(req); } } });
  assert.equal(await reader.activeSeason(env('throw'), 'https://hs.example'), null);
  assert.equal(await reader.activeSeason(env('garbage'), 'https://hs.example'), null);
  assert.equal(reads, 2, 'a failed read is tried again next time');
  const active = JSON.parse(await readFile(new URL('public/data/sources.json', root), 'utf8')).activeSeason;
  assert.equal(await reader.activeSeason(env('ok'), 'https://hs.example'), active);
  assert.equal(await reader.activeSeason(env('throw'), 'https://hs.example'), active, 'memoized after a good read');
  assert.equal(reads, 3);
});
