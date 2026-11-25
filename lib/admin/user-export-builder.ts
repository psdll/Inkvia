import fs from "fs-extra";
import path from "path";
import { createReadStream } from "node:fs";
import { ZipFile } from "yazl";
import prisma from "@/lib/prisma";
import { resolveAdminUserScope } from "@/lib/admin-user-scope";
import { resolvePublicDir, resolvePublicPath, resolveProjectRootDir } from "@/lib/public-path";
import { assertDiskSpace, formatBytes, getMaxExportBytes } from "@/lib/admin/user-transfer-limits";
import { computeExportPackProgress } from "@/lib/admin/user-export-progress";
import { readAgentMemoryFile } from "@/lib/admin/legacy-agent-data/memory-file";
import { accountExportRecord } from "@/lib/admin/account-export";
import { sealMigrationCredential } from "@/lib/admin/user-migration-package";
import { exportRuntimeRecords } from '@/lib/admin/legacy-agent-data/runtime-transfer';
import { materializeCanvasTransferRecord } from '@/lib/canvas/transfer-record';
import { collectCanvasNodeMediaIds } from '@/lib/canvas/media-references';
import type { CanvasNode } from '@/lib/canvas/document';

/**
 * 用户数据流式打包构建器。
 *
 * 与旧的同步导出路由（一次性 readFile + JSZip.generateAsync 全量 buffer）不同：
 * 这里用 archiver 边读边压边写到磁盘临时文件，物理文件通过 fs.createReadStream
 * 逐个喂入，全程内存恒定，不随文件总量飙升。
 *
 * 查询与文件路径收集逻辑沿用原 app/api/admin/user/export/route.ts，
 * 保持导出内容（含 material_asset_selection_events 等）与旧版完全一致。
 */

export type UserExportOptions = {
  generations: boolean;
  inputFiles: boolean;
  presets: boolean;
  mediaLibrary: boolean;
  materialAssets: boolean;
  agentData: boolean;
  workspaceData: boolean;
  memories: boolean;
  billing: boolean;
  feedback: boolean;
  logs: boolean;
};

export type ExportStage = "query" | "collect" | "pack" | "done";

export type ExportProgressFn = (p: {
  stage: ExportStage;
  progress: number;
}) => void | Promise<void>;

export type BuildResult = {
  fileName: string;
  fileSize: number;
  manifest: Record<string, unknown>;
};

const PRESET_SCOPES = ["face_swap", "face_defect", "face_swap_defect", "image", "video"] as const;

export const DEFAULT_EXPORT_OPTIONS: UserExportOptions = {
  generations: true,
  inputFiles: true,
  presets: true,
  mediaLibrary: true,
  materialAssets: true,
  agentData: true,
  workspaceData: true,
  memories: true,
  billing: true,
  feedback: true,
  logs: false,
};

export function normalizeExportOptions(
  raw: Partial<UserExportOptions> | null | undefined,
): UserExportOptions {
  return { ...DEFAULT_EXPORT_OPTIONS, ...(raw ?? {}) };
}

/**
 * 导出 ZIP 的磁盘临时目录。
 * 关键：放在项目根的 .exports/ 下，**不在 public/ 内**，否则 Next 会把它当静态资源，
 * 任何人无需 token 即可通过 URL 直链下载，绕过权限校验。
 */
export function getExportsDir(): string {
  const configured = String(process.env.EXPORTS_DIR || "").trim();
  if (configured) return path.resolve(configured);
  return path.join(resolveProjectRootDir(), ".exports");
}

// 递归从任意 JSON 值中提取 /uploads/ 路径
function collectPathsFromValue(val: unknown, out: Set<string>) {
  if (typeof val === "string") {
    if (val.startsWith("/uploads/")) out.add(val);
    return;
  }
  if (Array.isArray(val)) {
    for (const v of val) collectPathsFromValue(v, out);
    return;
  }
  if (val && typeof val === "object") {
    for (const v of Object.values(val as Record<string, unknown>)) {
      collectPathsFromValue(v, out);
    }
  }
}

function tryParseJson(s: string | null | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function stringifyArchive(value: unknown) {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2);
}

export type PromptPresetArchiveV2 = {
  version: 2;
  customPrompts: Array<{
    id: string;
    name: string;
    category: string;
    content: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  }>;
  deletedBuiltinKeys: string[];
};

