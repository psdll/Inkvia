import { getWanUploadContract } from "@/lib/wan-media-policy";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  LIVE_VIDEO_BATCH_DEFAULT_DURATION_SECONDS,
  LIVE_VIDEO_BATCH_MAX_MEDIA,
} from "@/lib/live-video-batch/contracts";
import {
  getLiveVideoBatchInputModes,
  getLiveVideoBatchModelSpec,
  getLiveVideoDurationOptions,
  supportsLiveVideoDuration,
} from "@/lib/live-video-batch/video-models";
import prisma from "@/lib/prisma";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { getVisibleToolboxModels } from "@/lib/image-edit-models";
import { getSeedanceUploadContract } from "@/lib/seedance-media-policy";
import { getMiniMaxH3UploadContract } from "@/lib/minimax-h3-media-policy";
import { getRegisteredProviders } from "@/lib/providers/registry";
import {
  resolveRoleSkillForExecution,
  RoleSkillRepositoryError,
} from "@/lib/role-skills/repository";
import { getRoleSkillFeatureBinding } from "@/lib/role-skills/feature-bindings";
import { LIVE_VIDEO_ROLE_SKILL_FEATURE_KEY } from "@/lib/role-skills/features";
import {
  releaseOwnedUnreferencedToolMedia,
  releaseToolMedia,
  uploadToolMedia,
} from "@/lib/tool-media/service";
import {
  BatchProductLibraryError,
  importBatchProductLibrarySnapshot,
  releaseBatchWorkspaceReference,
} from "@/lib/batch-product-library/service";
import {
  BATCH_UPLOAD_CONCURRENCY,
  mapWithConcurrency,
} from "@/lib/batch-upload/concurrency";

const db = prisma as any;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const LIVE_VIDEO_HISTORY_PAGE_SIZE = 5;
const LIVE_VIDEO_EPHEMERAL_DRAFT_PREFIX = "e11d7a5f-";

const BATCH_INCLUDE = {
  items: {
    orderBy: [{ position: "asc" }, { id: "asc" }],
    include: {
      sourceMedia: true,
      promptJobs: { orderBy: [{ attempt: "desc" }, { createdAt: "desc" }] },
      outputs: {
        orderBy: [{ attempt: "desc" }, { createdAt: "desc" }],
        include: { generation: true },
      },
    },
  },
} as const;

const BATCH_LIST_SELECT = {
  id: true,
  name: true,
  status: true,
  skillSnapshot: true,
  sharedRequirement: true,
  videoSettings: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  submittedAt: true,
  finishedAt: true,
  items: {
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: {
      id: true,
      position: true,
      name: true,
      prompt: true,
      promptStatus: true,
      videoStatus: true,
      sourceMedia: {
        select: {
          id: true,
          originalName: true,
          originalKey: true,
          publicUrl: true,
        },
      },
      promptJobs: {
        orderBy: [{ attempt: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          attempt: true,
          status: true,
          errorMessage: true,
        },
      },
      outputs: {
        orderBy: [{ attempt: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          attempt: true,
          status: true,
          startedAt: true,
          errorCode: true,
          errorMessage: true,
          generation: {
            select: {
              id: true,
              status: true,
              localPath: true,
              errorMsg: true,
              templateData: true,
            },
          },
        },
      },
    },
  },
} as const;

export class LiveVideoBatchError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "LIVE_VIDEO_BATCH_INVALID",
  ) {
    super(message);
    this.name = "LiveVideoBatchError";
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function normalizeUuid(value: unknown, code: string, label: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!UUID_RE.test(normalized)) {
    throw new LiveVideoBatchError(`${label}无效`, 400, code);
  }
  return normalized;
}

function normalizeName(value: unknown) {
  const name = String(value || "").trim() || "未命名视频分组";
  if (name.length > 120) {
    throw new LiveVideoBatchError(
      "分组名称不能超过 120 个字符",
      400,
      "LIVE_VIDEO_BATCH_NAME_TOO_LONG",
    );
  }
  return name;
}

function normalizeExpectedVersion(value: unknown) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new LiveVideoBatchError("分组版本无效", 400, "LIVE_VIDEO_VERSION_INVALID");
  }
  return version;
}

