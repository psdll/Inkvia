import type { LogFilter } from "@/lib/monitoring/loki-client";

const SAFE_ALERT_LABELS = new Set([
  "alertname",
  "severity",
  "service",
  "component",
  "instance",
  "worker",
  "environment",
]);

export type MonitoringAlertState = "firing" | "acknowledged" | "silenced" | "recovered";

export type MonitoringAlert = {
  fingerprint: string;
  source: "project" | "alertmanager";
  name: string;
  severity: "info" | "warning" | "critical";
  state: MonitoringAlertState;
  component: string;
  summary: string;
  description: string;
  startsAt: string;
  endsAt: string;
  updatedAt: string;
  recoveredAt?: string;
  expiresAt?: string;
  observedPercent?: number;
  peakPercent?: number;
  warningPercent?: number;
  criticalPercent?: number;
  resourcePath?: string;
  supportsAcknowledge: boolean;
  supportsSilence: boolean;
  labels: Record<string, string>;
  silenceIds: string[];
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  acknowledgementNote?: string;
};

export type AlertAcknowledgement = {
  by: string;
  at: string;
  note?: string;
};

export function redactMonitoringText(value: unknown) {
  return String(value ?? "")
    .replace(
      /\b(authorization|api[-_]?key|password|passwd|cookie|set-cookie|token)\b\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/'(?:''|[^'])*'/g, "'[REDACTED]'")
    .replace(/[A-Za-z]:\\(?:Users|ProgramData|Windows)\\[^\s,;]+/gi, "[PRIVATE_PATH]")
    .replace(/\/(?:home|root|srv|var\/lib)\/[^\s,;]+/gi, "[PRIVATE_PATH]")
    .slice(0, 16_384);
}

function safeSeverity(value: unknown): MonitoringAlert["severity"] {
  const severity = String(value || "").toLowerCase();
  if (severity === "critical") return "critical";
  if (severity === "warning" || severity === "warn") return "warning";
  return "info";
}

function safeDate(value: unknown, fallback: Date) {
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback.toISOString();
}

export function normalizeAlertmanagerAlerts(
  rawAlerts: unknown,
  acknowledgements: Record<string, AlertAcknowledgement> = {},
  now = new Date(),
): MonitoringAlert[] {
  if (!Array.isArray(rawAlerts)) return [];
  return rawAlerts.slice(0, 200).flatMap((raw: any) => {
    const fingerprint = String(raw?.fingerprint || "").trim().toLowerCase();
    if (!/^[a-f0-9]{8,64}$/.test(fingerprint)) return [];
    const labels = Object.fromEntries(
      Object.entries(raw?.labels || {}).flatMap(([key, value]) => (
        SAFE_ALERT_LABELS.has(key) && typeof value === "string"
          ? [[key, redactMonitoringText(value).slice(0, 256)]]
          : []
      )),
    );
    const startsAt = safeDate(raw?.startsAt, now);
    const endsAt = safeDate(raw?.endsAt, new Date(now.getTime() + 60_000));
    const updatedAt = safeDate(raw?.updatedAt, now);
    const silenceIds = Array.isArray(raw?.status?.silencedBy)
      ? raw.status.silencedBy.filter((value: unknown) => typeof value === "string").slice(0, 20)
      : [];
    const recovered = new Date(endsAt).getTime() <= now.getTime();
    const silenced = raw?.status?.state === "suppressed" || silenceIds.length > 0;
    const savedAcknowledgement = acknowledgements[fingerprint];
    // A fingerprint identifies the rule/labels, not a single firing episode.
    // A previous acknowledgement must not hide a new occurrence.
    const acknowledgement = savedAcknowledgement
      && new Date(savedAcknowledgement.at).getTime() >= new Date(startsAt).getTime()
      ? savedAcknowledgement
      : undefined;
    const state: MonitoringAlertState = recovered
      ? "recovered"
      : silenced
        ? "silenced"
        : acknowledgement
          ? "acknowledged"
          : "firing";

    return [{
      fingerprint,
      source: "alertmanager",
      name: String(labels.alertname || "UnnamedAlert").slice(0, 120),
      severity: safeSeverity(labels.severity),
      state,
      component: String(labels.component || labels.service || labels.instance || "unknown").slice(0, 120),
      summary: redactMonitoringText(raw?.annotations?.summary || "监控系统检测到异常").slice(0, 500),
      description: redactMonitoringText(raw?.annotations?.description || "").slice(0, 2_000),
      startsAt,
      endsAt,
      updatedAt,
      supportsAcknowledge: !recovered,
      supportsSilence: !recovered,
      labels,
      silenceIds,
      ...(acknowledgement
        ? {
          acknowledgedBy: String(acknowledgement.by || "").slice(0, 120),
          acknowledgedAt: safeDate(acknowledgement.at, now),
          acknowledgementNote: redactMonitoringText(acknowledgement.note || "").slice(0, 500),
        }
        : {}),
    }];
  });
}

