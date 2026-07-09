import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BLOCKSCOUT_API = "https://etc.blockscout.com/api/v2";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
const MIN_DISPLAY_TOKEN_AMOUNT = 0.000001;
const CACHE_SCHEMA_VERSION = 2;
const CACHE_FILE = path.join(process.env.ETCSCREENER_CACHE_DIR || path.join(process.cwd(), ".cache"), "market-index.json");
const DEAD_LP_CACHE_TTL_MS = 15 * 60 * 1000;
const POOL_TAPE_CACHE_TTL_MS = 20 * 60 * 1000;
const DEFAULT_HOLDER_PAGES = 10;
const DEFAULT_POOL_TRANSFER_PAGES = 12;
const DEFAULT_LP_TRANSFER_PAGES = 60;
const MAX_BATCH_CONCURRENCY = 2;

const indexCache = new Map();
const inflight = new Map();
let cacheLoaded = false;
let cacheWriteTimer = null;

export function isEtcAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
}

export async function getDeadLpBatch(contracts) {
  const uniqueContracts = [...new Set(contracts.map((contract) => contract.toLowerCase()).filter(isEtcAddress))];
  return runLimited(uniqueContracts, MAX_BATCH_CONCURRENCY, async (contract) => {
    try {
      return await getDeadLpSummary(contract);
    } catch (error) {
      return {
        contract,
        status: "error",
        deadBalance: null,
        symbol: "LP",
        lockRows: 0,
        holderCount: null,
        totalSupply: null,
        deadPercent: null,
        checkedAt: new Date().toISOString(),
        message: error.message,
      };
    }
  });
}

export async function getPoolTapeIndex(contract, options = {}) {
  const normalized = String(contract || "").toLowerCase();
  if (!isEtcAddress(normalized)) {
    const error = new Error("Invalid pool contract");
    error.statusCode = 400;
    throw error;
  }

  const poolPages = readPositiveInt(options.poolPages, DEFAULT_POOL_TRANSFER_PAGES, 40);
  const lpPages = readPositiveInt(options.lpPages, DEFAULT_LP_TRANSFER_PAGES, 120);
  const holderPages = readPositiveInt(options.holderPages, DEFAULT_HOLDER_PAGES, 30);
  const cacheKey = `pool-tape:${normalized}:${poolPages}:${lpPages}:${holderPages}`;

  return withCache(cacheKey, POOL_TAPE_CACHE_TTL_MS, async () => {
    const [poolTransferResult, lpTransferResult, lpHolderResult, tokenInfoResult] = await Promise.allSettled([
      fetchPaginated(`/addresses/${normalized}/token-transfers`, poolPages),
      fetchPaginated(`/tokens/${normalized}/transfers`, lpPages),
      fetchPaginated(`/tokens/${normalized}/holders`, holderPages),
      fetchTokenInfo(normalized),
    ]);
    const poolTransfers = poolTransferResult.status === "fulfilled" ? poolTransferResult.value : [];
    const lpTransfers = lpTransferResult.status === "fulfilled" ? lpTransferResult.value : [];
    const lpHolders = lpHolderResult.status === "fulfilled" ? lpHolderResult.value : [];
    const tokenInfo = tokenInfoResult.status === "fulfilled" ? tokenInfoResult.value : null;

    return {
      contract: normalized,
      indexedAt: new Date().toISOString(),
      source: "blockscout-server-index",
      partial:
        poolTransferResult.status !== "fulfilled" ||
        lpTransferResult.status !== "fulfilled" ||
        lpHolderResult.status !== "fulfilled",
      scanned: {
        poolTransferPages: poolPages,
        lpTransferPages: lpPages,
        holderPages,
      },
      poolTransfers,
      lpTransfers,
      lpHolders,
      deadLp: summarizeDeadLp(lpTransfers, lpHolders, tokenInfo),
    };
  });
}

async function getDeadLpSummary(contract) {
  const normalized = String(contract || "").toLowerCase();
  if (!isEtcAddress(normalized)) {
    return {
      contract,
      status: "invalid",
      deadBalance: null,
      symbol: "LP",
      lockRows: 0,
      holderCount: null,
      totalSupply: null,
      deadPercent: null,
      checkedAt: new Date().toISOString(),
    };
  }

  return withCache(`dead-lp:${normalized}`, DEAD_LP_CACHE_TTL_MS, async () => {
    const [lpHolders, tokenInfo] = await Promise.all([fetchPaginated(`/tokens/${normalized}/holders`, DEFAULT_HOLDER_PAGES), fetchTokenInfo(normalized)]);
    const summary = summarizeDeadLp([], lpHolders, tokenInfo);
    const totalSupply = summary?.totalSupply ?? tokenTotalSupply(tokenInfo);
    const holderCount = summary?.holderCount ?? tokenHolderCount(tokenInfo);
    return {
      contract: normalized,
      status: summary?.deadBalance > 0 ? "locked" : "none",
      deadBalance: summary?.deadBalance || 0,
      symbol: summary?.symbol || tokenInfo?.symbol || holderTokenSymbol(lpHolders) || "LP",
      lockRows: summary?.lockRows || 0,
      holderCount,
      totalSupply,
      deadPercent: summary?.deadPercent ?? deadLpPercent(summary?.deadBalance || 0, totalSupply),
      checkedAt: new Date().toISOString(),
    };
  });
}

async function fetchPaginated(path, maxPages) {
  const items = [];
  let nextPageParams = null;

  for (let page = 0; page < maxPages; page += 1) {
    const query = nextPageParams ? `?${new URLSearchParams(nextPageParams).toString()}` : "";
    const payload = await fetchBlockscoutJson(`${path}${query}`);
    items.push(...(payload.items || []));
    if (!payload.next_page_params) break;
    nextPageParams = payload.next_page_params;
  }

  return items;
}

