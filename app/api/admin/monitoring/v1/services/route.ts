import type { NextRequest } from "next/server";

import { getMonitoringServices } from "@/lib/monitoring/overview-service";
import { readOpsStatus } from "@/lib/monitoring/ops-client";
import {
  monitoringJson,
  requireMonitoringPermission,
} from "@/lib/monitoring/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const permission = requireMonitoringPermission(request, "monitoring.view");
  if (!permission.ok) return monitoringJson({ error: permission.error }, permission.status);
  const fallback = await getMonitoringServices();
  if (fallback.mode !== "production") return monitoringJson(fallback);

  try {
    const status = await readOpsStatus();
    const checkedAt = new Date();
    const observedAt = new Date(status.observedAt);
    const ageMs = Math.max(0, checkedAt.getTime() - observedAt.getTime());
    return monitoringJson({
      ...fallback,
      collectedAt: status.observedAt,
      freshness: {
        observedAt: status.observedAt,
        checkedAt: checkedAt.toISOString(),
        ageMs,
        staleAfterMs: 30_000,
        stale: ageMs > 30_000,
      },
      services: status.services,
    });
  } catch {
    return monitoringJson({
      ...fallback,
      services: fallback.services.map((service) => service.id === "web"
        ? { ...service, controllable: false, message: "Web 正在响应，但独立运维服务不可用" }
        : {
            ...service,
            state: "unavailable" as const,
            controllable: false,
            message: "独立运维服务不可用，无法确认该组件状态",
          }),
    });
  }
}
