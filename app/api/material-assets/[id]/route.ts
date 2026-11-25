import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/server-auth";
import { normalizeMaterialAssetCategory, parseStoredMaterialAssetTags } from "@/lib/material-assets";
import { parseMaterialAssetMedia } from "@/lib/material-asset-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(raw: string) {
  const id = Math.floor(Number(raw));
  return Number.isFinite(id) && id > 0 ? id : 0;
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const currentUser = await getCurrentUser(request);
    const id = parseId(params.id);
    if (!id) return NextResponse.json({ error: apiMessage("m528f562d6442") }, { status: 400 });

    const asset = await prisma.materialAsset.findFirst({
      where: { id, isDeleted: false },
      include: {
        selectedByUser: { select: { id: true, username: true } },
        downloads: {
          orderBy: { downloadedAt: "desc" },
          take: 8,
          select: { id: true, userId: true, username: true, downloadedAt: true },
        },
        _count: { select: { downloads: true } },
      },
    });
    if (!asset) return NextResponse.json({ error: apiMessage("m38943e98763b") }, { status: 404 });

    const mediaItems = parseMaterialAssetMedia(asset.media, asset);
    return NextResponse.json({
      success: true,
      item: {
        id: asset.id,
        category: normalizeMaterialAssetCategory(asset.category),
        title: asset.title,
        imageUrl: asset.imageUrl,
        thumbnailUrl: asset.thumbnailUrl || null,
        previewUrl: asset.previewUrl || null,
        mimeType: asset.mimeType || null,
        sizeBytes: asset.sizeBytes || 0,
        mediaCount: Math.max(1, Number(asset.mediaCount || mediaItems.length || 1)),
        selectedMediaId: asset.selectedMediaId || null,
        mediaItems,
        tags: parseStoredMaterialAssetTags(asset.tags),
        creatorName: asset.creatorName || null,
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
        isSelectedByMe: asset.selectedByUserId === currentUser?.id,
        downloadCount: asset._count?.downloads || 0,
        recentDownloads: (asset.downloads || []).map((download) => ({
          id: download.id,
          userId: download.userId,
          username: download.username,
          downloadedAt: download.downloadedAt.toISOString(),
        })),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("m088497595c7d")) }, { status: 500 });
  }
}
