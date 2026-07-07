import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart } from "lightweight-charts";

const BLOCKSCOUT_BASE = "https://etc.blockscout.com";
const POOLS_API = "/contract-info/api/v1/chains/61/pools";
const BLOCKSCOUT_API = "/blockscout-api/api/v2";
const OHLCV_API = "/market-api/gecko/api/v2/networks/ethereum_classic/pools";
const TRADES_API = "/market-api/gecko/api/v2/networks/ethereum_classic/pools";
const POOL_DETAILS_API = "/market-api/gecko/api/v2/networks/ethereum_classic/pools/multi";

const state = {
  pools: [],
  selectedPoolId: null,
  query: "",
  sort: "liquidity",
  timeframe: "day",
  chartMode: "usd",
  candleRequest: 0,
  wetcUsd: null,
  latestCloseUsd: null,
  converterTokenAmount: 1,
  candleStore: new Map(),
  blockscoutCounters: new Set(),
  blockscoutAddresses: new Set(),
  poolDetails: new Set(),
  poolBalances: new Set(),
  chart: {
    api: null,
    candles: null,
    volume: null,
    resizeObserver: null,
  },
};

const els = {
  navPools: document.querySelector("#navPools"),
  poolsView: document.querySelector("#poolsView"),
  dataStatus: document.querySelector("#dataStatus"),
  etcPrice: document.querySelector("#etcPrice"),
  topLiquidity: document.querySelector("#topLiquidity"),
  dexCount: document.querySelector("#dexCount"),
  visiblePoolCount: document.querySelector("#visiblePoolCount"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  marketTabs: document.querySelector(".market-tabs"),
  poolRows: document.querySelector("#poolRows"),
  emptyState: document.querySelector("#emptyState"),
  selectedDex: document.querySelector("#selectedDex"),
  selectedPair: document.querySelector("#selectedPair"),
  selectedContract: document.querySelector("#selectedContract"),
  openBlockscout: document.querySelector("#openBlockscout"),
  openGecko: document.querySelector("#openGecko"),
  selectedPrice: document.querySelector("#selectedPrice"),
  selectedPriceLabel: document.querySelector("#selectedPriceLabel"),
  selectedChange: document.querySelector("#selectedChange"),
  selectedLiquidity: document.querySelector("#selectedLiquidity"),
  selectedMetricLiquidity: document.querySelector("#selectedMetricLiquidity"),
  selectedFee: document.querySelector("#selectedFee"),
  selectedWetcToken: document.querySelector("#selectedWetcToken"),
  selectedLpSupply: document.querySelector("#selectedLpSupply"),
  selectedMarketCap: document.querySelector("#selectedMarketCap"),
  selectedVolume: document.querySelector("#selectedVolume"),
  selectedWetcUsd: document.querySelector("#selectedWetcUsd"),
  selectedTransfers: document.querySelector("#selectedTransfers"),
  selectedVerified: document.querySelector("#selectedVerified"),
  selectedRisk: document.querySelector("#selectedRisk"),
  selectedPoolAddress: document.querySelector("#selectedPoolAddress"),
  nativeChart: document.querySelector("#nativeChart"),
  chartOhlc: document.querySelector("#chartOhlc"),
  chartCoverage: document.querySelector("#chartCoverage"),
  chartModeLabel: document.querySelector("#chartModeLabel"),
  chartLoading: document.querySelector("#chartLoading"),
  chartStatus: document.querySelector("#chartStatus"),
  converterPair: document.querySelector("#converterPair"),
  converterTokenLabel: document.querySelector("#converterTokenLabel"),
  converterTokenInput: document.querySelector("#converterTokenInput"),
  converterUsdInput: document.querySelector("#converterUsdInput"),
  converterRate: document.querySelector("#converterRate"),
  converterWetc: document.querySelector("#converterWetc"),
  txStatus: document.querySelector("#txStatus"),
  txRows: document.querySelector("#txRows"),
  txEmpty: document.querySelector("#txEmpty"),
  timeframes: document.querySelector(".timeframes"),
  chartModes: document.querySelector(".chart-modes"),
};

function money(value, compact = false) {
  if (!Number.isFinite(Number(value)) || Number(value) === 0) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: Number(value) < 1 ? 6 : 2,
  }).format(Number(value));
}

function priceForChart(value) {
  if (state.chartMode === "wetc") {
    if (!Number.isFinite(Number(value))) return "--";
    return `${Number(value).toLocaleString("en-US", { maximumFractionDigits: Number(value) < 1 ? 8 : 4 })} WETC`;
  }
  return money(value);
}

function decimal(value, maxFractionDigits = 8) {
  if (!Number.isFinite(Number(value))) return "";
  return Number(value).toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits: maxFractionDigits,
  });
}

function readNumberInput(value) {
  const clean = String(value || "").replace(/,/g, "").trim();
  if (!clean) return null;
  const number = Number(clean);
  return Number.isFinite(number) ? number : null;
}

