import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import { startFakeRegistry } from "./helpers/fake-registry.js";
import { OFFICIAL_NPM_REGISTRY } from "../src/mirrors.js";

test("cli: runs the package manager through the local proxy registry", async () => {
  const registry = await startFakeRegistry({ name: "e2e" });
  const dir = await mkdtemp(join(tmpdir(), "mirrorace-e2e-"));

  try {
    const configPath = join(dir, "mirrors.json");
    const binDir = join(dir, "bin");
    await writeFile(configPath, JSON.stringify([registry.url]), "utf8");
    await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }), "utf8");
    await mkdir(binDir);

    const npmPath = join(binDir, "npm");
    await writeFile(
      npmPath,
      `#!/usr/bin/env node
const registryArg = process.argv.find((arg) => arg.startsWith("--registry="));
if (!registryArg) {
  console.error("missing --registry argument");
  process.exit(10);
}
const registryUrl = registryArg.slice("--registry=".length);
if (!registryUrl.startsWith("http://127.0.0.1:")) {
  console.error("registry argument did not point at local proxy: " + registryUrl);
  process.exit(11);
}
if (process.env.npm_config_registry !== registryUrl || process.env.NPM_CONFIG_REGISTRY !== registryUrl) {
  console.error("registry environment was not forwarded to npm");
  process.exit(12);
}
const metadataResponse = await fetch(registryUrl + "/lodash");
if (metadataResponse.status !== 200) {
  console.error("metadata status " + metadataResponse.status);
  process.exit(13);
}
const metadata = await metadataResponse.json();
const tarballUrl = metadata.versions["1.0.0"].dist.tarball;
if (!tarballUrl.startsWith("${OFFICIAL_NPM_REGISTRY}")) {
  console.error("tarball was not canonicalized: " + tarballUrl);
  process.exit(14);
}
const tarballResponse = await fetch(registryUrl + "/lodash/-/lodash-1.0.0.tgz");
if (tarballResponse.status !== 200) {
  console.error("tarball status " + tarballResponse.status);
  process.exit(15);
}
const tarball = await tarballResponse.text();
if (tarball !== "fake-tarball-from-e2e") {
  console.error("unexpected tarball body: " + tarball);
  process.exit(16);
}
`,
      { mode: 0o755 },
    );

    const result = await runNode(["src/cli.js", "-c", configPath, "npm", "install", "lodash"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH || ""}`,
      },
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(registry.hits.metadata, 1);
    assert.equal(registry.hits.tarball, 1);
  } finally {
    await registry.close();
    await rm(dir, { recursive: true, force: true });
  }
});

function runNode(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, options);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}
