import { apiMessage } from "@/i18n/api-message";
import type { NextRequest } from "next/server";

import { readMonitoringConfig } from "@/lib/monitoring/config";
import {
  getTraceById,
  normalizeTraceId,
} from "@/lib/monitoring/tempo-client";
import {
  monitoringJson,
  requireMonitoringPermission,
} from "@/lib/monitoring/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: { traceId: string } },
) {
  const permission = requireMonitoringPermission(request, "monitoring.view");
  if (!permission.ok) return monitoringJson({ error: permission.error }, permission.status);

  let traceId: string;
  try {
    traceId = normalizeTraceId(context.params.traceId);
  } catch (error) {
    return monitoringJson({
      error: error instanceof Error ? error.message : apiMessage("m4e3b2de97032"),
    }, 400);
  }

  const config = readMonitoringConfig();
  if (!config.capabilities.distributedTracing) {
    return monitoringJson({
      apiVersion: "v1",
      supported: false,
      state: "unsupported",
      traceId,
      spans: [],
    });
  }

  try {
    return monitoringJson({
      apiVersion: "v1",
      supported: true,
      state: "healthy",
      ...(await getTraceById({
        endpoint: config.endpoints.tempo,
        traceId,
        timeoutMs: config.requestTimeoutMs,
      })),
    });
  } catch (error) {
    return monitoringJson({
      error: error instanceof Error ? error.message : apiMessage("m62e911909c5f"),
    }, 502);
  }
}
