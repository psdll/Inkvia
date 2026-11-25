import { readChineseUiSource } from "./helpers/chinese-ui-source";
import path from "node:path";

import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readChineseUiSource(path.join(process.cwd(), relativePath), "utf8");
}

const COMPONENTS = [
  "components/admin/monitoring/AdminMonitoringPanel.tsx",
  "components/admin/monitoring/MonitoringSubnav.tsx",
  "components/admin/monitoring/MonitoringStatusOverview.tsx",
  "components/admin/monitoring/ResourceMetricCard.tsx",
  "components/admin/monitoring/ResourceTrendGrid.tsx",
  "components/admin/monitoring/BusinessImpactGrid.tsx",
  "components/admin/monitoring/ResourceDetailsDrawer.tsx",
  "components/admin/monitoring/ServiceStatusGrid.tsx",
  "components/admin/monitoring/ServiceStatusCard.tsx",
  "components/admin/monitoring/MonitoringEmptyState.tsx",
];

describe("administrator monitoring overview UI", () => {
  it("puts operating conclusions and required actions before technical details", () => {
    const panel = read(COMPONENTS[0]);
    const all = COMPONENTS.map(read).join("\n");

    expect(panel).toContain("/api/admin/monitoring/v1/capabilities");
    expect(panel).toContain("/api/admin/monitoring/v1/overview");
    expect(panel).toContain("/api/admin/monitoring/v1/services");
    expect(panel).toContain("/api/admin/monitoring/v1/server-events");
    expect(panel).toContain("<MonitoringStatusOverview");
    expect(all).toContain("当前状态");
    expect(all).toContain("需要处理");
    expect(all).toContain("服务器资源");
    expect(all).toContain("管理后台进程正在运行");
    expect(all).toContain("未开启检测");
    expect(panel).not.toContain("<MonitoringCoverage");
    expect(panel).not.toContain('title="技术服务详情"');
    expect(panel).not.toContain("<BusinessHealthGrid");
    expect(all).not.toContain("页面每 15 秒自动刷新");
    expect(panel).not.toContain("SystemHealthRail");
    expect(panel).toContain('view !== "overview" && error');
    expect(panel).toContain('view !== "overview" && overview?.freshness.stale');
  });

  it("reuses shared filters and avoids native selects or local dark palettes", () => {
    const all = COMPONENTS.map(read).join("\n");

    expect(all).toContain("FrostedSelect");
    expect(all).toContain("DateRangePicker");
    expect(all).not.toMatch(/<select[\s>]/);
    expect(all).not.toContain("dark:bg-[#");
    expect(all).not.toContain("bg-zinc-");
    expect(all).not.toContain("bg-slate-");
  });

  it("uses explicit unsupported and empty states instead of fabricated history", () => {
    const all = COMPONENTS.map(read).join("\n");

    expect(all).toContain("本地轻量模式");
    expect(all).toContain("当前未检测到需要处理的问题");
    expect(all).toContain("暂时无法判断");
    expect(all).toContain("不能显示为正常");
  });

  it("invalidates stale service evidence and explains an initial core-data failure", () => {
    const panel = read("components/admin/monitoring/AdminMonitoringPanel.tsx");

    expect(panel).toContain("setCoreEvidenceAvailable(false)");
    expect(panel).toContain("setServices([])");
    expect(panel).toContain("effectiveServices");
    expect(panel).toContain("CORE_REQUEST_TIMEOUT_MS");
    expect(panel).toContain("coreRequestTimedOut");
    expect(panel).toContain("controllerRef.current === controller");
    expect(panel).toContain("serverEventsControllerRef.current === controller");
    expect(panel).toContain("serverEventHistoryMessage");
    expect(panel).toContain('payload.history.state !== "complete"');
    expect(panel).toContain("serverEventsHistoryMessage={serverEventHistoryMessage}");
    expect(panel).toContain("监控核心数据请求超时");
    expect(panel).toContain('view === "overview" && !initialLoading && (!overview || !capabilities)');
    expect(panel).toContain("监控数据读取失败");
    expect(panel).toContain("当前无法判断");
  });

  it("mounts the full monitoring overview before the first request settles", () => {
    const panel = read("components/admin/monitoring/AdminMonitoringPanel.tsx");
    const status = read("components/admin/monitoring/MonitoringStatusOverview.tsx");
    const resources = read("components/admin/monitoring/ResourceTrendGrid.tsx");

    expect(panel).not.toContain("if (loading && !overview)");
    expect(panel).toContain("const initialLoading = loading && !overview");
    expect(panel).toContain("pending={initialLoading}");
    expect(status).toContain("pending?: boolean");
    expect(status).toContain("正在读取当前资源状态");
    expect(resources).toContain("pending?: boolean");
    expect(resources).toContain("pending || Boolean(disk)");
  });

  it("uses plain-language resource names, impacts, and distinct data gaps", () => {
    const resources = read("components/admin/monitoring/ResourceTrendGrid.tsx");
    const card = read("components/admin/monitoring/ResourceMetricCard.tsx");

    expect(resources).toContain("服务器忙碌程度");
    expect(resources).toContain("服务器内存");
    expect(resources).toContain("overview.host?.disk");
    expect(resources).toContain("showDisk");
    expect(resources).toContain("上传磁盘空间");
    expect(resources).toContain("warningThreshold={70}");
    expect(resources).toContain("criticalThreshold={85}");
    expect(resources).toContain("当前磁盘读数有效，但告警记录保存失败");
    expect(resources).toContain("Web 堆内存");
    expect(resources).toContain("持续偏高会让页面和任务变慢");
    expect(resources).toContain("达到 85% 后大文件上传会被阻止");
    expect(resources).toContain("暂未采集到数据");
    expect(resources).toContain("数据已过期");
    expect(resources).toContain("采集值异常");
    expect(resources).toContain("当前有读数，历史趋势样本不足");
    expect(card).toContain('aria-label={tLabel(`了解${label}`)}');
    expect(card).toContain("aria-expanded={helpOpen}");
    expect(card).toContain("setHelpOpen");
    expect(card).toContain("role=\"note\"");
    expect(card).toContain('helpOpen || activeSample !== null ? "z-30" : "z-0"');
    expect(card).toContain("absolute right-3 top-12 z-30");
    expect(card).toContain("bg-[color-mix(in_srgb,var(--panel-bg)_96%,transparent)]");
    expect(card).not.toContain('role="note" className="mt-2');
    expect(card).toContain('unavailable: "bg-[var(--app-muted)]"');
    expect(card).toContain("未配置历史指标");
  });

  it("renders resource trends using the shared scale and separate sample segments", () => {
    const card = read("components/admin/monitoring/ResourceMetricCard.tsx");

    expect(card).toContain("buildResourceTrend(trend, trendStepMs)");
    expect(card).toContain("<path d={path}");
    expect(card).toContain('strokeLinecap="round"');
    expect(card).toContain('strokeLinejoin="round"');
  });

  it("uses validated metric samples and does not hard-code full-mode disk as unsupported", () => {
    const panel = read("components/admin/monitoring/AdminMonitoringPanel.tsx");
    const resources = read("components/admin/monitoring/ResourceTrendGrid.tsx");

    expect(panel).toContain("Promise.allSettled");
    expect(panel).toContain("collapseMetricSeries");
    expect(panel).toContain("hostHealthFromMetrics");
    expect(panel).toContain("buildMetricQueryWindow");
    expect(panel).toContain("searchParams.set");
    expect(resources).toContain("latestPercentMetric");
    expect(resources).toContain('series["host.disk.percent"]');
    expect(resources).toContain('state={pending ? "unavailable" : diskState}');
    expect(resources).toContain("cpuTrend.length > 1");
    expect(resources).toContain("memoryTrend.length > 1");
    expect(resources).toContain("diskTrend.length > 1");
    expect(resources).toContain("heapTrend.length > 1");
    expect(resources).not.toContain('state="unsupported"');
  });

  it("uses Prometheus V8 heap pressure with truthful fallback semantics", () => {
    const panel = read("components/admin/monitoring/AdminMonitoringPanel.tsx");
    const resources = read("components/admin/monitoring/ResourceTrendGrid.tsx");
    const card = read("components/admin/monitoring/ResourceMetricCard.tsx");

    expect(panel).toContain('"web.heap.percent"');
    expect(resources).toContain('series["web.heap.percent"]');
    expect(resources).toContain("overview.process.heapLimitBytes");
    expect(resources).toContain("percentMetricState(heapReading, 70, 85)");
    expect(resources).toContain("warningThreshold={70}");
    expect(resources).toContain("criticalThreshold={85}");
    expect(resources).toContain("historySupported={historySupported && !heapError && heapTrend.length > 1}");
    expect(resources).not.toContain("heapUsedBytes / overview.process.heapTotalBytes");
    expect(card).toContain("warningThreshold = 85");
    expect(card).toContain("criticalThreshold = 95");
  });

  it("opens a resource drawer and queries the existing impact signals without a scroll fallback", () => {
    const panel = read("components/admin/monitoring/AdminMonitoringPanel.tsx");
    const status = read("components/admin/monitoring/MonitoringStatusOverview.tsx");
    const resources = read("components/admin/monitoring/ResourceTrendGrid.tsx");
    const drawer = read("components/admin/monitoring/ResourceDetailsDrawer.tsx");
    const impact = read("components/admin/monitoring/BusinessImpactGrid.tsx");

    expect(panel).toContain("<ResourceDetailsDrawer");
    expect(panel).toContain("setResourceDetailsOpen(true)");
    expect(panel).toContain("resourceTriggerRef");
    expect(status).toContain("resourceTriggerRef");
    expect(panel).not.toContain('document.getElementById("server-resources")');
    expect(panel).not.toContain("scrollIntoView");

    for (const key of [
      "web.http.rate",
      "web.http.error.rate",
      "web.http.p95",
      "worker.queue.length",
      "worker.oldest.seconds",
    ]) {
      expect(panel).toContain(`"${key}"`);
    }

    expect(panel).toContain("setMetricErrors");
    expect(panel).toContain("previous[key] || []");
    expect(resources).toContain("metricErrors");
    expect(drawer).toContain('role="dialog"');
    expect(drawer).toContain("fixed inset-0 !mt-0");
    expect(drawer).toContain("bg-[color-mix(in_srgb,var(--panel-bg)_94%,transparent)]");
    expect(drawer).toContain("backdrop-blur-xl");
    expect(drawer).toContain("useRefreshFeedback");
    expect(drawer).toContain('aria-busy={refreshing}');
    expect(impact).toContain("用户体验与任务处理");
  });
});
