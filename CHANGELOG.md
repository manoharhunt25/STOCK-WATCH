# Changelog

All notable changes to STOCK Watch are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [1.6.0] - 2026-11-23

### Added
- **Cloudflare Workers hosting.** `wrangler.jsonc` and `src/worker.js` deploy the app on Cloudflare's free plan: static files from `public/`, the API on `/api/*`, with short-lived responses shared between visitors through the edge cache.

### Changed
- API logic moved into `src/api.js`, shared by Cloudflare and Netlify; `netlify/functions/api.mts` is now a thin wrapper.
- Refresh rates now adapt to save requests: stocks every 5 s while the page is in view during market hours (was 3 s), 15 s before and after hours, 30 s in a background tab and 5 min when the market is closed. Crypto every 5 s, 30 s in the background.
- Crypto prices are fetched straight from Alpaca's public feed, falling back to `/api/crypto` only if the browser can't reach it.
- The page refreshes immediately when a tab comes back into view.
- The API rejects anything other than GET and HEAD.

## [1.5.0] - 2026-11-23

### Added
- **Personal boards.** Every visitor starts with an empty board and builds their own; it's saved in their browser.
- **Crypto on the board.** Add any crypto Alpaca lists (BTC, ETH, SOL, DOGE and more) alongside stocks, using a Stock / Crypto switch.
- **Quick start.** Quick-add buttons for popular symbols and a one-click sample watchlist.
- **Custom categories.** Create, rename and delete categories; the board shows a section per category with filter chips.
- **Drag to arrange.** Reorder cards and move them between categories by dragging (desktop and touch), or with the category picker and Move earlier / Move later in each card's detail view.
- **Two-way price alerts.** Set a falls-to and/or rises-to price per symbol. Alerts fire as an on-page alert, a browser notification and a sound while the page is open, are drawn on the chart, and are managed in a new Alerts panel.
- **Undo** after removing a card (its alerts come back too).
- Version number shown in the header and footer.
- API: `/api/crypto` accepts any list of X/USD pairs; `/api/asset` resolves crypto pairs as well as stock tickers.

### Changed
- The board no longer ships with a fixed 37-stock watchlist; that list is now the optional sample watchlist.
- The market strip shows the Nasdaq-100, Dow Jones and S&P 500 only (BTC and ETH can be added to the board instead).
- Crypto prices and daily change now come from Alpaca for every coin; CoinGecko is no longer used.
- The live status on each card is a small dot instead of a text label.
- The API proxy validates symbols by format instead of a fixed allowlist.

### Migrated
- Stocks added with v1.1's "Add stock" are moved onto the new board automatically on first visit.

## [1.1.0] - 2026-11-19

### Added
- **Add stock.** Visitors can add any US stock or ETF by ticker; it's checked against Alpaca's asset list and saved in their browser under a "My stocks" group.
- API: `/api/asset` lookup route; the proxy accepts any well-formed ticker.

## [1.0.0] - 2026-11-10

### Added
- Live dashboard for a 37-stock watchlist plus BTC, ETH, SOL and XRP, with Nasdaq-100, Dow and S&P 500 benchmarks.
- 1D, 5D, 1M, 6M, YTD, 5Y and Lifetime history charts.
- Netlify Function proxy that keeps API keys on the server so anyone with the link gets live data.
- Light and dark themes and a phone layout.

[1.6.0]: https://github.com/manoharhunt25/STOCK-WATCH/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/manoharhunt25/STOCK-WATCH/compare/v1.1.0...v1.5.0
[1.1.0]: https://github.com/manoharhunt25/STOCK-WATCH/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/manoharhunt25/STOCK-WATCH/releases/tag/v1.0.0
