import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart } from "lightweight-charts";

const BLOCKSCOUT_BASE = "https://etc.blockscout.com";
const POOLS_API = "/contract-info/api/v1/chains/61/pools";
const BLOCKSCOUT_API = "/blockscout-api/api/v2";
const OHLCV_API = "/market-api/gecko/api/v2/networks/ethereum_classic/pools";
const TRADES_API = "/market-api/gecko/api/v2/networks/ethereum_classic/pools";
const POOL_DETAILS_API = "/market-api/gecko/api/v2/networks/ethereum_classic/pools/multi";
const DEAD_LP_API = "/api/dead-lp";
const POOL_TAPE_API = "/api/pool-tape";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
const MIN_DISPLAY_TOKEN_AMOUNT = 0.000001;
const TX_REFRESH_INTERVAL_MS = 45 * 1000;
const POOL_TAPE_CACHE_VERSION = 5;
const POOL_TAPE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const HISTORICAL_POOL_TRANSFER_PAGES = 24;
const HISTORICAL_LP_TRANSFER_PAGES = 80;

const state = {
  pools: [],
  selectedPoolId: null,
  view: "market",
  query: "",
  sort: "liquidity",
  timeframe: "day",
  chartMode: "usd",
  txFilter: "all",
  txQuery: {
    minUsd: null,
    minWetc: null,
    minToken: null,
    fromDate: "",
    toDate: "",
  },
  candleRequest: 0,
  transactionRequest: 0,
  transactionRefreshTimer: null,
  wetcUsd: null,
  latestCloseUsd: null,
  converterTokenAmount: 1,
  transactions: [],
  candleStore: new Map(),
  poolTapeIndexing: new Set(),
  deadLpChecks: new Set(),
  blockscoutCounters: new Set(),
  blockscoutAddresses: new Set(),
  poolDetails: new Set(),
  poolBalances: new Set(),
  tokenAgeCache: new Map(),
  tokenAgeRequests: new Set(),
  tokenInfoCache: new Map(),
  tokenInfoRequests: new Map(),
  chart: {
    api: null,
    candles: null,
    volume: null,
    resizeObserver: null,
  },
};

const els = {
  navPools: document.querySelector("#navPools"),
  navTerminal: document.querySelector("#navTerminal"),
  poolsView: document.querySelector("#poolsView"),
  dataStatus: document.querySelector("#dataStatus"),
  etcPrice: document.querySelector("#etcPrice"),
  topLiquidity: document.querySelector("#topLiquidity"),
  indexedLiquidity: document.querySelector("#indexedLiquidity"),
  indexedLiquidityMeta: document.querySelector("#indexedLiquidityMeta"),
  dexCount: document.querySelector("#dexCount"),
  visiblePoolCount: document.querySelector("#visiblePoolCount"),
  deadLpPoolCount: document.querySelector("#deadLpPoolCount"),
  contextIndexedLiquidity: document.querySelector("#contextIndexedLiquidity"),
  contextVisiblePools: document.querySelector("#contextVisiblePools"),
  contextLiquidityTotal: document.querySelector("#contextLiquidityTotal"),
  contextVolumeTotal: document.querySelector("#contextVolumeTotal"),
  dexLiquidityRows: document.querySelector("#dexLiquidityRows"),
  dexVolumeRows: document.querySelector("#dexVolumeRows"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  marketTabs: document.querySelector(".market-tabs"),
  poolRows: document.querySelector("#poolRows"),
  emptyState: document.querySelector("#emptyState"),
  backToPairs: document.querySelector("#backToPairs"),
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
  selectedStatMarketCap: document.querySelector("#selectedStatMarketCap"),
  selectedStatVolume24h: document.querySelector("#selectedStatVolume24h"),
  selectedStatTokenAge: document.querySelector("#selectedStatTokenAge"),
  selectedStatDeadLp: document.querySelector("#selectedStatDeadLp"),
  selectedWetcToken: document.querySelector("#selectedWetcToken"),
  selectedLpSupply: document.querySelector("#selectedLpSupply"),
  selectedMarketCap: document.querySelector("#selectedMarketCap"),
  selectedAgeLabel: document.querySelector("#selectedAgeLabel"),
  selectedTokenAge: document.querySelector("#selectedTokenAge"),
  selectedTokenHolders: document.querySelector("#selectedTokenHolders"),
  selectedLpHolders: document.querySelector("#selectedLpHolders"),
  selectedVolume24h: document.querySelector("#selectedVolume24h"),
  selectedWetcUsd: document.querySelector("#selectedWetcUsd"),
  selectedTransfers: document.querySelector("#selectedTransfers"),
  selectedVerified: document.querySelector("#selectedVerified"),
  selectedRisk: document.querySelector("#selectedRisk"),
  selectedPoolAddress: document.querySelector("#selectedPoolAddress"),
  infoPairLabel: document.querySelector("#infoPairLabel"),
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
  txFilters: document.querySelector(".tx-filters"),
  txMinUsd: document.querySelector("#txMinUsd"),
  txMinWetc: document.querySelector("#txMinWetc"),
  txMinToken: document.querySelector("#txMinToken"),
  txDateFrom: document.querySelector("#txDateFrom"),
  txDateTo: document.querySelector("#txDateTo"),
  txClearFilters: document.querySelector("#txClearFilters"),
  lpBurnSummary: document.querySelector("#lpBurnSummary"),
  lpDeadBalance: document.querySelector("#lpDeadBalance"),
  lpBurnRows: document.querySelector("#lpBurnRows"),
  lpDeadPercent: document.querySelector("#lpDeadPercent"),
  timeframes: document.querySelector(".timeframes"),
  chartModes: document.querySelector(".chart-modes"),
};

function money(value, compact = false) {
  if (!Number.isFinite(Number(value)) || Number(value) === 0) return "--";
  if (!compact && Math.abs(Number(value)) < 0.0001) return `$${compactDecimal(value, 10)}`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: Number(value) < 1 ? 6 : 2,
  }).format(Number(value));
}

