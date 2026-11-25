"use client";

import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Info,
  RefreshCw,
  ServerCrash,
} from "lucide-react";

import { DateRangePicker } from "@/components/ui/date-range-picker";
import { FrostedSelect } from "@/components/ui/frosted-select";
import type { ServerEvent } from "@/lib/monitoring/contracts";
import type { ServerEventsPayload } from "@/lib/monitoring/server-events";

import { useRefreshFeedback } from "./useRefreshFeedback";

const DAY_MS = 24 * 60 * 60 * 1_000;

function ymd(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

function rangeMilliseconds(from: string, to: string) {
  const fromMs = new Date(`${from}T00:00:00`).getTime();
  const toMs = new Date(`${to}T23:59:59.999`).getTime();
  if (!from || !to || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    throw new Error("请选择有效的开始和结束日期");
  }
  if (toMs - fromMs > 30 * DAY_MS) {
    throw new Error("服务器事件一次最多查看 30 天，请缩短日期范围");
  }
  return { fromMs, toMs };
}

const CATEGORY_OPTIONS = [
  { value: "all", label: "全部事件" },
  { value: "power", label: "关机与重启" },
  { value: "memory", label: "内存不足" },
  { value: "filesystem", label: "磁盘与文件系统" },
  { value: "service", label: "项目服务" },
  { value: "kernel", label: "系统内核" },
];

const SEVERITY_OPTIONS = [
  { value: "all", label: "全部严重度" },
  { value: "critical", label: "严重" },
  { value: "warning", label: "需要关注" },
  { value: "info", label: "信息" },
];

const STATE_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "active", label: "尚未恢复" },
  { value: "recovered", label: "已经恢复" },
  { value: "historical", label: "历史记录" },
];

function severityPresentation(severity: ServerEvent["severity"]) {
  if (severity === "critical") {
    return { label: "严重", icon: AlertTriangle, className: "bg-rose-500/10 text-rose-600" };
  }
  if (severity === "warning") {
    return { label: "需要关注", icon: AlertTriangle, className: "bg-amber-500/10 text-amber-700" };
  }
  return { label: "信息", icon: Info, className: "bg-sky-500/10 text-sky-700" };
}

