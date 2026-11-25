import { apiMessage } from "@/i18n/api-message";
import type { NextRequest } from "next/server";

import { readMonitoringConfig } from "@/lib/monitoring/config";
import { normalizeLogFilter, queryLokiLogs } from "@/lib/monitoring/loki-client";
import {
  monitoringJson,
  requireMonitoringPermission,
} from "@/lib/monitoring/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const permission = requireMonitoringPermission(request, "monitoring.view");
  if (!permission.ok) return monitoringJson({ error: permission.error }, permission.status);

  const url = new URL(request.url);
  let filter;
  try {
    filter = normalizeLogFilter(Object.fromEntries(url.searchParams.entries()));
  } catch (error) {
    return monitoringJson({
      error: error instanceof Error ? error.message : apiMessage("mbf1e8b9bfdde"),
    }, 400);
  }

  const config = readMonitoringConfig();
  if (!config.capabilities.centralLogs) {
    return monitoringJson({
      apiVersion: "v1",
      supported: false,
      state: "unsupported",
      entries: [],
    });
  }

  const now = Date.now();
  const from = Number(url.searchParams.get("from") || now - 60 * 60 * 1_000);
  const to = Number(url.searchParams.get("to") || now);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= from) {
    return monitoringJson({ error: apiMessage("mee35d544da6e") }, 400);
  }
  if (to - from > 7 * 24 * 60 * 60 * 1_000) {
    return monitoringJson({ error: apiMessage("m6c92a7bb7ce3") }, 400);
  }

  try {
    const result = await queryLokiLogs({
      endpoint: config.endpoints.loki,
      filter,
      startNanoseconds: `${Math.floor(from)}000000`,
      endNanoseconds: `${Math.floor(to)}000000`,
      timeoutMs: config.requestTimeoutMs,
    });
    return monitoringJson({ apiVersion: "v1", supported: true, state: "healthy", ...result });
  } catch (error) {
    return monitoringJson({
      error: error instanceof Error ? error.message : apiMessage("me6a22287b515"),
    }, 502);
  }
}
