import { apiMessage } from "@/i18n/api-message";
import type { NextRequest } from "next/server";

import { logAdminAction } from "@/lib/admin-audit";
import { normalizeAlertFingerprint } from "@/lib/monitoring/alert-state";
import {
  createAlertmanagerSilence,
  listAlertmanagerAlerts,
} from "@/lib/monitoring/alertmanager-client";
import { readMonitoringConfig } from "@/lib/monitoring/config";
import { validateSilenceEnd } from "@/lib/monitoring/fault-guidance";
import {
  findUploadDiskAlertByFingerprint,
  silenceUploadDiskAlert,
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
    const endsAt = validateSilenceEnd(body?.endsAt);
    const projectAlert = await findUploadDiskAlertByFingerprint(fingerprint);
    if (projectAlert?.state === "recovered") {
      return monitoringJson({ error: apiMessage("m38650b6ad703") }, 409);
    }
    if (projectAlert) {
      await silenceUploadDiskAlert(fingerprint, new Date(endsAt));
      await logAdminAction({
        admin: permission.username,
        action: "monitoring_alert_silence",
        message: "静默项目监控告警",
        level: "warning",
        metadata: { fingerprint, endsAt, source: "project" },
        req: request,
      });
      return monitoringJson({ success: true, source: "project", endsAt });
    }

    const config = readMonitoringConfig();
    if (config.mode === "local-light") {
      return monitoringJson({ error: apiMessage("me46db811c51b") }, 409);
    }
    const alerts = await listAlertmanagerAlerts({
      endpoint: config.endpoints.alertmanager,
      timeoutMs: config.requestTimeoutMs,
    });
    const alert = alerts.find((item) => item.fingerprint === fingerprint);
    if (!alert) return monitoringJson({ error: apiMessage("m8f9f2f3723da") }, 404);

    const result = await createAlertmanagerSilence({
      endpoint: config.endpoints.alertmanager,
      timeoutMs: config.requestTimeoutMs,
      alert,
      startsAt: new Date().toISOString(),
      endsAt,
      createdBy: permission.username,
      comment: String(body?.comment || "管理员从 Inkvia 监控面板静默").slice(0, 500),
    });
    await logAdminAction({
      admin: permission.username,
      action: "monitoring_alert_silence",
      message: "静默监控告警",
      level: "warning",
      metadata: { fingerprint, endsAt, silenceId: result.silenceId },
      req: request,
    });
    return monitoringJson({ success: true, endsAt, ...result });
  } catch (error) {
    return monitoringJson({
      error: error instanceof Error ? error.message : apiMessage("m4cfd35be91d5"),
    }, 400);
  }
}
