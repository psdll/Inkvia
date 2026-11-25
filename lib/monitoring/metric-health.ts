import type { HealthState } from "@/lib/monitoring/contracts";

export type MetricPoint = {
  timestamp: number;
  value: number;
};

export type MetricReading = {
  value: number | null;
  observedAt: number | null;
  ageMs: number | null;
  freshness: "fresh" | "stale" | "unavailable";
  reason: "missing" | "future" | "out-of-range" | "stale" | null;
};

export type PercentMetricReading = MetricReading;

export type MetricRangeSelection = {
  preset: "1h" | "6h" | "24h" | "custom";
  from: string;
  to: string;
};

const METRIC_STALE_AFTER_MS = 90_000;
const FUTURE_TOLERANCE_MS = 30_000;

function unavailable(
  reason: Exclude<MetricReading["reason"], "stale" | null>,
  point?: MetricPoint,
  now = Date.now(),
): MetricReading {
  return {
    value: point?.value ?? null,
    observedAt: point?.timestamp ?? null,
    ageMs: point ? Math.max(0, now - point.timestamp) : null,
    freshness: "unavailable",
    reason,
  };
}

export function collapseMetricSeries(series: Array<{ points?: MetricPoint[] }>): MetricPoint[] {
  const maximumByTimestamp = new Map<number, number>();
  for (const item of series) {
    for (const point of item.points || []) {
      if (!Number.isFinite(point.timestamp) || !Number.isFinite(point.value)) continue;
      const current = maximumByTimestamp.get(point.timestamp);
      if (current === undefined || point.value > current) {
        maximumByTimestamp.set(point.timestamp, point.value);
      }
    }
  }
  return Array.from(maximumByTimestamp, ([timestamp, value]) => ({ timestamp, value }))
    .sort((left, right) => left.timestamp - right.timestamp);
}

function latestMetric(
  points: MetricPoint[],
  now: number,
  staleAfterMs: number,
  maximum: number,
): MetricReading {
  const latest = points
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value))
    .reduce<MetricPoint | null>(
      (current, point) => !current || point.timestamp > current.timestamp ? point : current,
      null,
    );

  if (!latest) return unavailable("missing");
  if (latest.timestamp > now + FUTURE_TOLERANCE_MS) return unavailable("future", latest, now);
  if (latest.value < 0 || latest.value > maximum) return unavailable("out-of-range", latest, now);

  const ageMs = Math.max(0, now - latest.timestamp);
  return {
    value: latest.value,
    observedAt: latest.timestamp,
    ageMs,
    freshness: ageMs > staleAfterMs ? "stale" : "fresh",
    reason: ageMs > staleAfterMs ? "stale" : null,
  };
}

export function latestScalarMetric(
  points: MetricPoint[],
  now = Date.now(),
  staleAfterMs = METRIC_STALE_AFTER_MS,
): MetricReading {
  return latestMetric(points, now, staleAfterMs, Number.POSITIVE_INFINITY);
}

export function latestPercentMetric(
  points: MetricPoint[],
  now = Date.now(),
  staleAfterMs = METRIC_STALE_AFTER_MS,
): PercentMetricReading {
  return latestMetric(points, now, staleAfterMs, 100);
}

export function percentMetricState(
  reading: PercentMetricReading,
  warningThreshold = 85,
  criticalThreshold = 95,
): HealthState {
  if (reading.value === null || reading.freshness === "unavailable") return "unavailable";
  if (reading.value >= criticalThreshold) return "critical";
  if (reading.value >= warningThreshold) return "warning";
  return reading.freshness === "stale" ? "stale" : "healthy";
}

const STATE_PRIORITY: Record<HealthState, number> = {
  unsupported: 0,
  healthy: 1,
  stale: 2,
  warning: 3,
  unavailable: 4,
  critical: 5,
};

export function hostHealthFromMetrics(
  baseState: HealthState,
  historySupported: boolean,
  readings: {
    cpu: PercentMetricReading;
    memory: PercentMetricReading;
    disk: PercentMetricReading;
  },
): HealthState {
  if (!historySupported) return baseState;
  return [
    baseState,
    percentMetricState(readings.cpu),
    percentMetricState(readings.memory),
    percentMetricState(readings.disk),
  ].reduce<HealthState>(
    (worst, state) => STATE_PRIORITY[state] > STATE_PRIORITY[worst] ? state : worst,
    "healthy",
  );
}

export function buildMetricQueryWindow(
  selection: MetricRangeSelection,
  now = Date.now(),
) {
  if (!Number.isFinite(now) || now <= 0) throw new Error("监控查询时间无效");

  if (selection.preset !== "custom") {
    const durationHours = selection.preset === "1h" ? 1 : selection.preset === "6h" ? 6 : 24;
    return {
      startSeconds: (now - durationHours * 60 * 60 * 1_000) / 1_000,
      endSeconds: now / 1_000,
      stepSeconds: durationHours <= 6 ? 60 : 300,
    };
  }

  const start = new Date(`${selection.from}T00:00:00`).getTime();
  const requestedEnd = new Date(`${selection.to}T23:59:59.999`).getTime();
  const end = Math.min(requestedEnd, now);
  if (!Number.isFinite(start) || !Number.isFinite(requestedEnd) || start <= 0 || end <= start) {
    throw new Error("自定义监控时间范围无效");
  }
  if (end - start > 7 * 24 * 60 * 60 * 1_000) {
    throw new Error("自定义监控时间范围不能超过 7 天");
  }
  return {
    startSeconds: start / 1_000,
    endSeconds: end / 1_000,
    stepSeconds: end - start <= 24 * 60 * 60 * 1_000 ? 300 : 900,
  };
}
