import { apiErrorMessage } from "@/i18n/api-message";
﻿import { NextRequest, NextResponse } from "next/server";
import fs from "fs-extra";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import { resolveAdminUserScope, invalidateAdminUserSummariesCache } from "@/lib/admin-user-scope";
import { markAdminAssetFeedDeleted } from "@/lib/admin-asset-feed";
import { resolvePublicPath } from "@/lib/public-path";
import { collectMediaRefs, deleteStoredMediaRefs } from "@/lib/media-cleanup";
import { enqueueAdminEvent, writeAdminAuditLog } from "@/lib/admin-operational";
import { tombstoneAdminUserSummary } from "@/lib/admin-user-summary-read-model";
import { deleteAdminUserCanvasAndAccount } from "@/lib/admin-user-delete";
import { parseAdminWorksAdminKey } from "@/lib/admin-user-works";
import { deleteGenerationOutputLinks } from "@/lib/generation-physical-delete";
import { deleteAgentMemoryDirectoryForUser, resolveAgentMemoryFilePath } from "@/lib/admin/legacy-agent-data/memory-file";

export const runtime = "nodejs";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(message) }, { status });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message || "未知错误";
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "未知错误";
  }
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);

  const body = await req.json().catch(() => null);
  if (!body) return bad("请求体无效");
  const adminPassword = String(body.adminPassword || "").trim();
  const expectedAdminPassword = String(process.env.ADMIN_PASSWORD || "").trim();
  if (!expectedAdminPassword || adminPassword !== expectedAdminPassword) {
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
  let stage = "解析用户范围";
  try {
    const scopeInfo = await resolveAdminUserScope(userId, authUserId, {
      explicitIdentity: true,
    });

    stage = "读取目标用户名";
    // 在删除账号前先抓用户名，方便审计日志显示「利文斌(ID:12)」而不是只有 ID
    let targetUsername: string | null = null;
    if (scopeInfo.authUserId != null) {
      const u = await prisma.user
        .findUnique({ where: { id: scopeInfo.authUserId }, select: { username: true } })
        .catch(() => null);
      targetUsername = u?.username || null;
    }
    const targetLabel = targetUsername ? `${targetUsername}(ID:${userId})` : `游客 ${userId}`;

    stage = "查询资产与日志";
    const gens = await prisma.generation.findMany({
      where: scopeInfo.generationWhere as any,
      select: { id: true, localPath: true, templateData: true }
    });
    const logs = await prisma.log.findMany({
      where: scopeInfo.logWhere as any,
      select: { id: true, metadata: true }
    });

    stage = "收集待删除媒体";
    const mediaRefs = new Set<string>();
    for (const g of gens) {
      if (g.localPath) collectMediaRefs(g.localPath, mediaRefs);
      if (g.templateData) collectMediaRefs(g.templateData, mediaRefs);
    }
    for (const log of logs) collectMediaRefs(log.metadata, mediaRefs);
    const canvasMediaRows =
      scopeInfo.authUserId != null
        ? await prisma.mediaAsset.findMany({
            where: { ownerUserId: scopeInfo.authUserId },
            select: {
              originalKey: true,
              publicUrl: true,
              variants: true,
              metadata: true,
            },
          })
        : [];
    for (const media of canvasMediaRows) {
      collectMediaRefs(media.originalKey, mediaRefs);
      collectMediaRefs(media.publicUrl, mediaRefs);
      collectMediaRefs(media.variants, mediaRefs);
      collectMediaRefs(media.metadata, mediaRefs);
    }
    let deletedFiles = 0;

    stage = "删除资产";
    await markAdminAssetFeedDeleted(gens.map((g) => g.id)).catch(() => 0);
    await (prisma as any).adminWorkFeed
      ?.updateMany({
        where: { generationId: { in: gens.map((g) => g.id) } },
        data: { status: "deleted", deletedAt: new Date(), updatedAt: new Date() },
      })
      .catch(() => null);
    const deletedGenerations = await prisma.$transaction(async (tx) => {
      await deleteGenerationOutputLinks(tx, gens.map((generation) => generation.id));
      return tx.generation.deleteMany({ where: scopeInfo.generationWhere as any });
    });

    stage = "删除媒体库";
    // ─── 私有产品库（MediaLibraryItem，含磁盘文件）────────────────────
    // ownerUserId 维度，关系是 SetNull，不会随 User 删除而清理，需显式删除行 + 磁盘文件。
    let deletedMediaLibraryItems = 0;
    if (scopeInfo.authUserId != null) {
      const mediaRows = await prisma.mediaLibraryItem
        .findMany({
          where: { ownerUserId: scopeInfo.authUserId },
          select: { id: true, fileUrl: true, thumbnailUrl: true },
        })
        .catch(() => [] as Array<{ id: number; fileUrl: string; thumbnailUrl: string | null }>);
      if (mediaRows.length) {
        const mlIds = mediaRows.map((r) => r.id);
        const delMl = await prisma.mediaLibraryItem.deleteMany({ where: { id: { in: mlIds } } }).catch(() => ({ count: 0 }));
        deletedMediaLibraryItems = delMl.count || 0;
        const mlDeletion = await deleteStoredMediaRefs(
          mediaRows.flatMap((r) => [r.fileUrl, r.thumbnailUrl]),
          {
            allowMaterialDeletion: true,
            excludeMediaLibraryItemIds: mlIds,
            excludeGenerationIds: gens.map((g) => g.id),
          }
        ).catch(() => null);
        deletedFiles += Number(mlDeletion?.deletedLocalFiles || 0) + Number(mlDeletion?.deletedOssObjects || 0);
      }
    }

    stage = "删除账单与分析";
    // ─── 用量/计费账单 + 用户分析聚合（与 User 无级联，需显式删除）──────
    const deletedUsageLedgers = await prisma.usageLedger
      .deleteMany({ where: scopeInfo.generationWhere as any })
      .catch(() => ({ count: 0 }));
    const deletedAnalytics = await prisma.analyticsDailyByUser
      .deleteMany({ where: scopeInfo.generationWhere as any })
      .catch(() => ({ count: 0 }));

    stage = "删除 Agent 运行记录";
    // ─── Agent 运行记录（AgentRun 与 User 无级联，按 userId=authUserId 显式删除）──
    // 注：AgentConversation / AgentMessage / UserMemory / MaterialAssetDownload 均为 Cascade，随 User 删除自动清理。
    const deletedAgentRuns =
      scopeInfo.authUserId != null
        ? await (await import('@/lib/admin/legacy-agent-data/runtime-retention')).deleteUserRuntimeRuns(scopeInfo.authUserId)
        : { count: 0 };

    stage = "删除日志";
    const deletedLogs = await prisma.log.deleteMany({ where: scopeInfo.logWhere as any });
    let deletedCanvases = 0;
    let deletedCanvasProjects = 0;
    let deletedCanvasMutations = 0;
    let deletedCanvasMemberships = 0;
    let deletedImageBatches = 0;
    let deletedToolWorkspaceDrafts = 0;
    let deletedCanvasMediaAssets = 0;
    let deletedBuiltinPromptDeletions = 0;
    let deletedPromptPresetMigrationStates = 0;
    let deletedPromptPresets = 0;
    let deletedUserRoleSkills = 0;
    let roleSkillCoverRefs: string[] = [];
    let deletedUsers = 0;
    let deletedAgentMemoryFiles = 0;
    if (scopeInfo.authUserId != null) {
      stage = "删除画布与用户账号";
      const canvasDeletion = await prisma.$transaction((tx) =>
        deleteAdminUserCanvasAndAccount(tx, scopeInfo.authUserId!)
      );
      deletedCanvases = canvasDeletion.deletedCanvases;
      deletedCanvasProjects = canvasDeletion.deletedCanvasProjects;
      deletedCanvasMutations = canvasDeletion.deletedCanvasMutations;
      deletedCanvasMemberships = canvasDeletion.deletedCanvasMemberships;
      deletedImageBatches = canvasDeletion.deletedImageBatches;
      deletedToolWorkspaceDrafts = canvasDeletion.deletedToolWorkspaceDrafts;
      deletedCanvasMediaAssets = canvasDeletion.deletedCanvasMediaAssets;
      deletedBuiltinPromptDeletions =
        canvasDeletion.deletedBuiltinPromptDeletions;
      deletedPromptPresetMigrationStates =
        canvasDeletion.deletedPromptPresetMigrationStates;
      deletedPromptPresets = canvasDeletion.deletedPromptPresets;
      deletedUserRoleSkills = canvasDeletion.deletedUserRoleSkills;
      roleSkillCoverRefs = canvasDeletion.roleSkillCoverRefs;
      deletedUsers = canvasDeletion.deletedUsers;

      stage = "删除用户 .Agent 文件";
      const agentMemoryPath = resolveAgentMemoryFilePath(scopeInfo.authUserId);
      const agentMemoryExisted = await fs.pathExists(agentMemoryPath).catch(() => false);
      await deleteAgentMemoryDirectoryForUser(scopeInfo.authUserId);
      deletedAgentMemoryFiles = agentMemoryExisted ? 1 : 0;
    }

    stage = "同步删除用户汇总";
    const summaryDeletedAt = new Date();
    await tombstoneAdminUserSummary({
      userId,
      authUserId: scopeInfo.authUserId,
      linkedGuestUserIds: scopeInfo.linkedGuestUserIds,
      deletedAt: summaryDeletedAt,
    });

    stage = "删除本地与云端媒体";
    // 先删数据库记录，再由统一清理器做跨用户共享引用保护。
    // 旧实现在此之前还有一段未受保护的逐文件删除，既重复 IO 又可能误删共享文件。
    const ossDeletion = await deleteStoredMediaRefs(Array.from(mediaRefs));
    deletedFiles += Number(ossDeletion.deletedLocalFiles || 0) + Number(ossDeletion.deletedOssObjects || 0);
    const roleSkillCoverDeletion = roleSkillCoverRefs.length
      ? await deleteStoredMediaRefs(roleSkillCoverRefs, { localOnly: true })
      : null;
    const deletedRoleSkillCoverFiles = Number(roleSkillCoverDeletion?.deletedLocalFiles || 0)
      + Number(roleSkillCoverDeletion?.deletedOssObjects || 0);
    deletedFiles += deletedRoleSkillCoverFiles;

    stage = "删除用户预设目录";
    for (const presetUserId of scopeInfo.presetUserIds) {
      const presetDir = resolvePublicPath("uploads", "presets", presetUserId);
      const presetExists = await fs.pathExists(presetDir).catch(() => false);
      if (presetExists) {
        await fs.remove(presetDir).catch(() => null);
        deletedFiles++;
      }
    }

    stage = "写入审计日志";
    await prisma.log
      .create({
        data: {
          userId: "system",
          category: "admin",
          action: "user_purge",
          level: "warning",
          message: `彻底删除用户 ${targetLabel}`,
          metadata: JSON.stringify({
            userId,
            username: targetUsername,
            authUserId: scopeInfo.authUserId,
            linkedUserIds: scopeInfo.linkedUserIds,
            deletedFiles,
            deletedGenerations: deletedGenerations.count,
            deletedMediaLibraryItems,
            deletedUsageLedgers: deletedUsageLedgers.count,
            deletedAnalytics: deletedAnalytics.count,
            deletedAgentRuns: deletedAgentRuns.count,
            deletedAgentMemoryFiles,
            deletedCanvases,
            deletedCanvasProjects,
            deletedCanvasMutations,
            deletedCanvasMemberships,
            deletedCanvasMediaAssets,
            deletedImageBatches,
            deletedToolWorkspaceDrafts,
            deletedBuiltinPromptDeletions,
            deletedPromptPresetMigrationStates,
            deletedPromptPresets,
            deletedUserRoleSkills,
            deletedRoleSkillCoverFiles,
            deletedLogs: deletedLogs.count,
            deletedUsers,
            deletedOssObjects: Number(ossDeletion.deletedOssObjects || 0),
            deletedLocalFiles: Number(ossDeletion.deletedLocalFiles || 0),
            deletedOssKeysPreview: (ossDeletion.deletedOssKeys || []).slice(0, 30),
            failedOssKeysPreview: (ossDeletion.failedOssKeys || []).slice(0, 30),
            by: auth.username
          })
        }
      })
      .catch(() => null);

    await enqueueAdminEvent({
      eventType: "user_deleted",
      entityType: "user",
      entityId: scopeInfo.authUserId ?? userId,
      userId,
      authUserId: scopeInfo.authUserId,
      occurredAt: summaryDeletedAt,
      payload: {
        linkedUserIds: scopeInfo.linkedUserIds,
        linkedGuestUserIds: scopeInfo.linkedGuestUserIds,
        deletedGenerations: deletedGenerations.count,
        deletedUsers,
        deletedFiles,
        deletedCanvases,
        deletedCanvasMutations,
        deletedCanvasMediaAssets,
        deletedImageBatches,
        deletedToolWorkspaceDrafts,
        deletedUserRoleSkills,
        deletedRoleSkillCoverFiles,
        deletedAgentMemoryFiles,
      },
    }).catch(() => null);
    await writeAdminAuditLog({
      operator: auth.username,
      action: "user_hard_delete",
      targetType: "User",
      targetId: scopeInfo.authUserId ?? userId,
      before: { userId, authUserId: scopeInfo.authUserId, username: targetUsername, linkedUserIds: scopeInfo.linkedUserIds },
      after: {
        deletedGenerations: deletedGenerations.count,
        deletedUsers,
        deletedFiles,
        deletedCanvases,
        deletedCanvasMutations,
        deletedCanvasMediaAssets,
        deletedImageBatches,
        deletedToolWorkspaceDrafts,
        deletedUserRoleSkills,
        deletedRoleSkillCoverFiles,
      },
      req,
    }).catch(() => null);

    // 用户被删除，后台用户摘要快照失效，强制下次请求重算。
    await invalidateAdminUserSummariesCache();

    return NextResponse.json({
      ok: true,
      deletedFiles,
      deletedGenerations: deletedGenerations.count,
      deletedMediaLibraryItems,
      deletedUsageLedgers: deletedUsageLedgers.count,
      deletedAnalytics: deletedAnalytics.count,
      deletedAgentRuns: deletedAgentRuns.count,
      deletedAgentMemoryFiles,
      deletedCanvases,
      deletedCanvasProjects,
      deletedCanvasMutations,
      deletedCanvasMemberships,
      deletedCanvasMediaAssets,
      deletedImageBatches,
      deletedToolWorkspaceDrafts,
      deletedBuiltinPromptDeletions,
      deletedPromptPresetMigrationStates,
      deletedPromptPresets,
      deletedUserRoleSkills,
      deletedRoleSkillCoverFiles,
      deletedLogs: deletedLogs.count,
      deletedUsers,
      debug: {
        deletedOssObjects: Number(ossDeletion.deletedOssObjects || 0),
        deletedLocalFiles: Number(ossDeletion.deletedLocalFiles || 0),
        deletedOssKeysPreview: (ossDeletion.deletedOssKeys || []).slice(0, 30),
        failedOssKeysPreview: (ossDeletion.failedOssKeys || []).slice(0, 30),
        ossError: ossDeletion.ossError || ""
      }
    });
  } catch (error) {
    const message = getErrorMessage(error);
    const detail = `删除用户失败（${stage}）：${message}`;
    console.error("[admin/user/delete] purge failed", {
      stage,
      requestedUserId: userId,
      requestedAuthUserId: authUserId,
      message,
      error,
    });
    return NextResponse.json(
      {
        error: apiErrorMessage(detail),
        debug: {
          stage,
          requestedUserId: userId,
          requestedAuthUserId: authUserId,
          message,
          stack: process.env.NODE_ENV !== "production" && error instanceof Error ? error.stack || "" : "",
        }
      },
      { status: 500 }
    );
  }
}
