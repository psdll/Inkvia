"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import { CircleAlert, CircleCheck, CircleOff, Clock3, SlidersHorizontal } from "lucide-react";

import type { HealthState, ServiceStatus } from "@/lib/monitoring/contracts";

const STATE_META: Record<HealthState, { label: string; style: string; icon: typeof CircleCheck }> = {
  healthy: { label: "运行正常", style: "border-emerald-500/25 bg-emerald-500/10 text-emerald-600", icon: CircleCheck },
  warning: { label: "需要关注", style: "border-amber-500/25 bg-amber-500/10 text-amber-600", icon: CircleAlert },
  critical: { label: "严重异常", style: "border-rose-500/25 bg-rose-500/10 text-rose-600", icon: CircleAlert },
  unavailable: { label: "不可用", style: "border-rose-500/25 bg-rose-500/10 text-rose-600", icon: CircleOff },
  unsupported: { label: "未接入", style: "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)]", icon: CircleOff },
  stale: { label: "数据过期", style: "border-amber-500/25 bg-amber-500/10 text-amber-600", icon: Clock3 },
};

export function ServiceStatusCard({
  service,
  canOperate = false,
  onOperate,
}: {
  service: ServiceStatus;
  canOperate?: boolean;
  onOperate?: (target: ServiceStatus) => void;
}) {
  const { label: uiLabel } = useUiLocale();
  const meta = STATE_META[service.state];
  const Icon = meta.icon;
  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[12px] font-semibold text-[var(--app-fg)]">{service.name}</h3>
          <p className="mt-1 line-clamp-2 min-h-8 text-[10px] leading-4 text-[var(--app-muted)]">
            {service.message || <UiText id="admin.m2e2af05dcc79" />}
          </p>
        </div>
        <span className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${meta.style}`}>
          <Icon className="h-3 w-3" />
          {uiLabel(meta.label)}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2.5 text-[10px] text-[var(--app-muted)]">
        <span>{service.pid ? `PID ${service.pid}` : <UiText id="admin.m5e7ea74821bb" />}</span>
        {canOperate && onOperate ? (
          <button type="button" onClick={() => onOperate(service)} className="flex h-7 items-center gap-1 rounded-lg border border-[var(--border)] px-2 text-[10px] font-medium text-[var(--app-fg)] hover:bg-[var(--panel-2)]">
            <SlidersHorizontal className="h-3 w-3" /><UiText id="admin.med31fbb483ee" /></button>
        ) : (
          <span>{service.controllable ? <UiText id="admin.m6ce1d7e99daa" /> : <UiText id="admin.m39395c1df20e" />}</span>
        )}
      </div>
    </article>
  );
}
