type CacheState = { hits: number; misses: number };
type AdminMetricState = {
  latencies: Record<string, number[]>;
  caches: Record<string, CacheState>;
};

const MAX_SAMPLES = 2_048;
const globalMetrics = globalThis as typeof globalThis & { __adminMetricState?: AdminMetricState };

function state(): AdminMetricState {
  if (!globalMetrics.__adminMetricState) globalMetrics.__adminMetricState = { latencies: {}, caches: {} };
  return globalMetrics.__adminMetricState;
}

export function observeAdminLatency(name: string, durationMs: number) {
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value < 0) return;
  const samples = state().latencies[name] || [];
  samples.push(value);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  state().latencies[name] = samples;
}

export function recordAdminCacheResult(name: string, result: "hit" | "miss") {
  const current = state().caches[name] || { hits: 0, misses: 0 };
  if (result === "hit") current.hits += 1;
  else current.misses += 1;
  state().caches[name] = current;
}

function quantile(sorted: number[], value: number) {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)];
}

export function getAdminMetricSnapshot() {
  const latencies = Object.fromEntries(Object.entries(state().latencies).map(([name, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return [name, {
      count: sorted.length,
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      p99: quantile(sorted, 0.99),
    }];
  }));
  const caches = Object.fromEntries(Object.entries(state().caches).map(([name, value]) => {
    const total = value.hits + value.misses;
    return [name, { ...value, hitRate: total ? value.hits / total : 0 }];
  }));
  return { latencies, caches };
}

export function resetAdminMetricsForTests() {
  globalMetrics.__adminMetricState = { latencies: {}, caches: {} };
}
