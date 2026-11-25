import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
﻿import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseMetadataSafe(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw, _invalidJson: true };
  }
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
  createdAt: true,
} as const;

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * GET /api/admin/logs - 管理员查看全量日志（含 system / admin 操作日志）。
 * 查询参数：scope(=admin 仅看管理员操作)、category、level、action、userId、q、startDate、endDate、page、limit。
 */
export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return NextResponse.json({ success: false, error: apiErrorMessage(auth.error || apiMessage("m0d4b7413617a")) }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const scope = String(searchParams.get("scope") || "").trim();
    const category = String(searchParams.get("category") || "").trim();
    const level = String(searchParams.get("level") || "").trim();
    const action = String(searchParams.get("action") || "").trim();
    const userId = String(searchParams.get("userId") || "").trim();
    const q = String(searchParams.get("q") || "").trim();
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const page = clampInt(searchParams.get("page"), 1, 1, 100000);
    const limit = clampInt(searchParams.get("limit"), 50, 1, 200);

    const where: any = {};
    // scope=admin：只看管理员/系统操作日志（删除用户、清理数据、删除资产等审计记录）
    if (scope === "admin") {
      where.category = "admin";
    } else if (category) {
      where.category = category;
    }
    if (level) where.level = level;
    if (action) where.action = action;
    if (userId) where.userId = userId;
    if (q) {
      where.OR = [
        { message: { contains: q } },
        { action: { contains: q } },
        { metadata: { contains: q } },
        { userId: { contains: q } },
      ];
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      prisma.log.findMany({ where, select: LOG_SELECT, orderBy: { createdAt: "desc" }, take: limit, skip }),
      prisma.log.count({ where }),
    ]);

    const parsed = logs.map((log) => ({ ...log, metadata: parseMetadataSafe(log.metadata) }));

    // 兜底：旧日志 metadata 里没存用户名时，按 authUserId 批量补一次（账号还在才查得到）
    const needAuthIds = new Set<number>();
    for (const row of parsed) {
      const meta: any = row.metadata;
      if (meta && !meta.username && Number.isFinite(Number(meta.authUserId))) {
        needAuthIds.add(Number(meta.authUserId));
      }
    }
    const nameById = new Map<number, string>();
    if (needAuthIds.size) {
      const users = await prisma.user
        .findMany({ where: { id: { in: Array.from(needAuthIds) } }, select: { id: true, username: true } })
        .catch(() => [] as Array<{ id: number; username: string }>);
      for (const u of users) nameById.set(u.id, u.username);
    }

    const data = parsed.map((row) => {
      const meta: any = row.metadata || {};
      const targetUsername =
        meta.username || (Number.isFinite(Number(meta.authUserId)) ? nameById.get(Number(meta.authUserId)) || null : null);
      const actor = meta.by || (row.userId === "system" ? "系统" : row.userId);
      return { ...row, targetUsername, actor };
    });

    return NextResponse.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: apiErrorMessage(error?.message || apiMessage("m9930964adb0e")) }, { status: 500 });
  }
}
