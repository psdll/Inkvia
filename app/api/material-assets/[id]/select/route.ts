import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/server-auth";
import { findMaterialAssetMedia, parseMaterialAssetMedia, selectedMediaSnapshot } from "@/lib/material-asset-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseId(raw: string) {
  const id = Math.floor(Number(raw));
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function selectedByPayload(asset: any, fallbackUser?: { id: number; username: string }) {
  if (!asset?.selectedByUser && !fallbackUser) return null;
  return {
    id: asset?.selectedByUser?.id || fallbackUser?.id,
    username: asset?.selectedByUser?.username || fallbackUser?.username,
    selectedAt: asset?.selectedAt?.toISOString?.() || null,
    selectedMediaId: asset?.selectedMediaId || null,
  };
}

function selectionEventSnapshot(asset: any, mediaId?: string | null) {
  return {
    assetTitle: String(asset?.title || "").slice(0, 200) || null,
    assetCategory: asset?.category ? String(asset.category).slice(0, 120) : null,
    assetImageUrl: asset?.imageUrl ? String(asset.imageUrl) : null,
    assetThumbnailUrl: asset?.thumbnailUrl ? String(asset.thumbnailUrl) : null,
    ...selectedMediaSnapshot(asset, mediaId),
  };
}

function parseCancelReason(raw: unknown) {
  const reason = String(raw || "").trim();
  if (reason.length < 2) return "";
  return reason.slice(0, 500);
}

async function parseSelectBody(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { mediaId?: string | null } | null;
  return String(body?.mediaId || "").trim() || null;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
    }
    const id = parseId(params.id);
    if (!id) {
      return NextResponse.json({ error: apiMessage("m528f562d6442") }, { status: 400 });
    }
    const requestedMediaId = await parseSelectBody(request);

    const existingAsset = await prisma.materialAsset.findFirst({
      where: { id, isDeleted: false },
      include: { selectedByUser: { select: { id: true, username: true } } },
    });
    if (!existingAsset) {
      return NextResponse.json({ error: apiMessage("m38943e98763b") }, { status: 404 });
    }
    if (requestedMediaId && !findMaterialAssetMedia(parseMaterialAssetMedia(existingAsset.media, existingAsset), requestedMediaId)) {
      return NextResponse.json({ error: apiMessage("m1dfebe5dd2de") }, { status: 400 });
    }
    if (existingAsset.selectedByUserId === currentUser.id) {
      return NextResponse.json({
        success: true,
        item: {
          id,
          selectedBy: selectedByPayload(existingAsset, currentUser),
          selectedMediaId: existingAsset.selectedMediaId || null,
        },
      });
    }
    if (existingAsset.selectedByUserId) {
      return NextResponse.json(
        {
          error: apiMessage("me10fb9133e26"),
          selectedBy: selectedByPayload(existingAsset),
        },
        { status: 409 }
      );
    }

    const selectedAt = new Date();
    const result = await prisma.materialAsset.updateMany({
      where: { id, isDeleted: false, selectedByUserId: null },
      data: {
        selectedByUserId: currentUser.id,
        selectedAt,
        selectedMediaId: requestedMediaId,
      },
    });

    const asset = await prisma.materialAsset.findFirst({
      where: { id, isDeleted: false },
      include: { selectedByUser: { select: { id: true, username: true } } },
    });
    if (!asset) {
      return NextResponse.json({ error: apiMessage("m38943e98763b") }, { status: 404 });
    }
    if (!result.count && asset.selectedByUserId !== currentUser.id) {
      return NextResponse.json(
        {
          error: apiMessage("me10fb9133e26"),
          selectedBy: selectedByPayload(asset),
        },
        { status: 409 }
      );
    }
    if (result.count) {
      await prisma.materialAssetSelectionEvent.create({
        data: {
          assetId: id,
          userId: currentUser.id,
          username: currentUser.username,
          action: "select",
          ...selectionEventSnapshot(asset, requestedMediaId),
          occurredAt: selectedAt,
        },
      });
    }

    return NextResponse.json({
      success: true,
      item: {
        id,
        selectedBy: selectedByPayload(asset, currentUser),
        selectedMediaId: asset.selectedMediaId || requestedMediaId || null,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("mf99b98c973db")) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ error: apiMessage("m48144f96c150") }, { status: 401 });
    }
    const id = parseId(params.id);
    if (!id) {
      return NextResponse.json({ error: apiMessage("m528f562d6442") }, { status: 400 });
    }

    const asset = await prisma.materialAsset.findFirst({
      where: { id, isDeleted: false },
      include: { selectedByUser: { select: { id: true, username: true } } },
    });
    if (!asset) {
      return NextResponse.json({ error: apiMessage("m38943e98763b") }, { status: 404 });
    }
    if (!asset.selectedByUserId) {
      return NextResponse.json({ error: apiMessage("me6a63c4b8ee1") }, { status: 400 });
    }
    if (asset.selectedByUserId !== currentUser.id) {
      return NextResponse.json({ error: apiMessage("m6185e57c799c") }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as { reason?: string } | null;
    const reason = parseCancelReason(body?.reason);
    if (!reason) {
      return NextResponse.json({ error: apiMessage("m210175a29fd0") }, { status: 400 });
    }

    await prisma.materialAssetSelectionEvent.create({
      data: {
        assetId: id,
        userId: currentUser.id,
        username: currentUser.username,
        action: "cancel_request",
        reason,
        ...selectionEventSnapshot(asset, asset.selectedMediaId),
      },
    });

    return NextResponse.json({
      success: true,
      item: {
        id,
        selectedBy: selectedByPayload(asset, currentUser),
        selectedMediaId: asset.selectedMediaId || null,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: apiErrorMessage(error?.message || apiMessage("m616e2610d7ee")) }, { status: 500 });
  }
}
