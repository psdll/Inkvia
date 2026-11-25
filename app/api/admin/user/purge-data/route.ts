import { apiErrorMessage } from "@/i18n/api-message";
﻿import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import { resolveAdminUserScope, invalidateAdminUserSummariesCache } from "@/lib/admin-user-scope";
import {
  collectComparableMediaRefsByGenerationWhere,
  collectMediaRefs,
  deleteStoredMediaRefs,
  normalizeComparableMediaRef
} from "@/lib/media-cleanup";
import { enqueueAdminEvent, writeAdminAuditLog } from "@/lib/admin-operational";
import { parseAdminWorksAdminKey } from "@/lib/admin-user-works";
import {
  resetAdminUserPromptPresetData,
  resetAdminUserRoleSkillData,
} from "@/lib/admin-user-delete";
import { scanLegacyPromptPresets } from "@/lib/prompt-presets/migration";
import { resolvePublicDir } from "@/lib/public-path";
import { deleteGenerationRowsAndBatchCards } from "@/lib/generation-physical-delete";
import { enqueueMediaCleanupRetryIfNeeded } from "@/lib/media-cleanup-retry";
import { hardDeleteAgentConversation } from "@/lib/admin/legacy-agent-data/admin-delete-service";
import { deleteAgentMemoryForAdmin } from "@/lib/admin/legacy-agent-data/memory-delete-service";