function compactNumber(value) {
  if (!Number.isFinite(Number(value))) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value));
}

function compactTokenAmount(value) {
  if (!Number.isFinite(Number(value))) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: Number(value) >= 100000 ? "compact" : "standard",
    maximumFractionDigits: Number(value) < 1 ? 6 : 2,
  }).format(Number(value));
}

function scaledTokenSupply(raw, decimals) {
  const supply = Number(raw);
  const tokenDecimals = Number(decimals || 0);
  if (!Number.isFinite(supply) || !Number.isFinite(tokenDecimals)) return null;
  return supply / 10 ** tokenDecimals;
}

function shortAddress(address) {
  if (!address) return "--";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function riskLabel(score) {
  if (score < 40) return "Lower";
  if (score < 60) return "Medium";
  return "Watch";
}

function scorePoolRisk(pool) {
  let score = 72;
  if (pool.liquidity >= 100000) score -= 40;
  else if (pool.liquidity >= 10000) score -= 24;
  else if (pool.liquidity >= 1000) score -= 10;
  if (pool.marketCap > 0) score -= 8;
  if (pool.fee !== null) score -= 6;
  return Math.max(20, Math.min(86, score));
}

function mapPool(item) {
  const base = item.base_token_symbol || "UNKNOWN";
  const quote = item.quote_token_symbol || "UNKNOWN";
  const baseMarketCap = Number(item.base_token_market_cap_usd || item.base_token_fully_diluted_valuation_usd || 0);
  const quoteMarketCap = Number(item.quote_token_market_cap_usd || item.quote_token_fully_diluted_valuation_usd || 0);
  const pool = {
    id: item.pool_id || item.contract_address,
    baseAddress: item.base_token_address,
    quoteAddress: item.quote_token_address,
    baseSymbol: base,
    quoteSymbol: quote,
    pair: `${base} / ${quote}`,
    dex: item.dex?.name || "Unknown DEX",
    contract: item.contract_address,
    fee: item.fee === null || item.fee === undefined ? null : Number(item.fee),
    liquidity: Number(item.liquidity || 0),
    marketCap: baseMarketCap,
    quoteMarketCap,
    geckoUrl: item.coin_gecko_terminal_url,
    basePriceUsd: null,
    basePriceWetc: null,
    reserves: null,
    reservesChecked: false,
    transfers: null,
    verified: null,
    contractName: null,
  };
  pool.risk = scorePoolRisk(pool);
  return pool;
}

function visiblePools() {
  const query = state.query.toLowerCase();
  return [...state.pools]
    .filter((pool) => [pool.pair, pool.dex, pool.contract].some((value) => String(value || "").toLowerCase().includes(query)))
    .sort((a, b) => {
      if (state.sort === "baseMarketCap") return b.marketCap - a.marketCap;
      if (state.sort === "transfers") return (b.transfers || 0) - (a.transfers || 0);
      if (state.sort === "risk") return a.risk - b.risk;
      return b.liquidity - a.liquidity;
    });
}

function selectedPool() {
  return state.pools.find((pool) => pool.id === state.selectedPoolId) || null;
}

function chartModeLabel(pool) {
  if (!pool) return "--";
  if (state.chartMode === "wetc") return `${pool.baseSymbol}/WETC`;
  return `${pool.baseSymbol}/USD`;
}

function converterPriceWetc() {
  if (!state.latestCloseUsd || !state.wetcUsd) return null;
  return state.latestCloseUsd / state.wetcUsd;
}

function wetcPerToken(pool) {
  if (!pool) return null;
  if (Number.isFinite(Number(pool.basePriceWetc)) && Number(pool.basePriceWetc) > 0) return Number(pool.basePriceWetc);
  if (pool.baseSymbol?.toUpperCase() === "WETC") return 1;
  if (Number.isFinite(Number(pool.basePriceUsd)) && Number(pool.basePriceUsd) > 0 && Number(state.wetcUsd) > 0) {
    return Number(pool.basePriceUsd) / Number(state.wetcUsd);
  }
  return null;
}

function wetcPerTokenText(pool, includeUnit = false) {
  const value = wetcPerToken(pool);
  if (!Number.isFinite(value)) return pool?.basePriceWetc === null ? "..." : "--";
  const text = decimal(value, value < 1 ? 8 : 4);
  return includeUnit ? `${text} WETC` : text;
}

function reservePriority(pool, reserve) {
  const symbol = reserve.symbol.toUpperCase();
  if (symbol === "WETC") return 0;
  if (reserve.address?.toLowerCase() === pool.baseAddress?.toLowerCase()) return 1;
  if (reserve.address?.toLowerCase() === pool.quoteAddress?.toLowerCase()) return 2;
  return 3;
}

function lpSupplyText(pool) {
  if (!pool?.reservesChecked) return "...";
  if (!pool.reserves?.length) return "--";
  return [...pool.reserves]
    .sort((a, b) => reservePriority(pool, a) - reservePriority(pool, b))
    .slice(0, 2)
    .map((reserve) => `${compactTokenAmount(reserve.amount)} ${reserve.symbol}`)
    .join(" / ");
}

function syncConverter(source = "state") {
  const pool = selectedPool();
  const symbol = pool?.baseSymbol || "Token";
  const priceUsd = Number(state.latestCloseUsd);
  const tokenAmount = Number(state.converterTokenAmount);
  const canConvert = Number.isFinite(priceUsd) && priceUsd > 0;
  const hasAmount = Number.isFinite(tokenAmount) && tokenAmount >= 0;
  const priceWetc = converterPriceWetc();

  els.converterPair.textContent = pool ? `${symbol} / USD` : "--";
  els.converterTokenLabel.textContent = symbol;
  els.converterTokenInput.disabled = !canConvert;
  els.converterUsdInput.disabled = !canConvert;

  if (!canConvert) {
    if (source !== "token") els.converterTokenInput.value = hasAmount ? decimal(tokenAmount, 8) : "";
    if (source !== "usd") els.converterUsdInput.value = "";
    els.converterRate.textContent = `1 ${symbol} = --`;
    els.converterWetc.textContent = "-- WETC";
    return;
  }

  if (!hasAmount) {
    if (source !== "usd") els.converterUsdInput.value = "";
    els.converterRate.textContent = `1 ${symbol} = ${money(priceUsd)}`;
    els.converterWetc.textContent = priceWetc ? `1 ${symbol} = ${decimal(priceWetc, 8)} WETC` : "-- WETC";
    return;
  }

  const usdAmount = tokenAmount * priceUsd;
  const wetcAmount = priceWetc ? tokenAmount * priceWetc : null;

  if (source !== "token") els.converterTokenInput.value = decimal(tokenAmount, tokenAmount < 1 ? 8 : 6);
  if (source !== "usd") els.converterUsdInput.value = decimal(usdAmount, usdAmount < 1 ? 6 : 2);

  els.converterRate.textContent = `1 ${symbol} = ${money(priceUsd)}`;
  els.converterWetc.textContent = wetcAmount ? `${decimal(wetcAmount, wetcAmount < 1 ? 8 : 6)} WETC` : "-- WETC";
}

function renderPools() {
  const rows = visiblePools();
  els.emptyState.hidden = rows.length > 0;
  els.visiblePoolCount.textContent = rows.length;
  els.poolRows.innerHTML = rows
    .map(
      (pool) => `
        <a class="pool-row ${pool.id === state.selectedPoolId ? "active" : ""}" data-id="${pool.id}" href="#pool=${pool.id}">
          <span class="pair-cell">
              <span class="token-dot"><img src="/etc-shard.svg" alt="" /></span>
              <span>
                <strong>${pool.pair}</strong>
                <span>${shortAddress(pool.contract)}</span>
              </span>
          </span>
          <span>${pool.dex}</span>
          <span>${pool.fee === null ? `<span class="muted">--</span>` : `${pool.fee}%`}</span>
          <span>${pool.transfers === null ? `<span class="muted">...</span>` : compactNumber(pool.transfers)}</span>
          <span>${money(pool.liquidity, true)}</span>
          <span>${money(pool.marketCap, true)}</span>
          <span><span class="risk risk-${riskLabel(pool.risk).toLowerCase()}">${riskLabel(pool.risk)}</span></span>
        </a>
      `,
    )
    .join("");
  loadBlockscoutCounters(rows.slice(0, 50));
}

function renderOverview() {
  const top = [...state.pools].sort((a, b) => b.liquidity - a.liquidity)[0];
  els.topLiquidity.textContent = top ? money(top.liquidity, true) : "--";
  els.dexCount.textContent = new Set(state.pools.map((pool) => pool.dex)).size || "--";
  els.visiblePoolCount.textContent = visiblePools().length || "--";
}

function showView(name) {
  els.poolsView.classList.toggle("active", name === "pools");
}

function openPool(poolId) {
  state.selectedPoolId = poolId;
  showView("pools");
  renderPools();
  renderSelectedPool();
}

function routeFromHash() {
  const match = window.location.hash.match(/^#pool=(.+)$/);
  const poolId = match ? decodeURIComponent(match[1]) : null;
  if (poolId && state.pools.some((pool) => pool.id === poolId)) {
    openPool(poolId);
    return;
  }
  if (!state.selectedPoolId && state.pools.length) {
    openPool([...state.pools].sort((a, b) => b.liquidity - a.liquidity)[0].id);
    return;
  }
  showView("pools");
}

function renderSelectedPool() {
  const pool = selectedPool();
  if (!pool) return;
  els.selectedDex.textContent = pool.dex;
  els.selectedPair.textContent = pool.pair;
  els.selectedContract.textContent = shortAddress(pool.contract);
  els.openBlockscout.href = `${BLOCKSCOUT_BASE}/address/${pool.contract}`;
  els.openGecko.href = pool.geckoUrl || "https://www.geckoterminal.com/ethereum_classic/pools";
  els.selectedPriceLabel.textContent = `Last close - ${state.chartMode === "wetc" ? "Token/WETC" : "Token/USD"}`;
  els.selectedPrice.textContent = "--";
  els.selectedChange.textContent = "Waiting for candles";
  state.latestCloseUsd = null;
  syncConverter("state");
  els.selectedLiquidity.textContent = money(pool.liquidity, true);
  els.selectedMetricLiquidity.textContent = money(pool.liquidity, true);
  els.selectedFee.textContent = pool.fee === null ? "--" : `${pool.fee}%`;
  els.selectedWetcToken.textContent = wetcPerTokenText(pool, true);
  els.selectedLpSupply.textContent = lpSupplyText(pool);
  els.selectedMarketCap.textContent = money(pool.marketCap, true);
  els.selectedVolume.textContent = "--";
  els.selectedWetcUsd.textContent = state.wetcUsd ? money(state.wetcUsd) : "--";
  els.selectedTransfers.textContent = pool.transfers === null ? "Loading" : compactNumber(pool.transfers);
  els.selectedVerified.textContent = pool.verified === null ? "Checking" : pool.verified ? "Verified" : "Unverified";
  els.selectedRisk.textContent = riskLabel(pool.risk);
  els.selectedPoolAddress.textContent = shortAddress(pool.contract);
  loadBlockscoutCounters([pool]);
  loadBlockscoutAddresses([pool]);
  loadPoolBalances(pool);
  loadPoolDetails([pool]);
  loadCandles(pool);
  loadTrades(pool);
}

async function fetchBlockscoutJson(path) {
  const response = await fetch(`${BLOCKSCOUT_API}${path}`);
  if (!response.ok) throw new Error(`Blockscout returned ${response.status}`);
  return response.json();
}

async function loadBlockscoutCounters(pools) {
  const targets = pools.filter((pool) => pool?.contract && !state.blockscoutCounters.has(pool.contract) && pool.transfers === null);
  if (!targets.length) return;

  targets.forEach((pool) => state.blockscoutCounters.add(pool.contract));
  const chunks = [];
  for (let i = 0; i < targets.length; i += 10) chunks.push(targets.slice(i, i + 10));

  let changed = false;
  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (pool) => {
        try {
          const counters = await fetchBlockscoutJson(`/addresses/${pool.contract}/counters`);
          pool.transfers = Number(counters.token_transfers_count || counters.transactions_count || 0);
          changed = true;
        } catch (error) {
          state.blockscoutCounters.delete(pool.contract);
          console.warn(error);
        }
      }),
    );
  }

  if (changed) {
    renderPools();
    updateSelectedMetadata();
  }
}

