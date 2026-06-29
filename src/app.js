const BLOCKSCOUT_BASE = "https://etc.blockscout.com";
const POOLS_API = "/contract-info/api/v1/chains/61/pools";
const OHLCV_API = "/gt-api/api/v2/networks/ethereum_classic/pools";
const TRADES_API = "/gt-api/api/v2/networks/ethereum_classic/pools";

const state = {
  pools: [],
  selectedPoolId: null,
  query: "",
  sort: "liquidity",
  timeframe: "hour",
  candleRequest: 0,
};

const els = {
  navPools: document.querySelector("#navPools"),
  poolsView: document.querySelector("#poolsView"),
  chartView: document.querySelector("#chartView"),
  dataStatus: document.querySelector("#dataStatus"),
  etcPrice: document.querySelector("#etcPrice"),
  topLiquidity: document.querySelector("#topLiquidity"),
  dexCount: document.querySelector("#dexCount"),
  visiblePoolCount: document.querySelector("#visiblePoolCount"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  poolRows: document.querySelector("#poolRows"),
  miniRows: document.querySelector("#miniRows"),
  emptyState: document.querySelector("#emptyState"),
  backToPools: document.querySelector("#backToPools"),
  selectedDex: document.querySelector("#selectedDex"),
  selectedPair: document.querySelector("#selectedPair"),
  selectedContract: document.querySelector("#selectedContract"),
  openBlockscout: document.querySelector("#openBlockscout"),
  openGecko: document.querySelector("#openGecko"),
  selectedPrice: document.querySelector("#selectedPrice"),
  selectedChange: document.querySelector("#selectedChange"),
  selectedLiquidity: document.querySelector("#selectedLiquidity"),
  selectedFee: document.querySelector("#selectedFee"),
  selectedMarketCap: document.querySelector("#selectedMarketCap"),
  selectedVolume: document.querySelector("#selectedVolume"),
  selectedRisk: document.querySelector("#selectedRisk"),
  selectedPoolAddress: document.querySelector("#selectedPoolAddress"),
  nativeChart: document.querySelector("#nativeChart"),
  chartLoading: document.querySelector("#chartLoading"),
  chartStatus: document.querySelector("#chartStatus"),
  txStatus: document.querySelector("#txStatus"),
  txRows: document.querySelector("#txRows"),
  txEmpty: document.querySelector("#txEmpty"),
  timeframes: document.querySelector(".timeframes"),
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
  const pool = {
    id: item.pool_id || item.contract_address,
    pair: `${base} / ${quote}`,
    dex: item.dex?.name || "Unknown DEX",
    contract: item.contract_address,
    fee: item.fee === null || item.fee === undefined ? null : Number(item.fee),
    liquidity: Number(item.liquidity || 0),
    marketCap: Number(item.base_token_market_cap_usd || item.base_token_fully_diluted_valuation_usd || 0),
    geckoUrl: item.coin_gecko_terminal_url,
  };
  pool.risk = scorePoolRisk(pool);
  return pool;
}

function visiblePools() {
  const query = state.query.toLowerCase();
  return [...state.pools]
    .filter((pool) => [pool.pair, pool.dex, pool.contract].some((value) => value.toLowerCase().includes(query)))
    .sort((a, b) => {
      if (state.sort === "baseMarketCap") return b.marketCap - a.marketCap;
      if (state.sort === "risk") return a.risk - b.risk;
      return b.liquidity - a.liquidity;
    });
}

function selectedPool() {
  return state.pools.find((pool) => pool.id === state.selectedPoolId) || null;
}

function tokenInitials(pair) {
  return pair
    .split("/")
    .map((part) => part.trim()[0])
    .join("")
    .slice(0, 3);
}

function renderPools() {
  const rows = visiblePools();
  els.emptyState.hidden = rows.length > 0;
  els.visiblePoolCount.textContent = rows.length;
  els.poolRows.innerHTML = rows
    .map(
      (pool) => `
        <a class="pool-row" data-id="${pool.id}" href="#pool=${pool.id}">
          <span class="pair-cell">
              <span class="token-dot">${tokenInitials(pool.pair)}</span>
              <span>
                <strong>${pool.pair}</strong>
                <span>${shortAddress(pool.contract)}</span>
              </span>
          </span>
          <span>${pool.dex}</span>
          <span><span class="action-pill">Chart</span></span>
          <span>${pool.fee === null ? `<span class="muted">--</span>` : `${pool.fee}%`}</span>
          <span class="muted">--</span>
          <span class="muted">--</span>
          <span>${money(pool.liquidity, true)}</span>
          <span>${money(pool.marketCap, true)}</span>
          <span><span class="risk risk-${riskLabel(pool.risk).toLowerCase()}">${riskLabel(pool.risk)}</span></span>
        </a>
      `,
    )
    .join("");
  renderMiniRows();
}

function renderOverview() {
  const top = [...state.pools].sort((a, b) => b.liquidity - a.liquidity)[0];
  els.topLiquidity.textContent = top ? money(top.liquidity, true) : "--";
  els.dexCount.textContent = new Set(state.pools.map((pool) => pool.dex)).size || "--";
  els.visiblePoolCount.textContent = visiblePools().length || "--";
}

function renderMiniRows() {
  els.miniRows.innerHTML = visiblePools()
    .map(
      (pool) => `
        <a class="mini-row ${pool.id === state.selectedPoolId ? "active" : ""}" data-id="${pool.id}" href="#pool=${pool.id}">
          <strong>${pool.pair}</strong>
          <span>${pool.dex} - ${money(pool.liquidity, true)} liq</span>
        </a>
      `,
    )
    .join("");
}

function showView(name) {
  els.poolsView.classList.toggle("active", name === "pools");
  els.chartView.classList.toggle("active", name === "chart");
}

function openPool(poolId) {
  state.selectedPoolId = poolId;
  showView("chart");
  renderMiniRows();
  renderSelectedPool();
}

function routeFromHash() {
  const match = window.location.hash.match(/^#pool=(.+)$/);
  const poolId = match ? decodeURIComponent(match[1]) : null;
  if (poolId && state.pools.some((pool) => pool.id === poolId)) {
    openPool(poolId);
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
  els.selectedPrice.textContent = "--";
  els.selectedChange.textContent = "Waiting for candles";
  els.selectedLiquidity.textContent = money(pool.liquidity, true);
  els.selectedFee.textContent = pool.fee === null ? "--" : `${pool.fee}%`;
  els.selectedMarketCap.textContent = money(pool.marketCap, true);
  els.selectedVolume.textContent = "--";
  els.selectedRisk.textContent = riskLabel(pool.risk);
  els.selectedPoolAddress.textContent = shortAddress(pool.contract);
  loadCandles(pool);
  loadTrades(pool);
}

function timeframeParams() {
  if (state.timeframe === "minute") return { unit: "minute", aggregate: 15, label: "15M" };
  if (state.timeframe === "day") return { unit: "day", aggregate: 1, label: "1D" };
  return { unit: "hour", aggregate: 1, label: "1H" };
}

async function fetchCandles(poolId, frame) {
  const url = `${OHLCV_API}/${poolId}/ohlcv/${frame.unit}?aggregate=${frame.aggregate}&limit=140&currency=usd`;
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
  const requestId = ++state.candleRequest;
  const frame = timeframeParams();
  els.chartLoading.hidden = false;
  els.chartLoading.textContent = "Loading candles...";
  els.chartStatus.textContent = `Loading ${frame.label} candles`;
  els.nativeChart.innerHTML = "";
  try {
    let activeFrame = frame;
    let payload = await fetchCandles(pool.id, activeFrame);
    if ((payload.data?.attributes?.ohlcv_list || []).length < 3 && activeFrame.unit !== "day") {
      activeFrame = { unit: "day", aggregate: 1, label: "1D" };
      payload = await fetchCandles(pool.id, activeFrame);
    }
    if (requestId !== state.candleRequest) return;
    const candles = (payload.data?.attributes?.ohlcv_list || [])
      .map(([time, open, high, low, close, volume]) => ({
        time,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      }))
      .filter((candle) => Number.isFinite(candle.close) && Number.isFinite(candle.high) && Number.isFinite(candle.low))
      .reverse();
    renderCandles(candles, pool, activeFrame);
  } catch (error) {
    if (requestId !== state.candleRequest) return;
    els.chartLoading.textContent = `Chart unavailable: ${error.message}`;
    els.chartStatus.textContent = "Chart unavailable";
    console.warn(error);
  }
}

function renderCandles(candles, pool, frame) {
  if (!candles.length) {
    els.chartLoading.hidden = false;
    els.chartLoading.textContent = "No candles for this pool yet.";
    return;
  }
  els.chartLoading.hidden = true;

  const width = 1120;
  const height = 560;
  const pad = { top: 42, right: 70, bottom: 58, left: 64 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const prices = candles.flatMap((candle) => [candle.high, candle.low]);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const spread = max - min || max || 1;
  const maxVolume = Math.max(...candles.map((candle) => candle.volume), 1);
  const candleW = Math.max(3, Math.min(9, chartW / candles.length - 2));
  const step = chartW / Math.max(candles.length - 1, 1);
  const x = (index) => pad.left + index * step;
  const y = (price) => pad.top + ((max - price) / spread) * chartH;
  const first = candles[0];
  const last = candles[candles.length - 1];
  const change = ((last.close - first.open) / (first.open || 1)) * 100;
  const totalVolume = candles.reduce((sum, candle) => sum + candle.volume, 0);
  const lineColor = change >= 0 ? "var(--green)" : "var(--red)";
  const path = candles.map((candle, i) => `${i ? "L" : "M"} ${x(i).toFixed(2)} ${y(candle.close).toFixed(2)}`).join(" ");
  const fillPath = `${path} L ${x(candles.length - 1).toFixed(2)} ${pad.top + chartH} L ${pad.left} ${pad.top + chartH} Z`;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const gy = pad.top + chartH * ratio;
      const price = max - spread * ratio;
      return `<line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${gy}" y2="${gy}"/><text class="axis" x="${width - pad.right + 10}" y="${gy + 4}">${money(price)}</text>`;
    })
    .join("");
  const volume = candles
    .map((candle, i) => {
      const h = Math.max(1, (candle.volume / maxVolume) * 48);
      return `<rect class="${candle.close >= candle.open ? "volume-up" : "volume-down"}" x="${x(i) - candleW / 2}" y="${height - pad.bottom - h}" width="${candleW}" height="${h}" rx="1"/>`;
    })
    .join("");
  const bars = candles
    .map((candle, i) => {
      const cx = x(i);
      const openY = y(candle.open);
      const closeY = y(candle.close);
      const up = candle.close >= candle.open;
      return `
        <line x1="${cx}" x2="${cx}" y1="${y(candle.high)}" y2="${y(candle.low)}" class="${up ? "wick-up" : "wick-down"}"/>
        <rect x="${cx - candleW / 2}" y="${Math.min(openY, closeY)}" width="${candleW}" height="${Math.max(2, Math.abs(closeY - openY))}" rx="1" class="${up ? "candle-up" : "candle-down"}"/>
      `;
    })
    .join("");

  els.nativeChart.innerHTML = `
    <div class="chart-summary">
      <span>${pool.pair} / USD</span>
      <strong class="${change >= 0 ? "positive" : "negative"}">${change >= 0 ? "+" : ""}${change.toFixed(2)}%</strong>
      <span>${frame.label}</span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${pool.pair} chart">
      ${grid}
      <path d="${fillPath}" class="price-fill"/>
      <path d="${path}" fill="none" stroke="${lineColor}" stroke-width="2.2"/>
      ${volume}
      ${bars}
      <text class="axis" x="${pad.left}" y="${height - 18}">${new Date(first.time * 1000).toLocaleDateString()}</text>
      <text class="axis" x="${width - pad.right - 100}" y="${height - 18}">${new Date(last.time * 1000).toLocaleDateString()}</text>
    </svg>
  `;
  els.selectedPrice.textContent = money(last.close);
  els.selectedChange.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}% on ${frame.label}`;
  els.selectedChange.className = change >= 0 ? "positive" : "negative";
  els.selectedVolume.textContent = money(totalVolume, true);
  els.chartStatus.textContent = `${candles.length} candles loaded`;
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
    els.etcPrice.textContent = `ETC ${money(stats.coin_price)}`;
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

els.backToPools.addEventListener("click", () => {
  history.pushState("", document.title, window.location.pathname + window.location.search);
  showView("pools");
});
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
  renderPools();
});

els.timeframes.addEventListener("click", (event) => {
  const button = event.target.closest("[data-timeframe]");
  if (!button) return;
  state.timeframe = button.dataset.timeframe;
  els.timeframes.querySelectorAll("button").forEach((tab) => tab.classList.toggle("active", tab === button));
  renderSelectedPool();
});

window.addEventListener("hashchange", routeFromHash);

loadStats();
loadPools();
