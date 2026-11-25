import type { MonitoringServiceId } from "@/lib/monitoring/contracts";
import { redactMonitoringText } from "@/lib/monitoring/fault-guidance";

const LOG_SERVICES = new Set<MonitoringServiceId>([
  "web",
  "generation-worker",
  "media-worker",
  "live-video-prompt-worker",
  "live-video-video-worker",
  "nginx",
  "postgresql",
  "prometheus",
  "loki",
  "tempo",
  "grafana",
  "alloy",
  "alertmanager",
  "postgres-exporter",
  "ops",
]);

const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);
const SAFE_LABELS = new Set([
  "service",
  "level",
  "request_id",
  "trace_id",
  "generation_id",
  "provider",
  "model",
]);

export type LogFilter = {
  service: MonitoringServiceId;
  level?: "debug" | "info" | "warn" | "error";
  query?: string;
  requestId?: string;
  traceId?: string;
  generationId?: string;
  provider?: string;
  model?: string;
  limit: number;
  direction: "forward" | "backward";
};

export type LokiLogEntry = {
  timestamp: number;
  line: string;
  labels: Record<string, string>;
};

function optionalText(value: unknown, name: string, maximumLength: number) {
  const text = String(value || "").trim();
  if (!text) return undefined;
  if (text.length > maximumLength || /[\u0000-\u001f]/.test(text)) {
    throw new Error(`${name} 筛选条件无效`);
  }
  return text;
}

export function normalizeLogFilter(input: Record<string, unknown>): LogFilter {
  const service = String(input.service || "").trim() as MonitoringServiceId;
  if (!LOG_SERVICES.has(service)) throw new Error("日志服务无效");

  const levelValue = String(input.level || "").trim().toLowerCase();
  if (levelValue && !LOG_LEVELS.has(levelValue)) throw new Error("日志级别无效");

  const rawLimit = input.limit === undefined || input.limit === "" ? 200 : Number(input.limit);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 1_000) {
    throw new Error("日志条数必须在 1 到 1000 之间");
  }

  const directionValue = String(input.direction || "backward").trim();
  if (directionValue !== "forward" && directionValue !== "backward") {
    throw new Error("日志排序方向无效");
  }

  return {
    service,
    level: levelValue as LogFilter["level"] || undefined,
    query: optionalText(input.query, "日志关键字", 200),
    requestId: optionalText(input.requestId, "请求 ID", 128),
    traceId: optionalText(input.traceId, "Trace ID", 32),
    generationId: optionalText(input.generationId, "生成任务 ID", 128),
    provider: optionalText(input.provider, "供应商", 80),
    model: optionalText(input.model, "模型", 120),
    limit: rawLimit,
    direction: directionValue,
  };
}

export function buildSafeLogQuery(filter: LogFilter) {
  let query = `{service=${JSON.stringify(filter.service)}}`;
  if (filter.level) query += ` | json | level=${JSON.stringify(filter.level)}`;
  if (filter.requestId) query += ` | request_id=${JSON.stringify(filter.requestId)}`;
  if (filter.traceId) query += ` | trace_id=${JSON.stringify(filter.traceId)}`;
  if (filter.generationId) query += ` | generation_id=${JSON.stringify(filter.generationId)}`;
  if (filter.provider) query += ` | provider=${JSON.stringify(filter.provider)}`;
  if (filter.model) query += ` | model=${JSON.stringify(filter.model)}`;
  if (filter.query) query += ` |= ${JSON.stringify(filter.query)}`;
  return query;
}

type QueryLokiLogsInput = {
  endpoint: string;
  filter: LogFilter;
  startNanoseconds: string;
  endNanoseconds: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export async function queryLokiLogs(input: QueryLokiLogsInput) {
  if (!/^\d{16,20}$/.test(input.startNanoseconds) || !/^\d{16,20}$/.test(input.endNanoseconds)) {
    throw new Error("日志时间范围无效");
  }
  const url = new URL("/loki/api/v1/query_range", input.endpoint);
  url.searchParams.set("query", buildSafeLogQuery(input.filter));
  url.searchParams.set("start", input.startNanoseconds);
  url.searchParams.set("end", input.endNanoseconds);
  url.searchParams.set("limit", String(input.filter.limit));
  url.searchParams.set("direction", input.filter.direction);

  const response = await (input.fetchImpl || fetch)(url.toString(), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(input.timeoutMs),
    cache: "no-store",
  });
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 4 * 1024 * 1024) throw new Error("日志响应过大");
  if (!response.ok) throw new Error(`Loki 查询失败 (${response.status})`);

  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Loki 返回了无效数据");
  }
  if (payload?.status !== "success" || !Array.isArray(payload?.data?.result)) {
    throw new Error("Loki 返回了无效数据");
  }

  const entries: LokiLogEntry[] = payload.data.result.flatMap((stream: any) => {
    const labels = Object.fromEntries(
      Object.entries(stream?.stream || {}).filter(([key, value]) => (
        SAFE_LABELS.has(key) && typeof value === "string"
      )),
    );
    return (Array.isArray(stream?.values) ? stream.values : []).flatMap((item: unknown) => {
      if (!Array.isArray(item) || item.length < 2 || typeof item[1] !== "string") return [];
      const nanoseconds = Number(item[0]);
      if (!Number.isFinite(nanoseconds)) return [];
      return [{
        timestamp: Math.floor(nanoseconds / 1_000_000),
        line: redactMonitoringText(item[1]).slice(0, 16_384),
        labels,
      }];
    });
  }).slice(0, input.filter.limit);

  return { entries };
}
