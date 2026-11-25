import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { isAdminRequest } from "@/lib/admin-auth";
import { getCurrentUser } from "@/lib/server-auth";
import { normalizeMediaLibraryGroupName, normalizeMediaLibraryKind } from "@/lib/media-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const ownerId = currentUser?.id ?? -1;
    const scopeCondition =
      scope === "shared"
        ? { scope: "shared" }
        : scope === "private"
          ? { scope: "private", ownerUserId: ownerId }
          : { OR: [{ scope: "shared" }, { scope: "private", ownerUserId: ownerId }] };

    const and: any[] = [
      { isDeleted: false },
      scopeCondition,
    ];

    if (kind === "image" || kind === "video" || kind === "audio") {
      and.push({ kind: normalizeMediaLibraryKind(kind) });
    }

    const rows = await prisma.mediaLibraryItem.findMany({
      where: { AND: and },
      select: { groupName: true },
      distinct: ["groupName"],
      orderBy: { groupName: "asc" },
    });

    return NextResponse.json({
      success: true,
      viewer: {
        isAdmin,
        canUploadShared: isAdmin,
      },
      hasUngrouped: rows.some((row) => !normalizeMediaLibraryGroupName(row.groupName)),
      groups: rows
        .map((row) => normalizeMediaLibraryGroupName(row.groupName))
        .filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index),
    });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("mc8b675dc77bf")) }, { status: 500 });
  }
}
