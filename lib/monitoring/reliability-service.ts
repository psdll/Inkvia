import prisma from "@/lib/prisma";

function rounded(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
}

export function summarizeCost(rows: Array<{
  amount: number | string | { toString(): string };
  costStatus: string;
  currency?: string | null;
}>) {
  const summary = {
    currency: String(rows.find((row) => row.currency)?.currency || "CNY"),
    actualAmount: 0,
    estimatedAmount: 0,
    pricedCount: 0,
    estimatedCount: 0,
    unpricedCount: 0,
    freeCount: 0,
    failedCount: 0,
    totalRecords: rows.length,
  };
  for (const row of rows) {
    const amount = Number(row.amount);
    const status = String(row.costStatus || "").toLowerCase();
    if (status === "priced") {
      summary.actualAmount += Number.isFinite(amount) ? amount : 0;
      summary.pricedCount += 1;
    } else if (status === "estimated") {
      summary.estimatedAmount += Number.isFinite(amount) ? amount : 0;
      summary.estimatedCount += 1;
    } else if (status === "unpriced") {
      summary.unpricedCount += 1;
    } else if (status === "free" || status === "non_billable") {
      summary.freeCount += 1;
    } else if (status === "failed") {
      summary.failedCount += 1;
    }
  }
  summary.actualAmount = rounded(summary.actualAmount, 6);
  summary.estimatedAmount = rounded(summary.estimatedAmount, 6);
  return summary;
}

export type ProviderUsageRow = {
  provider: string;
  requestCount: number;
  successCount: number;
  failedCount: number;
  avgLatencyMs: number;
};

export function summarizeProviderHealth(rows: ProviderUsageRow[]) {
  const grouped = new Map<string, {
    requestCount: number;
    successCount: number;
    failedCount: number;
    latencyWeightedTotal: number;
  }>();
  for (const row of rows) {
    const provider = String(row.provider || "unknown").slice(0, 80);
    const current = grouped.get(provider) || {
      requestCount: 0,
      successCount: 0,
      failedCount: 0,
      latencyWeightedTotal: 0,
    };
    const requests = Math.max(0, Number(row.requestCount) || 0);
    current.requestCount += requests;
    current.successCount += Math.max(0, Number(row.successCount) || 0);
    current.failedCount += Math.max(0, Number(row.failedCount) || 0);
    current.latencyWeightedTotal += Math.max(0, Number(row.avgLatencyMs) || 0) * requests;
    grouped.set(provider, current);
  }

  return Array.from(grouped, ([provider, value]) => {
    const sampleSize = value.requestCount;
    const successRate = sampleSize > 0 ? rounded((value.successCount / sampleSize) * 100) : 0;
    const avgLatencyMs = sampleSize > 0 ? Math.round(value.latencyWeightedTotal / sampleSize) : 0;
    const confidence = sampleSize >= 20 ? "sufficient" as const : "insufficient" as const;
    const latencyScore = Math.max(0, 100 - avgLatencyMs / 50);
    const score = confidence === "sufficient"
      ? rounded(successRate * 0.8 + latencyScore * 0.2, 1)
      : null;
    return {
      provider,
      sampleSize,
      successRate,
      failureCount: value.failedCount,
      avgLatencyMs,
      confidence,
      score,
    };
  }).sort((left, right) => {
    if (left.score === null && right.score !== null) return 1;
    if (left.score !== null && right.score === null) return -1;
    return (right.score || 0) - (left.score || 0) || right.sampleSize - left.sampleSize;
  });
}

export type CapacitySample = {
  day: string;
  totalBytes: number;
};

