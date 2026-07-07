import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

const upstreams = {
  "/contract-info": "https://contracts-info.services.blockscout.com",
  "/gt-api": "https://api.geckoterminal.com",
};

const marketCache = new Map();

function cacheTtl(pathname) {
  if (pathname.includes("/trades")) return 30 * 1000;
  if (pathname.includes("/ohlcv")) return 10 * 60 * 1000;
  return 2 * 60 * 1000;
}

async function cachedJsonProxy(req, res, prefix, target) {
  const upstreamPath = req.originalUrl.replace(prefix, "");
  const upstreamUrl = `${target}${upstreamPath}`;
  const key = upstreamUrl;
  const cached = marketCache.get(key);

  if (cached && Date.now() - cached.savedAt < cacheTtl(upstreamPath)) {
    res.set("x-etcscreener-cache", "hit");
    res.type(cached.contentType).status(200).send(cached.body);
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
      marketCache.set(key, { body, contentType, savedAt: Date.now() });
    }

    if (!response.ok && cached) {
      res.set("x-etcscreener-cache", "stale");
      res.type(cached.contentType).status(200).send(cached.body);
      return;
    }

    res.set("x-etcscreener-cache", response.ok ? "miss" : "bypass");
    res.status(response.status).type(contentType).send(body);
  } catch (error) {
    if (cached) {
      res.set("x-etcscreener-cache", "stale");
      res.type(cached.contentType).status(200).send(cached.body);
      return;
    }
    res.status(502).json({ error: "upstream_unavailable", message: error.message });
  }
}

async function proxyRequest(req, res, prefix, target) {
  const upstreamPath = req.originalUrl.replace(prefix, "");
  const upstreamUrl = `${target}${upstreamPath}`;

  try {
    const response = await fetch(upstreamUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "ETCScreener/0.1 (+https://etcscreener.app)",
      },
    });
    const contentType = response.headers.get("content-type") || "application/json";
    res.status(response.status).type(contentType);
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.status(502).json({ error: "upstream_unavailable", message: error.message });
  }
}

Object.entries(upstreams).forEach(([prefix, target]) => {
  app.use(prefix, (req, res) => proxyRequest(req, res, prefix, target));
});

app.use("/market-api/gecko", (req, res) => cachedJsonProxy(req, res, "/market-api/gecko", "https://api.geckoterminal.com"));
app.use("/blockscout-api", (req, res) => cachedJsonProxy(req, res, "/blockscout-api", "https://etc.blockscout.com"));

app.use(express.static(path.join(__dirname, "dist")));

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`ETCScreener listening on ${port}`);
});
