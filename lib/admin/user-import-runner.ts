import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import { pipeline } from "node:stream/promises";
import * as yauzl from "yauzl";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { prepareCanvasArchiveRows, restoreCanvasMediaAssets } from "@/lib/canvas/transfer-record";
import { syncCanvasCurrentMediaReferences } from "@/lib/canvas/prisma-mutation-store";
import type { CanvasNode } from "@/lib/canvas/document";
import { resolvePublicDir, resolvePublicPath } from "@/lib/public-path";
import { getImportsDir } from "@/lib/admin/user-transfer-paths";
import {
  assertDiskSpace,
  formatBytes,
  getMaxImportBytes,
  getMaxImportFiles,
  getMaxJsonBytes,
} from "@/lib/admin/user-transfer-limits";
import {
  assertArchiveRowCount,
  mergeRestoreRowsById,
  parseArchiveJsonRows,
  restoreRowsWithId,
  type RestoreRowsOptions,
  type RestoreRowsResult,
} from "@/lib/admin/user-import-restore";
import {
  classifyImportTarget,
  FileConflictError,
  openExclusiveImportTarget,
} from "@/lib/admin/user-import-files";
import {
  assertDurableWorkAdmission,
  runUserImportRestoreCreate,
} from "@/lib/maintenance";
import { planImportedAccount, restoreImportedAccount, ImportAccountInputError } from "@/lib/admin/user-import-account";
import { unwrapMigrationArchive, openMigrationCredential } from "@/lib/admin/user-migration-package";
import { parseImportAccountOptions, type ImportAccountOptions } from "@/lib/admin/user-migration-contracts";
import { normalizePromptInput } from "@/lib/prompt-presets/contracts";
import { normalizeRoleSkillInput } from "@/lib/role-skills/contracts";
import {
  scanLegacyPromptPresets,
  type LegacyPromptScan,
} from "@/lib/prompt-presets/migration";
import type {
  PromptPresetArchiveV2,
  UserRoleSkillArchiveV1,
} from "@/lib/admin/user-export-builder";
import {
  agentMemoryProfileArchiveSchema,
  rebuildAgentMemoryProfileAfterImport,
} from "@/lib/admin/legacy-agent-data/memory-profile-service";
import {
  parseAgentEventArchiveRows,
  parseAgentGenerationLinkArchiveRows,
  remapAgentTransferRows,
} from "@/lib/admin/legacy-agent-data/transfer";

const IMPORT_TTL_MS = 2 * 60 * 60 * 1000;
const USER_IMPORT_HEARTBEAT_MS = 60 * 1000;
const DATA_SUFFIXES = [
  "data/user.json",
  "data/generations.json",
  "data/generation_logs.json",
  "data/usage_ledger.json",
  "data/media_library.json",
  "data/material_assets.json",
  "data/material_asset_downloads.json",
  "data/material_asset_selection_events.json",
  "data/agent_conversations.json",
  "data/agent_messages.json",
  "data/agent_runs.json",
  "data/agent_runtime.json",
  "data/agent_events.json",
  "data/agent_generation_links.json",
  "data/canvas_projects.json",
  "data/canvases.json",
  "data/canvas_media_assets.json",
  "data/canvas_runs.json",
  "data/prompt_reverse_tasks.json",
  "data/user_role_skills.json",
  "data/prompt_presets.json",
  "data/image_batches.json",
  "data/image_batch_groups.json",
  "data/image_batch_items.json",
  "data/image_batch_media.json",
  "data/image_batch_outputs.json",
  "data/live_video_batches.json",
  "data/live_video_batch_items.json",
  "data/live_video_prompt_jobs.json",
  "data/live_video_batch_outputs.json",
  "data/tool_workspace_drafts.json",
  "data/tool_workspace_draft_media.json",
  "data/user_memories.json",
  "data/agent_memory_profile.json",
  "data/logs.json",
  "data/feedback.json",
] as const;

type DataSuffix = typeof DATA_SUFFIXES[number];
type ZipFileEntry = { name: string; uncompressedSize: number };
type ImportStage =
  | "upload"
  | "parse"
  | "read"
  | "check"
  | "db_user"
  | "db_gen"
  | "db_other"
  | "db_agent"
  | "db_logs"
  | "seq"
  | "presets"
  | "files"
  | "done";

type ZipSummary = {
  manifest: Record<string, any>;
  data: Partial<Record<DataSuffix, string>>;
  presetEntries: ZipFileEntry[];
  fileEntries: ZipFileEntry[];
  entryCount: number;
  uncompressedBytes: number;
};

function importJobModel() {
  return (prisma as any).userImportJob;
}

async function emit(jobId: string, stage: ImportStage, progress: number) {
  await importJobModel()
    .update({
      where: { id: jobId },
      data: { stage, progress: Math.max(0, Math.min(100, Math.round(progress))) },
    })
    .catch(() => {});
}

function fixDates<T extends Record<string, any>>(rows: T[], fields: string[]): T[] {
  return rows.map((row) => {
    const out = { ...row } as Record<string, any>;
    for (const field of fields) {
      if (out[field] != null) out[field] = new Date(out[field]);
    }
    return out as T;
  });
}

// 导入包只含被导出用户自己的账号记录，但素材库/媒体库里可能引用了「别的创建者/操作者」
// （运营上传到共享库的素材），这些用户 id 不在导入包里。直接插入会触发外键报错
// （如 MaterialAsset_createdByUserId_fkey）导致整单中断。这里把指向「目标库不存在的用户」
// 的可空外键置 null（这些字段本就是 SetNull 关系），保留记录本身。
function nullMissingUserRefs<T extends Record<string, any>>(rows: T[], fields: string[], validUserIds: Set<number>): T[] {
  return rows.map((row) => {
    const out = { ...row } as Record<string, any>;
    for (const field of fields) {
      const v = out[field];
      if (v != null && !validUserIds.has(Number(v))) out[field] = null;
    }
    return out as T;
  });
}

// 必填外键（如 MaterialAssetDownload.userId）无法置 null，指向缺失用户的行整行丢弃。
function dropMissingUserRefRows<T extends Record<string, any>>(rows: T[], field: string, validUserIds: Set<number>): { kept: T[]; dropped: number } {
  const kept: T[] = [];
  let dropped = 0;
  for (const row of rows) {
    const v = (row as Record<string, any>)[field];
    if (v == null || validUserIds.has(Number(v))) kept.push(row);
    else dropped += 1;
  }
  return { kept, dropped };
}

function comparable(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value === "object" && "toJSON" in value && typeof (value as any).toJSON === "function") {
    return comparable((value as any).toJSON());
  }
  return JSON.stringify(value);
}

function equivalentArchivedRow(existing: Record<string, any>, archived: Record<string, any>) {
  return Object.keys(archived)
    .filter((key) => key !== "id")
    .every((key) => comparable(existing[key]) === comparable(archived[key]));
}

const RESTORE_IDENTITY_FIELDS: Record<string, string[]> = {
  generation: ["authUserId", "userId", "type", "source", "createdAt"],
  usageLedger: ["authUserId", "userId", "generationId", "module", "occurredAt"],
  mediaLibraryItem: ["ownerUserId", "fileUrl", "createdAt"],
  materialAsset: ["imageUrl", "title", "createdAt"],
  materialAssetDownload: ["assetId", "userId", "downloadedAt"],
  materialAssetSelectionEvent: ["assetId", "userId", "action", "occurredAt"],
  agentConversation: ["userId", "createdAt"],
  agentMessage: ["conversationId", "userId", "role", "createdAt"],
  agentRun: ["userId", "conversationId", "model", "purpose", "createdAt"],
  canvasProject: ["authUserId", "name", "createdAt"],
  canvas: ["authUserId", "createdAt"],
  canvasRun: ["authUserId", "canvasId", "startedAt"],
  promptReverseTask: ["authUserId", "userId", "createdAt"],
  userMemory: ["userId", "type", "key"],
  log: ["userId", "generationId", "category", "action", "createdAt"],
};

const RESTORE_IDENTITY_TIME_FIELDS: Record<string, string> = {
  generation: "createdAt",
  mediaLibraryItem: "createdAt",
  materialAsset: "createdAt",
  materialAssetDownload: "downloadedAt",
  materialAssetSelectionEvent: "occurredAt",
  agentConversation: "createdAt",
  agentMessage: "createdAt",
  agentRun: "createdAt",
  canvasProject: "createdAt",
  canvas: "createdAt",
  canvasRun: "startedAt",
  promptReverseTask: "createdAt",
  log: "createdAt",
};

function equivalentRestoreIdentity(modelName: string, existing: Record<string, any>, archived: Record<string, any>) {
  const fields = RESTORE_IDENTITY_FIELDS[modelName];
  if (!fields?.length) return equivalentArchivedRow(existing, archived);
  return fields.every((field) => comparable(existing[field]) === comparable(archived[field]));
}

function restoreIdentityKey(modelName: string, row: Record<string, any>): string | null {
  const fields = RESTORE_IDENTITY_FIELDS[modelName];
  if (!fields?.length) return null;
  return JSON.stringify(fields.map((field) => comparable(row[field])));
}

async function findExistingByRestoreIdentity(
  tx: any,
  modelName: string,
  rows: Array<Record<string, any> & { id: number }>,
) {
  const timeField = RESTORE_IDENTITY_TIME_FIELDS[modelName];
  if (!timeField) return [];
  const valuesByKey = new Map<string, any>();
  for (const row of rows) {
    const value = row[timeField];
    if (value != null) valuesByKey.set(comparable(value), value);
  }
  const values = Array.from(valuesByKey.values());
  const existing: Array<Record<string, any> & { id: number }> = [];
  for (let index = 0; index < values.length; index += 500) {
    const chunk = values.slice(index, index + 500);
    existing.push(...await tx[modelName].findMany({ where: { [timeField]: { in: chunk } } }));
  }
  return existing;
}

function usageLedgerUniqueKey(row: Record<string, any>): string | null {
  return row.generationId == null ? null : String(row.generationId);
}

function userMemoryUniqueKey(row: Record<string, any>): string | null {
  if (row.userId == null || row.type == null || row.key == null) return null;
  return JSON.stringify([Number(row.userId), String(row.type), String(row.key)]);
}

async function resetSequence(client: any, tableName: string) {
  try {
    await client.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${tableName}"', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM "${tableName}"), 1))`,
    );
  } catch {
    // Ignore non-serial tables and non-PostgreSQL deployments.
  }
}

async function restoreTable(
  tx: any,
  modelName: string,
  tableName: string,
  rows: Array<Record<string, any> & { id: number }>,
  stats: Record<string, number>,
  statKey: string,
  options: Pick<RestoreRowsOptions<any>, "reuseByUniqueKey"> = {},
): Promise<RestoreRowsResult> {
  const identityReuse = RESTORE_IDENTITY_TIME_FIELDS[modelName]
    ? {
        key: (row: Record<string, any>) => restoreIdentityKey(modelName, row),
        findExisting: (restoreRows: Array<Record<string, any> & { id: number }>) =>
          findExistingByRestoreIdentity(tx, modelName, restoreRows),
      }
    : undefined;
  const result = await restoreRowsWithId(tx[modelName], rows, {
    equivalent: (existing, archived) => equivalentRestoreIdentity(modelName, existing, archived),
    prepareAutoIds: () => resetSequence(tx, tableName),
    reuseByUniqueKey: options.reuseByUniqueKey ?? identityReuse,
    ...options,
  });
  stats[statKey] = result.restored;
  if (result.inserted) stats[`${statKey}Inserted`] = result.inserted;
  if (result.reused) stats[`${statKey}Reused`] = result.reused;
  if (result.remapped) stats[`${statKey}Remapped`] = result.remapped;
  return result;
}