function statePresentation(state: ServerEvent["state"]) {
  if (state === "active") return { label: "尚未恢复", icon: AlertTriangle };
  if (state === "recovered") return { label: "已经恢复", icon: CheckCircle2 };
  return { label: "历史记录", icon: CircleHelp };
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function ServerEventsExplorer({ enabled }: { enabled: boolean }) {
  const { label: tLabel } = useUiLocale();
  const { error: uiError } = useUiLocale();
  const [from, setFrom] = React.useState(ymd(-6));
  const [to, setTo] = React.useState(ymd());
  const [category, setCategory] = React.useState("all");
  const [severity, setSeverity] = React.useState("all");
  const [state, setState] = React.useState("all");
  const [events, setEvents] = React.useState<ServerEvent[]>([]);
  const [supported, setSupported] = React.useState(enabled);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [observedAt, setObservedAt] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<ServerEventsPayload["history"] | null>(null);
  const controllerRef = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async () => {
    controllerRef.current?.abort();
    setEvents([]);
    setObservedAt(null);
    setHistory(null);
    setError(null);
    if (!enabled) {
      setSupported(false);
      setLoading(false);
      return;
    }
    if (!from || !to) {
      setLoading(false);
      return;
    }

    let range;
    try {
      range = rangeMilliseconds(from, to);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "日期范围无效");
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: String(range.fromMs),
        to: String(range.toMs),
        category,
        severity,
        state,
        limit: "100",
      });
      const response = await fetch(
        `/api/admin/monitoring/v1/server-events?${params.toString()}`,
        { cache: "no-store", signal: controller.signal },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "服务器事件暂时无法读取");
      setSupported(payload?.supported !== false);
      setEvents(Array.isArray(payload?.events) ? payload.events : []);
      setObservedAt(typeof payload?.observedAt === "string" ? payload.observedAt : null);
      setHistory(payload?.history || null);
    } catch (reason) {
      if (!controller.signal.aborted) {
        setEvents([]);
        setError(reason instanceof Error ? reason.message : "服务器事件暂时无法读取");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, [category, enabled, from, severity, state, to]);
  const { refreshing, runRefresh } = useRefreshFeedback(load);
  const refreshPending = loading || refreshing;

  React.useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-sm">
      <div className="border-b border-[var(--border)] p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ServerCrash className="h-4 w-4 text-[var(--primary-bg)]" />
              <h2 className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m80c3e79b6ea8" /></h2>
            </div>
            <p className="mt-1 text-[12px] leading-5 text-[var(--app-muted)]"><UiText id="admin.m505b65c59bc4" /></p>
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <FrostedSelect
              value={category}
              onChange={setCategory}
              options={CATEGORY_OPTIONS}
              ariaLabel={tLabel("服务器事件类型")}
              compact
              side="bottom"
            />
            <FrostedSelect
              value={severity}
              onChange={setSeverity}
              options={SEVERITY_OPTIONS}
              ariaLabel={tLabel("服务器事件严重度")}
              compact
              side="bottom"
            />
            <FrostedSelect
              value={state}
              onChange={setState}
              options={STATE_OPTIONS}
              ariaLabel={tLabel("服务器事件状态")}
              compact
              side="bottom"
            />
            <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
            <button
              type="button"
              onClick={() => void runRefresh()}
              disabled={refreshPending}
              aria-busy={refreshPending}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-[var(--primary-bg)] px-3 text-[12px] font-semibold text-[var(--primary-fg)] outline-none disabled:cursor-wait disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel-bg)]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshPending ? "animate-spin" : ""}`} />
              {refreshPending ? <UiText id="admin.md302f90b0996" /> : <UiText id="admin.mbcd6771e08ec" />}
            </button>
          </div>
        </div>
        {observedAt ? (
          <p className="mt-2 text-right text-[12px] text-[var(--app-muted)]"><UiText id="admin.mf75780be890e" />{formatDateTime(observedAt)}
          </p>
        ) : null}
      </div>

      {supported && !loading && !error && history?.state === "partial" ? (
        <div className="flex items-start gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-700" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold"><UiText id="admin.md609379f17f0" /></p>
            <p className="mt-0.5 leading-5">
              {history.reason === "single-boot"
                ? <UiText id="admin.m8d44e793ac8d" />
                : <UiText id="admin.md978ed451b6c" values={{v0: String(formatDateTime(history.availableFrom))}} />}
            </p>
          </div>
        </div>
      ) : null}

      {!supported ? (
        <div className="flex min-h-[320px] items-center justify-center p-8 text-center">
          <div className="max-w-lg">
            <CircleHelp className="mx-auto h-8 w-8 text-[var(--app-muted)]" />
            <h3 className="mt-3 text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mc5149be29129" /></h3>
            <p className="mt-1 text-[12px] leading-5 text-[var(--app-muted)]"><UiText id="admin.mb5664a3182ef" /></p>
          </div>
        </div>
      ) : error ? (
        <div className="flex min-h-[320px] items-center justify-center p-8 text-center" role="alert">
          <div className="max-w-lg">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" />
            <h3 className="mt-3 text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m2f75e6397a0a" /></h3>
            <p className="mt-1 text-[12px] leading-5 text-[var(--app-muted)]">{uiError(error)}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px] font-semibold text-[var(--app-fg)] outline-none hover:border-[var(--primary-bg)] focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
            ><UiText id="admin.mdf7392cc96be" /></button>
          </div>
        </div>
      ) : loading ? (
        <div className="flex min-h-[320px] items-center justify-center text-[12px] text-[var(--app-muted)]" aria-live="polite">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" /><UiText id="admin.mb23270c739c8" /></div>
      ) : events.length === 0 ? (
        <div className="flex min-h-[320px] items-center justify-center p-8 text-center">
          <div>
            {history?.state === "complete"
              ? <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
              : <CircleHelp className="mx-auto h-8 w-8 text-[var(--app-muted)]" />}
            <h3 className="mt-3 text-[14px] font-semibold text-[var(--app-fg)]">
              {history?.state === "complete" ? <UiText id="admin.m6d725beff204" /> : <UiText id="admin.m4a9caa7f4690" />}
            </h3>
            <p className="mt-1 text-[12px] text-[var(--app-muted)]">
              {history?.state === "complete"
                ? <UiText id="admin.m500259a793f7" />
                : <UiText id="admin.m43d0f99dac5e" />}
            </p>
          </div>
        </div>
      ) : (
        <ol className="relative divide-y divide-[var(--border)]">
          {events.map((event) => {
            const severityView = severityPresentation(event.severity);
            const SeverityIcon = severityView.icon;
            const stateView = statePresentation(event.state);
            const StateIcon = stateView.icon;
            return (
              <li key={event.id} className="relative grid gap-4 p-4 md:grid-cols-[168px_minmax(0,1fr)] md:p-5">
                <div className="text-[12px] text-[var(--app-muted)]">
                  <time dateTime={event.occurredAt} className="font-medium text-[var(--app-fg)]">
                    {formatDateTime(event.occurredAt)}
                  </time>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium ${severityView.className}`}>
                      <SeverityIcon className="h-3.5 w-3.5" />
                      {severityView.label}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--panel-2)] px-2 py-1 font-medium text-[var(--app-muted)]">
                      <StateIcon className="h-3.5 w-3.5" />
                      {stateView.label}
                    </span>
                  </div>
                </div>

                <article className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-[var(--app-fg)]">{event.title}</h3>
                  <p className="mt-1 text-[12px] leading-5 text-[var(--app-muted)]">{event.summary}</p>
                  <div className="mt-3 grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[12px] sm:grid-cols-2">
                    <div>
                      <span className="font-semibold text-[var(--app-fg)]"><UiText id="admin.m8a82deea73cb" /></span>
                      <span className="leading-5 text-[var(--app-muted)]">{event.impact}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-[var(--app-fg)]"><UiText id="admin.m28aeb41ee3ce" /></span>
                      <span className="leading-5 text-[var(--app-muted)]">
                        {event.state === "recovered"
                          ? event.recoveryObservedAt
                            ? <UiText id="admin.me4d4b831b8ce" values={{v0: String(formatDateTime(event.recoveryObservedAt))}} />
                            : <UiText id="admin.ma4eb65ce0507" />
                          : event.state === "active" ? <UiText id="admin.m960748de595c" /> : <UiText id="admin.m2f1af9925f82" />}
                      </span>
                    </div>
                  </div>
                  <details className="group mt-3 rounded-lg text-[12px] text-[var(--app-muted)]">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md py-1 font-medium text-[var(--primary-bg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]">
                      <ChevronRight className="h-3.5 w-3.5 transition group-open:rotate-90" /><UiText id="admin.m939487369519" /></summary>
                    <dl className="mt-2 space-y-2 border-l-2 border-[var(--border)] pl-3">
                      {event.affectedService ? (
                        <div>
                          <dt className="font-semibold text-[var(--app-fg)]"><UiText id="admin.m09f515acbc3e" /></dt>
                          <dd className="mt-0.5 break-words">{event.affectedService}</dd>
                        </div>
                      ) : null}
                      {event.evidence.map((evidence, index) => (
                        <div key={`${event.id}-${index}`}>
                          <dt className="font-semibold text-[var(--app-fg)]">{evidence.label}</dt>
                          <dd className="mt-0.5 break-words font-mono leading-5">{evidence.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