function hydrateBlockscoutAddress(pool, address) {
  pool.verified = Boolean(address.is_verified);
  pool.contractName = address.name || null;
}

function updateSelectedMetadata() {
  const pool = selectedPool();
  if (!pool) return;
  els.selectedTransfers.textContent = pool.transfers === null ? "--" : compactNumber(pool.transfers);
  els.selectedVerified.textContent = pool.verified === null ? "Checking" : pool.verified ? "Verified" : "Unverified";
  els.selectedWetcToken.textContent = wetcPerTokenText(pool, true);
  els.selectedLpSupply.textContent = lpSupplyText(pool);
  els.selectedMetricLiquidity.textContent = money(pool.liquidity, true);
}

async function loadBlockscoutAddresses(pools) {
  const targets = pools.filter(
    (pool) => pool?.contract && !state.blockscoutAddresses.has(pool.contract) && pool.verified === null,
  );
  if (!targets.length) return;

  targets.forEach((pool) => state.blockscoutAddresses.add(pool.contract));
  const chunks = [];
  for (let i = 0; i < targets.length; i += 8) chunks.push(targets.slice(i, i + 8));

  let changed = false;
  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (pool) => {
        try {
          const address = await fetchBlockscoutJson(`/addresses/${pool.contract}`);
          hydrateBlockscoutAddress(pool, address);
          changed = true;
        } catch (error) {
          state.blockscoutAddresses.delete(pool.contract);
          console.warn(error);
        }
      }),
    );
  }

  if (changed) {
    renderPools();
    updateSelectedMetadata();
  }
}

