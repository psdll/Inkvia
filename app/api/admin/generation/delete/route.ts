import { apiErrorMessage } from "@/i18n/api-message";
﻿import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import { Logger } from "@/lib/logger";
import {
  collectComparableMediaRefsByGenerationWhere,
  collectMediaRefs,
  deleteStoredMediaRefs,
  normalizeComparableMediaRef
} from "@/lib/media-cleanup";
import { writeAdminAuditLog } from "@/lib/admin-operational";
import { invalidateAdminUserSummariesCache } from "@/lib/admin-user-scope";
import { deleteGenerationRowsAndBatchCards } from "@/lib/generation-physical-delete";
import { enqueueMediaCleanupRetryIfNeeded } from "@/lib/media-cleanup-retry";
import { expandGenerationTaskDeleteRows } from "@/lib/generation-task-delete";

export const runtime = "nodejs";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(message) }, { status });
}

const MAX_DELETE_IDS = 5000;

const generationDeleteSelect = {
  id: true,
  userId: true,
  authUserId: true,
  type: true,
  status: true,
  model: true,
  externalTaskId: true,
  localPath: true,
  templateData: true,
} as const;

function parseGenerationIds(body: any) {
  const batch = Array.isArray(body?.ids);
  const rawIds = batch ? body.ids : [body?.id];
  if (rawIds.length > MAX_DELETE_IDS) {
    return { batch, ids: [] as number[], tooMany: true };
  }
  const ids: number[] = Array.from(
    new Set<number>(
      rawIds
        .map((value: unknown) => Number(value))
        .filter((value: number): value is number => Number.isSafeInteger(value) && value > 0),
    ),
  );
  return { batch, ids, tooMany: false };
}

