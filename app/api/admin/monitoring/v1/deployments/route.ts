import { apiMessage } from "@/i18n/api-message";
import type { NextRequest } from "next/server";

import { readDeploymentReliability } from "@/lib/monitoring/reliability-service";
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
    return monitoringJson({ apiVersion: "v1", ...(await readDeploymentReliability()) });
  } catch (error) {
    return monitoringJson({ error: error instanceof Error ? error.message : apiMessage("ma2702aea386a") }, 503);
  }
}
