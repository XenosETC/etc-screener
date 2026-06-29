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

app.use(express.static(path.join(__dirname, "dist")));

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`ETCScreener listening on ${port}`);
});
