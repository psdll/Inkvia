import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { canvasImportUserPrefix, collectCanvasImportRefs } from "@/lib/canvas/import-refs";
import { deleteStoredMediaRefs } from "@/lib/media-cleanup";
import { getUserId } from "@/lib/server-auth";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {

  const authUserId = await getUserId(req);
  if (!authUserId) return NextResponse.json({ success: false, error: apiMessage("m48144f96c150") }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { refs?: unknown[] } | null;
  const requestedRefs = Array.from(collectCanvasImportRefs(body?.refs || []));
  if (!requestedRefs.length) {
    return NextResponse.json({ success: true, deletedLocalFiles: 0, deletedOssObjects: 0, skippedProtectedRefsCount: 0 });
  }

  const prefix = canvasImportUserPrefix(authUserId);
  try {
    const ownedAssets = await prisma.mediaAsset.findMany({
      where: {
        ownerUserId: authUserId,
        publicUrl: { in: requestedRefs },
      },
      select: { publicUrl: true },
    });
    const ownedRefs = new Set(ownedAssets.map((asset) => asset.publicUrl).filter(Boolean));
    const refs = requestedRefs.filter((ref) => ref.startsWith(prefix) || ownedRefs.has(ref));
    if (!refs.length) {
      return NextResponse.json({ success: true, deletedLocalFiles: 0, deletedOssObjects: 0, skippedProtectedRefsCount: 0 });
    }
    const result = await deleteStoredMediaRefs(refs);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: apiErrorMessage(String(error?.message || "删除素材失败")) }, { status: 500 });
  }
}
