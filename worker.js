// Cloudflare Worker: read-only /api/v1 over the static archive in ./public.
// Raw /archive and /data paths are not served directly; the page reads data
// only through the versioned API.
import { resolve, cachePolicy } from './api/routes.mjs';

const JSON_TYPE = 'application/json; charset=utf-8';
let activeSeasonMemo = null;

function jsonError(status, error, extra = {}) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', ...extra },
  });
}

async function activeSeason(env, origin) {
  if (activeSeasonMemo) return activeSeasonMemo;
  try {
    const res = await env.ASSETS.fetch(new Request(origin + '/data/sources.json'));
    if (res.ok) activeSeasonMemo = (await res.json()).activeSeason || null;
  } catch {
    // Fall back to no-cache for everything.
  }
  return activeSeasonMemo;
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  const route = resolve(request.method, url.pathname);
  if (route.status === 405) return jsonError(405, route.error, { Allow: 'GET, HEAD' });
  if (route.status !== 200) return jsonError(route.status, route.error);

  if (env.RL_IP) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.RL_IP.limit({ key: ip });
    if (!success) return jsonError(429, 'rate limited', { 'Retry-After': '60' });
  }

  let asset;
  try {
    const headers = new Headers();
    const inm = request.headers.get('If-None-Match');
    if (inm) headers.set('If-None-Match', inm);
    asset = await env.ASSETS.fetch(new Request(url.origin + route.asset, { method: request.method, headers }));
  } catch {
    return jsonError(503, 'storage unavailable');
  }
  if (asset.status === 404) return jsonError(404, 'not found');
  if (asset.status !== 200 && asset.status !== 304) return jsonError(503, 'storage unavailable');
  // Assets with unknown paths may be answered with HTML; never pass that on.
  const type = asset.headers.get('Content-Type') || '';
  if (asset.status === 200 && type && !type.includes('json')) return jsonError(404, 'not found');

  const out = new Headers();
  out.set('Content-Type', JSON_TYPE);
  out.set('Cache-Control', cachePolicy(route.season, await activeSeason(env, url.origin)));
  out.set('Access-Control-Allow-Origin', '*');
  out.set('X-Content-Type-Options', 'nosniff');
  const etag = asset.headers.get('ETag');
  if (etag) out.set('ETag', etag);
  return new Response(request.method === 'HEAD' || asset.status === 304 ? null : asset.body, {
    status: asset.status,
    headers: out,
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return handleApi(request, env);
    if (pathname.startsWith('/archive') || pathname.startsWith('/data')) return jsonError(404, 'not found');
    return env.ASSETS.fetch(request);
  },
};
