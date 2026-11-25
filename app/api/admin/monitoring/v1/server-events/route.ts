import { apiMessage } from "@/i18n/api-message";
import type { NextRequest } from "next/server";

import { readMonitoringConfig } from "@/lib/monitoring/config";
import { readOpsServerEvents } from "@/lib/monitoring/ops-client";
import {
  monitoringJson,
  requireMonitoringPermission,
} from "@/lib/monitoring/permissions";
import { parseServerEventQuery } from "@/lib/monitoring/server-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const permission = requireMonitoringPermission(request, "monitoring.view");
  if (!permission.ok) {
    return monitoringJson({ error: permission.error }, permission.status);
  }

  let query;
  try {
    query = parseServerEventQuery(new URL(request.url).searchParams);
  } catch (error) {
    return monitoringJson({
      error: error instanceof Error ? error.message : apiMessage("mc1bf285f1e12"),
    }, 400);
  }

  if (!readMonitoringConfig().capabilities.serverEvents) {
    return monitoringJson({
      apiVersion: "v1",
      supported: false,
      state: "unsupported",
      events: [],
    });
  }

  try {
    const result = await readOpsServerEvents(query);
    return monitoringJson({
      apiVersion: "v1",
      supported: true,
      state: "healthy",
      ...result,
    });
  } catch {
    return monitoringJson({
      error: apiMessage("m2a064475cc32"),
    }, 503);
  }
}
