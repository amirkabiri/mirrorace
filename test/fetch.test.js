import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { DEFAULT_MIRROR_IPS } from "../src/mirrors.js";
import { fetchMirror } from "../src/proxy/fetch.js";

test("fetchMirror uses a pinned IP when DNS lookup fails for a known mirror", async () => {
  const server = createServer((req, res) => {
    assert.equal(req.headers.host, `dns-fallback.invalid:${server.address().port}`);
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain");
    res.end("served through pinned ip");
  });

  await listen(server);
  const mirror = `http://dns-fallback.invalid:${server.address().port}`;
  DEFAULT_MIRROR_IPS[mirror] = "127.0.0.1";

  try {
    const response = await fetchMirror(`${mirror}/pkg`, {}, mirror);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "served through pinned ip");
  } finally {
    delete DEFAULT_MIRROR_IPS[mirror];
    await close(server);
  }
});

test("fetchMirror normalizes the mirror before looking up a pinned IP", async () => {
  const server = createServer((req, res) => {
    assert.equal(req.headers.host, `dns-fallback-normalized.invalid:${server.address().port}`);
    res.statusCode = 200;
    res.end("served through normalized pinned ip");
  });

  await listen(server);
  const mirror = `http://dns-fallback-normalized.invalid:${server.address().port}/`;
  const normalizedMirror = mirror.slice(0, -1);
  DEFAULT_MIRROR_IPS[normalizedMirror] = "127.0.0.1";

  try {
    const response = await fetchMirror(`${normalizedMirror}/pkg`, {}, mirror);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "served through normalized pinned ip");
  } finally {
    delete DEFAULT_MIRROR_IPS[normalizedMirror];
    await close(server);
  }
});

test("fetchMirror still fails DNS lookup for mirrors without a pinned IP", async () => {
  await assert.rejects(
    fetchMirror("http://dns-fallback-without-pin.invalid/pkg", {}, "http://dns-fallback-without-pin.invalid"),
    /fetch failed|getaddrinfo/u,
  );
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
