import { defineConfig } from "vite";

const marketCache = new Map();

function cacheTtl(pathname) {
  if (pathname.includes("/counters") || pathname.includes("/addresses/")) return 10 * 60 * 1000;
  if (pathname.includes("/trades")) return 30 * 1000;
  if (pathname.includes("/ohlcv")) return 10 * 60 * 1000;
  return 2 * 60 * 1000;
}

function sendJson(res, status, contentType, body, cacheState) {
  res.statusCode = status;
  res.setHeader("content-type", contentType);
  res.setHeader("x-etcscreener-cache", cacheState);
  res.end(body);
}

async function cachedJsonProxy(req, res, next) {
  const route = req.url?.startsWith("/market-api/gecko/")
    ? { prefix: "/market-api/gecko", target: "https://api.geckoterminal.com" }
    : req.url?.startsWith("/blockscout-api/")
      ? { prefix: "/blockscout-api", target: "https://etc.blockscout.com" }
      : null;

  if (!route) {
    next();
    return;
  }

  const upstreamPath = req.url.replace(route.prefix, "");
  const upstreamUrl = `${route.target}${upstreamPath}`;
  const cached = marketCache.get(upstreamUrl);

  if (cached && Date.now() - cached.savedAt < cacheTtl(upstreamPath)) {
    sendJson(res, 200, cached.contentType, cached.body, "hit");
    return;
  }

  try {
    const response = await fetch(upstreamUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "ETCScreener/0.1 (+https://etcscreener.app)",
      },
    });
    const contentType = response.headers.get("content-type") || "application/json";
    const body = Buffer.from(await response.arrayBuffer());

    if (response.ok) {
      marketCache.set(upstreamUrl, { body, contentType, savedAt: Date.now() });
    }

    if (!response.ok && cached) {
      sendJson(res, 200, cached.contentType, cached.body, "stale");
      return;
    }

    sendJson(res, response.status, contentType, body, response.ok ? "miss" : "bypass");
  } catch (error) {
    if (cached) {
      sendJson(res, 200, cached.contentType, cached.body, "stale");
      return;
    }
    sendJson(res, 502, "application/json", JSON.stringify({ error: "upstream_unavailable", message: error.message }), "bypass");
  }
}

export default defineConfig({
  server: {
    proxy: {
      "/contract-info": {
        target: "https://contracts-info.services.blockscout.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/contract-info/, ""),
      },
      "/gt-api": {
        target: "https://api.geckoterminal.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gt-api/, ""),
      },
    },
  },
  plugins: [
    {
      name: "etcscreener-market-cache",
      configureServer(server) {
        server.middlewares.use(cachedJsonProxy);
      },
    },
  ],
});
