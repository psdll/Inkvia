"use client";

import { UiText } from "@/i18n/ui";


import activityStyles from "../admin-activity.module.css";
import { AdminMonitoringLoading } from "@/components/admin/admin-loading";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import type {
  MonitoringCapabilities,
  MonitoringOverview,
  ServerEvent,
  ServiceStatus,
} from "@/lib/monitoring/contracts";
import {
  buildMetricQueryWindow,
  collapseMetricSeries,
  hostHealthFromMetrics,
  latestPercentMetric,
  type MetricRangeSelection,
} from "@/lib/monitoring/metric-health";

import { MonitoringSubnav, type MonitoringView } from "./MonitoringSubnav";
import { MonitoringLogsCenter } from "./MonitoringLogsCenter";
import { AlertsCenter } from "./AlertsCenter";
import { MonitoringOperationDialog } from "./MonitoringOperationDialog";
import { ReliabilityCenter } from "./ReliabilityCenter";
import { ResourceTrendGrid } from "./ResourceTrendGrid";
import { ServiceStatusGrid } from "./ServiceStatusGrid";
import { MonitoringStatusOverview } from "./MonitoringStatusOverview";
import type { MonitoringStatusIssue } from "@/lib/monitoring/overview-view-model";
import type { MetricQueryKey } from "@/lib/monitoring/prometheus-client";
import { ResourceDetailsDrawer } from "./ResourceDetailsDrawer";

export type AdminMonitoringPanelHandle = {
  refresh: () => Promise<void>;
};

type CapabilitiesPayload = {
  apiVersion: "v1";
  mode: "local-light" | "local-full" | "production";
  capabilities: MonitoringCapabilities;
};

const VIEWS = new Set<MonitoringView>(["overview", "services", "logs", "reliability", "alerts"]);
const RESOURCE_METRIC_KEYS = [
  "host.cpu.percent",
  "host.memory.percent",
  "host.disk.percent",
  "web.heap.percent",
] as const satisfies readonly MetricQueryKey[];
const BUSINESS_METRIC_KEYS = [
  "web.http.rate",
  "web.http.error.rate",
  "web.http.p95",
  "worker.queue.length",
  "worker.oldest.seconds",
] as const satisfies readonly MetricQueryKey[];
const METRIC_KEYS: readonly MetricQueryKey[] = [...RESOURCE_METRIC_KEYS, ...BUSINESS_METRIC_KEYS];
const CORE_REQUEST_TIMEOUT_MS = 10_000;
const INITIAL_OVERVIEW: MonitoringOverview = {
  apiVersion: "v1",
  mode: "local-light",
  state: "unavailable",
  collectedAt: "1970-01-01T00:00:00.000Z",
  freshness: {
    observedAt: "1970-01-01T00:00:00.000Z",
    checkedAt: "1970-01-01T00:00:00.000Z",
    ageMs: 0,
    staleAfterMs: 0,
    stale: true,
  },
  host: null,
  process: null,
  services: [],
  activeAlerts: 0,
  alertPersistenceError: null,
  warnings: [],
};

function localDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

async function fetchJson<T>(url: string, signal: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", signal });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `请求失败 (${response.status})`);
  return payload as T;
}

