"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";

import { DateRangePicker } from "@/components/ui/date-range-picker";
import { FrostedSelect } from "@/components/ui/frosted-select";
import type { MonitoringOverview } from "@/lib/monitoring/contracts";
import {
  buildMetricQueryWindow,
  latestPercentMetric,
  percentMetricState,
  type MetricRangeSelection,
  type PercentMetricReading,
} from "@/lib/monitoring/metric-health";
import type { MetricQueryKey } from "@/lib/monitoring/prometheus-client";

import { ResourceMetricCard } from "./ResourceMetricCard";

type MetricSeries = Record<string, Array<{ timestamp: number; value: number }>>;

function metricDetail(source: string, reading: PercentMetricReading, error?: string) {
  if (error) return `${source} · 读取失败，显示上次成功数据：${error}`;
  if (reading.reason === "missing") return `${source} · 暂未采集到数据`;
  if (reading.reason === "future") return `${source} · 采集值异常，请检查服务器时钟同步`;
  if (reading.reason === "out-of-range") return `${source} · 采集值异常，返回值超出 0–100%`;
  if (reading.freshness === "stale") {
    return `${source} · 数据已过期 ${Math.ceil((reading.ageMs || 0) / 1_000)} 秒`;
  }
  return `${source} · 最新采样`;
}

function metricEmptyLabel(reading: PercentMetricReading, historySupported: boolean, error?: string) {
  if (error) return "读取失败";
  if (!historySupported) return "未配置历史指标";
  if (reading.reason === "stale" || reading.freshness === "stale") return "数据已过期";
  if (reading.reason === "future" || reading.reason === "out-of-range") return "采集值异常";
  return "暂未采集到数据";
}

function trendEmptyLabel(
  reading: PercentMetricReading,
  historySupported: boolean,
  points: Array<{ timestamp: number; value: number }>,
  error?: string,
) {
  if (error) return metricEmptyLabel(reading, historySupported, error);
  if (historySupported && reading.value !== null && points.length <= 1) {
    return "当前有读数，历史趋势样本不足";
  }
  return metricEmptyLabel(reading, historySupported, error);
}

function stateLabel(state: ReturnType<typeof percentMetricState>) {
  if (state === "healthy") return "当前充足";
  if (state === "warning") return "接近上限";
  if (state === "critical") return "严重不足";
  if (state === "stale") return "数据已过期";
  if (state === "unsupported") return "未配置";
  return "暂时无法判断";
}

