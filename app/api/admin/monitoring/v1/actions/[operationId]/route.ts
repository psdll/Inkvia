import { apiMessage } from "@/i18n/api-message";
import type { NextRequest } from "next/server";

import { normalizeOperationId } from "@/lib/monitoring/ops-actions";
import { readOpsOperation } from "@/lib/monitoring/ops-client";
import {
  monitoringJson,
  requireMonitoringPermission,
} from "@/lib/monitoring/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { operationId: string } },
) {
  const permission = requireMonitoringPermission(request, "monitoring.services.control");
  if (!permission.ok) return monitoringJson({ error: permission.error }, permission.status);
  try {
    return monitoringJson(await readOpsOperation(normalizeOperationId(params.operationId)));
  } catch (error) {
    return monitoringJson({
      error: error instanceof Error ? error.message : apiMessage("m4b416af03c7d"),
    }, 502);
  }
}