export async function buildPromptPresetArchiveV2(
  client: any,
  authUserId: number,
): Promise<PromptPresetArchiveV2> {
  const [customRows, deletionRows] = await Promise.all([
    client.promptPreset.findMany({
      where: { authUserId },
      orderBy: { id: "asc" },
    }),
    client.userBuiltinPromptDeletion.findMany({
      where: { authUserId },
      orderBy: { builtinPromptPresetId: "asc" },
      select: {
        builtinPromptPreset: {
          select: { key: true },
        },
      },
    }),
  ]);
  return {
    version: 2,
    customPrompts: customRows.map((row: any) => ({
      id: String(row.id),
      name: row.name,
      category: row.category,
      content: row.content,
      revision: row.revision,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
    })),
    deletedBuiltinKeys: deletionRows.map(
      (row: any) => String(row.builtinPromptPreset.key),
    ),
  };
}

export type UserRoleSkillArchiveV1 = {
  version: 1;
  skills: Array<{
    id: string;
    name: string;
    summary: string;
    category: string;
    coverUrl: string | null;
    content: string;
    usageScenario: string;
    usageGuide: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
  }>;
};

export async function buildUserRoleSkillArchiveV1(
  client: any,
  authUserId: number,
): Promise<UserRoleSkillArchiveV1> {
  const rows = await client.userRoleSkill.findMany({
    where: { authUserId },
    orderBy: { id: "asc" },
  });
  return {
    version: 1,
    skills: rows.map((row: any) => ({
      id: String(row.id),
      name: row.name,
      summary: row.summary,
      category: row.category,
      coverUrl: row.coverUrl || null,
      content: row.content,
      usageScenario: row.usageScenario,
      usageGuide: row.usageGuide,
      revision: row.revision,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
    })),
  };
}

// 清理用作 ZIP 根目录名 / 文件名的字符串，避免非法路径字符
function safeName(s: string): string {
  return (s || "user").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 80);
}

/**
 * 把用户全部数据流式打包成 ZIP 写入 outPath。
 * 返回面向用户的文件名、最终文件大小、manifest。
 */