export function liveVideoDraftRequestKey(authUserId: number) {
  const hex = createHash("sha256")
    .update(`live-video-batch-draft:${authUserId}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function liveVideoEphemeralDraftRequestKey(authUserId: number, draftSessionId: unknown) {
  const sessionId = normalizeUuid(
    draftSessionId,
    "LIVE_VIDEO_DRAFT_SESSION_INVALID",
    "Live 草稿会话",
  );
  const hex = createHash("sha256")
    .update(`live-video-batch-ephemeral-draft:${authUserId}:${sessionId}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex.splice(0, 8, ...LIVE_VIDEO_EPHEMERAL_DRAFT_PREFIX.slice(0, 8));
  hex[12] = "5";
  hex[16] = "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function isLiveVideoWorkspaceDraft(batch: any, authUserId: number) {
  const requestKey = String(batch?.requestKey || "");
  return requestKey === liveVideoDraftRequestKey(authUserId)
    || requestKey.startsWith(LIVE_VIDEO_EPHEMERAL_DRAFT_PREFIX);
}

function assertLiveVideoWorkspaceDraft(batch: any, authUserId: number) {
  if (!isLiveVideoWorkspaceDraft(batch, authUserId)) {
    throw new LiveVideoBatchError(
      "该分组不是 Live 工作区草稿",
      409,
      "LIVE_VIDEO_DRAFT_REQUIRED",
    );
  }
}

function assertLiveVideoBatchEditable(batch: any) {
  if (["queued", "submitting", "waiting_provider", "running"].includes(batch.status)) {
    throw new LiveVideoBatchError(
      "分组正在生成，暂不能修改",
      409,
      "LIVE_VIDEO_BATCH_ACTIVE",
    );
  }
}

function mediaReference(row: any) {
  const originalKey = String(row.originalKey || "").trim();
  const publicUrl = String(row.publicUrl || "").trim();
  const url = publicUrl || originalKey;
  if (!url) {
    throw new LiveVideoBatchError(
      "图片尚未准备完成",
      409,
      "LIVE_VIDEO_MEDIA_NOT_READY",
    );
  }
  return {
    mediaId: String(row.id),
    mediaUrl: url,
    mediaPath: originalKey || publicUrl,
    originalName: String(row.originalName || ""),
    mimeType: String(row.detectedMime || row.declaredMime || ""),
  };
}

function liveVideoBatchWorkspaceSourceId(batchId: string) {
  return `live_video_batch:${batchId}`;
}

async function releaseLiveVideoBatchWorkspaceReference(
  tx: any,
  batchId: string,
  mediaId: string,
) {
  return releaseBatchWorkspaceReference(tx, {
    mediaId,
    sourceId: liveVideoBatchWorkspaceSourceId(batchId),
    hasBusinessReference: async () => (await tx.liveVideoBatchItem.count({
      where: { batchId, sourceMediaId: mediaId },
    })) > 0,
  });
}

export function normalizeLiveVideoSettings(value: unknown) {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const model = String(raw.model || "").trim();
  const spec = getLiveVideoBatchModelSpec(model);
  if (!spec) {
    throw new LiveVideoBatchError(
      "请选择支持首帧图生视频的视频模型",
      400,
      "LIVE_VIDEO_MODEL_INVALID",
    );
  }
  const ratio = String(raw.ratio || spec.supportedRatios?.[0] || "adaptive").trim();
  const inputMode = getLiveVideoBatchInputModes(spec)[0];
  if (spec.supportedRatios?.length && !spec.supportedRatios.includes(ratio)) {
    throw new LiveVideoBatchError(
      "当前视频模型不支持该比例",
      400,
      "LIVE_VIDEO_RATIO_INVALID",
    );
  }
  const resolution = String(raw.resolution || spec.supportedResolutions[0] || "720p").trim();
  if (!spec.supportedResolutions.includes(resolution as any)) {
    throw new LiveVideoBatchError(
      "当前视频模型不支持该分辨率",
      400,
      "LIVE_VIDEO_RESOLUTION_INVALID",
    );
  }
  const durationOptions = getLiveVideoDurationOptions(spec);
  const defaultDuration = durationOptions.includes(LIVE_VIDEO_BATCH_DEFAULT_DURATION_SECONDS)
    ? LIVE_VIDEO_BATCH_DEFAULT_DURATION_SECONDS
    : durationOptions[0];
  const duration = raw.duration == null || raw.duration === ""
    ? defaultDuration
    : Number(raw.duration);
  if (!supportsLiveVideoDuration(spec, duration)) {
    throw new LiveVideoBatchError(
      "当前视频模型不支持该时长",
      400,
      "LIVE_VIDEO_DURATION_INVALID",
    );
  }
  return {
    model: spec.id,
    inputMode,
    duration,
    ratio,
    resolution,
    generateAudio: spec.supportsGenerateAudio && raw.generateAudio === true,
  };
}

function liveVideoSeedanceUploadOptions(videoSettings: unknown) {
  const settings = normalizeLiveVideoSettings(videoSettings);
    const contract = getSeedanceUploadContract(settings.model) || getMiniMaxH3UploadContract(settings.model) || getWanUploadContract(settings.model);
  if (!contract) return {};
  return {
    modelId: settings.model,
    allowedKinds: ["image" as const],
    maxBytes: { image: contract.maxBytes.image },
    allowedMimeTypes: contract.allowedMimeTypes.filter((mime) => mime.startsWith("image/")),
  };
}

async function assertEnabledVideoSettings(value: unknown) {
  const settings = normalizeLiveVideoSettings(value);
  const [providers, visibleModels] = await Promise.all([
    getRegisteredProviders(),
    getVisibleToolboxModels("video"),
  ]);
  if (!isProviderModelEnabled(providers, "video", settings.model)) {
    throw new LiveVideoBatchError(
      "所选视频模型未启用",
      409,
      "LIVE_VIDEO_MODEL_DISABLED",
    );
  }
  const visibleModel = visibleModels.find((model) => model.id === settings.model);
  if (!visibleModel) {
    throw new LiveVideoBatchError(
      "所选视频模型已被管理员隐藏",
      400,
      "LIVE_VIDEO_MODEL_HIDDEN",
    );
  }
  if (!visibleModel.supportedResolutions?.includes(settings.resolution as any)) {
    throw new LiveVideoBatchError(
      "所选视频分辨率已被管理员隐藏",
      400,
      "LIVE_VIDEO_RESOLUTION_HIDDEN",
    );
  }
  if (visibleModel.maxDurationSeconds !== undefined && settings.duration > visibleModel.maxDurationSeconds) {
    throw new LiveVideoBatchError("所选视频时长已被管理员关闭", 400, "LIVE_VIDEO_DURATION_HIDDEN");
  }
  return settings;
}

async function resolveSkillSnapshot(authUserId: number, publicId: unknown) {
  const overridePublicId = String(publicId || "").trim();
  const normalized = overridePublicId || await getRoleSkillFeatureBinding(
    LIVE_VIDEO_ROLE_SKILL_FEATURE_KEY,
  );
  if (!normalized) {
    throw new LiveVideoBatchError(
      "请选择用于逐图分析的 Skill",
      400,
      "LIVE_VIDEO_SKILL_REQUIRED",
    );
  }
  try {
    const skill = await resolveRoleSkillForExecution({ authUserId, publicId: normalized });
    return {
      publicId: `${skill.source}:${String(skill.id)}`,
      source: skill.source,
      id: String(skill.id),
      name: skill.name,
      revision: skill.revision,
      systemPrompt: skill.content,
    };
  } catch (error) {
    if (error instanceof RoleSkillRepositoryError) {
      throw new LiveVideoBatchError(
        error.message,
        error.code === "not-found" ? 404 : 409,
        "LIVE_VIDEO_SKILL_UNAVAILABLE",
      );
    }
    throw error;
  }
}

export async function getLiveVideoDefaultSkill(authUserId: number): Promise<{
  publicId: string;
  name: string;
  revision: number;
} | null> {
  const publicId = await getRoleSkillFeatureBinding(
    LIVE_VIDEO_ROLE_SKILL_FEATURE_KEY,
  );
  if (!publicId) return null;
  try {
    const skill = await resolveRoleSkillForExecution({ authUserId, publicId });
    return {
      publicId: `${skill.source}:${String(skill.id)}`,
      name: skill.name,
      revision: skill.revision,
    };
  } catch (error) {
    if (error instanceof RoleSkillRepositoryError) return null;
    throw error;
  }
}

export async function getOwnedLiveVideoBatch(batchId: string, authUserId: number) {
  const id = normalizeUuid(batchId, "LIVE_VIDEO_BATCH_ID_INVALID", "分组 ID");
  const batch = await db.liveVideoBatch.findFirst({
    where: { id, authUserId, deletedAt: null },
    include: BATCH_INCLUDE,
  });
  if (!batch) {
    throw new LiveVideoBatchError("分组不存在", 404, "LIVE_VIDEO_BATCH_NOT_FOUND");
  }
  return batch;
}

type LiveVideoHistoryCursor = { createdAt: string; id: string };

function encodeLiveVideoHistoryCursor(row: { createdAt: Date | string; id: string }) {
  return Buffer.from(JSON.stringify({
    createdAt: new Date(row.createdAt).toISOString(),
    id: row.id,
  } satisfies LiveVideoHistoryCursor)).toString("base64url");
}

function decodeLiveVideoHistoryCursor(value: unknown): LiveVideoHistoryCursor | null {
  const cursor = String(value || "").trim();
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as LiveVideoHistoryCursor;
    const createdAt = new Date(parsed.createdAt);
    if (!UUID_RE.test(String(parsed.id || "")) || Number.isNaN(createdAt.getTime())) throw new Error();
    return { createdAt: createdAt.toISOString(), id: parsed.id.toLowerCase() };
  } catch {
    throw new LiveVideoBatchError("历史游标无效", 400, "LIVE_VIDEO_HISTORY_CURSOR_INVALID");
  }
}

