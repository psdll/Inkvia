import {
  type MonitoringServiceId,
  type ServerEvent,
  type ServerEventCategory,
  type ServerEventSeverity,
  type ServerEventState,
} from "@/lib/monitoring/contracts";
import { redactMonitoringText } from "@/lib/monitoring/fault-guidance";

const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_RANGE_MS = 7 * DAY_MS;
const MAX_RANGE_MS = 30 * DAY_MS;
const MAX_FUTURE_MS = 30_000;
const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/;

export const SERVER_EVENT_CATEGORIES = [
  "power",
  "filesystem",
  "kernel",
  "memory",
  "service",
] as const satisfies readonly ServerEventCategory[];
export const SERVER_EVENT_SEVERITIES = [
  "info",
  "warning",
  "critical",
] as const satisfies readonly ServerEventSeverity[];
export const SERVER_EVENT_STATES = [
  "active",
  "recovered",
  "historical",
] as const satisfies readonly ServerEventState[];

const CATEGORY_SET = new Set<string>(SERVER_EVENT_CATEGORIES);
const SEVERITY_SET = new Set<string>(SERVER_EVENT_SEVERITIES);
const STATE_SET = new Set<string>(SERVER_EVENT_STATES);
const SERVER_EVENT_QUERY_KEYS = new Set([
  "from",
  "to",
  "category",
  "severity",
  "state",
  "limit",
]);
const SERVICE_IDS = new Set<MonitoringServiceId>([
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

export type ServerEventQuery = {
  from: number;
  to: number;
  category: ServerEventCategory | "all";
  severity: ServerEventSeverity | "all";
  state: ServerEventState | "all";
  limit: number;
};

type SanitizeServerEventsOptions = {
  now: number;
  from: number;
  to: number;
  limit: number;
};

export type ServerEventsPayload = {
  observedAt: string;
  history: {
    state: "complete" | "partial";
    availableFrom: string;
    reason: "complete" | "history-starts-later" | "single-boot";
  };
  events: ServerEvent[];
};

function boundedInteger(raw: string | null, name: string, minimum: number, maximum: number) {
  if (raw === null || !/^\d+$/.test(raw)) throw new Error(`${name} 参数无效`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} 参数超出范围`);
  }
  return value;
}

function fixedFilter<T extends string>(
  raw: string | null,
  name: string,
  allowed: Set<string>,
): T | "all" {
  const value = raw || "all";
  if (value !== "all" && !allowed.has(value)) throw new Error(`${name} 参数无效`);
  return value as T | "all";
}

export function parseServerEventQuery(
  searchParams: URLSearchParams,
  now = Date.now(),
): ServerEventQuery {
  for (const key of new Set(searchParams.keys())) {
    if (!SERVER_EVENT_QUERY_KEYS.has(key) || searchParams.getAll(key).length !== 1) {
      throw new Error("服务器事件查询参数无效");
    }
  }
  if (!Number.isFinite(now) || now <= 0) throw new Error("当前时间无效");
  const rawFrom = searchParams.get("from");
  const rawTo = searchParams.get("to");
  if ((rawFrom === null) !== (rawTo === null)) {
    throw new Error("from 和 to 必须同时提供");
  }
  const to = rawTo === null
    ? now
    : boundedInteger(rawTo, "to", 1, Number.MAX_SAFE_INTEGER);
  const from = rawFrom === null
    ? to - DEFAULT_RANGE_MS
    : boundedInteger(rawFrom, "from", 1, Number.MAX_SAFE_INTEGER);
  if (from >= to || to > now + MAX_FUTURE_MS || to - from > MAX_RANGE_MS) {
    throw new Error("服务器事件时间范围无效");
  }
  const rawLimit = searchParams.get("limit");
  return {
    from,
    to,
    category: fixedFilter<ServerEventCategory>(
      searchParams.get("category"),
      "category",
      CATEGORY_SET,
    ),
    severity: fixedFilter<ServerEventSeverity>(
      searchParams.get("severity"),
      "severity",
      SEVERITY_SET,
    ),
    state: fixedFilter<ServerEventState>(searchParams.get("state"), "state", STATE_SET),
    limit: rawLimit === null ? 100 : boundedInteger(rawLimit, "limit", 1, 500),
  };
}

export function buildServerEventsOpsPath(query: ServerEventQuery) {
  const params = new URLSearchParams({
    from: String(Math.floor(query.from / 1_000)),
    to: String(Math.floor(query.to / 1_000)),
    category: query.category,
    severity: query.severity,
    state: query.state,
    limit: String(query.limit),
  });
  return `/v1/server-events?${params.toString()}`;
}

function isoDate(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string" || value.length > 64) throw new Error(`${label} 无效`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > maximum) throw new Error(`${label} 无效`);
  return { iso: new Date(timestamp).toISOString(), timestamp };
}

function safeText(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string" || value.length < 1) throw new Error(`${label} 无效`);
  return redactMonitoringText(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum);
}

function sanitizeEvent(
  value: unknown,
  options: SanitizeServerEventsOptions,
): ServerEvent {
  const candidate = value as any;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("服务器事件无效");
  }
  if (typeof candidate.id !== "string" || !EVENT_ID_PATTERN.test(candidate.id)) {
    throw new Error("服务器事件 ID 无效");
  }
  if (!CATEGORY_SET.has(candidate.category)
    || !SEVERITY_SET.has(candidate.severity)
    || !STATE_SET.has(candidate.state)) {
    throw new Error("服务器事件枚举无效");
  }
  const occurredAt = isoDate(candidate.occurredAt, "服务器事件时间", options.now + MAX_FUTURE_MS);
  if (occurredAt.timestamp < options.from || occurredAt.timestamp > options.to) {
    throw new Error("服务器事件超出查询范围");
  }
  if (!Array.isArray(candidate.evidence) || candidate.evidence.length > 8) {
    throw new Error("服务器事件证据无效");
  }
  if (candidate.affectedService !== undefined && !SERVICE_IDS.has(candidate.affectedService)) {
    throw new Error("服务器事件服务无效");
  }
  let recoveryObservedAt: string | undefined;
  if (candidate.recoveryObservedAt !== undefined) {
    const recovered = isoDate(
      candidate.recoveryObservedAt,
      "服务器事件恢复确认时间",
      options.now + MAX_FUTURE_MS,
    );
    if (recovered.timestamp < occurredAt.timestamp) throw new Error("服务器事件恢复时间无效");
    recoveryObservedAt = recovered.iso;
  }
  return {
    id: candidate.id,
    occurredAt: occurredAt.iso,
    category: candidate.category,
    severity: candidate.severity,
    state: candidate.state,
    title: safeText(candidate.title, "服务器事件标题", 120),
    summary: safeText(candidate.summary, "服务器事件摘要", 500),
    impact: safeText(candidate.impact, "服务器事件影响", 500),
    affectedService: candidate.affectedService,
    recoveryObservedAt,
    evidence: candidate.evidence.map((item: any) => ({
      label: safeText(item?.label, "服务器事件证据名称", 40),
      value: safeText(item?.value, "服务器事件证据内容", 500),
    })),
  };
}

export function sanitizeServerEventsPayload(
  payload: unknown,
  options: SanitizeServerEventsOptions,
): ServerEventsPayload {
  if (!Number.isFinite(options.now)
    || !Number.isFinite(options.from)
    || !Number.isFinite(options.to)
    || !Number.isInteger(options.limit)
    || options.limit < 1
    || options.limit > 500) {
    throw new Error("服务器事件校验参数无效");
  }
  const candidate = payload as any;
  if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.events)) {
    throw new Error("服务器事件响应无效");
  }
  if (candidate.events.length > options.limit) throw new Error("服务器事件响应超出条数限制");
  const observedAt = isoDate(
    candidate.observedAt,
    "服务器事件响应时间",
    options.now + MAX_FUTURE_MS,
  );
  const historyCandidate = candidate.history;
  const historyStates = new Set(["complete", "partial"]);
  const historyReasons = new Set([
    "complete",
    "history-starts-later",
    "single-boot",
  ]);
  if (!historyCandidate
    || typeof historyCandidate !== "object"
    || !historyStates.has(historyCandidate.state)
    || !historyReasons.has(historyCandidate.reason)) {
    throw new Error("服务器事件历史覆盖范围无效");
  }
  const availableFrom = isoDate(
    historyCandidate.availableFrom,
    "服务器事件历史开始时间",
    options.now + MAX_FUTURE_MS,
  );
  if ((historyCandidate.state === "complete") !== (historyCandidate.reason === "complete")) {
    throw new Error("服务器事件历史覆盖范围无效");
  }
  if ((historyCandidate.state === "complete") !== (availableFrom.timestamp <= options.from)) {
    throw new Error("服务器事件历史覆盖范围无效");
  }
  const seen = new Set<string>();
  const events = candidate.events.map((item: unknown) => {
    const event = sanitizeEvent(item, options);
    if (seen.has(event.id)) throw new Error("服务器事件 ID 重复");
    seen.add(event.id);
    return event;
  }).sort((left: ServerEvent, right: ServerEvent) => (
    Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
  ));
  return {
    observedAt: observedAt.iso,
    history: {
      state: historyCandidate.state,
      availableFrom: availableFrom.iso,
      reason: historyCandidate.reason,
    },
    events,
  };
}
