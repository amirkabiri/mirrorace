import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("cli: installs a package with real npm through a configured mirror", { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "mirrorace-real-e2e-"));

  let registry;
  try {
    const packageName = "mirrorace-real-e2e";
    const version = "1.0.0";
    const tarballName = `${packageName}-${version}.tgz`;
    const fixtureDir = join(dir, "fixture-package");
    const appDir = join(dir, "app");

    await mkdir(fixtureDir);
    await mkdir(appDir);
    await writeFile(
      join(fixtureDir, "package.json"),
      JSON.stringify({ name: packageName, version, main: "index.js" }, null, 2),
      "utf8",
    );
    await writeFile(join(fixtureDir, "index.js"), "module.exports = 'installed by real npm';\n", "utf8");

    const packResult = await runCommand("npm", ["pack", "--json", "--pack-destination", dir], {
      cwd: fixtureDir,
      env: process.env,
    });
    assert.equal(packResult.code, 0, packResult.stderr || packResult.stdout);

    const [{ filename }] = JSON.parse(packResult.stdout);
    const tarballBytes = await readFile(join(dir, filename));

    registry = await startFakeRegistry({
      name: "real-e2e",
      tarballBytes,
      body(requestUrl) {
        const origin = new URL(requestUrl).origin;
        return {
          name: packageName,
          "dist-tags": { latest: version },
          versions: {
            [version]: {
              name: packageName,
              version,
              dist: {
                tarball: `${origin}/tarballs/${tarballName}`,
              },
            },
          },
        };
      },
    });

    const configPath = join(dir, "mirrors.json");
    await writeFile(configPath, JSON.stringify([registry.url]), "utf8");
    await writeFile(join(appDir, "package.json"), JSON.stringify({ private: true }), "utf8");

    const installResult = await runNode(
      [
        join(process.cwd(), "src/cli.js"),
        "-c",
        configPath,
        "npm",
        "install",
        packageName,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      {
        cwd: appDir,
        env: {
          ...process.env,
          npm_config_cache: join(dir, "npm-cache"),
          npm_config_update_notifier: "false",
        },
      },
    );

    assert.equal(installResult.code, 0, installResult.stderr || installResult.stdout);
    const installedEntry = await readFile(join(appDir, "node_modules", packageName, "index.js"), "utf8");
    assert.match(installedEntry, /installed by real npm/u);
    assert.equal(registry.hits.metadata, 1);
    assert.equal(registry.hits.tarball, 1);
  } finally {
    if (registry) await registry.close();
    await rm(dir, { recursive: true, force: true });
  }
});

function runNode(args, options) {
  return runCommand(process.execPath, args, options);
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
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
