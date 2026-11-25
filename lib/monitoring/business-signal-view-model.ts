import type { MonitoringMode } from "@/lib/monitoring/contracts";
import {
  latestPercentMetric,
  latestScalarMetric,
  type MetricPoint,
  type MetricReading,
} from "@/lib/monitoring/metric-health";
import type { MetricQueryKey } from "@/lib/monitoring/prometheus-client";

export type BusinessSignalKey = Extract<MetricQueryKey,
  | "web.http.rate"
  | "web.http.error.rate"
  | "web.http.p95"
  | "worker.queue.length"
  | "worker.oldest.seconds"
>;

export type BusinessSignalState = "available" | "stale" | "unavailable" | "error" | "unsupported";

export type BusinessSignalModel = {
  key: BusinessSignalKey;
  label: string;
  description: string;
  valueLabel: string;
  statusLabel: string;
  state: BusinessSignalState;
  detail: string;
  rangeLabel: string | null;
};

export type BusinessSignalInput = {
  mode: MonitoringMode;
  historySupported: boolean;
  evidenceAvailable: boolean;
  checkedAt: number;
  series: Record<string, MetricPoint[]>;
  errors: Partial<Record<MetricQueryKey, string>>;
};

type Definition = {
  key: BusinessSignalKey;
  label: string;
  description: string;
  percent?: boolean;
  format: (value: number) => string;
};

const DEFINITIONS: Definition[] = [
  {
    key: "web.http.rate",
    label: "Web 请求量",
    description: "最近请求吞吐，用于判断服务是否仍在接收流量。",
    format: (value) => `${value.toFixed(2)} 次/秒`,
  },
  {
    key: "web.http.error.rate",
    label: "Web 5xx 错误率",
    description: "服务器错误请求占比；只展示读数，不在前端新增阈值。",
    percent: true,
    format: (value) => `${value.toFixed(2)}%`,
  },
  {
    key: "web.http.p95",
    label: "Web P95 响应时间",
    description: "95% 请求不超过该耗时，用于识别用户侧变慢。",
    format: (value) => value < 1 ? `${Math.round(value * 1_000)} 毫秒` : `${value.toFixed(2)} 秒`,
  },
  {
    key: "worker.queue.length",
    label: "最高 Worker 队列长度",
    description: "最繁忙 Worker 的等待任务数，不把多个 Worker 重复相加。",
    format: (value) => `${Math.round(value)}`,
  },
  {
    key: "worker.oldest.seconds",
    label: "最老任务等待时间",
    description: "当前等待最久任务的排队时长。",
    format: (value) => value < 60 ? `${Math.round(value)} 秒` : `${(value / 60).toFixed(1)} 分钟`,
  },
];

function validPoints(definition: Definition, points: MetricPoint[]) {
  return points.filter((point) => (
    Number.isFinite(point.timestamp)
    && Number.isFinite(point.value)
    && point.value >= 0
    && (!definition.percent || point.value <= 100)
  ));
}

function rangeLabel(definition: Definition, points: MetricPoint[]) {
  const values = validPoints(definition, points).map((point) => point.value);
  if (values.length < 2) return null;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return `所选范围 ${definition.format(minimum)} – ${definition.format(maximum)}`;
}

function missingLabel(reading: MetricReading) {
  if (reading.reason === "future") return "服务器时间异常";
  if (reading.reason === "out-of-range") return "采集值异常";
  if (reading.reason === "stale") return "数据已过期";
  return "暂无样本";
}

export function buildBusinessSignalModels(input: BusinessSignalInput): BusinessSignalModel[] {
  return DEFINITIONS.map((definition) => {
    const points = input.series[definition.key] || [];
    const reading = definition.percent
      ? latestPercentMetric(points, input.checkedAt)
      : latestScalarMetric(points, input.checkedAt);
    const hasUsableValue = reading.value !== null && reading.freshness !== "unavailable";
    const valueLabel = hasUsableValue ? definition.format(reading.value as number) : "—";
    const range = rangeLabel(definition, points);
    const error = input.errors[definition.key];

    if (!input.historySupported) {
      return {
        ...definition,
        valueLabel: "—",
        statusLabel: input.mode === "local-light" ? "线上监控接入后可用" : "当前模式未配置历史指标",
        state: "unsupported" as const,
        detail: "没有发送生产指标查询，也不会把缺失值显示为正常。",
        rangeLabel: null,
      };
    }
    if (error) {
      return {
        ...definition,
        valueLabel,
        statusLabel: "刷新失败",
        state: "error" as const,
        detail: hasUsableValue ? `显示上次成功数据 · ${error}` : error,
        rangeLabel: null,
      };
    }
    if (!hasUsableValue) {
      return {
        ...definition,
        valueLabel: "—",
        statusLabel: missingLabel(reading),
        state: "unavailable" as const,
        detail: "当前无法依据该信号判断服务影响。",
        rangeLabel: range,
      };
    }
    if (!input.evidenceAvailable || reading.freshness === "stale") {
      return {
        ...definition,
        valueLabel,
        statusLabel: "数据已过期",
        state: "stale" as const,
        detail: "保留上次有效读数，但不将它作为当前正常证据。",
        rangeLabel: range,
      };
    }
    return {
      ...definition,
      valueLabel,
      statusLabel: "已读取",
      state: "available" as const,
      detail: reading.observedAt
        ? `采样于 ${new Date(reading.observedAt).toLocaleTimeString("zh-CN", { hour12: false })}`
        : "已读取最新样本",
      rangeLabel: range,
    };
  });
}