export async function buildUserExportZip(params: {
  userId: string;
  authUserId: number | null;
  options: UserExportOptions;
  outPath: string;
  migrationPassphrase?: string;
  onProgress?: ExportProgressFn;
}): Promise<BuildResult> {
  const { userId, authUserId, options: opts, outPath, onProgress, migrationPassphrase } = params;

  const emit = async (stage: ExportStage, progress: number) => {
    try {
      await onProgress?.({ stage, progress });
    } catch {
      // 进度回调失败不应中断打包
    }
  };

  await emit("query", 5);

  const scope = await resolveAdminUserScope(userId, authUserId, { explicitIdentity: true });
  const effectiveAuthUserId = scope.authUserId;

  // ─── 始终查询 User 记录 ───────────────────────────────────────
  const userRecord =
    effectiveAuthUserId != null
      ? await prisma.user.findUnique({ where: { id: effectiveAuthUserId }, select: { id: true, username: true, createdAt: true, updatedAt: true, ...(migrationPassphrase ? { password: true, passwordCipher: true, credentialVersion: true } : {}) } })
      : null;
  if (migrationPassphrase && !userRecord) throw new Error("MIGRATION_ACCOUNT_REQUIRED: 迁移导出需要已注册账号");
  const migrationCredential = migrationPassphrase && userRecord
    ? await sealMigrationCredential(userRecord as { id: number; password: string; passwordCipher: unknown; credentialVersion: number }, migrationPassphrase)
    : undefined;

  // ─── Generation + generation logs（始终查，用于 inputMaterials 还原）───
  const generations = opts.generations
    ? await prisma.generation.findMany({
        where: scope.generationWhere as any,
        orderBy: { id: "asc" },
      })
    : [];

  const generationIds = generations.map((g) => g.id);

  const generationLogs = generationIds.length
    ? await prisma.log.findMany({
        where: { generationId: { in: generationIds }, category: "generation" },
        orderBy: { id: "asc" },
      })
    : [];

  // ─── 消费账单 ────────────────────────────────────────────────
  const usageLedger = opts.billing
    ? await prisma.usageLedger.findMany({
        where:
          effectiveAuthUserId != null
            ? {
                OR: [
                  { authUserId: effectiveAuthUserId },
                  { authUserId: null, userId: { in: scope.linkedGuestUserIds } },
                ],
              }
            : { authUserId: null, userId: { in: scope.linkedGuestUserIds } },
        orderBy: { id: "asc" },
      })
    : [];

  // ─── 私人素材库 ──────────────────────────────────────────────
  const mediaLibrary =
    opts.mediaLibrary && effectiveAuthUserId != null
      ? await prisma.mediaLibraryItem.findMany({
          where: { ownerUserId: effectiveAuthUserId },
          orderBy: { id: "asc" },
        })
      : [];

  // ─── 素材资产 ────────────────────────────────────────────────
  let materialAssets =
    opts.materialAssets && effectiveAuthUserId != null
      ? await prisma.materialAsset.findMany({
          where: {
            OR: [
              { createdByUserId: effectiveAuthUserId },
              { selectedByUserId: effectiveAuthUserId },
            ],
          },
          orderBy: { id: "asc" },
        })
      : [];

  const materialAssetSelectionEvents =
    opts.materialAssets && effectiveAuthUserId != null
      ? await prisma.materialAssetSelectionEvent.findMany({
          where: { userId: effectiveAuthUserId },
          orderBy: { id: "asc" },
        })
      : [];

  const materialAssetDownloads =
    opts.materialAssets && effectiveAuthUserId != null
      ? await prisma.materialAssetDownload.findMany({
          where: { userId: effectiveAuthUserId },
          orderBy: { id: "asc" },
        })
      : [];

  const referencedAssetIds = Array.from(
    new Set([
      ...materialAssetSelectionEvents.map((event) => event.assetId),
      ...materialAssetDownloads.map((download) => download.assetId),
    ]),
  ).filter((id) => !materialAssets.some((asset) => asset.id === id));
  if (opts.materialAssets && referencedAssetIds.length) {
    const referencedAssets = await prisma.materialAsset.findMany({
      where: { id: { in: referencedAssetIds } },
      orderBy: { id: "asc" },
    });
    materialAssets = [...materialAssets, ...referencedAssets].sort((a, b) => a.id - b.id);
  }

  // ─── Agent 数据 ──────────────────────────────────────────────
  const agentConversations =
    opts.agentData && effectiveAuthUserId != null
      ? await prisma.agentConversation.findMany({
          where: { userId: effectiveAuthUserId },
          orderBy: { id: "asc" },
        })
      : [];

  const conversationIds = agentConversations.map((c) => c.id);

  const agentMessages =
    opts.agentData && conversationIds.length
      ? await prisma.agentMessage.findMany({
          where: { conversationId: { in: conversationIds } },
          orderBy: { id: "asc" },
        })
      : [];

  const agentRuns =
    opts.agentData && effectiveAuthUserId != null
      ? await prisma.agentRun.findMany({
          where: { userId: effectiveAuthUserId },
          orderBy: { id: "asc" },
        })
      : [];

  const agentRunIds = agentRuns.map((run) => run.id);
  const agentRuntimeRecords = opts.agentData && effectiveAuthUserId != null ? await exportRuntimeRecords(effectiveAuthUserId) : [];
  const agentEvents =
    opts.agentData && agentRunIds.length
      ? await prisma.agentEvent.findMany({
          where: { runId: { in: agentRunIds } },
          orderBy: [{ runId: "asc" }, { sequence: "asc" }],
        })
      : [];
  const agentGenerationLinks =
    opts.agentData && agentRunIds.length
      ? await prisma.agentGenerationLink.findMany({
          where: { runId: { in: agentRunIds } },
          orderBy: [{ runId: "asc" }, { createdAt: "asc" }],
        })
      : [];

  const agentMemoryProfile =
    opts.memories && effectiveAuthUserId != null
      ? await prisma.agentMemoryProfile.findUnique({ where: { userId: effectiveAuthUserId } })
      : null;
  const agentMemoryArchive = agentMemoryProfile ? [{
    schemaVersion: 1,
    userId: agentMemoryProfile.userId,
    revision: agentMemoryProfile.revision,
    deletedAt: agentMemoryProfile.deletedAt?.toISOString() || null,
  }] : [];
  const agentMemorySnapshot = agentMemoryProfile
    && !agentMemoryProfile.deletedAt
    && agentMemoryProfile.fileSyncedAt
    && !agentMemoryProfile.syncError
    ? await readAgentMemoryFile(agentMemoryProfile.userId, agentMemoryProfile.revision).catch(() => null)
    : null;

  const canvasProjects =
    opts.workspaceData && effectiveAuthUserId != null
      ? await prisma.canvasProject.findMany({
          where: { authUserId: effectiveAuthUserId },
          orderBy: { id: "asc" },
        })
      : [];
  const canvasRows =
    opts.workspaceData && effectiveAuthUserId != null
      ? await prisma.canvas.findMany({
          where: { authUserId: effectiveAuthUserId },
          orderBy: { id: "asc" },
        })
      : [];
  const canvases = [];
  for (const row of canvasRows) {
    const current = await prisma.$transaction(async tx => {
      const canvas = await tx.canvas.findFirst({ where: { id: row.id, authUserId: effectiveAuthUserId! } });
      if (!canvas) throw new Error("画布在导出期间已删除，请重新导出");
      return materializeCanvasTransferRecord(tx, canvas);
    }, { isolationLevel: "RepeatableRead" });
    canvases.push(current);
  }
  const canvasMediaIds = [...new Set(canvases.flatMap(canvas => {
    const nodes = (canvas.data as { nodes?: CanvasNode[] }).nodes ?? [];
    return nodes.flatMap(collectCanvasNodeMediaIds);
  }))];
  const canvasMediaAssets = canvasMediaIds.length ? await prisma.mediaAsset.findMany({ where: { id: { in: canvasMediaIds } } }) : [];
  if (canvasMediaAssets.length !== canvasMediaIds.length) throw new Error("画布引用了缺失的媒体记录，不能生成完整备份");
  const canvasIds = canvases.map((canvas) => canvas.id);
  const canvasRuns =
    opts.workspaceData && canvasIds.length
      ? await prisma.canvasRun.findMany({
          where: { canvasId: { in: canvasIds } },
          orderBy: { id: "asc" },
        })
      : [];
  const promptReverseTasks =
    opts.workspaceData && effectiveAuthUserId != null
      ? await prisma.promptReverseTask.findMany({
          where: { authUserId: effectiveAuthUserId },
          orderBy: { id: "asc" },
        })
      : [];
  const userRoleSkills =
    opts.workspaceData && effectiveAuthUserId != null
      ? await buildUserRoleSkillArchiveV1(prisma, effectiveAuthUserId)
      : { version: 1 as const, skills: [] };

  const imageBatches =
    opts.workspaceData && effectiveAuthUserId != null
      ? await (prisma as any).imageBatch.findMany({
          where: { authUserId: effectiveAuthUserId },
          orderBy: { createdAt: "asc" },
        })
      : [];
  const imageBatchIds = imageBatches.map((batch: any) => batch.id);
  const imageBatchGroups = imageBatchIds.length
    ? await (prisma as any).imageBatchGroup.findMany({
        where: { batchId: { in: imageBatchIds } },
        orderBy: [{ batchId: "asc" }, { position: "asc" }],
      })
    : [];
  const imageBatchItems = imageBatchIds.length
    ? await (prisma as any).imageBatchItem.findMany({
        where: { batchId: { in: imageBatchIds } },
        orderBy: [{ batchId: "asc" }, { position: "asc" }],
      })
    : [];
  const imageBatchMedia = imageBatchIds.length
    ? await (prisma as any).imageBatchMedia.findMany({
        where: { batchId: { in: imageBatchIds } },
        orderBy: [{ batchId: "asc" }, { itemId: "asc" }, { role: "asc" }, { position: "asc" }],
        include: { media: true },
      })
    : [];
  const imageBatchOutputs = imageBatchIds.length
    ? await (prisma as any).imageBatchOutput.findMany({
        where: { batchId: { in: imageBatchIds } },
        orderBy: [{ batchId: "asc" }, { itemId: "asc" }, { slotIndex: "asc" }, { attempt: "asc" }],
      })
    : [];
  const liveVideoBatches =
    opts.workspaceData && effectiveAuthUserId != null
      ? await (prisma as any).liveVideoBatch.findMany({
          where: { authUserId: effectiveAuthUserId },
          orderBy: { createdAt: "asc" },
        })
      : [];
  const liveVideoBatchIds = liveVideoBatches.map((batch: any) => batch.id);
  const liveVideoBatchItems = liveVideoBatchIds.length
    ? await (prisma as any).liveVideoBatchItem.findMany({
        where: { batchId: { in: liveVideoBatchIds } },
        orderBy: [{ batchId: "asc" }, { position: "asc" }],
        include: { sourceMedia: true },
      })
    : [];
  const liveVideoPromptJobs = liveVideoBatchIds.length
    ? await (prisma as any).liveVideoPromptJob.findMany({
        where: { batchId: { in: liveVideoBatchIds } },
        orderBy: [{ batchId: "asc" }, { itemId: "asc" }, { attempt: "asc" }],
      })
    : [];
  const liveVideoBatchOutputs = liveVideoBatchIds.length
    ? await (prisma as any).liveVideoBatchOutput.findMany({
        where: { batchId: { in: liveVideoBatchIds } },
        orderBy: [{ batchId: "asc" }, { itemId: "asc" }, { attempt: "asc" }],
      })
    : [];
  const toolWorkspaceDrafts =
    opts.workspaceData && effectiveAuthUserId != null
      ? await (prisma as any).toolWorkspaceDraft.findMany({
          where: { authUserId: effectiveAuthUserId },
          orderBy: [{ tool: "asc" }, { createdAt: "asc" }],
        })
      : [];
  const toolWorkspaceDraftIds = toolWorkspaceDrafts.map((draft: any) => draft.id);
  const toolWorkspaceDraftMedia = toolWorkspaceDraftIds.length
    ? await (prisma as any).toolWorkspaceDraftMedia.findMany({
        where: { draftId: { in: toolWorkspaceDraftIds } },
        orderBy: [{ draftId: "asc" }, { position: "asc" }],
        include: { media: true },
      })
    : [];

  // ─── 用户记忆 ────────────────────────────────────────────────
  const userMemories =
    opts.memories && effectiveAuthUserId != null
      ? await prisma.userMemory.findMany({
          where: { userId: effectiveAuthUserId },
          orderBy: { id: "asc" },
        })
      : [];

  // ─── 操作日志 ────────────────────────────────────────────────
  const userLogs = opts.logs
    ? await prisma.log.findMany({ where: scope.logWhere as any, orderBy: { id: "asc" } })
    : [];

  // ─── 问题反馈（存于 Log.action=feedback_submit，独立导出，不依赖完整日志开关）──
  const feedbackLogs = opts.feedback
    ? await prisma.log.findMany({
        where: { AND: [scope.logWhere as any, { action: "feedback_submit" }] },
        orderBy: { id: "asc" },
      })
    : [];

  // ─── 预设文件内容 ────────────────────────────────────────────
  const presetContents: Record<string, string> = {};
  const promptPresets =
    opts.presets && effectiveAuthUserId != null
      ? await buildPromptPresetArchiveV2(prisma, effectiveAuthUserId)
      : {
          version: 2 as const,
          customPrompts: [],
          deletedBuiltinKeys: [],
        };
  if (opts.presets) {
    for (const presetUserId of scope.presetUserIds) {
      for (const sc of PRESET_SCOPES) {
        const filePath = resolvePublicPath("uploads", "presets", presetUserId, `${sc}.json`);
        if (await fs.pathExists(filePath)) {
          try {
            presetContents[`${presetUserId}/${sc}.json`] = await fs.readFile(filePath, "utf8");
          } catch {
            // 跳过不可读的预设文件
          }
        }
      }
    }
  }

  await emit("collect", 30);

  // ─── 收集所有需要打包的文件路径 ─────────────────────────────
  const filePaths = new Set<string>();

  if (opts.generations) {
    for (const g of generations) {
      if (g.localPath) collectPathsFromValue(g.localPath, filePaths);
      const td = tryParseJson(g.templateData);
      if (td) collectPathsFromValue(td, filePaths);
    }
  }

  if (opts.inputFiles) {
    for (const log of generationLogs) {
      const meta = tryParseJson(log.metadata);
      if (meta) collectPathsFromValue(meta, filePaths);
    }
  }

  if (opts.mediaLibrary) {
    for (const item of mediaLibrary) {
      collectPathsFromValue(item.fileUrl, filePaths);
      if (item.thumbnailUrl) collectPathsFromValue(item.thumbnailUrl, filePaths);
    }
  }

  if (opts.materialAssets) {
    for (const asset of materialAssets) {
      collectPathsFromValue(asset.imageUrl, filePaths);
      if (asset.thumbnailUrl) collectPathsFromValue(asset.thumbnailUrl, filePaths);
      if (asset.previewUrl) collectPathsFromValue(asset.previewUrl, filePaths);
      collectPathsFromValue(asset.media, filePaths);
    }
  }

  if (opts.workspaceData) {
    collectPathsFromValue(canvases, filePaths);
    collectPathsFromValue(canvasMediaAssets, filePaths);
    collectPathsFromValue(canvasRuns, filePaths);
    collectPathsFromValue(promptReverseTasks, filePaths);
    collectPathsFromValue(userRoleSkills.skills, filePaths);
    collectPathsFromValue(imageBatchMedia, filePaths);
    collectPathsFromValue(imageBatchOutputs, filePaths);
    collectPathsFromValue(liveVideoBatchItems, filePaths);
    collectPathsFromValue(liveVideoPromptJobs, filePaths);
    collectPathsFromValue(liveVideoBatchOutputs, filePaths);
    collectPathsFromValue(toolWorkspaceDraftMedia, filePaths);
  }

  // ─── 准备 yazl 流式写盘 ──────────────────────────────────────
  // 用 yazl 而非 archiver：archiver v8 的 package.json exports 字段与 Next 14
  // webpack 解析器不兼容（报 "Default condition should be last one"，仅运行时 500）。
  // yazl 是纯 CommonJS、无 exports 字段，且 addFile 原生从磁盘流式读取、输出也是流，
  // 同样满足"内存恒定、不全量缓冲"的核心目标。
  const dateStr = new Date().toISOString().slice(0, 10);
  const username = userRecord?.username ?? userId;
  const rootDir = `user_export_${safeName(username)}_${dateStr}`;
  const fileName = `user_export_${safeName(username)}_${dateStr}.zip`;

  const missing: string[] = [];
  const filesToZip: Array<{ localPath: string; diskPath: string; size: number }> = [];
  let totalPhysicalBytes = 0;
  const uploadsRoot = path.resolve(resolvePublicPath("uploads"));
  for (const rawLocalPath of Array.from(filePaths).sort()) {
    const localPath = String(rawLocalPath || "").replace(/\\/g, "/");
    if (!localPath.startsWith("/uploads/")) continue;

    const rel = localPath.slice("/uploads/".length);
    const diskPath = path.resolve(uploadsRoot, rel);
    if (diskPath === uploadsRoot || !diskPath.startsWith(uploadsRoot + path.sep)) {
      missing.push(`${localPath} (非法路径)`);
      continue;
    }

    const stat = await fs.stat(diskPath).catch(() => null);
    if (stat?.isFile()) {
      const size = Number(stat.size || 0);
      totalPhysicalBytes += size;
      filesToZip.push({ localPath, diskPath, size });
    } else {
      missing.push(localPath);
    }
  }

  const maxExportBytes = getMaxExportBytes();
  if (totalPhysicalBytes > maxExportBytes) {
    throw new Error(`导出包超过上限 ${formatBytes(maxExportBytes)}，当前文件约 ${formatBytes(totalPhysicalBytes)}`);
  }

  await fs.ensureDir(path.dirname(outPath));
  await assertDiskSpace(path.dirname(outPath), totalPhysicalBytes, "导出");
  const output = fs.createWriteStream(outPath);
  const zip = new ZipFile();

  const closed = new Promise<void>((resolve, reject) => {
    output.on("close", () => resolve());
    output.on("error", reject);
    zip.outputStream.on("error", reject);
  });

  zip.outputStream.pipe(output);

  // JSON / 文本：用 deflate 压缩（文本可观收益）
  const append = (content: string, name: string) =>
    zip.addBuffer(Buffer.from(content, "utf8"), name, { compress: true });

  // DB 数据
  append(JSON.stringify(userRecord ? { ...accountExportRecord(userRecord), ...(migrationCredential ? { migrationCredential } : {}) } : null, null, 2), `${rootDir}/data/user.json`);
  if (opts.generations) {
    append(JSON.stringify(generations, null, 2), `${rootDir}/data/generations.json`);
  }
  // generation_logs 始终包含（对还原 inputMaterials 关键）
  append(JSON.stringify(generationLogs, null, 2), `${rootDir}/data/generation_logs.json`);
  if (opts.billing) {
    append(JSON.stringify(usageLedger, null, 2), `${rootDir}/data/usage_ledger.json`);
  }
  if (opts.mediaLibrary) {
    append(JSON.stringify(mediaLibrary, null, 2), `${rootDir}/data/media_library.json`);
  }
  if (opts.materialAssets) {
    append(JSON.stringify(materialAssets, null, 2), `${rootDir}/data/material_assets.json`);
    append(
      JSON.stringify(materialAssetDownloads, null, 2),
      `${rootDir}/data/material_asset_downloads.json`,
    );
    append(
      JSON.stringify(materialAssetSelectionEvents, null, 2),
      `${rootDir}/data/material_asset_selection_events.json`,
    );
  }
  if (opts.agentData) {
    append(JSON.stringify(agentConversations, null, 2), `${rootDir}/data/agent_conversations.json`);
    append(JSON.stringify(agentMessages, null, 2), `${rootDir}/data/agent_messages.json`);
    append(JSON.stringify(agentRuns, null, 2), `${rootDir}/data/agent_runs.json`);
    append(JSON.stringify(agentRuntimeRecords, null, 2), `${rootDir}/data/agent_runtime.json`);
    append(stringifyArchive(agentEvents), `${rootDir}/data/agent_events.json`);
    append(stringifyArchive(agentGenerationLinks), `${rootDir}/data/agent_generation_links.json`);
  }
  if (opts.workspaceData) {
    append(JSON.stringify(canvasProjects, null, 2), `${rootDir}/data/canvas_projects.json`);
    append(stringifyArchive(canvases), `${rootDir}/data/canvases.json`);
    append(stringifyArchive(canvasMediaAssets), `${rootDir}/data/canvas_media_assets.json`);
    append(stringifyArchive(canvasRuns), `${rootDir}/data/canvas_runs.json`);
    append(stringifyArchive(promptReverseTasks), `${rootDir}/data/prompt_reverse_tasks.json`);
    append(stringifyArchive(userRoleSkills), `${rootDir}/data/user_role_skills.json`);
    append(stringifyArchive(imageBatches), `${rootDir}/data/image_batches.json`);
    append(stringifyArchive(imageBatchGroups), `${rootDir}/data/image_batch_groups.json`);
    append(stringifyArchive(imageBatchItems), `${rootDir}/data/image_batch_items.json`);
    append(stringifyArchive(imageBatchMedia), `${rootDir}/data/image_batch_media.json`);
    append(stringifyArchive(imageBatchOutputs), `${rootDir}/data/image_batch_outputs.json`);
    append(stringifyArchive(liveVideoBatches), `${rootDir}/data/live_video_batches.json`);
    append(stringifyArchive(liveVideoBatchItems), `${rootDir}/data/live_video_batch_items.json`);
    append(stringifyArchive(liveVideoPromptJobs), `${rootDir}/data/live_video_prompt_jobs.json`);
    append(stringifyArchive(liveVideoBatchOutputs), `${rootDir}/data/live_video_batch_outputs.json`);
    append(stringifyArchive(toolWorkspaceDrafts), `${rootDir}/data/tool_workspace_drafts.json`);
    append(stringifyArchive(toolWorkspaceDraftMedia), `${rootDir}/data/tool_workspace_draft_media.json`);
  }
  if (opts.memories) {
    append(JSON.stringify(userMemories, null, 2), `${rootDir}/data/user_memories.json`);
    append(JSON.stringify(agentMemoryArchive, null, 2), `${rootDir}/data/agent_memory_profile.json`);
    if (agentMemorySnapshot) append(JSON.stringify(agentMemorySnapshot, null, 2), `${rootDir}/agent/.Agent`);
  }
  if (opts.logs) {
    append(JSON.stringify(userLogs, null, 2), `${rootDir}/data/logs.json`);
  }
  if (opts.feedback) {
    append(JSON.stringify(feedbackLogs, null, 2), `${rootDir}/data/feedback.json`);
  }

  // 预设文件
  if (opts.presets) {
    append(
      stringifyArchive(promptPresets),
      `${rootDir}/data/prompt_presets.json`,
    );
    for (const [name, content] of Object.entries(presetContents)) {
      append(content, `${rootDir}/presets/${name}`);
    }
  }

  // ─── 物理文件：逐个流式 append ───────────────────────────────
  await emit("pack", 35);
  let fileCount = 0;

  for (const { localPath, diskPath, size } of filesToZip) {
    zip.addReadStreamLazy(
      `${rootDir}/files${localPath}`,
      { size, compress: false, forceZip64Format: size > 0xffffffff },
      (cb) => cb(null, createReadStream(diskPath)),
    );
    fileCount++;
  }

  // manifest 最后 append，保证计数准确
  const manifest = {
    version: 1,
    promptPresetsVersion: 2,
    ...(opts.workspaceData ? { roleSkillsVersion: 1 } : {}),
    canvasTransferVersion: 1,
    exportedAt: new Date().toISOString(),
    userId,
    authUserId: effectiveAuthUserId,
    username: userRecord?.username ?? null,
    options: opts,
    stats: {
      user: userRecord ? 1 : 0,
      generations: generations.length,
      generationLogs: generationLogs.length,
      usageLedger: usageLedger.length,
      mediaLibrary: mediaLibrary.length,
      materialAssets: materialAssets.length,
      materialAssetDownloads: materialAssetDownloads.length,
      materialAssetSelectionEvents: materialAssetSelectionEvents.length,
      agentConversations: agentConversations.length,
      agentMessages: agentMessages.length,
      agentRuns: agentRuns.length,
      agentEvents: agentEvents.length,
      agentGenerationLinks: agentGenerationLinks.length,
      canvasProjects: canvasProjects.length,
      canvases: canvases.length,
      canvasMediaAssets: canvasMediaAssets.length,
      canvasRuns: canvasRuns.length,
      promptReverseTasks: promptReverseTasks.length,
      ...(opts.workspaceData ? { userRoleSkills: userRoleSkills.skills.length } : {}),
      imageBatches: imageBatches.length,
      imageBatchGroups: imageBatchGroups.length,
      imageBatchItems: imageBatchItems.length,
      imageBatchMedia: imageBatchMedia.length,
      imageBatchOutputs: imageBatchOutputs.length,
      liveVideoBatches: liveVideoBatches.length,
      liveVideoBatchItems: liveVideoBatchItems.length,
      liveVideoPromptJobs: liveVideoPromptJobs.length,
      liveVideoBatchOutputs: liveVideoBatchOutputs.length,
      toolWorkspaceDrafts: toolWorkspaceDrafts.length,
      toolWorkspaceDraftMedia: toolWorkspaceDraftMedia.length,
      userMemories: userMemories.length,
      agentMemoryProfiles: agentMemoryArchive.length,
      agentMemoryFile: agentMemorySnapshot ? 1 : 0,
      userLogs: userLogs.length,
      feedback: feedbackLogs.length,
      promptCustomPrompts: promptPresets.customPrompts.length,
      promptDeletedBuiltinKeys: promptPresets.deletedBuiltinKeys.length,
      presetFiles: Object.keys(presetContents).length,
      files: fileCount,
    },
    missing,
  };
  append(JSON.stringify(manifest, null, 2), `${rootDir}/manifest.json`);

  let lastReportedPackProgress = 35;
  const reportPackProgress = () => {
    const progress = computeExportPackProgress(output.bytesWritten, Math.max(totalPhysicalBytes, 1));
    if (progress <= lastReportedPackProgress) return;
    lastReportedPackProgress = progress;
    void emit("pack", progress);
  };
  const progressTimer = setInterval(reportPackProgress, 1_000);
  progressTimer.unref();
  reportPackProgress();
  try {
    if (totalPhysicalBytes > 0xffffffff || fileCount > 65534) {
      zip.end({ forceZip64Format: true, comment: "" });
    } else {
      zip.end();
    }
    await closed;
  } finally {
    clearInterval(progressTimer);
  }

  const stat = await fs.stat(outPath);
  if (stat.size > maxExportBytes) {
    await fs.remove(outPath).catch(() => {});
    throw new Error(`最终 ZIP 超过上限 ${formatBytes(maxExportBytes)}，实际 ${formatBytes(stat.size)}`);
  }
  await emit("pack", 98);
  await emit("done", 100);

  return { fileName, fileSize: stat.size, manifest };
}
