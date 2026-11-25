export const CANVAS_COUNTER_METRICS = [
  "canvas_mutation_total",
  "canvas_mutation_conflict_total",
  "canvas_mutation_rejected_total",
  "canvas_rebase_auto_total",
  "canvas_rebase_manual_total",
  "canvas_idb_failure_total",
  "canvas_projection_rebuild_total",
  "canvas_step_lease_recovery_total",
  "canvas_provider_failure_total",
  "canvas_submission_unknown_total",
  "canvas_duplicate_submission_suppressed_total",
  "canvas_upload_bytes",
  "canvas_upload_failure_total",
  "canvas_media_rejected_total",
  "canvas_media_gc_failure_total",
  "canvas_client_long_task_total",
] as const;

export const CANVAS_HISTOGRAM_METRICS = [
  "canvas_open_duration_ms",
  "canvas_bootstrap_duration_ms",
  "canvas_snapshot_load_duration_ms",
  "canvas_mutation_duration_ms",
  "canvas_run_wait_duration_ms",
  "canvas_media_processing_duration_ms",
  "canvas_client_frame_duration_ms",
  "canvas_client_long_task_duration_ms",
  "canvas_client_dom_nodes",
  "canvas_client_active_decoders",
] as const;

export type CanvasCounterMetric = typeof CANVAS_COUNTER_METRICS[number];
export type CanvasHistogramMetric = typeof CANVAS_HISTOGRAM_METRICS[number];

function percentile(values: readonly number[], quantile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

export function createCanvasMetricRegistry(options: { maxSamples?: number } = {}) {
  const maxSamples = Math.max(1, Math.min(Math.floor(options.maxSamples ?? 2048), 10_000));
  const allowedCounters = new Set<string>(CANVAS_COUNTER_METRICS);
  const allowedHistograms = new Set<string>(CANVAS_HISTOGRAM_METRICS);
  const counters = new Map<string, number>();
  const histograms = new Map<string, { count: number; values: number[] }>();
  return {
    increment(name: CanvasCounterMetric, amount = 1) {
      if (!allowedCounters.has(name)) throw new Error("CANVAS_METRIC_NOT_ALLOWED");
      if (!Number.isFinite(amount) || amount < 0) return;
      counters.set(name, (counters.get(name) ?? 0) + amount);
    },
    observe(name: CanvasHistogramMetric, value: number) {
      if (!allowedHistograms.has(name)) throw new Error("CANVAS_METRIC_NOT_ALLOWED");
      if (!Number.isFinite(value) || value < 0) return;
      const histogram = histograms.get(name) ?? { count: 0, values: [] };
      histogram.count += 1;
      histogram.values.push(value);
      if (histogram.values.length > maxSamples) histogram.values.splice(0, histogram.values.length - maxSamples);
      histograms.set(name, histogram);
    },
    formatPrometheus() {
      const lines: string[] = [];
      for (const [name, value] of [...counters].sort(([left], [right]) => left.localeCompare(right))) {
        lines.push(`${name} ${value}`);
      }
      for (const [name, histogram] of [...histograms].sort(([left], [right]) => left.localeCompare(right))) {
        lines.push(`${name}{quantile="0.5"} ${percentile(histogram.values, 0.5)}`);
        lines.push(`${name}{quantile="0.95"} ${percentile(histogram.values, 0.95)}`);
        lines.push(`${name}{quantile="0.99"} ${percentile(histogram.values, 0.99)}`);
        lines.push(`${name}_count ${histogram.count}`);
      }
      return lines.join("\n");
    },
  };
}

export const canvasMetrics = createCanvasMetricRegistry();
