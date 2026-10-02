// Cloudflare Worker: read-only /api/v1 over the static archive in ./public.
// Raw /archive and /data paths are not served directly; the page reads data
// only through the versioned API. The API itself is api/data-api.mjs (#8 PR 2).
import { dataApi, jsonError } from './api/data-api.mjs';

// Kept as a named export for existing callers; it is the API handler.
export const handleApi = dataApi;

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return dataApi(request, env);
    if (pathname.startsWith('/archive') || pathname.startsWith('/data')) return jsonError(404, 'not found');
    return env.ASSETS.fetch(request);
  },
};