function remapForeignKey<T extends Record<string, any>>(
  rows: T[],
  field: string,
  idMap: Map<number, number>,
  options: { nullable?: boolean } = {},
): T[] {
  return rows.map((row) => {
    const sourceId = row[field];
    if (sourceId == null) return row;
    const targetId = idMap.get(Number(sourceId));
    if (targetId != null) return { ...row, [field]: targetId };
    if (options.nullable) return { ...row, [field]: null };
    throw new Error(`${field}=${sourceId} 缺少对应的父记录，无法完整导入`);
  });
}

function remapImportedUserFields<T extends Record<string, any>>(
  rows: T[],
  sourceUserId: number,
  targetUserId: number,
  fields: { numeric?: string[]; textual?: string[] },
): T[] {
  const sourceText = String(sourceUserId);
  const targetText = String(targetUserId);
  return rows.map((row) => {
    const out = { ...row } as Record<string, any>;
    for (const field of fields.numeric || []) {
      if (out[field] != null && Number(out[field]) === sourceUserId) out[field] = targetUserId;
    }
    for (const field of fields.textual || []) {
      if (out[field] != null && String(out[field]) === sourceText) out[field] = targetText;
    }
    return out as T;
  });
}

export async function parsePromptPresetArchiveForImport(
  manifest: Record<string, any>,
  raw: string | undefined,
): Promise<PromptPresetArchiveV2 | null> {
  const promptDataDeclared = Object.prototype.hasOwnProperty.call(
    manifest,
    "promptPresetsVersion",
  )
    || Object.prototype.hasOwnProperty.call(
      manifest?.stats || {},
      "promptCustomPrompts",
    )
    || Object.prototype.hasOwnProperty.call(
      manifest?.stats || {},
      "promptDeletedBuiltinKeys",
    );
  if (raw === undefined) {
    if (promptDataDeclared) {
      throw new Error("manifest 声明了 prompt preset 数据，但缺少 data/prompt_presets.json");
    }
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("data/prompt_presets.json JSON 损坏");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("data/prompt_presets.json 格式无效");
  }
  const archive = value as Partial<PromptPresetArchiveV2>;
  if (
    archive.version !== 2
    || !Array.isArray(archive.customPrompts)
    || !Array.isArray(archive.deletedBuiltinKeys)
  ) {
    throw new Error("data/prompt_presets.json 必须使用 version 2 格式");
  }
  assertArchiveRowCount(
    manifest,
    "promptCustomPrompts",
    archive.customPrompts,
    "prompt custom prompts",
  );
  assertArchiveRowCount(
    manifest,
    "promptDeletedBuiltinKeys",
    archive.deletedBuiltinKeys,
    "prompt deleted builtin keys",
  );
  return archive as PromptPresetArchiveV2;
}

function promptArchiveDate(value: unknown, field: string, nullable = false) {
  if (nullable && (value === null || value === undefined || value === "")) {
    return null;
  }
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`promptPresets.${field} 无效`);
  }
  return date;
}

