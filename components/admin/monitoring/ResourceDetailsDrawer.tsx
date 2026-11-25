"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { RefreshCw, X } from "lucide-react";

import type { HealthState, MonitoringMode, MonitoringOverview } from "@/lib/monitoring/contracts";
import type { MetricPoint, MetricRangeSelection } from "@/lib/monitoring/metric-health";
import type { MetricQueryKey } from "@/lib/monitoring/prometheus-client";

import { BusinessImpactGrid } from "./BusinessImpactGrid";
import { ResourceTrendGrid } from "./ResourceTrendGrid";
import { useRefreshFeedback } from "./useRefreshFeedback";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function ResourceDetailsDrawer({
  open,
  triggerRef,
  hostState,
  mode,
  overview,
  historySupported,
  series,
  metricErrors,
  checkedAt,
  evidenceAvailable,
  range,
  onRangeChange,
  onRefresh,
  onClose,
}: {
  open: boolean;
  triggerRef: React.RefObject<HTMLButtonElement>;
  hostState: HealthState;
  mode: MonitoringMode;
  overview: MonitoringOverview;
  historySupported: boolean;
  series: Record<string, MetricPoint[]>;
  metricErrors: Partial<Record<MetricQueryKey, string>>;
  checkedAt: number;
  evidenceAvailable: boolean;
  range: MetricRangeSelection;
  onRangeChange: (range: MetricRangeSelection) => void;
  onRefresh: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { locale: uiLocale } = useUiLocale();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const onCloseRef = React.useRef(onClose);
  const [entered, setEntered] = React.useState(false);
  const { refreshing, runRefresh } = useRefreshFeedback(onRefresh);
  onCloseRef.current = onClose;
  const status = hostState === "critical"
    ? { label: "严重不足", className: "bg-rose-500/10 text-rose-600" }
    : hostState === "warning"
      ? { label: "需要关注", className: "bg-amber-500/10 text-amber-700" }
      : hostState === "healthy"
        ? { label: "当前充足", className: "bg-emerald-500/10 text-emerald-700" }
        : { label: "数据不足", className: "bg-[var(--panel-2)] text-[var(--app-muted)]" };

  React.useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const frame = window.requestAnimationFrame(() => setEntered(true));

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [open, triggerRef]);

  if (!open) return null;

  return (
    <div
      data-resource-drawer-backdrop
      className={`fixed inset-0 !mt-0 z-[170] flex justify-end bg-black/35 transition-opacity duration-150 motion-reduce:transition-none ${entered ? "opacity-100" : "opacity-0"}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="resource-details-heading"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`h-full w-full overflow-y-auto border-l border-[var(--border)] bg-[color-mix(in_srgb,var(--panel-bg)_94%,transparent)] shadow-[var(--shadow)] backdrop-blur-xl transition-transform duration-200 ease-out motion-reduce:transition-none sm:max-w-[680px] ${entered ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--panel-bg)_97%,transparent)] p-4 backdrop-blur-md">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="resource-details-heading" className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m01dc977d2f67" /></h2>
              <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${status.className}`}>{status.label}</span>
            </div>
            <p className="mt-1 text-[10px] text-[var(--app-muted)]">
              {evidenceAvailable
                ? <UiText id="admin.mbed9e6fddc6d" values={{v0: String(new Date(checkedAt).toLocaleString(uiLocale === "en" ? "en-US" : "zh-CN", { hour12: false }))}} />
                : <UiText id="admin.m0b017e7f1c3e" />}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <UiProps ids={{"aria-label":["admin.m963c0324f18c"],"title":["admin.mea5c64dca662","admin.m963c0324f18c"]}}><button
              type="button"
              onClick={() => void runRefresh()}
              disabled={refreshing}
              aria-label="admin.m963c0324f18c"
              aria-busy={refreshing}
              title={refreshing ? "admin.mea5c64dca662" : "admin.m963c0324f18c"}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--app-muted)] outline-none hover:bg-[var(--panel-2)] disabled:cursor-wait disabled:text-[var(--primary-bg)] focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button></UiProps>
            <UiProps ids={{"aria-label":["admin.m7601af99d786"]}}><button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="admin.m7601af99d786"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--app-muted)] outline-none hover:bg-[var(--panel-2)] focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"
            >
              <X className="h-4 w-4" />
            </button></UiProps>
          </div>
        </div>
        <div className="space-y-6 p-4">
          <ResourceTrendGrid
            headingId="server-resource-details-grid"
            overview={overview}
            historySupported={historySupported}
            series={series}
            metricErrors={metricErrors}
            checkedAt={checkedAt}
            evidenceAvailable={evidenceAvailable}
            range={range}
            onRangeChange={onRangeChange}
          />
          <BusinessImpactGrid
            mode={mode}
            historySupported={historySupported}
            evidenceAvailable={evidenceAvailable}
            checkedAt={checkedAt}
            series={series}
            metricErrors={metricErrors}
          />
        </div>
      </div>
    </div>
  );
}