function hydratePoolBalances(pool, payload) {
  const pairAddresses = new Set([pool.baseAddress?.toLowerCase(), pool.quoteAddress?.toLowerCase()].filter(Boolean));
  pool.reserves = (payload.items || [])
    .map((item) => {
      const token = item.token || {};
      return {
        address: token.address_hash || "",
        symbol: token.symbol || "TOKEN",
        amount: scaledTokenSupply(item.value, token.decimals),
      };
    })
    .filter((reserve) => pairAddresses.has(reserve.address.toLowerCase()) && Number.isFinite(Number(reserve.amount)));
  pool.reservesChecked = true;
}

async function loadPoolBalances(pool) {
  if (!pool?.contract || state.poolBalances.has(pool.contract)) return;
  state.poolBalances.add(pool.contract);

  try {
    const payload = await fetchBlockscoutJson(`/addresses/${pool.contract}/tokens?type=ERC-20`);
    hydratePoolBalances(pool, payload);
    updateSelectedMetadata();
  } catch (error) {
    pool.reservesChecked = true;
    state.poolBalances.delete(pool.contract);
    updateSelectedMetadata();
    console.warn(error);
  }
}

async function fetchPoolDetails(poolIds) {
  const response = await fetch(`${POOL_DETAILS_API}/${poolIds.join(",")}`);
  if (!response.ok) throw new Error(`GeckoTerminal pool details returned ${response.status}`);
  return response.json();
}

