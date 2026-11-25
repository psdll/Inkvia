"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import { Check, CircleAlert, CircleOff, Server } from "lucide-react";

import type { HealthState, ServiceStatus } from "@/lib/monitoring/contracts";

const STATE_COPY: Record<HealthState, string> = {
  healthy: "正常",
  warning: "需关注",
  critical: "严重",
  unavailable: "不可用",
  unsupported: "未接入",
  stale: "已过期",
};

const STATE_STYLE: Record<HealthState, string> = {
  healthy: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-600",
  critical: "border-rose-500/25 bg-rose-500/10 text-rose-600",
  unavailable: "border-rose-500/25 bg-rose-500/10 text-rose-600",
  unsupported: "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)]",
  stale: "border-amber-500/25 bg-amber-500/10 text-amber-600",
};

function iconFor(state: HealthState) {
  if (state === "healthy") return Check;
  if (state === "unsupported") return CircleOff;
  return CircleAlert;
}

function groupedState(services: ServiceStatus[], ids: ServiceStatus["id"][]): HealthState {
  const states = services.filter((service) => ids.includes(service.id)).map((service) => service.state);
  if (!states.length || states.every((state) => state === "unsupported")) return "unsupported";
  if (states.some((state) => state === "critical" || state === "unavailable")) return "critical";
  if (states.some((state) => state === "warning" || state === "stale")) return "warning";
  return "healthy";
}

export function SystemHealthRail({
  hostState,
  services,
}: {
  hostState: HealthState;
  services: ServiceStatus[];
}) {
  const { label: uiLabel } = useUiLocale();
  const stages: Array<{ label: string; detail: string; state: HealthState }> = [
    { label: "服务器", detail: "CPU · 内存 · 磁盘", state: hostState },
    { label: "Web", detail: "页面与 API", state: groupedState(services, ["web", "nginx"]) },
    { label: "Worker", detail: "生成、媒体与 Live 视频任务", state: groupedState(services, ["generation-worker", "media-worker", "live-video-prompt-worker", "live-video-video-worker"]) },
    { label: "数据", detail: "PostgreSQL", state: groupedState(services, ["postgresql"]) },
    { label: "监控链路", detail: "指标 · 日志 · Trace", state: groupedState(services, ["prometheus", "loki", "tempo", "alloy"]) },
  ];

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--app-fg)]">
            <Server className="h-4 w-4 text-[var(--primary-bg)]" /><UiText id="admin.mf1a53cb2baa7" /></div>
          <p className="mt-1 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m118eba3499f8" /></p>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-5">
        {stages.map((stage, index) => {
          const Icon = iconFor(stage.state);
          return (
            <div key={stage.label} className="relative min-w-0">
              {index < stages.length - 1 ? (
                <div className="absolute left-[calc(100%-4px)] top-6 hidden h-px w-4 bg-[var(--border)] md:block" />
              ) : null}
              <div className={`h-full rounded-xl border p-3 ${STATE_STYLE[stage.state]}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] font-semibold">{uiLabel(stage.label)}</span>
                  <Icon className="h-4 w-4 shrink-0" />
                </div>
                <div className="mt-3 text-[11px] opacity-80">{uiLabel(stage.detail)}</div>
                <div className="mt-1 text-[11px] font-medium">{STATE_COPY[stage.state]}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
