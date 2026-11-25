const baseUrl = process.env.STUDIO_LOAD_BASE_URL || "http://127.0.0.1:3000";
const cookie = process.env.STUDIO_LOAD_COOKIE;
const clients = Math.max(1, Number.parseInt(process.env.STUDIO_LOAD_CLIENTS || "30", 10) || 30);
const durationMs = Math.max(1_000, Number.parseInt(process.env.STUDIO_LOAD_DURATION_MS || "30000", 10) || 30_000);
const maxP95Raw = process.env.STUDIO_LOAD_MAX_P95_MS;
const maxP95Ms = maxP95Raw ? Number(maxP95Raw) : null;

if (!cookie) {
  console.error("STUDIO_LOAD_COOKIE is required for the authenticated read-only probe.");
  process.exit(1);
}

const endpoint = new URL("/api/history?view=status&source=all", baseUrl).toString();
const startedAt = performance.now();
const deadline = startedAt + durationMs;
const samples = [];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function requestStatus(clientId) {
  const requestStartedAt = performance.now();
  let status = 0;
  let bytes = 0;
  let error = null;
  try {
    const response = await fetch(endpoint, {
      headers: {
        cookie,
        "cache-control": "no-cache",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    status = response.status;
    bytes = Buffer.byteLength(await response.text());
    if (!response.ok) error = `HTTP ${response.status}`;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  samples.push({
    clientId,
    startedMs: Math.round(requestStartedAt - startedAt),
    latencyMs: performance.now() - requestStartedAt,
    status,
    bytes,
    error,
  });
}

async function runClient(clientId) {
  await wait(Math.random() * 2_000);
  while (performance.now() < deadline) {
    await requestStatus(clientId);
    await wait(1_800 + Math.random() * 400);
  }
}

await Promise.all(Array.from({ length: clients }, (_, index) => runClient(index + 1)));

const sortedLatencies = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
const percentile = (ratio) => {
  if (!sortedLatencies.length) return 0;
  const index = Math.max(0, Math.ceil(sortedLatencies.length * ratio) - 1);
  return sortedLatencies[Math.min(index, sortedLatencies.length - 1)];
};
const buckets = new Map();
for (const sample of samples) {
  const bucket = Math.floor(sample.startedMs / 100) * 100;
  buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
}
const busiestBucket = Array.from(buckets.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] || [0, 0];
const errorCount = samples.filter((sample) => sample.error).length;
const p95LatencyMs = percentile(0.95);
const report = {
  target: new URL(endpoint).origin,
  clients,
  configuredDurationMs: durationMs,
  requestCount: samples.length,
  errorCount,
  responseBytes: samples.reduce((total, sample) => total + sample.bytes, 0),
  latencyMs: {
    p50: Number(percentile(0.5).toFixed(1)),
    p95: Number(p95LatencyMs.toFixed(1)),
  },
  busiest100msBucket: {
    startedMs: busiestBucket[0],
    requestCount: busiestBucket[1],
  },
};

console.log(JSON.stringify(report, null, 2));

if (errorCount > 0 || (Number.isFinite(maxP95Ms) && maxP95Ms != null && p95LatencyMs > maxP95Ms)) {
  process.exitCode = 1;
}
