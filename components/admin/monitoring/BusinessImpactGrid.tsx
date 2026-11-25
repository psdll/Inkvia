"use client";
import { UiText } from "@/i18n/ui";


import type { MonitoringMode } from "@/lib/monitoring/contracts";
import type { MetricPoint } from "@/lib/monitoring/metric-health";
import type { MetricQueryKey } from "@/lib/monitoring/prometheus-client";
import {
  buildBusinessSignalModels,
  type BusinessSignalState,
} from "@/lib/monitoring/business-signal-view-model";

const STATE_CLASS: Record<BusinessSignalState, string> = {
  available: "bg-emerald-500/10 text-emerald-700",
  stale: "bg-amber-500/10 text-amber-700",
  unavailable: "bg-[var(--panel-2)] text-[var(--app-muted)]",
  error: "bg-rose-500/10 text-rose-600",
  unsupported: "bg-[var(--panel-2)] text-[var(--app-muted)]",
};

export function BusinessImpactGrid({
  mode,
  historySupported,
  evidenceAvailable,
  checkedAt,
  series,
  metricErrors,
}: {
  mode: MonitoringMode;
  historySupported: boolean;
  evidenceAvailable: boolean;
  checkedAt: number;
  series: Record<string, MetricPoint[]>;
  metricErrors: Partial<Record<MetricQueryKey, string>>;
}) {
  const models = buildBusinessSignalModels({
    mode,
    historySupported,
    evidenceAvailable,
    checkedAt,
    series,
    errors: metricErrors,
  });

  return (
    <section aria-labelledby="business-impact-heading">
      <div>
        <h2 id="business-impact-heading" className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mb43449e404a7" /></h2>
        <p className="mt-1 text-[12px] leading-5 text-[var(--app-muted)]"><UiText id="admin.mcd8ac8f84eaa" /></p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {models.map((model) => (
          <article key={model.key} className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[12px] font-semibold text-[var(--app-fg)]">{model.label}</h3>
                <p className="mt-2 text-[22px] font-semibold tracking-tight text-[var(--app-fg)]">{model.valueLabel}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${STATE_CLASS[model.state]}`}>
                {model.statusLabel}
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-[var(--app-muted)]">{model.description}</p>
            <p className="mt-2 border-t border-[var(--border)] pt-2 text-[10px] leading-4 text-[var(--app-muted)]">{model.detail}</p>
            {model.rangeLabel ? <p className="mt-1 text-[10px] text-[var(--app-muted)]">{model.rangeLabel}</p> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
