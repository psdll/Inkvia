import { apiMessage } from "@/i18n/api-message";
import type { NextRequest } from "next/server";

import {
  normalizeReliabilityWindow,
  readCapacityReliability,
} from "@/lib/monitoring/reliability-service";
import {
  monitoringJson,
  requireMonitoringPermission,
} from "@/lib/monitoring/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const permission = requireMonitoringPermission(request, "monitoring.view");
  if (!permission.ok) return monitoringJson({ error: permission.error }, permission.status);
  try {
    const params = new URL(request.url).searchParams;
    const window = normalizeReliabilityWindow({ from: params.get("from"), to: params.get("to") });
    return monitoringJson({ apiVersion: "v1", ...(await readCapacityReliability(window)) });
  } catch (error) {
    return monitoringJson({ error: error instanceof Error ? error.message : apiMessage("m432839514f80") }, 503);
  }
}
