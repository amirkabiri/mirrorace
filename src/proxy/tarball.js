import { Readable } from "node:stream";
import { fetchMirror } from "./fetch.js";

const TARBALL_FIRST_BYTE_TIMEOUT_MS = 30000;
const RACE_PARALLELISM = 3;
const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 50;

export async function handleTarball({ req, res, mirrors, stats, tarballPath, log }) {
  const ordered = stats.sorted(mirrors);
  const headers = filterRequestHeaders(req.headers);

  const queue = [...ordered];
  const errors404 = [];
  const errorsOther = [];

  while (queue.length > 0) {
    const wave = queue.splice(0, Math.min(RACE_PARALLELISM, queue.length));
    let winner;
    try {
      winner = await raceWave({ wave, tarballPath, headers, stats, log });
    } catch (waveErr) {
      for (const e of waveErr.errors) {
        if (e.status === 404) errors404.push(e);
        else errorsOther.push(e);
      }
      continue;
    }

    for (const candidate of winner.losers) {
      try {
        candidate.controller.abort();
      } catch {
        // ignore
      }
    }

    const piped = await pipeWinnerToClient({
      res,
      winner,
      stats,
      log,
    });

    if (piped.ok) return;

    errorsOther.push({ mirror: winner.mirror, error: piped.error?.message || "stream error" });
    if (piped.bytesSent > 0) {
      try {
        res.destroy(piped.error || new Error("upstream stream interrupted"));
      } catch {
        // ignore
      }
      return;
    }
  }

  if (errors404.length > 0 && errorsOther.length === 0) {
    sendError(res, 404, `Tarball not found on any mirror: ${tarballPath}`);
    return;
  }
  sendError(res, 502, `Failed to fetch tarball ${tarballPath} from all mirrors`);
}

function raceWave({ wave, tarballPath, headers, stats, log }) {
  return new Promise((resolve, reject) => {
    const candidates = wave.map((mirror) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(new Error("first byte timeout"));
      }, TARBALL_FIRST_BYTE_TIMEOUT_MS);

      const url = `${mirror}${tarballPath}`;

      const promise = fetchWithRetry(url, { headers, signal: controller.signal }, mirror, stats)
        .then((response) => {
          clearTimeout(timeout);
          if (!response.ok) {
            stats.recordFailure(mirror);
            const err = new Error(`status ${response.status}`);
            err.status = response.status;
            err.mirror = mirror;
            throw err;
          }
          if (!response.body) {
            stats.recordFailure(mirror);
            const err = new Error("no body");
            err.mirror = mirror;
            throw err;
          }
          return { mirror, response, controller };
        })
        .catch((err) => {
          clearTimeout(timeout);
          stats.recordFailure(mirror);
          err.mirror = err.mirror || mirror;
          throw err;
        });
      return { mirror, controller, promise };
    });

    let resolved = false;
    let pending = candidates.length;
    const errors = [];

    for (const candidate of candidates) {
      candidate.promise.then(
        (value) => {
          if (resolved) {
            try {
              candidate.controller.abort();
            } catch {
              // ignore
            }
            return;
          }
          resolved = true;
          const losers = candidates.filter((c) => c !== candidate);
          log?.(`tarball: winner=${candidate.mirror}`);
          resolve({ mirror: value.mirror, response: value.response, controller: value.controller, losers });
        },
        (err) => {
          errors.push({ mirror: candidate.mirror, status: err.status, error: err.message });
          pending -= 1;
          if (pending === 0 && !resolved) {
            const aggregate = new Error("wave failed");
            aggregate.errors = errors;
            reject(aggregate);
          }
        },
      );
    }
  });
}

async function fetchWithRetry(url, options, mirror, stats, attempt = 1) {
  try {
    return await fetchMirror(url, options, mirror);
  } catch (err) {
    if (attempt >= MAX_RETRIES) {
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return fetchWithRetry(url, options, mirror, stats, attempt + 1);
  }
}

async function pipeWinnerToClient({ res, winner, stats, log }) {
  res.statusCode = 200;
  copyResponseHeaders(winner.response, res);
  res.setHeader("x-mirrorace-mirror", winner.mirror);

  const startedAt = Date.now();
  let bytesSent = 0;

  try {
    const nodeStream = Readable.fromWeb(winner.response.body);
    nodeStream.on("data", (chunk) => {
      bytesSent += chunk.length;
    });

    await new Promise((resolve, reject) => {
      let finished = false;
      const done = (err) => {
        if (finished) return;
        finished = true;
        if (err) reject(err);
        else resolve();
      };
      nodeStream.on("error", done);
      res.on("error", done);
      res.on("close", () => {
        if (!res.writableEnded) done(new Error("client closed"));
        else done();
      });
      nodeStream.pipe(res);
      res.on("finish", () => done());
    });

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > 0 && bytesSent > 0) {
      const bytesPerSec = (bytesSent * 1000) / elapsedMs;
      stats.recordThroughput(winner.mirror, bytesPerSec);
      log?.(`tarball: ${winner.mirror} delivered ${bytesSent}B in ${elapsedMs}ms (${Math.round(bytesPerSec / 1024)}KB/s)`);
    } else {
      stats.recordSuccess(winner.mirror);
    }
    return { ok: true, bytesSent };
  } catch (err) {
    stats.recordFailure(winner.mirror);
    return { ok: false, bytesSent, error: err };
  }
}

function copyResponseHeaders(response, res) {
  const passthrough = [
    "content-type",
    "content-length",
    "content-encoding",
    "etag",
    "last-modified",
    "cache-control",
  ];
  for (const name of passthrough) {
    const value = response.headers.get(name);
    if (value) res.setHeader(name, value);
  }
}

function filterRequestHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers || {})) {
    const lower = name.toLowerCase();
    if (
      lower === "host" ||
      lower === "content-length" ||
      lower === "connection" ||
      lower === "accept-encoding"
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      out[name] = value.join(", ");
    } else if (value != null) {
      out[name] = String(value);
    }
  }
  return out;
}

function sendError(res, status, message) {
  if (res.headersSent) {
    try {
      res.destroy();
    } catch {
      // ignore
    }
    return;
  }
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: message }));
}
