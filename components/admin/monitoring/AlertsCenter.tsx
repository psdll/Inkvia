"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { AlertTriangle, CheckCheck, Download, RefreshCw, ShieldOff, X } from "lucide-react";

import { FrostedSelect } from "@/components/ui/frosted-select";
import {
  buildIssueCard,
  type IssueEvidence,
  type MonitoringAlert,
} from "@/lib/monitoring/fault-guidance";

import { useRefreshFeedback } from "./useRefreshFeedback";

const STATE_LABELS: Record<MonitoringAlert["state"], string> = {
  firing: "正在告警",
  acknowledged: "已确认",
  silenced: "已静默",
  recovered: "已恢复",
};

const ALERT_ACTION_ENDPOINTS = {
  acknowledge: "/api/admin/monitoring/v1/alerts/acknowledge",
  silence: "/api/admin/monitoring/v1/alerts/silence",
} as const;

type ExternalAlertState = "healthy" | "unsupported" | "unavailable";

function formatDateTime(value?: string) {
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString("zh-CN", { hour12: false })
    : "—";
}

function formatDuration(startsAt?: string, recoveredAt?: string) {
  const start = new Date(String(startsAt || "")).getTime();
  const end = new Date(String(recoveredAt || "")).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";
  const minutes = Math.floor((end - start) / 60_000);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const remainingMinutes = minutes % 60;
  return [days ? `${days} 天` : "", hours ? `${hours} 小时` : "", `${remainingMinutes} 分钟`]
    .filter(Boolean)
    .join(" ");
}

function evidenceKind(alert: MonitoringAlert): IssueEvidence["kind"] {
  const source = `${alert.name} ${alert.component}`.toLowerCase();
  if (source.includes("cpu")) return "host.cpu";
  if (source.includes("memory")) return "host.memory";
  if (source.includes("disk")) return "host.disk";
  if (source.includes("postgres") || source.includes("connection")) return "postgres.connections";
  if (source.includes("worker") || source.includes("queue")) return "worker.queue";
  if (source.includes("prometheus") || source.includes("alloy") || source.includes("stale")) return "monitoring.stale";
  if (source.includes("web") || source.includes("http") || source.includes("5xx")) return "web.errors";
  return "unknown";
}

