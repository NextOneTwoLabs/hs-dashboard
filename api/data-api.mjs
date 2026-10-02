// The read-only /api/v1 handler (#8 PR 2, after collegedash's api/data-api.mjs). The contract is
// docs/data-api.md; the route table, parameter rules and cache policy are api/routes.mjs; storage is
// api/data-reader.mjs. worker.js only dispatches here.
import { resolve, cachePolicy } from './routes.mjs';
import { activeSeason, readAsset } from './data-reader.mjs';

const JSON_TYPE = 'application/json; charset=utf-8';

// Every error is the {ok:false,error} envelope, never cached, never HTML.
export function jsonError(status, error, extra = {}) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', ...extra },
  });
}

export async function dataApi(request, env) {
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
    asset = await readAsset(request, env, route.asset);
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
