import { OFFICIAL_NPM_REGISTRY } from "../mirrors.js";
import { fetchMirror } from "./fetch.js";

const METADATA_TIMEOUT_MS = 8000;

export async function handleMetadata({ req, res, mirrors, stats, packagePath, log }) {
  const orderedMirrors = stats.sorted(mirrors);
  const controllers = new Map();
  const errors = [];
  let resolved = false;

  const headers = filterRequestHeaders(req.headers);

  const attempts = orderedMirrors.map((mirror) => {
    const controller = new AbortController();
    controllers.set(mirror, controller);
    const timeout = setTimeout(() => controller.abort(new Error("metadata timeout")), METADATA_TIMEOUT_MS);
    const target = `${mirror}${packagePath}`;
    return fetchMirror(target, { headers, signal: controller.signal }, mirror)
      .then(async (response) => {
        clearTimeout(timeout);
        if (!response.ok) {
          const err = new Error(`status ${response.status}`);
          err.status = response.status;
          err.mirror = mirror;
          throw err;
        }
        const text = await response.text();
        return { mirror, response, text };
      })
      .catch((err) => {
        clearTimeout(timeout);
        if (!resolved) {
          stats.recordFailure(mirror);
          errors.push({ mirror, status: err.status, error: err.message });
        }
        throw err;
      });
  });

  let winner;
  try {
    winner = await firstFulfilled(attempts);
  } catch {
    log?.(`metadata: all mirrors failed for ${packagePath}`);
    if (errors.length > 0 && errors.every((error) => error.status === 404)) {
      sendError(res, 404, `Metadata not found on any mirror: ${packagePath}`);
      return;
    }
    sendError(res, 502, `Failed to fetch metadata for ${packagePath} from all mirrors`);
    return;
  }

  resolved = true;
  for (const [mirror, controller] of controllers) {
    if (mirror !== winner.mirror) controller.abort();
  }
  stats.recordSuccess(winner.mirror);

  let body = winner.text;
  const contentType = winner.response.headers.get("content-type") || "application/json";
  const isJson = contentType.includes("json");
  if (isJson) {
    try {
      const parsed = JSON.parse(body);
      rewriteTarballUrls(parsed);
      body = JSON.stringify(parsed);
    } catch {
      // pass through unmodified
    }
  }

  res.statusCode = 200;
  res.setHeader("content-type", contentType);
  res.setHeader("x-mirrorace-mirror", winner.mirror);
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

function rewriteTarballUrls(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) rewriteTarballUrls(item);
    return;
  }
  if (node.dist && typeof node.dist === "object" && typeof node.dist.tarball === "string") {
    node.dist.tarball = canonicalizeTarballUrl(node.dist.tarball);
  }
  if (node.versions && typeof node.versions === "object") {
    for (const key of Object.keys(node.versions)) {
      rewriteTarballUrls(node.versions[key]);
    }
  }
}

function canonicalizeTarballUrl(original) {
  try {
    const url = new URL(original);
    const pathname = url.pathname.replace(/^\/+/u, "/");
    const tgzMatch = pathname.match(/(\/(?:@[^/]+\/)?[^/]+\/-\/[^/]+\.tgz)$/u);
    if (tgzMatch) {
      return `${OFFICIAL_NPM_REGISTRY}${tgzMatch[1]}`;
    }
    return original;
  } catch {
    return original;
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
  out.accept = out.accept || "application/json";
  return out;
}

function firstFulfilled(promises) {
  return new Promise((resolve, reject) => {
    if (promises.length === 0) {
      reject(new Error("no mirrors"));
      return;
    }
    let pending = promises.length;
    const errs = [];
    for (const p of promises) {
      p.then(
        (value) => resolve(value),
        (err) => {
          errs.push(err);
          pending -= 1;
          if (pending === 0) reject(new AggregateError(errs, "all mirrors failed"));
        },
      );
    }
  });
}

function sendError(res, status, message) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: message }));
}
