import type { NextRequest } from "next/server";

import { getMonitoringCapabilities } from "@/lib/monitoring/overview-service";
import {
  monitoringJson,
  requireMonitoringPermission,
} from "@/lib/monitoring/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const permission = requireMonitoringPermission(request, "monitoring.view");
  if (!permission.ok) return monitoringJson({ error: permission.error }, permission.status);
  return monitoringJson(getMonitoringCapabilities());
}