const AdminMonitoringPanel = React.forwardRef<AdminMonitoringPanelHandle>(function AdminMonitoringPanel(_, ref) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const [view, setView] = React.useState<MonitoringView>(
    VIEWS.has(requestedView as MonitoringView) ? requestedView as MonitoringView : "overview",
  );
  const [capabilities, setCapabilities] = React.useState<CapabilitiesPayload | null>(null);
  const [overview, setOverview] = React.useState<MonitoringOverview | null>(null);
  const [services, setServices] = React.useState<ServiceStatus[]>([]);
  const [series, setSeries] = React.useState<Record<string, Array<{ timestamp: number; value: number }>>>({});
  const [metricErrors, setMetricErrors] = React.useState<Partial<Record<MetricQueryKey, string>>>({});
  const [metricRange, setMetricRange] = React.useState<MetricRangeSelection>({
    preset: "1h",
    from: localDate(-1),
    to: localDate(),
  });
  const [error, setError] = React.useState<string | null>(null);
  const [serverEvents, setServerEvents] = React.useState<ServerEvent[]>([]);
  const [serverEventsError, setServerEventsError] = React.useState<string | null>(null);
  const [serverEventHistoryMessage, setServerEventHistoryMessage] = React.useState<string | null>(null);
  const [coreEvidenceAvailable, setCoreEvidenceAvailable] = React.useState(false);
  const [operationTarget, setOperationTarget] = React.useState<ServiceStatus | null>(null);
  const [resourceDetailsOpen, setResourceDetailsOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const controllerRef = React.useRef<AbortController | null>(null);
  const serverEventsControllerRef = React.useRef<AbortController | null>(null);
  const resourceTriggerRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (VIEWS.has(requestedView as MonitoringView)) setView(requestedView as MonitoringView);
  }, [requestedView]);

  const refreshServerEvents = React.useCallback(async (enabled: boolean) => {
    serverEventsControllerRef.current?.abort();
    serverEventsControllerRef.current = null;
    setServerEvents([]);
    setServerEventsError(null);
    setServerEventHistoryMessage(null);
    if (!enabled) return;
    const controller = new AbortController();
    serverEventsControllerRef.current = controller;
    const now = Date.now();
    const params = new URLSearchParams({
      from: String(now - 7 * 24 * 60 * 60 * 1_000),
      to: String(now),
      category: "all",
      severity: "all",
      state: "active",
      limit: "20",
    });
    try {
      const payload = await fetchJson<{
        supported: boolean;
        history: { state: "complete" | "partial"; reason: string };
        events: ServerEvent[];
      }>(
        `/api/admin/monitoring/v1/server-events?${params.toString()}`,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setServerEvents(Array.isArray(payload.events)
        ? payload.events.filter((event) => event.severity === "warning" || event.severity === "critical")
        : []);
      if (payload.history.state !== "complete") {
        setServerEventHistoryMessage(payload.history.reason === "single-boot"
          ? "服务器目前只有本次启动记录，无法核对上一次是否正常关机"
          : "服务器事件历史晚于所选时间，较早记录无法判断");
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setServerEvents([]);
        setServerEventsError(reason instanceof Error ? reason.message : "服务器事件暂时无法读取");
        setServerEventHistoryMessage(null);
      }
    } finally {
      if (serverEventsControllerRef.current === controller) {
        serverEventsControllerRef.current = null;
      }
    }
  }, []);

  const refresh = React.useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    let coreRequestTimedOut = false;
    const coreRequestTimeout = window.setTimeout(() => {
      coreRequestTimedOut = true;
      controller.abort();
    }, CORE_REQUEST_TIMEOUT_MS);
    try {
      const [nextCapabilities, nextOverview, nextServices] = await Promise.all([
        fetchJson<CapabilitiesPayload>("/api/admin/monitoring/v1/capabilities", controller.signal),
        fetchJson<MonitoringOverview>("/api/admin/monitoring/v1/overview", controller.signal),
        fetchJson<{ services: ServiceStatus[] }>("/api/admin/monitoring/v1/services", controller.signal),
      ]);
      window.clearTimeout(coreRequestTimeout);
      setCapabilities(nextCapabilities);
      setOverview(nextOverview);
      setServices(nextServices.services);
      setCoreEvidenceAvailable(true);
      void refreshServerEvents(nextCapabilities.capabilities.serverEvents);

      if (nextCapabilities.capabilities.metricsHistory) {
        const window = buildMetricQueryWindow(metricRange);
        const results = await Promise.allSettled(METRIC_KEYS.map(async (key) => {
          const searchParams = new URLSearchParams({ key });
          searchParams.set("from", String(window.startSeconds));
          searchParams.set("to", String(window.endSeconds));
          searchParams.set("step", String(window.stepSeconds));
          const payload = await fetchJson<{
            series: Array<{ points: Array<{ timestamp: number; value: number }> }>;
          }>(`/api/admin/monitoring/v1/metrics?${searchParams.toString()}`, controller.signal);
          return [key, collapseMetricSeries(payload.series)] as const;
        }));
        if (controller.signal.aborted) return;
        const nextMetricErrors: Partial<Record<MetricQueryKey, string>> = {};
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            const key = METRIC_KEYS[index];
            nextMetricErrors[key] = result.reason instanceof Error
              ? result.reason.message
              : "监控指标读取失败";
          }
        });
        setSeries((previous) => Object.fromEntries(results.map((result, index) => {
          const key = METRIC_KEYS[index];
          if (result.status === "fulfilled") return result.value;
          return [key, previous[key] || []] as const;
        })));
        setMetricErrors(nextMetricErrors);
        if (Object.keys(nextMetricErrors).length > 0) {
          setError("部分监控指标暂时无法刷新，已保留上次成功数据并标记异常");
        } else {
          setError(null);
        }
      } else {
        setSeries({});
        setMetricErrors({});
        setError(null);
      }
    } catch (reason) {
      if (coreRequestTimedOut || !controller.signal.aborted) {
        setCoreEvidenceAvailable(false);
        setServices([]);
        serverEventsControllerRef.current?.abort();
        setServerEvents([]);
        setServerEventsError(null);
        setServerEventHistoryMessage(null);
        setError(coreRequestTimedOut
          ? "监控核心数据请求超时"
          : reason instanceof Error ? reason.message : "监控数据加载失败");
      }
    } finally {
      window.clearTimeout(coreRequestTimeout);
      if (coreRequestTimedOut || !controller.signal.aborted) setLoading(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [metricRange, refreshServerEvents]);

  React.useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    return () => {
      window.clearInterval(timer);
      controllerRef.current?.abort();
      serverEventsControllerRef.current?.abort();
    };
  }, [refresh]);

  const selectView = React.useCallback((nextView: MonitoringView) => {
    setView(nextView);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "monitoring");
    params.set("view", nextView);
    router.replace(`/admin?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const navigateFromOverview = React.useCallback((target: MonitoringStatusIssue["target"]) => {
    if (target === "resources") {
      setResourceDetailsOpen(true);
      return;
    }
    if (target === "services") {
      selectView("services");
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "monitoring");
    params.set("view", "logs");
    params.set("logs", target === "server-events" ? "server" : "project");
    setView("logs");
    router.replace(`/admin?${params.toString()}`, { scroll: false });
  }, [router, searchParams, selectView]);

  const initialLoading = loading && !overview;
  const displayOverview = overview || INITIAL_OVERVIEW;
  const checkedAt = overview ? Date.parse(overview.freshness.checkedAt) : 0;
  const serviceEvidenceAvailable = coreEvidenceAvailable && !overview?.freshness.stale;
  const effectiveServices = serviceEvidenceAvailable ? services : [];
  const resourceMetricFailed = (["host.cpu.percent", "host.memory.percent"] as const)
    .some((key) => Boolean(metricErrors[key]));
  const hostState = !coreEvidenceAvailable || resourceMetricFailed
    ? "stale"
    : overview
    ? hostHealthFromMetrics(
      overview.host?.state || "unavailable",
      Boolean(capabilities?.capabilities.metricsHistory),
      {
        cpu: latestPercentMetric(series["host.cpu.percent"] || [], checkedAt),
        memory: latestPercentMetric(series["host.memory.percent"] || [], checkedAt),
        disk: latestPercentMetric(
          overview.host?.disk.usedPercent === null || overview.host?.disk.usedPercent === undefined
            ? []
            : [{
              timestamp: Date.parse(overview.host.disk.observedAt),
              value: overview.host.disk.usedPercent,
            }],
          checkedAt,
        ),
      },
    )
    : "unavailable";

  if (initialLoading && view === "overview") return <AdminMonitoringLoading />;

  return (
    <div className={`w-full space-y-5 pb-8 ${activityStyles.scope} ${activityStyles.monitoringSurface}`}>
      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] font-semibold tracking-tight text-[var(--app-fg)]"><UiText id="admin.m1332cdd2f6be" /></h1>
          </div>
          <p className="mt-1 text-[12px] text-[var(--app-muted)]"><UiText id="admin.mf839715635e2" /></p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[var(--app-muted)]">
          <span className="rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-1">
            {!capabilities ? <UiText id="admin.mc60ccdec1427" /> : capabilities.mode === "production" ? <UiText id="admin.ma3a3d4fa89e0" /> : capabilities.mode === "local-full" ? <UiText id="admin.medbb5ddd0331" /> : <UiText id="admin.mbf351539f533" />}
          </span>
          <span>
            {overview?.freshness.observedAt
              ? <UiText id="admin.mb854a2861a14" values={{v0: String(new Date(overview.freshness.observedAt).toLocaleTimeString("zh-CN", { hour12: false }))}} />
              : <UiText id="admin.mbee4c96edd24" />}
          </span>
        </div>
      </div>

      <MonitoringSubnav active={view} onSelect={selectView} alertCount={overview?.activeAlerts || 0} />

      {view !== "overview" && error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-[12px] text-rose-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold"><UiText id="admin.m25adf369abac" /></div>
            <div className="mt-0.5 opacity-90">{error}<UiText id="admin.mbc364384d3bb" /></div>
          </div>
        </div>
      ) : null}

      {view !== "overview" && overview?.freshness.stale ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-[12px] text-amber-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold"><UiText id="admin.m42520bf0622e" /></div>
            <div className="mt-0.5"><UiText id="admin.me98e2774ef74" /></div>
          </div>
        </div>
      ) : null}

      {view === "overview" && !initialLoading && (!overview || !capabilities) ? (
        <section className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-5 text-amber-700" aria-live="polite">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h2 className="text-[14px] font-semibold"><UiText id="admin.m18504c87163c" /></h2>
              <p className="mt-1 text-[12px] leading-5"><UiText id="admin.m26579bdf8426" /></p>
              {error ? <p className="mt-2 text-[11px] opacity-85">{error}</p> : null}
              <button type="button" onClick={() => void refresh()} className="mt-3 rounded-lg border border-current/25 px-3 py-1.5 text-[11px] font-semibold outline-none hover:bg-[var(--panel-bg)]/40 focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"><UiText id="admin.mdf7392cc96be" /></button>
            </div>
          </div>
        </section>
      ) : null}

      {view === "overview" && (initialLoading || (overview && capabilities)) ? (
        <div className="space-y-5">
          <MonitoringStatusOverview
            mode={capabilities?.mode || displayOverview.mode}
            services={effectiveServices}
            hostState={hostState}
            serverEvents={serverEvents}
            coreError={!initialLoading && (!coreEvidenceAvailable || displayOverview.freshness.stale) ? error || "监控数据已过期" : null}
            serverEventsError={serverEventsError}
            serverEventsHistoryMessage={serverEventHistoryMessage}
            disk={displayOverview.host?.disk}
            onNavigate={navigateFromOverview}
            resourceTriggerRef={resourceTriggerRef}
            pending={initialLoading}
            activeAlertCount={serviceEvidenceAvailable ? displayOverview.activeAlerts : 0}
            onOpenAlerts={() => selectView("alerts")}
          />
          <ResourceTrendGrid
            overview={displayOverview}
            historySupported={Boolean(capabilities?.capabilities.metricsHistory)}
            series={series}
            metricErrors={metricErrors}
            checkedAt={checkedAt}
            evidenceAvailable={!initialLoading && coreEvidenceAvailable && !displayOverview.freshness.stale}
            range={metricRange}
            onRangeChange={setMetricRange}
            pending={initialLoading}
          />
        </div>
      ) : null}

      {overview && capabilities ? (
        <ResourceDetailsDrawer
          open={resourceDetailsOpen}
          triggerRef={resourceTriggerRef}
          hostState={hostState}
          mode={capabilities.mode}
          overview={overview}
          historySupported={Boolean(capabilities.capabilities.metricsHistory)}
          series={series}
          metricErrors={metricErrors}
          checkedAt={checkedAt}
          evidenceAvailable={coreEvidenceAvailable && !overview.freshness.stale}
          range={metricRange}
          onRangeChange={setMetricRange}
          onRefresh={refresh}
          onClose={() => setResourceDetailsOpen(false)}
        />
      ) : null}

      {view === "services" ? (
        <ServiceStatusGrid
          services={services}
          operationsEnabled={Boolean(capabilities?.capabilities.serviceControl)}
          onOperate={setOperationTarget}
        />
      ) : null}
      {view === "logs" ? (
        <MonitoringLogsCenter
          capabilities={capabilities?.capabilities || null}
          initialView={searchParams.get("logs") === "server" ? "server" : "project"}
        />
      ) : null}
      {view === "reliability" ? (
        <ReliabilityCenter />
      ) : null}
      {view === "alerts" ? (
        <AlertsCenter />
      ) : null}
      <MonitoringOperationDialog
        target={operationTarget}
        onClose={() => setOperationTarget(null)}
        onCompleted={() => {
          void refresh();
        }}
      />
    </div>
  );
});

export default AdminMonitoringPanel;

export function AdminMonitoringPanelEntry({ panelRef, ...props }: { panelRef: React.Ref<AdminMonitoringPanelHandle> }) {
  return <AdminMonitoringPanel {...props} ref={panelRef} />;
}
