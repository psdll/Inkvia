import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import prisma from "@/lib/prisma";
import { normalizeMediaUrl } from "@/lib/media-url";
import { resolvePublicPath } from "@/lib/public-path";
import { getCurrentUser } from "@/lib/server-auth";
import {
  isUncategorizedMaterialAssetCategory,
  normalizeMaterialAssetCategory,
  parseStoredMaterialAssetTags,
} from "@/lib/material-assets";
import { normalizeMaterialStatus } from "@/lib/material-status";
import { parseMaterialAssetMedia } from "@/lib/material-asset-media";
import { isMaterialCreatorInspirationEnabled } from "@/lib/material-creator-permissions";
import { normalizeMaterialAssetOptionValue } from "@/lib/material-asset-options";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImageDimensions = {
  width: number | null;
  height: number | null;
};

const localImageDimensionsCache = new Map<string, ImageDimensions>();
const countReads = new Map<string, Promise<number[]>>();

// Share concurrent reads only. Include every permission/filter condition in the key,
// and discard completed reads so a selection or upload is visible on the next refresh.
async function readMaterialCounts(filters: any[]) {
  const key = JSON.stringify(filters);
  let pending = countReads.get(key);
  if (!pending) {
    pending = Promise.all(filters.map(where => prisma.materialAsset.count({ where })));
    countReads.set(key, pending);
  }
  try { return await pending; } finally {
    if (countReads.get(key) === pending) countReads.delete(key);
  }
}

