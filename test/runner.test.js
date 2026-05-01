import { test } from "node:test";
import assert from "node:assert/strict";
import { runPackageManager } from "../src/runner.js";

test("runPackageManager rejects unsupported package managers", () => {
  assert.throws(
    () => runPackageManager({ pm: "bun", args: [], registryUrl: "http://127.0.0.1:1234" }),
    /Unsupported package manager: bun/u,
  );
});

test("runPackageManager rejects when the package manager cannot be started", async () => {
  await assert.rejects(
    runPackageManager({
      pm: "npm",
      args: [],
      registryUrl: "http://127.0.0.1:1234",
      env: { PATH: "" },
    }),
    /ENOENT/u,
  );
});
