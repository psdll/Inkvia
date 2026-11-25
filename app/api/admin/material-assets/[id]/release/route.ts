import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import { selectedMediaSnapshot } from "@/lib/material-asset-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(raw: string) {
  const id = Math.floor(Number(raw));
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function eventSnapshot(asset: any) {
  return {
    assetTitle: String(asset?.title || "").slice(0, 200) || null,
    assetCategory: asset?.category
      ? String(asset.category).slice(0, 120)
      : null,
    assetImageUrl: asset?.imageUrl ? String(asset.imageUrl) : null,
    assetThumbnailUrl: asset?.thumbnailUrl ? String(asset.thumbnailUrl) : null,
    ...selectedMediaSnapshot(asset, asset?.selectedMediaId),
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const admin = requireAdminRequest(request);
    if (!admin.ok) {
      return NextResponse.json(
        { error: apiErrorMessage(admin.error || apiMessage("m6eb5dc119e84")) },
        { status: 403 },
      );
    }
    const id = parseId(params.id);
    if (!id)
      return NextResponse.json({ error: apiMessage("m528f562d6442") }, { status: 400 });

    const body = (await request.json().catch(() => null)) as {
      reason?: string;
    } | null;
    const reason =
      String(body?.reason || "")
        .trim()
        .slice(0, 500) || null;

    const asset = await prisma.materialAsset.findFirst({
      where: { id, isDeleted: false },
      include: { selectedByUser: { select: { id: true, username: true } } },
    });
    if (!asset) {
      return NextResponse.json({ error: apiMessage("m38943e98763b") }, { status: 404 });
    }
    if (!asset.selectedByUserId) {
      return NextResponse.json(
        { error: apiMessage("mbb540e468a88") },
        { status: 400 },
      );
    }

    await prisma.$transaction([
      prisma.materialAssetSelectionEvent.create({
        data: {
          assetId: id,
          userId: asset.selectedByUserId,
          username:
            asset.selectedByUser?.username || `user_${asset.selectedByUserId}`,
          action: "release",
          reason,
          operatorUsername: admin.username,
          ...eventSnapshot(asset),
        },
      }),
      prisma.materialAsset.update({
        where: { id },
        data: {
          selectedByUserId: null,
          selectedAt: null,
          selectedMediaId: null,
          listedAt: new Date(),
        },
        select: { id: true },
      }),
    ]);

    return NextResponse.json({
      success: true,
      item: { id, selectedBy: null, isSelected: false, selectedMediaId: null },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: apiErrorMessage(error?.message || apiMessage("m288c6b7da22c")) },
      { status: 500 },
    );
  }
}
