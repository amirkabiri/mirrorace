import { spawn } from "node:child_process";

export const SUPPORTED_PMS = new Set(["npm", "pnpm", "yarn"]);

export function runPackageManager({ pm, args, registryUrl, env = process.env }) {
  if (!SUPPORTED_PMS.has(pm)) {
    throw new Error(`Unsupported package manager: ${pm}`);
  }

  const finalArgs = [...args, `--registry=${registryUrl}`];

  const childEnv = {
    ...env,
    npm_config_registry: registryUrl,
    NPM_CONFIG_REGISTRY: registryUrl,
    YARN_NPM_REGISTRY_SERVER: registryUrl,
    YARN_REGISTRY: registryUrl,
  };

  return new Promise((resolve, reject) => {
    const child = spawn(pm, finalArgs, {
      stdio: "inherit",
      env: childEnv,
      shell: process.platform === "win32",
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        resolve({ code: 1, signal });
      } else {
        resolve({ code: code ?? 0 });
      }
    });
  });
}
