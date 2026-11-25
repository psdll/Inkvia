import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { computeDeletableRefsForGenerationIds, deleteStoredMediaRefs } from "@/lib/media-cleanup";
import { upsertAdminAssetFeedForGenerationId } from "@/lib/admin-asset-feed";
import { deleteGenerationRowsAndBatchCards } from "@/lib/generation-physical-delete";
import { enqueueMediaCleanupRetry, enqueueMediaCleanupRetryIfNeeded } from "@/lib/media-cleanup-retry";

const IN_PROGRESS = ["running", "queued", "pending", "submitted", "processing"];

export async function POST(req: NextRequest) {
  const authUserId = await getUserId(req);
  const body = (await req.json().catch(() => null)) as any;
  const action = String(body?.action || "").trim();
  if (!authUserId) return NextResponse.json({ error: apiMessage("mc1986431234d") }, { status: 401 });
  if (!action) return NextResponse.json({ error: apiMessage("m06b242bef698") }, { status: 400 });

  if (action === "clear_queue") {
    const now = new Date();
    const res = await prisma.generation.updateMany({
      where: { authUserId, status: { in: IN_PROGRESS }, type: { not: "import" } } as any,
      data: { status: "cancelled", errorMsg: "已取消", finishedAt: now } as any
    });
    const rows = await prisma.generation.findMany({
      where: { authUserId, status: "cancelled", finishedAt: now } as any,
      select: { id: true },
    }).catch(() => []);
    rows.forEach((row) => void upsertAdminAssetFeedForGenerationId(row.id).catch(() => null));
    return NextResponse.json({ success: true, updated: res.count });
  }

  if (action === "cancel_single") {
    const generationId = String(body?.generationId || "").trim();
    if (!generationId) return NextResponse.json({ error: apiMessage("mcd532285266c") }, { status: 400 });
    const id = Number(generationId);
    if (!Number.isFinite(id)) return NextResponse.json({ error: apiMessage("m675e48deb204") }, { status: 400 });
    
    const item = await prisma.generation.findUnique({ where: { id } });
    if (!item) return NextResponse.json({ error: apiMessage("me4ba03868d92") }, { status: 404 });
    if ((item as any).authUserId !== authUserId) return NextResponse.json({ error: apiMessage("m2a392451ca61") }, { status: 403 });
    
    const now = new Date();
    const result = await prisma.generation.updateMany({
      where: { id, authUserId, status: { in: IN_PROGRESS } },
      data: { status: "cancelled", errorMsg: "用户取消", finishedAt: now } as any
    });
    if (result.count) void upsertAdminAssetFeedForGenerationId(id).catch(() => null);
    return NextResponse.json({ success: true, updated: result.count });
  }

  if (action === "delete_single") {
    const generationId = String(body?.generationId || "").trim();
    if (!generationId) return NextResponse.json({ error: apiMessage("mcd532285266c") }, { status: 400 });
    const id = Number(generationId);
    if (!Number.isFinite(id)) return NextResponse.json({ error: apiMessage("m675e48deb204") }, { status: 400 });

    const item = await prisma.generation.findUnique({ where: { id } });
    if (!item) return NextResponse.json({ error: apiMessage("me4ba03868d92") }, { status: 404 });
    if ((item as any).authUserId !== authUserId) return NextResponse.json({ error: apiMessage("m2a392451ca61") }, { status: 403 });

    // 删除前仅计算安全候选；数据库事务提交后才删物理文件，避免留下坏图卡片。
    const deletableRefs = await computeDeletableRefsForGenerationIds([id]);
    const databaseDeletion = await prisma.$transaction(async (tx) => {
      await tx.log.deleteMany({ where: { generationId: id } });
      // 费用账本独立保留；Generation 外键删除时置空，作品清理不改变历史账单。
      return deleteGenerationRowsAndBatchCards(tx, [id]);
    });
    try {
      const cleanup = await deleteStoredMediaRefs(deletableRefs, {
        canonicalGenerationOutputs: true,
        canonicalGenerationMediaIds: databaseDeletion.generationOutputMediaIds,
      });
      await enqueueMediaCleanupRetryIfNeeded(deletableRefs, cleanup, {
        source: "history_delete_single",
        generationIds: [id],
        canonicalGenerationMediaIds: databaseDeletion.generationOutputMediaIds,
      });
    } catch (error) {
      await enqueueMediaCleanupRetry(deletableRefs, {
        source: "history_delete_single",
        generationIds: [id],
        canonicalGenerationMediaIds: databaseDeletion.generationOutputMediaIds,
        error: String((error as Error)?.message || error),
      }).catch(() => null);
    }

    return NextResponse.json({ success: true });
  }

  if (action === "clear_completed") {
    return NextResponse.json({ success: true, ignored: true });
  }

  return NextResponse.json({ error: apiMessage("m1707715d174a") }, { status: 400 });
}
