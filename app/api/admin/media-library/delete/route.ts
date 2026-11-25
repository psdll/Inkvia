import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import { Logger } from "@/lib/logger";
import { deleteStoredMediaRefs } from "@/lib/media-cleanup";import { isUngroupedMediaLibraryGroup, normalizeMediaLibraryGroupName, normalizeMediaLibraryKind } from "@/lib/media-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DeleteMode = "ids" | "group" | "filtered";

type DeleteBody = {
  mode?: DeleteMode;
  ids?: number[];
  groupName?: string | null;
  kind?: "all" | "image" | "video" | "audio";
  q?: string;
};

type MediaRow = {
  id: number;
  title: string;
  fileUrl: string;
  thumbnailUrl: string | null;
};

// 构造 Prisma where（跨 SQLite/PostgreSQL 通用）
function buildWhere(body: DeleteBody): any {
  const where: any = { isDeleted: false, scope: "shared" };
  const mode = body.mode;

  if (mode === "ids") {
    const ids = Array.isArray(body.ids)
      ? Array.from(new Set(body.ids.map((id) => Math.floor(Number(id))).filter((id) => Number.isFinite(id) && id > 0)))
      : [];
    if (!ids.length) {
      throw new Error("请选择要删除的素材");
    }
    where.id = { in: ids };
    return where;
  }

  const kind = String(body.kind || "all").trim().toLowerCase();
  if (kind === "image" || kind === "video" || kind === "audio") {
    where.kind = normalizeMediaLibraryKind(kind);
  }

  const groupName = String(body.groupName || "").trim();
  if (mode === "group") {
    if (isUngroupedMediaLibraryGroup(groupName)) {
      where.OR = [{ groupName: null }, { groupName: "" }];
    } else {
      const normalizedGroup = normalizeMediaLibraryGroupName(groupName);
      if (!normalizedGroup) {
        throw new Error("分组名称不能为空");
      }
      where.groupName = normalizedGroup;
    }
  } else if (mode === "filtered") {
    if (isUngroupedMediaLibraryGroup(groupName)) {
      where.OR = [{ groupName: null }, { groupName: "" }];
    } else {
      const normalizedGroup = normalizeMediaLibraryGroupName(groupName);
      if (normalizedGroup) {
        where.groupName = normalizedGroup;
      }
    }

    const q = String(body.q || "").trim();
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
  } else {
    throw new Error("删除模式无效");
  }

  return where;
}

export async function POST(request: NextRequest) {
  try {
    const auth = requireAdminRequest(request);
    if (!auth.ok) {
      return NextResponse.json({ error: apiErrorMessage(auth.error || apiMessage("m5d0620e6080d")) }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as DeleteBody | null;
    const mode = body?.mode;
    if (mode !== "ids" && mode !== "group" && mode !== "filtered") {
      return NextResponse.json({ error: apiMessage("mfa91d52633f0") }, { status: 400 });
    }

    const where = buildWhere(body || {});
    const rows: MediaRow[] = await prisma.mediaLibraryItem.findMany({
      where,
      select: { id: true, title: true, fileUrl: true, thumbnailUrl: true },
    });

    if (!rows.length) {
      return NextResponse.json({ error: apiMessage("mdab7fffcb6e2") }, { status: 404 });
    }

    const ids = rows.map((row) => row.id);
    await prisma.mediaLibraryItem.updateMany({
      where: { id: { in: ids } },
      data: { isDeleted: true },
    });
    let deletedLocalFiles = 0;
    let cleanupWarning: string | null = null;
    try {
      const deleted = await deleteStoredMediaRefs(rows.flatMap((row) => [row.fileUrl, row.thumbnailUrl]), {
        allowMaterialDeletion: true,
        excludeMediaLibraryItemIds: ids,
      });
      deletedLocalFiles = deleted.deletedLocalFiles;
    } catch (error: any) {
      cleanupWarning = error?.message || "素材文件清理失败，请稍后重试";
    }

    await Logger.log({
      userId: "system",
      category: "user_action",
      action: "delete_output",
      level: "info",
      message: "管理员删除共享素材",
      metadata: {
        sourcePage: "/admin/materials",
        admin: auth.username,
        mode,
        count: rows.length,
        ids: ids.slice(0, 50)
      }
    });

    return NextResponse.json({
      success: true,
      count: rows.length,
      ids,
      titles: rows.slice(0, 10).map((row) => row.title || `素材 #${row.id}`),
      deletedLocalFiles,
      cleanupWarning,
    });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("m2e32ff1af747")) }, { status: 500 });
  }
}