function hydratePoolDetails(item) {
  const address = item.attributes?.address?.toLowerCase();
  const pool = state.pools.find((candidate) => candidate.contract?.toLowerCase() === address);
  if (!pool) return false;

  pool.basePriceUsd = Number(item.attributes?.base_token_price_usd || 0) || null;
  pool.basePriceWetc = Number(item.attributes?.base_token_price_native_currency || 0) || null;
  return true;
}

async function loadPoolDetails(pools) {
  const targets = pools.filter((pool) => pool?.contract && !state.poolDetails.has(pool.contract) && pool.basePriceWetc === null);
  if (!targets.length) return;

  targets.forEach((pool) => state.poolDetails.add(pool.contract));
  const chunks = [];
  for (let i = 0; i < targets.length; i += 20) chunks.push(targets.slice(i, i + 20));

  let changed = false;
  for (const chunk of chunks) {
    try {
      const payload = await fetchPoolDetails(chunk.map((pool) => pool.contract));
      changed = (payload.data || []).map(hydratePoolDetails).some(Boolean) || changed;
    } catch (error) {
      chunk.forEach((pool) => state.poolDetails.delete(pool.contract));
      console.warn(error);
    }
  }

  if (changed) {
    renderPools();
    updateSelectedMetadata();
  }
}

function timeframeParams() {
  if (state.timeframe === "minute") return { unit: "minute", aggregate: 15, label: "15M", limit: 300 };
  if (state.timeframe === "day") return { unit: "day", aggregate: 1, label: "1D", limit: 1000 };
  return { unit: "hour", aggregate: 1, label: "1H", limit: 1000 };
}

function dailyFrame() {
  return { unit: "day", aggregate: 1, label: "1D", limit: 1000 };
}

function candleCacheKey(poolId, frame) {
  return `etcscreener:candles:${poolId}:${frame.unit}:${frame.aggregate}:${frame.limit || "default"}`;
}

function readCachedCandles(poolId, frame) {
  try {
    const cached = JSON.parse(localStorage.getItem(candleCacheKey(poolId, frame)) || "null");
    if (!cached || Date.now() - cached.savedAt > 1000 * 60 * 20) return null;
    return normalizeCandles(cached.candles || []);
  } catch {
    return null;
  }
}

function writeCachedCandles(poolId, frame, candles) {
  state.candleStore.set(candleCacheKey(poolId, frame), candles);
  try {
    localStorage.setItem(candleCacheKey(poolId, frame), JSON.stringify({ savedAt: Date.now(), candles }));
  } catch {
    // Cache failures should never block the market surface.
  }
}

function normalizeCandles(candles) {
  const byTime = new Map();
  candles
    .map((candle) => ({
      time: Number(candle.time),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume || 0),
    }))
    .filter(
      (candle) =>
        Number.isFinite(candle.time) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close),
    )
    .forEach((candle) => byTime.set(candle.time, candle));
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function updateOhlc(data, frame) {
  if (!data) {
    els.chartOhlc.textContent = "Hover chart for OHLC";
    return;
  }
  const move = ((data.close - data.open) / (data.open || 1)) * 100;
  els.chartOhlc.innerHTML = `
    <span>O ${priceForChart(data.open)}</span>
    <span>H ${priceForChart(data.high)}</span>
    <span>L ${priceForChart(data.low)}</span>
    <span>C ${priceForChart(data.close)}</span>
    <strong class="${move >= 0 ? "positive" : "negative"}">${move >= 0 ? "+" : ""}${move.toFixed(2)}%</strong>
    <span>${frame.label}</span>
  `;
}

