#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { startProxy } from "./proxy/server.js";
import { runPackageManager, SUPPORTED_PMS } from "./runner.js";

const USAGE = `Usage: fastnpm [-c <mirrors.yaml>] [--verbose] <pnpm|npm|yarn> [args...]

Options:
  -c, --config <path>   Path to a YAML file listing mirror URLs.
  --verbose             Print proxy activity to stderr.
  -h, --help            Show this help message.
  -v, --version         Show version.

Examples:
  npx fastnpm -c mirrors.yaml pnpm install
  npx fastnpm npm install lodash
  npx fastnpm yarn add react
`;

async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.version) {
    const { version } = await readPackageJson();
    process.stdout.write(`${version}\n`);
    return 0;
  }

  if (!parsed.pm) {
    process.stderr.write("error: missing package manager argument (pnpm|npm|yarn)\n\n");
    process.stderr.write(USAGE);
    return 2;
  }

  const log = parsed.verbose
    ? (msg) => process.stderr.write(`[fastnpm] ${msg}\n`)
    : () => {};

  let config;
  try {
    config = await loadConfig(parsed.configPath);
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    return 1;
  }

  log(`mirrors: ${config.mirrors.join(", ")}`);

  const proxy = await startProxy({ mirrors: config.mirrors, log });
  log(`proxy listening on ${proxy.url}`);

  const cleanup = async () => {
    try {
      await proxy.close();
    } catch {
      // ignore
    }
  };

  const onSignal = (signal) => {
    log(`received ${signal}, shutting down`);
    cleanup().finally(() => process.exit(130));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const result = await runPackageManager({
      pm: parsed.pm,
      args: parsed.pmArgs,
      registryUrl: proxy.url,
    });
    return result.code ?? 0;
  } catch (err) {
    process.stderr.write(`error: failed to run ${parsed.pm}: ${err.message}\n`);
    return 1;
  } finally {
    await cleanup();
  }
}

function parseArgs(argv) {
  const out = {
    configPath: null,
    verbose: false,
    help: false,
    version: false,
    pm: null,
    pmArgs: [],
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      out.help = true;
      i += 1;
      continue;
    }
    if (arg === "-v" || arg === "--version") {
      out.version = true;
      i += 1;
      continue;
    }
    if (arg === "--verbose") {
      out.verbose = true;
      i += 1;
      continue;
    }
    if (arg === "-c" || arg === "--config") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error(`${arg} requires a value`);
      }
      out.configPath = next;
      i += 2;
      continue;
    }
    if (arg.startsWith("--config=")) {
      out.configPath = arg.slice("--config=".length);
      i += 1;
      continue;
    }
    if (SUPPORTED_PMS.has(arg)) {
      out.pm = arg;
      out.pmArgs = argv.slice(i + 1);
      break;
    }
    process.stderr.write(`warning: unknown argument before package manager: ${arg}\n`);
    i += 1;
  }

  return out;
}

async function readPackageJson() {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, resolve } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, "..", "package.json");
  const text = await readFile(pkgPath, "utf8");
  return JSON.parse(text);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exit(code ?? 0);
  },
  (err) => {
    process.stderr.write(`fatal: ${err?.stack || err}\n`);
    process.exit(1);
  },
);