export type ProjectUploadDiskAlertRecord = {
  fingerprint: string;
  state: string;
  severity: string;
  component: string;
  summary: string;
  description: string;
  currentPercent: number;
  peakPercent: number;
  warningPercent: number;
  criticalPercent: number;
  resourcePath: string;
  startsAt: Date;
  lastObservedAt: Date;
  recoveredAt: Date | null;
  expiresAt: Date | null;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  acknowledgementNote: string | null;
  silencedUntil: Date | null;
  updatedAt: Date;
};

export function normalizeProjectUploadDiskAlert(
  record: ProjectUploadDiskAlertRecord,
  now = new Date(),
): MonitoringAlert {
  const recovered = record.state === "recovered";
  const silenced = !recovered
    && Boolean(record.silencedUntil && record.silencedUntil.getTime() > now.getTime());
  const acknowledged = !recovered && Boolean(record.acknowledgedAt);
  const state: MonitoringAlertState = recovered
    ? "recovered"
    : silenced
      ? "silenced"
      : acknowledged
        ? "acknowledged"
        : "firing";
  const startsAt = safeDate(record.startsAt, now);
  const lastObservedAt = safeDate(record.lastObservedAt, now);

  return {
    fingerprint: String(record.fingerprint).toLowerCase(),
    source: "project",
    name: "UploadDiskWatermark",
    severity: safeSeverity(record.severity),
    state,
    component: String(record.component || "upload-storage").slice(0, 120),
    summary: redactMonitoringText(record.summary).slice(0, 500),
    description: redactMonitoringText(record.description).slice(0, 2_000),
    startsAt,
    endsAt: recovered && record.recoveredAt
      ? record.recoveredAt.toISOString()
      : lastObservedAt,
    updatedAt: safeDate(record.updatedAt || record.lastObservedAt, now),
    ...(record.recoveredAt ? { recoveredAt: record.recoveredAt.toISOString() } : {}),
    ...(record.expiresAt ? { expiresAt: record.expiresAt.toISOString() } : {}),
    observedPercent: record.currentPercent,
    peakPercent: record.peakPercent,
    warningPercent: record.warningPercent,
    criticalPercent: record.criticalPercent,
    resourcePath: redactMonitoringText(record.resourcePath).slice(0, 1_000),
    supportsAcknowledge: !recovered,
    supportsSilence: !recovered,
    labels: {
      alertname: "UploadDiskWatermark",
      severity: safeSeverity(record.severity),
      component: "upload-storage",
    },
    silenceIds: [],
    ...(record.acknowledgedBy ? { acknowledgedBy: record.acknowledgedBy.slice(0, 120) } : {}),
    ...(record.acknowledgedAt ? { acknowledgedAt: record.acknowledgedAt.toISOString() } : {}),
    ...(record.acknowledgementNote
      ? { acknowledgementNote: redactMonitoringText(record.acknowledgementNote).slice(0, 500) }
      : {}),
  };
}

export function validateSilenceEnd(value: unknown, now = new Date()) {
  const end = new Date(String(value || ""));
  if (!Number.isFinite(end.getTime())) throw new Error("静默结束时间无效");
  if (end.getTime() <= now.getTime()) throw new Error("静默结束时间必须晚于当前时间");
  if (end.getTime() - now.getTime() > 24 * 60 * 60 * 1_000) {
    throw new Error("单次静默不能超过 24 小时");
  }
  return end.toISOString();
}

export type IssueEvidence = {
  kind:
    | "host.cpu"
    | "host.memory"
    | "host.disk"
    | "web.errors"
    | "worker.queue"
    | "postgres.connections"
    | "monitoring.stale"
    | "unknown";
  severity: "warning" | "critical";
  summary: string;
  traceId?: string;
};

type IssueTemplate = {
  domain: "服务器" | "项目" | "数据库" | "监控";
  component: string;
  impact: string;
  rootCauseCandidate: string;
  logFilter: Pick<LogFilter, "service" | "level">;
  guidance: string[];
  safeActions: string[];
};

