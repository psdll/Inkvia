import { apiMessage } from "@/i18n/api-message";
import type { NextRequest } from "next/server";

import { readMonitoringConfig } from "@/lib/monitoring/config";
import {
  createLogExportToken,
  verifyLogExportToken,
} from "@/lib/monitoring/log-export";
import { normalizeLogFilter, queryLokiLogs } from "@/lib/monitoring/loki-client";
import {
  monitoringJson,
  readMonitoringJson,
  requireMonitoringPermission,
} from "@/lib/monitoring/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function signingSecret() {
  return String(process.env.ADMIN_SECRET || "");
}

function normalizeRange(from: unknown, to: unknown) {
  const fromMs = Number(from);
  const toMs = Number(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs <= 0 || toMs <= fromMs) {
    throw new Error("日志导出时间范围无效");
  }
  if (toMs - fromMs > 24 * 60 * 60 * 1_000) throw new Error("日志导出时间范围不能超过 24 小时");
  return { fromMs, toMs };
}

export async function POST(request: NextRequest) {
  const permission = requireMonitoringPermission(request, "monitoring.reports.export");
  if (!permission.ok) return monitoringJson({ error: permission.error }, permission.status);
  try {
    const body = await readMonitoringJson(request);
    const filter = normalizeLogFilter({ ...(body?.filter || {}), limit: 1_000 });
    const range = normalizeRange(body?.from, body?.to);
    const token = createLogExportToken({ filter, ...range }, signingSecret());
    return monitoringJson({
      token,
      expiresAt: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
      downloadUrl: `/api/admin/monitoring/v1/logs/export?token=${encodeURIComponent(token)}`,
    });
  } catch (error) {
    return monitoringJson({
      error: error instanceof Error ? error.message : apiMessage("m43d3a643fe23"),
    }, 400);
  }
}

export async function GET(request: NextRequest) {
  const permission = requireMonitoringPermission(request, "monitoring.reports.export");
  if (!permission.ok) return monitoringJson({ error: permission.error }, permission.status);
  let descriptor;
  try {
    descriptor = verifyLogExportToken(
      new URL(request.url).searchParams.get("token") || "",
      signingSecret(),
    );
  } catch (error) {
    return monitoringJson({
      error: error instanceof Error ? error.message : apiMessage("mcb7bee18f34a"),
    }, 400);
  }

  const config = readMonitoringConfig();
  if (!config.capabilities.centralLogs) {
    return monitoringJson({ error: apiMessage("m93b912eda72d") }, 409);
  }

  try {
    const result = await queryLokiLogs({
      endpoint: config.endpoints.loki,
      filter: descriptor.filter,
      startNanoseconds: `${Math.floor(descriptor.fromMs)}000000`,
      endNanoseconds: `${Math.floor(descriptor.toMs)}000000`,
      timeoutMs: config.requestTimeoutMs,
    });
    const content = result.entries.map((entry) => JSON.stringify(entry)).join("\n");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return new Response(content, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="inkvia-logs-${stamp}.ndjson"`,
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return monitoringJson({
      error: error instanceof Error ? error.message : apiMessage("m1c45ec852373"),
    }, 502);
  }
}
