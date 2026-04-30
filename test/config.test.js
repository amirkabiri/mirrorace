import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { DEFAULT_MIRRORS, normalizeMirrors, OFFICIAL_NPM_REGISTRY } from "../src/mirrors.js";

test("normalizeMirrors strips trailing slashes and dedupes", () => {
  const out = normalizeMirrors([
    "https://registry.npmjs.org/",
    "https://registry.npmjs.org",
    "https://registry.npmmirror.com//",
  ]);
  assert.deepEqual(out, ["https://registry.npmjs.org", "https://registry.npmmirror.com"]);
});

test("normalizeMirrors always includes official npm registry", () => {
  const out = normalizeMirrors(["https://registry.npmmirror.com"]);
  assert.ok(out.includes(OFFICIAL_NPM_REGISTRY));
});

test("normalizeMirrors with no input still returns official registry", () => {
  const out = normalizeMirrors(undefined);
  assert.deepEqual(out, [OFFICIAL_NPM_REGISTRY]);
});

test("normalizeMirrors filters invalid urls", () => {
  const out = normalizeMirrors(["not a url", "ftp://nope.example", "https://valid.example/"]);
  assert.ok(out.includes("https://valid.example"));
  assert.ok(out.includes(OFFICIAL_NPM_REGISTRY));
  assert.ok(!out.some((u) => u.startsWith("ftp://")));
});

test("loadConfig reads JSON file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mirrorace-cfg-"));
  try {
    const file = join(dir, "mirrors.json");
    await writeFile(
      file,
      JSON.stringify({ mirrors: ["https://a.example", "https://b.example"] }, null, 2),
      "utf8",
    );
    const cfg = await loadConfig(file);
    assert.ok(cfg.mirrors.includes("https://a.example"));
    assert.ok(cfg.mirrors.includes("https://b.example"));
    assert.ok(cfg.mirrors.includes(OFFICIAL_NPM_REGISTRY));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadConfig with no path returns default mirrors plus official registry", async () => {
  const cfg = await loadConfig(null);
  assert.deepEqual(cfg.mirrors, normalizeMirrors(DEFAULT_MIRRORS));
});

test("loadConfig accepts plain array JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mirrorace-cfg-"));
  try {
    const file = join(dir, "mirrors.json");
    await writeFile(file, JSON.stringify(["https://x.example", "https://y.example"], null, 2), "utf8");
    const cfg = await loadConfig(file);
    assert.ok(cfg.mirrors.includes("https://x.example"));
    assert.ok(cfg.mirrors.includes("https://y.example"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
