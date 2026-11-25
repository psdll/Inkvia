import { apiMessage } from "@/i18n/api-message";
import type { NextRequest } from "next/server";

import { logAdminAction } from "@/lib/admin-audit";
import { readMonitoringConfig } from "@/lib/monitoring/config";
import {
  hasExactObjectKeys,
  normalizeIdempotencyKey,
} from "@/lib/monitoring/ops-actions";
import { submitOpsOperation } from "@/lib/monitoring/ops-client";
import {
  hasMonitoringSameOrigin,
  monitoringJson,
  readMonitoringJson,
  requireMonitoringPermission,
} from "@/lib/monitoring/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const permission = requireMonitoringPermission(request, "monitoring.logs.rotate");
  if (!permission.ok) return monitoringJson({ error: permission.error }, permission.status);
  if (!hasMonitoringSameOrigin(request)) return monitoringJson({ error: apiMessage("m4fab5d58421b") }, 403);
  if (!readMonitoringConfig().capabilities.logRotation) {
    return monitoringJson({ error: apiMessage("m3b57c372c890") }, 409);
  }
  try {
    const body = await readMonitoringJson(request, 1024);
    if (!hasExactObjectKeys(body, ["idempotencyKey"])) throw new Error("日志轮转请求字段无效");
    const operation = await submitOpsOperation({
      action: "logs.rotate",
      idempotencyKey: normalizeIdempotencyKey(body.idempotencyKey),
      actor: permission.username,
    });
    await logAdminAction({
      admin: permission.username,
      action: "monitoring_logs_rotate",
      message: "已提交日志立即轮转",
      level: "warning",
      metadata: { operationId: operation.id },
      req: request,
    });
    return monitoringJson(operation, 202);
  } catch (error) {
    return monitoringJson({
      error: error instanceof Error ? error.message : apiMessage("me160b156a902"),
    }, 400);
  }
}
