// STOCK Watch API, shared by the Cloudflare Worker (src/worker.js) and the
// Netlify Function (netlify/functions/api.mts). Uses only web-standard fetch,
// Request and Response, so it runs on either platform unchanged.
//
// Keys come from the host's secret store and never reach the browser.
// Only well-formed symbols on a fixed set of routes are accepted:
//
//   GET /api/health                     which providers are configured
//   GET /api/snapshots?symbols=A,B      live stock snapshots (Alpaca, IEX feed)
//   GET /api/bars?symbol=A&timeframe=…  stock history (Alpaca, consolidated feed)
//   GET /api/crypto?symbols=BTC/USD,…   live crypto snapshots (Alpaca)
//   GET /api/asset?symbol=A|BTC/USD     confirm a symbol exists, get its name
//   GET /api/quote?symbol=A             latest quote for OTC stocks (Twelve Data)
//   GET /api/td?symbol=A&interval=…     long-range history (Twelve Data)

const ALP = "https://data.alpaca.markets";
const TRADING = "https://paper-api.alpaca.markets"; // asset lookups work with paper-account keys
const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;
const PAIR = /^[A-Z0-9]{1,10}\/USD$/;
const MAX_STOCKS = 80;
const MAX_PAIRS = 40;

/** Headers for a response that shared caches may keep for `seconds`. */
function cached(seconds) {
  return {
    "content-type": "application/json",
    // Browsers revalidate; edge caches (Cloudflare, Netlify) keep it briefly.
    "Cache-Control": `public, max-age=0, s-maxage=${seconds}`,
    "Netlify-CDN-Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=${seconds}, durable`,
  };
}
const noStore = { "content-type": "application/json", "Cache-Control": "no-store" };
const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers });
const fail = (message, status) => json({ message }, status, noStore);

async function relay(res, seconds) {
  const body = await res.text();
  return new Response(body, { status: res.status, headers: res.ok ? cached(seconds) : noStore });
}
function copy(from, keys) {
  const out = new URLSearchParams();
  for (const k of keys) {
    const v = from.get(k);
    if (v) out.set(k, v.slice(0, 64));
  }
  return out;
}
function list(raw, test, max) {
  return [...new Set((raw ?? "").toUpperCase().split(",").filter((s) => test.test(s)))].slice(0, max);
}

/**
 * Handle one API request.
 * @param {Request} request
 * @param {{ALPACA_KEY_ID?: string, ALPACA_SECRET?: string, TWELVEDATA_KEY?: string}} env
 * @param {string} route  the path segment after /api/
 * @returns {Promise<Response>}
 */
export async function handleApi(request, env, route) {
  if (request.method !== "GET" && request.method !== "HEAD") return fail("Method not allowed.", 405);
  const q = new URL(request.url).searchParams;
  // Trim so a stray space or line break pasted into a secret doesn't break auth
  const keyId = env.ALPACA_KEY_ID?.trim();
  const secret = env.ALPACA_SECRET?.trim();
  const tdKey = env.TWELVEDATA_KEY?.trim();
  const hasAlpaca = !!(keyId && secret);
  const alpHeaders = { "APCA-API-KEY-ID": keyId ?? "", "APCA-API-SECRET-KEY": secret ?? "" };

  switch (route) {
    case "health":
      return json({ alpaca: hasAlpaca, td: !!tdKey }, 200, noStore);

    case "snapshots": {
      if (!hasAlpaca) return fail("Live prices aren't set up on this site yet.", 503);
      const symbols = list(q.get("symbols"), TICKER, MAX_STOCKS);
      if (!symbols.length) return fail("No valid symbols requested.", 400);
      const res = await fetch(`${ALP}/v2/stocks/snapshots?` + new URLSearchParams({ symbols: symbols.join(","), feed: "iex" }), { headers: alpHeaders });
      return relay(res, 3);
    }

    case "bars": {
      if (!hasAlpaca) return fail("Price history isn't set up on this site yet.", 503);
      const symbol = q.get("symbol") ?? "";
      if (!TICKER.test(symbol)) return fail("Unsupported symbol.", 400);
      const p = copy(q, ["timeframe", "start", "end", "limit", "sort", "page_token", "adjustment"]);
      p.set("feed", "sip");
      const tf = p.get("timeframe") ?? "";
      const seconds = tf.endsWith("Min") ? 120 : tf.endsWith("Hour") ? 900 : 3600;
      const res = await fetch(`${ALP}/v2/stocks/${encodeURIComponent(symbol)}/bars?${p}`, { headers: alpHeaders });
      return relay(res, seconds);
    }

    case "crypto": {
      const pairs = list(q.get("symbols"), PAIR, MAX_PAIRS);
      if (!pairs.length) return fail("No valid crypto pairs requested.", 400);
      const res = await fetch(`${ALP}/v1beta3/crypto/us/snapshots?` + new URLSearchParams({ symbols: pairs.join(",") }), {
        headers: hasAlpaca ? alpHeaders : undefined,
      });
      return relay(res, 3);
    }

    case "asset": {
      if (!hasAlpaca) return fail("Symbol lookup isn't set up on this site yet.", 503);
      const symbol = (q.get("symbol") ?? "").toUpperCase();
      const isPair = PAIR.test(symbol);
      if (!isPair && !TICKER.test(symbol)) return fail("That doesn't look like a ticker symbol.", 400);
      const res = await fetch(`${TRADING}/v2/assets/${encodeURIComponent(symbol)}`, { headers: alpHeaders });
      if (res.status === 404) return fail(isPair ? `No crypto found for ${symbol.split("/")[0]}.` : `No US stock or ETF found for ${symbol}.`, 404);
      if (!res.ok) return fail("Symbol lookup failed. Try again in a moment.", 502);
      const a = await res.json();
      return json({ symbol: a.symbol, name: a.name, exchange: a.exchange, assetClass: a.class, status: a.status }, 200, cached(86400));
    }

    case "quote": {
      if (!tdKey) return fail("OTC quotes aren't set up on this site yet.", 503);
      const symbol = q.get("symbol") ?? "";
      if (!TICKER.test(symbol)) return fail("Unsupported symbol.", 400);
      const res = await fetch("https://api.twelvedata.com/quote?" + new URLSearchParams({ symbol, apikey: tdKey }));
      return relay(res, 120);
    }

    case "td": {
      if (!tdKey) return fail("Long-range history isn't set up on this site yet.", 503);
      const symbol = q.get("symbol") ?? "";
      if (!TICKER.test(symbol) && !PAIR.test(symbol)) return fail("Unsupported symbol.", 400);
      const p = copy(q, ["symbol", "interval", "outputsize", "start_date", "order"]);
      p.set("apikey", tdKey);
      const iv = p.get("interval") ?? "";
      const seconds = iv.endsWith("min") ? 300 : iv.endsWith("h") ? 900 : 3600;
      const res = await fetch("https://api.twelvedata.com/time_series?" + p);
      return relay(res, seconds);
    }
  }
  return fail("Not found.", 404);
}
