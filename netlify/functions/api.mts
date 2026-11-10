import type { Config, Context } from "@netlify/functions"

// Proxy for the STOCK Watch dashboard: keeps API keys on the server and
// only answers for the dashboard's own symbols.
const STOCKS = new Set(["AAPL", "AMD", "AMZN", "ASML", "AVGO", "BLK", "CBRS", "COHR", "COPX", "CRWV", "DIA", "ECVT", "GLD", "HGRAF", "INDO", "INTC", "IREN", "LITE", "MRVL", "MSTR", "MU", "NBIS", "NVDA", "PLTR", "QBTS", "QQQ", "QUBT", "RACE", "SLV", "SNDK", "SOUN", "SPCE", "SPCX", "STX", "TSM", "VOO", "VSXY", "WDC", "XNDU"])
const CRYPTO = new Set(["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"])
const OTC = new Set(["HGRAF"]) // not covered by Alpaca's free feed; priced via Twelve Data
const ALP = "https://data.alpaca.markets"

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
      const symbols = (q.get("symbols") ?? "").split(",").filter((s) => STOCKS.has(s))
      if (!symbols.length) return fail("No supported symbols requested.", 400)
      const res = await fetch(`${ALP}/v2/stocks/snapshots?` + new URLSearchParams({ symbols: symbols.join(","), feed: "iex" }), { headers: alpHeaders })
      return relay(res, 3)
    }

    case "bars": {
      if (!keyId || !secret) return fail("Price history isn't set up on this site yet.", 503)
      const symbol = q.get("symbol") ?? ""
      if (!STOCKS.has(symbol)) return fail("Unsupported symbol.", 400)
      const p = copy(q, ["timeframe", "start", "end", "limit", "sort", "page_token", "adjustment"])
      p.set("feed", "sip")
      const tf = p.get("timeframe") ?? ""
      const seconds = tf.endsWith("Min") ? 120 : tf.endsWith("Hour") ? 900 : 3600
      const res = await fetch(`${ALP}/v2/stocks/${encodeURIComponent(symbol)}/bars?${p}`, { headers: alpHeaders })
      return relay(res, seconds)
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
      if (!OTC.has(symbol)) return fail("Unsupported symbol.", 400)
      const res = await fetch("https://api.twelvedata.com/quote?" + new URLSearchParams({ symbol, apikey: tdKey }))
      return relay(res, 120)
    }

    case "td": {
      if (!tdKey) return fail("Long-range history isn't set up on this site yet.", 503)
      const symbol = q.get("symbol") ?? ""
      if (!STOCKS.has(symbol) && !CRYPTO.has(symbol)) return fail("Unsupported symbol.", 400)
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
