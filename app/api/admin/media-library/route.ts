import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { isUngroupedMediaLibraryGroup, normalizeMediaLibraryGroupName, normalizeMediaLibraryKind, normalizeMediaLibraryScope } from "@/lib/media-library";
import { isAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    if (!isAdminRequest(request)) {
      return NextResponse.json({ error: apiMessage("m0cd549f59a6a") }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const kind = String(searchParams.get("kind") || "all").trim().toLowerCase();
    const q = String(searchParams.get("q") || "").trim();
    const groupName = String(searchParams.get("groupName") || "").trim();
    const all = searchParams.get("all") === "1";
    const page = Math.max(1, Math.floor(Number(searchParams.get("page") || "1")) || 1);
    const pageSizeRaw = Math.floor(Number(searchParams.get("pageSize") || "48")) || 48;

    // 用 Prisma 标准查询构造 where（跨 SQLite/PostgreSQL 通用）
    const where: any = { isDeleted: false, scope: "shared" };
    if (kind === "image" || kind === "video" || kind === "audio") {
      where.kind = normalizeMediaLibraryKind(kind);
    }
    if (isUngroupedMediaLibraryGroup(groupName)) {
      where.OR = [{ groupName: null }, { groupName: "" }];
    } else {
      const normalizedGroupName = normalizeMediaLibraryGroupName(groupName);
      if (normalizedGroupName) {
        where.groupName = normalizedGroupName;
      }
    }
    if (q) {
      where.AND = [
        {
          OR: [
            { title: { contains: q } },
            { tags: { contains: q } },
            { groupName: { contains: q } },
          ],
        },
      ];
    }

    const groupWhere: any = {
      isDeleted: false,
      scope: "shared",
      groupName: { not: null },
      NOT: { groupName: "" },
    };
    if (kind === "image" || kind === "video" || kind === "audio") {
      groupWhere.kind = normalizeMediaLibraryKind(kind);
    }
    const groupRows = await prisma.mediaLibraryItem.findMany({
      where: groupWhere,
      select: { groupName: true },
      distinct: ["groupName"],
      orderBy: { groupName: "asc" },
    });
    const total = await prisma.mediaLibraryItem.count({ where });
    const pageSize = all ? Math.max(total, 1) : Math.min(120, Math.max(12, pageSizeRaw));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = all ? 1 : Math.min(page, totalPages);
    const rows = await prisma.mediaLibraryItem.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(all ? {} : { take: pageSize, skip: (currentPage - 1) * pageSize }),
    });

    return NextResponse.json({
      success: true,
      groups: groupRows
        .map((row) => normalizeMediaLibraryGroupName(row.groupName))
        .filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index),
      pagination: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
        hasMore: currentPage * pageSize < total,
      },
      items: rows.map((row) => ({
        ...row,
        scope: normalizeMediaLibraryScope(row.scope),
        kind: normalizeMediaLibraryKind(row.kind),
        groupName: normalizeMediaLibraryGroupName(row.groupName),
        tags: (() => {
          try {
            const parsed = JSON.parse(String(row.tags || "[]"));
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })(),
        canDelete: true,
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("mec83ed29cad8")) }, { status: 500 });
  }
}
