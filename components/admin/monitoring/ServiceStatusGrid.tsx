"use client";

import type { ServiceStatus } from "@/lib/monitoring/contracts";

import { operationsForTarget } from "./MonitoringOperationDialog";
import { ServiceStatusCard } from "./ServiceStatusCard";

export function ServiceStatusGrid({
  services,
  operationsEnabled = false,
  onOperate,
  title = "服务状态",
  description = "状态异常时先查看对应服务日志，再按故障指引执行轻量恢复。",
}: {
  services: ServiceStatus[];
  operationsEnabled?: boolean;
  onOperate?: (target: ServiceStatus) => void;
  title?: string;
  description?: string;
}) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-[14px] font-semibold text-[var(--app-fg)]">{title}</h2>
        <p className="mt-1 text-[12px] text-[var(--app-muted)]">{description}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {services.map((service) => (
          <ServiceStatusCard
            key={service.id}
            service={service}
            canOperate={operationsEnabled && operationsForTarget(service).length > 0}
            onOperate={onOperate}
          />
        ))}
      </div>
    </section>
  );
}
