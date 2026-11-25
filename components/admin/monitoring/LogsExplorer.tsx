"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Download, ListFilter, RefreshCw, Settings2 } from "lucide-react";
import { Virtuoso } from "react-virtuoso";

import { DateRangePicker } from "@/components/ui/date-range-picker";
import { FrostedSelect } from "@/components/ui/frosted-select";
import type { MonitoringCapabilities } from "@/lib/monitoring/contracts";

import { LogDetailsDrawer, type MonitoringLogEntry } from "./LogDetailsDrawer";
import { LogManagementDrawer } from "./LogManagementDrawer";
import { useRefreshFeedback } from "./useRefreshFeedback";

function ymd(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function rangeMilliseconds(from: string, to: string) {
  const fromMs = new Date(`${from}T00:00:00`).getTime();
  const toMs = new Date(`${to}T23:59:59.999`).getTime();
  return { fromMs, toMs };
}

export function LogsExplorer({
  capabilities,
}: {
  capabilities: MonitoringCapabilities | null;
}) {
  const { label: tLabel } = useUiLocale();
  const { error: uiError, locale: uiLocale } = useUiLocale();
  const [service, setService] = React.useState("web");
  const [level, setLevel] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [from, setFrom] = React.useState(ymd(-1));
  const [to, setTo] = React.useState(ymd());
  const [entries, setEntries] = React.useState<MonitoringLogEntry[]>([]);
  const [selected, setSelected] = React.useState<MonitoringLogEntry | null>(null);
  const [managementOpen, setManagementOpen] = React.useState(false);
  const [realtime, setRealtime] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [supported, setSupported] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const controllerRef = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const { fromMs, toMs } = rangeMilliseconds(from, to);
      const params = new URLSearchParams({
        service,
        limit: "500",
        direction: realtime ? "forward" : "backward",
        from: String(fromMs),
        to: String(toMs),
      });
      if (level !== "all") params.set("level", level);
      if (query.trim()) params.set("query", query.trim());
      const response = await fetch(`/api/admin/monitoring/v1/logs?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "日志查询失败");
      setSupported(payload?.supported !== false);
      setEntries(Array.isArray(payload?.entries) ? payload.entries : []);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "日志查询失败");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [from, level, query, realtime, service, to]);
  const { refreshing, runRefresh } = useRefreshFeedback(load);
  const refreshPending = loading || refreshing;

  React.useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  React.useEffect(() => {
    if (!realtime) return;
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [load, realtime]);

  const prepareExport = React.useCallback(async () => {
    setError(null);
    try {
      const { fromMs, toMs } = rangeMilliseconds(from, to);
      const response = await fetch("/api/admin/monitoring/v1/logs/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filter: { service, level: level === "all" ? undefined : level, query: query.trim() || undefined },
          from: fromMs,
          to: toMs,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "日志导出准备失败");
      window.location.assign(payload.downloadUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "日志导出准备失败");
    }
  }, [from, level, query, service, to]);

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-sm">
        <div className="border-b border-[var(--border)] p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m1e3e09fb7025" /></h2>
              <p className="mt-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.mf96932d8f626" /></p>
            </div>
            <div className="flex max-w-full flex-wrap items-center gap-2">
              <FrostedSelect
                value={service}
                onChange={setService}
                ariaLabel={tLabel("日志服务")}
                compact
                side="bottom"
                options={[
                  { value: "web", label: "Inkvia Web" },
                  { value: "generation-worker", label: "Generation Worker" },
                  { value: "media-worker", label: "Media Worker" },
                  { value: "live-video-prompt-worker", label: tLabel("Live 视频提示词 Worker") },
                  { value: "live-video-video-worker", label: tLabel("Live 视频生成 Worker") },
                  { value: "nginx", label: "Nginx" },
                  { value: "postgresql", label: "PostgreSQL" },
                  { value: "prometheus", label: "Prometheus" },
                  { value: "loki", label: "Loki" },
                  { value: "tempo", label: "Tempo" },
                  { value: "grafana", label: "Grafana" },
                  { value: "alloy", label: "Grafana Alloy" },
                  { value: "alertmanager", label: "Alertmanager" },
                  { value: "postgres-exporter", label: "PostgreSQL Exporter" },
                  { value: "ops", label: "Ops" },
                ]}
              />
              <FrostedSelect
                value={level}
                onChange={setLevel}
                ariaLabel={tLabel("日志级别")}
                compact
                side="bottom"
                options={[
                  { value: "all", label: tLabel("全部级别") },
                  { value: "error", label: tLabel("错误") },
                  { value: "warn", label: tLabel("警告") },
                  { value: "info", label: tLabel("信息") },
                  { value: "debug", label: tLabel("调试") },
                ]}
              />
              <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 md:flex-row">
            <label className="flex min-w-0 flex-1 items-center rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3">
              <ListFilter className="mr-2 h-4 w-4 shrink-0 text-[var(--app-muted)]" />
              <UiProps ids={{"placeholder":["admin.maa0fd15a8c6c"]}}><input
                value={query}
                onChange={(event) => setQuery(event.target.value.slice(0, 200))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void load();
                }}
                placeholder="admin.maa0fd15a8c6c"
                className="h-9 min-w-0 flex-1 bg-transparent text-[12px] text-[var(--app-fg)] outline-none placeholder:text-[var(--app-muted)]"
              /></UiProps>
            </label>
            <button type="button" onClick={() => void runRefresh()} disabled={refreshPending} aria-busy={refreshPending} className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[var(--primary-bg)] px-3 text-[11px] font-semibold text-[var(--primary-fg)] disabled:cursor-wait disabled:opacity-60">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshPending ? "animate-spin" : ""}`} />{refreshPending ? <UiText id="admin.md302f90b0996" /> : <UiText id="admin.mbcd6771e08ec" />}
            </button>
            <button type="button" onClick={() => setRealtime((value) => !value)} className={`flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-[11px] font-medium ${realtime ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" : "border-[var(--border)] text-[var(--app-muted)] hover:bg-[var(--panel-2)]"}`}>
              <span className={`h-2 w-2 rounded-full ${realtime ? "animate-pulse bg-emerald-500" : "bg-[var(--app-muted)]"}`} /><UiText id="admin.mfeb8d24a9137" /></button>
            <button type="button" onClick={() => void prepareExport()} disabled={!supported} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[11px] text-[var(--app-muted)] hover:bg-[var(--panel-2)] disabled:opacity-45">
              <Download className="h-3.5 w-3.5" /><UiText id="admin.m4673a2306165" /></button>
            <button type="button" onClick={() => setManagementOpen(true)} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[11px] text-[var(--app-muted)] hover:bg-[var(--panel-2)]">
              <Settings2 className="h-3.5 w-3.5" /><UiText id="admin.md1eb11c2ff07" /></button>
          </div>
        </div>

        {error ? <div className="border-b border-rose-500/20 bg-rose-500/10 px-4 py-2 text-[11px] text-rose-600">{uiError(error)}</div> : null}
        {!supported ? (
          <div className="flex h-[420px] items-center justify-center p-8 text-center text-[12px] text-[var(--app-muted)]"><UiText id="admin.m082f75f26c09" /></div>
        ) : (
          <Virtuoso
            style={{ height: 520 }}
            data={entries}
            followOutput={realtime ? "smooth" : false}
            computeItemKey={(index, entry) => `${entry.timestamp || "none"}-${index}`}
            components={{
              EmptyPlaceholder: () => (
                <div className="flex h-[420px] items-center justify-center text-[12px] text-[var(--app-muted)]"><UiText id="admin.m26af549cd717" /></div>
              ),
            }}
            itemContent={(_, entry) => (
              <button
                type="button"
                onClick={() => setSelected(entry)}
                className="grid w-full grid-cols-[110px_90px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] px-4 py-3 text-left text-[11px] transition hover:bg-[var(--panel-2)]"
              >
                <span className="font-mono text-[var(--app-muted)]">
                  {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString(uiLocale === "en" ? "en-US" : "zh-CN", { hour12: false }) : <UiText id="admin.m25b3cd0f059c" />}
                </span>
                <span className="truncate text-[var(--app-muted)]">{entry.labels.service || service}</span>
                <span className="truncate font-mono text-[var(--app-fg)]">{entry.line}</span>
              </button>
            )}
          />
        )}
      </section>
      <LogDetailsDrawer entry={selected} onClose={() => setSelected(null)} />
      <LogManagementDrawer open={managementOpen} capabilities={capabilities} onClose={() => setManagementOpen(false)} />
    </>
  );
}