function ensureChart(frame) {
  if (state.chart.api) return;

  const chart = createChart(els.nativeChart, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "#05080c" },
      textColor: "#96a3b4",
      fontFamily: "Inter, system-ui, sans-serif",
    },
    grid: {
      vertLines: { color: "rgba(150, 163, 180, 0.08)" },
      horzLines: { color: "rgba(150, 163, 180, 0.12)" },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: "rgba(86, 199, 255, 0.5)", labelBackgroundColor: "#13202b" },
      horzLine: { color: "rgba(86, 199, 255, 0.5)", labelBackgroundColor: "#13202b" },
    },
    rightPriceScale: {
      borderColor: "rgba(150, 163, 180, 0.18)",
      scaleMargins: { top: 0.08, bottom: 0.24 },
    },
    timeScale: {
      borderColor: "rgba(150, 163, 180, 0.18)",
      timeVisible: frame.unit !== "day",
      secondsVisible: false,
      rightOffset: 8,
      barSpacing: 8,
    },
    localization: {
      priceFormatter: (price) => priceForChart(price),
    },
    handleScale: {
      axisPressedMouseMove: true,
      mouseWheel: true,
      pinch: true,
    },
    handleScroll: {
      horzTouchDrag: true,
      mouseWheel: true,
      pressedMouseMove: true,
      vertTouchDrag: false,
    },
  });

  const candles = chart.addSeries(CandlestickSeries, {
    upColor: "#19d27f",
    downColor: "#ff5968",
    borderUpColor: "#19d27f",
    borderDownColor: "#ff5968",
    wickUpColor: "#19d27f",
    wickDownColor: "#ff5968",
    priceLineColor: "#56c7ff",
    priceLineWidth: 1,
    lastValueVisible: true,
  });

  const volume = chart.addSeries(HistogramSeries, {
    priceFormat: { type: "volume" },
    priceScaleId: "",
    lastValueVisible: false,
    priceLineVisible: false,
  });

  chart.priceScale("").applyOptions({
    scaleMargins: { top: 0.78, bottom: 0 },
  });

  chart.subscribeCrosshairMove((param) => {
    const point = param.seriesData?.get(candles);
    updateOhlc(point, frame);
  });

  state.chart.api = chart;
  state.chart.candles = candles;
  state.chart.volume = volume;
}

function clearChartData() {
  state.chart.candles?.setData([]);
  state.chart.volume?.setData([]);
  els.chartCoverage.textContent = "Coverage --";
  state.latestCloseUsd = null;
  syncConverter("state");
  updateOhlc(null, timeframeParams());
}

function chartCandlesForMode(candles) {
  if (state.chartMode !== "wetc") return candles;
  if (!state.wetcUsd || state.wetcUsd <= 0) return [];
  return candles.map((candle) => ({
    ...candle,
    open: candle.open / state.wetcUsd,
    high: candle.high / state.wetcUsd,
    low: candle.low / state.wetcUsd,
    close: candle.close / state.wetcUsd,
  }));
}

