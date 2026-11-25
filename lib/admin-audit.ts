import prisma from "@/lib/prisma";

type AdminAuditLevel = "info" | "warning" | "error" | "success";

/**
 * 记录管理员账号管理类操作（添加/删除用户、重置密码）的审计日志。
 * 写入 category="admin"、userId="system"，出现在后台「操作日志」面板。
 * 仅用于"重大事件"——其他配置/上传/删除类操作不记录，避免日志表膨胀拖慢面板。
 */
export async function logAdminAction(params: {
  admin?: string | null;
  action: string;
  message: string;
  level?: AdminAuditLevel;
  metadata?: Record<string, any>;
  req?: { headers?: { get(name: string): string | null } } | null;
}) {
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = params.req?.headers;
    if (h?.get) {
      ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || null;
      userAgent = h.get("user-agent") || null;
    }
  } catch {}

  await prisma.log
    .create({
      data: {
        userId: "system",
        category: "admin",
        action: params.action,
        level: params.level || "info",
        message: params.message,
        ip,
        userAgent,
        metadata: JSON.stringify({ ...(params.metadata || {}), by: params.admin || "admin" }),
      },
    })
    .catch(() => null);
}
