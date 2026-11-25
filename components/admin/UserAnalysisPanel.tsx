"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import { useChartTooltip } from "./useChartTooltip";
import * as React from "react";
import { Activity, AlertTriangle, ChartColumn, ChevronDown, Database, LoaderCircle } from "lucide-react";
import styles from "./user-analysis.module.css";
import activityStyles from "./admin-activity.module.css";
import AdminActivityChart from "./AdminActivityChart";
import AdminActivityTable from "./AdminActivityTable";
import { fmtTime } from "@/lib/admin-utils";
import type { ModelFailurePeriod } from "@/lib/admin-model-failure";
import type { AdminUserStorageSummary } from "@/lib/admin-user-storage-summary";
import UserBillingTrend, { type BillingDateRange } from "./UserBillingTrend";
import type { BillingTrendPeriod } from "@/lib/admin/billing-trend";

function clamp01(n: number) {
  const x = Number(n);
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function DonutChart({
  items,
  size = 96,
  strokeWidth = 12,
}: {
  items: { label: string; value: number; color: string }[];
  size?: number;
  strokeWidth?: number;
}) {
  const total = items.reduce((acc, it) => acc + Math.max(0, Number(it.value) || 0), 0);
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;

  let offset = 0;
  const segments = total
    ? items
        .filter((it) => (Number(it.value) || 0) > 0)
        .map((it) => {
          const v = Math.max(0, Number(it.value) || 0);
          const ratio = v / total;
          const dash = ratio * c;
          const seg = (
            <circle
              key={it.label}
              cx={cx}
              cy={cy}
              r={r}
              fill="transparent"
              stroke={it.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += dash;
          return seg;
        })
    : [];

  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          <circle cx={cx} cy={cy} r={r} fill="transparent" stroke="rgba(255,255,255,0.08)" strokeWidth={strokeWidth} />
          {segments}
        </g>
        <text x={cx} y={cy - 2} textAnchor="middle" dominantBaseline="central" fill="var(--app-fg)" fontSize="15" fontWeight={700}>
          {total || 0}
        </text>
        <text x={cx} y={cy + 15} textAnchor="middle" dominantBaseline="central" fill="var(--app-muted)" fontSize="10"><UiText id="admin.mb2eedb867dbd" /></text>
      </svg>
      <div className="min-w-0 flex-1 space-y-1.5">
        {items.length ? (
          items.map((it) => {
            const v = Math.max(0, Number(it.value) || 0);
            const pct = total ? `${Math.round((v / total) * 100)}%` : "0%";
            return (
              <div key={it.label} className="flex items-center justify-between gap-2 text-[11px] text-[var(--app-muted)]">
                <div className="min-w-0 flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-sm" style={{ background: it.color }} />
                  <div className="truncate">{it.label}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-[var(--app-fg)] font-semibold tabular-nums">{v}</div>
                  <div className="tabular-nums">{pct}</div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m497c85690c4c" /></div>
        )}
      </div>
    </div>
  );
}

function Sparkline({ points, height = 38 }: { points: { label: string; value: number }[]; height?: number }) {
  const w = 240;
  const h = Math.max(28, height);
  const max = Math.max(1, ...points.map((p) => Math.max(0, Number(p.value) || 0)));
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const d = points
    .map((p, i) => {
      const v = Math.max(0, Number(p.value) || 0);
      const x = i * step;
      const y = h - (v / max) * (h - 8) - 4;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block">
      <path d={d} fill="none" stroke="rgba(99,102,241,0.95)" strokeWidth="2.2" />
      <path d={`${d} L ${w} ${h} L 0 ${h} Z`} fill="rgba(99,102,241,0.12)" />
    </svg>
  );
}

function BarList({ items }: { items: { label: string; value: number; color?: string }[] }) {
  const max = Math.max(1, ...items.map((it) => Math.max(0, Number(it.value) || 0)));
  return (
    <div className="space-y-1.5">
      {items.length ? (
        items.map((it) => {
          const v = Math.max(0, Number(it.value) || 0);
          const pct = clamp01(v / max);
          return (
            <div key={it.label} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--app-muted)]">
                <div className="min-w-0 truncate">{it.label}</div>
                <div className="text-[var(--app-fg)] font-semibold tabular-nums">{v}</div>
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: it.color || "rgba(99,102,241,0.9)" }} />
              </div>
            </div>
          );
        })
      ) : (
        <div className="py-6 text-center text-[13px] text-[var(--app-muted)]"><UiText id="admin.m497c85690c4c" /></div>
      )}
    </div>
  );
}

const CHART_COLORS = [
  "rgba(99,102,241,0.95)",
  "rgba(20,184,166,0.95)",
  "rgba(245,158,11,0.95)",
  "rgba(236,72,153,0.95)",
  "rgba(59,130,246,0.95)",
  "rgba(168,85,247,0.95)",
  "rgba(100,116,139,0.95)",
];

const STATUS_COLORS: Record<string, string> = {
  success: "rgba(16,185,129,0.95)",
  completed: "rgba(16,185,129,0.95)",
  info: "rgba(99,102,241,0.95)",
  running: "rgba(59,130,246,0.95)",
  pending: "rgba(245,158,11,0.95)",
  queued: "rgba(245,158,11,0.95)",
  warning: "rgba(245,158,11,0.95)",
  failed: "rgba(244,63,94,0.95)",
  error: "rgba(244,63,94,0.95)",
  cancelled: "rgba(148,163,184,0.95)",
  unpriced: "rgba(245,158,11,0.95)",
  priced: "rgba(16,185,129,0.95)",
  image: "rgba(99,102,241,0.95)",
  video: "rgba(20,184,166,0.95)",
  agent: "rgba(168,85,247,0.95)",
  tool: "rgba(59,130,246,0.95)",
};

function totalOf(items: Array<{ value: number }>) {
  return items.reduce((sum, item) => sum + Math.max(0, Number(item.value) || 0), 0);
}

function percentOf(value: number, total: number) {
  if (!total) return "0%";
  const pct = (Math.max(0, Number(value) || 0) / total) * 100;
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}

function colorFor(label: string, index: number) {
  const key = String(label || "").toLowerCase();
  return STATUS_COLORS[key] || CHART_COLORS[index % CHART_COLORS.length];
}

function normalizeItems(items: BarItem[]) {
  return [...items]
    .map((item, index) => ({
      ...item,
      value: Math.max(0, Number(item.value) || 0),
      color: item.color || colorFor(item.label, index),
    }))
    .filter((item) => item.value > 0);
}

function withOther(items: BarItem[], limit: number, otherLabel = "其他") {
  const sorted = normalizeItems(items).sort((a, b) => b.value - a.value);
  if (sorted.length <= limit) return sorted;
  const head = sorted.slice(0, limit);
  const otherValue = totalOf(sorted.slice(limit));
  return otherValue > 0 ? [...head, { label: otherLabel, value: otherValue, color: "rgba(100,116,139,0.95)" }] : head;
}

function hasAny(groups: BarItem[][]) {
  return groups.some((group) => totalOf(group) > 0);
}

function AnalyticsCard({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={["rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-2.5", className].join(" ")}>
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-[var(--app-fg)]">{title}</div>
          {subtitle ? <div className="mt-0.5 text-[10.5px] text-[var(--app-muted)]">{subtitle}</div> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

function EmptyChart({ label = "暂无数据" }: { label?: string }) {
  return (
    <div className="flex min-h-[96px] items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[var(--panel-2)]/25 text-[12px] text-[var(--app-muted)]">
      {label}
    </div>
  );
}

function PercentStack({ items, limit = 5, preserveOrder = false }: { items: BarItem[]; limit?: number; preserveOrder?: boolean }) {
  const { label: uiLabel } = useUiLocale();
  const data = preserveOrder ? normalizeItems(items) : withOther(items, limit);
  const total = totalOf(data);
  if (!total) return <EmptyChart />;

  return (
    <div className="space-y-2.5">
      <div className="flex h-3 overflow-hidden rounded-full bg-black/5 dark:bg-white/5">
        {data.map((item, index) => (
          <div
            key={`${item.label}_${index}`}
            title={`${item.label} ${item.value} (${percentOf(item.value, total)})`}
            className="h-full"
            style={{ width: `${Math.max(2, (item.value / total) * 100)}%`, background: item.color }}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {data.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--panel-2)]/45 px-2 py-1.5 text-[11px]">
            <div className="min-w-0 flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: item.color }} />
              <span className="truncate text-[var(--app-fg)]">{uiLabel(item.label)}</span>
            </div>
            <span className="shrink-0 text-[var(--app-muted)] tabular-nums">{item.value} · {percentOf(item.value, total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ParetoBarChart({ items, limit = 5, otherLabel = "其他" }: { items: BarItem[]; limit?: number; otherLabel?: string }) {
  const { label: uiLabel } = useUiLocale();
  const data = withOther(items, limit, otherLabel);
  const total = totalOf(data);
  const max = Math.max(1, ...data.map((item) => item.value));
  if (!total) return <EmptyChart />;

  return (
    <div className="space-y-2">
      {data.map((item, index) => (
        <div key={item.label} className="rounded-lg bg-[var(--panel-2)]/35 px-2 py-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <div className="min-w-0 flex items-center gap-1.5">
              <span className="w-5 shrink-0 text-[10px] text-[var(--app-muted)]">#{index + 1}</span>
              <span className="truncate font-medium text-[var(--app-fg)]" title={uiLabel(item.label)}>{uiLabel(item.label)}</span>
            </div>
            <span className="shrink-0 text-[var(--app-muted)] tabular-nums">{item.value} · {percentOf(item.value, total)}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/5">
            <div className="h-full rounded-full" style={{ width: `${Math.max(3, (item.value / max) * 100)}%`, background: item.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TrendAreaChart({ points }: { points: SparkPoint[] }) {
  const data = points.map((point) => ({ ...point, value: Math.max(0, Number(point.value) || 0) }));
  const total = totalOf(data);
  const width = 520;
  const height = 150;
  const padX = 10;
  const padY = 18;
  const max = Math.max(1, ...data.map((point) => point.value));
  const step = data.length > 1 ? (width - padX * 2) / (data.length - 1) : 0;
  const coords = data.map((point, index) => {
    const x = padX + index * step;
    const y = height - padY - (point.value / max) * (height - padY * 2);
    return { ...point, x, y };
  });
  const linePath = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const areaPath = coords.length ? `${linePath} L ${coords[coords.length - 1].x.toFixed(2)} ${height - padY} L ${padX} ${height - padY} Z` : "";
  const peak = coords.reduce((best, point) => (point.value > best.value ? point : best), coords[0] || { label: "--", value: 0, x: padX, y: height - padY });
  const latest = coords[coords.length - 1];

  if (!coords.length) return <EmptyChart />;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <UiProps ids={{"label":["admin.m9e2c6119865a"]}}><MiniStat label="admin.m9e2c6119865a" value={total} /></UiProps>
        <UiProps ids={{"label":["admin.m5fa34377ddca"]}}><MiniStat label="admin.m5fa34377ddca" value={`${peak.value} / ${peak.label}`} /></UiProps>
        <UiProps ids={{"label":["admin.m569af1a47dbd"]}}><MiniStat label="admin.m569af1a47dbd" value={latest ? `${latest.value} / ${latest.label}` : "--"} /></UiProps>
      </div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block rounded-lg bg-[var(--panel-2)]/25">
        <defs>
          <linearGradient id="user-analysis-trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(99,102,241,0.34)" />
            <stop offset="100%" stopColor="rgba(99,102,241,0.02)" />
          </linearGradient>
        </defs>
        <path d={`M ${padX} ${height - padY} L ${width - padX} ${height - padY}`} stroke="rgba(148,163,184,0.22)" strokeWidth="1" />
        <path d={areaPath} fill="url(#user-analysis-trend-fill)" />
        <path d={linePath} fill="none" stroke="rgba(99,102,241,0.98)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={peak.x} cy={peak.y} r="4" fill="rgba(245,158,11,0.98)" />
        {latest ? <circle cx={latest.x} cy={latest.y} r="3.5" fill="rgba(20,184,166,0.98)" /> : null}
      </svg>
      <div className="flex items-center justify-between text-[10px] text-[var(--app-muted)]">
        <span>{data[0]?.label || ""}</span>
        <span><UiText id="admin.mcd4fd6677c07" />{peak.label}</span>
        <span>{data[data.length - 1]?.label || ""}</span>
      </div>
    </div>
  );
}

type PreferenceFlowRecord = {
  model: string;
  taskType: string;
  aspectRatio: string;
  resolution: string;
  value: number;
};

type PreferenceFlowKey = "model" | "taskType" | "aspectRatio" | "resolution";

type PreferenceFlowNode = {
  id: string;
  key: PreferenceFlowKey;
  label: string;
  labelLines: string[];
  value: number;
  x: number;
  top: number;
  height: number;
};

type PreferenceFlowLink = {
  from: PreferenceFlowKey;
  to: PreferenceFlowKey;
  source: string;
  target: string;
  value: number;
};

const PREFERENCE_FLOW_STAGES = [
  { key: "model", label: "模型" },
  { key: "taskType", label: "任务类型" },
  { key: "aspectRatio", label: "宽高比" },
  { key: "resolution", label: "分辨率" },
] as const;

const PREFERENCE_FLOW_BASE_HEIGHT = 412;
const PREFERENCE_FLOW_TOP = 46;
const PREFERENCE_FLOW_BOTTOM = 16;
const PREFERENCE_FLOW_GAP = 8;
const PREFERENCE_FLOW_LABEL_LINE_HEIGHT = 12;

function flowLabelUnit(char: string) {
  return /[\u2e80-\u9fff\uf900-\ufaff]/u.test(char) ? 2 : char === " " ? 0.5 : 1;
}

function wrapFlowLabel(label: string, maxUnits = 20) {
  const lines: string[] = [];
  let line = "";
  let lineUnits = 0;

  for (const char of Array.from(label)) {
    const charUnits = flowLabelUnit(char);
    if (line && lineUnits + charUnits > maxUnits) {
      lines.push(line);
      line = char;
      lineUnits = charUnits;
    } else {
      line += char;
      lineUnits += charUnits;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["--"];
}

function preferenceFlowNodeMinHeight(labelLines: string[]) {
  return 20 + labelLines.length * PREFERENCE_FLOW_LABEL_LINE_HEIGHT;
}

function preferenceLabel(value: unknown, fallback: string) {
  return String(value || "").trim() || fallback;
}

function normalizePreferenceFlows(flows: PreferenceFlowRecord[]) {
  return flows
    .map((flow) => ({
      model: preferenceLabel(flow.model, "未标注"),
      taskType: preferenceLabel(flow.taskType, "未标注"),
      aspectRatio: preferenceLabel(flow.aspectRatio, "未设置"),
      resolution: preferenceLabel(flow.resolution, "未设置"),
      value: Math.max(0, Number(flow.value) || 0),
    }))
    .filter((flow) => flow.value > 0);
}

function preferenceFlowChartHeight(records: PreferenceFlowRecord[]) {
  const minimumColumnHeight = Math.max(...PREFERENCE_FLOW_STAGES.map((stage) => {
    const labels = new Set(records.map((record) => record[stage.key]));
    const labelHeights = Array.from(labels).reduce((sum, label) => sum + preferenceFlowNodeMinHeight(wrapFlowLabel(label)), 0);
    return labelHeights + Math.max(0, labels.size - 1) * PREFERENCE_FLOW_GAP;
  }));
  return Math.max(PREFERENCE_FLOW_BASE_HEIGHT, PREFERENCE_FLOW_TOP + PREFERENCE_FLOW_BOTTOM + minimumColumnHeight);
}

function preferenceFlowColumnEntries(records: PreferenceFlowRecord[], key: PreferenceFlowKey) {
  const totals = new Map<string, number>();
  for (const record of records) totals.set(record[key], (totals.get(record[key]) || 0) + record.value);
  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .map(([label, value]) => {
      const labelLines = wrapFlowLabel(label);
      return { label, labelLines, value, minHeight: preferenceFlowNodeMinHeight(labelLines) };
    });
}

function fitPreferenceFlowHeights(entries: Array<{ value: number; minHeight: number }>, available: number) {
  const minimumTotal = entries.reduce((sum, entry) => sum + entry.minHeight, 0);
  if (minimumTotal >= available) {
    const scale = available / Math.max(1, minimumTotal);
    return entries.map((entry) => entry.minHeight * scale);
  }

  const heights = entries.map(() => 0);
  const remaining = new Set(entries.map((_, index) => index));
  let remainingSpace = available;

  while (remaining.size) {
    const remainingValue = Array.from(remaining).reduce((sum, index) => sum + entries[index].value, 0);
    const undersized = Array.from(remaining).filter((index) => {
      const share = remainingValue ? (entries[index].value / remainingValue) * remainingSpace : remainingSpace / remaining.size;
      return share < entries[index].minHeight;
    });

    if (!undersized.length) {
      for (const index of remaining) {
        heights[index] = remainingValue ? (entries[index].value / remainingValue) * remainingSpace : remainingSpace / remaining.size;
      }
      break;
    }

    for (const index of undersized) {
      heights[index] = entries[index].minHeight;
      remainingSpace -= entries[index].minHeight;
      remaining.delete(index);
    }
  }

  return heights;
}

function buildPreferenceFlowNodes(records: PreferenceFlowRecord[], key: PreferenceFlowKey, x: number, chartHeight: number) {
  const entries = preferenceFlowColumnEntries(records, key);
  const gapTotal = Math.max(0, entries.length - 1) * PREFERENCE_FLOW_GAP;
  const available = chartHeight - PREFERENCE_FLOW_TOP - PREFERENCE_FLOW_BOTTOM - gapTotal;
  const heights = fitPreferenceFlowHeights(entries, available);

  let cursor = PREFERENCE_FLOW_TOP;
  return entries.map(({ label, labelLines, value }, index) => {
    const height = heights[index];
    const node: PreferenceFlowNode = { id: `${key}:${label}`, key, label, labelLines, value, x, top: cursor, height };
    cursor += height + PREFERENCE_FLOW_GAP;
    return node;
  });
}

function buildPreferenceFlowLinks(records: PreferenceFlowRecord[], from: PreferenceFlowKey, to: PreferenceFlowKey) {
  const grouped = new Map<string, PreferenceFlowLink>();
  for (const record of records) {
    const source = record[from];
    const target = record[to];
    const id = `${from}\u0000${source}\u0000${to}\u0000${target}`;
    const current = grouped.get(id);
    if (current) current.value += record.value;
    else grouped.set(id, { from, to, source, target, value: record.value });
  }
  return Array.from(grouped.values()).sort((a, b) => a.source.localeCompare(b.source, "zh-CN") || a.target.localeCompare(b.target, "zh-CN"));
}

function GenerationPreferenceFlow({ flows }: { flows: PreferenceFlowRecord[] }) {
  const { label: tLabel } = useUiLocale();
  const { label: uiLabel } = useUiLocale();
  const layout = React.useMemo(() => {
    const records = normalizePreferenceFlows(flows);
    const chartHeight = preferenceFlowChartHeight(records);
    const columns = PREFERENCE_FLOW_STAGES.map((stage, index) => buildPreferenceFlowNodes(records, stage.key, 28 + index * 304, chartHeight));
    const nodes = columns.flat();
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const links = PREFERENCE_FLOW_STAGES.slice(0, -1).flatMap((stage, index) => {
      const nextStage = PREFERENCE_FLOW_STAGES[index + 1];
      return nextStage ? buildPreferenceFlowLinks(records, stage.key, nextStage.key) : [];
    });
    const sourceOffsets = new Map<string, number>();
    const targetOffsets = new Map<string, number>();
    const ribbons = links.flatMap((link) => {
      const source = nodeMap.get(`${link.from}:${link.source}`);
      const target = nodeMap.get(`${link.to}:${link.target}`);
      if (!source || !target) return [];
      const sourceKey = source.id;
      const targetKey = target.id;
      const sourceHeight = (link.value / Math.max(1, source.value)) * source.height;
      const targetHeight = (link.value / Math.max(1, target.value)) * target.height;
      const sourceTop = source.top + (sourceOffsets.get(sourceKey) || 0);
      const targetTop = target.top + (targetOffsets.get(targetKey) || 0);
      sourceOffsets.set(sourceKey, (sourceOffsets.get(sourceKey) || 0) + sourceHeight);
      targetOffsets.set(targetKey, (targetOffsets.get(targetKey) || 0) + targetHeight);
      const sourceX = source.x + 164;
      const targetX = target.x;
      const controlOffset = (targetX - sourceX) * 0.46;
      return [{
        id: `${link.from}:${link.source}:${link.to}:${link.target}`,
        from: link.from,
        sourceId: source.id,
        targetId: target.id,
        value: link.value,
        d: `M ${sourceX} ${sourceTop} C ${sourceX + controlOffset} ${sourceTop}, ${targetX - controlOffset} ${targetTop}, ${targetX} ${targetTop} L ${targetX} ${targetTop + targetHeight} C ${targetX - controlOffset} ${targetTop + targetHeight}, ${sourceX + controlOffset} ${sourceTop + sourceHeight}, ${sourceX} ${sourceTop + sourceHeight} Z`,
      }];
    });
    const dominantNodeIds = new Set(columns.flatMap((column) => {
      const highestValue = Math.max(0, ...column.map((node) => node.value));
      return column.filter((node) => node.value === highestValue).map((node) => node.id);
    }));
    const dominantRibbonIds = new Set(PREFERENCE_FLOW_STAGES.slice(0, -1).flatMap((stage) => {
      const stageRibbons = ribbons.filter((ribbon) => ribbon.from === stage.key);
      const highestValue = Math.max(0, ...stageRibbons.map((ribbon) => ribbon.value));
      return stageRibbons.filter((ribbon) => ribbon.value === highestValue).map((ribbon) => ribbon.id);
    }));
    const pathsByNodeId = new Map(nodes.map((node) => {
      const matchingRecords = records.filter((record) => record[node.key] === node.label);
      const nodeIds = new Set(matchingRecords.flatMap((record) => (
        PREFERENCE_FLOW_STAGES.map((stage) => `${stage.key}:${record[stage.key]}`)
      )));
      const ribbonIds = new Set(matchingRecords.flatMap((record) => (
        PREFERENCE_FLOW_STAGES.slice(0, -1).map((stage, index) => {
          const nextStage = PREFERENCE_FLOW_STAGES[index + 1]!;
          return `${stage.key}:${record[stage.key]}:${nextStage.key}:${record[nextStage.key]}`;
        })
      )));
      return [node.id, { nodeIds, ribbonIds }] as const;
    }));
    return {
      nodes,
      ribbons,
      dominantNodeIds,
      dominantRibbonIds,
      pathsByNodeId,
      chartHeight,
      total: records.reduce((sum, record) => sum + record.value, 0),
    };
  }, [flows]);
  const [activeNodeId, setActiveNodeId] = React.useState<string | null>(null);
  const activePath = activeNodeId ? layout.pathsByNodeId.get(activeNodeId) : null;
  const activePathNodeIds = activePath?.nodeIds;
  const activePathRibbonIds = activePath?.ribbonIds;

  if (!layout.total) {
    return (
      <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel-2)]/30 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m7bdeeef9dd74" /></div>
    );
  }

  return (
    <div>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.m01d1f6eafa41" /></div>
        <div className="inline-flex w-fit items-center rounded-full border border-[var(--primary-bg)]/25 bg-[var(--primary-bg)]/10 px-2 py-1 text-[11px] font-medium tabular-nums text-[var(--app-fg)]">
          {layout.total}<UiText id="admin.mbf69671c22ef" /></div>
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--panel-2)]/30">
        <UiProps ids={{"aria-label":["admin.m67654a0b99f9"]}}><svg viewBox={`0 0 1104 ${layout.chartHeight}`} role="group" aria-label="admin.m67654a0b99f9" className="block min-w-[880px] w-full">
          {PREFERENCE_FLOW_STAGES.map((stage, index) => (
            <text key={stage.key} x={110 + index * 304} y="27" textAnchor="middle" fill="var(--app-muted)" fontSize="13" fontWeight="600">
              {uiLabel(stage.label)}
            </text>
          ))}
          {layout.ribbons.map((ribbon) => {
            const isRelated = activePathRibbonIds?.has(ribbon.id);
            const isDimmed = activePathRibbonIds && !isRelated;
            const isDominant = layout.dominantRibbonIds.has(ribbon.id);
            return (
              <path
                key={ribbon.id}
                d={ribbon.d}
                fill={isRelated || (!activePathRibbonIds && isDominant) ? "var(--primary-bg)" : "var(--app-muted)"}
                fillOpacity={isRelated ? 0.56 : isDimmed ? 0.05 : isDominant ? 0.26 : 0.12}
                aria-hidden="true"
                className="pointer-events-none transition-[fill,fill-opacity] duration-150 motion-reduce:transition-none"
              />
            );
          })}
          {layout.nodes.map((node) => {
            const isRelated = activePathNodeIds?.has(node.id);
            const isDimmed = activePathNodeIds && !isRelated;
            const isDominant = layout.dominantNodeIds.has(node.id);
            const isAccented = isRelated || (!activePathNodeIds && isDominant);
            const contentHeight = (node.labelLines.length - 1) * PREFERENCE_FLOW_LABEL_LINE_HEIGHT + 25;
            const labelStartY = node.top + (node.height - contentHeight) / 2 + 9;
            const countY = labelStartY + (node.labelLines.length - 1) * PREFERENCE_FLOW_LABEL_LINE_HEIGHT + 13;
            return (
              <g
                key={node.id}
                data-preference-flow-node={node.id}
                role="img"
                aria-label={tLabel(`${node.label}：${node.value} 条；聚焦查看关联路径`)}
                tabIndex={0}
                onMouseEnter={() => setActiveNodeId(node.id)}
                onMouseLeave={() => setActiveNodeId(null)}
                onFocus={() => setActiveNodeId(node.id)}
                onBlur={() => setActiveNodeId(null)}
                opacity={isDimmed ? 0.42 : 1}
                className="cursor-default outline-none transition-opacity duration-150 motion-reduce:transition-none"
              >
                <title>{<UiText id="admin.m70e1d384f7e5" values={{v0: String(node.label), v1: String(node.value)}} />}</title>
                <rect
                  x={node.x}
                  y={node.top}
                  width="164"
                  height={node.height}
                  rx="10"
                  fill={isAccented ? "color-mix(in srgb, var(--primary-bg) 12%, var(--panel-3))" : "var(--panel-3)"}
                  stroke={isAccented ? "color-mix(in srgb, var(--primary-bg) 58%, var(--border-2))" : "var(--border-2)"}
                  strokeWidth={isRelated ? 2 : isDominant ? 1.5 : 1}
                  className="transition-[fill,stroke,stroke-width] duration-150 motion-reduce:transition-none"
                />
                <text x={node.x + 82} y={labelStartY} textAnchor="middle" fill="var(--app-fg)" fontSize="11" fontWeight="600">
                  {node.labelLines.map((line, index) => (
                    <tspan key={`${node.id}:label:${index}`} x={node.x + 82} dy={index === 0 ? 0 : PREFERENCE_FLOW_LABEL_LINE_HEIGHT}>{line}</tspan>
                  ))}
                </text>
                <text x={node.x + 82} y={countY} textAnchor="middle" fill={isAccented ? "var(--app-fg)" : "var(--app-muted)"} fontSize="9">
                  {node.value}<UiText id="admin.m6fb2840d568a" /></text>
              </g>
            );
          })}
        </svg></UiProps>
      </div>
      <div className="mt-2 text-[10px] text-[var(--app-muted)]"><UiText id="admin.m355f6d41444a" /></div>
    </div>
  );
}

const MODEL_SUCCESS_RATE_PERIODS = [
  { key: "today", label: "今天" },
  { key: "last3Days", label: "近 3 天" },
  { key: "last7Days", label: "近 7 天" },
] as const;

function ModelSuccessRateAnalysis({ periods, activePeriodKey, onShowWeek }: {
  periods: ModelFailurePeriod[];
  activePeriodKey: ModelFailurePeriod["key"];
  onShowWeek: () => void;
}) {
  const { label: tLabel } = useUiLocale();
  const { locale: uiLocale } = useUiLocale();
  const [showAll, setShowAll] = React.useState(false);
  React.useEffect(() => setShowAll(false), [activePeriodKey]);
  const activePeriod = periods.find((period) => period.key === activePeriodKey);
  const completedCount = Math.max(0, Number(activePeriod?.completedCount) || 0);
  const failedCount = Math.min(completedCount, Math.max(0, Number(activePeriod?.failedCount) || 0));
  const successCount = completedCount - failedCount;
  const successRate = completedCount ? Number(((successCount / completedCount) * 100).toFixed(1)) : null;
  const modelRows = (activePeriod?.models || []).map((model) => {
    const completed = Math.max(0, Number(model.completedCount) || 0);
    const failed = Math.min(completed, Math.max(0, Number(model.failedCount) || 0));
    return { ...model, completed, successful: completed - failed, successRate: completed ? Number((((completed - failed) / completed) * 100).toFixed(1)) : null };
  });

  return (
    <UiProps ids={{"aria-label":["admin.m968ef79135ad"]}}><section className={`${styles.panel} ${styles.modelRatePanel}`} aria-label="admin.m968ef79135ad">
      <div className={styles.panelTitle}><h3><UiText id="admin.m968ef79135ad" /></h3><Activity aria-hidden="true" /></div>
      {successRate === null ? (
        <div className={styles.empty}>
          <div className={styles.rateValue}>—</div>
          <strong><UiText id="admin.m446e265b2df5" /></strong>
          <p><UiText id="admin.m1bc3822bed35" /></p>
          {activePeriodKey !== "last7Days" ? <button type="button" className={styles.textButton} onClick={onShowWeek}><UiText id="admin.m9a941b2ff159" /></button> : null}
        </div>
      ) : (
        <>
          <div className={styles.rateSummary}>
            <div>
              <UiProps ids={{"aria-label":["admin.me42aa181f662"]}}><div className={styles.rateValue} aria-label="admin.me42aa181f662">{successRate}<small>%</small></div></UiProps>
              <div className={styles.rateCaption}>{successCount.toLocaleString(uiLocale === "en" ? "en-US" : undefined)} / {completedCount.toLocaleString(uiLocale === "en" ? "en-US" : undefined)}<UiText id="admin.m2a49a988bcc2" /></div>
            </div>
            <span className={failedCount ? styles.failure : styles.subtle}>{failedCount ? <UiText id="admin.mec3557573ff5" values={{v0: String(failedCount.toLocaleString(uiLocale === "en" ? "en-US" : undefined))}} /> : <UiText id="admin.m680c13606298" />}</span>
          </div>
          <UiProps ids={{"label":["admin.m2bc185dc9270"]}}><AdminActivityTable label="admin.m2bc185dc9270"
            columns={[{ key: "model", label: tLabel("模型") }, { key: "count", label: tLabel("成功 / 完成"), numeric: true }, { key: "rate", label: tLabel("成功率"), numeric: true }]}
            rows={(showAll ? modelRows : modelRows.slice(0, 5)).map(model => ({ key: model.model, cells: {
              model: { value: model.model },
              count: { value: model.successful, display: `${model.successful.toLocaleString(uiLocale === "en" ? "en-US" : undefined)} / ${model.completed.toLocaleString(uiLocale === "en" ? "en-US" : undefined)}` },
              rate: { value: model.successRate ?? -1, display: model.successRate === null ? "—" : `${model.successRate}%`, share: model.successRate === null ? undefined : model.successRate / 100, color: "#0090ff" },
            }}))}
          /></UiProps>
          {modelRows.length > 5 ? <div className={styles.modelMore}><button type="button" className={styles.textButton} aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>{showAll ? <UiText id="admin.m6f281e1d8380" /> : <UiText id="admin.m78d995182f13" values={{v0: String(modelRows.length)}} />}</button></div> : null}
          <div className={styles.rateCaption}><UiText id="admin.m3079a48727fa" />{modelRows.length}<UiText id="admin.m5ad00154b569" /></div>
        </>
      )}
    </section></UiProps>
  );
}

const LOG_TREND_CATEGORIES = [
  { key: "user_action", label: "用户行为", description: "上传、下载、删除、反馈", color: "var(--app-muted)" },
  { key: "generation", label: "生成任务", description: "任务创建、成功、失败", color: "#0090ff" },
  { key: "api", label: "API 调用", description: "模型与外部服务请求", color: "rgba(155, 145, 197, 0.9)" },
  { key: "warning", label: "警告", description: "需要关注但未必失败", color: "rgba(245, 158, 11, 0.9)" },
  { key: "error", label: "错误", description: "调用或任务执行失败", color: "rgba(244, 63, 94, 0.9)" },
] as const;

function logDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function buildLogTrendDates(days: number) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (days - 1 - index));
    return { key: logDateKey(date), label: `${date.getMonth() + 1}/${date.getDate()}` };
  });
}

function LogTrendAnalysis({ dailyByCategory, periodDays }: {
  dailyByCategory: Record<string, Record<string, number>>;
  periodDays: number;
}) {
  const { locale: uiLocale } = useUiLocale();
  const [longRange, setLongRange] = React.useState(false);
  const days = longRange ? 30 : periodDays;
  React.useEffect(() => setLongRange(false), [periodDays]);
  const dates = React.useMemo(() => buildLogTrendDates(days), [days]);
  const points = React.useMemo(() => dates.map(date => ({
    label: date.key,
    values: Object.fromEntries(LOG_TREND_CATEGORIES.map(category => [category.key, Math.max(0, Number(dailyByCategory[category.key]?.[date.key] || 0))])),
  })), [dailyByCategory, dates]);
  const hasData = points.some(point => Object.values(point.values).some(value => value > 0));
  // Warning/error levels overlap business categories, so they must not be added to a log total.
  const generationCount = points.reduce((sum, point) => sum + point.values.generation, 0);
  const periodLabel = days === 1 ? "今天" : `近 ${days} 天`;

  return (
    <UiProps ids={{"aria-label":["admin.m82d256c851de"]}}><section className={styles.panel} aria-label="admin.m82d256c851de">
      <div className={styles.panelTitle}>
        <h3><UiText id="admin.m82d256c851de" /></h3>
        <UiProps ids={{"title":["admin.mca5035ecd6ff"]}}><button type="button" className={styles.rangeButton} aria-pressed={longRange} title="admin.mca5035ecd6ff" onClick={() => setLongRange((value) => !value)}><UiText id="admin.mf729bb3d3f7e" /></button></UiProps>
      </div>
      <div className={styles.chartHeader}>
        <div className={styles.chartNumber}>{generationCount.toLocaleString(uiLocale === "en" ? "en-US" : undefined)}<small><UiText id="admin.m7a03b5cad505" /></small></div>
        <span className={styles.chartCaption}>{periodLabel}<UiText id="admin.m005889003487" /></span>
      </div>
      {hasData ? <UiProps ids={{"title":["admin.m82d256c851de"]}}><AdminActivityChart embedded height={330} title="admin.m82d256c851de" points={points} series={[...LOG_TREND_CATEGORIES]}
        initialType="line" chartTypes={["line", "dot"]} showTotal={false} allowCumulative={false}
      /></UiProps> : <div className={styles.empty}><strong>{periodLabel}<UiText id="admin.m3de679b09843" /></strong><p><UiText id="admin.mb99d7b0f8cd5" /></p></div>}
      <details className={styles.chartHelp}><summary><UiText id="admin.md69f98217f82" /></summary><p><UiText id="admin.md536c93dcb69" /></p><p><UiText id="admin.mf3d357584f60" /></p></details>
    </section></UiProps>
  );
}

function CompactEmptyGroup() {
  return (
    <UiProps ids={{"title":["admin.mf548fb852acb"]}}><AnalyticsCard title="admin.mf548fb852acb" subtitle="当前账号暂无 Agent 会话、运行、模型或用途数据">
      <div className="flex min-h-[108px] items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel-2)]/25 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m21aa5faeb014" /></div>
    </AnalyticsCard></UiProps>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-[var(--panel-2)]/45 px-2 py-1.5">
      <div className="text-[10px] text-[var(--app-muted)]">{label}</div>
      <div className="mt-0.5 truncate text-[12px] font-semibold text-[var(--app-fg)] tabular-nums">{value}</div>
    </div>
  );
}

function formatBytes(n: number) {
  const value = Math.max(0, Number(n) || 0);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function shortDateTime(value?: string | null) {
  if (!value) return "--";
  return fmtTime(value);
}

type BarItem = { label: string; value: number; color?: string };
type DonutItem = { label: string; value: number; color: string };
type SparkPoint = { label: string; value: number };

type RecentActivity = {
  id: number;
  category: string;
  action: string;
  message: string;
  createdAt: string;
};

type UserAnalysisPanelProps = {
  account?: {
    requestedUserId: string;
    authUserId?: number | null;
    username?: string | null;
    registeredAt?: string | null;
    updatedAt?: string | null;
    linkedUserIds?: string[];
    deviceCount: number;
    firstGenerationAt?: string | null;
    lastGenerationAt?: string | null;
    lastFinishedAt?: string | null;
    activeDays: number;
    totalGenerationRecords: number;
    generatedRecords: number;
    importRecords: number;
    logRecords: number;
    feedbackRecords: number;
    privateLibraryItems: number;
    privateLibraryBytes: number;
    billingRecords: number;
    billingAmount: number;
    agentConversations: number;
    agentMessages: number;
    agentRuns: number;
    agentInputTokens: number;
    agentOutputTokens: number;
    agentAvgLatencyMs: number;
    activeMemories: number;
    totalMemories: number;
  };
  overview: {
    totalRecordCount: number;
    totalSuccessCount: number;
    totalFailedCount: number;
    uploads: number;
    outputs: number;
    successRate: number;
    totalFailureRate: number;
    recent14Total: number;
  };
  statusItems: DonutItem[];
  typeItems: BarItem[];
  last14: { points: SparkPoint[] };
  sourceItems: BarItem[];
  modelFailurePeriods?: ModelFailurePeriod[];
  billingTrendPeriods?: BillingTrendPeriod[] | null;
  onViewBill?: (range: BillingDateRange) => void;
  preferenceFlows?: PreferenceFlowRecord[];
  logDailyByCategory: Record<string, Record<string, number>>;
  agentConversationStatusItems: BarItem[];
  agentRunStatusItems: BarItem[];
  agentRunModelItems: BarItem[];
  agentRunPurposeItems: BarItem[];
  recentActivities: RecentActivity[];
  files: { totalReferenced: number; totalBytes: number };
  storage?: AdminUserStorageSummary;
  presetTotalCount: number;
  presetDeletedCount: number;
  detailsLoading?: boolean;
  detailsError?: boolean;
};

type AnalysisOverviewProps = Pick<UserAnalysisPanelProps, "account" | "overview" | "files" | "storage" | "presetTotalCount" | "presetDeletedCount" | "detailsLoading" | "detailsError">;

function UserOverview({ account, overview, storage, detailsLoading, detailsError }: AnalysisOverviewProps) {
  const { locale: uiLocale } = useUiLocale();
  const detailState = detailsLoading ? "统计中" : detailsError ? "暂不可用" : null;
  const amount = Number(account?.billingAmount || 0);
  const [integer, fraction] = amount.toLocaleString(uiLocale === "en" ? "en-US" : "zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split(".");
  const storageState = detailState || (!storage ? "暂不可用" : null);
  const cumulativeSuccess = (account?.generatedRecords ?? overview.totalRecordCount) > 0 ? `${overview.successRate}%` : "—";

  return (
    <>
      <header className={styles.profile}>
        <div className={styles.identity}>
          <div className={styles.avatar} aria-hidden="true">{Array.from(account?.username || "用")[0]}</div>
          <div className={styles.identityText}>
            <div className={styles.name}><h2>{account?.username || <UiText id="admin.md8cfbd438a16" />}</h2><span>UID {account?.authUserId ?? "—"}</span></div>
            <div className={styles.metadata}><span><UiText id="admin.mad0f8e6d6024" />{account?.deviceCount ?? "—"}</span><span><UiText id="admin.mf4a4168453e5" />{detailState || account?.activeDays || 0}</span><span><UiText id="admin.m40de501de611" />{shortDateTime(account?.registeredAt).split(" ")[0]}</span></div>
          </div>
        </div>
        <div className={styles.lastActivity}><UiText id="admin.m7e993f5341cc" /><time>{shortDateTime(account?.lastGenerationAt).split(" ")[0]}</time></div>
      </header>
      <UiProps ids={{"aria-label":["admin.mc6127b1229ce"]}}><section className={styles.overview} aria-label="admin.mc6127b1229ce">
        <div className={styles.heading}><span className={styles.headingLabel}><ChartColumn className="h-4 w-4" aria-hidden="true" /><UiText id="admin.m3c5118f194e9" /></span><span><UiText id="admin.m0f03f347bf54" /></span></div>
        <div className={styles.metrics}>
          <div className={styles.metric}><span className={styles.metricLabel}><UiText id="admin.m264bc35f4689" /></span><strong className={styles.metricValue}>{account?.generatedRecords?.toLocaleString(uiLocale === "en" ? "en-US" : undefined) ?? "—"}</strong><span className={styles.metricHint}><UiText id="admin.m317ac850bbe8" />{(account?.totalGenerationRecords ?? overview.totalRecordCount).toLocaleString(uiLocale === "en" ? "en-US" : undefined)}</span></div>
          <div className={styles.metric}><span className={styles.metricLabel}><UiText id="admin.m7e543090addf" /></span><strong className={styles.metricValue}>{overview.outputs.toLocaleString(uiLocale === "en" ? "en-US" : undefined)}</strong><span className={styles.metricHint}><UiText id="admin.m0a46d98e6b6f" />{cumulativeSuccess}</span></div>
          <div className={styles.metric}><span className={styles.metricLabel}><UiText id="admin.mebeea1c433a1" /></span><strong className={styles.metricValue} title={detailState ? undefined : `¥${amount.toFixed(4)}`}>
            {detailState ? <span className={styles.pending}>{detailState}</span> : <><small>¥</small>{integer}<small>.{fraction}</small></>}
          </strong><span className={styles.metricHint}><UiText id="admin.m840a2eb75e5c" />{detailState || (account?.billingRecords ?? 0).toLocaleString(uiLocale === "en" ? "en-US" : undefined)}</span></div>
          <div className={styles.metric}><span className={styles.metricLabel}><UiText id="admin.mf2493a1e8528" /></span><strong className={styles.metricValue}>{storageState ? <span className={styles.pending}>{storageState}</span> : <>{formatBytes(storage!.totalBytes).split(" ")[0]} <small>{formatBytes(storage!.totalBytes).split(" ")[1]}</small></>}</strong><span className={styles.metricHint}>{storageState || <UiText id="admin.m73effe74414f" values={{v0: String(storage!.fileCount.toLocaleString(uiLocale === "en" ? "en-US" : undefined))}} />}</span></div>
        </div>
      </section></UiProps>
    </>
  );
}

function StorageComposition({ storage }: { storage: AdminUserStorageSummary }) {
  const { locale: uiLocale } = useUiLocale();
  const hover = useChartTooltip();
  const activeRef = React.useRef<string | null>(null);
  const [activeSource, setActiveSource] = React.useState<string | null>(null);
  const selectSource = (source: string | null) => {
    if (activeRef.current === source) return;
    activeRef.current = source;
    if (source === null) hover.reset();
    setActiveSource(source);
  };
  const sources = [
    { label: "生成结果", value: storage.generatedBytes, color: "#0090ff" },
    { label: "上传 / 导入", value: storage.uploadedBytes, color: CHART_COLORS[5] },
    { label: "私有素材库", value: storage.privateLibraryBytes, color: CHART_COLORS[1] },
  ];
  let offset = 0;
  const slices = sources.map((source) => {
    const percent = storage.totalBytes > 0 ? (source.value / storage.totalBytes) * 100 : 0;
    const slice = { ...source, percent, offset };
    offset += percent;
    return slice;
  });
  return (
    <>
      <div ref={hover.containerRef} className={styles.storageBody} onPointerLeave={() => selectSource(null)}>
        <div className={styles.ring}>
          <UiProps ids={{"aria-label":["admin.m52f55418ebfb"]}}><svg role="group" aria-label="admin.m52f55418ebfb" viewBox="0 0 108 108">
            <circle cx="54" cy="54" r="46" fill="none" stroke="var(--border)" strokeWidth="5" />
            {slices.filter(slice => slice.value > 0).map((slice) => <circle key={slice.label} cx="54" cy="54" r="46" fill="none" pathLength="100" stroke={slice.color} strokeDasharray={`${slice.percent} ${100 - slice.percent}`} strokeDashoffset={-slice.offset} strokeWidth={activeSource === slice.label ? 8 : 5}
              opacity={activeSource && activeSource !== slice.label ? .25 : 1} tabIndex={0} role="img" aria-label={`${slice.label} ${formatBytes(slice.value)} ${slice.percent.toFixed(1)}%`}
              onPointerEnter={event => { hover.move(event); selectSource(slice.label); }} onPointerMove={hover.move} onFocus={event => { if (event.currentTarget.matches(":focus-visible")) hover.place(.5); selectSource(slice.label); }} onBlur={() => selectSource(null)} onKeyDown={event => { if (event.key === "Escape") selectSource(null); }} />)}
          </svg></UiProps>
          <div className={styles.ringLabel}>{storage.fileCount.toLocaleString(uiLocale === "en" ? "en-US" : undefined)}<span><UiText id="admin.m2d4a2ac123bd" /></span></div>
        </div>
        <div className={styles.storageRows}>{sources.map((source) => <button type="button" key={source.label} className={styles.storageRow} data-active={activeSource === source.label}
          onPointerEnter={event => { hover.move(event); selectSource(source.label); }} onPointerMove={hover.move} onFocus={event => { if (event.currentTarget.matches(":focus-visible")) hover.place(.5); selectSource(source.label); }} onBlur={() => selectSource(null)} onClick={() => selectSource(source.label)} onKeyDown={event => { if (event.key === "Escape") selectSource(null); }}>
          <span className={styles.storageLabel}><i className={styles.swatch} style={{ background: source.color }} />{source.label}</span><span>{formatBytes(source.value)}</span></button>)}</div>
        {slices.filter(slice => slice.label === activeSource).map(slice => <div key="storage-tooltip" role="tooltip" className={activityStyles.tooltip} ref={hover.tooltipRef}>
          <div className={activityStyles.tooltipBody}><div className={activityStyles.tooltipRow}><i style={{ background: slice.color }} /><span>{slice.label}</span><b>{formatBytes(slice.value)}</b></div>
          <div className={activityStyles.tooltipTotal}><span><UiText id="admin.m595127f8f599" /></span><b>{slice.percent.toFixed(1)}%</b></div></div>
        </div>)}
      </div>
      <div className={styles.panelFooter}><span><UiText id="admin.medf069664abb" />{formatBytes(storage.averageFileBytes)}</span><span><UiText id="admin.mba5ce63b186c" />{formatBytes(storage.largestFileBytes)}</span><span className={storage.unverifiedFiles ? styles.failure : undefined}><UiText id="admin.me20bbfab5fee" />{storage.unverifiedFiles}<UiText id="admin.m7aaf96ad52e0" /></span></div>
    </>
  );
}

function UserResourceDetails({ account, overview, files, storage, presetTotalCount, presetDeletedCount, detailsLoading, detailsError, children }: AnalysisOverviewProps & { children?: React.ReactNode }) {
  const { label: uiLabel, locale: uiLocale } = useUiLocale();
  const detailState = detailsLoading ? "统计中" : detailsError ? "暂不可用" : null;
  const metrics = [
    { label: "上传素材", value: overview.uploads },
    { label: "导入记录", value: account?.importRecords ?? 0 },
    { label: "私有素材库", value: detailState || account?.privateLibraryItems || 0, hint: detailState || formatBytes(account?.privateLibraryBytes ?? 0) },
    { label: "日志记录", value: detailState || account?.logRecords || 0 },
    { label: "引用文件", value: files.totalReferenced, hint: formatBytes(files.totalBytes) },
    { label: "自定义预设", value: detailState || presetTotalCount, hint: detailState || `已删 ${presetDeletedCount}` },
  ];
  return (
    <div className={`${styles.detailsGrid} ${styles.billingDetailsGrid}`}>
      <UiProps ids={{"aria-label":["admin.m0ea2e3e87131"]}}><section className={styles.panel} aria-label="admin.m0ea2e3e87131">
        <div className={styles.panelTitle}><h3><UiText id="admin.m0ea2e3e87131" /></h3><span className={styles.subtle}><UiText id="admin.m73c599d62be6" />{detailState || (storage ? formatBytes(storage.totalBytes) : <UiText id="admin.mf36cac96220b" />)}</span></div>
        {detailState || !storage ? <div className={styles.empty}>{detailState || <UiText id="admin.mf36cac96220b" />}</div> : <StorageComposition storage={storage} />}
      </section></UiProps>
      {children}
      <UiProps ids={{"aria-label":["admin.mf1040ab3d760"]}}><section className={styles.panel} aria-label="admin.mf1040ab3d760">
        <div className={styles.panelTitle}><h3><UiText id="admin.mf1040ab3d760" /></h3><Database aria-hidden="true" /></div>
        <dl className={styles.auditGrid}>{metrics.map((metric) => <div key={metric.label}><dt>{uiLabel(metric.label)}</dt><dd>{typeof metric.value === "number" ? metric.value.toLocaleString(uiLocale === "en" ? "en-US" : undefined) : <span className={styles.pending}>{metric.value}</span>}</dd>{metric.hint ? <span className={styles.auditHint}>{uiLabel(metric.hint)}</span> : null}</div>)}</dl>
        <div className={styles.panelFooter}><span><UiText id="admin.mc5e44d9616e5" /></span><span><UiText id="admin.mcc622fc4aafd" />{shortDateTime(account?.registeredAt).split(" ")[0]}</span></div>
      </section></UiProps>
    </div>
  );
}

export default function UserAnalysisPanel({
  account,
  overview,
  modelFailurePeriods = [],
  billingTrendPeriods,
  onViewBill,
  preferenceFlows = [],
  logDailyByCategory,
  agentConversationStatusItems,
  agentRunStatusItems,
  agentRunModelItems,
  agentRunPurposeItems,
  recentActivities,
  files,
  storage,
  presetTotalCount,
  presetDeletedCount,
  detailsLoading = false,
  detailsError = false,
}: UserAnalysisPanelProps) {
  const [activePeriodKey, setActivePeriodKey] = React.useState<ModelFailurePeriod["key"]>("last7Days");
  const [recentActivitiesOpen, setRecentActivitiesOpen] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  React.useEffect(() => {
    setActivePeriodKey("last7Days");
    setRecentActivitiesOpen(false);
    setAdvancedOpen(false);
  }, [account?.requestedUserId]);

  const agentHasData = hasAny([agentConversationStatusItems, agentRunStatusItems, agentRunModelItems, agentRunPurposeItems]);
  const preferenceHasData = preferenceFlows.length > 0;
  const advancedHasData = preferenceHasData || agentHasData;

  return (
    <div className={`${styles.analysis} ${activityStyles.scope}`}>
      <UserOverview
        account={account}
        overview={overview}
        files={files}
        storage={storage}
        presetTotalCount={presetTotalCount}
        presetDeletedCount={presetDeletedCount}
        detailsLoading={detailsLoading}
        detailsError={detailsError}
      />

      <div className={styles.sectionHeading}>
        <div className={styles.sectionTitle}><h3><UiText id="admin.m4fe5bbf115fa" /></h3><span><UiText id="admin.m5f87a91efc1d" /></span></div>
        <UiProps ids={{"aria-label":["admin.md17dba605767"]}}><div className={styles.periods} role="group" aria-label="admin.md17dba605767">{MODEL_SUCCESS_RATE_PERIODS.map((period) => <button key={period.key} type="button" aria-pressed={period.key === activePeriodKey} onClick={() => setActivePeriodKey(period.key)}>{period.label}</button>)}</div></UiProps>
      </div>
      {detailsLoading ? (
        <div className={styles.notice} role="status"><LoaderCircle className="animate-spin" /><span><UiText id="admin.m2e7336f2807f" /></span></div>
      ) : detailsError ? (
        <div className={styles.notice} role="status"><AlertTriangle /><span><UiText id="admin.mcdd73a1bebb0" /></span></div>
      ) : (
        <div className={styles.trends}>
          <LogTrendAnalysis key={`logs-${account?.requestedUserId}`} dailyByCategory={logDailyByCategory} periodDays={activePeriodKey === "today" ? 1 : activePeriodKey === "last3Days" ? 3 : 7} />
          <ModelSuccessRateAnalysis key={`models-${account?.requestedUserId}`} periods={modelFailurePeriods} activePeriodKey={activePeriodKey} onShowWeek={() => setActivePeriodKey("last7Days")} />
        </div>
      )}
      <UserResourceDetails account={account} overview={overview} files={files} storage={storage} presetTotalCount={presetTotalCount} presetDeletedCount={presetDeletedCount} detailsLoading={detailsLoading} detailsError={detailsError}>
        <UserBillingTrend periods={billingTrendPeriods} periodKey={activePeriodKey} loading={detailsLoading} onViewBill={onViewBill} />
      </UserResourceDetails>
      {!detailsLoading && !detailsError ? (
        <>
          {recentActivities.length ? (
            <div className={styles.disclosure}>
              <button
                type="button"
                onClick={() => setRecentActivitiesOpen((v) => !v)}
                aria-expanded={recentActivitiesOpen}
                className={styles.disclosureButton}
              >
                <ChevronDown
                  className={[
                    "h-3.5 w-3.5 text-[var(--app-muted)] transition-transform group-hover:text-[var(--app-fg)]",
                    recentActivitiesOpen ? "rotate-0" : "-rotate-90",
                  ].join(" ")}
                />
                <span className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m20aedff56b19" /></span>
                <span className="rounded-md bg-[var(--panel-2)]/60 px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--app-muted)]">
                  {recentActivities.length}<UiText id="admin.m6fb2840d568a" /></span>
              </button>
              {recentActivitiesOpen ? (
                <div className={styles.activityList}>
                  {recentActivities.map((activity) => (
                    <div key={activity.id} className={styles.activity}>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[var(--app-fg)]">{activity.category} - {activity.action}</div>
                        <p>{activity.message}</p>
                      </div>
                      <time>{fmtTime(activity.createdAt)}</time>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {advancedHasData ? (
            <div className={styles.disclosure}>
              <button
                type="button"
                onClick={() => setAdvancedOpen((value) => !value)}
                aria-expanded={advancedOpen}
                className={styles.disclosureButton}
              >
                <ChevronDown className={["h-3.5 w-3.5 text-[var(--app-muted)] transition-transform", advancedOpen ? "rotate-0" : "-rotate-90"].join(" ")} />
                <span className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m4b23cfad86c2" /></span>
                <span className="text-[10.5px] text-[var(--app-muted)]"><UiText id="admin.m235239b89b81" /></span>
              </button>

              {advancedOpen ? (
                <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
                  {preferenceHasData ? (
                    <UiProps ids={{"title":["admin.m50bcef6b9e00"]}}><AnalyticsCard title="admin.m50bcef6b9e00" subtitle="模型、任务类型、宽高比与分辨率的组合偏好">
                      <GenerationPreferenceFlow flows={preferenceFlows} />
                    </AnalyticsCard></UiProps>
                  ) : null}

                  {agentHasData ? (
                    <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-4">
                      <UiProps ids={{"title":["admin.m6dfe5598523a"]}}><AnalyticsCard title="admin.m6dfe5598523a"><PercentStack items={agentConversationStatusItems} /></AnalyticsCard></UiProps>
                      <UiProps ids={{"title":["admin.mff0122e60cef"]}}><AnalyticsCard title="admin.mff0122e60cef"><PercentStack items={agentRunStatusItems} /></AnalyticsCard></UiProps>
                      <UiProps ids={{"title":["admin.m49c9d0604b61"]}}><AnalyticsCard title="admin.m49c9d0604b61"><ParetoBarChart items={agentRunModelItems} limit={4} /></AnalyticsCard></UiProps>
                      <UiProps ids={{"title":["admin.m2f52b6b59451"]}}><AnalyticsCard title="admin.m2f52b6b59451"><ParetoBarChart items={agentRunPurposeItems} limit={4} /></AnalyticsCard></UiProps>
                    </div>
                  ) : null}

                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ChartCard({ title, items }: { title: string; items: BarItem[] }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-2.5">
      <div className="text-[13px] font-semibold text-[var(--app-fg)] mb-2.5">{title}</div>
      <BarList items={items} />
    </div>
  );
}
