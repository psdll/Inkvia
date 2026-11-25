import { describe, expect, it } from "vitest";

import {
  compareReleaseWindows,
  forecastCapacity,
  summarizeCost,
  summarizeProviderHealth,
} from "@/lib/monitoring/reliability-service";

describe("monitoring reliability calculations", () => {
  it("does not label unpriced usage as actual cost", () => {
    expect(summarizeCost([
      { amount: 0, costStatus: "unpriced", currency: "CNY" },
      { amount: 12.5, costStatus: "priced", currency: "CNY" },
      { amount: 3.2, costStatus: "estimated", currency: "CNY" },
      { amount: 0, costStatus: "free", currency: "CNY" },
    ])).toEqual({
      currency: "CNY",
      actualAmount: 12.5,
      estimatedAmount: 3.2,
      pricedCount: 1,
      estimatedCount: 1,
      unpricedCount: 1,
      freeCount: 1,
      failedCount: 0,
      totalRecords: 4,
    });
  });

  it("marks provider scores insufficient when the sample is too small", () => {
    const providers = summarizeProviderHealth([
      { provider: "provider-a", requestCount: 10, successCount: 9, failedCount: 1, avgLatencyMs: 1_200 },
      { provider: "provider-b", requestCount: 100, successCount: 96, failedCount: 4, avgLatencyMs: 900 },
    ]);

    expect(providers[0]).toMatchObject({
      provider: "provider-b",
      sampleSize: 100,
      confidence: "sufficient",
      successRate: 96,
    });
    expect(providers[1]).toMatchObject({
      provider: "provider-a",
      sampleSize: 10,
      confidence: "insufficient",
      score: null,
    });
  });

  it("withholds capacity days when fewer than seven daily samples exist", () => {
    const fiveSamples = Array.from({ length: 5 }, (_, index) => ({
      day: `2026-07-${String(20 + index).padStart(2, "0")}`,
      totalBytes: (index + 1) * 1_000,
    }));

    expect(forecastCapacity(fiveSamples, 20_000)).toMatchObject({
      daysToFull: null,
      confidence: "insufficient",
      sampleDays: 5,
    });
  });

  it("forecasts capacity only from a positive bounded daily growth rate", () => {
    const samples = Array.from({ length: 10 }, (_, index) => ({
      day: `2026-07-${String(10 + index).padStart(2, "0")}`,
      totalBytes: 10_000 + index * 1_000,
    }));

    expect(forecastCapacity(samples, 30_000)).toMatchObject({
      usedBytes: 19_000,
      growthBytesPerDay: 1_000,
      daysToFull: 11,
      confidence: "medium",
      sampleDays: 10,
    });
  });

  it("labels release comparisons insufficient until both windows contain evidence", () => {
    expect(compareReleaseWindows({
      before: { requests: 0, failures: 0, avgLatencyMs: null },
      after: { requests: 50, failures: 2, avgLatencyMs: 800 },
    })).toMatchObject({ confidence: "insufficient", failureRateDelta: null });

    expect(compareReleaseWindows({
      before: { requests: 100, failures: 5, avgLatencyMs: 1_000 },
      after: { requests: 100, failures: 2, avgLatencyMs: 800 },
    })).toMatchObject({
      confidence: "sufficient",
      failureRateDelta: -3,
      latencyDeltaPercent: -20,
    });
  });
});
