import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import {
  isUncategorizedMaterialAssetCategory,
  normalizeMaterialAssetCategory,
  parseStoredMaterialAssetTags,
} from "@/lib/material-assets";
import {
  listMaterialAssetOptionValues,
  normalizeMaterialAssetOptionValue,
} from "@/lib/material-asset-options";
import { deleteStoredMediaRefs } from "@/lib/media-cleanup";
import { materialAssetAllMediaRefs } from "@/lib/material-asset-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serializeAsset(asset: any) {
  return {
    id: asset.id,
    category: normalizeMaterialAssetCategory(asset.category),
    title: asset.title,
    imageUrl: asset.imageUrl,
    thumbnailUrl: asset.thumbnailUrl || null,
    previewUrl: asset.previewUrl || null,
    mimeType: asset.mimeType || null,
    sizeBytes: asset.sizeBytes || 0,
    mediaCount: Math.max(1, Number(asset.mediaCount || 1)),
    selectedMediaId: asset.selectedMediaId || null,
    tags: parseStoredMaterialAssetTags(asset.tags),
    creatorName: asset.creatorName || null,
    modelName: asset.modelName || null,
    inspiration: asset.inspiration || null,
    createdAt: asset.createdAt.toISOString(),
    selectedBy: asset.selectedByUser
      ? {
          id: asset.selectedByUser.id,
          username: asset.selectedByUser.username,
          selectedAt: asset.selectedAt?.toISOString() || null,
          selectedMediaId: asset.selectedMediaId || null,
        }
      : null,
    isSelected: Boolean(asset.selectedByUserId),
    downloadCount: asset._count?.downloads || 0,
    recentDownloads: (asset.downloads || []).map((download: any) => ({
      id: download.id,
      userId: download.userId,
      username: download.username,
      downloadedAt: download.downloadedAt.toISOString(),
    })),
  };
}

type AdminMaterialFilterInput = {
  category?: string;
  creator?: string;
  modelName?: string;
  status?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
};

const naturalCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function buildModelGroups(rows: Array<{ category: string | null; modelName: string | null }>) {
  const byCategory = new Map<string, Set<string>>();
  for (const row of rows) {
    const category = normalizeMaterialAssetCategory(row.category);
    const modelName = normalizeMaterialAssetOptionValue("model", row.modelName);
    if (!category || !modelName) continue;
    const models = byCategory.get(category) || new Set<string>();
    models.add(modelName);
    byCategory.set(category, models);
  }
  return Array.from(byCategory.entries())
    .sort(([left], [right]) => naturalCollator.compare(left, right))
    .map(([category, models]) => ({
      category,
      models: Array.from(models).sort(naturalCollator.compare),
    }));
}

function buildMaterialAssetWhere(input: AdminMaterialFilterInput) {
  const category = String(input.category || "").trim();
  const creator = String(input.creator || "").trim();
  const modelName = normalizeMaterialAssetOptionValue("model", input.modelName);
  const status = String(input.status || "all").trim().toLowerCase();
  const q = String(input.q || "").trim();
  const and: any[] = [{ isDeleted: false }];

  if (modelName) and.push({ modelName });

  // 按上传时间(createdAt)筛选：前端传 ISO 边界(本地时区起止已换算好)，这里直接比较
  const createdAt: { gte?: Date; lte?: Date } = {};
  const fromDate = input.dateFrom ? new Date(input.dateFrom) : null;
  const toDate = input.dateTo ? new Date(input.dateTo) : null;
  if (fromDate && !Number.isNaN(fromDate.getTime())) createdAt.gte = fromDate;
  if (toDate && !Number.isNaN(toDate.getTime())) createdAt.lte = toDate;
  if (createdAt.gte || createdAt.lte) and.push({ createdAt });

  if (isUncategorizedMaterialAssetCategory(category)) {
    and.push({ OR: [{ category: null }, { category: "" }] });
  } else {
    const normalizedCategory = normalizeMaterialAssetCategory(category);
    if (normalizedCategory) and.push({ category: normalizedCategory });
  }
  if (creator === "__unsigned__") {
    and.push({ OR: [{ creatorName: null }, { creatorName: "" }] });
  } else if (creator) {
    and.push({ creatorName: creator });
  }
  if (status === "available") and.push({ selectedByUserId: null });
  else if (status === "selected") and.push({ selectedByUserId: { not: null } });
  if (q) {
    and.push({
      OR: [
        { title: { contains: q } },
        { tags: { contains: q } },
        { category: { contains: q } },
        { creatorName: { contains: q } },
        { modelName: { contains: q } },
      ],
    });
  }

  return { AND: and };
}