export function forecastCapacity(rawSamples: CapacitySample[], capacityBytes: number) {
  const byDay = new Map<string, number>();
  for (const sample of rawSamples) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sample.day)) continue;
    const bytes = Number(sample.totalBytes);
    if (!Number.isFinite(bytes) || bytes < 0) continue;
    byDay.set(sample.day, bytes);
  }
  const samples = Array.from(byDay, ([day, totalBytes]) => ({ day, totalBytes }))
    .sort((left, right) => left.day.localeCompare(right.day))
    .slice(-30);
  const usedBytes = samples.at(-1)?.totalBytes || 0;
  const totalBytes = Math.max(0, Number(capacityBytes) || 0);
  if (samples.length < 7) {
    return {
      usedBytes,
      capacityBytes: totalBytes,
      usedPercent: totalBytes > 0 ? rounded((usedBytes / totalBytes) * 100) : 0,
      growthBytesPerDay: null,
      daysToFull: null,
      confidence: "insufficient" as const,
      sampleDays: samples.length,
      samples,
    };
  }

  const count = samples.length;
  const xMean = (count - 1) / 2;
  const yMean = samples.reduce((sum, sample) => sum + sample.totalBytes, 0) / count;
  let numerator = 0;
  let denominator = 0;
  samples.forEach((sample, index) => {
    numerator += (index - xMean) * (sample.totalBytes - yMean);
    denominator += (index - xMean) ** 2;
  });
  const growthBytesPerDay = denominator > 0 ? Math.max(0, numerator / denominator) : 0;
  const daysToFull = totalBytes <= 0 || growthBytesPerDay <= 0
    ? null
    : usedBytes >= totalBytes
      ? 0
      : Math.ceil((totalBytes - usedBytes) / growthBytesPerDay);
  return {
    usedBytes,
    capacityBytes: totalBytes,
    usedPercent: totalBytes > 0 ? rounded((usedBytes / totalBytes) * 100) : 0,
    growthBytesPerDay: Math.round(growthBytesPerDay),
    daysToFull,
    confidence: count >= 14 ? "high" as const : "medium" as const,
    sampleDays: count,
    samples,
  };
}

export type ReleaseWindow = {
  requests: number;
  failures: number;
  avgLatencyMs: number | null;
};

export function compareReleaseWindows(input: { before: ReleaseWindow; after: ReleaseWindow }) {
  if (input.before.requests < 20 || input.after.requests < 20) {
    return {
      confidence: "insufficient" as const,
      failureRateBefore: input.before.requests > 0
        ? rounded((input.before.failures / input.before.requests) * 100)
        : null,
      failureRateAfter: input.after.requests > 0
        ? rounded((input.after.failures / input.after.requests) * 100)
        : null,
      failureRateDelta: null,
      latencyDeltaPercent: null,
    };
  }
  const failureRateBefore = rounded((input.before.failures / input.before.requests) * 100);
  const failureRateAfter = rounded((input.after.failures / input.after.requests) * 100);
  const latencyDeltaPercent = input.before.avgLatencyMs && input.after.avgLatencyMs !== null
    ? rounded(((input.after.avgLatencyMs - input.before.avgLatencyMs) / input.before.avgLatencyMs) * 100)
    : null;
  return {
    confidence: "sufficient" as const,
    failureRateBefore,
    failureRateAfter,
    failureRateDelta: rounded(failureRateAfter - failureRateBefore),
    latencyDeltaPercent,
  };
}

export function normalizeReliabilityWindow(input: {
  from?: string | null;
  to?: string | null;
}, now = new Date()) {
  const defaultFrom = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1_000);
  const from = input.from ? new Date(`${input.from}T00:00:00`) : defaultFrom;
  const to = input.to ? new Date(`${input.to}T23:59:59.999`) : now;
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
    throw new Error("可靠性时间范围无效");
  }
  if (to.getTime() - from.getTime() > 90 * 24 * 60 * 60 * 1_000) {
    throw new Error("可靠性时间范围不能超过 90 天");
  }
  return { from, to };
}

