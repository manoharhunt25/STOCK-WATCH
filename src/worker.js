// Cloudflare Worker entry point. Static files in public/ are served directly
// by Cloudflare; this script only runs for /api/* (see wrangler.jsonc).
import { handleApi } from "./api.js";

export default {
  /**
   * @param {Request} request
   * @param {{ASSETS: Fetcher, API_LIMIT?: RateLimit, TD_LIMIT?: RateLimit, ALPACA_KEY_ID?: string, ALPACA_SECRET?: string, TWELVEDATA_KEY?: string}} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/([a-z]+)\/?$/);
    if (!match) return env.ASSETS.fetch(request);

    // Per-visitor rate limits protect the shared data-provider quotas from
    // scripted abuse. Twelve Data routes get a tighter limit (800 calls/day).
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const route = match[1];
    const limiter = route === "td" || route === "quote" ? env.TD_LIMIT : env.API_LIMIT;
    if (limiter) {
      const { success } = await limiter.limit({ key: `${route === "td" || route === "quote" ? "td" : "api"}:${ip}` });
      if (!success) {
        return new Response(JSON.stringify({ message: "Too many requests. Try again in a minute." }), {
          status: 429,
          headers: { "content-type": "application/json", "Cache-Control": "no-store", "Retry-After": "60", "X-Content-Type-Options": "nosniff" },
        });
      }
    }

    // Share short-lived responses between visitors through Cloudflare's edge
    // cache (honours s-maxage; caching is skipped on workers.dev hostnames).
    const cache = caches.default;
    if (request.method === "GET") {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    const res = await handleApi(request, env, route);
    if (request.method === "GET" && res.ok && /s-maxage=\d+/.test(res.headers.get("Cache-Control") || "")) {
      ctx.waitUntil(cache.put(request, res.clone()));
    }
    return res;
  },
};