function formatBytes(value: number) {
  const mib = Math.max(0, value) / 1024 ** 2;
  return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GB` : `${mib.toFixed(0)} MB`;
}

export function ResourceTrendGrid({
  headingId = "server-resources",
  overview,
  historySupported,
  series,
  metricErrors = {},
  checkedAt,
  evidenceAvailable,
  range,
  onRangeChange,
  pending = false,
}: {
  headingId?: string;
  overview: MonitoringOverview;
  historySupported: boolean;
  series: MetricSeries;
  metricErrors?: Partial<Record<MetricQueryKey, string>>;
  checkedAt: number;
  evidenceAvailable: boolean;
  range: MetricRangeSelection;
  onRangeChange: (range: MetricRangeSelection) => void;
  pending?: boolean;
}) {
  const { label: tLabel } = useUiLocale();
  const { locale: uiLocale } = useUiLocale();
  const memory = overview.host?.memory.usedPercent ?? 0;
  const load = overview.host
    ? (overview.host.loadAverage[0] / Math.max(1, overview.host.logicalCores)) * 100
    : 0;
  const localHeapPercent = overview.process?.heapLimitBytes
    ? (overview.process.heapUsedBytes / overview.process.heapLimitBytes) * 100
    : 0;
  const cpuReading = latestPercentMetric(series["host.cpu.percent"] || [], checkedAt);
  const memoryReading = latestPercentMetric(series["host.memory.percent"] || [], checkedAt);
  const disk = overview.host?.disk;
  const heapReading = latestPercentMetric(
    historySupported
      ? series["web.heap.percent"] || []
      : overview.process?.heapLimitBytes
        ? [{ timestamp: Date.parse(overview.collectedAt), value: localHeapPercent }]
        : [],
    checkedAt,
  );
  const cpuError = metricErrors["host.cpu.percent"];
  const memoryError = metricErrors["host.memory.percent"];
  const diskError = metricErrors["host.disk.percent"];
  const heapError = metricErrors["web.heap.percent"];
  const cpuState = cpuError || !evidenceAvailable
    ? "stale"
    : historySupported
    ? percentMetricState(cpuReading)
    : overview.host
      ? load >= 200 ? "critical" : load >= 100 ? "warning" : "healthy"
      : "unavailable";
  const memoryState = memoryError || !evidenceAvailable
    ? "stale"
    : historySupported
    ? percentMetricState(memoryReading)
    : overview.host ? percentMetricState(latestPercentMetric([{
      timestamp: Date.parse(overview.collectedAt),
      value: memory,
    }], checkedAt)) : "unavailable";
  const heapState = heapError || !evidenceAvailable ? "stale" : percentMetricState(heapReading, 70, 85);
  const trendStepMs = React.useMemo(() => {
    try { return buildMetricQueryWindow(range, checkedAt).stepSeconds * 1_000; }
    catch { return 60_000; }
  }, [range, checkedAt]);
  const cpuTrend = series["host.cpu.percent"] || [];
  const memoryTrend = series["host.memory.percent"] || [];
  const diskTrend = series["host.disk.percent"] || [];
  const heapTrend = series["web.heap.percent"] || [];
  const showCpu = pending || historySupported || Boolean(overview.host);
  const showMemory = pending || historySupported || Boolean(overview.host);
  const showDisk = pending || Boolean(disk) || historySupported;
  const showHeap = pending || historySupported || Boolean(overview.process);
  const diskState = !evidenceAvailable ? "stale" : disk?.state || "unavailable";
  const current = (state: string) => ["healthy", "warning", "critical"].includes(state);

  if (!showCpu && !showMemory && !showDisk && !showHeap) {
    return (
      <section aria-labelledby={headingId}>
        <h2 id={headingId} className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m8c7b5e9fc29b" /></h2>
        <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
          <p className="text-[12px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m4a199eb06b28" /></p>
          <p className="mt-1 text-[11px] leading-5 text-[var(--app-muted)]"><UiText id="admin.m83415deb1446" /></p>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId}>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id={headingId} className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m8c7b5e9fc29b" /></h2>
          <p className="mt-1 text-[12px] text-[var(--app-muted)]"><UiText id="admin.mbb3953345737" /></p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <FrostedSelect
            value={range.preset}
            onChange={(preset) => onRangeChange({
              ...range,
              preset: preset as MetricRangeSelection["preset"],
            })}
            ariaLabel={tLabel("监控时间范围")}
            compact
            side="bottom"
            options={[
              { value: "1h", label: tLabel("最近 1 小时") },
              { value: "6h", label: tLabel("最近 6 小时") },
              { value: "24h", label: tLabel("最近 24 小时") },
              { value: "custom", label: tLabel("自定义") },
            ]}
          />
          {range.preset === "custom" ? (
            <DateRangePicker
              from={range.from}
              to={range.to}
              onFromChange={(from) => onRangeChange({ ...range, from })}
              onToChange={(to) => onRangeChange({ ...range, to })}
            />
          ) : null}
        </div>
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" }}>
        {showCpu ? <UiProps ids={{"label":["admin.m1c82e5547854","admin.m663a4f8164a1"]}}><ResourceMetricCard
          label={historySupported ? "admin.m1c82e5547854" : "admin.m663a4f8164a1"}
          value={pending ? "—" : historySupported
            ? cpuReading.value === null || cpuReading.freshness === "unavailable" ? "—" : cpuReading.value.toFixed(1)
            : overview.host ? load.toFixed(1) : "—"}
          unit={pending ? undefined : historySupported ? cpuReading.value === null || cpuReading.freshness === "unavailable" ? undefined : "%" : overview.host ? "%" : undefined}
          detail={pending ? "正在读取当前数据…" : historySupported
            ? metricDetail("Prometheus CPU 使用率", cpuReading, cpuError)
            : overview.host
              ? `${overview.host.logicalCores} 个逻辑核心 · 1 分钟负载折算（不等同 CPU 使用率）`
              : "无法读取服务器信息"}
          summary={!pending && current(cpuState) ? (historySupported
            ? cpuState === "healthy" ? "算力充足 · 当前负载较低" : "计算压力偏高，请留意任务响应"
            : `${overview.host?.logicalCores} 个逻辑核心 · 1 分钟负载折算`) : undefined}
          footer={historySupported ? undefined : "负载折算不等同于 CPU 使用率"}
          warningThreshold={historySupported ? 85 : 100}
          criticalThreshold={historySupported ? 95 : 200}
          statusLabel={pending ? "读取中" : stateLabel(cpuState)}
          impact="持续偏高会让页面和任务变慢。"
          helpText="反映整台服务器当前的计算压力。持续高于阈值时，页面响应和后台任务都会受到影响。"
          emptyLabel={pending ? "历史趋势读取中" : trendEmptyLabel(cpuReading, historySupported, cpuTrend, cpuError)}
          state={pending ? "unavailable" : cpuState}
          progress={historySupported && cpuReading.freshness !== "unavailable" && cpuReading.value !== null
            ? cpuReading.value
            : undefined}
          trendStepMs={trendStepMs}
          trend={cpuTrend}
          historySupported={historySupported && !cpuError && cpuTrend.length > 1}
        /></UiProps> : null}
        {showMemory ? <UiProps ids={{"label":["admin.m4e0311f576de"]}}><ResourceMetricCard
          label="admin.m4e0311f576de"
          value={pending ? "—" : historySupported
            ? memoryReading.value === null || memoryReading.freshness === "unavailable" ? "—" : memoryReading.value.toFixed(1)
            : overview.host ? memory.toFixed(1) : "—"}
          unit={pending ? undefined : historySupported ? memoryReading.value === null || memoryReading.freshness === "unavailable" ? undefined : "%" : overview.host ? "%" : undefined}
          detail={pending ? "正在读取当前数据…" : historySupported
            ? metricDetail("Prometheus 内存使用率", memoryReading, memoryError)
            : overview.host
              ? `${overview.host.memory.availableBytes !== undefined ? "占用约" : "已用"} ${(overview.host.memory.usedBytes / 1024 ** 3).toFixed(1)} GB / ${(overview.host.memory.totalBytes / 1024 ** 3).toFixed(1)} GB`
              : "无法读取服务器信息"}
          summary={!pending && current(memoryState) ? (historySupported && memoryReading.value !== null
            ? `剩余 ${(100 - memoryReading.value).toFixed(1)}% 可用内存`
            : overview.host ? overview.host.memory.availableBytes !== undefined
              ? `可用约 ${formatBytes(overview.host.memory.availableBytes)}（含文件缓存）`
              : `已用 ${formatBytes(overview.host.memory.usedBytes)} / ${formatBytes(overview.host.memory.totalBytes)}` : undefined) : undefined}
          statusLabel={pending ? "读取中" : stateLabel(memoryState)}
          impact="接近上限时，系统可能终止进程并导致任务失败。"
          helpText={!historySupported && overview.host?.memory.availableBytes !== undefined
            ? "macOS 内存占用估算：总内存减去空闲内存与可回收文件缓存，不等同于系统内存压力或 Web 服务自身的内存。"
            : "整台服务器已经使用的物理内存比例，不等同于 Web 服务自身的内存。"}
          emptyLabel={pending ? "历史趋势读取中" : trendEmptyLabel(memoryReading, historySupported, memoryTrend, memoryError)}
          state={pending ? "unavailable" : memoryState}
          progress={historySupported && memoryReading.freshness !== "unavailable" && memoryReading.value !== null
            ? memoryReading.value
            : overview.host ? memory : undefined}
          trendStepMs={trendStepMs}
          trend={memoryTrend}
          historySupported={historySupported && !memoryError && memoryTrend.length > 1}
        /></UiProps> : null}
        {showDisk ? <UiProps ids={{"label":["admin.mc5d87b4d3c92"]}}><ResourceMetricCard
          label="admin.mc5d87b4d3c92"
          value={pending || !disk || disk.usedPercent === null ? "—" : disk.usedPercent.toFixed(1)}
          unit={pending || !disk || disk.usedPercent === null ? undefined : "%"}
          detail={pending || !disk ? "正在读取当前数据…" : disk.state === "unavailable"
            ? `检测失败${disk.lastSuccessfulAt
              ? ` · 上次成功 ${new Date(disk.lastSuccessfulAt).toLocaleString(uiLocale === "en" ? "en-US" : "zh-CN", { hour12: false })}`
              : " · 暂无成功检测记录"}`
            : `已用 ${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}`}
          summary={!pending && current(diskState) && disk && disk.usedBytes !== null && disk.totalBytes !== null ? `已用 ${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}` : undefined}
          footer="大文件上传保护阈值 85%"
          statusLabel={pending ? "读取中" : stateLabel(diskState)}
          impact="达到 85% 后大文件上传会被阻止。"
          helpText="显示上传目录所在磁盘的实时占用比例；本地运行检测电脑磁盘，服务器部署检测服务器磁盘。"
          emptyLabel={pending ? "历史趋势读取中" : diskError
            ? "当前值可用，历史趋势读取失败"
            : historySupported ? "当前值可用，历史趋势暂无样本" : "未配置历史趋势"}
          state={pending ? "unavailable" : diskState}
          progress={pending || !disk || disk.usedPercent === null ? undefined : disk.usedPercent}
          trendStepMs={trendStepMs}
          trend={diskTrend}
          historySupported={historySupported && !diskError && diskTrend.length > 1}
          warningThreshold={70}
          criticalThreshold={85}
        /></UiProps> : null}
        {showHeap ? <UiProps ids={{"label":["admin.m54929a0eda21"]}}><ResourceMetricCard
          label="admin.m54929a0eda21"
          value={pending || heapReading.value === null || heapReading.freshness === "unavailable" ? "—" : heapReading.value.toFixed(1)}
          unit={pending || heapReading.value === null || heapReading.freshness === "unavailable" ? undefined : "%"}
          detail={pending ? "正在读取当前数据…" : heapError
            ? metricDetail("Prometheus Web V8 堆压力", heapReading, heapError)
            : overview.process && heapReading.freshness !== "unavailable"
              ? `堆 ${formatBytes(overview.process.heapUsedBytes)} / ${formatBytes(overview.process.heapLimitBytes)} · RSS ${formatBytes(overview.process.rssBytes)} · PID ${overview.process.pid} · 已运行 ${Math.floor(overview.process.uptimeSeconds / 60)} 分钟`
              : metricDetail("Prometheus Web V8 堆压力", heapReading)}
          summary={!pending && current(heapState) && overview.process
            ? `已用 ${formatBytes(overview.process.heapUsedBytes)} / ${formatBytes(overview.process.heapLimitBytes)}` : undefined}
          footer={!pending && evidenceAvailable && overview.process ? `进程驻留内存 RSS ${formatBytes(overview.process.rssBytes)}` : undefined}
          statusLabel={pending ? "读取中" : stateLabel(heapState)}
          impact="压力过高时，Web 页面和接口可能卡顿或重启。"
          helpText="只表示 Web 服务的 JavaScript 堆内存压力，不代表整台服务器内存。"
          emptyLabel={pending ? "历史趋势读取中" : trendEmptyLabel(heapReading, historySupported, heapTrend, heapError)}
          state={pending ? "unavailable" : heapState}
          progress={heapReading.freshness !== "unavailable" && heapReading.value !== null
            ? heapReading.value
            : undefined}
          trendStepMs={trendStepMs}
          trend={heapTrend}
          historySupported={historySupported && !heapError && heapTrend.length > 1}
          warningThreshold={70}
          criticalThreshold={85}
        /></UiProps> : null}
      </div>
      {historySupported ? <p className="mt-3 text-[11px] leading-5 text-[var(--app-muted)]"><UiText id="admin.m11513cf091bf" /></p> : null}
      {overview.alertPersistenceError ? (
        <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-[11px] leading-5 text-amber-700"><UiText id="admin.me2db0915f7e6" /></p>
      ) : null}
    </section>
  );
}
