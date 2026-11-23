// Cloudflare Worker entry point. Static files in public/ are served directly
// by Cloudflare; this script only runs for /api/* (see wrangler.jsonc).
import { handleApi } from "./api.js";

export default {
  /**
   * @param {Request} request
   * @param {{ASSETS: Fetcher, ALPACA_KEY_ID?: string, ALPACA_SECRET?: string, TWELVEDATA_KEY?: string}} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/([a-z]+)\/?$/);
    if (!match) return env.ASSETS.fetch(request);

    // Share short-lived responses between visitors through Cloudflare's edge
    // cache (honours s-maxage; caching is skipped on workers.dev hostnames).
    const cache = caches.default;
    if (request.method === "GET") {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    const res = await handleApi(request, env, match[1]);
    if (request.method === "GET" && res.ok && /s-maxage=\d+/.test(res.headers.get("Cache-Control") || "")) {
      ctx.waitUntil(cache.put(request, res.clone()));
    }
    return res;
  },
};
