"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Copy, Network, X } from "lucide-react";

import { TraceDetailsDrawer } from "./TraceDetailsDrawer";

export type MonitoringLogEntry = {
  timestamp: number | null;
  line: string;
  labels: Record<string, string>;
};

export function LogDetailsDrawer({
  entry,
  onClose,
}: {
  entry: MonitoringLogEntry | null;
  onClose: () => void;
}) {
  const { locale: uiLocale } = useUiLocale();
  const [traceOpen, setTraceOpen] = React.useState(false);
  const traceId = entry?.labels.trace_id || entry?.labels.traceId || null;
  React.useEffect(() => setTraceOpen(false), [entry]);
  if (!entry) return null;

  return (
    <>
      <UiProps ids={{"aria-label":["admin.m77af343f1fb7"]}}><div className="fixed inset-0 !mt-0 z-[170] flex justify-end bg-black/35" role="dialog" aria-modal="true" aria-label="admin.m77af343f1fb7">
        <div className="h-full w-full max-w-xl overflow-y-auto border-l border-[var(--border)] bg-[var(--sidebar-bg)] shadow-[var(--shadow)]">
          <div className="sticky top-0 flex items-center justify-between border-b border-[var(--border)] bg-[var(--sidebar-bg)] p-4">
            <div>
              <h2 className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m77af343f1fb7" /></h2>
              <p className="mt-1 text-[10px] text-[var(--app-muted)]">
                {entry.timestamp ? new Date(entry.timestamp).toLocaleString(uiLocale === "en" ? "en-US" : "zh-CN", { hour12: false }) : <UiText id="admin.m4a47cdc66fb9" />}
              </p>
            </div>
            <UiProps ids={{"aria-label":["admin.mc980bf4a0758"]}}><button type="button" onClick={onClose} aria-label="admin.mc980bf4a0758" className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--app-muted)] hover:bg-[var(--panel-2)]">
              <X className="h-4 w-4" />
            </button></UiProps>
          </div>
          <div className="space-y-4 p-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mb97249cc8c2d" /></h3>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(entry.line)}
                  className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--app-muted)] hover:bg-[var(--panel-2)]"
                >
                  <Copy className="h-3 w-3" /><UiText id="admin.m63d90d977348" /></button>
              </div>
              <pre className="whitespace-pre-wrap break-words rounded-xl border border-[var(--border)] bg-[var(--input-bg)] p-3 font-mono text-[11px] leading-5 text-[var(--app-fg)]">{entry.line}</pre>
            </div>
            <div>
              <h3 className="mb-2 text-[11px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mfb15a1e9d851" /></h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(entry.labels).map(([key, value]) => (
                  <span key={key} className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 font-mono text-[10px] text-[var(--app-muted)]">
                    {key}={value}
                  </span>
                ))}
              </div>
            </div>
            {traceId ? (
              <button type="button" onClick={() => setTraceOpen(true)} className="flex h-9 items-center gap-2 rounded-lg bg-[var(--primary-bg)] px-3 text-[11px] font-semibold text-[var(--primary-fg)]">
                <Network className="h-4 w-4" /><UiText id="admin.m189b4f4efa20" /></button>
            ) : (
              <p className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.m0ef480db1c28" /></p>
            )}
          </div>
        </div>
      </div></UiProps>
      <TraceDetailsDrawer traceId={traceId} open={traceOpen} onClose={() => setTraceOpen(false)} />
    </>
  );
}
