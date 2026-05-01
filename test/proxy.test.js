import { test } from "node:test";
import assert from "node:assert/strict";
import { startFakeRegistry } from "./helpers/fake-registry.js";
import { startProxy } from "../src/proxy/server.js";
import { OFFICIAL_NPM_REGISTRY } from "../src/mirrors.js";

async function fetchText(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  return { status: r.status, headers: r.headers, text };
}

async function fetchBuffer(url, init) {
  const r = await fetch(url, init);
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, headers: r.headers, buf };
}

test("metadata: races mirrors and returns the fastest one", async () => {
  const slow = await startFakeRegistry({ name: "slow", delayMs: 200 });
  const fast = await startFakeRegistry({ name: "fast", delayMs: 0 });
  const proxy = await startProxy({ mirrors: [slow.url, fast.url] });
  try {
    const out = await fetchText(`${proxy.url}/lodash`);
    assert.equal(out.status, 200);
    assert.equal(out.headers.get("x-mirrorace-mirror"), fast.url);
    const json = JSON.parse(out.text);
    assert.equal(json.name, "lodash");
  } finally {
    await proxy.close();
    await slow.close();
    await fast.close();
  }
});

test("metadata: rewrites dist.tarball to canonical npmjs URL", async () => {
  const fake = await startFakeRegistry({ name: "fake", delayMs: 0 });
  const proxy = await startProxy({ mirrors: [fake.url] });
  try {
    const out = await fetchText(`${proxy.url}/lodash`);
    assert.equal(out.status, 200);
    const json = JSON.parse(out.text);
    const tarball = json.versions["1.0.0"].dist.tarball;
    assert.ok(
      tarball.startsWith(OFFICIAL_NPM_REGISTRY),
      `expected canonical npmjs url, got ${tarball}`,
    );
    assert.ok(tarball.endsWith("/lodash/-/lodash-1.0.0.tgz"));
  } finally {
    await proxy.close();
    await fake.close();
  }
});

test("metadata: rewrites scoped package tarballs to canonical npmjs URL", async () => {
  const fake = await startFakeRegistry({ name: "fake", delayMs: 0 });
  const proxy = await startProxy({ mirrors: [fake.url] });
  try {
    const out = await fetchText(`${proxy.url}/@scope/pkg`);
    assert.equal(out.status, 200);
    const json = JSON.parse(out.text);
    const tarball = json.versions["1.0.0"].dist.tarball;
    assert.equal(tarball, `${OFFICIAL_NPM_REGISTRY}/@scope/pkg/-/pkg-1.0.0.tgz`);
  } finally {
    await proxy.close();
    await fake.close();
  }
});

test("metadata: falls back when first mirror returns 404", async () => {
  const broken = await startFakeRegistry({ name: "broken", status: 404 });
  const ok = await startFakeRegistry({ name: "ok", delayMs: 0 });
  const proxy = await startProxy({ mirrors: [broken.url, ok.url] });
  try {
    const out = await fetchText(`${proxy.url}/lodash`);
    assert.equal(out.status, 200);
    assert.equal(out.headers.get("x-mirrorace-mirror"), ok.url);
  } finally {
    await proxy.close();
    await broken.close();
    await ok.close();
  }
});

test("metadata: returns 404 when all mirrors return 404", async () => {
  const a = await startFakeRegistry({ name: "a", status: 404 });
  const b = await startFakeRegistry({ name: "b", status: 404 });
  const proxy = await startProxy({ mirrors: [a.url, b.url] });
  try {
    const out = await fetchText(`${proxy.url}/lodash`);
    assert.equal(out.status, 404);
    assert.match(out.text, /not found/u);
  } finally {
    await proxy.close();
    await a.close();
    await b.close();
  }
});

test("metadata: returns 502 when every mirror fails with server errors", async () => {
  const a = await startFakeRegistry({ name: "a", status: 503 });
  const b = await startFakeRegistry({ name: "b", status: 502 });
  const proxy = await startProxy({ mirrors: [a.url, b.url] });
  try {
    const out = await fetchText(`${proxy.url}/lodash`);
    assert.equal(out.status, 502);
    assert.match(out.text, /Failed to fetch metadata/u);
  } finally {
    await proxy.close();
    await a.close();
    await b.close();
  }
});

