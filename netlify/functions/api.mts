import type { Config, Context } from "@netlify/functions"

// Proxy for the STOCK Watch dashboard: keeps API keys on the server.
// Answers for the built-in watchlist plus any valid US ticker a viewer adds.
const STOCKS = new Set(["AAPL", "AMD", "AMZN", "ASML", "AVGO", "BLK", "CBRS", "COHR", "COPX", "CRWV", "DIA", "ECVT", "GLD", "HGRAF", "INDO", "INTC", "IREN", "LITE", "MRVL", "MSTR", "MU", "NBIS", "NVDA", "PLTR", "QBTS", "QQQ", "QUBT", "RACE", "SLV", "SNDK", "SOUN", "SPCE", "SPCX", "STX", "TSM", "VOO", "VSXY", "WDC", "XNDU"])
const CRYPTO = new Set(["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"])
const ALP = "https://data.alpaca.markets"
const TRADING = "https://paper-api.alpaca.markets" // asset lookups work with paper-account keys
const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/
const okStock = (s: string) => STOCKS.has(s) || TICKER.test(s)
const MAX_SYMBOLS = 80

function cached(seconds: number): Record<string, string> {
  return {
    "content-type": "application/json",
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=${seconds}, durable`,
  }
}
const noStore = { "content-type": "application/json", "Cache-Control": "no-store" }
const fail = (message: string, status: number) => Response.json({ message }, { status, headers: noStore })

async function relay(res: Response, seconds: number): Promise<Response> {
  const body = await res.text()
  return new Response(body, { status: res.status, headers: res.ok ? cached(seconds) : noStore })
}
function copy(from: URLSearchParams, keys: string[]): URLSearchParams {
  const out = new URLSearchParams()
  for (const k of keys) { const v = from.get(k); if (v) out.set(k, v.slice(0, 64)) }
  return out
}

export default async (req: Request, context: Context) => {
  const q = new URL(req.url).searchParams
  const keyId = Netlify.env.get("ALPACA_KEY_ID")
  const secret = Netlify.env.get("ALPACA_SECRET")
  const tdKey = Netlify.env.get("TWELVEDATA_KEY")
  const alpHeaders = { "APCA-API-KEY-ID": keyId ?? "", "APCA-API-SECRET-KEY": secret ?? "" }

  switch (context.params.route) {
    case "health":
      return Response.json({ alpaca: !!(keyId && secret), td: !!tdKey }, { headers: noStore })

    case "snapshots": {
      if (!keyId || !secret) return fail("Live prices aren't set up on this site yet.", 503)
      const symbols = [...new Set((q.get("symbols") ?? "").split(",").filter(okStock))].slice(0, MAX_SYMBOLS)
      if (!symbols.length) return fail("No supported symbols requested.", 400)
      const res = await fetch(`${ALP}/v2/stocks/snapshots?` + new URLSearchParams({ symbols: symbols.join(","), feed: "iex" }), { headers: alpHeaders })
      return relay(res, 3)
    }

    case "bars": {
      if (!keyId || !secret) return fail("Price history isn't set up on this site yet.", 503)
      const symbol = q.get("symbol") ?? ""
      if (!okStock(symbol)) return fail("Unsupported symbol.", 400)
      const p = copy(q, ["timeframe", "start", "end", "limit", "sort", "page_token", "adjustment"])
      p.set("feed", "sip")
      const tf = p.get("timeframe") ?? ""
      const seconds = tf.endsWith("Min") ? 120 : tf.endsWith("Hour") ? 900 : 3600
      const res = await fetch(`${ALP}/v2/stocks/${encodeURIComponent(symbol)}/bars?${p}`, { headers: alpHeaders })
      return relay(res, seconds)
    }

    case "asset": {
      // Confirms a ticker exists and returns its name and exchange, for "Add stock"
      if (!keyId || !secret) return fail("Stock lookup isn't set up on this site yet.", 503)
      const symbol = (q.get("symbol") ?? "").toUpperCase()
      if (!TICKER.test(symbol)) return fail("That doesn't look like a ticker symbol.", 400)
      const res = await fetch(`${TRADING}/v2/assets/${encodeURIComponent(symbol)}`, { headers: alpHeaders })
      if (res.status === 404) return fail(`No US stock or ETF found for ${symbol}.`, 404)
      if (!res.ok) return fail("Stock lookup failed. Try again in a moment.", 502)
      const a = await res.json()
      return Response.json(
        { symbol: a.symbol, name: a.name, exchange: a.exchange, assetClass: a.class, status: a.status },
        { headers: cached(86400) },
      )
    }

    case "crypto": {
      const pairs = [...CRYPTO].join(",")
      const headers = keyId && secret ? alpHeaders : undefined
      const res = await fetch(`${ALP}/v1beta3/crypto/us/snapshots?` + new URLSearchParams({ symbols: pairs }), { headers })
      return relay(res, 3)
    }

    case "quote": {
      if (!tdKey) return fail("OTC quotes aren't set up on this site yet.", 503)
      const symbol = q.get("symbol") ?? ""
      if (!okStock(symbol)) return fail("Unsupported symbol.", 400)
      const res = await fetch("https://api.twelvedata.com/quote?" + new URLSearchParams({ symbol, apikey: tdKey }))
      return relay(res, 120)
    }

    case "td": {
      if (!tdKey) return fail("Long-range history isn't set up on this site yet.", 503)
      const symbol = q.get("symbol") ?? ""
      if (!okStock(symbol) && !CRYPTO.has(symbol)) return fail("Unsupported symbol.", 400)
      const p = copy(q, ["symbol", "interval", "outputsize", "start_date", "order"])
      p.set("apikey", tdKey)
      const iv = p.get("interval") ?? ""
      const seconds = iv.endsWith("min") ? 300 : iv.endsWith("h") ? 900 : 3600
      const res = await fetch("https://api.twelvedata.com/time_series?" + p)
      return relay(res, seconds)
    }
  }
  return fail("Not found.", 404)
}

export const config: Config = { path: "/api/:route" }
