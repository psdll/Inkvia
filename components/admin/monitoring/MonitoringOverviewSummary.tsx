"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clock3,
  ServerCrash,
  Telescope,
} from "lucide-react";

import type { HealthState } from "@/lib/monitoring/contracts";
import type { BusinessOverviewState } from "@/lib/monitoring/overview-view-model";
import { buildMonitoringOverviewModel } from "@/lib/monitoring/overview-view-model";
import type { MonitoringCapabilities, ServiceStatus } from "@/lib/monitoring/contracts";

import type { MonitoringView } from "./MonitoringSubnav";

const SUMMARY_META: Record<BusinessOverviewState, { detail: string; style: string; icon: typeof CircleCheck }> = {
  healthy: {
    detail: "页面、任务处理和数据保存均有正常运行证据。",
    style: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700",
    icon: CircleCheck,
  },
  warning: {
    detail: "项目仍在运行，但部分功能发出警告或状态证据已经过期。",
    style: "border-amber-500/25 bg-amber-500/10 text-amber-700",
    icon: Clock3,
  },
  critical: {
    detail: "至少一项核心功能已经不可用或出现严重异常。",
    style: "border-rose-500/25 bg-rose-500/10 text-rose-700",
    icon: ServerCrash,
  },
  unknown: {
    detail: "当前缺少足够的服务状态证据，不能确认核心功能是否可用。",
    style: "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)]",
    icon: CircleHelp,
  },
};

