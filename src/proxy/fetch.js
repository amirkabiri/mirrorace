import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { DEFAULT_MIRROR_IPS } from "../mirrors.js";

const DNS_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);

export async function fetchMirror(url, options = {}, mirror) {
  try {
    return await fetch(url, options);
  } catch (err) {
    const fallbackIp = DEFAULT_MIRROR_IPS[mirror];
    if (!fallbackIp || !isDnsResolutionError(err)) {
      throw err;
    }
    return fetchViaPinnedIp(url, options, fallbackIp);
  }
}

function fetchViaPinnedIp(url, options, ip) {
  const target = new URL(url);
  const isHttps = target.protocol === "https:";
  const client = isHttps ? https : http;
  const headers = toPlainHeaders(options.headers);
  headers.host = target.host;

  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: target.protocol,
        hostname: ip,
        port: target.port || (isHttps ? 443 : 80),
        method: options.method || "GET",
        path: `${target.pathname}${target.search}`,
        headers,
        servername: target.hostname,
        signal: options.signal,
      },
      (upstream) => {
        resolve(
          new Response(Readable.toWeb(upstream), {
            status: upstream.statusCode || 0,
            statusText: upstream.statusMessage || "",
            headers: headersFromIncoming(upstream),
          }),
        );
      },
    );

    req.on("error", reject);
    if (options.body) {
      req.end(options.body);
    } else {
      req.end();
    }
  });
}

function headersFromIncoming(message) {
  const headers = new Headers();
  for (let i = 0; i < message.rawHeaders.length; i += 2) {
    headers.append(message.rawHeaders[i], message.rawHeaders[i + 1]);
  }
  return headers;
}

function toPlainHeaders(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === "function") {
    headers.forEach((value, name) => {
      out[name] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [name, value] of headers) {
      out[name] = value;
    }
    return out;
  }
  return { ...headers };
}

function isDnsResolutionError(err) {
  let current = err;
  while (current) {
    if (DNS_ERROR_CODES.has(current.code)) return true;
    current = current.cause;
  }
  return false;
}
