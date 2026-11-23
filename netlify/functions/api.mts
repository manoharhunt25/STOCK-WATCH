import type { Config, Context } from "@netlify/functions"
// @ts-expect-error: plain JS module shared with the Cloudflare Worker
import { handleApi } from "../../src/api.js"

// Netlify Function entry point. All API logic lives in src/api.js.
export default async (req: Request, context: Context) =>
  handleApi(req, {
    ALPACA_KEY_ID: Netlify.env.get("ALPACA_KEY_ID"),
    ALPACA_SECRET: Netlify.env.get("ALPACA_SECRET"),
    TWELVEDATA_KEY: Netlify.env.get("TWELVEDATA_KEY"),
  }, context.params.route)

export const config: Config = { path: "/api/:route" }