async function fetchCandles(poolId, frame) {
  const url = `${OHLCV_API}/${poolId}/ohlcv/${frame.unit}?aggregate=${frame.aggregate}&limit=${frame.limit}&currency=usd`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GeckoTerminal returned ${response.status}`);
  return response.json();
}

async function fetchTrades(poolId) {
  const response = await fetch(`${TRADES_API}/${poolId}/trades?limit=20`);
  if (!response.ok) throw new Error(`GeckoTerminal returned ${response.status}`);
  return response.json();
}

async function loadCandles(pool) {
  if (!pool) {
    els.chartLoading.hidden = false;
    els.chartLoading.textContent = "No chart source available.";
    els.chartStatus.textContent = "Chart unavailable";
    clearChartData();
    return;
  }
  const requestId = ++state.candleRequest;
  const frame = timeframeParams();
  const label = chartModeLabel(pool);
  const memoryCandles = state.candleStore.get(candleCacheKey(pool.id, frame));
  const cachedCandles = memoryCandles?.length ? memoryCandles : readCachedCandles(pool.id, frame);
  if (cachedCandles?.length) {
    renderCandles(cachedCandles, pool, frame, "Cached OHLCV");
    return;
  }
  els.chartLoading.hidden = false;
  els.chartLoading.textContent = `Loading ${label} candles...`;
  els.chartStatus.textContent = `Loading ${label} ${frame.label}`;
  els.chartModeLabel.textContent = state.chartMode === "wetc" ? "Token/WETC" : "Token/USD";
  try {
    let activeFrame = frame;
    let payload = await fetchCandles(pool.id, activeFrame);
    if ((payload.data?.attributes?.ohlcv_list || []).length < 3 && activeFrame.unit !== "day") {
      activeFrame = dailyFrame();
      payload = await fetchCandles(pool.id, activeFrame);
    }
    if (requestId !== state.candleRequest) return;
    const candles = normalizeCandles(
      (payload.data?.attributes?.ohlcv_list || [])
      .map(([time, open, high, low, close, volume]) => ({
        time,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      })),
    );
    writeCachedCandles(pool.id, activeFrame, candles);
    renderCandles(candles, pool, activeFrame, "GeckoTerminal OHLCV");
  } catch (error) {
    if (requestId !== state.candleRequest) return;
    const cached = readCachedCandles(pool.id, frame);
    if (cached?.length) {
      renderCandles(cached, pool, frame, "Cached OHLCV");
      els.chartStatus.textContent = "Cached candles";
      return;
    }
    els.chartLoading.textContent = error.message.includes("429")
      ? `${label} chart temporarily rate limited. Open GeckoTerminal for the live chart.`
      : `Chart unavailable: ${error.message}`;
    clearChartData();
    els.chartStatus.textContent = "Chart unavailable";
    els.selectedPrice.textContent = "--";
    els.selectedChange.textContent = "Chart unavailable";
    els.selectedChange.className = "";
    els.selectedVolume.textContent = "--";
    console.warn(error);
  }
}

function renderCandles(candles, pool, frame, sourceLabel = "GeckoTerminal OHLCV") {
  const cleanCandles = normalizeCandles(candles);
  const chartCandles = chartCandlesForMode(cleanCandles);
  if (!cleanCandles.length) {
    els.chartLoading.hidden = false;
    els.chartLoading.textContent = "No candles for this pool yet.";
    updateOhlc(null, frame);
    return;
  }
  if (!chartCandles.length) {
    els.chartLoading.hidden = false;
    els.chartLoading.textContent = "WETC reference unavailable for Token/WETC chart.";
    clearChartData();
    return;
  }
  els.chartLoading.hidden = true;

  ensureChart(frame);

  const first = chartCandles[0];
  const last = chartCandles[chartCandles.length - 1];
  const lastUsd = cleanCandles[cleanCandles.length - 1];
  const firstDate = new Date(first.time * 1000);
  const lastDate = new Date(last.time * 1000);
  const change = ((last.close - first.open) / (first.open || 1)) * 100;
  const totalVolume = cleanCandles.reduce((sum, candle) => sum + candle.volume, 0);
  const label = chartModeLabel(pool);
  const candleData = chartCandles.map((candle) => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
  const volumeData = cleanCandles.map((candle) => ({
    time: candle.time,
    value: candle.volume,
    color: candle.close >= candle.open ? "rgba(25, 210, 127, 0.28)" : "rgba(255, 89, 104, 0.26)",
  }));

  state.chart.api.applyOptions({
    localization: {
      priceFormatter: (price) => priceForChart(price),
    },
    timeScale: {
      timeVisible: frame.unit !== "day",
      barSpacing: frame.unit === "minute" ? 5 : 8,
    },
  });
  state.chart.candles.setData(candleData);
  state.chart.volume.setData(volumeData);
  state.chart.api.timeScale().fitContent();
  updateOhlc(last, frame);

  els.selectedPrice.textContent = priceForChart(last.close);
  state.latestCloseUsd = lastUsd.close;
  if (!Number.isFinite(Number(pool.basePriceUsd))) pool.basePriceUsd = lastUsd.close;
  if (!Number.isFinite(Number(pool.basePriceWetc)) && Number(state.wetcUsd) > 0) pool.basePriceWetc = lastUsd.close / state.wetcUsd;
  syncConverter("state");
  updateSelectedMetadata();
  els.selectedPriceLabel.textContent = `Last close - ${state.chartMode === "wetc" ? "Token/WETC" : "Token/USD"}`;
  els.selectedChange.textContent = `${label} - ${frame.label} ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
  els.selectedChange.className = change >= 0 ? "positive" : "negative";
  els.selectedVolume.textContent = money(totalVolume, true);
  els.chartStatus.textContent = `${sourceLabel} | ${label} | ${cleanCandles.length} candles`;
  els.chartCoverage.textContent = `${firstDate.toLocaleDateString()} - ${lastDate.toLocaleDateString()}`;
  els.chartModeLabel.textContent = state.chartMode === "wetc" ? "Token/WETC" : "Token/USD";
}

async function loadTrades(pool) {
  els.txStatus.textContent = "Loading swaps";
  els.txRows.innerHTML = "";
  els.txEmpty.hidden = true;

  try {
    const payload = await fetchTrades(pool.id);
    const trades = (payload.data || []).map(normalizeTrade).filter(Boolean);
    renderTrades(trades);
  } catch (error) {
    els.txStatus.textContent = "Trades unavailable";
    els.txEmpty.hidden = false;
    els.txEmpty.textContent = `Swap feed unavailable: ${error.message}`;
    console.warn(error);
  }
}

