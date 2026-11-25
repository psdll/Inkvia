import type { NextRequest } from "next/server";

import { requireAdminRequest } from "@/lib/admin-auth";
import { hasSameRequestOrigin } from "@/lib/request-origin";

export type MonitoringPermission =
  | "monitoring.view"
  | "monitoring.alerts.manage"
  | "monitoring.reports.export"
  | "monitoring.recover.safe"
  | "monitoring.services.control"
  | "monitoring.logs.rotate"
  | "monitoring.logs.delete";

const READ_PERMISSIONS = new Set<MonitoringPermission>([
  "monitoring.view",
  "monitoring.reports.export",
]);

function operatorUsers(env: NodeJS.ProcessEnv) {
  return new Set(
    String(env.MONITORING_OPERATOR_USERS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function requireMonitoringPermission(
  request: NextRequest,
  permission: MonitoringPermission,
  env: NodeJS.ProcessEnv = process.env,
) {
  const admin = requireAdminRequest(request);
  if (!admin.ok) {
    return { ok: false as const, status: 401, error: admin.error };
  }
  if (READ_PERMISSIONS.has(permission) || operatorUsers(env).has(admin.username)) {
    return { ok: true as const, username: admin.username, permission };
  }
  return {
    ok: false as const,
    status: 403,
    error: "当前管理员没有执行此监控操作的权限",
  };
}

export function monitoringJson(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function readMonitoringJson(
  request: Request,
  maximumBytes = 32 * 1024,
) {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    throw new Error("请求内容过大");
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("请求内容不是有效 JSON");
  }
}

export function hasMonitoringSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  return hasSameRequestOrigin(request);
}
