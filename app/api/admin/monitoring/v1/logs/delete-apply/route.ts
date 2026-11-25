import { apiMessage } from "@/i18n/api-message";
import type { NextRequest } from "next/server";

import { logAdminAction } from "@/lib/admin-audit";
import { readMonitoringConfig } from "@/lib/monitoring/config";
import {
  hasExactObjectKeys,
  normalizeDeletePlanId,
  normalizeIdempotencyKey,
} from "@/lib/monitoring/ops-actions";
import { applyOpsLogDeletePlan } from "@/lib/monitoring/ops-client";
import {
  hasMonitoringSameOrigin,
  monitoringJson,
  readMonitoringJson,
  requireMonitoringPermission,
} from "@/lib/monitoring/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const permission = requireMonitoringPermission(request, "monitoring.logs.delete");
  if (!permission.ok) return monitoringJson({ error: permission.error }, permission.status);
  if (!hasMonitoringSameOrigin(request)) return monitoringJson({ error: apiMessage("m4fab5d58421b") }, 403);
  if (!readMonitoringConfig().capabilities.logDeletion) {
    return monitoringJson({ error: apiMessage("m341fe71da109") }, 409);
  }
  try {
    const body = await readMonitoringJson(request, 1024);
    if (!hasExactObjectKeys(body, ["planId", "idempotencyKey"])) {
      throw new Error("日志删除请求字段无效");
    }
    const operation = await applyOpsLogDeletePlan({
      planId: normalizeDeletePlanId(body.planId),
      idempotencyKey: normalizeIdempotencyKey(body.idempotencyKey),
      actor: permission.username,
    });
    await logAdminAction({
      admin: permission.username,
      action: "monitoring_logs_delete_apply",
      message: "已提交已轮转日志删除",
      level: "warning",
      metadata: { operationId: operation.id, planId: body.planId },
      req: request,
    });
    return monitoringJson(operation, 202);
  } catch (error) {
    return monitoringJson({
      error: error instanceof Error ? error.message : apiMessage("mbcd6dc436a5e"),
    }, 400);
  }
}