function resolveLocalUploadPath(raw: unknown) {
  const url = normalizeMediaUrl(raw);
  if (!url.startsWith("/uploads/")) return null;
  const pathname = url.split("?")[0]?.split("#")[0] || "";
  const uploadsRoot = path.resolve(resolvePublicPath("uploads"));
  const relative = decodeURIComponent(pathname.replace(/^\/uploads\//, ""));
  const filePath = path.resolve(uploadsRoot, relative);
  return filePath.startsWith(uploadsRoot + path.sep) ? filePath : null;
}

async function readLocalImageDimensions(
  raw: unknown,
): Promise<ImageDimensions> {
  const filePath = resolveLocalUploadPath(raw);
  if (!filePath) return { width: null, height: null };
  const cached = localImageDimensionsCache.get(filePath);
  if (cached) return cached;

  try {
    await fs.access(filePath);
    const meta = await sharp(filePath, { animated: false }).metadata();
    const dimensions = {
      width: Number(meta.width) > 0 ? Number(meta.width) : null,
      height: Number(meta.height) > 0 ? Number(meta.height) : null,
    };
    localImageDimensionsCache.set(filePath, dimensions);
    return dimensions;
  } catch {
    const empty = { width: null, height: null };
    localImageDimensionsCache.set(filePath, empty);
    return empty;
  }
}

async function serializeAsset(asset: any, currentUserId: number | null) {
  const mediaItems = parseMaterialAssetMedia(asset.media, asset);
  const cover = mediaItems[0];
  const dimensions = cover?.width && cover?.height
    ? { width: cover.width, height: cover.height }
    : await readLocalImageDimensions(asset.previewUrl || asset.thumbnailUrl || asset.imageUrl);
  return {
    id: asset.id,
    category: normalizeMaterialAssetCategory(asset.category),
    title: asset.title,
    imageUrl: asset.imageUrl,
    thumbnailUrl: asset.thumbnailUrl || null,
    previewUrl: asset.previewUrl || null,
    previewWidth: dimensions.width,
    previewHeight: dimensions.height,
    mimeType: asset.mimeType || null,
    sizeBytes: asset.sizeBytes || 0,
    mediaCount: Math.max(1, Number(asset.mediaCount || mediaItems.length || 1)),
    selectedMediaId: asset.selectedMediaId || null,
    mediaItems,
    tags: parseStoredMaterialAssetTags(asset.tags),
    creatorName: asset.creatorName || null,
    inspiration: asset.inspiration || null,
    createdAt: asset.createdAt.toISOString(),
    listedAt: asset.listedAt?.toISOString() || asset.createdAt.toISOString(),
    selectedBy: asset.selectedByUser
      ? {
          id: asset.selectedByUser.id,
          username: asset.selectedByUser.username,
          selectedAt: asset.selectedAt?.toISOString() || null,
          selectedMediaId: asset.selectedMediaId || null,
        }
      : null,
    isSelected: Boolean(asset.selectedByUserId),
    isSelectedByMe: asset.selectedByUserId === currentUserId,
    downloadCount: asset._count?.downloads || 0,
    recentDownloads: (asset.downloads || []).map((download: any) => ({
      id: download.id,
      userId: download.userId,
      username: download.username,
      downloadedAt: download.downloadedAt.toISOString(),
    })),
  };
}

export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser(request);

    const { searchParams } = new URL(request.url);
    const category = String(searchParams.get("category") || "").trim();
    const status = normalizeMaterialStatus(searchParams.get("status")?.trim().toLowerCase() || null, "all");
    const q = String(searchParams.get("q") || "").trim();
    const dateFrom = String(searchParams.get("dateFrom") || "").trim();
    const dateTo = String(searchParams.get("dateTo") || "").trim();
    const mediaKind = String(searchParams.get("mediaKind") || "all")
      .trim()
      .toLowerCase();
    const modelName = normalizeMaterialAssetOptionValue(
      "model",
      searchParams.get("modelName"),
    );
    // mine=1：只看"我制作的"素材（制作人名字 == 当前登录用户名，精确匹配）
    const mine = searchParams.get("mine") === "1";
    const page = Math.max(
      1,
      Math.floor(Number(searchParams.get("page") || "1")) || 1,
    );
    const pageSizeRaw =
      Math.floor(Number(searchParams.get("pageSize") || "60")) || 60;
    const pageSize = Math.min(120, Math.max(12, pageSizeRaw));

    const scopeAnd: any[] = [{ isDeleted: false }];
    if (modelName) scopeAnd.push({ modelName });
    if (mine) {
      // 灵感权限绑"名字"：制作人名字 == 当前用户名才算"我的"；未登录则看不到任何
      if (
        currentUser &&
        (await isMaterialCreatorInspirationEnabled(currentUser.username))
      ) {
        scopeAnd.push({ creatorName: { equals: currentUser.username } });
      } else {
        scopeAnd.push({ id: -1 });
      }
    }
    if (isUncategorizedMaterialAssetCategory(category)) {
      scopeAnd.push({ OR: [{ category: null }, { category: "" }] });
    } else {
      const normalizedCategory = normalizeMaterialAssetCategory(category);
      if (normalizedCategory) scopeAnd.push({ category: normalizedCategory });
    }
    const createdAt: { gte?: Date; lte?: Date } = {};
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(dateTo) : null;
    if (fromDate && !Number.isNaN(fromDate.getTime())) createdAt.gte = fromDate;
    if (toDate && !Number.isNaN(toDate.getTime())) createdAt.lte = toDate;
    if (createdAt.gte || createdAt.lte) scopeAnd.push({ createdAt });
    if (mediaKind === "single") {
      scopeAnd.push({ mediaCount: { lte: 1 } });
    } else if (mediaKind === "series") {
      scopeAnd.push({ mediaCount: { gt: 1 } });
    }

    if (q) {
      scopeAnd.push({
        OR: [
          { title: { contains: q } },
          { tags: { contains: q } },
          { category: { contains: q } },
          { creatorName: { contains: q } },
        ],
      });
    }

    const and: any[] = [...scopeAnd];
    if (!mine) {
      if (status === "available") and.push({ selectedByUserId: null });
      else if (status === "selected") and.push({ selectedByUserId: { not: null } });
      else if (status === "mine") and.push(currentUser ? { selectedByUserId: currentUser.id } : { id: -1 });
    }
    // Historical cards remain searchable. Age alone never changes visibility or ownership.
    const where = { AND: and };
    const statsWhere = { AND: scopeAnd };
    const selectedStatsWhere = { AND: [...scopeAnd, { selectedByUserId: { not: null } }] };
    const availableStatsWhere = { AND: [...scopeAnd, { selectedByUserId: null }] };
    // Cards do not wait for counts or download history. A keyset cursor keeps
    // appends stable when other users select materials or administrators upload.
    if (searchParams.get("view") === "cards") {
      const fields = mine ? ["createdAt", "id"] : status === "mine"
        ? ["selectedAt", "id"] : ["sortOrder", "listedAt", "createdAt", "id"];
      let cursor: { values: Array<string | number | null>; snapshot: string } | null = null;
      const rawCursor = searchParams.get("cursor");
      if (rawCursor) {
        try {
          cursor = JSON.parse(Buffer.from(rawCursor, "base64url").toString());
          if (!cursor || !Array.isArray(cursor.values) || cursor.values.length !== fields.length ||
              !Number.isFinite(Date.parse(cursor.snapshot)) || cursor.values.some((v, i) =>
                fields[i] === "id" || fields[i] === "sortOrder" ? !Number.isSafeInteger(v) : v !== null && !Number.isFinite(Date.parse(String(v))))) throw new Error();
        } catch { return NextResponse.json({ error: apiMessage("mcf51ff5a5e02") }, { status: 400 }); }
      }
      const snapshot = cursor?.snapshot || new Date().toISOString();
      const conditions: any[] = [...and, { createdAt: { lte: new Date(snapshot) } }];
      if (cursor) {
        const values = cursor.values.map((v, i) => fields[i] === "id" || fields[i] === "sortOrder" || v === null ? v : new Date(String(v)));
        conditions.push({ OR: fields.flatMap((field, i) => {
          const prefix = Object.fromEntries(fields.slice(0, i).map((key, n) => [key, values[n]]));
          if (values[i] === null) return [];
          const comparison = { ...prefix, [field]: { [field === "sortOrder" ? "gt" : "lt"]: values[i] } };
          return field === "listedAt" || field === "selectedAt" ? [comparison, { ...prefix, [field]: null }] : [comparison];
        }) });
      }
      const orderBy: any = fields.map(field => ({ [field]: field === "sortOrder" ? "asc" : field === "listedAt" || field === "selectedAt" ? { sort: "desc", nulls: "last" } : "desc" }));
      const rows = await prisma.materialAsset.findMany({
        where: { AND: conditions }, orderBy, take: pageSize + 1,
        include: { selectedByUser: { select: { id: true, username: true } }, _count: { select: { downloads: true } } },
      });
      const visible = rows.slice(0, pageSize);
      const last: any = visible[visible.length - 1];
      const hasMore = rows.length > pageSize;
      const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ snapshot, values: fields.map(field => last[field] ?? null) })).toString("base64url") : null;
      return NextResponse.json({
        items: await Promise.all(visible.map(row => serializeAsset(row, currentUser?.id ?? null))),
        pagination: { page, pageSize, hasMore, nextCursor },
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const [total, statsTotal, selectedStats, availableStats] =
      await readMaterialCounts([where, statsWhere, selectedStatsWhere, availableStatsWhere]);
    if (searchParams.get("view") === "summary") {
      return NextResponse.json({ total, stats: { total: statsTotal, selected: selectedStats, available: availableStats, unselected: availableStats } }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    const rows = await prisma.materialAsset.findMany({
      where,
      orderBy: mine
        ? [{ createdAt: "desc" }, { id: "desc" }]
        : status === "mine"
          ? [{ selectedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }] // 我已挑选按挑选时间倒序，便于按月分组
          : [
              { sortOrder: "asc" },
              { listedAt: { sort: "desc", nulls: "last" } },
              { createdAt: "desc" },
              { id: "desc" },
            ],
      take: pageSize,
      skip: (currentPage - 1) * pageSize,
      include: {
        selectedByUser: { select: { id: true, username: true } },
        downloads: {
          orderBy: { downloadedAt: "desc" },
          take: 8,
          select: {
            id: true,
            userId: true,
            username: true,
            downloadedAt: true,
          },
        },
        _count: { select: { downloads: true } },
      },
    });

    return NextResponse.json(
      {
        success: true,
        pagination: {
          page: currentPage,
          pageSize,
          total,
          totalPages,
          hasMore: currentPage * pageSize < total,
        },
        stats: {
          total: statsTotal,
          selected: selectedStats,
          available: availableStats,
          unselected: availableStats,
        },
        items: await Promise.all(
          rows.map((row) => serializeAsset(row, currentUser?.id ?? null)),
        ),
      },
      {
        headers: {
          "Cache-Control": "private, max-age=15, stale-while-revalidate=60",
        },
      },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: apiErrorMessage(error?.message || apiMessage("mb0b5cbc7a957")) },
      { status: 500 },
    );
  }
}
