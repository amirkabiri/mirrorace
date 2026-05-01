import { test } from "node:test";
import assert from "node:assert/strict";
import { MirrorStats } from "../src/proxy/stats.js";

test("MirrorStats ranks mirrors by observed throughput and failures", () => {
  const stats = new MirrorStats(["https://fast.example", "https://slow.example"]);

  stats.recordThroughput("https://fast.example", 1000);
  stats.recordThroughput("https://slow.example", 100);
  assert.deepEqual(stats.sorted(["https://slow.example", "https://fast.example"]), [
    "https://fast.example",
    "https://slow.example",
  ]);

  stats.recordFailure("https://fast.example");
  stats.recordFailure("https://fast.example");
  stats.recordFailure("https://fast.example");

  assert.deepEqual(stats.sorted(["https://fast.example", "https://slow.example"]), [
    "https://slow.example",
    "https://fast.example",
  ]);
});

test("MirrorStats ignores updates for mirrors it does not track", () => {
  const stats = new MirrorStats(["https://known.example"]);

  stats.recordThroughput("https://missing.example", 1000);
  stats.recordSuccess("https://missing.example");
  stats.recordFailure("https://missing.example");

  assert.equal(stats.score("https://missing.example"), 0);
  assert.deepEqual(stats.get("https://known.example"), {
    url: "https://known.example",
    throughput: 0,
    failures: 0,
    lastErrorAt: 0,
  });
});
