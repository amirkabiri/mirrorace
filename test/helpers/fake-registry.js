import { createServer } from "node:http";

export async function startFakeRegistry({
  name = "fake",
  delayMs = 0,
  status = 200,
  body = null,
  tarballBytes = null,
  notFoundFor = [],
  failConnection = false,
  responseChunkDelayMs = 0,
} = {}) {
  if (failConnection) {
    return {
      name,
      url: "http://127.0.0.1:1",
      hits: { metadata: 0, tarball: 0 },
      async close() {},
    };
  }

  const hits = { metadata: 0, tarball: 0 };

  let serverPort = 0;
  const server = createServer((req, res) => {
    const path = req.url || "/";
    const isTarball = /(?:\/-\/[^/]+|\/tarballs\/[^/]+)\.tgz(?:$|\?)/u.test(path);

    if (isTarball) hits.tarball += 1;
    else hits.metadata += 1;

    res.on("error", () => {});

    if (notFoundFor.some((needle) => path.includes(needle))) {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    const writeResponse = () => {
      if (res.destroyed || res.writableEnded) return;
      if (status >= 400) {
        try {
          res.statusCode = status;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: `status ${status}` }));
        } catch {
          // ignore
        }
        return;
      }

      try {
        res.statusCode = 200;
        if (isTarball) {
          const buf = tarballBytes || Buffer.from(`fake-tarball-from-${name}`);
          res.setHeader("content-type", "application/octet-stream");
          if (responseChunkDelayMs > 0 && buf.length > 1) {
            const half = Math.ceil(buf.length / 2);
            res.write(buf.subarray(0, half));
            setTimeout(() => {
              if (!res.destroyed && !res.writableEnded) {
                try {
                  res.end(buf.subarray(half));
                } catch {
                  // ignore
                }
              }
            }, responseChunkDelayMs);
          } else {
            res.setHeader("content-length", String(buf.length));
            res.end(buf);
          }
        } else {
          const requestUrl = `http://127.0.0.1:${serverPort}${path}`;
          const payload = typeof body === "function" ? body(requestUrl) : body || defaultMetadata(name, requestUrl);
          const text = JSON.stringify(payload);
          res.setHeader("content-type", "application/json");
          res.setHeader("content-length", String(Buffer.byteLength(text)));
          res.end(text);
        }
      } catch {
        // ignore writes after close
      }
    };

    if (delayMs > 0) {
      setTimeout(writeResponse, delayMs);
    } else {
      writeResponse();
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const port = server.address().port;
  serverPort = port;
  const url = `http://127.0.0.1:${port}`;

  return {
    name,
    url,
    hits,
    async close() {
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function defaultMetadata(mirrorName, requestUrl) {
  const u = new URL(requestUrl);
  const pkgName = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
  const tarballBaseName = pkgName.split("/").at(-1);
  return {
    name: pkgName,
    "dist-tags": { latest: "1.0.0" },
    versions: {
      "1.0.0": {
        name: pkgName,
        version: "1.0.0",
        dist: {
          tarball: `${u.origin}/${pkgName}/-/${tarballBaseName}-1.0.0.tgz`,
          integrity: "sha512-fake",
        },
      },
    },
    _from: mirrorName,
  };
}
