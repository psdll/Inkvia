import { apiMessage } from "@/i18n/api-message";
import type { NextRequest } from "next/server";

import { readMonitoringConfig } from "@/lib/monitoring/config";
import {
  isMetricQueryKey,
  queryPrometheusRange,
} from "@/lib/monitoring/prometheus-client";
import {
  monitoringJson,
  requireMonitoringPermission,
} from "@/lib/monitoring/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function numberParam(value: string | null, fallback: number) {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("监控时间参数无效");
  return parsed;
}

export async function GET(request: NextRequest) {
  const permission = requireMonitoringPermission(request, "monitoring.view");
  if (!permission.ok) return monitoringJson({ error: permission.error }, permission.status);

  const url = new URL(request.url);
  if (url.searchParams.has("query")) {
    return monitoringJson({ error: apiMessage("m1e5aaff22ef5") }, 400);
  }
  const key = url.searchParams.get("key") || "";
  if (!isMetricQueryKey(key)) return monitoringJson({ error: apiMessage("m0a2361052c53") }, 400);

  const config = readMonitoringConfig();
  if (!config.capabilities.metricsHistory) {
    return monitoringJson({
      apiVersion: "v1",
      supported: false,
      state: "unsupported",
      key,
      series: [],
    });
  }

  try {
    const nowSeconds = Date.now() / 1_000;
    const end = numberParam(url.searchParams.get("to"), nowSeconds);
    const start = numberParam(url.searchParams.get("from"), end - 60 * 60);
    const stepSeconds = numberParam(url.searchParams.get("step"), 60);
    const result = await queryPrometheusRange({
      endpoint: config.endpoints.prometheus,
      key,
      start,
      end,
      stepSeconds,
      timeoutMs: config.requestTimeoutMs,
    });
    return monitoringJson({ apiVersion: "v1", supported: true, state: "healthy", ...result });
  } catch (error) {
    return monitoringJson({
      error: error instanceof Error ? error.message : apiMessage("m7c3899efd71b"),
    }, 400);
  }
}
