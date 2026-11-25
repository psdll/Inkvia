import { apiMessage } from "@/i18n/api-message";
import type { NextRequest } from "next/server";

import { logAdminAction } from "@/lib/admin-audit";
import { readMonitoringConfig } from "@/lib/monitoring/config";
import {
  hasExactObjectKeys,
  isOpsAction,
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
  const permission = requireMonitoringPermission(request, "monitoring.services.control");
  if (!permission.ok) return monitoringJson({ error: permission.error }, permission.status);
  if (!hasMonitoringSameOrigin(request)) return monitoringJson({ error: apiMessage("m4fab5d58421b") }, 403);

  const config = readMonitoringConfig();
  if (!config.capabilities.serviceControl) {
    return monitoringJson({ error: apiMessage("m32fb45b48da7") }, 409);
  }

  try {
    const body = await readMonitoringJson(request, 2 * 1024);
    if (!hasExactObjectKeys(body, ["action", "idempotencyKey"])) {
      throw new Error("操作请求字段无效");
    }
    if (!isOpsAction(body.action) || body.action === "logs.rotate") {
      throw new Error("不支持的服务操作");
    }
    if (body.action.startsWith("nginx.") && !config.capabilities.nginxReload) {
      return monitoringJson({ error: apiMessage("m184899e05e24") }, 409);
    }

    const operation = await submitOpsOperation({
      action: body.action,
      idempotencyKey: normalizeIdempotencyKey(body.idempotencyKey),
      actor: permission.username,
    });
    await logAdminAction({
      admin: permission.username,
      action: "monitoring_operation_accepted",
      message: `已提交受控运维操作 ${body.action}`,
      level: body.action.endsWith(".stop") ? "warning" : "info",
      metadata: { operationId: operation.id, operation: body.action },
      req: request,
    });
    return monitoringJson(operation, 202);
  } catch (error) {
    return monitoringJson({
      error: error instanceof Error ? error.message : apiMessage("m57c58aa963db"),
    }, 400);
  }
}