export function AlertsCenter() {
  const { label: tLabel } = useUiLocale();
  const [alerts, setAlerts] = React.useState<MonitoringAlert[]>([]);
  const [stateFilter, setStateFilter] = React.useState("active");
  const [silenceDuration, setSilenceDuration] = React.useState("60");
  const [supported, setSupported] = React.useState(true);
  const [externalState, setExternalState] = React.useState<ExternalAlertState>("unsupported");
  const [externalError, setExternalError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [hasLoaded, setHasLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/monitoring/v1/alerts", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "告警查询失败");
      if (!Array.isArray(payload?.alerts)) throw new Error("告警数据不完整，请重试");
      setSupported(payload?.supported !== false);
      setExternalState(
        payload?.externalState === "healthy" || payload?.externalState === "unavailable"
          ? payload.externalState
          : "unsupported",
      );
      setExternalError(typeof payload?.externalError === "string" ? payload.externalError : null);
      if (typeof payload?.projectError === "string") setError(`项目告警读取失败：${payload.projectError}`);
      if (typeof payload?.projectError !== "string") {
        setAlerts(payload.alerts);
        setHasLoaded(true);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "告警查询失败");
    } finally {
      setLoading(false);
    }
  }, []);
  const { refreshing, runRefresh } = useRefreshFeedback(load);
  const refreshPending = loading || refreshing;

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const act = React.useCallback(async (
    alert: MonitoringAlert,
    action: "acknowledge" | "silence",
  ) => {
    setBusy(`${action}:${alert.fingerprint}`);
    setActionError(null);
    try {
      const body = action === "acknowledge"
        ? { fingerprint: alert.fingerprint }
        : {
          fingerprint: alert.fingerprint,
          endsAt: new Date(Date.now() + Number(silenceDuration) * 60_000).toISOString(),
        };
      const response = await fetch(ALERT_ACTION_ENDPOINTS[action], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "告警操作失败");
      await load();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "告警操作失败");
    } finally {
      setBusy(null);
    }
  }, [load, silenceDuration]);

  const visibleAlerts = alerts.filter((alert) => {
    if (stateFilter === "all") return true;
    return alert.state === (stateFilter === "active" ? "firing" : stateFilter);
  });

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m1b92ed81c005" /></h2>
          <p className="mt-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m61d95dd3be68" /></p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FrostedSelect
            value={stateFilter}
            onChange={setStateFilter}
            ariaLabel={tLabel("告警状态")}
            compact
            side="bottom"
            options={[
              { value: "active", label: tLabel("待处理告警") },
              { value: "acknowledged", label: tLabel("已确认") },
              { value: "silenced", label: tLabel("已静默") },
              { value: "recovered", label: tLabel("已恢复") },
              { value: "all", label: tLabel("全部状态") },
            ]}
          />
          <FrostedSelect
            value={silenceDuration}
            onChange={setSilenceDuration}
            ariaLabel={tLabel("静默时长")}
            compact
            side="bottom"
            options={[
              { value: "15", label: tLabel("静默 15 分钟") },
              { value: "60", label: tLabel("静默 1 小时") },
              { value: "240", label: tLabel("静默 4 小时") },
              { value: "1440", label: tLabel("静默 24 小时") },
            ]}
          />
          <a href="/api/admin/monitoring/v1/reports/diagnostic" className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[10px] text-[var(--app-muted)] hover:bg-[var(--panel-2)]">
            <Download className="h-3.5 w-3.5" /><UiText id="admin.m63107c02991e" /></a>
          <button type="button" onClick={() => void runRefresh()} disabled={refreshPending} aria-busy={refreshPending} className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[10px] text-[var(--app-muted)] hover:bg-[var(--panel-2)] disabled:cursor-wait">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshPending ? "animate-spin" : ""}`} />{refreshPending ? <UiText id="admin.m7f3c8312816f" /> : <UiText id="admin.maee887434131" />}
          </button>
        </div>
      </div>

      {actionError || error ? (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[11px] text-rose-600 dark:text-rose-400">
          <span>{actionError ? <UiText id="admin.m72bbb455fa3e" values={{v0: String(actionError)}} /> : `${error}${hasLoaded ? "；以下保留上次读取的数据。" : "。请点击刷新重试。"}`}</span>
          <UiProps ids={{"aria-label":["admin.mee618f2d7968"]}}><button type="button" aria-label="admin.mee618f2d7968" onClick={() => { setActionError(null); setError(null); }} className="shrink-0 rounded p-0.5 hover:bg-rose-500/10">
            <X className="h-4 w-4" />
          </button></UiProps>
        </div>
      ) : null}
      {hasLoaded && externalState !== "healthy" ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-[11px] leading-5 text-amber-700">
          {externalState === "unavailable"
            ? <UiText id="admin.m3aa61e6dcfa8" values={{v0: String(externalError ? `：${externalError}` : "。")}} />
            : <UiText id="admin.mc71fd5f4b300" />}
        </div>
      ) : null}
      {!hasLoaded ? (
        <div role="status" aria-busy={loading} className="flex min-h-[360px] items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-8 text-center text-[13px] text-[var(--app-muted)]">
          {loading ? <UiText id="admin.m947cf95efb82" /> : <UiText id="admin.m11c90582fc3e" />}
        </div>
      ) : !supported ? (
        <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] p-8 text-center text-[12px] text-[var(--app-muted)]"><UiText id="admin.mc06c9a39c295" /></div>
      ) : visibleAlerts.length === 0 ? (
        <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-8 text-center">
          <div>
            <CheckCheck className={`mx-auto h-8 w-8 ${error ? "text-[var(--app-muted)]" : "text-emerald-500"}`} />
            <div className="mt-3 text-[13px] font-semibold text-[var(--app-fg)]">{error ? <UiText id="admin.me334f6569560" /> : stateFilter === "active" ? <UiText id="admin.m4f2ae77acd54" /> : stateFilter === "recovered" ? <UiText id="admin.m8df535506ca4" /> : stateFilter === "acknowledged" ? <UiText id="admin.me0ae3c3be232" /> : stateFilter === "silenced" ? <UiText id="admin.ma45001abbc53" /> : <UiText id="admin.m1e3167b08a1e" />}</div>
            <div className="mt-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.mf9b8c181d2c8" /></div>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {visibleAlerts.map((alert) => {
            const issue = buildIssueCard({
              kind: evidenceKind(alert),
              severity: alert.severity === "critical" ? "critical" : "warning",
              summary: alert.summary,
            });
            return (
              <article key={alert.fingerprint} className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className={`h-4 w-4 ${alert.severity === "critical" ? "text-rose-500" : "text-amber-500"}`} />
                      <h3 className="truncate text-[13px] font-semibold text-[var(--app-fg)]">{alert.summary}</h3>
                    </div>
                    <p className="mt-1 text-[10px] text-[var(--app-muted)]">
                      {alert.source === "project" ? <UiText id="admin.m30da6a392542" /> : "Alertmanager"} · {issue.domain} · {issue.component} · {STATE_LABELS[alert.state]}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium ${alert.state === "recovered" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600" : alert.severity === "critical" ? "border-rose-500/25 bg-rose-500/10 text-rose-600" : "border-amber-500/25 bg-amber-500/10 text-amber-600"}`}>
                    {STATE_LABELS[alert.state]}
                  </span>
                </div>
                <dl className="mt-3 grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[10px] sm:grid-cols-2">
                  <div>
                    <dt className="text-[var(--app-muted)]"><UiText id="admin.m79c2171b0c8f" /></dt>
                    <dd className="mt-1 font-medium text-[var(--app-fg)]">{formatDateTime(alert.startsAt)}</dd>
                  </div>
                  {alert.state === "recovered" ? (
                    <>
                      <div>
                        <dt className="text-[var(--app-muted)]"><UiText id="admin.m651adae16129" /></dt>
                        <dd className="mt-1 font-medium text-[var(--app-fg)]">{formatDateTime(alert.recoveredAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--app-muted)]"><UiText id="admin.mcc758c333732" /></dt>
                        <dd className="mt-1 font-medium text-[var(--app-fg)]">{formatDuration(alert.startsAt, alert.recoveredAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--app-muted)]"><UiText id="admin.m6e816385c93f" /></dt>
                        <dd className="mt-1 font-medium text-[var(--app-fg)]">{formatDateTime(alert.expiresAt)}</dd>
                      </div>
                    </>
                  ) : (
                    <div>
                      <dt className="text-[var(--app-muted)]"><UiText id="admin.m1c18c8c974f6" /></dt>
                      <dd className="mt-1 font-medium text-[var(--app-fg)]">{formatDateTime(alert.updatedAt)}</dd>
                    </div>
                  )}
                </dl>
                <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2">
                  <div className="rounded-lg bg-[var(--panel-2)] p-2.5">
                    <div className="text-[10px] text-[var(--app-muted)]"><UiText id="admin.me25e4bea5f8d" /></div>
                    <div className="mt-1 text-[var(--app-fg)]">{issue.impact}</div>
                  </div>
                  <div className="rounded-lg bg-[var(--panel-2)] p-2.5">
                    <div className="text-[10px] text-[var(--app-muted)]"><UiText id="admin.m04872a03af1d" /></div>
                    <div className="mt-1 text-[var(--app-fg)]">{issue.rootCauseCandidate}</div>
                  </div>
                </div>
                <ol className="mt-3 space-y-1 text-[10px] leading-4 text-[var(--app-muted)]">
                  {issue.guidance.map((step, index) => <li key={step}>{index + 1}. {step}</li>)}
                </ol>
                {alert.supportsAcknowledge || alert.supportsSilence ? (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
                    {alert.supportsAcknowledge ? (
                      <button type="button" disabled={Boolean(busy) || alert.state === "acknowledged"} onClick={() => void act(alert, "acknowledge")} className="flex h-8 items-center gap-1.5 rounded-lg bg-[var(--primary-bg)] px-3 text-[10px] font-semibold text-[var(--primary-fg)] disabled:opacity-45">
                        <CheckCheck className="h-3.5 w-3.5" /><UiText id="admin.meb5d77c6af03" /></button>
                    ) : null}
                    {alert.supportsSilence ? (
                      <button type="button" disabled={Boolean(busy) || alert.state === "silenced"} onClick={() => void act(alert, "silence")} className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[10px] text-[var(--app-muted)] hover:bg-[var(--panel-2)] disabled:opacity-45">
                        <ShieldOff className="h-3.5 w-3.5" /><UiText id="admin.mbf436f2fa459" /></button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