function moneyZero(value, compact = false) {
  if (!Number.isFinite(Number(value))) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: 2,
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

function compactDecimal(value, maxFractionDigits = 8) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const standard = decimal(numeric, maxFractionDigits);
  if (Number(standard) !== 0 || numeric === 0) return standard;
  return numeric.toExponential(2);
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

function timestampToTime(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function ageText(value) {
  const time = timestampToTime(value);
  if (time === null) return null;
  const days = Math.max(0, Math.floor((Date.now() - time) / 86400000));
  if (days >= 365) {
    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    return months ? `${years}y ${months}m` : `${years}y`;
  }
  if (days >= 30) {
    const months = Math.floor(days / 30);
    const restDays = days % 30;
    return restDays ? `${months}m ${restDays}d` : `${months}m`;
  }
  return `${days}d`;
}

function selectedAgeInfo(pool) {
  if (!pool) return { label: "Token age", value: "--" };
  const tokenAge = ageText(pool.tokenCreatedAt);
  if (tokenAge) return { label: "Token age", value: tokenAge };
  const poolAge = ageText(pool.poolCreatedAt);
  if (poolAge) return { label: "Pool age", value: poolAge };
  const indexedAge = ageText(pool.firstIndexedAt);
  if (indexedAge) return { label: "First indexed", value: indexedAge };
  return { label: "Token age", value: pool.tokenAgeStatus === "loading" ? "Checking" : "--" };
}

function scaledTokenSupply(raw, decimals) {
  const supply = Number(raw);
  const tokenDecimals = Number(decimals || 0);
  if (!Number.isFinite(supply) || !Number.isFinite(tokenDecimals)) return null;
  return supply / 10 ** tokenDecimals;
}

function tokenHolderCount(tokenInfo) {
  const count = Number(tokenInfo?.holders_count ?? tokenInfo?.holdersCount ?? tokenInfo?.holders ?? tokenInfo?.holder_count);
  return Number.isFinite(count) ? count : null;
}

function tokenTotalSupply(tokenInfo) {
  const rawSupply = tokenInfo?.total_supply ?? tokenInfo?.totalSupply;
  if (rawSupply === null || rawSupply === undefined || rawSupply === "") return null;
  const supply = scaledTokenSupply(rawSupply, tokenInfo?.decimals);
  return Number.isFinite(Number(supply)) ? Number(supply) : null;
}

function deadLpPercent(deadBalance, totalSupply) {
  if (deadBalance === null || deadBalance === undefined || deadBalance === "") return null;
  const amount = Number(deadBalance);
  const supply = Number(totalSupply);
  if (!Number.isFinite(amount) || !Number.isFinite(supply) || supply <= 0) return null;
  return Math.max(0, Math.min(100, (amount / supply) * 100));
}

function deadLpPercentText(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return "--";
  if (percent > 0 && percent < 0.01) return "<0.01%";
  return `${percent.toFixed(percent >= 10 ? 1 : 2)}%`;
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
    volume24hUsd: null,
    deadLpStatus: "unknown",
    deadLpAmount: null,
    deadLpSymbol: "LP",
    deadLpLockRows: null,
    deadLpPercent: null,
    tokenHolderCount: null,
    lpHolderCount: null,
    lpTotalSupply: null,
    holderFactsStatus: "unknown",
    poolCreatedAt: item.pool_created_at || null,
    tokenCreatedAt: null,
    tokenAgeStatus: "unknown",
    firstIndexedAt: null,
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
      if (state.sort === "transfers") return (b.volume24hUsd || b.transfers || 0) - (a.volume24hUsd || a.transfers || 0);
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

function volume24hText(pool) {
  if (pool?.volume24hUsd === null || pool?.volume24hUsd === undefined) return "...";
  return moneyZero(pool.volume24hUsd, true);
}

function deadLpText(pool) {
  if (pool.deadLpStatus === "checking") return "Indexing";
  if (pool.deadLpStatus === "error") return "Retry";
  if (pool.deadLpStatus === "locked") return `${compactTokenAmount(pool.deadLpAmount)} ${pool.deadLpSymbol || "LP"}`;
  if (pool.deadLpStatus === "none") return "None";
  return "...";
}

function deadLpClass(pool) {
  if (pool.deadLpStatus === "locked") return "dead-lp-locked";
  if (pool.deadLpStatus === "none") return "dead-lp-none";
  if (pool.deadLpStatus === "error") return "dead-lp-error";
  return "dead-lp-checking";
}

function deadLpBadge(pool) {
  return `<span class="dead-lp-badge ${deadLpClass(pool)}">${deadLpText(pool)}</span>`;
}

function deadLpPoolCountText(pools = visiblePools()) {
  const checked = pools.filter((pool) => ["locked", "none", "error"].includes(pool.deadLpStatus));
  const locked = pools.filter((pool) => pool.deadLpStatus === "locked").length;
  if (!checked.length) return "...";
  return `${locked}/${checked.length}`;
}

function poolAgeText(pool) {
  return ageText(pool?.tokenCreatedAt) || ageText(pool?.poolCreatedAt) || ageText(pool?.firstIndexedAt) || "--";
}

function totalIndexedLiquidity(pools = state.pools) {
  return pools.reduce((sum, pool) => sum + (Number(pool.liquidity) || 0), 0);
}

function totalIndexedVolume(pools = state.pools) {
  return pools.reduce((sum, pool) => sum + (Number(pool.volume24hUsd) || 0), 0);
}

function groupDexMetrics(pools = state.pools) {
  const groups = new Map();
  pools.forEach((pool) => {
    const dex = pool.dex || "Unknown";
    const current = groups.get(dex) || { dex, liquidity: 0, volume: 0, pools: 0 };
    current.liquidity += Number(pool.liquidity) || 0;
    current.volume += Number(pool.volume24hUsd) || 0;
    current.pools += 1;
    groups.set(dex, current);
  });
  return [...groups.values()];
}

function renderContextRows(rows, metric) {
  const max = Math.max(...rows.map((row) => row[metric]), 0);
  if (!rows.length) return `<div class="context-empty">No pool data yet.</div>`;
  return rows
    .map((row) => {
      const value = Number(row[metric]) || 0;
      const percent = max > 0 ? Math.round((value / max) * 100) : 0;
      return `
        <div class="context-data-row">
          <span>${escapeHtml(row.dex)}</span>
          <strong>${metric === "volume" ? moneyZero(value, true) : money(value, true)}</strong>
          <i style="--bar:${percent}%"></i>
          <small>${row.pools} pools</small>
        </div>
      `;
    })
    .join("");
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
  els.deadLpPoolCount.textContent = deadLpPoolCountText(rows);
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
          <span>${volume24hText(pool)}</span>
          <span>${money(pool.liquidity, true)}</span>
          <span>${money(pool.marketCap, true)}</span>
          <span>${deadLpBadge(pool)}</span>
          <span><span class="risk risk-${riskLabel(pool.risk).toLowerCase()}">${riskLabel(pool.risk)}</span></span>
          <span>${poolAgeText(pool)}</span>
        </a>
      `,
    )
    .join("");
  renderMarketContext();
  loadPoolDetails(rows.slice(0, 50));
  loadBlockscoutCounters(rows.slice(0, 50));
  loadDeadLpSummaries(rows.slice(0, 80));
}

function renderOverview() {
  const top = [...state.pools].sort((a, b) => b.liquidity - a.liquidity)[0];
  els.topLiquidity.textContent = top ? money(top.liquidity, true) : "--";
  els.indexedLiquidity.textContent = money(totalIndexedLiquidity(), true);
  els.indexedLiquidityMeta.textContent = `${state.pools.length || "--"} indexed pools`;
  els.dexCount.textContent = new Set(state.pools.map((pool) => pool.dex)).size || "--";
  els.visiblePoolCount.textContent = visiblePools().length || "--";
  els.deadLpPoolCount.textContent = deadLpPoolCountText();
  renderMarketContext();
}

function renderMarketContext() {
  const liquidity = totalIndexedLiquidity();
  const volume = totalIndexedVolume();
  const dexGroups = groupDexMetrics();
  const liquidityRows = [...dexGroups].sort((a, b) => b.liquidity - a.liquidity).slice(0, 5);
  const volumeRows = [...dexGroups].sort((a, b) => b.volume - a.volume).slice(0, 5);

  els.contextIndexedLiquidity.textContent = money(liquidity, true);
  els.contextVisiblePools.textContent = visiblePools().length || "--";
  els.contextLiquidityTotal.textContent = money(liquidity, true);
  els.contextVolumeTotal.textContent = moneyZero(volume, true);
  els.dexLiquidityRows.innerHTML = renderContextRows(liquidityRows, "liquidity");
  els.dexVolumeRows.innerHTML = renderContextRows(volumeRows, "volume");
}

function setNavState(name) {
  els.navPools.classList.toggle("active", name === "market");
  els.navTerminal.classList.toggle("active", name === "terminal");
}

function showView(name) {
  state.view = name;
  els.poolsView.classList.toggle("market-mode", name === "market");
  els.poolsView.classList.toggle("terminal-mode", name === "terminal");
  setNavState(name);
  if (name === "market") stopTransactionRefresh();
}

function openPool(poolId) {
  state.selectedPoolId = poolId;
  showView("terminal");
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
  showView("market");
  renderPools();
}

function renderSelectedPool() {
  const pool = selectedPool();
  if (!pool) return;
  setTxFilter("all");
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
  els.selectedStatMarketCap.textContent = money(pool.marketCap, true);
  els.selectedStatVolume24h.textContent = volume24hText(pool);
  els.selectedStatDeadLp.textContent = deadLpText(pool);
  els.selectedWetcToken.textContent = wetcPerTokenText(pool, true);
  els.selectedLpSupply.textContent = lpSupplyText(pool);
  els.selectedMarketCap.textContent = money(pool.marketCap, true);
  updateSelectedAge(pool);
  updateSelectedHolderFacts(pool);
  els.selectedVolume24h.textContent = volume24hText(pool);
  els.selectedWetcUsd.textContent = state.wetcUsd ? money(state.wetcUsd) : "--";
  els.selectedTransfers.textContent = pool.transfers === null ? "Loading" : compactNumber(pool.transfers);
  els.selectedVerified.textContent = pool.verified === null ? "Checking" : pool.verified ? "Verified" : "Unverified";
  els.selectedRisk.textContent = riskLabel(pool.risk);
  els.selectedPoolAddress.textContent = shortAddress(pool.contract);
  els.infoPairLabel.textContent = primaryTokenSymbol(pool) || pool.baseSymbol || "Token";
  loadBlockscoutCounters([pool]);
  loadBlockscoutAddresses([pool]);
  loadPoolBalances(pool);
  loadPoolDetails([pool]);
  loadTokenAge(pool);
  loadPairHolderFacts(pool);
  loadCandles(pool);
  loadTrades(pool);
  startTransactionRefresh(pool.id);
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
  els.selectedVolume24h.textContent = volume24hText(pool);
  els.selectedStatMarketCap.textContent = money(pool.marketCap, true);
  els.selectedStatVolume24h.textContent = volume24hText(pool);
  els.selectedStatDeadLp.textContent = deadLpText(pool);
  updateSelectedAge(pool);
  updateSelectedHolderFacts(pool);
}

function updateSelectedAge(pool = selectedPool()) {
  if (!pool) return;
  const age = selectedAgeInfo(pool);
  els.selectedAgeLabel.textContent = age.label;
  els.selectedTokenAge.textContent = age.value;
  els.selectedStatTokenAge.textContent = age.value;
}

function updateSelectedHolderFacts(pool = selectedPool()) {
  if (!pool) return;
  const pending = pool.holderFactsStatus === "loading" ? "Checking" : "--";
  els.selectedTokenHolders.textContent = pool.tokenHolderCount === null ? pending : compactNumber(pool.tokenHolderCount);
  els.selectedLpHolders.textContent = pool.lpHolderCount === null ? pending : compactNumber(pool.lpHolderCount);
}

async function fetchTokenInfo(address) {
  const normalized = String(address || "").toLowerCase();
  if (!normalized) return null;
  if (state.tokenInfoCache.has(normalized)) return state.tokenInfoCache.get(normalized);
  if (!state.tokenInfoRequests.has(normalized)) {
    const request = fetchBlockscoutJson(`/tokens/${normalized}`)
      .then((tokenInfo) => {
        state.tokenInfoCache.set(normalized, tokenInfo || null);
        return tokenInfo || null;
      })
      .finally(() => state.tokenInfoRequests.delete(normalized));
    state.tokenInfoRequests.set(normalized, request);
  }
  return state.tokenInfoRequests.get(normalized);
}

function applyPairHolderFacts(pool, tokenInfo, lpInfo) {
  const holderCount = tokenHolderCount(tokenInfo);
  const lpHolders = tokenHolderCount(lpInfo);
  const totalSupply = tokenTotalSupply(lpInfo);

  if (holderCount !== null) pool.tokenHolderCount = holderCount;
  if (lpHolders !== null) pool.lpHolderCount = lpHolders;
  if (totalSupply !== null) pool.lpTotalSupply = totalSupply;
  pool.deadLpPercent = deadLpPercent(pool.deadLpAmount, pool.lpTotalSupply);
}

async function loadPairHolderFacts(pool) {
  const tokenAddress = primaryTokenAddress(pool)?.toLowerCase();
  const lpAddress = pool?.contract?.toLowerCase();
  if (!pool || (!tokenAddress && !lpAddress)) return;
  if (pool.holderFactsStatus === "known") {
    updateSelectedHolderFacts(pool);
    updateLpLockSummary(lpLockSummaryFromPool(pool));
    return;
  }

  pool.holderFactsStatus = "loading";
  updateSelectedHolderFacts(pool);
  const selectedPoolId = pool.id;

  try {
    const [tokenResult, lpResult] = await Promise.allSettled([
      tokenAddress ? fetchTokenInfo(tokenAddress) : Promise.resolve(null),
      lpAddress ? fetchTokenInfo(lpAddress) : Promise.resolve(null),
    ]);
    const tokenInfo = tokenResult.status === "fulfilled" ? tokenResult.value : null;
    const lpInfo = lpResult.status === "fulfilled" ? lpResult.value : null;
    applyPairHolderFacts(pool, tokenInfo, lpInfo);
    pool.holderFactsStatus = tokenInfo || lpInfo ? "known" : "error";
  } catch (error) {
    pool.holderFactsStatus = "error";
    console.warn(error);
  }

  const activePool = selectedPool();
  if (activePool?.id === selectedPoolId) {
    updateSelectedMetadata();
    updateLpLockSummary(lpLockSummaryFromPool(activePool));
  }
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

function applyTokenAge(pool, tokenAddress, result) {
  if (!pool || !sameAddress(primaryTokenAddress(pool), tokenAddress)) return;
  pool.tokenCreatedAt = result.createdAt || null;
  pool.tokenAgeStatus = result.status || "unknown";
  updateSelectedAge(pool);
}

async function loadTokenAge(pool) {
  const tokenAddress = primaryTokenAddress(pool)?.toLowerCase();
  if (!pool || !tokenAddress) return;

  const cached = state.tokenAgeCache.get(tokenAddress);
  if (cached) {
    applyTokenAge(pool, tokenAddress, cached);
    return;
  }
  if (state.tokenAgeRequests.has(tokenAddress)) return;

  state.tokenAgeRequests.add(tokenAddress);
  pool.tokenAgeStatus = "loading";
  updateSelectedAge(pool);

  try {
    const address = await fetchBlockscoutJson(`/addresses/${tokenAddress}`);
    let createdAt = null;
    if (address.creation_transaction_hash) {
      const transaction = await fetchBlockscoutJson(`/transactions/${address.creation_transaction_hash}`);
      createdAt = transaction.timestamp || null;
    }
    const result = { createdAt, status: createdAt ? "known" : "unknown" };
    state.tokenAgeCache.set(tokenAddress, result);

    const activePool = selectedPool();
    if (activePool?.id === pool.id) applyTokenAge(activePool, tokenAddress, result);
  } catch (error) {
    const result = { createdAt: null, status: "error" };
    state.tokenAgeCache.set(tokenAddress, result);
    const activePool = selectedPool();
    if (activePool?.id === pool.id) applyTokenAge(activePool, tokenAddress, result);
    console.warn(error);
  } finally {
    state.tokenAgeRequests.delete(tokenAddress);
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
  pool.poolCreatedAt = item.attributes?.pool_created_at || pool.poolCreatedAt || null;
  pool.volume24hUsd = Number(item.attributes?.volume_usd?.h24 ?? item.attributes?.volume_usd?.["24h"]);
  if (!Number.isFinite(pool.volume24hUsd)) pool.volume24hUsd = null;
  return true;
}

async function loadPoolDetails(pools) {
  const targets = pools.filter(
    (pool) =>
      pool?.contract &&
      !state.poolDetails.has(pool.contract) &&
      (pool.basePriceWetc === null || pool.basePriceUsd === null || pool.volume24hUsd === null),
  );
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

async function loadDeadLpSummaries(pools) {
  const targets = pools.filter(
    (pool) =>
      pool?.contract &&
      pool.deadLpStatus === "unknown" &&
      !state.deadLpChecks.has(pool.contract.toLowerCase()),
  );
  if (!targets.length) return;

  targets.forEach((pool) => {
    state.deadLpChecks.add(pool.contract.toLowerCase());
    pool.deadLpStatus = "checking";
  });
  renderPools();

  const chunks = [];
  for (let i = 0; i < targets.length; i += 16) chunks.push(targets.slice(i, i + 16));

  let changed = false;
  for (const chunk of chunks) {
    try {
      const payload = await fetchDeadLpBatch(chunk);
      (payload.results || []).forEach((result) => {
        const pool = state.pools.find((item) => sameAddress(item.contract, result.contract));
        if (!pool) return;
        if (result.status === "error") {
          pool.deadLpStatus = "error";
          pool.deadLpAmount = null;
          pool.deadLpLockRows = null;
          changed = true;
          return;
        }
        changed = applyDeadLpSummary(pool, apiDeadLpToSummary(result)) || changed;
      });
    } catch (error) {
      chunk.forEach((pool) => {
        pool.deadLpStatus = "error";
        changed = true;
      });
      console.warn(error);
    }
  }

  if (changed) {
    renderPools();
    updateSelectedMetadata();
    updateLpLockSummary(lpLockSummaryFromPool(selectedPool()));
  }
}

function timeframeParams() {
  if (state.timeframe === "minute") return { unit: "minute", aggregate: 15, label: "15M", limit: 300 };
  if (state.timeframe === "hour4") return { unit: "hour", aggregate: 4, label: "4H", limit: 1000 };
  if (state.timeframe === "day") return { unit: "day", aggregate: 1, label: "1D", limit: 1000 };
  if (state.timeframe === "max") return { unit: "day", aggregate: 1, label: "Max", limit: 1000 };
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

function poolTapeCacheKey(pool) {
  return `etcscreener:pool-tape:v${POOL_TAPE_CACHE_VERSION}:${pool.contract?.toLowerCase() || pool.id}`;
}

function readCachedPoolTape(pool) {
  try {
    const cached = JSON.parse(localStorage.getItem(poolTapeCacheKey(pool)) || "null");
    if (!cached || Date.now() - Number(cached.savedAt || 0) > POOL_TAPE_CACHE_TTL_MS) return null;
    if (!Array.isArray(cached.transactions)) return null;
    return {
      transactions: cached.transactions,
      lpLockSummary: cached.lpLockSummary || null,
    };
  } catch {
    return null;
  }
}

function writeCachedPoolTape(pool, transactions, lpLockSummary) {
  try {
    localStorage.setItem(
      poolTapeCacheKey(pool),
      JSON.stringify({
        savedAt: Date.now(),
        transactions: transactions.slice(0, 1200),
        lpLockSummary,
      }),
    );
  } catch {
    // Historical tape cache is a speed-up, not a product dependency.
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
      background: { type: ColorType.Solid, color: "#070b10" },
      textColor: "#a8b4c4",
      fontFamily: "Inter, system-ui, sans-serif",
    },
    grid: {
      vertLines: { color: "rgba(125, 145, 165, 0.11)" },
      horzLines: { color: "rgba(125, 145, 165, 0.12)" },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: "rgba(50, 229, 139, 0.56)", labelBackgroundColor: "#0e1f18" },
      horzLine: { color: "rgba(50, 229, 139, 0.56)", labelBackgroundColor: "#0e1f18" },
    },
    rightPriceScale: {
      borderColor: "rgba(125, 145, 165, 0.18)",
      scaleMargins: { top: 0.08, bottom: 0.24 },
    },
    timeScale: {
      borderColor: "rgba(125, 145, 165, 0.18)",
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
    upColor: "#20e28a",
    downColor: "#ff4f5e",
    borderUpColor: "#20e28a",
    borderDownColor: "#ff4f5e",
    wickUpColor: "#20e28a",
    wickDownColor: "#ff4f5e",
    priceLineColor: "#20e28a",
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
  const response = await fetch(`${TRADES_API}/${poolId}/trades?limit=100`);
  if (!response.ok) throw new Error(`GeckoTerminal returned ${response.status}`);
  return response.json();
}

async function fetchPoolTokenTransfers(pool, maxPages = 3) {
  const items = [];
  let nextPageParams = null;

  for (let page = 0; page < maxPages; page += 1) {
    const query = nextPageParams ? `?${new URLSearchParams(nextPageParams).toString()}` : "";
    const payload = await fetchBlockscoutJson(`/addresses/${pool.contract}/token-transfers${query}`);
    items.push(...(payload.items || []));
    if (!payload.next_page_params) break;
    nextPageParams = payload.next_page_params;
  }

  return items;
}

async function fetchLpTokenTransfers(pool, maxPages = 25) {
  const items = [];
  let nextPageParams = null;

  for (let page = 0; page < maxPages; page += 1) {
    const query = nextPageParams ? `?${new URLSearchParams(nextPageParams).toString()}` : "";
    const payload = await fetchBlockscoutJson(`/tokens/${pool.contract}/transfers${query}`);
    items.push(...(payload.items || []));
    if (!payload.next_page_params) break;
    nextPageParams = payload.next_page_params;
  }

  return items;
}

async function fetchLpTokenHolders(pool, maxPages = 10) {
  const items = [];
  let nextPageParams = null;

  for (let page = 0; page < maxPages; page += 1) {
    const query = nextPageParams ? `?${new URLSearchParams(nextPageParams).toString()}` : "";
    const payload = await fetchBlockscoutJson(`/tokens/${pool.contract}/holders${query}`);
    items.push(...(payload.items || []));
    if (!payload.next_page_params) break;
    nextPageParams = payload.next_page_params;
  }

  return items;
}

async function fetchDeadLpBatch(pools) {
  const contracts = pools.map((pool) => pool.contract).filter(Boolean).join(",");
  const response = await fetch(`${DEAD_LP_API}?contracts=${encodeURIComponent(contracts)}`);
  if (!response.ok) throw new Error(`Dead LP index returned ${response.status}`);
  return response.json();
}

async function fetchPoolTapeIndex(pool) {
  const response = await fetch(
    `${POOL_TAPE_API}/${pool.contract}?poolPages=${HISTORICAL_POOL_TRANSFER_PAGES}&lpPages=${HISTORICAL_LP_TRANSFER_PAGES}&holderPages=10`,
  );
  if (!response.ok) throw new Error(`Pool tape index returned ${response.status}`);
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
    color: candle.close >= candle.open ? "rgba(32, 226, 138, 0.34)" : "rgba(255, 79, 94, 0.3)",
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
  els.chartStatus.textContent = `${sourceLabel} | ${label} | ${cleanCandles.length} candles`;
  els.chartCoverage.textContent = `${firstDate.toLocaleDateString()} - ${lastDate.toLocaleDateString()}`;
  els.chartModeLabel.textContent = state.chartMode === "wetc" ? "Token/WETC" : "Token/USD";
}

async function loadTrades(pool, options = {}) {
  const { silent = false } = options;
  const requestId = ++state.transactionRequest;
  if (!silent) {
    state.transactions = [];
    els.txStatus.textContent = "Loading txns";
    els.txRows.innerHTML = "";
    els.txEmpty.hidden = true;
    updateLpLockSummary(null);
  } else if (state.transactions.length) {
    els.txStatus.textContent = "Refreshing txns";
  }

  try {
    const [tradeResult, transferResult, lpTransferResult, lpHolderResult] = await Promise.allSettled([
      fetchTrades(pool.id),
      fetchPoolTokenTransfers(pool),
      fetchLpTokenTransfers(pool),
      fetchLpTokenHolders(pool),
    ]);
    if (requestId !== state.transactionRequest) return;

    const trades =
      tradeResult.status === "fulfilled" ? (tradeResult.value.data || []).map((item) => normalizeGeckoTrade(item, pool)).filter(Boolean) : [];
    const transfers = transferResult.status === "fulfilled" ? transferResult.value : [];
    const lpTransfers = lpTransferResult.status === "fulfilled" ? lpTransferResult.value : [];
    const lpHolders = lpHolderResult.status === "fulfilled" ? lpHolderResult.value : [];
    const cachedTape = readCachedPoolTape(pool);
    const liveTransactions = buildTransactions(pool, trades, transfers, lpTransfers);
    const liveSummary = summarizeLpLocks(pool, lpTransfers, lpHolders);
    const mergedSummary = mergeLpLockSummaries(liveSummary, cachedTape?.lpLockSummary);
    if (applyDeadLpSummary(pool, mergedSummary)) updateSelectedMetadata();
    state.transactions = mergeTransactions(liveTransactions, cachedTape?.transactions || []);
    updateFirstIndexedAge(pool);
    updateLpLockSummary(mergedSummary);
    renderTransactions();
    if (!silent) loadHistoricalPoolTape(pool, mergedSummary).catch(console.warn);
  } catch (error) {
    if (requestId !== state.transactionRequest) return;
    if (silent && state.transactions.length) {
      renderTransactions();
    } else {
      els.txStatus.textContent = "Txns unavailable";
      els.txEmpty.hidden = false;
      els.txEmpty.textContent = `Transaction feed unavailable: ${error.message}`;
    }
    console.warn(error);
  }
}

async function loadHistoricalPoolTape(pool, seedSummary = null) {
  const cacheKey = poolTapeCacheKey(pool);
  if (readCachedPoolTape(pool) || state.poolTapeIndexing.has(cacheKey)) return;

  state.poolTapeIndexing.add(cacheKey);
  try {
    const selectedPoolId = pool.id;
    const indexPayload = await fetchPoolTapeIndex(pool);
    const activePool = selectedPool();
    if (!activePool || activePool.id !== selectedPoolId) return;

    const transfers = indexPayload.poolTransfers || [];
    const lpTransfers = indexPayload.lpTransfers || [];
    const lpHolders = indexPayload.lpHolders || [];
    const historicalTransactions = buildTransactions(pool, [], transfers, lpTransfers);
    const historicalSummary = mergeLpLockSummaries(summarizeLpLocks(pool, lpTransfers, lpHolders), apiDeadLpToSummary(indexPayload.deadLp));
    writeCachedPoolTape(pool, historicalTransactions, historicalSummary);

    state.transactions = mergeTransactions(state.transactions, historicalTransactions);
    updateFirstIndexedAge(pool);
    const mergedSummary = mergeLpLockSummaries(seedSummary, historicalSummary);
    if (applyDeadLpSummary(pool, mergedSummary)) updateSelectedMetadata();
    updateLpLockSummary(mergedSummary);
    renderTransactions();
  } finally {
    state.poolTapeIndexing.delete(cacheKey);
  }
}

function startTransactionRefresh(poolId) {
  stopTransactionRefresh();
  state.transactionRefreshTimer = window.setInterval(() => {
    if (document.hidden) return;
    const pool = selectedPool();
    if (!pool || pool.id !== poolId) return;
    loadTrades(pool, { silent: true });
  }, TX_REFRESH_INTERVAL_MS);
}

function stopTransactionRefresh() {
  if (!state.transactionRefreshTimer) return;
  window.clearInterval(state.transactionRefreshTimer);
  state.transactionRefreshTimer = null;
}

function normalizeGeckoTrade(item, pool) {
  const attrs = item.attributes || {};
  const kind = attrs.kind || attrs.trade_type || attrs.tx_type || "swap";
  const txHash = attrs.tx_hash || attrs.transaction_hash || attrs.txn_hash || attrs.hash || "";
  const volume = Number(attrs.volume_in_usd || attrs.volume_usd || attrs.amount_in_usd || attrs.usd_volume || 0);
  const price = Number(attrs.price_to_in_usd || attrs.price_from_in_usd || attrs.price_in_usd || attrs.price || 0);
  const timestamp = attrs.block_timestamp || attrs.timestamp || attrs.created_at || "";
  const type = kind.toLowerCase().includes("sell") ? "Sell" : kind.toLowerCase().includes("buy") ? "Buy" : "Trade";
  return {
    id: `gecko:${txHash || item.id || timestamp}`,
    category: "swap",
    source: "Gecko",
    type,
    txHash: txHash.toLowerCase(),
    maker: attrs.maker || attrs.trader_address || attrs.tx_from_address || "",
    tokenAmount: null,
    tokenSymbol: primaryTokenSymbol(pool),
    wetcAmount: null,
    valueUsd: Number.isFinite(volume) && volume > 0 ? volume : null,
    priceUsd: Number.isFinite(price) && price > 0 ? price : null,
    priceWetc: null,
    timestamp,
  };
}

function buildTransactions(pool, trades, transfers, lpTransfers = []) {
  const tradesByHash = new Map(trades.filter((trade) => trade.txHash).map((trade) => [trade.txHash, trade]));
  const events = normalizeTransferEvents(pool, transfers).map((event) => {
    const trade = tradesByHash.get(event.txHash);
    if (!trade) return event;
    tradesByHash.delete(event.txHash);
    return {
      ...event,
      source: "Gecko + Blockscout",
      type: trade.type === "Trade" ? event.type : trade.type || event.type,
      valueUsd: trade.valueUsd || event.valueUsd,
      priceUsd: trade.priceUsd || event.priceUsd,
      maker: trade.maker || event.maker,
    };
  });

  tradesByHash.forEach((trade) => events.push(trade));
  events.push(...normalizeDeadLpEvents(pool, lpTransfers));
  return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function normalizeTransferEvents(pool, transfers) {
  const groups = new Map();

  transfers.forEach((item) => {
    const txHash = item.transaction_hash?.toLowerCase();
    if (!txHash) return;
    if (!groups.has(txHash)) {
      groups.set(txHash, {
        txHash,
        timestamp: item.timestamp || "",
        blockNumber: Number(item.block_number || 0),
        method: item.method || "",
        transfers: [],
      });
    }
    const group = groups.get(txHash);
    group.timestamp = group.timestamp || item.timestamp || "";
    group.blockNumber = Math.max(group.blockNumber, Number(item.block_number || 0));
    group.transfers.push(normalizePoolTransfer(item, pool));
  });

  return [...groups.values()].map((group) => classifyTransferGroup(group, pool)).filter(Boolean);
}

function normalizeDeadLpEvents(pool, transfers) {
  const groups = new Map();

  transfers
    .filter((item) => isDeadWalletAddress(item.to?.hash))
    .forEach((item) => {
      const txHash = item.transaction_hash?.toLowerCase();
      if (!txHash) return;
      if (!groups.has(txHash)) {
        groups.set(txHash, {
          txHash,
          timestamp: item.timestamp || "",
          transfers: [],
        });
      }
      const group = groups.get(txHash);
      group.timestamp = group.timestamp || item.timestamp || "";
      group.transfers.push(normalizeLpTransfer(item));
    });

  return [...groups.values()].map((group) => classifyDeadLpGroup(group, pool)).filter(Boolean);
}

function normalizePoolTransfer(item, pool) {
  const token = item.token || {};
  const from = item.from?.hash || "";
  const to = item.to?.hash || "";
  const amount = scaledTokenSupply(item.total?.value, item.total?.decimals ?? token.decimals);
  return {
    address: token.address_hash || "",
    symbol: token.symbol || "TOKEN",
    amount,
    from,
    to,
    direction: sameAddress(to, pool.contract) ? "in" : sameAddress(from, pool.contract) ? "out" : "move",
  };
}

function normalizeLpTransfer(item) {
  const token = item.token || {};
  return {
    from: item.from?.hash || "",
    to: item.to?.hash || "",
    amount: scaledTokenSupply(item.total?.value, item.total?.decimals ?? token.decimals),
    symbol: token.symbol || "LP",
    method: item.method || "",
    kind: item.type || "",
  };
}

function summarizeLpLocks(pool, lpTransfers, lpHolders) {
  const deadTransfers = lpTransfers
    .filter((item) => isDeadWalletAddress(item.to?.hash))
    .map(normalizeLpTransfer)
    .filter((transfer) => Number(transfer.amount) >= MIN_DISPLAY_TOKEN_AMOUNT);
  const decimals = lpTokenDecimals(lpTransfers);
  const symbol = deadTransfers[0]?.symbol || lpTokenSymbol(lpTransfers) || "LP";
  const deadTransferred = deadTransfers.reduce((sum, transfer) => sum + Number(transfer.amount || 0), 0);
  const deadHolder = lpHolders.find((holder) => sameAddress(holder.address?.hash, DEAD_ADDRESS));
  const deadBalance = deadHolder ? scaledTokenSupply(deadHolder.value, decimals) : deadTransferred;

  if (!deadTransfers.length && !Number(deadBalance)) return null;

  return {
    symbol,
    deadBalance,
    lockRows: deadTransfers.length,
    holderCount: pool.lpHolderCount,
    totalSupply: pool.lpTotalSupply,
    deadPercent: deadLpPercent(deadBalance, pool.lpTotalSupply),
  };
}

function mergeTransactions(...transactionLists) {
  const byId = new Map();
  transactionLists.flat().forEach((event) => {
    if (!event) return;
    const id = event.id || `${event.category}:${event.type}:${event.txHash || event.timestamp}`;
    byId.set(id, { ...(byId.get(id) || {}), ...event, id });
  });
  return [...byId.values()].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function updateFirstIndexedAge(pool, transactions = state.transactions) {
  if (!pool || !transactions?.length) return;
  const oldestTime = transactions.reduce((oldest, event) => {
    const time = timestampToTime(event.timestamp);
    if (time === null) return oldest;
    return oldest === null || time < oldest ? time : oldest;
  }, null);
  if (oldestTime === null) return;
  const oldestIso = new Date(oldestTime).toISOString();
  if (!pool.firstIndexedAt || oldestTime < timestampToTime(pool.firstIndexedAt)) {
    pool.firstIndexedAt = oldestIso;
    updateSelectedAge(pool);
  }
}

function mergeLpLockSummaries(...summaries) {
  const valid = summaries.filter(Boolean);
  if (!valid.length) return null;
  const symbol = valid.find((summary) => summary.symbol)?.symbol || "LP";
  const deadBalance = Math.max(...valid.map((summary) => Number(summary.deadBalance) || 0));
  const lockRows = Math.max(...valid.map((summary) => Number(summary.lockRows) || 0));
  const holderCount = maxFinite(valid.map((summary) => summary.holderCount));
  const totalSupply = maxFinite(valid.map((summary) => summary.totalSupply));
  const suppliedPercent = maxFinite(valid.map((summary) => summary.deadPercent));
  const computedPercent = deadLpPercent(deadBalance, totalSupply);
  const share = computedPercent ?? suppliedPercent;
  if (!deadBalance && !lockRows) return null;
  return { symbol, deadBalance, lockRows, holderCount, totalSupply, deadPercent: share };
}

function apiDeadLpToSummary(summary) {
  if (!summary || Number(summary.deadBalance) <= 0) return null;
  return {
    symbol: summary.symbol || "LP",
    deadBalance: Number(summary.deadBalance),
    lockRows: Number(summary.lockRows || 0),
    holderCount: finiteNumber(summary.holderCount),
    totalSupply: finiteNumber(summary.totalSupply),
    deadPercent: finiteNumber(summary.deadPercent),
  };
}

function applyDeadLpSummary(pool, summary) {
  if (!pool) return false;
  const before = {
    status: pool.deadLpStatus,
    amount: pool.deadLpAmount,
    symbol: pool.deadLpSymbol,
    rows: pool.deadLpLockRows,
    percent: pool.deadLpPercent,
    holders: pool.lpHolderCount,
    supply: pool.lpTotalSupply,
  };

  if (!summary) {
    pool.deadLpStatus = "none";
    pool.deadLpAmount = 0;
    pool.deadLpSymbol = "LP";
    pool.deadLpLockRows = 0;
    pool.deadLpPercent = deadLpPercent(0, pool.lpTotalSupply);
    return didDeadLpChange(pool, before);
  }

  const amount = Number(summary.deadBalance) || 0;
  const rows = Number(summary.lockRows || 0);
  const holderCount = finiteNumber(summary.holderCount);
  const totalSupply = finiteNumber(summary.totalSupply);

  pool.deadLpStatus = amount > 0 || rows > 0 ? "locked" : "none";
  pool.deadLpAmount = amount;
  pool.deadLpSymbol = summary.symbol || "LP";
  pool.deadLpLockRows = rows;
  if (holderCount !== null) pool.lpHolderCount = holderCount;
  if (totalSupply !== null) pool.lpTotalSupply = totalSupply;
  pool.deadLpPercent = deadLpPercent(amount, pool.lpTotalSupply) ?? finiteNumber(summary.deadPercent);
  return didDeadLpChange(pool, before);
}

function didDeadLpChange(pool, before) {
  return (
    before.status !== pool.deadLpStatus ||
    before.amount !== pool.deadLpAmount ||
    before.symbol !== pool.deadLpSymbol ||
    before.rows !== pool.deadLpLockRows ||
    before.percent !== pool.deadLpPercent ||
    before.holders !== pool.lpHolderCount ||
    before.supply !== pool.lpTotalSupply
  );
}

function lpLockSummaryFromPool(pool) {
  if (!pool || pool.deadLpStatus !== "locked") return null;
  return {
    symbol: pool.deadLpSymbol || "LP",
    deadBalance: pool.deadLpAmount,
    lockRows: pool.deadLpLockRows,
    holderCount: pool.lpHolderCount,
    totalSupply: pool.lpTotalSupply,
    deadPercent: pool.deadLpPercent,
  };
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function maxFinite(values) {
  const finite = values.map(finiteNumber).filter((value) => value !== null);
  return finite.length ? Math.max(...finite) : null;
}

function lpTokenSymbol(transfers) {
  return transfers.find((item) => item.token?.symbol)?.token?.symbol || null;
}

function lpTokenDecimals(transfers) {
  const decimals = Number(transfers.find((item) => item.token?.decimals !== undefined)?.token?.decimals);
  return Number.isFinite(decimals) ? decimals : 18;
}

function updateLpLockSummary(summary) {
  if (!summary) {
    els.lpBurnSummary.hidden = true;
    els.lpDeadBalance.textContent = "--";
    els.lpBurnRows.textContent = "--";
    els.lpDeadPercent.textContent = "--";
    return;
  }

  els.lpBurnSummary.hidden = false;
  const pool = selectedPool();
  const totalSupply = finiteNumber(summary.totalSupply) ?? pool?.lpTotalSupply ?? null;
  const share = deadLpPercent(summary.deadBalance, totalSupply) ?? finiteNumber(summary.deadPercent);
  els.lpDeadBalance.textContent = lpAmountText(summary.deadBalance, summary.symbol);
  els.lpBurnRows.textContent = compactNumber(summary.lockRows);
  els.lpDeadPercent.textContent = deadLpPercentText(share);
}

function lpAmountText(value, symbol) {
  if (!Number.isFinite(Number(value)) || Number(value) === 0) return "--";
  return `${compactTokenAmount(value)} ${symbol || "LP"}`;
}

function classifyTransferGroup(group, pool) {
  const transfers = group.transfers.filter((transfer) => Number.isFinite(Number(transfer.amount)));
  if (!transfers.length) return null;

  const incoming = transfers.filter((transfer) => transfer.direction === "in");
  const outgoing = transfers.filter((transfer) => transfer.direction === "out");
  const tokenSymbol = primaryTokenSymbol(pool);
  const tokenIn = sumTransfers(incoming, (transfer) => isPrimaryTokenTransfer(transfer, pool));
  const tokenOut = sumTransfers(outgoing, (transfer) => isPrimaryTokenTransfer(transfer, pool));
  const quoteIn = sumTransfers(incoming, (transfer) => isQuoteTokenTransfer(transfer, pool));
  const quoteOut = sumTransfers(outgoing, (transfer) => isQuoteTokenTransfer(transfer, pool));
  const wetcIn = sumTransfers(incoming, isWetcTransfer);
  const wetcOut = sumTransfers(outgoing, isWetcTransfer);
  const tokenAmount = Math.max(tokenIn, tokenOut);
  const wetcAmount = Math.max(wetcIn, wetcOut);

  let category = "transfer";
  let type = "Transfer";
  if (incoming.length && outgoing.length) {
    if (quoteIn > 0 && tokenOut > 0) {
      category = "swap";
      type = "Buy";
    } else if (tokenIn > 0 && quoteOut > 0) {
      category = "swap";
      type = "Sell";
    } else {
      return null;
    }
  } else if (incoming.length >= 2 && !outgoing.length) {
    category = "liquidity";
    type = "Add LP";
  } else if (outgoing.length >= 2 && !incoming.length) {
    category = "liquidity";
    type = "Remove LP";
  } else if (incoming.length && !outgoing.length) {
    type = "Deposit";
  } else if (outgoing.length && !incoming.length) {
    type = "Withdraw";
  }

  return {
    id: `blockscout:${group.txHash}`,
    category,
    source: "Blockscout",
    type,
    txHash: group.txHash,
    maker: counterpartyForGroup(group, pool),
    tokenAmount: tokenAmount > 0 ? tokenAmount : null,
    tokenSymbol,
    wetcAmount: wetcAmount > 0 ? wetcAmount : null,
    valueUsd: estimateTransferUsd(pool, tokenAmount, wetcAmount),
    priceUsd: null,
    priceWetc: tokenAmount > 0 && wetcAmount > 0 ? wetcAmount / tokenAmount : null,
    timestamp: group.timestamp,
  };
}

function classifyDeadLpGroup(group) {
  const transfers = group.transfers.filter((transfer) => Number(transfer.amount) >= MIN_DISPLAY_TOKEN_AMOUNT);
  if (!transfers.length) return null;
  const amount = transfers.reduce((sum, transfer) => sum + Number(transfer.amount || 0), 0);
  const first = transfers[0];

  return {
    id: `lp-lock:${group.txHash}`,
    category: "burn",
    source: "LP sent dead",
    type: "LP Lock",
    txHash: group.txHash,
    maker: first.from,
    tokenAmount: amount > 0 ? amount : null,
    tokenSymbol: first.symbol,
    wetcAmount: null,
    valueUsd: null,
    priceUsd: null,
    priceWetc: null,
    target: "Dead wallet",
    timestamp: group.timestamp,
  };
}

function primaryTokenSymbol(pool) {
  return pool.baseSymbol?.toUpperCase() === "WETC" && pool.quoteSymbol ? pool.quoteSymbol : pool.baseSymbol;
}

function primaryTokenAddress(pool) {
  return pool.baseSymbol?.toUpperCase() === "WETC" && pool.quoteAddress ? pool.quoteAddress : pool.baseAddress;
}

function quoteTokenSymbol(pool) {
  return pool.baseSymbol?.toUpperCase() === "WETC" && pool.quoteSymbol ? pool.baseSymbol : pool.quoteSymbol;
}

function quoteTokenAddress(pool) {
  return pool.baseSymbol?.toUpperCase() === "WETC" && pool.baseAddress ? pool.baseAddress : pool.quoteAddress;
}

function sameAddress(a, b) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function isDeadWalletAddress(address) {
  return sameAddress(address, DEAD_ADDRESS);
}

function isPrimaryTokenTransfer(transfer, pool) {
  return sameAddress(transfer.address, primaryTokenAddress(pool)) || transfer.symbol?.toUpperCase() === primaryTokenSymbol(pool)?.toUpperCase();
}

function isQuoteTokenTransfer(transfer, pool) {
  return sameAddress(transfer.address, quoteTokenAddress(pool)) || transfer.symbol?.toUpperCase() === quoteTokenSymbol(pool)?.toUpperCase();
}

function isWetcTransfer(transfer) {
  return transfer.symbol?.toUpperCase() === "WETC";
}

function sumTransfers(transfers, predicate) {
  return transfers.filter(predicate).reduce((sum, transfer) => sum + Number(transfer.amount || 0), 0);
}

function counterpartyForGroup(group, pool) {
  const incoming = group.transfers.find((transfer) => transfer.direction === "in" && !sameAddress(transfer.from, pool.contract));
  const outgoing = group.transfers.find((transfer) => transfer.direction === "out" && !sameAddress(transfer.to, pool.contract));
  return incoming?.from || outgoing?.to || "";
}

function estimateTransferUsd(pool, tokenAmount, wetcAmount) {
  if (wetcAmount > 0 && Number(state.wetcUsd) > 0) return wetcAmount * Number(state.wetcUsd);
  if (tokenAmount > 0 && Number(pool.basePriceUsd) > 0 && primaryTokenSymbol(pool)?.toUpperCase() === pool.baseSymbol?.toUpperCase()) {
    return tokenAmount * Number(pool.basePriceUsd);
  }
  return null;
}

function matchesTxType(event) {
  if (state.txFilter === "all") return true;
  if (state.txFilter === "buy") return event.type === "Buy";
  if (state.txFilter === "sell") return event.type === "Sell";
  return event.category === state.txFilter;
}

function txQueryActive() {
  return Boolean(
    Number(state.txQuery.minUsd) > 0 ||
      Number(state.txQuery.minWetc) > 0 ||
      Number(state.txQuery.minToken) > 0 ||
      state.txQuery.fromDate ||
      state.txQuery.toDate,
  );
}

function dateBoundary(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function matchesTxQuery(event) {
  const minUsd = Number(state.txQuery.minUsd) || 0;
  const minWetc = Number(state.txQuery.minWetc) || 0;
  const minToken = Number(state.txQuery.minToken) || 0;

  if (minUsd > 0 && !(Number(event.valueUsd) >= minUsd)) return false;
  if (minWetc > 0 && !(Number(event.wetcAmount) >= minWetc)) return false;
  if (minToken > 0 && !(Number(event.tokenAmount) >= minToken)) return false;

  const fromTime = dateBoundary(state.txQuery.fromDate);
  const toTime = dateBoundary(state.txQuery.toDate, true);
  if (fromTime !== null || toTime !== null) {
    const eventTime = new Date(event.timestamp || "").getTime();
    if (!Number.isFinite(eventTime)) return false;
    if (fromTime !== null && eventTime < fromTime) return false;
    if (toTime !== null && eventTime > toTime) return false;
  }

  return true;
}

function txFilterEmptyText() {
  if (txQueryActive()) return "No transactions match the current size/date filters.";
  if (state.txFilter === "buy") return "No buy transactions in the current feed.";
  if (state.txFilter === "sell") return "No sell transactions in the current feed.";
  return state.txFilter !== "all" ? `No ${state.txFilter} transactions in the current feed.` : "No recent pool transactions returned yet.";
}

function syncTxQueryFromControls() {
  state.txQuery = {
    minUsd: readNumberInput(els.txMinUsd?.value),
    minWetc: readNumberInput(els.txMinWetc?.value),
    minToken: readNumberInput(els.txMinToken?.value),
    fromDate: els.txDateFrom?.value || "",
    toDate: els.txDateTo?.value || "",
  };
  renderTransactions();
}

function clearTxQueryControls() {
  [els.txMinUsd, els.txMinWetc, els.txMinToken, els.txDateFrom, els.txDateTo].filter(Boolean).forEach((input) => {
    input.value = "";
  });
  syncTxQueryFromControls();
}

function renderTransactions() {
  const events = state.transactions || [];
  const typed = events.filter(matchesTxType);
  const matching = typed.filter(matchesTxQuery);
  const rowLimit = state.txFilter === "all" ? 120 : 250;
  const visible = matching.slice(0, rowLimit);

  if (!matching.length) {
    els.txStatus.textContent = events.length ? `${typed.length}/${events.length} txns` : "No txns";
    els.txRows.innerHTML = "";
    els.txEmpty.hidden = false;
    els.txEmpty.textContent = events.length ? txFilterEmptyText() : "No recent pool transactions returned yet.";
    return;
  }

  if (txQueryActive()) {
    els.txStatus.textContent = visible.length < matching.length ? `${visible.length}/${matching.length} matched` : `${matching.length}/${typed.length} matched`;
  } else {
    els.txStatus.textContent =
      state.txFilter === "all"
        ? visible.length < events.length
          ? `${visible.length}/${events.length} txns`
          : `${events.length} txns`
        : visible.length < matching.length
          ? `${visible.length}/${matching.length} txns`
          : `${matching.length}/${events.length} txns`;
  }
  els.txEmpty.hidden = true;
  const isDeadLpView = state.txFilter === "burn";
  const headers = isDeadLpView
    ? ["Type", "Value", "LP amount", "Destination", "Event", "From", "Time", "Tx"]
    : ["Type", "USD", "Token", "WETC", "Price / Target", "Maker", "Time", "Tx"];
  els.txRows.innerHTML = `
    <div class="tx-head">
      ${headers.map((header) => `<span>${header}</span>`).join("")}
    </div>
    ${visible.map((event) => renderTransactionRow(event, isDeadLpView)).join("")}
  `;
}

function setTxFilter(filter, shouldRender = false) {
  state.txFilter = filter;
  els.txFilters
    .querySelectorAll("[data-tx-filter]")
    .forEach((tab) => tab.classList.toggle("active", tab.dataset.txFilter === state.txFilter));
  if (shouldRender) renderTransactions();
}

function renderTransactionRow(event, isDeadLpView = false) {
  const href = event.txHash ? `${BLOCKSCOUT_BASE}/tx/${event.txHash}` : "#";
  const valueCell = isDeadLpView ? "--" : event.valueUsd ? moneyZero(event.valueUsd, true) : "--";
  const quoteCell = isDeadLpView ? escapeHtml(event.target || "Dead wallet") : amountText(event.wetcAmount, "WETC");
  const priceCell = isDeadLpView ? "LP transfer" : priceText(event);
  const makerCell = event.maker ? shortAddress(event.maker) : "--";
  return `
    <a class="tx-row" href="${href}" target="_blank" rel="noreferrer">
      <span class="tx-type-cell">
        <strong class="tx-type ${txTypeClass(event)}">${escapeHtml(event.type)}</strong>
        <small>${escapeHtml(event.source)}</small>
      </span>
      <span>${valueCell}</span>
      <span>${amountText(event.tokenAmount, event.tokenSymbol)}</span>
      <span>${quoteCell}</span>
      <span>${priceCell}</span>
      <span>${makerCell}</span>
      <span>${formatTxTime(event.timestamp)}</span>
      <span>${event.txHash ? shortAddress(event.txHash) : "--"}</span>
    </a>
  `;
}

function txTypeClass(event) {
  if (event.type === "Buy") return "tx-type-buy";
  if (event.type === "Sell") return "tx-type-sell";
  if (event.type === "Add LP") return "tx-type-add";
  if (event.type === "Remove LP") return "tx-type-remove";
  if (event.type === "LP Lock") return "tx-type-burn";
  return "tx-type-transfer";
}

function amountText(value, symbol) {
  if (!Number.isFinite(Number(value)) || Number(value) === 0) return "--";
  return `${compactTokenAmount(value)} ${escapeHtml(symbol || "")}`.trim();
}

function priceText(event) {
  if (event.target) return escapeHtml(event.target);
  if (Number.isFinite(Number(event.priceUsd)) && Number(event.priceUsd) > 0) return money(event.priceUsd);
  if (Number.isFinite(Number(event.priceWetc)) && Number(event.priceWetc) > 0) {
    return `${compactDecimal(event.priceWetc, event.priceWetc < 1 ? 8 : 4)} WETC`;
  }
  return "--";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function formatTxTime(timestamp) {
  if (!timestamp) return "--";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
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
  if (window.location.hash === "#/markets" || window.location.hash === "") {
    routeFromHash();
    return;
  }
  window.location.hash = "#/markets";
});

els.backToPairs.addEventListener("click", () => {
  window.location.hash = "#/markets";
});

els.navTerminal.addEventListener("click", () => {
  const pool = selectedPool() || [...state.pools].sort((a, b) => b.liquidity - a.liquidity)[0];
  if (!pool) return;
  window.location.hash = `#pool=${encodeURIComponent(pool.id)}`;
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

els.txFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tx-filter]");
  if (!button) return;
  setTxFilter(button.dataset.txFilter, true);
});

[els.txMinUsd, els.txMinWetc, els.txMinToken].filter(Boolean).forEach((input) => input.addEventListener("input", syncTxQueryFromControls));
[els.txDateFrom, els.txDateTo].filter(Boolean).forEach((input) => input.addEventListener("change", syncTxQueryFromControls));
els.txClearFilters?.addEventListener("click", clearTxQueryControls);

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
window.addEventListener("beforeunload", stopTransactionRefresh);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  const pool = selectedPool();
  if (!pool) return;
  loadTrades(pool, { silent: true });
  startTransactionRefresh(pool.id);
});

loadStats();
loadPools();