export const runtime = "nodejs";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(message) }, { status });
}

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);

  const body = await req.json().catch(() => null);
  if (!body) return bad("请求体无效");
  const requestedPurgeGenerations: boolean = !!body.purgeGenerations;
  const requestedPurgeLogs: boolean = !!body.purgeLogs;
  const requestedPurgeAgentConversations: boolean = !!body.purgeAgentConversations;
  const requestedPurgeAgentMemory: boolean = !!body.purgeAgentMemory;
  const requestedGenerationStatus = clean((body as any).generationStatus).toLowerCase();
  const rawTypes: string[] = Array.isArray(body.generationTypes) ? body.generationTypes : [];
  const generationTypes: string[] = rawTypes.flatMap((t) =>
    t === "video" ? ["video_gen", "video_generate"] : t === "audio" ? ["audio_gen"] : [t]
  );
  // 来自"导入未引用的素材"tab 的批量删除会传 onlyUnreferencedImports=true，
  // 此时只清理那些没有被任何非 import 生成资产引用的孤儿上传记录，
  // 避免把还在被资产使用的上传素材一起删掉。
  const onlyUnreferencedImports: boolean = !!body.onlyUnreferencedImports;
  const canSkipAdminPassword =
    (requestedPurgeGenerations &&
      requestedGenerationStatus === "failed" &&
      !requestedPurgeLogs &&
      !requestedPurgeAgentConversations &&
      !requestedPurgeAgentMemory) ||
    (requestedPurgeGenerations &&
      onlyUnreferencedImports &&
      generationTypes.length === 1 &&
      generationTypes[0] === "import" &&
      !requestedPurgeLogs &&
      !requestedPurgeAgentConversations &&
      !requestedPurgeAgentMemory);
  const adminPassword = String(body.adminPassword || "").trim();
  const expectedAdminPassword = String(process.env.ADMIN_PASSWORD || "").trim();
  if (!canSkipAdminPassword && (!expectedAdminPassword || adminPassword !== expectedAdminPassword)) {
    return bad("管理员密码错误，请重新输入", 401);
  }

  const authUserIdRaw = Number(body?.authUserId);
  const compatibilityAdminKey =
    Number.isSafeInteger(authUserIdRaw) && authUserIdRaw > 0
      ? `auth:${authUserIdRaw}`
      : `guest:${String(body?.userId || "").trim()}`;
  const identity = parseAdminWorksAdminKey(
    typeof body.adminKey === "string" ? body.adminKey : compatibilityAdminKey,
  );
  if (!identity) return bad("adminKey 无效");
  const { userId, authUserId } = identity;
  const scopeInfo = await resolveAdminUserScope(userId, authUserId, {
    explicitIdentity: true,
  });

  // 抓用户名，方便审计日志显示「利文斌(ID:12)」
  let targetUsername: string | null = null;
  if (scopeInfo.authUserId != null) {
    const u = await prisma.user
      .findUnique({ where: { id: scopeInfo.authUserId }, select: { username: true } })
      .catch(() => null);
    targetUsername = u?.username || null;
  }
  const targetLabel = targetUsername ? `${targetUsername}(ID:${userId})` : `游客 ${userId}`;

  // 要删除的数据类型
  const purgeGenerations: boolean = requestedPurgeGenerations;
  // 为空数组时删除全部类型，否则只删指定类型
  // "video" 是前端别名，对应数据库中的 video_gen / video_generate
  const purgeLogs: boolean = requestedPurgeLogs;
  const purgeAgentConversations: boolean = requestedPurgeAgentConversations;
  const purgeAgentMemory: boolean = requestedPurgeAgentMemory;
  const generationStatus = requestedGenerationStatus;
  const deleteGenerationLogs: boolean = !!(body as any).deleteGenerationLogs;

  if (!purgeGenerations && !purgeLogs && !purgeAgentConversations && !purgeAgentMemory) {
    return bad("请至少选择一项要删除的数据");
  }

  const result: Record<string, number> = {};
  const debug: Record<string, unknown> = {};

  // ─── 删除生成记录 ───────────────────────────────────────────────
  if (purgeGenerations) {
    const genFilter: Record<string, unknown> = {};
    if (generationTypes.length > 0) {
      genFilter.type = { in: generationTypes };
    }
    if (generationStatus) {
      if (!["pending", "processing", "running", "success", "failed", "cancelled"].includes(generationStatus)) {
        return bad("generationStatus 无效");
      }
      genFilter.status = generationStatus;
    }
    let genWhere: any = Object.keys(genFilter).length ? { AND: [scopeInfo.generationWhere, genFilter] } : scopeInfo.generationWhere;

    // 当 onlyUnreferencedImports=true 且本次操作覆盖到 import 类型时，
    // 先算出"被非 import 资产引用过的素材路径"，再把已被引用的 import 记录从待删除集合中剔除。
    const targetsIncludeImport = generationTypes.length === 0 || generationTypes.includes("import");
    if (onlyUnreferencedImports && targetsIncludeImport) {
      const nonImportRefs = await collectComparableMediaRefsByGenerationWhere(
        { AND: [scopeInfo.generationWhere, { type: { not: "import" } }] } as any
      );
      const importRows = await prisma.generation.findMany({
        where: { AND: [scopeInfo.generationWhere, { type: "import" }] } as any,
        select: { id: true, localPath: true }
      });
      const unreferencedImportIds = importRows
        .filter((row) => {
          const comp = normalizeComparableMediaRef(row.localPath || "");
          return !comp || !nonImportRefs.has(comp);
        })
        .map((row) => row.id);

      // 仅删 import 的快路径
      if (generationTypes.length === 1 && generationTypes[0] === "import") {
        genWhere = {
          AND: [
            scopeInfo.generationWhere,
            { id: { in: unreferencedImportIds.length ? unreferencedImportIds : [-1] } }
          ]
        };
      } else {
        // 混合删 import + 其它类型：其他类型按原 filter，import 仅限未引用 id
        const otherTypes = generationTypes.filter((t) => t !== "import");
        const orClauses: any[] = [];
        if (otherTypes.length) orClauses.push({ type: { in: otherTypes } });
        orClauses.push({ AND: [{ type: "import" }, { id: { in: unreferencedImportIds.length ? unreferencedImportIds : [-1] } }] });
        genWhere = { AND: [scopeInfo.generationWhere, { OR: orClauses }] };
      }
      debug.unreferencedImportCandidates = unreferencedImportIds.length;
    }

    const gens = await prisma.generation.findMany({
      where: genWhere,
      select: { id: true, localPath: true },
    });
    const genIds = gens.map((g) => g.id);
    const rawRefs = new Set<string>();
    for (const g of gens) collectMediaRefs(g.localPath, rawRefs);
    const targetComparableRefs = new Set<string>();
    for (const ref of rawRefs) {
      const comparable = normalizeComparableMediaRef(ref);
      if (comparable) targetComparableRefs.add(comparable);
    }

    // 必须按全局其他 generation 做保护，不能只查当前用户：跨用户共享的同一对象也不能误删。
    const othersWhere: any = { id: { notIn: genIds.length ? genIds : [-1] } };
    const referencedByOthers = targetComparableRefs.size
      ? await collectComparableMediaRefsByGenerationWhere(othersWhere)
      : new Set<string>();
    let workspaceDraftMediaRows: any[] = [];
    let imageBatchMediaRows: any[] = [];
    if (targetComparableRefs.size) {
      try {
        [workspaceDraftMediaRows, imageBatchMediaRows] = await Promise.all([
          (prisma as any).toolWorkspaceDraftMedia.findMany({
            select: {
              media: {
                select: {
                  originalKey: true,
                  publicUrl: true,
                  variants: true,
                  metadata: true,
                },
              },
            },
          }),
          (prisma as any).imageBatchMedia.findMany({
            select: {
              media: {
                select: {
                  originalKey: true,
                  publicUrl: true,
                  variants: true,
                  metadata: true,
                },
              },
            },
          }),
        ]);
      } catch {
        return bad("素材引用检查失败，未执行清理，请稍后重试", 503);
      }
    }
    const workspaceDraftRawRefs = new Set<string>();
    for (const row of workspaceDraftMediaRows) collectMediaRefs(row.media, workspaceDraftRawRefs);
    const workspaceDraftComparableRefs = new Set<string>();
    for (const ref of workspaceDraftRawRefs) {
      const comparable = normalizeComparableMediaRef(ref);
      if (comparable) workspaceDraftComparableRefs.add(comparable);
    }
    const imageBatchRawRefs = new Set<string>();
    for (const row of imageBatchMediaRows) collectMediaRefs(row.media, imageBatchRawRefs);
    const imageBatchComparableRefs = new Set<string>();
    for (const ref of imageBatchRawRefs) {
      const comparable = normalizeComparableMediaRef(ref);
      if (comparable) imageBatchComparableRefs.add(comparable);
    }
    const protectedComparableRefs = new Set([
      ...referencedByOthers,
      ...workspaceDraftComparableRefs,
      ...imageBatchComparableRefs,
    ]);
    const deletableRefs = Array.from(targetComparableRefs).filter((ref) => !protectedComparableRefs.has(ref));
    const referencedSkipCount = targetComparableRefs.size - deletableRefs.length;
    let generationOutputMediaIds: string[] = [];

    // 账单流水随作品一起删：generationId 是 SetNull 关系，不显式删会留下孤儿账单。
    if (genIds.length) {
      const databaseDeletion = await prisma.$transaction(async (tx) => {
        const ledgerDeleted = await tx.usageLedger.deleteMany({ where: { generationId: { in: genIds } } });
        const generationLogsDeleted = deleteGenerationLogs
          ? await tx.log.deleteMany({ where: { generationId: { in: genIds } } })
          : { count: 0 };
        const generationsDeleted = await deleteGenerationRowsAndBatchCards(tx, genIds);
        return { ledgerDeleted, generationLogsDeleted, generationsDeleted };
      });
      result.usageLedgers = Number(databaseDeletion.ledgerDeleted.count || 0);
      result.generationLogs = Number(databaseDeletion.generationLogsDeleted.count || 0);
      result.imageBatchOutputs = databaseDeletion.generationsDeleted.imageOutputs;
      result.liveVideoBatchOutputs = databaseDeletion.generationsDeleted.liveOutputs;
      result.imageBatchItems = databaseDeletion.generationsDeleted.imageItems;
      result.liveVideoBatchItems = databaseDeletion.generationsDeleted.liveItems;
      result.generations = databaseDeletion.generationsDeleted.generations;
      generationOutputMediaIds = databaseDeletion.generationsDeleted.generationOutputMediaIds;
    }

    // 数据库删除成功后再清理物理对象，避免数据库失败时留下断链记录。
    // referencedByOthers 已在上方全局计算，直接复用，不再进行第二次全表扫描。
    const deletion = deletableRefs.length
      ? await deleteStoredMediaRefs(deletableRefs, {
          canonicalGenerationOutputs: true,
          canonicalGenerationMediaIds: generationOutputMediaIds,
          protectedGenerationComparableRefs: protectedComparableRefs,
        }).catch(async (error) => {
          return {
            deletedOssObjects: 0,
            deletedLocalFiles: 0,
            deletedOssKeys: [] as string[],
            failedOssKeys: deletableRefs.map((ref) => `${ref}: ${String((error as Error)?.message || error)}`),
            failedLocalFiles: [] as string[],
            ossError: String((error as Error)?.message || error),
          };
        })
      : {
          deletedOssObjects: 0,
          deletedLocalFiles: 0,
          deletedOssKeys: [] as string[],
          failedOssKeys: [] as string[],
          failedLocalFiles: [] as string[],
          ossError: "",
        };
    await enqueueMediaCleanupRetryIfNeeded(deletableRefs, deletion, {
      source: "admin_user_purge",
      generationIds: genIds,
      canonicalGenerationMediaIds: generationOutputMediaIds,
    }).catch(() => null);
    const deletedFiles = Number(deletion.deletedLocalFiles || 0) + Number(deletion.deletedOssObjects || 0);
    debug.deletedOssObjects = Number(deletion.deletedOssObjects || 0);
    debug.deletedLocalFiles = Number(deletion.deletedLocalFiles || 0);
    debug.referencedSkipCount = referencedSkipCount;
    debug.deletedOssKeysPreview = (deletion.deletedOssKeys || []).slice(0, 30);
    debug.failedOssKeysPreview = (deletion.failedOssKeys || []).slice(0, 30);
    debug.ossError = deletion.ossError || "";
    result.generations = result.generations || 0;
    result.files = deletedFiles;
  }

  // ─── 删除日志 ────────────────────────────────────────────────────
  if (purgeLogs) {
    const deleted = await prisma.log.deleteMany({ where: scopeInfo.logWhere as any });
    result.logs = deleted.count;
  }

  if ((purgeAgentConversations || purgeAgentMemory) && scopeInfo.authUserId == null) {
    return bad("游客记录没有可清理的 Agent 账号数据");
  }
  if (purgeAgentConversations && scopeInfo.authUserId != null) {
    const rows = await prisma.agentConversation.findMany({
      where: { userId: scopeInfo.authUserId },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    let messages = 0;
    let runs = 0;
    let events = 0;
    let generationLinks = 0;
    for (const row of rows) {
      const deleted = await hardDeleteAgentConversation({ userId: scopeInfo.authUserId, conversationId: row.id });
      messages += deleted.deleted.messages;
      runs += deleted.deleted.runs;
      events += deleted.deleted.events;
      generationLinks += deleted.deleted.generationLinks;
    }
    result.agentConversations = rows.length;
    result.agentMessages = messages;
    result.agentRuns = runs;
    result.agentEvents = events;
    result.agentGenerationLinks = generationLinks;
  }
  if (purgeAgentMemory && scopeInfo.authUserId != null) {
    const deleted = await deleteAgentMemoryForAdmin(scopeInfo.authUserId, { actor: auth.username });
    result.agentMemories = deleted.deletedCount;
    result.agentMemoryProfiles = 1;
  }

  // 管理员密码确认的“清理用户数据”同时重置统一提示词库；两个免密快捷清理
  // 只处理失败任务/孤儿导入，不应意外清除用户提示词。
  if (scopeInfo.authUserId != null && !canSkipAdminPassword && (purgeGenerations || purgeLogs)) {
    const legacyScan = await scanLegacyPromptPresets({
      publicDir: resolvePublicDir(),
      presetUserIds: scopeInfo.presetUserIds,
    });
    const accountReset = await prisma.$transaction(async (tx) => {
      const promptDeletion = await resetAdminUserPromptPresetData(tx, {
        authUserId: scopeInfo.authUserId!,
        marker: {
          version: legacyScan.version,
          digest: legacyScan.digest,
        },
      });
      const roleSkillDeletion = await resetAdminUserRoleSkillData(tx, {
        authUserId: scopeInfo.authUserId!,
      });
      return { promptDeletion, roleSkillDeletion };
    });
    const { promptDeletion, roleSkillDeletion } = accountReset;
    result.builtinPromptDeletions =
      promptDeletion.deletedBuiltinPromptDeletions;
    result.promptPresetMigrationStates =
      promptDeletion.deletedPromptPresetMigrationStates;
    result.promptPresets = promptDeletion.deletedPromptPresets;
    result.userRoleSkills = roleSkillDeletion.deletedUserRoleSkills;
    const coverDeletion = roleSkillDeletion.roleSkillCoverRefs.length
      ? await deleteStoredMediaRefs(roleSkillDeletion.roleSkillCoverRefs, { localOnly: true })
      : null;
    result.roleSkillCoverFiles = Number(coverDeletion?.deletedLocalFiles || 0)
      + Number(coverDeletion?.deletedOssObjects || 0);
  }

  // 记录操作日志
  await prisma.log
    .create({
      data: {
        userId: "system",
        category: "admin",
        action: "user_data_purge",
        level: "warning",
        message: `清理用户数据 ${targetLabel}`,
        metadata: JSON.stringify({
          userId,
          username: targetUsername,
          authUserId: scopeInfo.authUserId,
          linkedUserIds: scopeInfo.linkedUserIds,
          purgeGenerations,
          generationTypes: generationTypes.length > 0 ? generationTypes : "all",
          purgeLogs,
          purgeAgentConversations,
          purgeAgentMemory,
          result,
          debug,
          by: auth.username,
        }),
      },
    })
    .catch(() => null);

  await enqueueAdminEvent({
    eventType: "user_data_purged",
    entityType: "user",
    entityId: scopeInfo.authUserId ?? userId,
    userId,
    authUserId: scopeInfo.authUserId,
    payload: {
      linkedUserIds: scopeInfo.linkedUserIds,
      purgeGenerations,
      generationTypes: generationTypes.length > 0 ? generationTypes : "all",
      purgeLogs,
      purgeAgentConversations,
      purgeAgentMemory,
      result,
    },
  }).catch(() => null);
  await writeAdminAuditLog({
    operator: auth.username,
    action: "user_data_purge",
    targetType: "User",
    targetId: scopeInfo.authUserId ?? userId,
    before: { userId, authUserId: scopeInfo.authUserId, username: targetUsername, linkedUserIds: scopeInfo.linkedUserIds },
    after: { result, purgeGenerations, generationTypes: generationTypes.length > 0 ? generationTypes : "all", purgeLogs, purgeAgentConversations, purgeAgentMemory },
    req,
  }).catch(() => null);

  // 清理用户数据后摘要快照失效，强制下次请求重算。
  await invalidateAdminUserSummariesCache();

  return NextResponse.json({ ok: true, result, debug });
}
