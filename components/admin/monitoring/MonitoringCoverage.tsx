"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import { Check, CircleOff, Telescope } from "lucide-react";

import type { MonitoringCoverageItem } from "@/lib/monitoring/overview-view-model";

export function MonitoringCoverage({ coverage }: { coverage: MonitoringCoverageItem[] }) {
  const { label: uiLabel } = useUiLocale();
  const configuredCount = coverage.filter((item) => item.configured).length;
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Telescope className="h-4 w-4 text-[var(--primary-bg)]" />
            <h2 className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m8df573b7e9f2" /></h2>
          </div>
          <p className="mt-1 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m87fb98ed7b08" /></p>
        </div>
        <span className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.mab805fc7403a" />{configuredCount}/{coverage.length}</span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {coverage.map((item) => {
          const Icon = item.configured ? Check : CircleOff;
          return (
            <article key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[12px] font-semibold text-[var(--app-fg)]">{uiLabel(item.label)}</h3>
                <span className={item.configured ? "flex items-center gap-1 text-[10px] font-medium text-emerald-600" : "flex items-center gap-1 text-[10px] font-medium text-[var(--app-muted)]"}>
                  <Icon className="h-3 w-3" />{item.configured ? <UiText id="admin.mfa1876770899" /> : <UiText id="admin.m80a57e03f071" />}
                </span>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-[var(--app-muted)]">{item.description}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
