import { apiMessage } from "@/i18n/api-message";
import type { NextRequest } from "next/server";

import { logAdminAction } from "@/lib/admin-audit";
import { acknowledgeAlert } from "@/lib/monitoring/alert-state";
import { normalizeAlertFingerprint } from "@/lib/monitoring/alert-state";
import {
  acknowledgeUploadDiskAlert,
  findUploadDiskAlertByFingerprint,
} from "@/lib/monitoring/upload-disk-alerts";
import {
  hasMonitoringSameOrigin,
  monitoringJson,
  readMonitoringJson,
  requireMonitoringPermission,
} from "@/lib/monitoring/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const permission = requireMonitoringPermission(request, "monitoring.alerts.manage");
  if (!permission.ok) return monitoringJson({ error: permission.error }, permission.status);
  if (!hasMonitoringSameOrigin(request)) return monitoringJson({ error: apiMessage("m4fab5d58421b") }, 403);

  try {
    const body = await readMonitoringJson(request, 8 * 1024);
    const fingerprint = normalizeAlertFingerprint(body?.fingerprint);
    const projectAlert = await findUploadDiskAlertByFingerprint(fingerprint);
    if (projectAlert?.state === "recovered") {
      return monitoringJson({ error: apiMessage("ma3452a1688fc") }, 409);
    }

    const updatedProjectAlert = projectAlert
      ? await acknowledgeUploadDiskAlert(fingerprint, permission.username, body?.note)
      : null;
    const acknowledgement = updatedProjectAlert
      ? {
        by: updatedProjectAlert.acknowledgedBy || permission.username,
        at: (updatedProjectAlert.acknowledgedAt || new Date()).toISOString(),
        note: updatedProjectAlert.acknowledgementNote || undefined,
      }
      : await acknowledgeAlert({
        fingerprint,
        by: permission.username,
        note: body?.note,
      });
    await logAdminAction({
      admin: permission.username,
      action: "monitoring_alert_acknowledge",
      message: "确认监控告警",
      level: "info",
      metadata: {
        fingerprint,
        source: updatedProjectAlert ? "project" : "alertmanager",
        acknowledgedAt: acknowledgement.at,
      },
      req: request,
    });
    return monitoringJson({
      success: true,
      source: updatedProjectAlert ? "project" : "alertmanager",
      acknowledgement,
    });
  } catch (error) {
    return monitoringJson({
      error: error instanceof Error ? error.message : apiMessage("m496add25749d"),
    }, 400);
  }
}
