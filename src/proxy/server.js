import { createServer } from "node:http";
import { MirrorStats } from "./stats.js";
import { handleMetadata } from "./metadata.js";
import { handleTarball } from "./tarball.js";

const TARBALL_PATH_RE = /^\/(?:(@[^/]+)\/)?([^/]+)\/-\/([^/]+\.tgz)$/u;
const METADATA_PATH_RE = /^\/(?:(@[^/]+)\/)?([^/]+?)(?:\/([^/]+))?\/?$/u;

export async function startProxy({ mirrors, log = () => {} }) {
  if (!Array.isArray(mirrors) || mirrors.length === 0) {
    throw new Error("startProxy requires at least one mirror");
  }
  const stats = new MirrorStats(mirrors);

  const server = createServer((req, res) => {
    handleRequest(req, res, { mirrors, stats, log }).catch((err) => {
      log(`unhandled error: ${err?.stack || err}`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "internal proxy error" }));
      } else {
        try {
          res.destroy(err);
        } catch {
          // ignore
        }
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    port,
    stats,
    async close() {
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

async function handleRequest(req, res, ctx) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("allow", "GET, HEAD");
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }

  const path = decodeURIComponent(req.url || "/");
  ctx.log(`${req.method} ${path}`);

  if (path === "/" || path === "/-/ping") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, service: "fnpm" }));
    return;
  }

  const tarballMatch = path.match(TARBALL_PATH_RE);
  if (tarballMatch) {
    await handleTarball({
      req,
      res,
      mirrors: ctx.mirrors,
      stats: ctx.stats,
      tarballPath: path,
      log: ctx.log,
    });
    return;
  }

  const metadataMatch = path.match(METADATA_PATH_RE);
  if (metadataMatch) {
    await handleMetadata({
      req,
      res,
      mirrors: ctx.mirrors,
      stats: ctx.stats,
      packagePath: path,
      log: ctx.log,
    });
    return;
  }

  res.statusCode = 404;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: "not found" }));
}
