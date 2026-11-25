export type MetricQueryKey =
  | "host.cpu.percent"
  | "host.memory.percent"
  | "host.disk.percent"
  | "web.heap.percent"
  | "web.http.rate"
  | "web.http.error.rate"
  | "web.http.p95"
  | "worker.queue.length"
  | "worker.oldest.seconds"
  | "postgres.connections.percent";

const METRIC_QUERIES: Record<MetricQueryKey, string> = {
  "host.cpu.percent": '100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
  "host.memory.percent": "100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))",
  "host.disk.percent": '100 * (1 - (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay"}))',
  "web.heap.percent": "100 * inkvia_web_heap_used_bytes / clamp_min(inkvia_web_heap_limit_bytes, 1)",
  "web.http.rate": 'sum(rate(http_server_request_duration_seconds_count{service="web"}[5m]))',
  "web.http.error.rate": '100 * sum(rate(http_server_request_duration_seconds_count{service="web",http_status_code=~"5.."}[5m])) / clamp_min(sum(rate(http_server_request_duration_seconds_count{service="web"}[5m])), 0.001)',
  "web.http.p95": 'histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{service="web"}[5m])))',
  "worker.queue.length": 'sum by (worker) (inkvia_worker_queue_length)',
  "worker.oldest.seconds": 'max by (worker) (inkvia_worker_oldest_job_age_seconds)',
  "postgres.connections.percent": "100 * sum(pg_stat_activity_count) / clamp_min(sum(pg_settings_max_connections), 1)",
};

const SAFE_LABELS = new Set([
  "instance",
  "job",
  "service",
  "worker",
  "mountpoint",
  "device",
  "status",
]);

export function metricQueryFor(key: MetricQueryKey) {
  const query = METRIC_QUERIES[key];
  if (!query) throw new Error("不支持的监控指标");
  return query;
}

export function isMetricQueryKey(value: string): value is MetricQueryKey {
  return Object.prototype.hasOwnProperty.call(METRIC_QUERIES, value);
}

type Fetch = typeof fetch;

type QueryPrometheusRangeInput = {
  endpoint: string;
  key: MetricQueryKey;
  start: number;
  end: number;
  stepSeconds: number;
  timeoutMs: number;
  fetchImpl?: Fetch;
};

function boundedRange(start: number, end: number, stepSeconds: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= start) {
    throw new Error("监控时间范围无效");
  }
  if (end - start > 7 * 24 * 60 * 60) {
    throw new Error("监控时间范围不能超过 7 天");
  }
  if (!Number.isFinite(stepSeconds) || stepSeconds < 15 || stepSeconds > 3_600) {
    throw new Error("监控采样间隔无效");
  }
}

async function parseJsonResponse(response: Response, maximumBytes = 2 * 1024 * 1024) {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) throw new Error("监控数据响应过大");
  if (!response.ok) throw new Error(`Prometheus 查询失败 (${response.status})`);
  try {
    return JSON.parse(text) as any;
  } catch {
    throw new Error("Prometheus 返回了无效数据");
  }
}

export async function queryPrometheusRange(input: QueryPrometheusRangeInput) {
  boundedRange(input.start, input.end, input.stepSeconds);
  const url = new URL("/api/v1/query_range", input.endpoint);
  url.searchParams.set("query", metricQueryFor(input.key));
  url.searchParams.set("start", String(input.start));
  url.searchParams.set("end", String(input.end));
  url.searchParams.set("step", String(input.stepSeconds));

  const response = await (input.fetchImpl || fetch)(url.toString(), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(input.timeoutMs),
    cache: "no-store",
  });
  const payload = await parseJsonResponse(response);
  if (payload?.status !== "success" || !Array.isArray(payload?.data?.result)) {
    throw new Error("Prometheus 返回了无效数据");
  }

  const series = payload.data.result.slice(0, 100).map((item: any) => {
    const labels = Object.fromEntries(
      Object.entries(item?.metric || {}).filter(([key, value]) => (
        SAFE_LABELS.has(key) && typeof value === "string"
      )),
    );
    const points = (Array.isArray(item?.values) ? item.values : [])
      .slice(0, 10_000)
      .flatMap((point: unknown) => {
        if (!Array.isArray(point) || point.length < 2) return [];
        const timestamp = Number(point[0]) * 1_000;
        const value = Number(point[1]);
        return Number.isFinite(timestamp) && Number.isFinite(value)
          ? [{ timestamp, value }]
          : [];
      });
    return { labels, points };
  });

  return { key: input.key, series };
}
