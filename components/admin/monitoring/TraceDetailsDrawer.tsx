"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Network, RefreshCw, X } from "lucide-react";

type TraceSpan = {
  service: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  status: number | null;
  attributes: Record<string, string | number | boolean>;
};

export function TraceDetailsDrawer({
  traceId,
  open,
  onClose,
}: {
  traceId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { error: uiError } = useUiLocale();
  const [spans, setSpans] = React.useState<TraceSpan[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !traceId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`/api/admin/monitoring/v1/traces/${encodeURIComponent(traceId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "Trace 查询失败");
        if (payload?.supported === false) throw new Error("本地轻量模式未接入 Trace 数据");
        setSpans(Array.isArray(payload?.spans) ? payload.spans : []);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Trace 查询失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, traceId]);

  if (!open || !traceId) return null;
  return (
    <UiProps ids={{"aria-label":["admin.m7831f46b1924"]}}><div className="fixed inset-0 !mt-0 z-[180] flex justify-end bg-black/35" role="dialog" aria-modal="true" aria-label="admin.m7831f46b1924">
      <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-[var(--border)] bg-[var(--sidebar-bg)] shadow-[var(--shadow)]">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--border)] bg-[var(--sidebar-bg)] p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--app-fg)]">
              <Network className="h-4 w-4 text-[var(--primary-bg)]" /><UiText id="admin.m31f78103bd6e" /></div>
            <div className="mt-1 break-all font-mono text-[10px] text-[var(--app-muted)]">{traceId}</div>
          </div>
          <UiProps ids={{"aria-label":["admin.m83f3c54a9bd7"]}}><button type="button" onClick={onClose} aria-label="admin.m83f3c54a9bd7" className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--app-muted)] hover:bg-[var(--panel-2)]">
            <X className="h-4 w-4" />
          </button></UiProps>
        </div>
        <div className="space-y-3 p-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[12px] text-[var(--app-muted)]">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" /><UiText id="admin.mef64f33cb06a" /></div>
          ) : error ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-[12px] text-amber-700">{uiError(error)}</div>
          ) : spans.length === 0 ? (
            <div className="py-16 text-center text-[12px] text-[var(--app-muted)]"><UiText id="admin.m22a7554136ea" /></div>
          ) : spans.map((span) => (
            <article key={span.spanId} className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 truncate text-[12px] font-semibold text-[var(--app-fg)]">{span.name}</div>
                <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-[10px] text-[var(--app-muted)]">{span.service}</span>
              </div>
              <div className="mt-2 grid gap-2 text-[10px] text-[var(--app-muted)] sm:grid-cols-2">
                <span>Span：{span.spanId || "—"}</span>
                <span><UiText id="admin.mae4ad85c1683" />{span.parentSpanId || <UiText id="admin.m0c8d2824b307" />}</span>
              </div>
              {Object.keys(span.attributes || {}).length ? (
                <pre className="mt-3 overflow-x-auto rounded-lg bg-[var(--input-bg)] p-3 text-[10px] leading-4 text-[var(--app-fg)]">
                  {JSON.stringify(span.attributes, null, 2)}
                </pre>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </div></UiProps>
  );
}
