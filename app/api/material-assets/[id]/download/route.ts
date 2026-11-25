import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/server-auth";
import { parseMaterialAssetMedia, type MaterialAssetMediaItem } from "@/lib/material-asset-media";
import {
  materialSeriesZipResponse,
  singleMaterialFileResponse,
} from "@/lib/material-asset-download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(raw: string) {
  const id = Math.floor(Number(raw));
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function selectedByPayload(asset: any) {
  return asset.selectedByUser
    ? {
        id: asset.selectedByUser.id,
        username: asset.selectedByUser.username,
        selectedAt: asset.selectedAt?.toISOString() || null,
        selectedMediaId: asset.selectedMediaId || null,
      }
    : null;
}

type DownloadAccess = {
  asset: any;
  mediaItems: MaterialAssetMediaItem[];
  currentUser: { id: number; username: string };
};

async function resolveDownloadAccess(request: NextRequest, rawId: string): Promise<DownloadAccess | NextResponse> {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });

  const id = parseId(rawId);
  if (!id) return NextResponse.json({ error: apiMessage("m528f562d6442") }, { status: 400 });

  const asset = await prisma.materialAsset.findFirst({
    where: { id, isDeleted: false },
    include: { selectedByUser: { select: { id: true, username: true } } },
  });
  if (!asset) return NextResponse.json({ error: apiMessage("m38943e98763b") }, { status: 404 });
  if (!asset.selectedByUserId) return NextResponse.json({ error: apiMessage("m39cdeb4c999d") }, { status: 403 });
  if (asset.selectedByUserId !== currentUser.id) {
    return NextResponse.json(
      { error: apiMessage("m2661f6510e94"), selectedBy: selectedByPayload(asset) },
      { status: 409 },
    );
  }

  const mediaItems = parseMaterialAssetMedia(asset.media, asset);
  if (!mediaItems.length) return NextResponse.json({ error: apiMessage("m5ce5aef83167") }, { status: 404 });
  return { asset, mediaItems, currentUser };
}

function isResponse(value: DownloadAccess | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const access = await resolveDownloadAccess(request, params.id);
    if (isResponse(access)) return access;

    const download = await prisma.materialAssetDownload.create({
      data: {
        assetId: access.asset.id,
        userId: access.currentUser.id,
        username: access.currentUser.username,
      },
    });

    return NextResponse.json({
      success: true,
      download: {
        id: download.id,
        userId: download.userId,
        username: download.username,
        downloadedAt: download.downloadedAt.toISOString(),
      },
      downloadUrl: request.nextUrl.pathname,
    });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("m2fe4328d48a4")) }, { status: 500 });
  }
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const access = await resolveDownloadAccess(request, params.id);
    if (isResponse(access)) return access;
    return access.mediaItems.length > 1
      ? materialSeriesZipResponse(access.asset.title, access.mediaItems)
      : await singleMaterialFileResponse(access.asset.title, access.mediaItems[0]);
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("m8a03e35ad323")) }, { status: 500 });
  }
}