async function fetchBlockscoutJson(path) {
  let lastStatus = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${BLOCKSCOUT_API}${path}`, {
      headers: {
        accept: "application/json",
        "user-agent": "ETCScreener/0.1 (+https://etcscreener.app)",
      },
    });
    if (response.ok) return response.json();
    lastStatus = response.status;
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) break;
    await delay(650 * (attempt + 1));
  }
  throw new Error(`Blockscout returned ${lastStatus}`);
}

async function fetchTokenInfo(contract) {
  try {
    return await fetchBlockscoutJson(`/tokens/${contract}`);
  } catch {
    return null;
  }
}

function summarizeDeadLp(lpTransfers, lpHolders, tokenInfo = null) {
  const deadTransfers = lpTransfers
    .filter((item) => sameAddress(item.to?.hash, DEAD_ADDRESS))
    .map(normalizeLpTransfer)
    .filter((transfer) => Number(transfer.amount) >= MIN_DISPLAY_TOKEN_AMOUNT);
  const decimals = lpTokenDecimals(lpTransfers, lpHolders, tokenInfo);
  const symbol = deadTransfers[0]?.symbol || lpTokenSymbol(lpTransfers) || tokenInfo?.symbol || holderTokenSymbol(lpHolders) || "LP";
  const deadTransferred = deadTransfers.reduce((sum, transfer) => sum + Number(transfer.amount || 0), 0);
  const deadHolder = lpHolders.find((holder) => sameAddress(holder.address?.hash, DEAD_ADDRESS));
  const deadBalance = deadHolder ? scaledTokenSupply(deadHolder.value, decimals) : deadTransferred;
  const totalSupply = tokenTotalSupply(tokenInfo);
  const holderCount = tokenHolderCount(tokenInfo);

  if (!deadTransfers.length && !Number(deadBalance)) return null;

  return {
    symbol,
    deadBalance,
    lockRows: deadTransfers.length,
    holderCount,
    totalSupply,
    deadPercent: deadLpPercent(deadBalance, totalSupply),
  };
}

function normalizeLpTransfer(item) {
  const token = item.token || {};
  return {
    to: item.to?.hash || "",
    amount: scaledTokenSupply(item.total?.value, item.total?.decimals ?? token.decimals),
    symbol: token.symbol || "LP",
  };
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

function lpTokenSymbol(transfers) {
  return transfers.find((item) => item.token?.symbol)?.token?.symbol || null;
}

function holderTokenSymbol(holders) {
  return holders.find((item) => item.token?.symbol)?.token?.symbol || "LP";
}

function lpTokenDecimals(transfers, holders = [], tokenInfo = null) {
  const transferDecimals = Number(transfers.find((item) => item.token?.decimals !== undefined)?.token?.decimals);
  if (Number.isFinite(transferDecimals)) return transferDecimals;
  const tokenDecimals = Number(tokenInfo?.decimals);
  if (Number.isFinite(tokenDecimals)) return tokenDecimals;
  const holderDecimals = Number(holders.find((item) => item.token?.decimals !== undefined)?.token?.decimals);
  return Number.isFinite(holderDecimals) ? holderDecimals : 18;
}

function sameAddress(a, b) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function readPositiveInt(value, fallback, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return fallback;
  return Math.min(number, max);
}

async function withCache(key, ttlMs, compute) {
  await ensureCacheLoaded();
  const cached = indexCache.get(key);
  if (cached && Date.now() - cached.savedAt < ttlMs) return { ...cached.value, cache: "hit" };
  if (inflight.has(key)) return inflight.get(key);

  const promise = compute()
    .then((value) => {
      if (shouldPersistCache(value)) {
        indexCache.set(key, { savedAt: Date.now(), value });
        scheduleCachePersist();
      }
      return { ...value, cache: "miss" };
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

function shouldPersistCache(value) {
  if (!value?.partial) return true;
  const hasIndexedData =
    Boolean(value.deadLp) ||
    Boolean(value.poolTransfers?.length) ||
    Boolean(value.lpTransfers?.length) ||
    Boolean(value.lpHolders?.length);
  return hasIndexedData;
}

async function ensureCacheLoaded() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const payload = JSON.parse(await readFile(CACHE_FILE, "utf8"));
    if (payload.version !== CACHE_SCHEMA_VERSION || !payload.entries) return;
    Object.entries(payload.entries).forEach(([key, value]) => {
      if (value?.savedAt && value?.value) indexCache.set(key, value);
    });
  } catch {
    // First run or unreadable cache: rebuild on demand.
  }
}

function scheduleCachePersist() {
  if (cacheWriteTimer) return;
  cacheWriteTimer = setTimeout(() => {
    cacheWriteTimer = null;
    persistCache().catch(() => {});
  }, 250);
  cacheWriteTimer.unref?.();
}

async function persistCache() {
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await writeFile(
    CACHE_FILE,
    JSON.stringify(
      {
        version: CACHE_SCHEMA_VERSION,
        savedAt: new Date().toISOString(),
        entries: Object.fromEntries(indexCache),
      },
      null,
      2,
    ),
  );
}

async function runLimited(items, limit, mapper) {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    const promise = Promise.resolve()
      .then(() => mapper(item))
      .then((result) => results.push(result))
      .finally(() => executing.delete(promise));
    executing.add(promise);
    if (executing.size >= limit) await Promise.race(executing);
  }

  await Promise.all(executing);
  return results;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
