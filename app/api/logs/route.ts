import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { pruneLogsIfNeeded } from "@/lib/log-retention";
import { getCurrentUser, getUserId } from "@/lib/server-auth";
import { isAdminRequest } from "@/lib/admin-auth";
import { desktopApiLogScope, isDesktopApiLogView } from "@/lib/desktop-api-log-scope";

export const dynamic = "force-dynamic";

function parseMetadataSafe(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw, _invalidJson: true };
  }
}

function isHiddenFromUserColumnMissing(error: any) {
  const message = String(error?.message || "").toLowerCase();
  const column = String(error?.meta?.column || "").toLowerCase();
  return (
    (error?.code === "P2022" && column.includes("hiddenfromuser")) ||
    (message.includes("hiddenfromuser") && message.includes("does not exist"))
  );
}

const LOG_SELECT = {
  id: true,
  userId: true,
  category: true,
  action: true,
  level: true,
  message: true,
  metadata: true,
  ip: true,
  userAgent: true,
  duration: true,
  generationId: true,
  createdAt: true
} as const;

/**
 * GET /api/logs - 获取日志列表
 * 查询参数:
 * - category: 日志分类筛选
 * - level: 日志级别筛选
 * - action: 操作类型筛选
 * - userId: 用户ID筛选
 * - startDate: 开始日期
 * - endDate: 结束日期
 * - page: 页码 (默认 1)
 * - limit: 每页数量 (默认 50)
 */
export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 1 },
      });
    }
    const authUserId = currentUser.id;
    await pruneLogsIfNeeded();
    const { searchParams } = new URL(request.url);
    const desktopApiView = isDesktopApiLogView(searchParams);
    if (desktopApiView && !isAdminRequest(request)) return NextResponse.json({ success: false, error: apiMessage("m0d4b7413617a") }, { status: 403 });
    
    const category = searchParams.get("category");
    const level = searchParams.get("level");
    const action = searchParams.get("action");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");

    const excludeCategory = searchParams.get("excludeCategory");

    const where: any = {};
    
    if (category) where.category = category;
    if (excludeCategory) where.category = { not: excludeCategory };
    if (level) where.level = level;
    if (action) where.action = action;
    if (desktopApiView) where.AND = [desktopApiLogScope(authUserId)];
    else where.userId = String(authUserId);
    where.hiddenFromUser = false;
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    let logs: any[] = [];
    let total = 0;
    try {
      [logs, total] = await Promise.all([
        prisma.log.findMany({
          where,
          select: LOG_SELECT,
          orderBy: { createdAt: "desc" },
          take: limit,
          skip,
        }),
        prisma.log.count({ where }),
      ]);
    } catch (e: any) {
      if (!isHiddenFromUserColumnMissing(e)) throw e;
      const fallbackWhere = { ...where } as any;
      delete fallbackWhere.hiddenFromUser;
      [logs, total] = await Promise.all([
        prisma.log.findMany({
          where: fallbackWhere,
          select: LOG_SELECT,
          orderBy: { createdAt: "desc" },
          take: limit,
          skip,
        }),
        prisma.log.count({ where: fallbackWhere }),
      ]);
    }

    // 解析 metadata JSON
    const logsWithParsedMetadata = logs.map((log) => ({
      ...log,
      username: currentUser.username || null,
      metadata: parseMetadataSafe(log.metadata),
    }));

    let data = logsWithParsedMetadata;
    if (desktopApiView) {
      const entries = logsWithParsedMetadata.map(log => {
        const id = Number(log.generationId ?? log.metadata?.generationId);
        return { log, taskId: Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null };
      });
      const ids = [...new Set(entries.flatMap(({ taskId }) => taskId === null ? [] : [taskId]))];
      const tasks = ids.length ? await prisma.generation.findMany({
        where: { id: { in: ids }, OR: [{ authUserId }, { userId: String(authUserId) }] },
        select: { id: true, type: true, externalProvider: true, model: true, status: true, errorMsg: true },
      }).catch(() => []) : [];
      const byId = new Map(tasks.map(task => [task.id, task]));
      data = entries.map(({ log, taskId }) => ({ ...log, task: taskId === null ? null : byId.get(taskId) ?? null }));
    }

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error("[API] Failed to fetch logs:", error);
    return NextResponse.json(
      { success: false, error: apiErrorMessage(error?.message || apiMessage("m9930964adb0e")) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/logs - 清空日志
 * 查询参数:
 * - before: 删除此日期之前的日志 (ISO string)
 * - category: 仅删除指定分类的日志
 */
export async function DELETE(request: NextRequest) {
  try {
    const authUserId = await getUserId(request);
    if (!authUserId) {
      return NextResponse.json({ success: true, message: "未登录，无需清理", deletedCount: 0 });
    }
    const { searchParams } = new URL(request.url);
    const desktopApiView = isDesktopApiLogView(searchParams);
    if (desktopApiView && !isAdminRequest(request)) return NextResponse.json({ success: false, error: apiMessage("m0c5b9cb461d2") }, { status: 403 });
    
    const before = searchParams.get("before");
    const category = searchParams.get("category");
    const level = searchParams.get("level");
    const action = searchParams.get("action");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const where: any = {};
    if (desktopApiView) where.AND = [desktopApiLogScope(authUserId)];
    else where.userId = String(authUserId);
    
    if (before) {
      where.createdAt = { lt: new Date(before) };
    }

    if (startDate || endDate) {
      where.createdAt = {
        ...(where.createdAt || {}),
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate) } : {})
      };
    }
    
    if (category) {
      where.category = category;
    }
    if (level) where.level = level;
    if (action) where.action = action;

    let result: { count: number };
    try {
      result = await (prisma.log as any).updateMany({
        where: { ...where, hiddenFromUser: false },
        data: { hiddenFromUser: true }
      });
    } catch (e: any) {
      if (!isHiddenFromUserColumnMissing(e)) throw e;
      result = await prisma.log.deleteMany({ where });
    }

    return NextResponse.json({
      success: true,
      message: `已清空 ${result.count} 条日志（仅用户侧隐藏，管理员可见）`,
      deletedCount: result.count,
    });
  } catch (error: any) {
    console.error("[API] Failed to delete logs:", error);
    return NextResponse.json(
      { success: false, error: apiErrorMessage(error?.message || apiMessage("md3c3c885138c")) },
      { status: 500 }
    );
  }
}
