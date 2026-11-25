"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import { ArrowRight, CircleAlert, CircleCheck, CircleHelp, Clock3 } from "lucide-react";

import type { HealthState } from "@/lib/monitoring/contracts";
import type { BusinessArea } from "@/lib/monitoring/overview-view-model";

import type { MonitoringView } from "./MonitoringSubnav";

const STATE_META: Record<HealthState, { label: string; message: string; style: string; icon: typeof CircleCheck }> = {
  healthy: {
    label: "运行正常",
    message: "当前服务均有正常运行证据",
    style: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600",
    icon: CircleCheck,
  },
  warning: {
    label: "需要关注",
    message: "服务发出警告或状态数据已过期",
    style: "border-amber-500/25 bg-amber-500/10 text-amber-700",
    icon: Clock3,
  },
  critical: {
    label: "功能异常",
    message: "检测到不可用或严重异常的服务",
    style: "border-rose-500/25 bg-rose-500/10 text-rose-600",
    icon: CircleAlert,
  },
  unavailable: {
    label: "功能异常",
    message: "检测到不可用的服务",
    style: "border-rose-500/25 bg-rose-500/10 text-rose-600",
    icon: CircleAlert,
  },
  unsupported: {
    label: "状态未知",
    message: "没有可用于判断的服务状态",
    style: "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)]",
    icon: CircleHelp,
  },
  stale: {
    label: "需要关注",
    message: "状态数据已经过期",
    style: "border-amber-500/25 bg-amber-500/10 text-amber-700",
    icon: Clock3,
  },
};

export function BusinessHealthGrid({
  areas,
  onNavigate,
}: {
  areas: BusinessArea[];
  onNavigate: (view: MonitoringView) => void;
}) {
  const { label: uiLabel } = useUiLocale();
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m4eabc0bfe0c8" /></h2>
        <p className="mt-1 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m97dcdc1a9291" /></p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {areas.map((area) => {
          const meta = STATE_META[area.state];
          const Icon = meta.icon;
          return (
            <article key={area.id} className="flex min-w-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[13px] font-semibold text-[var(--app-fg)]">{area.label}</h3>
                  <p className="mt-1 text-[12px] leading-5 text-[var(--app-muted)]">{area.description}</p>
                </div>
                <span className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${meta.style}`}>
                  <Icon className="h-3 w-3" />{uiLabel(meta.label)}
                </span>
              </div>
              <p className="mt-4 min-h-10 text-[12px] leading-5 text-[var(--app-fg)]">
                {area.state === "critical"
                  ? area.impact
                  : area.hasPartialEvidence
                    ? <UiText id="admin.m6fa8d6eca128" />
                    : meta.message}
              </p>
              <div className="mt-auto flex items-center gap-3 border-t border-[var(--border)] pt-3">
                <button type="button" onClick={() => onNavigate("services")} className="flex items-center gap-1 text-[11px] font-medium text-[var(--primary-bg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"><UiText id="admin.m5beaaa3eaac7" /><ArrowRight className="h-3 w-3" />
                </button>
                {area.state === "critical" || area.state === "warning" ? (
                  <button type="button" onClick={() => onNavigate("logs")} className="text-[11px] font-medium text-[var(--app-muted)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"><UiText id="admin.m659875587949" /></button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
