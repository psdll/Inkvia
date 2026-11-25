import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { pruneLogsIfNeeded } from "@/lib/log-retention";
import { getUserId } from "@/lib/server-auth";
import { isAdminRequest } from "@/lib/admin-auth";
import { desktopApiLogScope, isDesktopApiLogView } from "@/lib/desktop-api-log-scope";

export const dynamic = "force-dynamic";

function isHiddenFromUserColumnMissing(error: any) {
  const message = String(error?.message || "").toLowerCase();
  const column = String(error?.meta?.column || "").toLowerCase();
  return (
    (error?.code === "P2022" && column.includes("hiddenfromuser")) ||
    (message.includes("hiddenfromuser") && message.includes("does not exist"))
  );
}

/**
 * GET /api/logs/stats - 获取日志统计信息
 */
export async function GET(request: NextRequest) {
  try {
    const authUserId = await getUserId(request);
    if (!authUserId) {
      return NextResponse.json({
        success: true,
        data: {
          totalLogs: 0,
          errorLogs: 0,
          categoryStats: {},
          levelStats: {},
          generationTaskCount: 0,
          recentFailedGenerations: [],
          timeRange: null,
        },
      });
    }
    await pruneLogsIfNeeded();
    const { searchParams } = new URL(request.url);
    const desktopApiView = isDesktopApiLogView(searchParams);
    if (desktopApiView && !isAdminRequest(request)) return NextResponse.json({ success: false, error: apiMessage("m0d4b7413617a") }, { status: 403 });
    const daysParam = (searchParams.get("days") || "").trim().toLowerCase();
    const parsedDays = Number.parseInt(daysParam, 10);
    const hasDateRange = daysParam !== "" && daysParam !== "all" && Number.isFinite(parsedDays) && parsedDays > 0;

    const startDate = hasDateRange ? new Date() : null;
    if (startDate) startDate.setDate(startDate.getDate() - parsedDays);

    const where: any = {
      hiddenFromUser: false,
    };
    if (startDate) where.createdAt = { gte: startDate };
    
    if (desktopApiView) where.AND = [desktopApiLogScope(authUserId)];
    else where.userId = String(authUserId);
    const generationWhere: any = {
      OR: [
        { authUserId },
        { userId: String(authUserId) },
      ],
    };
    if (startDate) generationWhere.createdAt = { gte: startDate };

    const queryStats = async (qWhere: any) => {
      return Promise.all([
        prisma.log.count({ where: qWhere }),
        prisma.log.groupBy({
          by: ["category"],
          where: qWhere,
          _count: true,
        }),
        prisma.log.groupBy({
          by: ["level"],
          where: qWhere,
          _count: true,
        }),
        prisma.log.count({
          where: {
            ...qWhere,
            level: "error",
          },
        }),
        prisma.log.findMany({
          where: {
            ...qWhere,
            category: "generation",
            level: "error",
          },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            action: true,
            message: true,
            generationId: true,
            createdAt: true,
          },
        }),
      ]);
    };

    let totalLogs = 0;
    let byCategory: Array<{ category: string; _count: number }> = [];
    let byLevel: Array<{ level: string; _count: number }> = [];
    let errorLogs = 0;
    let recentFailedGenerations: Array<{
      id: number;
      action: string;
      message: string;
      generationId: number | null;
      createdAt: Date;
    }> = [];
    const generationTaskCount = await prisma.generation.count({ where: generationWhere });

    try {
      [totalLogs, byCategory, byLevel, errorLogs, recentFailedGenerations] = await queryStats(where);
    } catch (e: any) {
      if (!isHiddenFromUserColumnMissing(e)) throw e;
      const fallbackWhere = { ...where } as any;
      delete fallbackWhere.hiddenFromUser;
      [totalLogs, byCategory, byLevel, errorLogs, recentFailedGenerations] = await queryStats(fallbackWhere);
    }

    const categoryStats = byCategory.reduce((acc, item) => {
      acc[item.category] = item._count;
      return acc;
    }, {} as Record<string, number>);

    const levelStats = byLevel.reduce((acc, item) => {
      acc[item.level] = item._count;
      return acc;
    }, {} as Record<string, number>);

    return NextResponse.json({
      success: true,
      data: {
        totalLogs,
        errorLogs,
        categoryStats,
        levelStats,
        generationTaskCount,
        recentFailedGenerations,
        timeRange: {
          days: hasDateRange ? parsedDays : null,
          startDate: startDate ? startDate.toISOString() : null,
          endDate: new Date().toISOString(),
        },
      },
    });
  } catch (error: any) {
    console.error("[API] Failed to fetch log stats:", error);
    return NextResponse.json(
      { success: false, error: apiErrorMessage(error?.message || apiMessage("me0eec9099b86")) },
      { status: 500 }
    );
  }
}
