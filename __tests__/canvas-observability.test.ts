import { describe, expect, it } from "vitest";
import { createCanvasMetricRegistry } from "@/lib/canvas/observability";

describe("canvas observability", () => {
  it("exports bounded counters and latency quantiles without sensitive labels", () => {
    const metrics = createCanvasMetricRegistry({ maxSamples: 3 });
    metrics.increment("canvas_mutation_conflict_total", 2);
    metrics.observe("canvas_mutation_duration_ms", 10);
    metrics.observe("canvas_mutation_duration_ms", 20);
    metrics.observe("canvas_mutation_duration_ms", 30);
    metrics.observe("canvas_mutation_duration_ms", 40);
    const text = metrics.formatPrometheus();
    expect(text).toContain("canvas_mutation_conflict_total 2");
    expect(text).toContain('canvas_mutation_duration_ms{quantile="0.95"}');
    expect(text).toContain("canvas_mutation_duration_ms_count 4");
    expect(text).not.toContain("canvasId");
    expect(text).not.toContain("userId");
  });

  it("rejects metric names outside the frozen low-cardinality allowlist", () => {
    const metrics = createCanvasMetricRegistry();
    expect(() => metrics.increment("canvas_user_123_total" as any)).toThrow("CANVAS_METRIC_NOT_ALLOWED");
  });
});