export async function restorePromptPresetArchiveV2(input: {
  tx: any;
  targetAuthUserId: number;
  sourceArchiveUserId: number;
  archive: unknown;
  warnings: string[];
  legacyScan?: LegacyPromptScan | null;
}) {
  const { tx, targetAuthUserId, sourceArchiveUserId, warnings } = input;
  const archive = input.archive as Partial<PromptPresetArchiveV2> | null;
  if (
    !archive
    || archive.version !== 2
    || !Array.isArray(archive.customPrompts)
    || !Array.isArray(archive.deletedBuiltinKeys)
  ) {
    throw new Error("promptPresets 必须使用 version 2 格式");
  }
  if (!Number.isSafeInteger(targetAuthUserId) || targetAuthUserId <= 0) {
    throw new Error("目标 authUserId 无效");
  }
  if (!Number.isSafeInteger(sourceArchiveUserId) || sourceArchiveUserId <= 0) {
    throw new Error("源归档 authUserId 无效");
  }

  const warningStart = warnings.length;
  const subjectKey = `user:${targetAuthUserId}:user-json`;
  const customPrompts = archive.customPrompts.map((archived) => {
    if (!archived || typeof archived !== "object" || Array.isArray(archived)) {
      throw new Error("promptPresets.customPrompts 包含无效记录");
    }
    if (
      typeof archived.id !== "string"
      || !/^[1-9]\d*$/.test(archived.id)
      || BigInt(archived.id) > BigInt("9223372036854775807")
    ) {
      throw new Error("promptPresets.customPrompts.id 必须是 canonical 正 BigInt 十进制字符串");
    }
    const legacyKey = `import:v2:user:${sourceArchiveUserId}:prompt:${archived.id}`;
    const value = normalizePromptInput({
      name: String(archived.name || ""),
      category: String(archived.category || ""),
      content: String(archived.content || ""),
    });
    const revision = Number(archived.revision);
    if (!Number.isInteger(revision) || revision < 1) {
      throw new Error("promptPresets.revision 必须是正整数");
    }
    return {
      legacyKey,
      ...value,
      revision,
      createdAt: promptArchiveDate(archived.createdAt, "createdAt"),
      updatedAt: promptArchiveDate(archived.updatedAt, "updatedAt"),
      deletedAt: promptArchiveDate(archived.deletedAt, "deletedAt", true),
    };
  });
  const requestedKeys = [
    ...new Set(archive.deletedBuiltinKeys.map((key, index) => {
      if (
        typeof key !== "string"
        || key.length < 1
        || key.length > 256
        || key.trim() !== key
        || /[\u0000-\u001F\u007F]/.test(key)
      ) {
        throw new Error(`promptPresets.deletedBuiltinKeys[${index}] 无效`);
      }
      return key;
    })),
  ];

  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtext(${subjectKey}))::text
  `;

  let restoredCustomPrompts = 0;
  let skippedCustomPrompts = 0;
  for (const customPrompt of customPrompts) {
    const existing = await tx.promptPreset.findUnique({
      where: {
        authUserId_legacyKey: {
          authUserId: targetAuthUserId,
          legacyKey: customPrompt.legacyKey,
        },
      },
      select: { id: true },
    });
    if (existing) {
      skippedCustomPrompts += 1;
      continue;
    }
    await tx.promptPreset.create({
      data: {
        authUserId: targetAuthUserId,
        ...customPrompt,
      },
    });
    restoredCustomPrompts += 1;
  }

  const builtins = requestedKeys.length
    ? await tx.builtinPromptPreset.findMany({
        where: { key: { in: requestedKeys } },
        select: { id: true, key: true },
      })
    : [];
  const builtinByKey = new Map<string, { id: bigint; key: string }>(
    builtins.map((builtin: any) => [
      String(builtin.key),
      { id: builtin.id, key: String(builtin.key) },
    ]),
  );
  let restoredDeletedBuiltins = 0;
  for (const key of requestedKeys) {
    const builtin = builtinByKey.get(key);
    if (!builtin) {
      warnings.push(`目标服务器缺少内置提示词 key：${key}，已跳过`);
      continue;
    }
    await tx.userBuiltinPromptDeletion.upsert({
      where: {
        authUserId_builtinPromptPresetId: {
          authUserId: targetAuthUserId,
          builtinPromptPresetId: builtin.id,
        },
      },
      create: {
        authUserId: targetAuthUserId,
        builtinPromptPresetId: builtin.id,
      },
      update: {},
    });
    restoredDeletedBuiltins += 1;
  }

  if (input.legacyScan) {
    const marker = {
      subjectKey,
      authUserId: targetAuthUserId,
      source: "user-json",
      version: input.legacyScan.version,
      digest: input.legacyScan.digest,
      rowCount: input.legacyScan.validCount,
      completedAt: new Date(),
    };
    await tx.promptPresetMigrationState.upsert({
      where: { subjectKey },
      create: marker,
      update: marker,
    });
  }

  return {
    customPrompts: restoredCustomPrompts,
    customPromptsSkipped: skippedCustomPrompts,
    deletedBuiltins: restoredDeletedBuiltins,
    warnings: warnings.length - warningStart,
  };
}

const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");

function roleSkillArchiveDate(value: unknown, field: string, nullable = false) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) throw new Error(`userRoleSkills.${field} 无效`);
  return date;
}

function canonicalRoleSkillId(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new Error("userRoleSkills.id 必须是 canonical 正 BigInt 十进制字符串");
  }
  const id = BigInt(value);
  if (id > MAX_POSTGRES_BIGINT) {
    throw new Error("userRoleSkills.id 超出 PostgreSQL BigInt 范围");
  }
  return id;
}

export function rewriteRoleSkillCoverUrlForImport(
  value: unknown,
  sourceArchiveUserId: number,
  targetAuthUserId: number,
) {
  if (value === null || value === undefined || value === "") return null;
  const coverUrl = String(value).replace(/\\/g, "/");
  const sourcePrefix = `/uploads/role_skill_covers/users/${sourceArchiveUserId}/`;
  if (!coverUrl.startsWith(sourcePrefix) || coverUrl.includes("..")) {
    throw new Error("userRoleSkills.coverUrl 不属于源归档账号");
  }
  return `/uploads/role_skill_covers/users/${targetAuthUserId}/${coverUrl.slice(sourcePrefix.length)}`;
}

export async function parseUserRoleSkillArchiveForImport(
  manifest: Record<string, any>,
  raw: string | undefined,
): Promise<UserRoleSkillArchiveV1 | null> {
  const declared = Object.prototype.hasOwnProperty.call(manifest, "roleSkillsVersion")
    || Object.prototype.hasOwnProperty.call(manifest?.stats || {}, "userRoleSkills");
  if (raw === undefined) {
    // Older selective exports declared the format even when workspace data was excluded.
    if (manifest?.options?.workspaceData === false && manifest?.stats?.userRoleSkills === 0) return null;
    if (declared) throw new Error("manifest 声明了用户技能数据，但缺少 data/user_role_skills.json");
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("data/user_role_skills.json JSON 损坏");
  }
  const archive = value as Partial<UserRoleSkillArchiveV1> | null;
  if (!archive || archive.version !== 1 || !Array.isArray(archive.skills)) {
    throw new Error("data/user_role_skills.json 必须使用 version 1 格式");
  }
  assertArchiveRowCount(manifest, "userRoleSkills", archive.skills, "user role skills");
  return archive as UserRoleSkillArchiveV1;
}

function equivalentImportedRoleSkill(existing: Record<string, any>, data: Record<string, any>) {
  return [
    "authUserId",
    "name",
    "summary",
    "category",
    "coverUrl",
    "content",
    "usageScenario",
    "usageGuide",
    "revision",
    "deletedAt",
    "createdAt",
    "updatedAt",
  ].every((field) => comparable(existing[field]) === comparable(data[field]));
}

export async function restoreUserRoleSkillArchiveV1(input: {
  tx: any;
  targetAuthUserId: number;
  sourceArchiveUserId: number;
  archive: unknown;
}) {
  const { tx, targetAuthUserId, sourceArchiveUserId } = input;
  const archive = input.archive as Partial<UserRoleSkillArchiveV1> | null;
  if (!archive || archive.version !== 1 || !Array.isArray(archive.skills)) {
    throw new Error("userRoleSkills 必须使用 version 1 格式");
  }
  if (!Number.isSafeInteger(targetAuthUserId) || targetAuthUserId <= 0) {
    throw new Error("目标 authUserId 无效");
  }
  if (!Number.isSafeInteger(sourceArchiveUserId) || sourceArchiveUserId <= 0) {
    throw new Error("源归档 authUserId 无效");
  }

  const prepared = archive.skills.map((archived) => {
    if (!archived || typeof archived !== "object" || Array.isArray(archived)) {
      throw new Error("userRoleSkills.skills 包含无效记录");
    }
    const sourceId = canonicalRoleSkillId(archived.id);
    // V1 archives store skill content; the derived editor workspace is not a database column.
    const { workspace: _workspace, ...value } = normalizeRoleSkillInput({
      name: archived.name,
      summary: archived.summary,
      category: archived.category,
      coverUrl: rewriteRoleSkillCoverUrlForImport(
        archived.coverUrl,
        sourceArchiveUserId,
        targetAuthUserId,
      ),
      content: archived.content,
      usageScenario: archived.usageScenario,
      usageGuide: archived.usageGuide,
    });
    const revision = Number(archived.revision);
    if (!Number.isInteger(revision) || revision < 1) {
      throw new Error("userRoleSkills.revision 必须是正整数");
    }
    return {
      sourceId,
      data: {
        authUserId: targetAuthUserId,
        ...value,
        revision,
        deletedAt: roleSkillArchiveDate(archived.deletedAt, "deletedAt", true),
        createdAt: roleSkillArchiveDate(archived.createdAt, "createdAt"),
        updatedAt: roleSkillArchiveDate(archived.updatedAt, "updatedAt"),
      },
    };
  });
  if (new Set(prepared.map((item) => item.sourceId.toString())).size !== prepared.length) {
    throw new Error("userRoleSkills 包含重复主键");
  }

  const ids = prepared.map((item) => item.sourceId);
  const dates = Array.from(new Map(prepared.map((item) => [
    (item.data.createdAt as Date).toISOString(),
    item.data.createdAt,
  ])).values());
  const [existingIds, existingCandidates] = await Promise.all([
    ids.length ? tx.userRoleSkill.findMany({ where: { id: { in: ids } } }) : [],
    dates.length
      ? tx.userRoleSkill.findMany({
          where: { authUserId: targetAuthUserId, createdAt: { in: dates } },
        })
      : [],
  ]);
  const byId = new Map(existingIds.map((row: any) => [String(row.id), row]));
  const availableCandidates = [...existingCandidates];
  const idMap = new Map<bigint, bigint>();
  const collisions: typeof prepared = [];
  let inserted = 0;
  let reused = 0;

  for (const item of prepared) {
    const repeatedIndex = availableCandidates.findIndex(
      (row: any) => equivalentImportedRoleSkill(row, item.data),
    );
    if (repeatedIndex >= 0) {
      const [repeated] = availableCandidates.splice(repeatedIndex, 1);
      idMap.set(item.sourceId, BigInt(repeated.id));
      reused += 1;
      continue;
    }
    const existing = byId.get(item.sourceId.toString());
    if (existing) {
      if (equivalentImportedRoleSkill(existing, item.data)) {
        idMap.set(item.sourceId, item.sourceId);
        reused += 1;
      } else {
        collisions.push(item);
      }
      continue;
    }
    const created = await tx.userRoleSkill.create({
      data: { id: item.sourceId, ...item.data },
    });
    idMap.set(item.sourceId, BigInt(created.id));
    inserted += 1;
  }

  if (inserted || collisions.length) await resetSequence(tx, "UserRoleSkill");
  for (const item of collisions) {
    const created = await tx.userRoleSkill.create({ data: item.data });
    idMap.set(item.sourceId, BigInt(created.id));
    inserted += 1;
  }

  return {
    restored: prepared.length,
    inserted,
    reused,
    remapped: collisions.length,
    idMap,
  };
}

export function remapPromptReverseTaskRoleSkill(
  row: Record<string, any>,
  userRoleSkillIdMap: Map<bigint, bigint>,
  warnings: string[],
) {
  if (row.skillSource !== "personal" || row.skillId == null) return row;
  const sourceId = canonicalRoleSkillId(String(row.skillId));
  const targetId = userRoleSkillIdMap.get(sourceId);
  if (targetId === undefined) {
    // Deleting a personal skill leaves historical tasks and their prompt snapshots intact.
    warnings.push(`历史任务 ${row.id} 引用的个人技能 ${sourceId} 不在归档中，已保留任务内容并解除失效关联`);
    return { ...row, skillId: null };
  }
  return { ...row, skillId: targetId };
}

const IMAGE_BATCH_RESTORE_ORDER = [
  "imageBatch",
  "imageBatchGroup",
  "imageBatchItem",
  "imageBatchMedia",
  "imageBatchOutput",
] as const;

function remapBatchSnapshot(
  value: unknown,
  batchIdMap: Map<string, string>,
  itemIdMap: Map<string, string>,
  mediaIdMap: Map<string, string>,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const snapshot = { ...(value as Record<string, any>) };
  if (snapshot.batchId) snapshot.batchId = batchIdMap.get(String(snapshot.batchId)) || snapshot.batchId;
  if (snapshot.itemId) snapshot.itemId = itemIdMap.get(String(snapshot.itemId)) || snapshot.itemId;
  if (Array.isArray(snapshot.toolMediaIds)) {
    snapshot.toolMediaIds = snapshot.toolMediaIds.map((id: unknown) => mediaIdMap.get(String(id)) || String(id));
  }
  return snapshot;
}

async function restoreImageBatchData(input: {
  tx: any;
  sourceUserId: number;
  targetUserId: number;
  generationIdMap: Map<number, number>;
  mediaIdMap: Map<string, string>;
  batches: any[];
  groups: any[];
  items: any[];
  media: any[];
  outputs: any[];
  stats: Record<string, number>;
}) {
  const { tx, targetUserId, generationIdMap, mediaIdMap, stats } = input;
  const batchIdMap = new Map<string, string>();
  const groupIdMap = new Map<string, string>();
  const itemIdMap = new Map<string, string>();
  if (typeof tx.$executeRawUnsafe === "function") {
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
      1229080391,
      targetUserId,
    );
  }
  const [groupSequenceAggregate, legacyGroupCount] = await Promise.all([
    typeof tx.imageBatchGroup.aggregate === "function"
      ? tx.imageBatchGroup.aggregate({
          where: { authUserId: targetUserId },
          _max: { sequence: true },
        })
      : { _max: { sequence: 0 } },
    typeof tx.imageBatchGroup.count === "function"
      ? tx.imageBatchGroup.count({
          where: {
            authUserId: null,
            batch: { authUserId: targetUserId },
          },
        })
      : 0,
  ]);
  let nextGroupSequence = Math.max(
    Number(groupSequenceAggregate?._max?.sequence || 0),
    Number(legacyGroupCount || 0),
  ) + 1;

  for (const archived of input.batches) {
    const sourceId = String(archived.id || "");
    if (!sourceId) continue;
    const existing = await tx.imageBatch.findUnique({ where: { id: sourceId }, select: { id: true, authUserId: true } });
    const targetId = !existing || existing.authUserId === targetUserId ? sourceId : crypto.randomUUID();
    batchIdMap.set(sourceId, targetId);
    if (existing?.authUserId === targetUserId) continue;
    const { authUser, groups, items, media, outputs, ...scalars } = archived;
    void authUser; void groups; void items; void media; void outputs;
    await tx.imageBatch.create({
      data: {
        ...fixDates([scalars], ["submittedAt", "finishedAt", "deletedAt", "createdAt", "updatedAt"])[0],
        id: targetId,
        authUserId: targetUserId,
      },
    });
    stats.imageBatch = (stats.imageBatch || 0) + 1;
  }

  for (const archived of input.groups) {
    const sourceId = String(archived.id || "");
    const targetBatchId = batchIdMap.get(String(archived.batchId || ""));
    if (!sourceId || !targetBatchId) continue;
    const existing = await tx.imageBatchGroup.findUnique({ where: { id: sourceId }, select: { id: true, batchId: true } });
    const targetId = !existing || existing.batchId === targetBatchId ? sourceId : crypto.randomUUID();
    groupIdMap.set(sourceId, targetId);
    if (existing?.batchId === targetBatchId) continue;
    const { authUser, authUserId, batch, items, sequence, ...scalars } = archived;
    void authUser; void authUserId; void batch; void items; void sequence;
    await tx.imageBatchGroup.create({
      data: {
        ...fixDates([scalars], ["hiddenAt", "createdAt", "updatedAt"])[0],
        id: targetId,
        authUserId: targetUserId,
        batchId: targetBatchId,
        sequence: nextGroupSequence,
      },
    });
    nextGroupSequence += 1;
    stats.imageBatchGroup = (stats.imageBatchGroup || 0) + 1;
  }

  for (const archived of input.items) {
    const sourceId = String(archived.id || "");
    const targetBatchId = batchIdMap.get(String(archived.batchId || ""));
    if (!sourceId || !targetBatchId) continue;
    const existing = await tx.imageBatchItem.findUnique({ where: { id: sourceId }, select: { id: true, batchId: true } });
    const targetId = !existing || existing.batchId === targetBatchId ? sourceId : crypto.randomUUID();
    itemIdMap.set(sourceId, targetId);
    if (existing?.batchId === targetBatchId) continue;
    const { batch, group, media, outputs, ...scalars } = archived;
    void batch; void group; void media; void outputs;
    await tx.imageBatchItem.create({
      data: {
        ...fixDates([scalars], ["createdAt", "updatedAt"])[0],
        id: targetId,
        batchId: targetBatchId,
        groupId: archived.groupId ? groupIdMap.get(String(archived.groupId)) || null : null,
      },
    });
    stats.imageBatchItem = (stats.imageBatchItem || 0) + 1;
  }

  for (const archived of input.media) {
    const media = archived.media && typeof archived.media === "object" ? archived.media : null;
    const sourceMediaId = String(archived.mediaId || media?.id || "");
    if (!sourceMediaId || !media) continue;
    let targetMediaId = mediaIdMap.get(sourceMediaId);
    if (!targetMediaId) {
      const existing = await tx.mediaAsset.findUnique({ where: { id: sourceMediaId }, select: { id: true, ownerUserId: true } });
      targetMediaId = !existing || existing.ownerUserId === targetUserId ? sourceMediaId : crypto.randomUUID();
      mediaIdMap.set(sourceMediaId, targetMediaId);
      if (!existing || existing.ownerUserId !== targetUserId) {
        const { ownerUser, references, runOutputs, generationInputs, batchMedia, ...mediaScalars } = media;
        void ownerUser; void references; void runOutputs; void generationInputs; void batchMedia;
        await tx.mediaAsset.create({
          data: {
            ...fixDates([mediaScalars], ["leaseUntil", "retentionUntil", "softDeletedAt", "purgedAt", "createdAt", "updatedAt"])[0],
            id: targetMediaId,
            ownerUserId: targetUserId,
            ...(mediaScalars.sizeBytes != null ? { sizeBytes: BigInt(mediaScalars.sizeBytes) } : {}),
          },
        });
        stats.imageBatchMediaAsset = (stats.imageBatchMediaAsset || 0) + 1;
      }
    }
    const targetBatchId = batchIdMap.get(String(archived.batchId || ""));
    const targetItemId = archived.itemId ? itemIdMap.get(String(archived.itemId)) : null;
    if (!targetBatchId || (archived.itemId && !targetItemId)) continue;
    const duplicate = await tx.imageBatchMedia.findFirst({
      where: {
        batchId: targetBatchId,
        itemId: targetItemId,
        mediaId: targetMediaId,
        role: archived.role,
        position: Number(archived.position) || 0,
      },
      select: { id: true },
    });
    if (duplicate) continue;
    await tx.imageBatchMedia.create({
      data: {
        batchId: targetBatchId,
        itemId: targetItemId,
        mediaId: targetMediaId,
        role: archived.role,
        position: Number(archived.position) || 0,
        ...(archived.createdAt ? { createdAt: new Date(archived.createdAt) } : {}),
      },
    });
    stats.imageBatchMedia = (stats.imageBatchMedia || 0) + 1;
  }

  for (const archived of input.items) {
    const targetId = itemIdMap.get(String(archived.id || ""));
    if (!targetId || !archived.lastSubmittedSnapshot) continue;
    await tx.imageBatchItem.update({
      where: { id: targetId },
      data: { lastSubmittedSnapshot: remapBatchSnapshot(archived.lastSubmittedSnapshot, batchIdMap, itemIdMap, mediaIdMap) },
    });
  }

  for (const archived of input.outputs) {
    const sourceId = String(archived.id || "");
    const targetBatchId = batchIdMap.get(String(archived.batchId || ""));
    const targetItemId = itemIdMap.get(String(archived.itemId || ""));
    if (!sourceId || !targetBatchId || !targetItemId) continue;
    const existing = await tx.imageBatchOutput.findUnique({ where: { id: sourceId }, select: { id: true, batchId: true } });
    const targetId = !existing || existing.batchId === targetBatchId ? sourceId : crypto.randomUUID();
    if (existing?.batchId === targetBatchId) continue;
    const requestKeyConflict = await tx.imageBatchOutput.findUnique({ where: { requestKey: String(archived.requestKey) }, select: { id: true } });
    const { batch, item, generation, ...scalars } = archived;
    void batch; void item; void generation;
    await tx.imageBatchOutput.create({
      data: {
        ...fixDates([scalars], ["leaseUntil", "nextPollAt", "startedAt", "finishedAt", "createdAt", "updatedAt"])[0],
        id: targetId,
        batchId: targetBatchId,
        itemId: targetItemId,
        requestKey: requestKeyConflict ? crypto.randomUUID() : archived.requestKey,
        requestSnapshot: remapBatchSnapshot(archived.requestSnapshot, batchIdMap, itemIdMap, mediaIdMap),
        generationId: archived.generationId == null
          ? null
          : generationIdMap.get(Number(archived.generationId)) || null,
      },
    });
    stats.imageBatchOutput = (stats.imageBatchOutput || 0) + 1;
  }

  void IMAGE_BATCH_RESTORE_ORDER;
}

const LIVE_VIDEO_BATCH_RESTORE_ORDER = [
  "liveVideoBatch",
  "liveVideoBatchItem",
  "liveVideoPromptJob",
  "liveVideoBatchOutput",
] as const;

async function restoreLiveVideoBatchData(input: {
  tx: any;
  targetUserId: number;
  generationIdMap: Map<number, number>;
  mediaIdMap: Map<string, string>;
  batches: any[];
  items: any[];
  promptJobs: any[];
  outputs: any[];
  stats: Record<string, number>;
}) {
  const { tx, targetUserId, generationIdMap, mediaIdMap, stats } = input;
  const batchIdMap = new Map<string, string>();
  const itemIdMap = new Map<string, string>();

  for (const archived of input.batches) {
    const sourceId = String(archived.id || "");
    if (!sourceId) continue;
    const existing = await tx.liveVideoBatch.findUnique({
      where: { id: sourceId },
      select: { id: true, authUserId: true },
    });
    const targetId = !existing || existing.authUserId === targetUserId
      ? sourceId
      : crypto.randomUUID();
    batchIdMap.set(sourceId, targetId);
    if (existing?.authUserId === targetUserId) continue;
    const requestKeyConflict = await tx.liveVideoBatch.findUnique({
      where: { requestKey: String(archived.requestKey) },
      select: { id: true },
    });
    const { authUser, items, promptJobs, outputs, ...scalars } = archived;
    void authUser; void items; void promptJobs; void outputs;
    await tx.liveVideoBatch.create({
      data: {
        ...fixDates(
          [scalars],
          ["submittedAt", "finishedAt", "deletedAt", "createdAt", "updatedAt"],
        )[0],
        id: targetId,
        authUserId: targetUserId,
        requestKey: requestKeyConflict ? crypto.randomUUID() : archived.requestKey,
      },
    });
    stats.liveVideoBatch = (stats.liveVideoBatch || 0) + 1;
  }

  for (const archived of input.items) {
    const sourceId = String(archived.id || "");
    const targetBatchId = batchIdMap.get(String(archived.batchId || ""));
    const sourceMedia = archived.sourceMedia && typeof archived.sourceMedia === "object"
      ? archived.sourceMedia
      : null;
    const sourceMediaId = String(archived.sourceMediaId || sourceMedia?.id || "");
    if (!sourceId || !targetBatchId || !sourceMediaId || !sourceMedia) continue;

    let targetMediaId = mediaIdMap.get(sourceMediaId);
    if (!targetMediaId) {
      const existingMedia = await tx.mediaAsset.findUnique({
        where: { id: sourceMediaId },
        select: { id: true, ownerUserId: true },
      });
      targetMediaId = !existingMedia || existingMedia.ownerUserId === targetUserId
        ? sourceMediaId
        : crypto.randomUUID();
      mediaIdMap.set(sourceMediaId, targetMediaId);
      if (!existingMedia || existingMedia.ownerUserId !== targetUserId) {
        const {
          ownerUser,
          references,
          runOutputs,
          generationInputs,
          batchMedia,
          workspaceDraftMedia,
          liveVideoBatchItems,
          ...mediaScalars
        } = sourceMedia;
        void ownerUser; void references; void runOutputs; void generationInputs;
        void batchMedia; void workspaceDraftMedia; void liveVideoBatchItems;
        await tx.mediaAsset.create({
          data: {
            ...fixDates(
              [mediaScalars],
              ["leaseUntil", "retentionUntil", "softDeletedAt", "purgedAt", "createdAt", "updatedAt"],
            )[0],
            id: targetMediaId,
            ownerUserId: targetUserId,
            ...(mediaScalars.sizeBytes != null
              ? { sizeBytes: BigInt(mediaScalars.sizeBytes) }
              : {}),
          },
        });
        stats.liveVideoBatchMediaAsset = (stats.liveVideoBatchMediaAsset || 0) + 1;
      }
    }

    const existing = await tx.liveVideoBatchItem.findUnique({
      where: { id: sourceId },
      select: { id: true, batchId: true },
    });
    const targetId = !existing || existing.batchId === targetBatchId
      ? sourceId
      : crypto.randomUUID();
    itemIdMap.set(sourceId, targetId);
    if (existing?.batchId === targetBatchId) continue;
    const { batch, sourceMedia: nestedMedia, promptJobs, outputs, ...scalars } = archived;
    void batch; void nestedMedia; void promptJobs; void outputs;
    await tx.liveVideoBatchItem.create({
      data: {
        ...fixDates([scalars], ["createdAt", "updatedAt"])[0],
        id: targetId,
        batchId: targetBatchId,
        sourceMediaId: targetMediaId,
        mediaSnapshot: remapBatchSnapshot(
          archived.mediaSnapshot,
          batchIdMap,
          itemIdMap,
          mediaIdMap,
        ),
      },
    });
    stats.liveVideoBatchItem = (stats.liveVideoBatchItem || 0) + 1;
  }

  for (const archived of input.promptJobs) {
    const sourceId = String(archived.id || "");
    const targetBatchId = batchIdMap.get(String(archived.batchId || ""));
    const targetItemId = itemIdMap.get(String(archived.itemId || ""));
    if (!sourceId || !targetBatchId || !targetItemId) continue;
    const existing = await tx.liveVideoPromptJob.findUnique({
      where: { id: sourceId },
      select: { id: true, itemId: true },
    });
    const targetId = !existing || existing.itemId === targetItemId
      ? sourceId
      : crypto.randomUUID();
    if (existing?.itemId === targetItemId) continue;
    const requestKeyConflict = await tx.liveVideoPromptJob.findUnique({
      where: { requestKey: String(archived.requestKey) },
      select: { id: true },
    });
    const { batch, item, ...scalars } = archived;
    void batch; void item;
    await tx.liveVideoPromptJob.create({
      data: {
        ...fixDates(
          [scalars],
          ["leaseUntil", "availableAt", "startedAt", "finishedAt", "createdAt", "updatedAt"],
        )[0],
        id: targetId,
        batchId: targetBatchId,
        itemId: targetItemId,
        requestKey: requestKeyConflict ? crypto.randomUUID() : archived.requestKey,
        mediaSnapshot: remapBatchSnapshot(
          archived.mediaSnapshot,
          batchIdMap,
          itemIdMap,
          mediaIdMap,
        ),
      },
    });
    stats.liveVideoPromptJob = (stats.liveVideoPromptJob || 0) + 1;
  }

  for (const archived of input.outputs) {
    const sourceId = String(archived.id || "");
    const targetBatchId = batchIdMap.get(String(archived.batchId || ""));
    const targetItemId = itemIdMap.get(String(archived.itemId || ""));
    if (!sourceId || !targetBatchId || !targetItemId) continue;
    const existing = await tx.liveVideoBatchOutput.findUnique({
      where: { id: sourceId },
      select: { id: true, itemId: true },
    });
    const targetId = !existing || existing.itemId === targetItemId
      ? sourceId
      : crypto.randomUUID();
    if (existing?.itemId === targetItemId) continue;
    const requestKeyConflict = await tx.liveVideoBatchOutput.findUnique({
      where: { requestKey: String(archived.requestKey) },
      select: { id: true },
    });
    const { batch, item, generation, ...scalars } = archived;
    void batch; void item; void generation;
    await tx.liveVideoBatchOutput.create({
      data: {
        ...fixDates(
          [scalars],
          ["leaseUntil", "nextPollAt", "startedAt", "finishedAt", "createdAt", "updatedAt"],
        )[0],
        id: targetId,
        batchId: targetBatchId,
        itemId: targetItemId,
        requestKey: requestKeyConflict ? crypto.randomUUID() : archived.requestKey,
        requestSnapshot: remapBatchSnapshot(
          archived.requestSnapshot,
          batchIdMap,
          itemIdMap,
          mediaIdMap,
        ),
        generationId: archived.generationId == null
          ? null
          : generationIdMap.get(Number(archived.generationId)) || null,
      },
    });
    stats.liveVideoBatchOutput = (stats.liveVideoBatchOutput || 0) + 1;
  }

  void LIVE_VIDEO_BATCH_RESTORE_ORDER;
}

const TOOL_WORKSPACE_RESTORE_ORDER = [
  "toolWorkspaceDraft",
  "toolWorkspaceDraftMedia",
] as const;

async function restoreToolWorkspaceDraftData(input: {
  tx: any;
  targetUserId: number;
  drafts: any[];
  relations: any[];
  mediaIdMap: Map<string, string>;
  stats: Record<string, number>;
}) {
  const { tx, targetUserId, mediaIdMap, stats } = input;
  const draftIdMap = new Map<string, string>();
  const skippedRelationDraftIds = new Set<string>();

  for (const archived of input.drafts) {
    const sourceId = String(archived.id || "");
    const tool = String(archived.tool || "").trim();
    if (!sourceId || !tool) continue;
    const [existingById, existingByTool] = await Promise.all([
      tx.toolWorkspaceDraft.findUnique({
        where: { id: sourceId },
        select: { id: true, authUserId: true },
      }),
      tx.toolWorkspaceDraft.findUnique({
        where: { authUserId_tool: { authUserId: targetUserId, tool } },
        select: { id: true },
      }),
    ]);
    if (existingByTool) {
      draftIdMap.set(sourceId, existingByTool.id);
      if (existingByTool.id !== sourceId) skippedRelationDraftIds.add(sourceId);
      continue;
    }
    const targetId = !existingById ? sourceId : crypto.randomUUID();
    draftIdMap.set(sourceId, targetId);
    const { authUser, media, ...scalars } = archived;
    void authUser; void media;
    await tx.toolWorkspaceDraft.create({
      data: {
        ...fixDates([scalars], ["createdAt", "updatedAt"])[0],
        id: targetId,
        authUserId: targetUserId,
        tool,
      },
    });
    stats.toolWorkspaceDraft = (stats.toolWorkspaceDraft || 0) + 1;
  }

  for (const archived of input.relations) {
    const sourceDraftId = String(archived.draftId || "");
    const targetDraftId = draftIdMap.get(sourceDraftId);
    const media = archived.media && typeof archived.media === "object" ? archived.media : null;
    const sourceMediaId = String(archived.mediaId || media?.id || "");
    if (
      !targetDraftId
      || skippedRelationDraftIds.has(sourceDraftId)
      || !sourceMediaId
      || !media
    ) continue;

    let targetMediaId = mediaIdMap.get(sourceMediaId);
    if (!targetMediaId) {
      const existing = await tx.mediaAsset.findUnique({
        where: { id: sourceMediaId },
        select: { id: true, ownerUserId: true },
      });
      targetMediaId = !existing || existing.ownerUserId === targetUserId
        ? sourceMediaId
        : crypto.randomUUID();
      mediaIdMap.set(sourceMediaId, targetMediaId);
      if (!existing || existing.ownerUserId !== targetUserId) {
        const {
          ownerUser,
          references,
          runOutputs,
          generationInputs,
          batchMedia,
          workspaceDraftMedia,
          ...mediaScalars
        } = media;
        void ownerUser; void references; void runOutputs; void generationInputs;
        void batchMedia; void workspaceDraftMedia;
        await tx.mediaAsset.create({
          data: {
            ...fixDates([mediaScalars], [
              "leaseUntil",
              "retentionUntil",
              "softDeletedAt",
              "purgedAt",
              "createdAt",
              "updatedAt",
            ])[0],
            id: targetMediaId,
            ownerUserId: targetUserId,
            ...(mediaScalars.sizeBytes != null
              ? { sizeBytes: BigInt(mediaScalars.sizeBytes) }
              : {}),
          },
        });
        stats.toolWorkspaceMediaAsset = (stats.toolWorkspaceMediaAsset || 0) + 1;
      }
    }

    const position = Number(archived.position);
    if (!Number.isInteger(position) || position < 0) continue;
    const duplicate = await tx.toolWorkspaceDraftMedia.findFirst({
      where: { draftId: targetDraftId, position },
      select: { id: true },
    });
    if (duplicate) continue;
    await tx.toolWorkspaceDraftMedia.create({
      data: {
        draftId: targetDraftId,
        mediaId: targetMediaId,
        position,
        slot: archived.slot === "first" || archived.slot === "last"
          ? archived.slot
          : null,
        ...(archived.createdAt ? { createdAt: new Date(archived.createdAt) } : {}),
      },
    });
    await tx.mediaAsset.updateMany({
      where: { id: targetMediaId, ownerUserId: targetUserId },
      data: { retentionUntil: null },
    });
    stats.toolWorkspaceDraftMedia = (stats.toolWorkspaceDraftMedia || 0) + 1;
  }

  void TOOL_WORKSPACE_RESTORE_ORDER;
}


const SEQUENCE_TABLES = [
  "Generation",
  "UsageLedger",
  "MediaLibraryItem",
  "MaterialAsset",
  "MaterialAssetDownload",
  "MaterialAssetSelectionEvent",
  "AgentConversation",
  "AgentMessage",
  "AgentRun",
  "CanvasProject",
  "Canvas",
  "CanvasRun",
  "PromptReverseTask",
  "UserMemory",
  "Log",
];

function openZip(filePath: string) {
  return new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(
      filePath,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (err, zipfile) => {
        if (err || !zipfile) reject(err || new Error("ZIP 文件无法打开"));
        else resolve(zipfile);
      },
    );
  });
}

function openEntryStream(zipfile: yauzl.ZipFile, entry: yauzl.Entry) {
  return new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(err || new Error("ZIP 条目无法读取"));
      else resolve(stream);
    });
  });
}

async function readEntryText(zipfile: yauzl.ZipFile, entry: yauzl.Entry, maxBytes: number) {
  if (entry.uncompressedSize > maxBytes) {
    throw new Error(`JSON 文件过大：${entry.fileName} 超过 ${formatBytes(maxBytes)}`);
  }
  const stream = await openEntryStream(zipfile, entry);
  const chunks: Buffer[] = [];
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        reject(new Error(`JSON 文件过大：${entry.fileName} 超过 ${formatBytes(maxBytes)}`));
        return;
      }
      chunks.push(buf);
    });
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return Buffer.concat(chunks).toString("utf8");
}

function normalizeZipName(name: string) {
  if (!name || name.includes("\\")) throw new Error(`ZIP 条目路径非法：${name}`);
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) throw new Error(`ZIP 条目路径非法：${name}`);
  const normalized = path.posix.normalize(name);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`ZIP 条目路径非法：${name}`);
  }
  return normalized;
}

function findSuffix(name: string): DataSuffix | null {
  return DATA_SUFFIXES.find((suffix) => name.endsWith(suffix)) ?? null;
}

function resolvePresetTarget(zipName: string, sourceUserId?: number, targetUserId?: number) {
  const marker = "/presets/";
  const idx = zipName.indexOf(marker);
  if (idx === -1 || !zipName.endsWith(".json")) return null;
  let rest = normalizeZipName(zipName.slice(idx + marker.length));
  if (sourceUserId != null && targetUserId != null) {
    const parts = rest.split("/");
    if (parts[0] === String(sourceUserId)) parts[0] = String(targetUserId);
    rest = parts.join("/");
  }
  const root = path.resolve(resolvePublicPath("uploads", "presets"));
  const target = path.resolve(root, rest);
  if (target !== root && target.startsWith(root + path.sep)) return target;
  throw new Error(`预设文件路径非法：${zipName}`);
}

function resolveFileTarget(zipName: string, sourceUserId?: number, targetUserId?: number) {
  const marker = "/files/uploads/";
  const idx = zipName.indexOf(marker);
  if (idx === -1) return null;
  let relative = normalizeZipName(zipName.slice(idx + marker.length));
  const roleSkillPrefix = "role_skill_covers/users/";
  if (relative.startsWith(roleSkillPrefix) && sourceUserId != null && targetUserId != null) {
    const parts = relative.slice(roleSkillPrefix.length).split("/");
    if (parts[0] !== String(sourceUserId) || !parts[1]) {
      throw new Error(`个人技能封面路径不属于源归档账号：${zipName}`);
    }
    parts[0] = String(targetUserId);
    relative = `${roleSkillPrefix}${parts.join("/")}`;
  }
  const uploadsRoot = path.resolve(resolvePublicPath("uploads"));
  const target = path.resolve(uploadsRoot, relative);
  if (target !== uploadsRoot && target.startsWith(uploadsRoot + path.sep)) return target;
  throw new Error(`媒体文件路径非法：${zipName}`);
}

async function summarizeZip(jobId: string, filePath: string): Promise<ZipSummary> {
  await emit(jobId, "parse", 5);
  const zipfile = await openZip(filePath);
  const maxJsonBytes = getMaxJsonBytes();
  const maxFiles = getMaxImportFiles();
  const maxBytes = getMaxImportBytes();
  const summary: ZipSummary = {
    manifest: {},
    data: {},
    presetEntries: [],
    fileEntries: [],
    entryCount: 0,
    uncompressedBytes: 0,
  };
  const seenEntries = new Set<string>();

  return await new Promise<ZipSummary>((resolve, reject) => {
    let done = false;
    const fail = (err: unknown) => {
      if (done) return;
      done = true;
      try {
        zipfile.close();
      } catch {}
      reject(err);
    };

    zipfile.on("error", fail);
    zipfile.on("end", () => {
      if (done) return;
      done = true;
      if (!summary.manifest?.version) {
        reject(new Error("ZIP 中缺少 manifest.json"));
        return;
      }
      resolve(summary);
    });

    zipfile.on("entry", async (entry) => {
      try {
        const name = normalizeZipName(entry.fileName);
        if (name.endsWith("/")) {
          zipfile.readEntry();
          return;
        }
        if (seenEntries.has(name)) throw new Error(`ZIP 包含重复条目：${name}`);
        seenEntries.add(name);
        summary.entryCount += 1;
        summary.uncompressedBytes += Number(entry.uncompressedSize || 0);
        if (summary.entryCount > maxFiles) throw new Error(`ZIP 文件数量超过上限 ${maxFiles}`);
        if (summary.uncompressedBytes > maxBytes) {
          throw new Error(`ZIP 解包后大小超过上限 ${formatBytes(maxBytes)}`);
        }

        const dataSuffix = findSuffix(name);
        if (name.endsWith("manifest.json")) {
          summary.manifest = JSON.parse(await readEntryText(zipfile, entry, maxJsonBytes));
        } else if (dataSuffix) {
          summary.data[dataSuffix] = await readEntryText(zipfile, entry, maxJsonBytes);
        } else if (resolvePresetTarget(name)) {
          summary.presetEntries.push({ name, uncompressedSize: Number(entry.uncompressedSize || 0) });
        } else if (resolveFileTarget(name)) {
          summary.fileEntries.push({ name, uncompressedSize: Number(entry.uncompressedSize || 0) });
        }

        if (summary.entryCount % 500 === 0) await emit(jobId, "read", Math.min(18, 8 + summary.entryCount / 500));
        zipfile.readEntry();
      } catch (err) {
        fail(err);
      }
    });

    zipfile.readEntry();
  });
}

async function preflightImportFiles(
  jobId: string,
  filePath: string,
  entries: ZipFileEntry[],
  sourceUserId: number,
  targetUserId: number,
) {
  const zipfile = await openZip(filePath);
  const sizes = new Map(entries.map((entry) => [entry.name, entry.uncompressedSize]));
  const createEntries = new Set<string>();
  const conflicts: string[] = [];
  let reused = 0;
  let processed = 0;

  await new Promise<void>((resolve, reject) => {
    let done = false;
    const fail = (err: unknown) => {
      if (done) return;
      done = true;
      try {
        zipfile.close();
      } catch {}
      reject(err);
    };
    zipfile.on("error", fail);
    zipfile.on("end", () => {
      if (done) return;
      done = true;
      resolve();
    });
    zipfile.on("entry", async (entry) => {
      try {
        const name = normalizeZipName(entry.fileName);
        const expectedSize = sizes.get(name);
        if (expectedSize == null) {
          zipfile.readEntry();
          return;
        }
        const target = resolvePresetTarget(name, sourceUserId, targetUserId)
          ?? resolveFileTarget(name, sourceUserId, targetUserId);
        if (!target) {
          zipfile.readEntry();
          return;
        }
        const disposition = await classifyImportTarget({
          targetPath: target,
          expectedSize,
          openArchiveStream: async () => await openEntryStream(zipfile, entry) as any,
        });
        if (disposition === "create") createEntries.add(name);
        else if (disposition === "reuse") reused++;
        else conflicts.push(target.replace(/\\/g, "/"));
        processed++;
        if (processed % 20 === 0 || processed === entries.length) {
          await emit(jobId, "check", Math.min(22, 18 + Math.round((processed / Math.max(1, entries.length)) * 4)));
        }
        zipfile.readEntry();
      } catch (err) {
        fail(err);
      }
    });
    zipfile.readEntry();
  });

  if (conflicts.length) throw new FileConflictError(Array.from(new Set(conflicts)).sort());
  return { createEntries, reused };
}

async function extractEntries(
  jobId: string,
  filePath: string,
  targets: Set<string>,
  sourceUserId: number,
  targetUserId: number,
  stats: Record<string, number>,
) {
  const zipfile = await openZip(filePath);
  const total = targets.size;
  let processed = 0;
  let files = 0;
  let presets = 0;
  let skipped = 0;
  const createdPaths: string[] = [];

  try {
    await new Promise<void>((resolve, reject) => {
    let done = false;
    const fail = (err: unknown) => {
      if (done) return;
      done = true;
      try {
        zipfile.close();
      } catch {}
      reject(err);
    };
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    zipfile.on("error", fail);
    zipfile.on("end", finish);
    zipfile.on("entry", async (entry) => {
      try {
        const name = normalizeZipName(entry.fileName);
        if (name.endsWith("/") || !targets.has(name)) {
          zipfile.readEntry();
          return;
        }

        const presetTarget = resolvePresetTarget(name, sourceUserId, targetUserId);
        const target = presetTarget ?? resolveFileTarget(name, sourceUserId, targetUserId);
        if (!target) {
          skipped++;
          zipfile.readEntry();
          return;
        }

        await fs.ensureDir(path.dirname(target));
        const stream = await openEntryStream(zipfile, entry);
        const output = await openExclusiveImportTarget(target);
        createdPaths.push(target);
        await pipeline(stream as any, output);
        if (presetTarget) presets++;
        else files++;
        processed++;

        if (total > 0 && (processed % 20 === 0 || processed === total)) {
          await emit(jobId, "files", 28 + Math.round((processed / total) * 10));
        }
        zipfile.readEntry();
      } catch (err) {
        fail(err);
      }
    });

      zipfile.readEntry();
    });
  } catch (error) {
    for (const createdPath of createdPaths) await fs.remove(createdPath).catch(() => {});
    throw error;
  }

  stats.files = files;
  stats.presetFiles = presets;
  stats.skippedFiles = skipped;
  return createdPaths;
}

export async function enqueueUserImportJob(params: {
  filePath: string;
  fileName: string;
  fileSize: number;
  accountOptions?: ImportAccountOptions;
}) {
  const accountOptions = parseImportAccountOptions(params.accountOptions || {});
  const existing = await importJobModel().findFirst({
    where: {
      filePath: params.filePath,
      status: { in: ["pending", "running", "error"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (existing?.id) return existing.id as string;

  const job = await importJobModel().create({
    data: {
      status: "pending",
      stage: "upload",
      progress: 1,
      filePath: params.filePath,
      fileName: params.fileName,
      fileSize: BigInt(params.fileSize),
    },
    select: { id: true },
  });

  void runUserImportJob(job.id, accountOptions).catch(() => {});
  return job.id as string;
}

export async function retryUserImportJob(jobId: string, input: ImportAccountOptions = {}) {
  const accountOptions = parseImportAccountOptions(input);
  const job = await importJobModel().findUnique({ where: { id: jobId } });
  if (!job) throw new Error("导入任务不存在或已被清理");
  if (job.status !== "error") throw new Error("只有失败的导入任务可以重试");
  if (!job.filePath || !await fs.pathExists(job.filePath)) throw new Error("原上传文件已不存在，无法直接重试");
  if (Number(job.fileSize || 0) > getMaxImportBytes()) {
    throw new Error(`导入包超过上限 ${formatBytes(getMaxImportBytes())}`);
  }
  await assertDurableWorkAdmission();
  const claimed = await importJobModel().updateMany({
    where: { id: jobId, status: "error" },
    data: {
      status: "pending",
      stage: "upload",
      progress: 1,
      error: null,
      stats: null,
      startedAt: null,
      finishedAt: null,
      expiresAt: null,
    },
  });
  if (claimed.count !== 1) throw new Error("任务已被重试，请等待当前导入完成");
  void runUserImportJob(jobId, accountOptions).catch(() => {});
  return jobId;
}

export async function allocateImportUploadPath(fileName: string, contentLength: number | null) {
  const maxBytes = getMaxImportBytes();
  if (contentLength != null && contentLength > maxBytes + 16 * 1024 * 1024) {
    throw new Error(`导入包超过上限 ${formatBytes(maxBytes)}`);
  }
  const dir = getImportsDir();
  await fs.ensureDir(dir);
  await assertDiskSpace(dir, contentLength ?? maxBytes, "导入");
  const ext = path.extname(fileName || "").toLowerCase() === ".zip" ? ".zip" : ".zip";
  return path.join(dir, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
}

export async function runUserImportJob(jobId: string, accountOptions: ImportAccountOptions = {}): Promise<void> {
  const job = await importJobModel().findUnique({ where: { id: jobId } });
  if (!job || job.status !== "pending" || !job.filePath) return;

  let createdImportFiles: string[] = [];
  let databaseCommitted = false;
  let openedArchive: Awaited<ReturnType<typeof unwrapMigrationArchive>> | undefined;
  let importHeartbeat: ReturnType<typeof setInterval> | null = null;
  try {
    // Serialize imports across processes before any extraction. A failed attempt must never
    // remove a file that another simultaneous import has just started using.
    const claim = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(1229080394, 1)");
      const active = await tx.userImportJob.findFirst({ where: { status: "running", id: { not: jobId } }, select: { id: true } });
      if (active) throw new Error("另一个用户导入任务正在运行，请等待完成后重试");
      return tx.userImportJob.updateMany({
        where: { id: jobId, status: "pending" },
        data: { status: "running", startedAt: new Date(), stage: "parse", progress: 3 },
      });
    });
    if (!claim.count) return;
    importHeartbeat = setInterval(() => {
      void importJobModel()
        .update({ where: { id: jobId }, data: { updatedAt: new Date() } })
        .catch(() => {});
    }, USER_IMPORT_HEARTBEAT_MS);
    importHeartbeat.unref?.();

    const fileSize = Number(job.fileSize || 0);
    if (fileSize > getMaxImportBytes()) {
      throw new Error(`导入包超过上限 ${formatBytes(getMaxImportBytes())}`);
    }

    openedArchive = await unwrapMigrationArchive(job.filePath, accountOptions.migrationPassphrase);
    const archivePath = openedArchive.filePath;
    const summary = await summarizeZip(jobId, archivePath);
    await emit(jobId, "check", 18);

    const manifest = summary.manifest;
    if (manifest.version !== 1) throw new Error(`不支持的导出版本：${manifest.version}`);

    const readData = (name: DataSuffix, statKey?: string) => {
      const rows = parseArchiveJsonRows(summary.data[name], name);
      if (statKey) assertArchiveRowCount(manifest, statKey, rows, name);
      return rows;
    };
    const userRaw = readData("data/user.json");
    const generationsRaw = readData("data/generations.json", "generations");
    const generationLogsRaw = readData("data/generation_logs.json", "generationLogs");
    const usageLedgerRaw = readData("data/usage_ledger.json", "usageLedger");
    const mediaLibraryRaw = readData("data/media_library.json", "mediaLibrary");
    const materialAssetsRaw = readData("data/material_assets.json", "materialAssets");
    const materialAssetDownloadsRaw = readData("data/material_asset_downloads.json", "materialAssetDownloads");
    const materialAssetSelectionEventsRaw = readData("data/material_asset_selection_events.json", "materialAssetSelectionEvents");
    const agentConversationsRaw = readData("data/agent_conversations.json", "agentConversations");
    const agentMessagesRaw = readData("data/agent_messages.json", "agentMessages");
    const agentRunsRaw = readData("data/agent_runs.json", "agentRuns");
    const agentRuntimeRaw = readData('data/agent_runtime.json');
    const agentEventsRaw = parseAgentEventArchiveRows(readData("data/agent_events.json", "agentEvents"));
    const agentGenerationLinksRaw = parseAgentGenerationLinkArchiveRows(readData("data/agent_generation_links.json", "agentGenerationLinks"));
    const canvasProjectsRaw = readData("data/canvas_projects.json", "canvasProjects");
    const canvasesRaw = readData("data/canvases.json", "canvases");
    const canvasMediaAssetsRaw = readData("data/canvas_media_assets.json", "canvasMediaAssets");
    const canvasRunsRaw = readData("data/canvas_runs.json", "canvasRuns");
    const promptReverseTasksRaw = readData("data/prompt_reverse_tasks.json", "promptReverseTasks");
    const userRoleSkillArchive = await parseUserRoleSkillArchiveForImport(
      manifest,
      summary.data["data/user_role_skills.json"],
    );
    const promptPresetArchive = await parsePromptPresetArchiveForImport(
      manifest,
      summary.data["data/prompt_presets.json"],
    );
    const imageBatchesRaw = readData("data/image_batches.json", "imageBatches");
    const imageBatchGroupsRaw = readData("data/image_batch_groups.json", "imageBatchGroups");
    const imageBatchItemsRaw = readData("data/image_batch_items.json", "imageBatchItems");
    const imageBatchMediaRaw = readData("data/image_batch_media.json", "imageBatchMedia");
    const imageBatchOutputsRaw = readData("data/image_batch_outputs.json", "imageBatchOutputs");
    const liveVideoBatchesRaw = readData("data/live_video_batches.json", "liveVideoBatches");
    const liveVideoBatchItemsRaw = readData("data/live_video_batch_items.json", "liveVideoBatchItems");
    const liveVideoPromptJobsRaw = readData("data/live_video_prompt_jobs.json", "liveVideoPromptJobs");
    const liveVideoBatchOutputsRaw = readData("data/live_video_batch_outputs.json", "liveVideoBatchOutputs");
    const toolWorkspaceDraftsRaw = readData("data/tool_workspace_drafts.json", "toolWorkspaceDrafts");
    const toolWorkspaceDraftMediaRaw = readData("data/tool_workspace_draft_media.json", "toolWorkspaceDraftMedia");
    const userMemoriesRaw = readData("data/user_memories.json", "userMemories");
    const agentMemoryProfilesRaw = readData("data/agent_memory_profile.json", "agentMemoryProfiles");
    if (agentMemoryProfilesRaw.length > 1) throw new Error("agent memory profile 只能包含一条记录");
    const agentMemoryProfileArchive = agentMemoryProfilesRaw.length
      ? agentMemoryProfileArchiveSchema.parse(agentMemoryProfilesRaw[0])
      : null;
    const logsRaw = readData("data/logs.json", "userLogs");
    const feedbackRaw = readData("data/feedback.json", "feedback");
    assertArchiveRowCount(manifest, "presetFiles", summary.presetEntries, "presets");
    assertArchiveRowCount(manifest, "files", summary.fileEntries, "files");
    await assertDiskSpace(resolvePublicPath("uploads"), summary.uncompressedBytes, "导入解包");

    const userData = userRaw[0] as any;
    if (!userData?.id || !userData?.username) throw new Error("user.json 数据无效，缺少 id 或 username");

    const stats: Record<string, number> = {};
    const warnings: string[] = [];
    const importRestoredAt = new Date();
    if (userRaw.length !== 1) throw new Error("归档必须包含且仅包含一个用户");
    const credential = openedArchive.encrypted
      ? await openMigrationCredential(userData.migrationCredential, openedArchive.credentialKey!).catch((error) => {
        if (openedArchive?.portable) throw new Error("MIGRATION_PACKAGE_INVALID: 账号备份已损坏，请重新下载后导入");
        throw error;
      })
      : undefined;
    const userPlan = await planImportedAccount(prisma, userData, accountOptions, credential);
    if (userPlan.generatedPassword) warnings.push("旧包不含原登录密码，已自动生成新密码，可在用户管理中查看或修改");
    if (!userPlan.created) warnings.push("已合并到同名账号，保留该账号现有登录密码");
    if (userPlan.created && credential && credential.recoverablePassword === undefined) {
      warnings.push("账号可使用原密码登录；源账号只有密码哈希，后台无法查看原密码，可通过设置新密码恢复该功能");
    }
    const filePlan = await preflightImportFiles(
      jobId,
      archivePath,
      [...summary.presetEntries, ...summary.fileEntries],
      userPlan.sourceUserId,
      userPlan.targetUserId,
    );
    stats.filesReused = filePlan.reused;
    await emit(jobId, "files", 28);
    createdImportFiles = await extractEntries(
      jobId,
      archivePath,
      filePlan.createEntries,
      userPlan.sourceUserId,
      userPlan.targetUserId,
      stats,
    );
    const legacyPromptScan = promptPresetArchive
      ? await scanLegacyPromptPresets({
          publicDir: resolvePublicDir(),
          presetUserIds: [String(userPlan.targetUserId)],
        })
      : null;
    await emit(jobId, "db_user", 40);

    // 整个写库过程包成一个事务：中途任何一步失败都会自动整体回滚，
    // 不会在库里留下半成品数据（避免导入失败后账号不可用、还得手动清理）。
    // 解包先创建文件；事务失败时只清理由本次尝试创建的文件。
    await runUserImportRestoreCreate(() => prisma.$transaction(
      async (tx) => {
        const resolvedUser = await restoreImportedAccount(tx, userPlan);
        if (resolvedUser.targetUserId !== userPlan.targetUserId) {
          throw new Error("导入用户映射在校验后发生变化，请重试导入");
        }
        stats.user = 1;
        stats.userCreated = resolvedUser.created ? 1 : 0;
        const sourceUserId = resolvedUser.sourceUserId;
        const targetUserId = resolvedUser.targetUserId;

        if (promptPresetArchive) {
          const restoredPrompts = await restorePromptPresetArchiveV2({
            tx,
            targetAuthUserId: targetUserId,
            sourceArchiveUserId: sourceUserId,
            archive: promptPresetArchive,
            warnings,
            legacyScan: legacyPromptScan,
          });
          stats.promptCustomPrompts = restoredPrompts.customPrompts;
          stats.promptCustomPromptsSkipped = restoredPrompts.customPromptsSkipped;
          stats.promptDeletedBuiltins = restoredPrompts.deletedBuiltins;
          stats.promptWarnings = restoredPrompts.warnings;
        }
        let userRoleSkillIdMap = new Map<bigint, bigint>();
        if (userRoleSkillArchive) {
          const restoredSkills = await restoreUserRoleSkillArchiveV1({
            tx,
            targetAuthUserId: targetUserId,
            sourceArchiveUserId: sourceUserId,
            archive: userRoleSkillArchive,
          });
          userRoleSkillIdMap = restoredSkills.idMap;
          stats.userRoleSkills = restoredSkills.restored;
          stats.userRoleSkillsInserted = restoredSkills.inserted;
          stats.userRoleSkillsReused = restoredSkills.reused;
          stats.userRoleSkillsRemapped = restoredSkills.remapped;
        }

        // 目标库现有用户 id 集合，供素材库/媒体库的跨用户外键消毒（防 FK 报错中断整单）
        const validUserIds = new Set((await tx.user.findMany({ select: { id: true } })).map((u) => u.id));

        let generationIdMap = new Map<number, number>();
        if (generationsRaw.length) {
          await emit(jobId, "db_gen", 45);
          const generationRows = fixDates(
            remapImportedUserFields(
              generationsRaw as any[],
              sourceUserId,
              targetUserId,
              { numeric: ["authUserId"], textual: ["userId"] },
            ),
            ["createdAt", "updatedAt", "finishedAt"],
          ).map((row) => ({ ...row, restoredAt: importRestoredAt }));
          const result = await restoreTable(
            tx,
            "generation",
            "Generation",
            generationRows,
            stats,
            "generation",
          );
          generationIdMap = result.idMap;
          await tx.generation.updateMany({
            where: { id: { in: Array.from(new Set(result.idMap.values())) } },
            data: { restoredAt: importRestoredAt },
          });
        }

        await emit(jobId, "db_other", 55);
        if (usageLedgerRaw.length) {
          const usageLedgerRows = remapForeignKey(
            fixDates(
              remapImportedUserFields(
                usageLedgerRaw as any[],
                sourceUserId,
                targetUserId,
                { numeric: ["authUserId"], textual: ["userId"] },
              ),
              ["occurredAt", "finishedAt", "createdAt", "updatedAt"],
            ),
            "generationId",
            generationIdMap,
            { nullable: true },
          );
          await restoreTable(
            tx,
            "usageLedger",
            "UsageLedger",
            usageLedgerRows,
            stats,
            "usageLedger",
            {
              reuseByUniqueKey: {
                key: usageLedgerUniqueKey,
                findExisting: async (rows) => {
                  const generationIds = Array.from(new Set(
                    rows
                      .map((row) => row.generationId)
                      .filter((value) => value != null)
                      .map(Number),
                  ));
                  if (!generationIds.length) return [];
                  return tx.usageLedger.findMany({ where: { generationId: { in: generationIds } } });
                },
              },
            },
          );
        }
        if (mediaLibraryRaw.length) {
          await restoreTable(
            tx,
            "mediaLibraryItem",
            "MediaLibraryItem",
            nullMissingUserRefs(
              fixDates(
                remapImportedUserFields(
                  mediaLibraryRaw as any[],
                  sourceUserId,
                  targetUserId,
                  { numeric: ["ownerUserId", "createdByUserId"] },
                ),
                ["createdAt", "updatedAt"],
              ),
              ["ownerUserId"],
              validUserIds,
            ),
            stats,
            "mediaLibraryItem",
          );
        }
        let materialAssetIdMap = new Map<number, number>();
        if (materialAssetsRaw.length) {
          const result = await restoreTable(
            tx,
            "materialAsset",
            "MaterialAsset",
            nullMissingUserRefs(
              fixDates(
                remapImportedUserFields(
                  materialAssetsRaw as any[],
                  sourceUserId,
                  targetUserId,
                  { numeric: ["createdByUserId", "selectedByUserId"] },
                ),
                ["createdAt", "updatedAt", "selectedAt"],
              ),
              ["createdByUserId", "selectedByUserId"],
              validUserIds,
            ),
            stats,
            "materialAsset",
          );
          materialAssetIdMap = result.idMap;
        }
        if (materialAssetDownloadsRaw.length) {
          // userId 是必填外键（Cascade），指向缺失用户的下载记录无法置空，整行丢弃
          const { kept, dropped } = dropMissingUserRefRows(
            fixDates(
              remapImportedUserFields(
                materialAssetDownloadsRaw as any[],
                sourceUserId,
                targetUserId,
                { numeric: ["userId"] },
              ),
              ["downloadedAt"],
            ),
            "userId",
            validUserIds,
          );
          if (dropped) stats.materialAssetDownloadSkipped = dropped;
          await restoreTable(
            tx,
            "materialAssetDownload",
            "MaterialAssetDownload",
            remapForeignKey(kept, "assetId", materialAssetIdMap),
            stats,
            "materialAssetDownload",
          );
        }
        if (materialAssetSelectionEventsRaw.length) {
          await restoreTable(
            tx,
            "materialAssetSelectionEvent",
            "MaterialAssetSelectionEvent",
            remapForeignKey(
              nullMissingUserRefs(
                fixDates(
                  remapImportedUserFields(
                    materialAssetSelectionEventsRaw as any[],
                    sourceUserId,
                    targetUserId,
                    { numeric: ["userId"] },
                  ),
                  ["occurredAt"],
                ),
                ["userId"],
                validUserIds,
              ),
              "assetId",
              materialAssetIdMap,
            ),
            stats,
            "materialAssetSelectionEvent",
          );
        }

        await emit(jobId, "db_agent", 65);
        let agentConversationIdMap = new Map<number, number>();
        if (agentConversationsRaw.length) {
          const result = await restoreTable(
            tx,
            "agentConversation",
            "AgentConversation",
            fixDates(
              remapImportedUserFields(
                agentConversationsRaw as any[],
                sourceUserId,
                targetUserId,
                { numeric: ["userId"] },
              ),
              ["createdAt", "updatedAt"],
            ),
            stats,
            "agentConversation",
          );
          agentConversationIdMap = result.idMap;
        }
        let agentRunIdMap = new Map<number, number>();
        if (agentRunsRaw.length) {
          const result = await restoreTable(
            tx,
            "agentRun",
            "AgentRun",
            remapForeignKey(
              fixDates(
                remapImportedUserFields(
                  (agentRunsRaw as any[]).map(run => ({ ...run, generationApproval: Prisma.DbNull, ...(run.runtimeVersion === 2 ? { budgetPolicy: Prisma.DbNull, currentStage: 'imported_history', lastProgressAt: null } : {}),
                    ...(!["completed", "failed", "cancelled", "success"].includes(run.status) ? { status: "cancelled", cancelRequestedAt: new Date() } : {}),
                    leaseOwner: null, leaseUntil: null, availableAt: null })),
                  sourceUserId,
                  targetUserId,
                  { numeric: ["userId"] },
                ),
                ["createdAt", "updatedAt", "availableAt", "leaseUntil", "startedAt", "finishedAt", "cancelRequestedAt"],
              ),
              "conversationId",
              agentConversationIdMap,
              { nullable: true },
            ),
            stats,
            "agentRun",
          );
          agentRunIdMap = result.idMap;
        }
        let agentMessageIdMap = new Map<number, number>();
        if (agentMessagesRaw.length) {
          const result = await restoreTable(
            tx,
            "agentMessage",
            "AgentMessage",
            remapForeignKey(
              remapForeignKey(
                fixDates(
                  remapImportedUserFields(
                    agentMessagesRaw as any[],
                    sourceUserId,
                    targetUserId,
                    { numeric: ["userId"] },
                  ),
                  ["createdAt"],
                ),
                "conversationId",
                agentConversationIdMap,
              ),
              "runId",
              agentRunIdMap,
            ),
            stats,
            "agentMessage",
          );
          agentMessageIdMap = result.idMap;
        }
        if (agentEventsRaw.length || agentGenerationLinksRaw.length) {
          const mappedGenerationIds = Array.from(new Set(agentGenerationLinksRaw.flatMap((link) => {
            const mapped = generationIdMap.get(link.generationId);
            return mapped ? [mapped] : [];
          })));
          const ownedGenerations = mappedGenerationIds.length
            ? await tx.generation.findMany({
                where: { id: { in: mappedGenerationIds }, authUserId: targetUserId },
                select: { id: true },
              })
            : [];
          const transferred = remapAgentTransferRows({
            events: agentEventsRaw,
            links: agentGenerationLinksRaw,
            conversationIdMap: agentConversationIdMap,
            runIdMap: agentRunIdMap,
            messageIdMap: agentMessageIdMap,
            generationIdMap,
            ownedGenerationIds: new Set(ownedGenerations.map((generation: any) => Number(generation.id))),
          });
          if (transferred.events.length) {
            const existing = await tx.agentEvent.findMany({
              where: { runId: { in: Array.from(new Set(transferred.events.map((event) => event.runId))) } },
              select: { runId: true, sequence: true },
            });
            const existingKeys = new Set(existing.map((event: any) => `${event.runId}:${event.sequence}`));
            const pending = transferred.events.filter((event) => !existingKeys.has(`${event.runId}:${event.sequence}`));
            const result = pending.length
              ? await tx.agentEvent.createMany({ data: pending as any[] })
              : { count: 0 };
            stats.agentEvent = transferred.events.length;
            stats.agentEventInserted = result.count;
            if (result.count !== transferred.events.length) stats.agentEventReused = transferred.events.length - result.count;
          }
          if (transferred.links.length) {
            const existing = await tx.agentGenerationLink.findMany({
              where: {
                OR: [
                  { requestKey: { in: transferred.links.map((link) => link.requestKey) } },
                  { runId: { in: Array.from(new Set(transferred.links.map((link) => link.runId))) } },
                ],
              },
              select: { requestKey: true, runId: true, stepKey: true },
            });
            const requestKeys = new Set(existing.map((link: any) => String(link.requestKey)));
            const stepKeys = new Set(existing.map((link: any) => `${link.runId}:${link.stepKey}`));
            const pending = transferred.links.filter((link) => (
              !requestKeys.has(link.requestKey) && !stepKeys.has(`${link.runId}:${link.stepKey}`)
            ));
            const result = pending.length
              ? await tx.agentGenerationLink.createMany({ data: pending })
              : { count: 0 };
            stats.agentGenerationLink = transferred.links.length;
            stats.agentGenerationLinkInserted = result.count;
            if (result.count !== transferred.links.length) stats.agentGenerationLinkReused = transferred.links.length - result.count;
          }
          if (transferred.skippedLinks) {
            stats.agentGenerationLinkSkipped = (stats.agentGenerationLinkSkipped || 0) + transferred.skippedLinks;
          }
        }

        if (agentRuntimeRaw.length) stats.agentRuntime = await (await import('@/lib/admin/legacy-agent-data/runtime-transfer')).importRuntimeRecords(tx, agentRuntimeRaw, targetUserId, agentRunIdMap, generationIdMap);
        let canvasProjectIdMap = new Map<number, number>();
        if (canvasProjectsRaw.length) {
          const result = await restoreTable(
            tx,
            "canvasProject",
            "CanvasProject",
            fixDates(
              remapImportedUserFields(
                canvasProjectsRaw as any[],
                sourceUserId,
                targetUserId,
                { numeric: ["authUserId"] },
              ),
              ["deletedAt", "createdAt", "updatedAt"],
            ),
            stats,
            "canvasProject",
          );
          canvasProjectIdMap = result.idMap;
        }
        let canvasIdMap = new Map<number, number>();
        const workspaceMediaIdMap = new Map<string, string>();
        await restoreCanvasMediaAssets(tx, canvasMediaAssetsRaw as any[], targetUserId, workspaceMediaIdMap);
        if (canvasesRaw.length) {
          const result = await restoreTable(
            tx,
            "canvas",
            "Canvas",
            remapForeignKey(
              fixDates(
                remapImportedUserFields(
                  prepareCanvasArchiveRows(canvasesRaw as any[], workspaceMediaIdMap),
                  sourceUserId,
                  targetUserId,
                  { numeric: ["authUserId"] },
                ),
                ["deletedAt", "createdAt", "updatedAt"],
              ),
              "projectId",
              canvasProjectIdMap,
              { nullable: true },
            ),
            stats,
            "canvas",
          );
          canvasIdMap = result.idMap;
          const restored = await tx.canvas.findMany({ where: { id: { in: [...canvasIdMap.values()] }, authUserId: targetUserId, projectionRevision: BigInt(0) } });
          for (const canvas of restored) {
            await syncCanvasCurrentMediaReferences(tx, canvas.id, (canvas.data as { nodes?: CanvasNode[] }).nodes ?? [], [], targetUserId);
          }
        }
        if (canvasRunsRaw.length) {
          await restoreTable(
            tx,
            "canvasRun",
            "CanvasRun",
            remapForeignKey(
              fixDates(
                remapImportedUserFields(
                  canvasRunsRaw as any[],
                  sourceUserId,
                  targetUserId,
                  { numeric: ["authUserId"] },
                ),
                ["startedAt", "updatedAt", "finishedAt"],
              ),
              "canvasId",
              canvasIdMap,
            ),
            stats,
            "canvasRun",
          );
        }
        if (promptReverseTasksRaw.length) {
          await restoreTable(
            tx,
            "promptReverseTask",
            "PromptReverseTask",
            fixDates(
              remapImportedUserFields(
                promptReverseTasksRaw as any[],
                sourceUserId,
                targetUserId,
                { numeric: ["authUserId"], textual: ["userId"] },
              ),
              ["startedAt", "finishedAt", "deletedAt", "createdAt", "updatedAt"],
            ).map((row) => remapPromptReverseTaskRoleSkill(row, userRoleSkillIdMap, warnings)) as Array<Record<string, any> & { id: number }>,
            stats,
            "promptReverseTask",
          );
        }
        if (toolWorkspaceDraftsRaw.length || toolWorkspaceDraftMediaRaw.length) {
          await restoreToolWorkspaceDraftData({
            tx,
            targetUserId,
            drafts: toolWorkspaceDraftsRaw as any[],
            relations: toolWorkspaceDraftMediaRaw as any[],
            mediaIdMap: workspaceMediaIdMap,
            stats,
          });
        }
        if (imageBatchesRaw.length || imageBatchGroupsRaw.length || imageBatchItemsRaw.length || imageBatchMediaRaw.length || imageBatchOutputsRaw.length) {
          await restoreImageBatchData({
            tx,
            sourceUserId,
            targetUserId,
            generationIdMap,
            mediaIdMap: workspaceMediaIdMap,
            batches: imageBatchesRaw as any[],
            groups: imageBatchGroupsRaw as any[],
            items: imageBatchItemsRaw as any[],
            media: imageBatchMediaRaw as any[],
            outputs: imageBatchOutputsRaw as any[],
            stats,
          });
        }
        if (liveVideoBatchesRaw.length || liveVideoBatchItemsRaw.length || liveVideoPromptJobsRaw.length || liveVideoBatchOutputsRaw.length) {
          await restoreLiveVideoBatchData({
            tx,
            targetUserId,
            generationIdMap,
            mediaIdMap: workspaceMediaIdMap,
            batches: liveVideoBatchesRaw as any[],
            items: liveVideoBatchItemsRaw as any[],
            promptJobs: liveVideoPromptJobsRaw as any[],
            outputs: liveVideoBatchOutputsRaw as any[],
            stats,
          });
        }
        if (userMemoriesRaw.length) {
          const userMemoryRows = remapForeignKey(
            fixDates(
              remapImportedUserFields(
                userMemoriesRaw as any[],
                sourceUserId,
                targetUserId,
                { numeric: ["userId"] },
              ),
              ["createdAt", "updatedAt", "lastUsedAt"],
            ),
            "sourceMessageId",
            agentMessageIdMap,
            { nullable: true },
          );
          await restoreTable(
            tx,
            "userMemory",
            "UserMemory",
            userMemoryRows,
            stats,
            "userMemory",
            {
              reuseByUniqueKey: {
                key: userMemoryUniqueKey,
                findExisting: async (rows) => {
                  const userIds = Array.from(new Set(rows.map((row) => Number(row.userId))));
                  return tx.userMemory.findMany({ where: { userId: { in: userIds } } });
                },
              },
            },
          );
        }

        if (generationLogsRaw.length || logsRaw.length || feedbackRaw.length) {
          await emit(jobId, "db_logs", 75);
          const uniqueLogs = mergeRestoreRowsById([
            generationLogsRaw as any[],
            logsRaw as any[],
            feedbackRaw as any[],
          ]);
          const logRows = remapForeignKey(
            fixDates(
              remapImportedUserFields(uniqueLogs, sourceUserId, targetUserId, { textual: ["userId"] }),
              ["createdAt"],
            ).map((row) => ({ ...row, restoredAt: importRestoredAt })),
            "generationId",
            generationIdMap,
            { nullable: true },
          );
          const result = await restoreTable(
            tx,
            "log",
            "Log",
            logRows,
            stats,
            "logUnique",
          );
          await tx.log.updateMany({
            where: { id: { in: Array.from(new Set(result.idMap.values())) } },
            data: { restoredAt: importRestoredAt },
          });
          stats.generationLog = generationLogsRaw.length;
          stats.log = logsRaw.length;
          stats.feedback = feedbackRaw.length;
        }
        // Persist completion in the SAME transaction as the restored account/data.
        // A restart after COMMIT must not misreport a committed import as failed.
        await tx.userImportJob.update({
          where: { id: jobId },
          data: {
            status: "done", stage: "done", progress: 100,
            manifest: JSON.stringify(manifest),
            stats: JSON.stringify(warnings.length ? { ...stats, warnings } : stats),
            finishedAt: new Date(), expiresAt: new Date(Date.now() + IMPORT_TTL_MS),
          },
        });
      },
      { maxWait: 20_000, timeout: 15 * 60 * 1000 },
    ));
    databaseCommitted = true;

    if (userMemoriesRaw.length || agentMemoryProfileArchive) {
      try {
        const rebuilt = await rebuildAgentMemoryProfileAfterImport(userPlan.targetUserId, agentMemoryProfileArchive);
        stats.agentMemoryProfile = rebuilt.rebuilt ? 1 : 0;
      } catch {
        warnings.push("用户数据已恢复，但记忆画像重建失败，需要稍后重建");
      }
    }

    for (const table of SEQUENCE_TABLES) await resetSequence(prisma, table);

    // 导入的 Generation 不会自动进 AnalyticsDailyByUser 滚动表，导致导入用户的
    // "近7天产出/成功率/趋势/数据分析" 统计为 0。这里重建最近 31 天滚动表（幂等，和 cron 同款）。
    try {
      const { rebuildRecentDailyAnalytics } = await import("@/lib/admin-analytics-rollup");
      await rebuildRecentDailyAnalytics(31);
    } catch (e) {
      console.warn("[user-import] 重建分析滚动表失败（不影响导入）", e);
    }

    await importJobModel().update({
      where: { id: jobId },
      data: {
        status: "done",
        stage: "done",
        progress: 100,
        manifest: JSON.stringify(manifest),
        stats: JSON.stringify(warnings.length ? { ...stats, warnings } : stats),
        finishedAt: new Date(),
        expiresAt: new Date(Date.now() + IMPORT_TTL_MS),
      },
    });
    try {
      await fs.remove(job.filePath);
      await importJobModel().update({
        where: { id: jobId },
        data: { filePath: null },
      });
    } catch (cleanupError) {
      console.warn("[user-import] 导入成功，但暂存 ZIP 清理失败，将由维护任务重试", cleanupError);
    }
  } catch (err) {
    if (!databaseCommitted) {
      for (const createdPath of createdImportFiles) await fs.remove(createdPath).catch(() => {});
    }
    const message = err instanceof Error ? err.message : String(err);
    const needsInput = err instanceof ImportAccountInputError ? err.needsInput
      : /^MIGRATION_PASSPHRASE_(REQUIRED|INVALID)/.test(message) ? { kind: "passphrase" }
      : undefined;
    const conflictStats = JSON.stringify({
      ...(err instanceof FileConflictError ? { conflicts: err.conflicts } : {}),
      ...(needsInput ? { needsInput } : {}),
    });
    // Prisma errors can include submitted credential values; never persist or print them.
    const safeMessage = (err instanceof Error && err.name.startsWith("PrismaClient")) || /Invalid `.*invocation/.test(message)
      ? "数据库写入失败，已回滚本次导入；请检查服务端版本和数据格式"
      : message.slice(0, 2000);
    await importJobModel()
      .update({
        where: { id: jobId },
        data: {
          status: databaseCommitted ? "done" : "error",
          ...(databaseCommitted ? { stage: "done", progress: 100 } : {}),
          error: databaseCommitted ? null : safeMessage,
          ...(databaseCommitted ? {} : { stats: conflictStats }),
          finishedAt: new Date(),
        },
      })
      .catch(() => {});
    console.error("[user-import] 任务失败", jobId, safeMessage);
  } finally {
    if (importHeartbeat) clearInterval(importHeartbeat);
    await openedArchive?.cleanup().catch(() => {});
  }
}
