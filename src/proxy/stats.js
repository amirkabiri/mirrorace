const EWMA_ALPHA = 0.4;
const FAILURE_DECAY = 0.6;
const SUCCESS_DECAY = 0.85;

export class MirrorStats {
  constructor(mirrors) {
    this.entries = new Map();
    for (const mirror of mirrors) {
      this.entries.set(mirror, {
        url: mirror,
        throughput: 0,
        failures: 0,
        lastErrorAt: 0,
      });
    }
  }

  get(mirror) {
    return this.entries.get(mirror);
  }

  recordThroughput(mirror, bytesPerSec) {
    const entry = this.entries.get(mirror);
    if (!entry) return;
    if (entry.throughput === 0) {
      entry.throughput = bytesPerSec;
    } else {
      entry.throughput = EWMA_ALPHA * bytesPerSec + (1 - EWMA_ALPHA) * entry.throughput;
    }
    entry.failures = entry.failures * SUCCESS_DECAY;
  }

  recordSuccess(mirror) {
    const entry = this.entries.get(mirror);
    if (!entry) return;
    entry.failures = entry.failures * SUCCESS_DECAY;
  }

  recordFailure(mirror) {
    const entry = this.entries.get(mirror);
    if (!entry) return;
    entry.failures = entry.failures * FAILURE_DECAY + 1;
    entry.lastErrorAt = Date.now();
  }

  score(mirror) {
    const entry = this.entries.get(mirror);
    if (!entry) return 0;
    const throughputScore = entry.throughput > 0 ? entry.throughput : 1;
    return throughputScore / (1 + entry.failures * 5);
  }

  sorted(mirrors) {
    return [...mirrors].sort((a, b) => this.score(b) - this.score(a));
  }
}