function dayKey(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export async function readCostReliability(window: { from: Date; to: Date }) {
  const rows = await prisma.usageLedger.findMany({
    where: { occurredAt: { gte: window.from, lte: window.to } },
    select: { amount: true, costStatus: true, currency: true },
    orderBy: { occurredAt: "desc" },
    take: 20_000,
  });
  return {
    ...summarizeCost(rows),
    truncated: rows.length === 20_000,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
  };
}

export async function readProviderReliability(window: { from: Date; to: Date }) {
  const rows = await prisma.adminModelUsageDaily.findMany({
    where: { day: { gte: dayKey(window.from), lte: dayKey(window.to) } },
    select: {
      provider: true,
      requestCount: true,
      successCount: true,
      failedCount: true,
      avgLatencyMs: true,
    },
    orderBy: { day: "desc" },
    take: 5_000,
  });
  return {
    providers: summarizeProviderHealth(rows),
    truncated: rows.length === 5_000,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
  };
}

export async function readCapacityReliability(window: { from: Date; to: Date }) {
  const [rows, capacitySetting] = await Promise.all([
    prisma.adminStorageSnapshot.findMany({
      where: {
        scope: "summary",
        pathKey: "uploads",
        snapshotAt: { gte: window.from, lte: window.to },
      },
      select: { snapshotAt: true, totalBytes: true },
      orderBy: { snapshotAt: "asc" },
      take: 1_000,
    }),
    prisma.appSetting.findUnique({ where: { key: "storage_total_gb" } }),
  ]);
  const latestByDay = new Map<string, number>();
  for (const row of rows) latestByDay.set(dayKey(row.snapshotAt), Number(row.totalBytes));
  const configuredGb = Number(capacitySetting?.value || process.env.STORAGE_TOTAL_GB || 10);
  return {
    ...forecastCapacity(
      Array.from(latestByDay, ([day, totalBytes]) => ({ day, totalBytes })),
      Math.max(1, Number.isFinite(configuredGb) ? configuredGb : 10) * 1024 ** 3,
    ),
    truncated: rows.length === 1_000,
  };
}

function aggregateReleaseWindow(rows: Array<{
  taskCount: number;
  failedCount: number;
}>): ReleaseWindow {
  return rows.reduce<ReleaseWindow>((summary, row) => ({
    requests: summary.requests + row.taskCount,
    failures: summary.failures + row.failedCount,
    avgLatencyMs: null,
  }), { requests: 0, failures: 0, avgLatencyMs: null });
}

export async function readDeploymentReliability() {
  const records = await prisma.systemUpdateRecord.findMany({
    orderBy: { startedAt: "desc" },
    take: 10,
    select: {
      jobId: true,
      fromVersion: true,
      toVersion: true,
      startedAt: true,
      finishedAt: true,
      status: true,
      failedPhase: true,
      errorCode: true,
      rollbackOutcome: true,
    },
  });
  const latest = records.find((record) => record.status.toUpperCase() === "SUCCESS" && record.finishedAt);
  let comparison = compareReleaseWindows({
    before: { requests: 0, failures: 0, avgLatencyMs: null },
    after: { requests: 0, failures: 0, avgLatencyMs: null },
  });
  if (latest?.finishedAt) {
    const releaseDay = new Date(latest.finishedAt);
    const beforeFrom = new Date(releaseDay.getTime() - 3 * 24 * 60 * 60 * 1_000);
    const afterTo = new Date(releaseDay.getTime() + 3 * 24 * 60 * 60 * 1_000);
    const rows = await prisma.adminDailyStats.findMany({
      where: { day: { gte: dayKey(beforeFrom), lte: dayKey(afterTo) } },
      select: { day: true, taskCount: true, failedCount: true },
      take: 10_000,
    });
    comparison = compareReleaseWindows({
      before: aggregateReleaseWindow(rows.filter((row) => row.day < dayKey(releaseDay))),
      after: aggregateReleaseWindow(rows.filter((row) => row.day >= dayKey(releaseDay))),
    });
  }
  return {
    records: records.map((record) => ({
      ...record,
      startedAt: record.startedAt.toISOString(),
      finishedAt: record.finishedAt?.toISOString() || null,
    })),
    comparison,
  };
}
