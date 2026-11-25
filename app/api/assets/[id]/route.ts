import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { markAdminAssetFeedDeleted } from "@/lib/admin-asset-feed";
import { computeDeletableRefsForGenerationIds, deleteStoredMediaRefs } from "@/lib/media-cleanup";
import { deleteGenerationRowsAndBatchCards } from "@/lib/generation-physical-delete";
import { enqueueMediaCleanupRetry, enqueueMediaCleanupRetryIfNeeded } from "@/lib/media-cleanup-retry";
import { getCanvasAssetDetail } from "@/lib/assets/canvas-history-server";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return getCanvasAssetDetail(req, Number(params.id));
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authUserId = await getUserId(req);
  const id = Number(params.id);

  if (!authUserId) return NextResponse.json({ error: apiMessage("mc1986431234d") }, { status: 401 });
  if (!Number.isFinite(id)) return NextResponse.json({ error: apiMessage("m39a179be21a4") }, { status: 400 });

  const found = await prisma.generation.findUnique({ where: { id } });
  if (!found) return NextResponse.json({ error: apiMessage("me4ba03868d92") }, { status: 404 });
  if ((found as any).authUserId !== authUserId) return NextResponse.json({ error: apiMessage("m2a392451ca61") }, { status: 403 });

  const deletableRefs = await computeDeletableRefsForGenerationIds([id]);
  const databaseDeletion = await prisma.$transaction(async (tx) => {
    await tx.log.deleteMany({ where: { generationId: id } });
    // 费用账本独立保留；Generation 外键删除时置空，作品清理不改变历史账单。
    return deleteGenerationRowsAndBatchCards(tx, [id]);
  });
  await markAdminAssetFeedDeleted([id]).catch(() => 0);
  try {
    const cleanup = await deleteStoredMediaRefs(deletableRefs, {
      canonicalGenerationOutputs: true,
      canonicalGenerationMediaIds: databaseDeletion.generationOutputMediaIds,
    });
    await enqueueMediaCleanupRetryIfNeeded(deletableRefs, cleanup, {
      source: "asset_delete",
      generationIds: [id],
      canonicalGenerationMediaIds: databaseDeletion.generationOutputMediaIds,
    });
  } catch (error) {
    await enqueueMediaCleanupRetry(deletableRefs, {
      source: "asset_delete",
      generationIds: [id],
      canonicalGenerationMediaIds: databaseDeletion.generationOutputMediaIds,
      error: String((error as Error)?.message || error),
    }).catch(() => null);
  }
  return NextResponse.json({ success: true });
}