const ISSUE_TEMPLATES: Record<IssueEvidence["kind"], IssueTemplate> = {
  "host.cpu": {
    domain: "服务器",
    component: "CPU",
    impact: "页面和任务响应可能变慢",
    rootCauseCandidate: "进程持续占用、任务突增或采集负载异常",
    logFilter: { service: "web", level: "error" },
    guidance: ["先查看 CPU 高点是否持续超过 5 分钟", "再核对 Web 与 Worker 是否同时出现错误或队列堆积"],
    safeActions: ["open_logs", "refresh_metrics"],
  },
  "host.memory": {
    domain: "服务器",
    component: "动态内存",
    impact: "进程可能被系统终止，任务可能失败",
    rootCauseCandidate: "内存泄漏、并发任务过多或缓存持续增长",
    logFilter: { service: "web", level: "error" },
    guidance: ["比较进程堆内存与服务器总内存走势", "确认是否只有单个服务持续增长"],
    safeActions: ["open_logs", "refresh_metrics", "restart_web"],
  },
  "host.disk": {
    domain: "服务器",
    component: "磁盘存储",
    impact: "日志、上传或数据库写入可能失败",
    rootCauseCandidate: "日志未轮转、临时文件堆积或业务数据增长",
    logFilter: { service: "ops", level: "error" },
    guidance: ["先确认占用增长来自日志还是业务数据", "只清理已轮转旧日志，不删除当前日志"],
    safeActions: ["open_logs", "rotate_logs"],
  },
  "web.errors": {
    domain: "项目",
    component: "Inkvia Web",
    impact: "页面或 API 请求失败",
    rootCauseCandidate: "应用异常、上游接口失败或数据库连接异常",
    logFilter: { service: "web", level: "error" },
    guidance: ["按请求 ID 或 Trace ID 查看完整调用链", "确认错误集中在哪个接口和发布时间段"],
    safeActions: ["open_logs", "open_trace", "restart_web"],
  },
  "worker.queue": {
    domain: "项目",
    component: "Canvas Generation Worker",
    impact: "生成任务等待时间增加",
    rootCauseCandidate: "Worker 停止、供应商响应慢或任务重试堆积",
    logFilter: { service: "generation-worker", level: "error" },
    guidance: ["先确认两个 Worker 的进程和心跳", "再按任务 ID 检查供应商错误与重试次数"],
    safeActions: ["open_logs", "open_trace", "restart_generation_worker"],
  },
  "postgres.connections": {
    domain: "数据库",
    component: "PostgreSQL",
    impact: "应用查询和写入可能排队或失败",
    rootCauseCandidate: "连接未释放、慢查询或连接上限过低",
    logFilter: { service: "postgresql", level: "error" },
    guidance: ["查看连接状态分布和持续时间最长的查询", "网页只查看，不停止或重启数据库"],
    safeActions: ["open_logs", "refresh_metrics"],
  },
  "monitoring.stale": {
    domain: "监控",
    component: "采集链路",
    impact: "面板无法反映当前真实状态",
    rootCauseCandidate: "Alloy、Prometheus 或网络连接异常",
    logFilter: { service: "alloy", level: "error" },
    guidance: ["先核对数据更新时间", "再查看采集器和 Prometheus 目标状态"],
    safeActions: ["open_logs", "refresh_metrics"],
  },
  unknown: {
    domain: "项目",
    component: "待确认",
    impact: "需要结合日志确认影响范围",
    rootCauseCandidate: "当前证据不足",
    logFilter: { service: "web", level: "error" },
    guidance: ["记录发生时间和用户可见现象", "从同一时间段的错误日志开始排查"],
    safeActions: ["open_logs", "refresh_metrics"],
  },
};

export function buildIssueCard(evidence: IssueEvidence) {
  const template = ISSUE_TEMPLATES[evidence.kind] || ISSUE_TEMPLATES.unknown;
  const traceId = /^(?:[a-f0-9]{16}|[a-f0-9]{32})$/i.test(String(evidence.traceId || ""))
    ? String(evidence.traceId).toLowerCase()
    : undefined;
  return {
    domain: template.domain,
    component: template.component,
    severity: evidence.severity,
    impact: template.impact,
    rootCauseCandidate: template.rootCauseCandidate,
    summary: redactMonitoringText(evidence.summary).slice(0, 500),
    logFilter: template.logFilter,
    traceId,
    guidance: [...template.guidance],
    safeActions: template.safeActions.filter((action) => action !== "open_trace" || traceId),
  };
}

function sanitizeEvidence(value: unknown, depth = 0): any {
  if (depth > 5 || value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return redactMonitoringText(value).slice(0, 4_000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 1_000).map((item) => sanitizeEvidence(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .filter(([key]) => !/secret|password|authorization|cookie|api.?key/i.test(key))
        .map(([key, item]) => [key, sanitizeEvidence(item, depth + 1)]),
    );
  }
  return String(value).slice(0, 500);
}

export function buildDiagnosticReport(input: {
  createdAt?: Date;
  overview: unknown;
  alerts: unknown[];
  logs: unknown[];
}) {
  const report = {
    schemaVersion: 1,
    createdAt: (input.createdAt || new Date()).toISOString(),
    overview: sanitizeEvidence(input.overview),
    alerts: sanitizeEvidence(input.alerts.slice(0, 100)),
    logs: sanitizeEvidence(input.logs.slice(0, 1_000)),
    note: "本报告只包含受限、脱敏的监控证据，不包含自动执行指令。",
  };
  const reportBytes = () => new TextEncoder().encode(JSON.stringify(report)).byteLength;
  while (reportBytes() > 2 * 1024 * 1024 && report.logs.length) {
    report.logs.splice(Math.max(0, report.logs.length - 100), 100);
  }
  while (reportBytes() > 2 * 1024 * 1024 && report.alerts.length) {
    report.alerts.splice(Math.max(0, report.alerts.length - 10), 10);
  }
  return report;
}
