// Storage adapter for /api/v1 (#8 PR 2, after collegedash's api/data-reader.mjs). The published files' layout
// stays behind this module: handlers pass the asset path the route table chose, never one from the request.

// Read one published file from the Workers static-assets binding. Only the validator is forwarded, not cookies,
// ranges or other browser headers.
export function readAsset(request, env, assetPath) {
  const url = new URL(request.url);
  const headers = new Headers();
  const inm = request.headers.get('If-None-Match');
  if (inm) headers.set('If-None-Match', inm);
  return env.ASSETS.fetch(new Request(url.origin + assetPath, { method: request.method, headers }));
}

let activeSeasonMemo = null;

// The active season from sources.json, read once per isolate. If it can't be read, the cache policy treats every
// season as open (no-cache).
export async function activeSeason(env, origin) {
  if (activeSeasonMemo) return activeSeasonMemo;
  try {
    const res = await env.ASSETS.fetch(new Request(origin + '/data/sources.json'));
    if (res.ok) activeSeasonMemo = (await res.json()).activeSeason || null;
  } catch {
    // Fall back to no-cache for everything.
  }
  return activeSeasonMemo;
}
