# ETCScreener

ETCScreener is a lean ETC-native DEX screener prototype for tracking Ethereum Classic pools, opening pair charts, saving pairs, and staging future premium alerts.

## Current MVP

- DEXScreener-style split screen with ETC pairs on the left and a selected chart on the right.
- Live ETC stats from `https://etc.blockscout.com/api/v2/stats`.
- Source link to the referenced Blockscout pools page: `https://etc.blockscout.com/pools`.
- Live ETC pool rows from `https://contracts-info.services.blockscout.com/api/v1/chains/61/pools`.
- Searchable and sortable pair list with liquidity, fee, market cap, DEX, contract, and external pool links.
- Native OHLCV chart for the selected pair using GeckoTerminal API data.
- Recent swap panel using GeckoTerminal trades when a pool has returned trade data.
- Render-ready Node server that serves the built app and proxies upstream APIs.

## Data Assumption

Blockscout exposes ETC chain stats through API v2. Pool rows use the contract-info service for chain `61`. Candles and trades use GeckoTerminal API data. The production Node server proxies these upstream calls so Render deployments do not break on browser CORS.

The current pool service does not provide all DEXScreener-style fields, so 24h volume, candle data, and price-change alerts still need a second source or deeper endpoint mapping before they should be treated as premium signals.

## Run Locally

```powershell
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Run Production Build Locally

```powershell
npm run build
npm start
```

Render can use the included `render.yaml`:

```yaml
buildCommand: npm ci && npm run build
startCommand: npm start
```

## Next Steps

1. Add richer transaction parsing if GeckoTerminal exposes more trade attributes for ETC.
2. Add saved watchlists and alert rules behind a lightweight account model.
3. Add route-level SEO/share previews for pool pages.
4. Add a paid tier only after live pool coverage and user demand are validated.