test("tarball: fastest mirror wins the race", async () => {
  const slow = await startFakeRegistry({ name: "slow", delayMs: 200 });
  const fast = await startFakeRegistry({ name: "fast", delayMs: 0 });
  const proxy = await startProxy({ mirrors: [slow.url, fast.url] });
  try {
    const out = await fetchBuffer(`${proxy.url}/lodash/-/lodash-1.0.0.tgz`);
    assert.equal(out.status, 200);
    assert.equal(out.headers.get("x-mirrorace-mirror"), fast.url);
    assert.equal(out.buf.toString(), "fake-tarball-from-fast");
  } finally {
    await proxy.close();
    await slow.close();
    await fast.close();
  }
});

test("tarball: falls back to next mirror when one is 404", async () => {
  const broken = await startFakeRegistry({ name: "broken", status: 404 });
  const ok = await startFakeRegistry({ name: "ok", delayMs: 0 });
  const proxy = await startProxy({ mirrors: [broken.url, ok.url] });
  try {
    const out = await fetchBuffer(`${proxy.url}/lodash/-/lodash-1.0.0.tgz`);
    assert.equal(out.status, 200);
    assert.equal(out.headers.get("x-mirrorace-mirror"), ok.url);
  } finally {
    await proxy.close();
    await broken.close();
    await ok.close();
  }
});

test("tarball: returns 404 when all mirrors return 404", async () => {
  const a = await startFakeRegistry({ name: "a", status: 404 });
  const b = await startFakeRegistry({ name: "b", status: 404 });
  const proxy = await startProxy({ mirrors: [a.url, b.url] });
  try {
    const out = await fetchBuffer(`${proxy.url}/lodash/-/lodash-1.0.0.tgz`);
    assert.equal(out.status, 404);
  } finally {
    await proxy.close();
    await a.close();
    await b.close();
  }
});

test("tarball: returns 502 when every mirror fails with server errors", async () => {
  const a = await startFakeRegistry({ name: "a", status: 503 });
  const b = await startFakeRegistry({ name: "b", status: 502 });
  const proxy = await startProxy({ mirrors: [a.url, b.url] });
  try {
    const out = await fetchBuffer(`${proxy.url}/lodash/-/lodash-1.0.0.tgz`);
    assert.equal(out.status, 502);
  } finally {
    await proxy.close();
    await a.close();
    await b.close();
  }
});

test("tarball: succeeds when two of three mirrors are down (5xx)", async () => {
  const downA = await startFakeRegistry({ name: "downA", status: 503 });
  const downB = await startFakeRegistry({ name: "downB", status: 502 });
  const ok = await startFakeRegistry({ name: "ok", delayMs: 10 });
  const proxy = await startProxy({ mirrors: [downA.url, downB.url, ok.url] });
  try {
    const out = await fetchBuffer(`${proxy.url}/lodash/-/lodash-1.0.0.tgz`);
    assert.equal(out.status, 200);
    assert.equal(out.headers.get("x-mirrorace-mirror"), ok.url);
  } finally {
    await proxy.close();
    await downA.close();
    await downB.close();
    await ok.close();
  }
});

test("server: responds to registry ping", async () => {
  const ok = await startFakeRegistry({ name: "ok" });
  const proxy = await startProxy({ mirrors: [ok.url] });
  try {
    const out = await fetchText(`${proxy.url}/-/ping`);
    assert.equal(out.status, 200);
    assert.deepEqual(JSON.parse(out.text), { ok: true, service: "mirrorace" });
  } finally {
    await proxy.close();
    await ok.close();
  }
});

test("server: rejects non-GET methods", async () => {
  const ok = await startFakeRegistry({ name: "ok" });
  const proxy = await startProxy({ mirrors: [ok.url] });
  try {
    const r = await fetch(`${proxy.url}/lodash`, { method: "POST", body: "{}" });
    assert.equal(r.status, 405);
  } finally {
    await proxy.close();
    await ok.close();
  }
});

test("server: returns 404 for paths outside the registry protocol", async () => {
  const ok = await startFakeRegistry({ name: "ok" });
  const proxy = await startProxy({ mirrors: [ok.url] });
  try {
    const out = await fetchText(`${proxy.url}/-/not-a-supported-endpoint/extra`);
    assert.equal(out.status, 404);
    assert.match(out.text, /not found/u);
  } finally {
    await proxy.close();
    await ok.close();
  }
});
