import { describe, expect, it } from "vitest";

import {
  buildMetricQueryWindow,
  collapseMetricSeries,
  hostHealthFromMetrics,
  latestPercentMetric,
  latestScalarMetric,
  percentMetricState,
} from "@/lib/monitoring/metric-health";

const NOW = Date.parse("2026-07-28T08:00:00.000Z");

describe("monitoring metric health", () => {
  it("uses the newest sample and marks a fresh percentage healthy", () => {
    const reading = latestPercentMetric([
      { timestamp: NOW - 60_000, value: 41 },
      { timestamp: NOW - 5_000, value: 42.5 },
    ], NOW);

    expect(reading).toEqual({
      value: 42.5,
      observedAt: NOW - 5_000,
      ageMs: 5_000,
      freshness: "fresh",
      reason: null,
    });
    expect(percentMetricState(reading)).toBe("healthy");
  });

  it("never treats missing, stale, future, or out-of-range data as healthy", () => {
    const missing = latestPercentMetric([], NOW);
    const stale = latestPercentMetric([{ timestamp: NOW - 91_000, value: 10 }], NOW);
    const future = latestPercentMetric([{ timestamp: NOW + 31_000, value: 10 }], NOW);
    const invalid = latestPercentMetric([{ timestamp: NOW - 1_000, value: 101 }], NOW);

    expect(percentMetricState(missing)).toBe("unavailable");
    expect(percentMetricState(stale)).toBe("stale");
    expect(percentMetricState(future)).toBe("unavailable");
    expect(percentMetricState(invalid)).toBe("unavailable");
  });

  it("preserves warning and critical thresholds, including stale high readings", () => {
    const warning = latestPercentMetric([{ timestamp: NOW - 1_000, value: 85 }], NOW);
    const criticalButStale = latestPercentMetric([{ timestamp: NOW - 91_000, value: 95 }], NOW);

    expect(percentMetricState(warning)).toBe("warning");
    expect(percentMetricState(criticalButStale)).toBe("critical");
  });

  it("collapses multiple instances or filesystems to the highest value per timestamp", () => {
    expect(collapseMetricSeries([
      { points: [{ timestamp: NOW - 60_000, value: 20 }, { timestamp: NOW, value: 40 }] },
      { points: [{ timestamp: NOW - 60_000, value: 75 }, { timestamp: NOW, value: 60 }] },
    ])).toEqual([
      { timestamp: NOW - 60_000, value: 75 },
      { timestamp: NOW, value: 60 },
    ]);
  });

  it("makes the host unavailable when full monitoring misses one resource metric", () => {
    expect(hostHealthFromMetrics("healthy", true, {
      cpu: latestPercentMetric([{ timestamp: NOW, value: 20 }], NOW),
      memory: latestPercentMetric([{ timestamp: NOW, value: 50 }], NOW),
      disk: latestPercentMetric([], NOW),
    })).toBe("unavailable");

    expect(hostHealthFromMetrics("healthy", false, {
      cpu: latestPercentMetric([], NOW),
      memory: latestPercentMetric([], NOW),
      disk: latestPercentMetric([], NOW),
    })).toBe("healthy");
  });

  it("turns the visible time-range control into bounded Prometheus query parameters", () => {
    expect(buildMetricQueryWindow({
      preset: "6h",
      from: "2026-07-27",
      to: "2026-07-28",
    }, NOW)).toEqual({
      startSeconds: (NOW - 6 * 60 * 60 * 1_000) / 1_000,
      endSeconds: NOW / 1_000,
      stepSeconds: 60,
    });

    expect(() => buildMetricQueryWindow({
      preset: "custom",
      from: "2026-07-01",
      to: "2026-07-28",
    }, NOW)).toThrow("7 天");
  });

  it("keeps scalar metrics truthful without applying percentage limits", () => {
    const largeQueue = latestScalarMetric([
      { timestamp: NOW - 1_000, value: 245 },
    ], NOW);
    const missing = latestScalarMetric([], NOW);
    const stale = latestScalarMetric([{ timestamp: NOW - 91_000, value: 12 }], NOW);
    const future = latestScalarMetric([{ timestamp: NOW + 31_000, value: 12 }], NOW);
    const negative = latestScalarMetric([{ timestamp: NOW - 1_000, value: -1 }], NOW);

    expect(largeQueue).toMatchObject({ value: 245, freshness: "fresh", reason: null });
    expect(missing).toMatchObject({ value: null, freshness: "unavailable", reason: "missing" });
    expect(stale).toMatchObject({ value: 12, freshness: "stale", reason: "stale" });
    expect(future).toMatchObject({ freshness: "unavailable", reason: "future" });
    expect(negative).toMatchObject({ freshness: "unavailable", reason: "out-of-range" });
  });
});
