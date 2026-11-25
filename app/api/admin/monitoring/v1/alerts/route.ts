import type { NextRequest } from "next/server";

import { readAlertAcknowledgements } from "@/lib/monitoring/alert-state";
import { listAlertmanagerAlerts } from "@/lib/monitoring/alertmanager-client";
import { readMonitoringConfig } from "@/lib/monitoring/config";
import { normalizeProjectUploadDiskAlert } from "@/lib/monitoring/fault-guidance";
import { listUploadDiskAlerts } from "@/lib/monitoring/upload-disk-alerts";
import {
  monitoringJson,
  requireMonitoringPermission,
} from "@/lib/monitoring/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const permission = requireMonitoringPermission(request, "monitoring.view");
  if (!permission.ok) return monitoringJson({ error: permission.error }, permission.status);
  const config = readMonitoringConfig();
  const now = new Date();
  let projectAlerts = [] as ReturnType<typeof normalizeProjectUploadDiskAlert>[];
  let projectState: "healthy" | "unavailable" = "healthy";
  let projectError: string | undefined;
  try {
    projectAlerts = (await listUploadDiskAlerts(now))
      .map((alert) => normalizeProjectUploadDiskAlert(alert, now));
  } catch (error) {
    projectState = "unavailable";
    projectError = error instanceof Error ? error.message : "项目告警查询失败";
  }

  if (config.mode === "local-light") {
    return monitoringJson({
      apiVersion: "v1",
      supported: true,
      state: projectState === "healthy" ? "healthy" : "warning",
      projectState,
      ...(projectError ? { projectError } : {}),
      externalState: "unsupported",
      alerts: projectAlerts,
    });
  }

  try {
    const alerts = await listAlertmanagerAlerts({
      endpoint: config.endpoints.alertmanager,
      timeoutMs: config.requestTimeoutMs,
      acknowledgements: await readAlertAcknowledgements(),
      now,
    });
    return monitoringJson({
      apiVersion: "v1",
      supported: true,
      state: projectState === "healthy" ? "healthy" : "warning",
      projectState,
      ...(projectError ? { projectError } : {}),
      externalState: "healthy",
      alerts: [...projectAlerts, ...alerts],
    });
  } catch (error) {
    return monitoringJson({
      apiVersion: "v1",
      supported: true,
      state: "warning",
      projectState,
      ...(projectError ? { projectError } : {}),
      externalState: "unavailable",
      externalError: error instanceof Error ? error.message : "Alertmanager 告警查询失败",
      alerts: projectAlerts,
    });
  }
}
