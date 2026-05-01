import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";

const CLI_PATH = join(process.cwd(), "src/cli.js");

test("cli: prints usage when asked for help", async () => {
  const result = await runCli(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage: mirrorace/u);
  assert.match(result.stdout, /pnpm\|npm\|yarn/u);
});

test("cli: prints the package version", async () => {
  const result = await runCli(["--version"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^\d+\.\d+\.\d+\n$/u);
});

test("cli: exits with usage when no package manager is provided", async () => {
  const result = await runCli([]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /missing package manager/u);
  assert.match(result.stderr, /Usage: mirrorace/u);
});

test("cli: exits when config cannot be read", async () => {
  const result = await runCli(["-c", "does-not-exist.json", "npm", "install"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Failed to read config file/u);
});

test("cli: rejects config flags without values", async () => {
  const result = await runCli(["--config"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /--config requires a value/u);
});

test("cli: warns about unknown arguments before the package manager", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mirrorace-cli-"));
  try {
    const binDir = join(dir, "bin");
    await mkdir(binDir);
    await writeFile(join(binDir, "npm"), "#!/usr/bin/env node\nprocess.exit(0);\n", { mode: 0o755 });

    const result = await runCli(["--surprise", "npm", "install"], {
      PATH: `${binDir}${delimiter}${process.env.PATH || ""}`,
    });

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /unknown argument before package manager: --surprise/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    });
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
