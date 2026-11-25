import { apiMessage } from "@/i18n/api-message";
import type { NextRequest } from "next/server";

import { readMonitoringConfig } from "@/lib/monitoring/config";
import { hasExactObjectKeys } from "@/lib/monitoring/ops-actions";
import { createOpsLogDeletePlan } from "@/lib/monitoring/ops-client";
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
    const body = await readMonitoringJson(request, 256);
    if (!hasExactObjectKeys(body, [])) throw new Error("删除清单请求不接受额外字段");
    return monitoringJson(await createOpsLogDeletePlan(permission.username));
  } catch (error) {
    return monitoringJson({
      error: error instanceof Error ? error.message : apiMessage("m921de9795eac"),
    }, 400);
  }
}