export async function listLiveVideoBatches(input: {
  authUserId: number;
  cursor?: unknown;
  take?: number;
}) {
  const take = Math.min(20, Math.max(1, Number(input.take) || LIVE_VIDEO_HISTORY_PAGE_SIZE));
  const cursor = decodeLiveVideoHistoryCursor(input.cursor);
  const rows = await db.liveVideoBatch.findMany({
    where: {
      authUserId: input.authUserId,
      deletedAt: null,
      status: { not: "draft" },
      ...(cursor ? {
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ],
      } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: BATCH_LIST_SELECT,
  });
  const batches = rows.slice(0, take);
  const hasMore = rows.length > take;
  return {
    batches,
    hasMore,
    nextCursor: hasMore && batches.length
      ? encodeLiveVideoHistoryCursor(batches[batches.length - 1])
      : null,
  };
}

export async function listLiveVideoBatchStatuses(input: {
  authUserId: number;
  batchIds: unknown[];
}) {
  const batchIds = [...new Set(input.batchIds.map((id) =>
    normalizeUuid(id, "LIVE_VIDEO_BATCH_ID_INVALID", "分组 ID"),
  ))].slice(0, 50);
  if (!batchIds.length) return [];
  return db.liveVideoBatch.findMany({
    where: {
      id: { in: batchIds },
      authUserId: input.authUserId,
      deletedAt: null,
      status: { not: "draft" },
    },
    select: BATCH_LIST_SELECT,
  });
}

export async function getOrCreateLiveVideoDraft(authUserId: number, draftSessionId?: unknown) {
  const requestKey = draftSessionId
    ? liveVideoEphemeralDraftRequestKey(authUserId, draftSessionId)
    : liveVideoDraftRequestKey(authUserId);
  const existing = await db.liveVideoBatch.findUnique({
    where: { requestKey },
    include: BATCH_INCLUDE,
  });
  if (existing) {
    if (existing.authUserId !== authUserId) {
      throw new LiveVideoBatchError("Live 草稿归属异常", 409, "LIVE_VIDEO_DRAFT_CONFLICT");
    }
    if (existing.deletedAt) {
      await db.liveVideoBatch.update({
        where: { id: existing.id },
        data: { deletedAt: null, status: "draft", version: { increment: 1 } },
      });
      return getOwnedLiveVideoBatch(existing.id, authUserId);
    }
    return existing;
  }

  try {
    const created = await db.liveVideoBatch.create({
      data: {
        authUserId,
        requestKey,
        name: "Live 视频工作区草稿",
        status: "draft",
        skillSnapshot: {},
        sharedRequirement: "",
        videoSettings: {},
        version: 1,
      },
      include: BATCH_INCLUDE,
    });
    return created;
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const concurrent = await db.liveVideoBatch.findUnique({
      where: { requestKey },
      include: BATCH_INCLUDE,
    });
    if (concurrent?.authUserId === authUserId) return concurrent;
    throw new LiveVideoBatchError("Live 草稿创建冲突", 409, "LIVE_VIDEO_DRAFT_CONFLICT");
  }
}

export async function createLiveVideoBatch(input: {
  authUserId: number;
  requestKey: unknown;
  name?: unknown;
  skillPublicId: unknown;
  sharedRequirement?: unknown;
  videoSettings: unknown;
  sourceBatchId: unknown;
}) {
  const requestKey = normalizeUuid(
    input.requestKey,
    "LIVE_VIDEO_REQUEST_KEY_INVALID",
    "请求键",
  );
  const existing = await db.liveVideoBatch.findUnique({
    where: { requestKey },
    include: BATCH_INCLUDE,
  });
  if (existing) {
    if (existing.authUserId !== input.authUserId) {
      throw new LiveVideoBatchError("请求键已被占用", 409, "LIVE_VIDEO_REQUEST_KEY_CONFLICT");
    }
    return existing;
  }

  const sourceBatchId = normalizeUuid(
    input.sourceBatchId,
    "LIVE_VIDEO_DRAFT_ID_INVALID",
    "Live 草稿 ID",
  );
  const source = await getOwnedLiveVideoBatch(sourceBatchId, input.authUserId);
  assertLiveVideoWorkspaceDraft(source, input.authUserId);
  if (!source.items.length) {
    throw new LiveVideoBatchError("请至少上传一张图片", 400, "LIVE_VIDEO_MEDIA_REQUIRED");
  }
  if (source.items.length > LIVE_VIDEO_BATCH_MAX_MEDIA) {
    throw new LiveVideoBatchError(
      `单个分组最多上传 ${LIVE_VIDEO_BATCH_MAX_MEDIA} 张图片`,
      400,
      "LIVE_VIDEO_MEDIA_LIMIT",
    );
  }

  if (source.items.some((item: any) => !item.sourceMediaId || !item.sourceMedia)) {
    throw new LiveVideoBatchError(
      "Live 草稿中存在不可用图片",
      409,
      "LIVE_VIDEO_MEDIA_NOT_READY",
    );
  }

  const [skillSnapshot, videoSettings] = await Promise.all([
    resolveSkillSnapshot(input.authUserId, input.skillPublicId),
    assertEnabledVideoSettings(input.videoSettings),
  ]);
  const batchId = crypto.randomUUID();
  const now = new Date();
  const items = source.items.map((sourceItem: any, position: number) => {
    const snapshot = mediaReference(sourceItem.sourceMedia);
    return {
      id: crypto.randomUUID(),
      batchId,
      position,
      name: snapshot.originalName || `视频任务 ${position + 1}`,
      sourceMediaId: sourceItem.sourceMediaId,
      mediaSnapshot: snapshot,
      promptStatus: "prompt_queued",
      videoStatus: "draft",
      createdAt: now,
      updatedAt: now,
    };
  });

  try {
    await db.$transaction(async (tx: any) => {
      await tx.liveVideoBatch.create({
        data: {
          id: batchId,
          authUserId: input.authUserId,
          requestKey,
          name: normalizeName(input.name),
          status: "prompt_queued",
          skillSnapshot,
          sharedRequirement: String(input.sharedRequirement || "").trim(),
          videoSettings,
          version: 1,
        },
      });
      await tx.liveVideoBatchItem.createMany({ data: items });
      await tx.liveVideoPromptJob.createMany({
        data: items.map((item: any) => ({
          id: crypto.randomUUID(),
          batchId,
          itemId: item.id,
          attempt: 1,
          requestKey: crypto.randomUUID(),
          skillSnapshot,
          systemPrompt: skillSnapshot.systemPrompt,
          userPrompt: String(input.sharedRequirement || "").trim(),
          mediaSnapshot: item.mediaSnapshot,
          status: "queued",
          availableAt: now,
        })),
      });
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const concurrent = await db.liveVideoBatch.findUnique({
      where: { requestKey },
      include: BATCH_INCLUDE,
    });
    if (concurrent?.authUserId === input.authUserId) return concurrent;
    throw new LiveVideoBatchError("请求键已被占用", 409, "LIVE_VIDEO_REQUEST_KEY_CONFLICT");
  }

  return getOwnedLiveVideoBatch(batchId, input.authUserId);
}

export async function updateLiveVideoBatchDraft(input: {
  authUserId: number;
  batchId: string;
  expectedVersion: unknown;
  name?: unknown;
  workspaceSkillPublicId?: unknown;
  sharedRequirement?: unknown;
  videoSettings?: unknown;
  itemPrompts?: unknown;
}) {
  const batch = await getOwnedLiveVideoBatch(input.batchId, input.authUserId);
  const expectedVersion = normalizeExpectedVersion(input.expectedVersion);
  assertLiveVideoBatchEditable(batch);
  const workspaceDraft = isLiveVideoWorkspaceDraft(batch, input.authUserId);
  if (
    !workspaceDraft
    && (input.workspaceSkillPublicId !== undefined || input.sharedRequirement !== undefined)
  ) {
    throw new LiveVideoBatchError(
      "只有 Live 工作区草稿可以更新左侧设置",
      409,
      "LIVE_VIDEO_DRAFT_REQUIRED",
    );
  }
  const videoSettings = input.videoSettings === undefined
    ? undefined
    : workspaceDraft
      ? normalizeLiveVideoSettings(input.videoSettings)
      : await assertEnabledVideoSettings(input.videoSettings);
  const promptPatches = Array.isArray(input.itemPrompts) ? input.itemPrompts : [];
  const ownedItemIds = new Set(batch.items.map((item: any) => String(item.id)));
  const normalizedPrompts = promptPatches.map((patch: any) => {
    const itemId = normalizeUuid(patch?.itemId, "LIVE_VIDEO_ITEM_ID_INVALID", "任务 ID");
    if (!ownedItemIds.has(itemId)) {
      throw new LiveVideoBatchError("任务不存在", 404, "LIVE_VIDEO_ITEM_NOT_FOUND");
    }
    const prompt = String(patch?.prompt || "").trim();
    if (!prompt) {
      throw new LiveVideoBatchError("视频提示词不能为空", 400, "LIVE_VIDEO_PROMPT_REQUIRED");
    }
    return { itemId, prompt };
  });

  await db.$transaction(async (tx: any) => {
    const updated = await tx.liveVideoBatch.updateMany({
      where: { id: batch.id, authUserId: input.authUserId, version: expectedVersion },
      data: {
        ...(input.name !== undefined ? { name: normalizeName(input.name) } : {}),
        ...(input.workspaceSkillPublicId !== undefined
          ? { skillSnapshot: { publicId: String(input.workspaceSkillPublicId || "").trim() } }
          : {}),
        ...(input.sharedRequirement !== undefined
          ? { sharedRequirement: String(input.sharedRequirement || "").trim() }
          : {}),
        ...(videoSettings ? { videoSettings } : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new LiveVideoBatchError(
        "分组已在其他页面更新，请刷新后重试",
        409,
        "LIVE_VIDEO_VERSION_CONFLICT",
      );
    }
    for (const patch of normalizedPrompts) {
      await tx.liveVideoBatchItem.updateMany({
        where: { id: patch.itemId, batchId: batch.id },
        data: { prompt: patch.prompt, promptStatus: "prompt_ready" },
      });
    }
  });
  return getOwnedLiveVideoBatch(batch.id, input.authUserId);
}

export async function importLiveVideoBatchProductLibraryMedia(input: {
  authUserId: number;
  batchId: string;
  productLibraryItemId: number;
  requestKey: string;
  expectedVersion: unknown;
  itemId?: string | null;
}) {
  const batch = await getOwnedLiveVideoBatch(input.batchId, input.authUserId);
  const expectedVersion = normalizeExpectedVersion(input.expectedVersion);
  const itemId = input.itemId
    ? normalizeUuid(input.itemId, "LIVE_VIDEO_ITEM_ID_INVALID", "任务 ID")
    : null;
  if (itemId) {
    assertLiveVideoBatchEditable(batch);
    if (!batch.items.some((item: any) => String(item.id) === itemId)) {
      throw new LiveVideoBatchError("任务不存在", 404, "LIVE_VIDEO_ITEM_NOT_FOUND");
    }
  } else {
    assertLiveVideoWorkspaceDraft(batch, input.authUserId);
  }

  try {
    const imported = await importBatchProductLibrarySnapshot({
      authUserId: input.authUserId,
      batchId: input.batchId,
      productLibraryItemId: input.productLibraryItemId,
      requestKey: input.requestKey,
      adapter: {
        modeKey: "live_video_batch",
        sourceId: liveVideoBatchWorkspaceSourceId(input.batchId),
        hasBusinessReference: async (tx: any, mediaId: string) => (
          await tx.liveVideoBatchItem.count({
            where: { batchId: input.batchId, sourceMediaId: mediaId },
          })
        ) > 0,
        attach: async (tx: any, mediaId: string) => {
          const existing = await tx.liveVideoBatchItem.findFirst({
            where: itemId
              ? { id: itemId, batchId: input.batchId, sourceMediaId: mediaId }
              : { batchId: input.batchId, sourceMediaId: mediaId },
            select: { id: true },
          });
          if (existing) {
            return {
              value: { replacedMediaIds: [] as string[] },
              reused: true,
            };
          }

          const media = await tx.mediaAsset.findFirst({
            where: {
              id: mediaId,
              ownerUserId: input.authUserId,
              kind: "image",
              status: "ready",
              purgedAt: null,
            },
          });
          if (!media) {
            throw new LiveVideoBatchError(
              "图片尚未准备完成",
              409,
              "LIVE_VIDEO_MEDIA_NOT_READY",
            );
          }
          const mediaSnapshot = mediaReference(media);
          let replacedMediaIds: string[] = [];

          if (itemId) {
            const target = await tx.liveVideoBatchItem.findFirst({
              where: { id: itemId, batchId: input.batchId },
              select: { id: true, sourceMediaId: true },
            });
            if (!target) {
              throw new LiveVideoBatchError("任务不存在", 404, "LIVE_VIDEO_ITEM_NOT_FOUND");
            }
            const updatedBatch = await tx.liveVideoBatch.updateMany({
              where: {
                id: input.batchId,
                authUserId: input.authUserId,
                version: expectedVersion,
              },
              data: {
                status: "draft",
                finishedAt: null,
                version: { increment: 1 },
              },
            });
            if (updatedBatch.count !== 1) {
              throw new LiveVideoBatchError(
                "分组已在其他页面更新，请刷新后重试",
                409,
                "LIVE_VIDEO_VERSION_CONFLICT",
              );
            }
            const updatedItem = await tx.liveVideoBatchItem.updateMany({
              where: { id: itemId, batchId: input.batchId },
              data: {
                sourceMediaId: mediaId,
                mediaSnapshot,
                videoStatus: "draft",
              },
            });
            if (updatedItem.count !== 1) {
              throw new LiveVideoBatchError("任务不存在", 404, "LIVE_VIDEO_ITEM_NOT_FOUND");
            }
            if (target.sourceMediaId && String(target.sourceMediaId) !== mediaId) {
              replacedMediaIds = [String(target.sourceMediaId)];
              await releaseLiveVideoBatchWorkspaceReference(
                tx,
                input.batchId,
                String(target.sourceMediaId),
              );
            }
          } else {
            const itemCount = await tx.liveVideoBatchItem.count({
              where: { batchId: input.batchId },
            });
            if (itemCount >= LIVE_VIDEO_BATCH_MAX_MEDIA) {
              throw new LiveVideoBatchError(
                `单个分组最多上传 ${LIVE_VIDEO_BATCH_MAX_MEDIA} 张图片`,
                400,
                "LIVE_VIDEO_MEDIA_LIMIT",
              );
            }
            const lastItem = await tx.liveVideoBatchItem.findFirst({
              where: { batchId: input.batchId },
              orderBy: [{ position: "desc" }, { id: "desc" }],
              select: { position: true },
            });
            const updatedBatch = await tx.liveVideoBatch.updateMany({
              where: {
                id: input.batchId,
                authUserId: input.authUserId,
                version: expectedVersion,
                status: "draft",
              },
              data: { version: { increment: 1 } },
            });
            if (updatedBatch.count !== 1) {
              throw new LiveVideoBatchError(
                "Live 工作区已在其他页面更新，请刷新后重试",
                409,
                "LIVE_VIDEO_VERSION_CONFLICT",
              );
            }
            const position = Number(lastItem?.position ?? -1) + 1;
            await tx.liveVideoBatchItem.create({
              data: {
                batchId: input.batchId,
                position,
                name: mediaSnapshot.originalName || `视频任务 ${position + 1}`,
                sourceMediaId: mediaId,
                mediaSnapshot,
                promptStatus: "draft",
                videoStatus: "draft",
              },
            });
          }

          return {
            value: { replacedMediaIds },
            reused: false,
          };
        },
      },
    });
    if (imported.value.replacedMediaIds.length) {
      await releaseOwnedUnreferencedToolMedia({
        ownerUserId: input.authUserId,
        mediaIds: imported.value.replacedMediaIds,
      });
    }
  } catch (error) {
    if (error instanceof BatchProductLibraryError) {
      throw new LiveVideoBatchError(error.message, error.status, error.code);
    }
    throw error;
  }

  return getOwnedLiveVideoBatch(batch.id, input.authUserId);
}

export async function uploadAndAttachLiveVideoDraftMediaFiles(input: {
  authUserId: number;
  batchId: string;
  expectedVersion: unknown;
  draftSessionId: string;
  files: File[];
}) {
  if (!input.files.length) {
    throw new LiveVideoBatchError("请选择图片", 400, "LIVE_VIDEO_MEDIA_REQUIRED");
  }
  const batch = await getOwnedLiveVideoBatch(input.batchId, input.authUserId);
  const seedanceUploadOptions = liveVideoSeedanceUploadOptions(batch.videoSettings);
  const expectedVersion = normalizeExpectedVersion(input.expectedVersion);
  assertLiveVideoWorkspaceDraft(batch, input.authUserId);
  if (batch.items.length + input.files.length > LIVE_VIDEO_BATCH_MAX_MEDIA) {
    throw new LiveVideoBatchError(
      `单个分组最多上传 ${LIVE_VIDEO_BATCH_MAX_MEDIA} 张图片`,
      400,
      "LIVE_VIDEO_MEDIA_LIMIT",
    );
  }
  const draftSessionId = String(input.draftSessionId || "").trim();
  if (!draftSessionId) {
    throw new LiveVideoBatchError("上传会话无效", 400, "LIVE_VIDEO_MEDIA_SESSION_REQUIRED");
  }

  const completedMediaIds: string[] = [];
  let uploaded: Awaited<ReturnType<typeof uploadToolMedia>>[];
  try {
    uploaded = await mapWithConcurrency(
      input.files,
      BATCH_UPLOAD_CONCURRENCY,
      async (file) => {
        try {
          const result = await uploadToolMedia({
            ownerUserId: input.authUserId,
            draftSessionId,
            file,
            storageProfile: "batch",
            metadata: { batchId: batch.id },
            ...seedanceUploadOptions,
          });
          completedMediaIds.push(result.mediaId);
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : "上传失败";
          throw new Error(`${file.name}：${message}`);
        }
      },
    );
  } catch (error) {
    if (completedMediaIds.length) {
      await releaseToolMedia({
        ownerUserId: input.authUserId,
        draftSessionId,
        mediaIds: completedMediaIds,
      }).catch(() => null);
    }
    throw error;
  }

  try {
    if (uploaded.some((media) => media.kind !== "image")) {
      throw new LiveVideoBatchError(
        "Live 视频任务仅支持图片素材",
        400,
        "LIVE_VIDEO_MEDIA_KIND_INVALID",
      );
    }
    const uploadedMediaIds = uploaded.map((media) => media.mediaId);
    const mediaRows = await db.mediaAsset.findMany({
      where: {
        id: { in: uploadedMediaIds },
        ownerUserId: input.authUserId,
        kind: "image",
        status: "ready",
        purgedAt: null,
      },
    });
    const mediaById = new Map(mediaRows.map((media: any) => [String(media.id), media]));
    if (uploadedMediaIds.some((mediaId) => !mediaById.has(mediaId))) {
      throw new LiveVideoBatchError(
        "图片尚未准备完成",
        409,
        "LIVE_VIDEO_MEDIA_NOT_READY",
      );
    }
    const position = batch.items.length
      ? Math.max(...batch.items.map((item: any) => Number(item.position) || 0)) + 1
      : 0;
    await db.$transaction(async (tx: any) => {
      const updatedBatch = await tx.liveVideoBatch.updateMany({
        where: {
          id: batch.id,
          authUserId: input.authUserId,
          version: expectedVersion,
          status: "draft",
        },
        data: { version: { increment: 1 } },
      });
      if (updatedBatch.count !== 1) {
        throw new LiveVideoBatchError(
          "Live 工作区已在其他页面更新，请刷新后重试",
          409,
          "LIVE_VIDEO_VERSION_CONFLICT",
        );
      }
      for (const [index, mediaId] of uploadedMediaIds.entries()) {
        const mediaSnapshot = mediaReference(mediaById.get(mediaId));
        await tx.liveVideoBatchItem.create({
          data: {
            batchId: batch.id,
            position: position + index,
            name: mediaSnapshot.originalName || `视频任务 ${position + index + 1}`,
            sourceMediaId: mediaId,
            mediaSnapshot,
            promptStatus: "draft",
            videoStatus: "draft",
          },
        });
      }
      await tx.mediaAsset.updateMany({
        where: { id: { in: uploadedMediaIds }, ownerUserId: input.authUserId },
        data: { retentionUntil: null },
      });
    });
  } catch (error) {
    await releaseToolMedia({
      ownerUserId: input.authUserId,
      draftSessionId,
      mediaIds: uploaded.map((media) => media.mediaId),
    }).catch(() => null);
    throw error;
  }
  return getOwnedLiveVideoBatch(batch.id, input.authUserId);
}

export async function uploadAndAttachLiveVideoDraftMedia(input: {
  authUserId: number;
  batchId: string;
  expectedVersion: unknown;
  draftSessionId: string;
  file: File;
}) {
  return uploadAndAttachLiveVideoDraftMediaFiles({
    ...input,
    files: [input.file],
  });
}

export async function detachLiveVideoDraftMedia(input: {
  authUserId: number;
  batchId: string;
  itemId: string;
  expectedVersion: unknown;
}) {
  const batch = await getOwnedLiveVideoBatch(input.batchId, input.authUserId);
  const expectedVersion = normalizeExpectedVersion(input.expectedVersion);
  assertLiveVideoWorkspaceDraft(batch, input.authUserId);
  const itemId = normalizeUuid(input.itemId, "LIVE_VIDEO_ITEM_ID_INVALID", "素材 ID");
  const item = batch.items.find((candidate: any) => String(candidate.id) === itemId);
  if (!item) {
    throw new LiveVideoBatchError("素材不存在", 404, "LIVE_VIDEO_ITEM_NOT_FOUND");
  }

  await db.$transaction(async (tx: any) => {
    const updatedBatch = await tx.liveVideoBatch.updateMany({
      where: {
        id: batch.id,
        authUserId: input.authUserId,
        version: expectedVersion,
        status: "draft",
      },
      data: { version: { increment: 1 } },
    });
    if (updatedBatch.count !== 1) {
      throw new LiveVideoBatchError(
        "Live 工作区已在其他页面更新，请刷新后重试",
        409,
        "LIVE_VIDEO_VERSION_CONFLICT",
      );
    }
    await tx.liveVideoBatchItem.delete({ where: { id: itemId } });
    if (item.sourceMediaId) {
      await releaseLiveVideoBatchWorkspaceReference(
        tx,
        batch.id,
        String(item.sourceMediaId),
      );
    }
  });
  if (item.sourceMediaId) {
    await releaseOwnedUnreferencedToolMedia({
      ownerUserId: input.authUserId,
      mediaIds: [String(item.sourceMediaId)],
    });
  }
  return getOwnedLiveVideoBatch(batch.id, input.authUserId);
}

export async function uploadAndReplaceLiveVideoItemMedia(input: {
  authUserId: number;
  batchId: string;
  itemId: string;
  expectedVersion: unknown;
  draftSessionId: string;
  file: File;
}) {
  const batch = await getOwnedLiveVideoBatch(input.batchId, input.authUserId);
  const seedanceUploadOptions = liveVideoSeedanceUploadOptions(batch.videoSettings);
  const expectedVersion = normalizeExpectedVersion(input.expectedVersion);
  assertLiveVideoBatchEditable(batch);
  const itemId = normalizeUuid(input.itemId, "LIVE_VIDEO_ITEM_ID_INVALID", "任务 ID");
  const item = batch.items.find((candidate: any) => String(candidate.id) === itemId);
  if (!item) {
    throw new LiveVideoBatchError("任务不存在", 404, "LIVE_VIDEO_ITEM_NOT_FOUND");
  }
  const draftSessionId = String(input.draftSessionId || "").trim();
  if (!draftSessionId) {
    throw new LiveVideoBatchError("上传会话无效", 400, "LIVE_VIDEO_MEDIA_SESSION_REQUIRED");
  }

  const uploaded = await uploadToolMedia({
    ownerUserId: input.authUserId,
    draftSessionId,
    file: input.file,
    storageProfile: "batch",
    metadata: { batchId: batch.id },
    ...seedanceUploadOptions,
  });
  try {
    if (uploaded.kind !== "image") {
      throw new LiveVideoBatchError(
        "Live 视频任务仅支持图片素材",
        400,
        "LIVE_VIDEO_MEDIA_KIND_INVALID",
      );
    }
    const media = await db.mediaAsset.findFirst({
      where: {
        id: uploaded.mediaId,
        ownerUserId: input.authUserId,
        kind: "image",
        status: "ready",
        purgedAt: null,
      },
    });
    if (!media) {
      throw new LiveVideoBatchError(
        "图片尚未准备完成",
        409,
        "LIVE_VIDEO_MEDIA_NOT_READY",
      );
    }
    const mediaSnapshot = mediaReference(media);
    await db.$transaction(async (tx: any) => {
      const updatedBatch = await tx.liveVideoBatch.updateMany({
        where: { id: batch.id, authUserId: input.authUserId, version: expectedVersion },
        data: {
          status: "draft",
          finishedAt: null,
          version: { increment: 1 },
        },
      });
      if (updatedBatch.count !== 1) {
        throw new LiveVideoBatchError(
          "分组已在其他页面更新，请刷新后重试",
          409,
          "LIVE_VIDEO_VERSION_CONFLICT",
        );
      }
      const updatedItem = await tx.liveVideoBatchItem.updateMany({
        where: { id: itemId, batchId: batch.id },
        data: {
          sourceMediaId: uploaded.mediaId,
          mediaSnapshot,
          videoStatus: "draft",
        },
      });
      if (updatedItem.count !== 1) {
        throw new LiveVideoBatchError("任务不存在", 404, "LIVE_VIDEO_ITEM_NOT_FOUND");
      }
      if (item.sourceMediaId && item.sourceMediaId !== uploaded.mediaId) {
        await releaseLiveVideoBatchWorkspaceReference(
          tx,
          batch.id,
          String(item.sourceMediaId),
        );
      }
      await tx.mediaAsset.updateMany({
        where: { id: uploaded.mediaId, ownerUserId: input.authUserId },
        data: { retentionUntil: null },
      });
    });
  } catch (error) {
    await releaseToolMedia({
      ownerUserId: input.authUserId,
      draftSessionId,
      mediaIds: [uploaded.mediaId],
    }).catch(() => null);
    throw error;
  }

  if (item.sourceMediaId && item.sourceMediaId !== uploaded.mediaId) {
    await releaseOwnedUnreferencedToolMedia({
      ownerUserId: input.authUserId,
      mediaIds: [String(item.sourceMediaId)],
    });
  }
  return getOwnedLiveVideoBatch(batch.id, input.authUserId);
}

export async function detachLiveVideoItemMedia(input: {
  authUserId: number;
  batchId: string;
  itemId: string;
  expectedVersion: unknown;
}) {
  const batch = await getOwnedLiveVideoBatch(input.batchId, input.authUserId);
  const expectedVersion = normalizeExpectedVersion(input.expectedVersion);
  assertLiveVideoBatchEditable(batch);
  const itemId = normalizeUuid(input.itemId, "LIVE_VIDEO_ITEM_ID_INVALID", "任务 ID");
  const item = batch.items.find((candidate: any) => String(candidate.id) === itemId);
  if (!item) {
    throw new LiveVideoBatchError("任务不存在", 404, "LIVE_VIDEO_ITEM_NOT_FOUND");
  }
  if (!item.sourceMediaId) return batch;

  await db.$transaction(async (tx: any) => {
    const updatedBatch = await tx.liveVideoBatch.updateMany({
      where: { id: batch.id, authUserId: input.authUserId, version: expectedVersion },
      data: {
        status: "draft",
        finishedAt: null,
        version: { increment: 1 },
      },
    });
    if (updatedBatch.count !== 1) {
      throw new LiveVideoBatchError(
        "分组已在其他页面更新，请刷新后重试",
        409,
        "LIVE_VIDEO_VERSION_CONFLICT",
      );
    }
    const updatedItem = await tx.liveVideoBatchItem.updateMany({
      where: { id: itemId, batchId: batch.id },
      data: {
        sourceMediaId: null,
        mediaSnapshot: {},
        videoStatus: "draft",
      },
    });
    if (updatedItem.count !== 1) {
      throw new LiveVideoBatchError("任务不存在", 404, "LIVE_VIDEO_ITEM_NOT_FOUND");
    }
    await releaseLiveVideoBatchWorkspaceReference(
      tx,
      batch.id,
      String(item.sourceMediaId),
    );
  });
  await releaseOwnedUnreferencedToolMedia({
    ownerUserId: input.authUserId,
    mediaIds: [String(item.sourceMediaId)],
  });
  return getOwnedLiveVideoBatch(batch.id, input.authUserId);
}

function outputSnapshot(batch: any, item: any, settings: ReturnType<typeof normalizeLiveVideoSettings>) {
  const media = item.mediaSnapshot && typeof item.mediaSnapshot === "object"
    ? item.mediaSnapshot
    : {};
  return {
    batchId: batch.id,
    itemId: item.id,
    authUserId: batch.authUserId,
    sourceMediaId: item.sourceMediaId,
    mediaPath: String(media.mediaPath || media.mediaUrl || ""),
    prompt: String(item.prompt || "").trim(),
    ...(String(batch.sharedRequirement || "").trim()
      ? { userPrompt: String(batch.sharedRequirement).trim() }
      : {}),
    ...settings,
    skill: {
      publicId: batch.skillSnapshot?.publicId || null,
      name: batch.skillSnapshot?.name || null,
      revision: batch.skillSnapshot?.revision || null,
    },
    schemaVersion: 1,
  };
}

export async function submitLiveVideoBatch(input: {
  authUserId: number;
  batchId: string;
  submissionKey: unknown;
  itemRequestKeys: unknown;
}) {
  const submissionKey = normalizeUuid(
    input.submissionKey,
    "LIVE_VIDEO_SUBMISSION_KEY_INVALID",
    "提交键",
  );
  const batch = await getOwnedLiveVideoBatch(input.batchId, input.authUserId);
  if (batch.lastSubmissionKey === submissionKey) return batch;
  if (!batch.items.length) {
    throw new LiveVideoBatchError("分组没有任务", 400, "LIVE_VIDEO_ITEMS_EMPTY");
  }
  if (batch.items.some((item: any) => !item.sourceMediaId)) {
    throw new LiveVideoBatchError(
      "请为每个任务上传一张图片",
      400,
      "LIVE_VIDEO_MEDIA_REQUIRED",
    );
  }
  if (batch.items.some((item: any) => !String(item.prompt || "").trim())) {
    throw new LiveVideoBatchError(
      "请等待所有 Skill 分析完成并检查提示词",
      400,
      "LIVE_VIDEO_PROMPT_REQUIRED",
    );
  }
  if (batch.items.some((item: any) => item.outputs.some((output: any) =>
    ["queued", "submitting", "waiting_provider"].includes(output.status),
  ))) {
    throw new LiveVideoBatchError("分组已有正在生成的任务", 409, "LIVE_VIDEO_BATCH_ACTIVE");
  }
  const requestKeyRecord = input.itemRequestKeys && typeof input.itemRequestKeys === "object"
    ? input.itemRequestKeys as Record<string, unknown>
    : {};
  const settings = await assertEnabledVideoSettings(batch.videoSettings);
  const requests: Array<{ item: any; requestKey: string; attempt: number }> = batch.items.map((item: any) => ({
    item,
    requestKey: normalizeUuid(
      requestKeyRecord[item.id],
      "LIVE_VIDEO_OUTPUT_REQUEST_KEY_INVALID",
      `${item.name || "任务"}请求键`,
    ),
    attempt: Math.max(0, ...item.outputs.map((output: any) => Number(output.attempt) || 0)) + 1,
  }));
  const now = new Date();

  await db.$transaction(async (tx: any) => {
    const updated = await tx.liveVideoBatch.updateMany({
      where: {
        id: batch.id,
        authUserId: input.authUserId,
        version: batch.version,
        OR: [{ lastSubmissionKey: null }, { lastSubmissionKey: { not: submissionKey } }],
      },
      data: {
        status: "queued",
        lastSubmissionKey: submissionKey,
        submittedAt: now,
        finishedAt: null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      const concurrent = await tx.liveVideoBatch.findUnique({ where: { id: batch.id } });
      if (concurrent?.lastSubmissionKey === submissionKey) return;
      throw new LiveVideoBatchError(
        "分组已更新，请刷新后重试",
        409,
        "LIVE_VIDEO_VERSION_CONFLICT",
      );
    }
    await tx.liveVideoBatchOutput.createMany({
      data: requests.map(({ item, requestKey, attempt }) => ({
        batchId: batch.id,
        itemId: item.id,
        attempt,
        requestKey,
        requestSnapshot: outputSnapshot(batch, item, settings),
        status: "queued",
        nextPollAt: now,
      })),
    });
    await tx.liveVideoBatchItem.updateMany({
      where: { batchId: batch.id },
      data: { videoStatus: "queued" },
    });
  });
  return getOwnedLiveVideoBatch(batch.id, input.authUserId);
}

export async function retryLiveVideoPrompt(input: {
  authUserId: number;
  batchId: string;
  itemId: string;
  requestKey: unknown;
}) {
  const requestKey = normalizeUuid(
    input.requestKey,
    "LIVE_VIDEO_PROMPT_REQUEST_KEY_INVALID",
    "提示词重试键",
  );
  const batch = await getOwnedLiveVideoBatch(input.batchId, input.authUserId);
  const item = batch.items.find((candidate: any) => candidate.id === input.itemId);
  if (!item) throw new LiveVideoBatchError("任务不存在", 404, "LIVE_VIDEO_ITEM_NOT_FOUND");
  if (!item.sourceMediaId) {
    throw new LiveVideoBatchError("请先上传任务图片", 400, "LIVE_VIDEO_MEDIA_REQUIRED");
  }
  const existing = item.promptJobs.find((job: any) => job.requestKey === requestKey);
  if (existing) return batch;
  if (item.promptStatus !== "prompt_failed") {
    throw new LiveVideoBatchError("只有分析失败的任务可以重试", 409, "LIVE_VIDEO_PROMPT_NOT_FAILED");
  }
  const attempt = Math.max(0, ...item.promptJobs.map((job: any) => Number(job.attempt) || 0)) + 1;
  await db.$transaction(async (tx: any) => {
    await tx.liveVideoPromptJob.create({
      data: {
        batchId: batch.id,
        itemId: item.id,
        attempt,
        requestKey,
        skillSnapshot: batch.skillSnapshot,
        systemPrompt: batch.skillSnapshot.systemPrompt,
        userPrompt: batch.sharedRequirement,
        mediaSnapshot: item.mediaSnapshot,
        status: "queued",
      },
    });
    await tx.liveVideoBatchItem.update({
      where: { id: item.id },
      data: { promptStatus: "prompt_queued" },
    });
    await tx.liveVideoBatch.update({
      where: { id: batch.id },
      data: { status: "prompt_queued", finishedAt: null },
    });
  });
  return getOwnedLiveVideoBatch(batch.id, input.authUserId);
}

export async function retryLiveVideoOutput(input: {
  authUserId: number;
  batchId: string;
  itemId: string;
  requestKey: unknown;
}) {
  const requestKey = normalizeUuid(
    input.requestKey,
    "LIVE_VIDEO_OUTPUT_REQUEST_KEY_INVALID",
    "视频重试键",
  );
  const batch = await getOwnedLiveVideoBatch(input.batchId, input.authUserId);
  const item = batch.items.find((candidate: any) => candidate.id === input.itemId);
  if (!item) throw new LiveVideoBatchError("任务不存在", 404, "LIVE_VIDEO_ITEM_NOT_FOUND");
  if (!item.sourceMediaId) {
    throw new LiveVideoBatchError("请先上传任务图片", 400, "LIVE_VIDEO_MEDIA_REQUIRED");
  }
  if (item.outputs.some((output: any) => output.requestKey === requestKey)) return batch;
  const latest = item.outputs[0];
  if (!latest || latest.status !== "failed") {
    throw new LiveVideoBatchError("只有生成失败的任务可以重试", 409, "LIVE_VIDEO_OUTPUT_NOT_FAILED");
  }
  const settings = await assertEnabledVideoSettings(batch.videoSettings);
  const attempt = Math.max(0, ...item.outputs.map((output: any) => Number(output.attempt) || 0)) + 1;
  await db.$transaction(async (tx: any) => {
    await tx.liveVideoBatchOutput.create({
      data: {
        batchId: batch.id,
        itemId: item.id,
        attempt,
        requestKey,
        requestSnapshot: outputSnapshot(batch, item, settings),
        status: "queued",
        nextPollAt: new Date(),
      },
    });
    await tx.liveVideoBatchItem.update({
      where: { id: item.id },
      data: { videoStatus: "queued" },
    });
    await tx.liveVideoBatch.update({
      where: { id: batch.id },
      data: { status: "queued", finishedAt: null },
    });
  });
  return getOwnedLiveVideoBatch(batch.id, input.authUserId);
}

export async function softDeleteLiveVideoBatch(batchId: string, authUserId: number) {
  const batch = await getOwnedLiveVideoBatch(batchId, authUserId);
  if (batch.items.some((item: any) => item.outputs.some((output: any) =>
    ["queued", "submitting", "waiting_provider"].includes(output.status),
  ))) {
    throw new LiveVideoBatchError("分组正在生成，暂不能删除", 409, "LIVE_VIDEO_BATCH_ACTIVE");
  }
  await db.liveVideoBatch.update({
    where: { id: batch.id },
    data: { deletedAt: new Date(), version: { increment: 1 } },
  });
  return { deleted: true };
}