function isDirectMediaRef(value: string) {
  return /^https?:\/\//i.test(value) || /^\/?uploads\//i.test(value);
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);

  const body = await req.json().catch(() => null);
  if (!body) return bad("请求体无效");
  const parsed = parseGenerationIds(body);
  if (parsed.tooMany) return bad(`单次最多删除 ${MAX_DELETE_IDS} 条记录`);
  if (!parsed.ids.length) return bad("id 无效");

  const foundRows = await prisma.generation.findMany({
    where: { id: { in: parsed.ids } },
    select: generationDeleteSelect,
  });
  if (!foundRows.length) return bad("记录不存在", 404);

  const selectedIds = foundRows.map((row) => row.id);
  const foundIdSet = new Set(selectedIds);
  const missingIds = parsed.ids.filter((id) => !foundIdSet.has(id));
  const taskRows = await expandGenerationTaskDeleteRows(prisma, foundRows, {
    select: generationDeleteSelect,
    maxRows: MAX_DELETE_IDS,
  }).catch((error: unknown) => null);
  if (!taskRows) return bad(`无法展开完整任务，删除已取消`, 409);
  const foundIds = taskRows.map((row) => row.id);
  const relatedLogs = await prisma.log.findMany({
    where: { generationId: { in: foundIds }, metadata: { not: null } },
    select: { metadata: true }
  });
  const rawRefs = new Set<string>();
  for (const row of taskRows) {
    collectMediaRefs(row.localPath, rawRefs);
    collectMediaRefs(row.templateData, rawRefs);
  }
  for (const row of relatedLogs) collectMediaRefs(row.metadata, rawRefs);
  const targetComparableRefs = new Set<string>();
  for (const ref of rawRefs) {
    const comparable = normalizeComparableMediaRef(ref);
    if (comparable) targetComparableRefs.add(comparable);
  }
  const candidateImportPaths = Array.from(new Set([...rawRefs, ...targetComparableRefs]))
    .map((ref) => String(ref || "").trim())
    .filter((ref) => ref.length > 0 && ref.length <= 2048 && isDirectMediaRef(ref));

  // 用户从前端上传素材时（/api/assets/import）会生成一条 type="import" 的 generation 作为占位/记账，
  // 它的 localPath 就指向这次上传的文件。如果不把这种占位 import 视为"会一起消失"，
  // 它就会成为输入素材的保护者 —— 删除生成资产时输入文件永远删不掉。
  // 因此：先找出 localPath 落在本次待删 refs 里的 import 记录，作为级联候选；
  // 然后判断它们对应的文件是否真的可删（即没有任何非候选的 generation 仍在引用），
  // 只有"会被删的 import"才真正级联删除，避免与其它生成资产共享同一份上传素材时误删。
  const candidateImports = candidateImportPaths.length
    ? await prisma.generation.findMany({
        where: { type: "import", localPath: { in: candidateImportPaths }, id: { notIn: foundIds } },
        select: generationDeleteSelect,
      })
    : [];
  const cascadeImportIds: number[] = [];
  for (const row of candidateImports) {
    const comp = normalizeComparableMediaRef(row.localPath || "");
    if (comp && targetComparableRefs.has(comp)) cascadeImportIds.push(row.id);
  }

  const idsToExclude = cascadeImportIds.length ? [...foundIds, ...cascadeImportIds] : foundIds;
  const referencedByOthers = targetComparableRefs.size
    ? await collectComparableMediaRefsByGenerationWhere({ id: { notIn: idsToExclude } })
    : new Set<string>();
  const deletableRefs = Array.from(targetComparableRefs).filter((ref) => !referencedByOthers.has(ref));
  const referencedSkipCount = targetComparableRefs.size - deletableRefs.length;

  // 只有 localPath 真的在 deletableRefs 里的 import 才级联——若该上传素材仍被其它非删除资产使用，保留 import 记录
  const deletableRefSet = new Set(deletableRefs);
  const finalCascadeImports = candidateImports
    .filter((row) => {
      const comp = normalizeComparableMediaRef(row.localPath || "");
      return comp && deletableRefSet.has(comp);
    });
  const finalCascadeImportIds = finalCascadeImports.map((row) => row.id);
  const deleteRows = [...taskRows, ...finalCascadeImports];
  const deleteIds = deleteRows.map((row) => row.id);
  const now = new Date();

  // 先在一个事务中完成所有数据库变更。只有事务提交成功后才删物理文件，
  // 避免数据库失败时留下“记录存在但文件已丢失”的不可恢复状态。
  const databaseDeletion = await prisma.$transaction(async (tx) => {
    // 费用账本独立保留；Generation 外键删除时置空，作品清理不改变历史账单。
    await tx.log.deleteMany({ where: { generationId: { in: deleteIds } } });
    const deleted = await deleteGenerationRowsAndBatchCards(tx, deleteIds);
    await tx.adminEvent.createMany({
      data: deleteRows.map((row) => ({
        eventType: "generation_deleted",
        entityType: "generation",
        entityId: String(row.id),
        userId: row.userId || null,
        authUserId: row.authUserId ?? null,
        payload: {
          generationId: row.id,
          cascadeDeletedImportIds: row.id === foundRows[0]?.id ? finalCascadeImportIds : [],
        },
        occurredAt: now,
      })),
    });
    return deleted;
  });

  const deletionInfo = deletableRefs.length
    ? await deleteStoredMediaRefs(deletableRefs, {
        canonicalGenerationOutputs: true,
        canonicalGenerationMediaIds: databaseDeletion.generationOutputMedia
          .filter((entry) => deletableRefSet.has(normalizeComparableMediaRef(
            deleteRows.find((row) => row.id === entry.generationId)?.localPath || "",
          )))
          .map((entry) => entry.mediaId),
        protectedGenerationComparableRefs: referencedByOthers,
      }).catch((error: any) => ({
        deletedOssObjects: 0,
        deletedLocalFiles: 0,
        deletedOssKeys: [] as string[],
        failedOssKeys: deletableRefs.map((ref) => `${ref}: ${String(error?.message || "文件删除失败")}`),
        skippedProtectedRefsCount: 0,
        ossError: String(error?.message || "文件删除失败"),
      }))
    : {
        deletedOssObjects: 0,
        deletedLocalFiles: 0,
        deletedOssKeys: [] as string[],
        failedOssKeys: [] as string[],
        skippedProtectedRefsCount: 0,
        ossError: "",
      };
  await enqueueMediaCleanupRetryIfNeeded(deletableRefs, deletionInfo, {
    source: "admin_generation_delete",
    generationIds: deleteIds,
    canonicalGenerationMediaIds: databaseDeletion.generationOutputMediaIds,
  }).catch(() => null);
  const deletedFile = Boolean(deletionInfo.deletedLocalFiles + deletionInfo.deletedOssObjects > 0);
  const totalReferencedSkipCount = referencedSkipCount + Number(deletionInfo.skippedProtectedRefsCount || 0);
  const selectedDeletedCount = Math.min(foundRows.length, Number(databaseDeletion.generations || 0));
  const taskDeletedCount = Math.min(taskRows.length, Number(databaseDeletion.generations || 0));
  const failedDeletes = missingIds.length + Math.max(0, foundRows.length - selectedDeletedCount);
  const action = parsed.batch ? "generation_batch_hard_delete" : "generation_hard_delete";

  await invalidateAdminUserSummariesCache();
  await Promise.all([
    prisma.log
      .create({
        data: {
          userId: "system",
          category: "admin",
          action,
          level: "warning",
          message: parsed.batch ? `批量删除作品 ${selectedDeletedCount} 条` : `删除作品 #${foundRows[0].id}`,
          metadata: JSON.stringify({
            requestedIds: parsed.ids,
            deletedIds: foundIds,
            missingIds,
            cascadeDeletedImportIds: finalCascadeImportIds,
            deletedOssObjects: deletionInfo.deletedOssObjects,
            deletedLocalFiles: deletionInfo.deletedLocalFiles,
            referencedSkipCount: totalReferencedSkipCount,
            deletedOssKeysPreview: deletionInfo.deletedOssKeys.slice(0, 20),
            failedOssKeysPreview: deletionInfo.failedOssKeys.slice(0, 20),
            by: auth.username,
          }),
        },
      })
      .catch(() => null),
    writeAdminAuditLog({
      operator: auth.username,
      action,
      targetType: parsed.batch ? "GenerationBatch" : "Generation",
      targetId: parsed.batch ? foundIds.join(",") : foundRows[0].id,
      before: taskRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        authUserId: row.authUserId ?? null,
        type: row.type,
        status: row.status,
      })),
      after: { deletedFile, cascadeDeletedImportIds: finalCascadeImportIds },
      req,
    }).catch(() => null),
    Promise.resolve()
      .then(() => Logger.log({
        userId: "system",
        category: "user_action",
        action: "delete_output",
        level: "info",
        message: parsed.batch ? "管理员批量删除作品" : "管理员删除作品",
        metadata: {
          sourcePage: "/admin",
          admin: auth.username,
          generationIds: foundIds,
          cascadeDeletedImportIds: finalCascadeImportIds,
        },
      }))
      .catch(() => null),
  ]);

  return NextResponse.json({
    ok: true,
    requestedCount: parsed.ids.length,
    deletedGenerations: selectedDeletedCount,
    deletedTaskGenerations: taskDeletedCount,
    deletedTotalRecords: Number(databaseDeletion.generations || 0),
    failedDeletes,
    missingIds,
    cascadeDeletedImportIds: finalCascadeImportIds,
    deletedGenerationIds: foundIds,
    deletedFile,
    deletedOssObjects: deletionInfo.deletedOssObjects,
    deletedLocalFiles: deletionInfo.deletedLocalFiles,
    referencedSkipCount: totalReferencedSkipCount,
    deletedOssKeysPreview: deletionInfo.deletedOssKeys.slice(0, 20),
    failedOssKeysPreview: deletionInfo.failedOssKeys.slice(0, 20),
  });
}