function normalizeTrade(item) {
  const attrs = item.attributes || {};
  const kind = attrs.kind || attrs.trade_type || attrs.tx_type || "swap";
  const txHash = attrs.tx_hash || attrs.transaction_hash || attrs.txn_hash || attrs.hash || "";
  const volume = Number(attrs.volume_in_usd || attrs.volume_usd || attrs.amount_in_usd || attrs.usd_volume || 0);
  const price = Number(attrs.price_to_in_usd || attrs.price_from_in_usd || attrs.price_in_usd || attrs.price || 0);
  const timestamp = attrs.block_timestamp || attrs.timestamp || attrs.created_at || "";
  return {
    kind,
    txHash,
    volume,
    price,
    timestamp,
  };
}

function renderTrades(trades) {
  if (!trades.length) {
    els.txStatus.textContent = "No recent swaps";
    els.txEmpty.hidden = false;
    els.txEmpty.textContent = "No recent swaps returned for this pool. Thin ETC pools may have sparse trade feeds.";
    return;
  }

  els.txStatus.textContent = `${trades.length} swaps`;
  els.txEmpty.hidden = true;
  els.txRows.innerHTML = `
    <div class="tx-head">
      <span>Type</span>
      <span>Value</span>
      <span>Price</span>
      <span>Time</span>
      <span>Tx</span>
    </div>
    ${trades
      .map((trade) => {
        const type = trade.kind.toLowerCase().includes("sell") ? "Sell" : trade.kind.toLowerCase().includes("buy") ? "Buy" : "Swap";
        return `
          <a class="tx-row" href="${trade.txHash ? `${BLOCKSCOUT_BASE}/tx/${trade.txHash}` : "#"}" target="_blank" rel="noreferrer">
            <span class="${type === "Sell" ? "negative" : "positive"}">${type}</span>
            <span>${money(trade.volume, true)}</span>
            <span>${money(trade.price)}</span>
            <span>${formatTime(trade.timestamp)}</span>
            <span>${trade.txHash ? shortAddress(trade.txHash) : "--"}</span>
          </a>
        `;
      })
      .join("")}
  `;
}

function formatTime(timestamp) {
  if (!timestamp) return "--";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function loadStats() {
  try {
    const response = await fetch(`${BLOCKSCOUT_BASE}/api/v2/stats`);
    const stats = await response.json();
    state.wetcUsd = Number(stats.coin_price || 0) || null;
    els.etcPrice.textContent = `ETC ${money(state.wetcUsd)}`;
    const pool = selectedPool();
    if (pool) els.selectedWetcUsd.textContent = money(state.wetcUsd);
    syncConverter("state");
    updateSelectedMetadata();
  } catch {
    els.etcPrice.textContent = "ETC --";
  }
}

async function loadPools() {
  try {
    const response = await fetch(`${POOLS_API}?items_count=80`);
    if (!response.ok) throw new Error(`Blockscout pools returned ${response.status}`);
    const payload = await response.json();
    state.pools = (payload.items || []).map(mapPool);
    els.dataStatus.textContent = `${state.pools.length} ETC pools`;
    renderOverview();
    renderPools();
    routeFromHash();
  } catch (error) {
    els.dataStatus.textContent = "Pools unavailable";
    console.warn(error);
  }
}

els.navPools.addEventListener("click", () => {
  history.pushState("", document.title, window.location.pathname + window.location.search);
  showView("pools");
});

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderPools();
});

els.sortSelect.addEventListener("change", (event) => {
  state.sort = event.target.value;
  els.marketTabs.querySelectorAll("button").forEach((tab) => tab.classList.toggle("active", tab.dataset.sort === state.sort));
  renderPools();
});

els.marketTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-sort]");
  if (!button) return;
  state.sort = button.dataset.sort;
  els.sortSelect.value = state.sort;
  els.marketTabs.querySelectorAll("button").forEach((tab) => tab.classList.toggle("active", tab === button));
  renderPools();
});

els.timeframes.addEventListener("click", (event) => {
  const button = event.target.closest("[data-timeframe]");
  if (!button) return;
  state.timeframe = button.dataset.timeframe;
  els.timeframes.querySelectorAll("button").forEach((tab) => tab.classList.toggle("active", tab === button));
  loadCandles(selectedPool());
});

els.chartModes.addEventListener("click", (event) => {
  const button = event.target.closest("[data-chart-mode]");
  if (!button) return;
  state.chartMode = button.dataset.chartMode;
  els.chartModes.querySelectorAll("button").forEach((tab) => tab.classList.toggle("active", tab === button));
  loadCandles(selectedPool());
});

els.converterTokenInput.addEventListener("input", (event) => {
  const value = readNumberInput(event.target.value);
  state.converterTokenAmount = value === null || value < 0 ? null : value;
  syncConverter("token");
});

els.converterUsdInput.addEventListener("input", (event) => {
  const value = readNumberInput(event.target.value);
  const priceUsd = Number(state.latestCloseUsd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return;
  state.converterTokenAmount = value === null || value < 0 ? null : value / priceUsd;
  syncConverter("usd");
});

window.addEventListener("hashchange", routeFromHash);

loadStats();
loadPools();
