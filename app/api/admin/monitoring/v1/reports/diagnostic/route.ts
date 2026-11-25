import type { NextRequest } from "next/server";

import { logAdminAction } from "@/lib/admin-audit";
import { readAlertAcknowledgements } from "@/lib/monitoring/alert-state";
import { listAlertmanagerAlerts } from "@/lib/monitoring/alertmanager-client";
import { readMonitoringConfig } from "@/lib/monitoring/config";
import {
  buildDiagnosticReport,
  normalizeProjectUploadDiskAlert,
} from "@/lib/monitoring/fault-guidance";
import { getMonitoringOverview } from "@/lib/monitoring/overview-service";
import { listUploadDiskAlerts } from "@/lib/monitoring/upload-disk-alerts";
import {
  monitoringJson,
  requireMonitoringPermission,
} from "@/lib/monitoring/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const permission = requireMonitoringPermission(request, "monitoring.reports.export");
  if (!permission.ok) return monitoringJson({ error: permission.error }, permission.status);
  const config = readMonitoringConfig();

  const now = new Date();
  let alerts: unknown[] = (await listUploadDiskAlerts(now).catch(() => []))
    .map((alert) => normalizeProjectUploadDiskAlert(alert, now));
  if (config.mode !== "local-light") {
    const externalAlerts = await listAlertmanagerAlerts({
      endpoint: config.endpoints.alertmanager,
      timeoutMs: config.requestTimeoutMs,
      acknowledgements: await readAlertAcknowledgements(),
    }).catch(() => []);
    alerts = [...alerts, ...externalAlerts];
  }
  const report = buildDiagnosticReport({
    overview: await getMonitoringOverview(),
    alerts,
    logs: [],
  });
  await logAdminAction({
    admin: permission.username,
    action: "monitoring_diagnostic_report_download",
    message: "生成并下载监控诊断报告",
    level: "info",
    metadata: {
      alertCount: report.alerts.length,
      logCount: report.logs.length,
      schemaVersion: report.schemaVersion,
    },
    req: request,
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return new Response(JSON.stringify(report, null, 2), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="inkvia-diagnostic-${stamp}.json"`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
