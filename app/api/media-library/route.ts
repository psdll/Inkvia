import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/server-auth";
import { isUngroupedMediaLibraryGroup, normalizeMediaLibraryGroupName, normalizeMediaLibraryKind, normalizeMediaLibraryScope } from "@/lib/media-library";
import { isAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MEDIA_LIBRARY_PAGE_SIZE = 5000;

export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request);

    const { searchParams } = new URL(request.url);
    const isAdmin = isAdminRequest(request);
    // 共享库允许匿名查看；未登录时只放行 scope=shared，其它作用域仍需登录
    let scope = String(searchParams.get("scope") || "all").trim().toLowerCase();
    if (!currentUser) {
      if (scope !== "shared") {
        return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
      }
      scope = "shared";
    }
    const kind = String(searchParams.get("kind") || "all").trim().toLowerCase();
    const ids = String(searchParams.get("ids") || "")
      .split(",")
      .map((value) => Math.floor(Number(value)))
      .filter((value, index, values) => Number.isFinite(value) && value > 0 && values.indexOf(value) === index)
      .slice(0, 12);
    const q = String(searchParams.get("q") || "").trim();
    const groupName = String(searchParams.get("groupName") || "").trim();
    const page = Math.max(1, Math.floor(Number(searchParams.get("page") || "1")) || 1);
    const pageSizeRaw = Math.floor(Number(searchParams.get("pageSize") || "48")) || 48;
    const pageSize = Math.min(MAX_MEDIA_LIBRARY_PAGE_SIZE, Math.max(12, pageSizeRaw));

    // 作用域过滤条件（跨 SQLite/PostgreSQL 通用）
    const ownerId = currentUser?.id ?? -1;
    const scopeCondition =
      scope === "shared"
        ? { scope: "shared" }
        : scope === "private"
          ? { scope: "private", ownerUserId: ownerId }
          : { OR: [{ scope: "shared" }, { scope: "private", ownerUserId: ownerId }] };

    const and: any[] = [{ isDeleted: false }, scopeCondition];
    if (ids.length) {
      and.push({ id: { in: ids } });
    }
    if (kind === "image" || kind === "video") {
      and.push({ kind: normalizeMediaLibraryKind(kind) });
    }
    if (isUngroupedMediaLibraryGroup(groupName)) {
      and.push({ OR: [{ groupName: null }, { groupName: "" }] });
    } else {
      const normalizedGroupName = normalizeMediaLibraryGroupName(groupName);
      if (normalizedGroupName) {
        and.push({ groupName: normalizedGroupName });
      }
    }
    if (q) {
      and.push({
        OR: [
          { title: { contains: q } },
          { tags: { contains: q } },
          { groupName: { contains: q } },
        ],
      });
    }
    const where = { AND: and };

    const groupAnd: any[] = [
      { isDeleted: false },
      { groupName: { not: null } },
      { NOT: { groupName: "" } },
      scopeCondition,
    ];
    if (kind === "image" || kind === "video") {
      groupAnd.push({ kind: normalizeMediaLibraryKind(kind) });
    }
    // 分组列表与总数互不依赖，并行执行（原来是串行三次往返）
    const [groupRows, total] = await Promise.all([
      prisma.mediaLibraryItem.findMany({
        where: { AND: groupAnd },
        select: { groupName: true },
        distinct: ["groupName"],
        orderBy: { groupName: "asc" },
      }),
      prisma.mediaLibraryItem.count({ where }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    const rows = await prisma.mediaLibraryItem.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize,
      skip: (currentPage - 1) * pageSize,
    });

    return NextResponse.json({
      success: true,
      viewer: {
        isAdmin,
        canUploadShared: isAdmin,
      },
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
        canDelete: Boolean(currentUser && row.scope === "private" && row.ownerUserId === currentUser.id),
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("mb0b5cbc7a957")) }, { status: 500 });
  }
}
