import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import prisma from "@/lib/prisma";
import { parseMaterialAssetMedia } from "@/lib/material-asset-media";
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

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = requireAdminRequest(request);
    if (!admin.ok) {
      return NextResponse.json({ error: apiErrorMessage(admin.error || apiMessage("m6eb5dc119e84")) }, { status: 403 });
    }

    const id = parseId(params.id);
    if (!id) return NextResponse.json({ error: apiMessage("m528f562d6442") }, { status: 400 });

    const asset = await prisma.materialAsset.findFirst({ where: { id, isDeleted: false } });
    if (!asset) return NextResponse.json({ error: apiMessage("m38943e98763b") }, { status: 404 });

    const mediaItems = parseMaterialAssetMedia(asset.media, asset);
    if (!mediaItems.length) return NextResponse.json({ error: apiMessage("m5ce5aef83167") }, { status: 404 });

    const searchParams = new URL(request.url).searchParams;
    const mode = searchParams.get("mode") === "series" ? "series" : "current";
    if (mode === "series") {
      return mediaItems.length === 1
        ? await singleMaterialFileResponse(asset.title, mediaItems[0])
        : materialSeriesZipResponse(asset.title, mediaItems);
    }

    const mediaId = String(searchParams.get("mediaId") || "").trim();
    const media = mediaItems.find((item) => item.id === mediaId);
    if (!media) return NextResponse.json({ error: apiMessage("mfd4a0c8e9faf") }, { status: 404 });
    return await singleMaterialFileResponse(asset.title, media);
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("m8a03e35ad323")) }, { status: 500 });
  }
}