export function MonitoringOverviewSummary({
  services,
  capabilities,
  hostState,
  dataError,
  dataStale,
  checkedAt,
  onNavigate,
}: {
  services: ServiceStatus[];
  capabilities: MonitoringCapabilities;
  hostState: HealthState;
  dataError: string | null;
  dataStale: boolean;
  checkedAt: string;
  onNavigate: (view: MonitoringView) => void;
}) {
  const { label: uiLabel, locale: uiLocale } = useUiLocale();
  const model = buildMonitoringOverviewModel(services, capabilities);
  const meta = SUMMARY_META[model.overallState];
  const Icon = meta.icon;
  const businessIssues = model.areas.filter((area) => area.state === "critical" || area.state === "warning");
  const hasCapacityIssue = hostState === "critical" || hostState === "warning";
  const missingCoverage = model.coverage.filter((item) => !item.configured);
  const hasUserImpactIssue = businessIssues.length > 0 || hasCapacityIssue;
  const hasUnknownBusinessState = model.counts.unknown > 0;

  return (
    <section className="grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.8fr)]">
      <article className={`rounded-2xl border p-5 shadow-sm ${meta.style}`} aria-live="polite">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-[var(--panel-bg)]/60">
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold tracking-[0.08em] opacity-75"><UiText id="admin.m91b858cd7b56" /></p>
              <h2 className="mt-1 text-[22px] font-semibold tracking-tight">{model.headline}</h2>
              <p className="mt-2 max-w-2xl text-[12px] leading-5 opacity-85">{uiLabel(meta.detail)}</p>
            </div>
          </div>
          <div className="shrink-0 text-left text-[11px] opacity-75 sm:text-right">
            <div><UiText id="admin.m9e9d40afbdd0" />{checkedAt ? new Date(checkedAt).toLocaleTimeString(uiLocale === "en" ? "en-US" : "zh-CN", { hour12: false }) : <UiText id="admin.m4d8c1c5b4283" />}</div>
            <div className="mt-1"><UiText id="admin.m435dc29e69de" /></div>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 border-t border-current/15 pt-4 sm:grid-cols-4">
          {[
            ["正常", model.counts.healthy, "text-emerald-700"],
            ["需关注", model.counts.warning, "text-amber-700"],
            ["异常", model.counts.critical, "text-rose-700"],
            ["未知", model.counts.unknown, "text-[var(--app-muted)]"],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className="rounded-xl bg-[var(--panel-bg)]/55 px-3 py-2">
              <div className={`font-mono text-[20px] font-semibold ${tone}`}>{value}</div>
              <div className="text-[11px] opacity-75">{label}<UiText id="admin.m25f5ce57a190" /></div>
            </div>
          ))}
        </div>
      </article>

      <article className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mb7e3e715f18b" /></h2>
            <p className="mt-1 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m46c7c8315112" /></p>
          </div>
          {!hasUserImpactIssue && !hasUnknownBusinessState
            ? <CircleCheck className="h-5 w-5 text-emerald-600" />
            : hasUserImpactIssue
              ? <CircleAlert className="h-5 w-5 text-amber-600" />
              : <CircleHelp className="h-5 w-5 text-[var(--app-muted)]" />}
        </div>

        <div className="mt-4 space-y-2">
          {!hasUserImpactIssue && !hasUnknownBusinessState ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-[12px] text-emerald-700">
              <div className="font-semibold"><UiText id="admin.md92eb7879b53" /></div>
              <div className="mt-1 leading-5 opacity-85"><UiText id="admin.m8ff376ee8210" /></div>
            </div>
          ) : null}

          {!hasUserImpactIssue && hasUnknownBusinessState ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[12px] text-[var(--app-fg)]">
              <div className="font-semibold"><UiText id="admin.mc657ee53fb4a" /></div>
              <div className="mt-1 leading-5 text-[var(--app-muted)]"><UiText id="admin.m811598ff2e34" />{model.counts.unknown}<UiText id="admin.m68d29cdeac1a" /></div>
            </div>
          ) : null}

          {businessIssues.slice(0, 2).map((area) => (
            <div key={area.id} className={area.state === "critical" ? "rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-rose-700" : "rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-700"}>
              <div className="font-semibold">{area.label}{area.state === "critical" ? <UiText id="admin.m5eed6049cc53" /> : <UiText id="admin.mf121ab742cef" />}</div>
              <div className="mt-1 text-[12px] leading-5 opacity-85">{area.state === "critical" ? area.impact : <UiText id="admin.m8f09e3183a33" />}</div>
              <button type="button" onClick={() => onNavigate("logs")} className="mt-2 flex items-center gap-1 text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)]"><UiText id="admin.ma048c550e0f2" /><ArrowRight className="h-3 w-3" />
              </button>
            </div>
          ))}

          {hasCapacityIssue ? (
            <div className={hostState === "critical" ? "rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-rose-700" : "rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-700"}>
              <div className="font-semibold"><UiText id="admin.mccf74dc131e3" />{hostState === "critical" ? <UiText id="admin.m7d440dbe7bde" /> : <UiText id="admin.m0fe028df4b60" />}</div>
              <div className="mt-1 text-[12px] leading-5 opacity-85"><UiText id="admin.mb600e0047ef7" /></div>
            </div>
          ) : null}

          {dataError || dataStale ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-amber-700">
              <div className="font-semibold"><UiText id="admin.m0af237615750" /></div>
              <div className="mt-1 text-[12px] leading-5 opacity-85">{dataError || <UiText id="admin.m4fb71f83fbbe" />}</div>
            </div>
          ) : null}

          {missingCoverage.length > 0 ? (
            <div className="rounded-xl border border-[color-mix(in_srgb,var(--primary-bg)_20%,transparent)] bg-[color-mix(in_srgb,var(--primary-bg)_7%,transparent)] p-3 text-[var(--app-fg)]">
              <div className="flex items-center gap-2 font-semibold"><Telescope className="h-3.5 w-3.5 text-[var(--primary-bg)]" /><UiText id="admin.m49327aa92eba" /></div>
              <div className="mt-1 text-[12px] leading-5 text-[var(--app-muted)]">
                {missingCoverage.map((item) => item.label).join("、")}<UiText id="admin.m6b826e46af88" /></div>
            </div>
          ) : null}
        </div>
      </article>
    </section>
  );
}