export async function GET(request: NextRequest) {
  try {
    const admin = requireAdminRequest(request);
    if (!admin.ok) {
      return NextResponse.json({ error: apiErrorMessage(admin.error || apiMessage("m6eb5dc119e84")) }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const category = String(searchParams.get("category") || "").trim();
    const creator = String(searchParams.get("creator") || "").trim();
    const modelName = String(searchParams.get("modelName") || "").trim();
    const status = String(searchParams.get("status") || "all").trim().toLowerCase();
    const q = String(searchParams.get("q") || "").trim();
    const dateFrom = String(searchParams.get("dateFrom") || "").trim();
    const dateTo = String(searchParams.get("dateTo") || "").trim();
    const idsOnly = searchParams.get("idsOnly") === "1";
    const includeOptions = searchParams.get("includeOptions") !== "0";
    const page = Math.max(1, Math.floor(Number(searchParams.get("page") || "1")) || 1);
    const pageSizeRaw = Math.floor(Number(searchParams.get("pageSize") || "72")) || 72;
    const pageSize = Math.min(160, Math.max(12, pageSizeRaw));

    const where = buildMaterialAssetWhere({ category, creator, modelName, status, q, dateFrom, dateTo });
    if (idsOnly) {
      const rows = await prisma.materialAsset.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      return NextResponse.json({ success: true, ids: rows.map((row) => row.id) });
    }

    const [total, rows, optionValues, modelRows, uncategorizedCount] = await Promise.all([
      prisma.materialAsset.count({ where }),
      prisma.materialAsset.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }, { id: "desc" }],
        take: pageSize,
        skip: (page - 1) * pageSize,
        include: {
          selectedByUser: { select: { id: true, username: true } },
          downloads: {
            orderBy: { downloadedAt: "desc" },
            take: 8,
            select: { id: true, userId: true, username: true, downloadedAt: true },
          },
          _count: { select: { downloads: true } },
        },
      }),
      includeOptions ? listMaterialAssetOptionValues() : Promise.resolve(null),
      includeOptions
        ? prisma.materialAsset.groupBy({
            by: ["category", "modelName"],
            where: { isDeleted: false, category: { not: null }, NOT: { category: "" } },
          })
        : Promise.resolve([]),
      includeOptions
        ? prisma.materialAsset.count({
            where: { isDeleted: false, OR: [{ category: null }, { category: "" }] },
          })
        : Promise.resolve(null),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      success: true,
      ...(optionValues
        ? {
            categories: optionValues.category,
            creators: optionValues.creator,
            models: optionValues.model,
            modelGroups: buildModelGroups(modelRows),
            hasUncategorized: Number(uncategorizedCount) > 0,
          }
        : {}),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasMore: page * pageSize < total,
      },
      items: rows.map(serializeAsset),
    });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("md80b5b46caeb")) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const admin = requireAdminRequest(request);
    if (!admin.ok) {
      return NextResponse.json({ error: apiErrorMessage(admin.error || apiMessage("mcf514a871564")) }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      ids?: unknown;
      scope?: string;
      category?: string;
      creator?: string;
      modelName?: string;
      status?: string;
      q?: string;
      dateFrom?: string;
      dateTo?: string;
    };
    const ids = Array.isArray(body.ids)
      ? Array.from(
          new Set(
            body.ids
              .map((id) => Math.floor(Number(id)))
              .filter((id) => Number.isFinite(id) && id > 0)
          )
        )
      : [];
    if (!ids.length && body.scope !== "filtered") {
      return NextResponse.json({ error: apiMessage("mf3cbdd1f02b2") }, { status: 400 });
    }
    const where = ids.length
      ? { id: { in: ids }, isDeleted: false }
      : buildMaterialAssetWhere({
          category: body.category,
          creator: body.creator,
          modelName: body.modelName,
          status: body.status,
          q: body.q,
          dateFrom: body.dateFrom,
          dateTo: body.dateTo,
        });

    const rows = await prisma.materialAsset.findMany({ where });
    if (!rows.length) {
      return NextResponse.json({ success: true, count: 0 });
    }

    const deleteIds = rows.map((row) => row.id);
    const result = await prisma.materialAsset.updateMany({
      where: { id: { in: deleteIds }, isDeleted: false },
      data: {
        isDeleted: true,
        selectedByUserId: null,
        selectedAt: null,
        selectedMediaId: null,
      },
    });

    let cleanup = {
      deletedLocalFiles: 0,
      deletedOssObjects: 0,
      skippedProtectedRefsCount: 0,
      skippedProtectedRefsPreview: [] as string[],
      ossError: null as string | null,
    };
    let cleanupWarning: string | null = null;
    try {
      cleanup = await deleteStoredMediaRefs(rows.flatMap(materialAssetAllMediaRefs), {
        allowMaterialDeletion: true,
        excludeMaterialAssetIds: deleteIds,
      });
    } catch (error: any) {
      cleanupWarning = error?.message || "素材文件清理失败，请稍后重试";
    }

    return NextResponse.json({
      success: true,
      count: result.count,
      deletedLocalFiles: cleanup.deletedLocalFiles,
      deletedOssObjects: cleanup.deletedOssObjects,
      skippedProtectedRefsCount: cleanup.skippedProtectedRefsCount,
      skippedProtectedRefsPreview: cleanup.skippedProtectedRefsPreview,
      ossError: cleanup.ossError,
      cleanupWarning,
    });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("m0f4bfe09a9e0")) }, { status: 500 });
  }
}
