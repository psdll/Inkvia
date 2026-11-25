import type { AgentOutputContract } from "./agent-output-observation";
import { normalizeVideoCombination, validateVideoResolvedInputs } from "./video-input-capabilities";
﻿import { prisma } from "@/lib/prisma";
import fs from "node:fs/promises";
import { reserveRuntimeGeneration } from "@/lib/runtime-generation-budget";
import path from "node:path";

import { Prisma } from "@prisma/client";
import { Logger } from "@/lib/logger";
import { snapshotLibraryInputs } from "@/lib/generation/input-snapshot";
import { buildGenerationPrompt } from "@/lib/generation/prompt-references";
import {
  isGenerationRequestKeyConflict,
  runGenerationRequestIdempotently,
} from "@/lib/generation/request-key-idempotency";

/**
 * 把任意"素材路径"解析成 seedance / sora2 可以拉取的 public URL。
 *
 * 兼容三种入参形式:
 *   1. /uploads/imports/...                    本地路径 → 上传到 OSS 后返回新 URL
 *   2. https://my-bucket.aliyuncs.com/...      已是 OSS public URL → 直接返回
 *   3. https://任意外站/...                     远端 URL(例如历史资产里的 KIE 输出) → 直接返回
 *
 * 历史 bug 背景:lib/storage.ts:saveUploadedFile 在 OSS 模式下会直接把文件
 * 上传到 OSS 并返回 OSS URL,但 Generation.localPath 字段还是叫这个名,导致
 * 下游误以为是本地 /uploads/ 路径。本函数把契约扳回:**任何 http(s) URL 都
 * 视为"已可访问的 OSS public URL"**,不必再次上传。
 */
async function resolveToOssUrl(path: string, folder: string, target?: MediaDeliveryTarget | null, kind?: MediaKind): Promise<string> {
  const safe = String(path || "").replaceAll("\\", "/").trim();
  if (!safe) throw new Error("空素材路径");
  return resolveMediaForPlatform(safe, folder, target, kind);
}

/** Platform that reads a video model's reference media (platform hosting vs. Aliyun OSS). */
function videoMediaDeliveryTarget(model: string): MediaDeliveryTarget | null {
  if (isKieVideoModel(model) || isGeminiOmniVideoModel(model)) return { platform: "kie" };
  if (isApimartVideoModel(model)) return { platform: "apimart" };
  if (isWanVideoModel(model)) return { platform: "bailian", model: WAN_VIDEO_MODEL_ID };
  if (isMiniMaxH3VideoModel(model)) return { platform: "minimax" };
  if (isVolcengineVideoModel(model)) return { platform: "volcengine", model };
  return null;
}
import {
  getKieVideoApiModel,
  getVideoModelSpec,
  isApimartVideoModel,
  isGeminiOmniVideoModel,
  isKieVideoModel,
  isVolcengineVideoModel,
  modelSupportsGenerateAudio,
  modelSupportsResolution,
  modelSupportsWebSearch,
  normalizeVideoInputMode,
  normalizeVideoModelId,
  isSeedance25VideoModel,
  APIMART_SEEDANCE_25_MODEL_ID,
  type SeedanceOmniReferenceTaskType,
  type SeedanceOutputFormat,
} from "@/lib/sora2";
import { isMiniMaxH3VideoModel } from "@/lib/minimax-models";
import { isWanVideoModel, WAN_PROVIDER_ID, WAN_VIDEO_MODEL_ID } from "@/lib/wan-models";
import { buildWanVideoRequest, wanSubmitVideo, type WanVideoInput } from "@/lib/wan-video";
import { kieCreateTask } from "@/lib/kie";
import { resolveMediaForPlatform, type MediaDeliveryTarget } from "@/lib/media-delivery/deliver";
import type { MediaKind } from "@/lib/media-delivery/catalog";
import { deliverToolMediaForPlatform } from "@/lib/media-delivery/tool-media";
import {
  detectMediaType,
  seedanceCreateTask,
  type SeedanceInputMode,
  type SeedanceMediaFile,
  type SeedanceModelId,
  type SeedanceRatio,
  type SeedanceResolution,
} from "@/lib/seedance";
import { apimartSubmitVideo, isApimartSeedanceFaceModel } from "@/lib/apimart-video";
import {
  miniMaxSubmitVideo,
  type MiniMaxH3CreateInput,
  type MiniMaxH3Media,
} from "@/lib/minimax-video";
import { assertMiniMaxH3ConcurrencyAvailable } from "@/lib/minimax-h3-concurrency";
import { formatFriendlyMessageForStorage, toFriendlyError, unknownFriendlyErrorLogMeta } from "@/lib/error-friendly";
import { providerFailureText } from "@/lib/providers/failure-capture";
import { upsertUsageLedgerForGenerationId } from "@/lib/billing-ledger";
import { assertBillingReady } from "@/lib/billing/admission";
import { upsertAdminAssetFeedForGenerationId } from "@/lib/admin-asset-feed";
import { isVideoModelVisible } from "@/lib/image-edit-models";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { getRegisteredProviders } from "@/lib/providers/registry";
import {
  buildToolMediaLogMetadata,
  createGenerationWithToolMedia,
  inspectToolMediaInputs,
  resolveOrderedGenerationInputs,
  ToolMediaInputError,
  type GenerationToolMediaInput,
  type PreparedLegacyGenerationInput,
  type ResolvedGenerationInput,
} from "@/lib/tool-media/generation-inputs";
import {
  assertGenerationInputManifestMatches,
  interleaveGenerationInputValues,
  type GenerationInputManifestV1,
} from "@/lib/generation/input-manifest";
import {
  getSeedanceMediaPolicy,
  type SeedanceMediaKind,
} from "@/lib/seedance-media-policy";
import {
  getMiniMaxH3UploadContract,
} from "@/lib/minimax-h3-media-policy";
import {
  probeLocalMedia,
  resolveLocalUploadPath,
} from "@/lib/tool-media/media-probe";
import {
  generationSkillMetadata,
  type GenerationSkillSnapshot,
} from "@/lib/generation/skill-metadata";

export type CreateVideoGenerationInput = {
  agentOutputContract?: AgentOutputContract;
  canvasId?: number;
  authUserId: number;
  requestKey?: string;
  prompt: string;
  userPrompt?: string;
  skill?: GenerationSkillSnapshot;
  source?: "tool" | "agent" | "canvas" | "batch";
  model?: string;
  mediaPaths?: string[];
  toolMediaIds?: string[];
  inputManifest?: GenerationInputManifestV1;
  inputMode?: string;
  resolution?: string;
  ratio?: string;
  duration?: number;
  seed?: number;
  cameraFixed?: boolean;
  watermark?: boolean;
  returnLastFrame?: boolean;
  generateAudio?: boolean;
  webSearch?: boolean;
  omniReferenceTaskType?: SeedanceOmniReferenceTaskType;
  outputFormat?: SeedanceOutputFormat;
};

export type CreateVideoGenerationResult = {
  generationId: number;
  taskId: string;
  status: "running" | "success";
  outputPaths?: string[];
};

export class VideoGenerationError extends Error {
  status: number;
  friendlyError: ReturnType<typeof toFriendlyError>;
  generationId?: number;
  displayInHistory?: boolean;

  constructor(input: {
    message: string;
    status: number;
    friendlyError: ReturnType<typeof toFriendlyError>;
    generationId?: number;
    displayInHistory?: boolean;
  }) {
    super(input.message);
    this.name = "VideoGenerationError";
    this.status = input.status;
    this.friendlyError = input.friendlyError;
    this.generationId = input.generationId;
    this.displayInHistory = input.displayInHistory;
  }
}

function syncAdminAssetFeed(generationId: number | null | undefined) {
  if (!generationId) return;
  void upsertAdminAssetFeedForGenerationId(generationId).catch(() => null);
}

function cleanString(value: unknown) {
  return String(value || "").trim();
}

function generationContextSnapshot(input: Pick<CreateVideoGenerationInput, "userPrompt" | "skill" | "agentOutputContract">) {
  const userPrompt = cleanString(input.userPrompt);
  return {
    ...(userPrompt ? { userPrompt } : {}),
    ...generationSkillMetadata(input.skill),
    ...(input.agentOutputContract ? {agentOutputContract:input.agentOutputContract}:{}),
  };
}

type ExistingVideoGeneration = {
  id: number;
  status: string;
  externalTaskId: string | null;
  localPath: string | null;
  errorMsg: string | null;
};

async function findVideoGenerationByRequestKey(requestKey: string) {
  return (await prisma.$queryRaw<ExistingVideoGeneration[]>(Prisma.sql`
    SELECT "id", "status", "externalTaskId", "localPath", "errorMsg" FROM "Generation"
    WHERE "requestKey" = ${requestKey}::uuid LIMIT 1
  `))[0] || null;
}

function videoResultFromExisting(existing: ExistingVideoGeneration): CreateVideoGenerationResult {
  if (existing.status === "failed" || existing.status === "cancelled" || existing.status === "canceled") {
    const friendly = toFriendlyError(existing.errorMsg || "生成失败");
    throw new VideoGenerationError({
      message: friendly.message,
      status: 502,
      friendlyError: friendly,
      generationId: existing.id,
      displayInHistory: true,
    });
  }
  if (existing.localPath || existing.status === "success") {
    return {
      generationId: existing.id,
      taskId: existing.externalTaskId || String(existing.id),
      status: "success",
      outputPaths: existing.localPath ? [existing.localPath] : undefined,
    };
  }
  return {
    generationId: existing.id,
    taskId: existing.externalTaskId || String(existing.id),
    status: "running",
  };
}

function toVideoToolMediaError(error: unknown): VideoGenerationError {
  if (isGenerationRequestKeyConflict(error)) throw error;
  const message = error instanceof Error ? error.message : "素材不可用";
  const friendly = toFriendlyError(message);
  return new VideoGenerationError({
    message: friendly.message,
    status: error instanceof ToolMediaInputError ? error.status : 400,
    friendlyError: friendly,
  });
}

function videoInputRole(inputMode: string, kind: string, position: number) {
  if (inputMode === "first_frame") return "first_frame";
  if (inputMode === "first_last_frame") return position === 0 ? "first_frame" : "last_frame";
  if (kind === "video") return "reference_video";
  if (kind === "audio") return "reference_audio";
  return "reference_image";
}

async function prepareVideoLegacyInputs(input: {
  model?: string;
  manifestPaths: string[];
  localPaths: string[];
  folder: string;
  preflightInputs?: ResolvedGenerationInput[];
}): Promise<PreparedLegacyGenerationInput[]> {
  if (input.manifestPaths.length !== input.localPaths.length) {
    throw new ToolMediaInputError("素材快照数量与界面顺序不一致");
  }
  const preflightByPath = new Map(
    (input.preflightInputs || [])
      .filter((media) => media.source === "legacy_path")
      .map((media) => [media.localPath, media]),
  );
  return Promise.all(input.localPaths.map(async (localPath, index) => {
    const preflight = preflightByPath.get(localPath);
    return {
      manifestPath: input.manifestPaths[index],
      kind: detectMediaType(localPath),
      localPath,
      modelUrl: await resolveToOssUrl(localPath, input.folder, input.model ? videoMediaDeliveryTarget(input.model) : null, detectMediaType(localPath) as MediaKind),
      ...(preflight?.fileName ? { fileName: preflight.fileName } : {}),
      ...(preflight?.byteSize !== undefined ? { byteSize: preflight.byteSize } : {}),
      ...(preflight?.probe ? { probe: preflight.probe } : {}),
    };
  }));
}

function declaredMimeForLegacyPath(localPath: string, kind: SeedanceMediaKind): string {
  const extension = path.extname(localPath).toLowerCase();
  if (kind === "image") {
    if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
    if ([".tif", ".tiff"].includes(extension)) return "image/tiff";
    if (extension === ".heic") return "image/heic";
    if (extension === ".heif") return "image/heif";
    return `image/${extension.slice(1) || "unknown"}`;
  }
  if (kind === "video") return extension === ".mov" ? "video/quicktime" : "video/mp4";
  return extension === ".wav" ? "audio/wav" : "audio/mpeg";
}

async function probeLegacyVideoInput(
  model: string,
  localPath: string,
): Promise<Pick<ResolvedGenerationInput, "fileName" | "byteSize" | "probe">> {
  const seedancePolicy = getSeedanceMediaPolicy(model);
  const miniMaxContract = getMiniMaxH3UploadContract(model);
  if (
    (!seedancePolicy && !miniMaxContract && !isWanVideoModel(model))
    || (seedancePolicy && process.env.SEEDANCE_MEDIA_VALIDATION_DISABLED === "1")
    || !localPath.replaceAll("\\", "/").startsWith("/uploads/")
  ) {
    return {};
  }
  const kind = detectMediaType(localPath);
  if (!(["image", "video", "audio"] as string[]).includes(kind)) {
    throw new ToolMediaInputError("素材类型无法进行视频模型合规检测");
  }
  const diskPath = resolveLocalUploadPath(localPath);
  const stat = await fs.stat(diskPath);
  const fileName = path.basename(localPath);
  const probe = await probeLocalMedia({
    localPath: diskPath,
    kind: kind as SeedanceMediaKind,
    fileName,
    declaredMime: declaredMimeForLegacyPath(localPath, kind as SeedanceMediaKind),
  });
  return { fileName, byteSize: stat.size, probe };
}

async function createVideoRecord<TGeneration extends { id: number }>(input: {
  prompt: string;
  ownerUserId: number;
  toolMediaIds?: string[];
  toolMediaPositions?: number[];
  manifest?: GenerationInputManifestV1;
  preparedLegacyInputs: PreparedLegacyGenerationInput[];
  model: string;
  inputMode: string;
  ratio?: string;
  duration?: number;
  omniReferenceTaskType?: string;
  outputFormat?: string;
  createGeneration: (
    tx: Prisma.TransactionClient,
    inputs: ResolvedGenerationInput[],
    prompt: string,
  ) => Promise<TGeneration>;
}) {
  try {
    const mediaDeliveryTarget = videoMediaDeliveryTarget(input.model);
    const created = await createGenerationWithToolMedia({
      ownerUserId: input.ownerUserId,
      toolMediaIds: input.toolMediaIds,
      toolMediaPositions: input.toolMediaPositions,
      modelId: input.model,
      mediaDeliveryTarget,
      role: (media, position) =>
        videoInputRole(input.inputMode, media.kind, position),
      createGeneration: async (tx, lockedToolMedia) => {
        const orderedInputs = await deliverToolMediaForPlatform(await resolveOrderedGenerationInputs({
          manifest: input.manifest,
          toolMediaInputs: lockedToolMedia,
          legacyInputs: input.preparedLegacyInputs,
        }), "video-provider-inputs", mediaDeliveryTarget);
        validateVideoResolvedInputs({
          model: input.model,
          inputMode: input.inputMode,
          inputs: orderedInputs,
          ratio: input.ratio,
          duration: input.duration,
          omniReferenceTaskType: input.omniReferenceTaskType,
          outputFormat: input.outputFormat,
        });
        const prompt = buildGenerationPrompt({
          kind: "video", model: input.model, prompt: input.prompt,
          media: orderedInputs.map((media) => ({ kind: media.kind as "image" | "video" | "audio", url: media.localPath })),
        }).modelPrompt;
        const generation = await input.createGeneration(tx, orderedInputs, prompt);
        return { id: generation.id, generation, orderedInputs, prompt };
      },
    });
    return {
      generation: created.generation.generation,
      inputs: created.inputs,
      orderedInputs: created.generation.orderedInputs,
      prompt: created.generation.prompt,
    };
  } catch (error) {
    throw toVideoToolMediaError(error);
  }
}

function buildVideoReferenceAssets(input: {
  mediaInputs?: Array<Pick<ResolvedGenerationInput, "kind" | "localPath" | "position">>;
  inputMode?: string;
}) {
  const out: Array<{ kind: "image" | "video" | "audio"; url: string; role: string }> = [];
  for (const media of input.mediaInputs || []) {
    const url = cleanString(media.localPath);
    if (!url) continue;
    const kind = media.kind as "image" | "video" | "audio";
    out.push({
      kind,
      url,
      role: videoInputRole(
        input.inputMode || "multimodal",
        kind,
        media.position,
      ),
    });
  }
  return out;
}

function mapSeedanceResolution(raw: string): SeedanceResolution {
  const v = cleanString(raw).toLowerCase();
  if (v === "480p") return "480p";
  if (v === "1080p") return "1080p";
  if (v === "4k") return "4k";
  return "720p";
}

function mapSeedanceRatio(raw: string): SeedanceRatio {
  const v = cleanString(raw);
  const allowed: SeedanceRatio[] = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"];
  if (allowed.includes(v as SeedanceRatio)) return v as SeedanceRatio;
  return "9:16";
}

function mapSeedanceDuration(raw: unknown, modelSpec: ReturnType<typeof getVideoModelSpec>): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const n = Number.parseInt(cleanString(raw), 10);
  if (Number.isFinite(n)) return n;
  return Math.min(Math.max(15, modelSpec.minDurationSeconds), modelSpec.maxDurationSeconds);
}

function mapApimartDuration(raw: unknown, modelSpec: ReturnType<typeof getVideoModelSpec>): number {
  if (cleanString(raw) === "") return 5;
  return mapSeedanceDuration(raw, modelSpec);
}

// ---- grok-video-1.5（KIE grok-imagine-video-1-5-preview）参数映射 ----
function mapGrokResolution(raw: string): "480p" | "720p" {
  return cleanString(raw).toLowerCase() === "720p" ? "720p" : "480p";
}

function mapGrokAspectRatio(raw: string): string {
  const allowed = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "auto"];
  const v = cleanString(raw);
  return allowed.includes(v) ? v : "auto";
}

function mapGrokDuration(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : Number.parseInt(cleanString(raw), 10);
  if (!Number.isFinite(n)) return 8;
  return Math.min(15, Math.max(1, Math.trunc(n)));
}

// ---- gemini-omni-video（KIE 多模态参考生视频）参数映射 ----
function mapGeminiResolution(raw: string): "720p" | "1080p" | "4k" {
  const v = cleanString(raw).toLowerCase();
  if (v === "1080p") return "1080p";
  if (v === "4k") return "4k";
  return "720p";
}

function mapGeminiAspectRatio(raw: string): "16:9" | "9:16" {
  return cleanString(raw) === "9:16" ? "9:16" : "16:9";
}

// gemini 时长是枚举字符串 "4"/"6"/"8"/"10"
function mapGeminiDuration(raw: unknown): string {
  const allowed = [4, 6, 8, 10];
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : Number.parseInt(cleanString(raw), 10);
  return allowed.includes(n) ? String(n) : "8";
}

function inferErrorStatus(msg: string) {
  if (/API Key 未配置|管理员 API 配置/i.test(msg)) return 401;
  if (/\b401\b|unauthorized/i.test(msg)) return 401;
  if (/\b403\b|forbidden|access permissions|permission denied/i.test(msg)) return 403;
  if (/\b404\b|not[\s_-]?found/i.test(msg)) return 404;
  if (/\b408\b|timeout/i.test(msg)) return 408;
  if (/\b429\b|rate[\s_-]?limit|too[\s_-]?many/i.test(msg)) return 429;
  if (/\b5\d{2}\b|upstream|gateway|fetch failed|econnrefused|enotfound|eai_again/i.test(msg)) return 502;
  return 500;
}

function inferVideoProvider(model: string) {
  if (isWanVideoModel(model)) return WAN_PROVIDER_ID;
  if (isKieVideoModel(model)) return "kie";
  if (isGeminiOmniVideoModel(model)) return "gemini";
  if (isApimartVideoModel(model)) return "apimart";
  if (isMiniMaxH3VideoModel(model)) return "minimax";
  if (isVolcengineVideoModel(model)) return "volcengine";
  return "unknown";
}

async function logUnknownFriendlyVideoError(
  friendly: ReturnType<typeof toFriendlyError>,
  generationId: number,
  userId: string | number,
  model: string,
  status: number
) {
  const meta = unknownFriendlyErrorLogMeta(friendly, {
    provider: inferVideoProvider(model),
    model,
    status
  });
  if (!meta) return;
  await Logger.generation(
    "friendly_error_rule_miss",
    `待补错误规则: ${meta.summary || "未知错误"}`,
    "warning",
    generationId,
    meta,
    String(userId)
  );
}

function boolValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const v = cleanString(value).toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}


async function createVideoGenerationOnce(input: CreateVideoGenerationInput): Promise<CreateVideoGenerationResult> {
  const authUserId = input.authUserId;
  const userId = String(authUserId);
  const rawPrompt = cleanString(input.prompt);
  const source = input.source || "tool";
  const model = normalizeVideoModelId(cleanString(input.model));
  await assertBillingReady(model);
  const legacySourcePaths = Array.isArray(input.mediaPaths)
    ? input.mediaPaths.map((path) => cleanString(path)).filter(Boolean)
    : [];
  const toolMediaPositions = input.inputManifest?.items.flatMap((item) =>
    item.source === "tool_media" ? [item.position] : [],
  );
  let toolMediaInputs: GenerationToolMediaInput[] = [];
  let legacyPaths: string[] = [];
  let orderedPreflightInputs: ResolvedGenerationInput[] = [];
  try {
    if (isApimartVideoModel(model) && legacySourcePaths.some((path) => /^asset:/i.test(path))) {
      throw new ToolMediaInputError("参考素材地址不受支持，请重新上传素材");
    }
    toolMediaInputs = await inspectToolMediaInputs({
      ownerUserId: authUserId,
      toolMediaIds: input.toolMediaIds,
      toolMediaPositions,
      modelId: model,
    });
    assertGenerationInputManifestMatches(
      input.inputManifest,
      toolMediaInputs.map((media) => media.mediaId),
      legacySourcePaths,
    );
    if (
      !input.inputManifest &&
      toolMediaInputs.length &&
      legacySourcePaths.length
    ) {
      throw new ToolMediaInputError(
        "素材来源已混合但缺少顺序信息，请刷新页面后重新提交",
      );
    }
    legacyPaths = await snapshotLibraryInputs(legacySourcePaths);
    const toolInputs: ResolvedGenerationInput[] = toolMediaInputs.map(
      (media) => ({ ...media, source: "tool_media" }),
    );
    const legacyInputs: ResolvedGenerationInput[] = await Promise.all(legacyPaths.map(
      async (localPath) => ({
        position: -1,
        source: "legacy_path",
        kind: detectMediaType(localPath),
        localPath,
        modelUrl: localPath,
        ...(await probeLegacyVideoInput(model, localPath)),
      }),
    ));
    const ordered = input.inputManifest
      ? interleaveGenerationInputValues(
          input.inputManifest,
          toolInputs,
          legacyInputs,
        )
      : [...toolInputs, ...legacyInputs];
    orderedPreflightInputs = ordered.map((media, position) => ({
      ...media,
      position,
    }));
  } catch (error) {
    throw toVideoToolMediaError(error);
  }
  const providers = await getRegisteredProviders();
  if (!isProviderModelEnabled(providers, "video", model)) {
    const friendly = toFriendlyError("当前视频生成模型未在平台配置中启用");
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (!(await isVideoModelVisible(model, cleanString(input.resolution), input.duration))) {
    const friendly = toFriendlyError("该视频生成模型、分辨率或时长已被管理员关闭");
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  const requestedToolInputMode = cleanString(input.inputMode);
  const toolInputMode = normalizeVideoInputMode(model, requestedToolInputMode);
  if (orderedPreflightInputs.length && requestedToolInputMode && requestedToolInputMode !== toolInputMode) {
    const friendly = toFriendlyError(`${getVideoModelSpec(model).label} 不支持当前输入模式`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  input = normalizeVideoCombination({ ...input, model, inputMode: toolInputMode }, orderedPreflightInputs);
  validateVideoResolvedInputs({
    model,
    inputMode: toolInputMode,
    inputs: orderedPreflightInputs,
    ratio: isMiniMaxH3VideoModel(model)
      && ["first_frame", "first_last_frame"].includes(toolInputMode)
      && !cleanString(input.ratio)
        ? "adaptive"
        : cleanString(input.ratio || "9:16"),
    duration: Number.isFinite(input.duration) ? Number(input.duration) : undefined,
    omniReferenceTaskType: cleanString(input.omniReferenceTaskType),
    outputFormat: cleanString(input.outputFormat),
  }, message => { throw toVideoToolMediaError(new ToolMediaInputError(message)); });
  const localInputPaths = orderedPreflightInputs.map(
    (media) => media.localPath,
  );

  if (!rawPrompt) {
    const friendly = toFriendlyError("缺少提示词");
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (isKieVideoModel(model)) {
    const kieArgs = {
      authUserId,
      userId,
      source,
      prompt: rawPrompt,
      model,
      localInputPaths,
      legacySourcePaths,
      legacyPaths,
      toolMediaInputs,
      toolMediaPositions,
      input,
    };
    return isGeminiOmniVideoModel(model)
      ? createGeminiOmniVideoGeneration(kieArgs)
      : createGrokVideoGeneration(kieArgs);
  }
  if (isApimartVideoModel(model)) {
    return createApimartVideoGeneration({
      authUserId,
      userId,
      source,
      prompt: rawPrompt,
      model,
      localInputPaths,
      legacySourcePaths,
      legacyPaths,
      toolMediaInputs,
      toolMediaPositions,
      preflightInputs: orderedPreflightInputs,
      input,
    });
  }
  if (isWanVideoModel(model)) {
    return createWanVideoGeneration({ authUserId, userId, source, prompt: rawPrompt, model,
      localInputPaths, legacySourcePaths, legacyPaths, toolMediaInputs, toolMediaPositions,
      preflightInputs: orderedPreflightInputs, input });
  }
  if (isMiniMaxH3VideoModel(model)) {
    return createMiniMaxH3VideoGeneration({
      authUserId,
      userId,
      source,
      prompt: rawPrompt,
      model,
      localInputPaths,
      legacySourcePaths,
      legacyPaths,
      toolMediaInputs,
      toolMediaPositions,
      preflightInputs: orderedPreflightInputs,
      input,
    });
  }
  if (!isVolcengineVideoModel(model)) {
    const friendly = toFriendlyError("当前仅支持 Seedance 系列模型");
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }

  const startTime = Date.now();
  const requestedInputMode = cleanString(input.inputMode);
  const inputMode = normalizeVideoInputMode(model, requestedInputMode) as SeedanceInputMode;
  const modelSpec = getVideoModelSpec(model);
  const resolution = mapSeedanceResolution(cleanString(input.resolution));
  const ratio = mapSeedanceRatio(cleanString(input.ratio || "9:16"));
  const duration = mapSeedanceDuration(input.duration, modelSpec);
  const seed = Number.isFinite(input.seed) ? Number(input.seed) : -1;
  const cameraFixed = boolValue(input.cameraFixed, false);
  const watermark = boolValue(input.watermark, false);
  const returnLastFrame = boolValue(input.returnLastFrame, false);
  const generateAudio = boolValue(input.generateAudio, false);
  const webSearch = boolValue(input.webSearch, false);
  const omniReferenceTaskType = isSeedance25VideoModel(model) && inputMode === "multimodal"
    ? (cleanString(input.omniReferenceTaskType) || "auto") as SeedanceOmniReferenceTaskType
    : undefined;
  const outputFormat = isSeedance25VideoModel(model)
    ? (cleanString(input.outputFormat) || "mp4") as SeedanceOutputFormat
    : undefined;

  if (requestedInputMode && requestedInputMode !== inputMode) {
    const friendly = toFriendlyError(`${modelSpec.label} 不支持当前输入模式`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (generateAudio && !modelSupportsGenerateAudio(model)) {
    const friendly = toFriendlyError(`${modelSpec.label} 不支持生成音频`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (webSearch && !modelSupportsWebSearch(model)) {
    const friendly = toFriendlyError(`${modelSpec.label} 不支持联网搜索`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (!modelSupportsResolution(model, resolution)) {
    const friendly = toFriendlyError(`${modelSpec.label} 不支持 ${resolution}`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (duration === -1 && !modelSpec.allowAutoDuration) {
    const friendly = toFriendlyError(`${modelSpec.label} 不支持自动时长`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (
    duration !== -1 &&
    (!Number.isFinite(duration) || duration < modelSpec.minDurationSeconds || duration > modelSpec.maxDurationSeconds)
  ) {
    const friendly = toFriendlyError(`${modelSpec.label} 时长仅支持 ${modelSpec.minDurationSeconds}-${modelSpec.maxDurationSeconds}s`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  const maxReferenceFiles = modelSpec.referenceLimits?.total ?? 12;
  if (localInputPaths.length > maxReferenceFiles) {
    const friendly = toFriendlyError(`最多支持 ${maxReferenceFiles} 个素材文件`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (inputMode === "first_frame" && localInputPaths.length < 1) {
    const friendly = toFriendlyError("首帧图模式至少需要上传 1 张图片");
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (inputMode === "first_last_frame" && localInputPaths.length < 2) {
    const friendly = toFriendlyError("首尾帧模式需要上传首帧和尾帧图片");
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (inputMode === "multimodal" && localInputPaths.length < 1) {
    const friendly = toFriendlyError("多模态参考模式至少需要 1 个素材");
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }

  const preparedLegacyInputs = await prepareVideoLegacyInputs({ model,
    manifestPaths: legacySourcePaths,
    localPaths: legacyPaths,
    folder: "seedance",
    preflightInputs: orderedPreflightInputs,
  });
  const {
    generation: record,
    inputs: lockedToolMediaInputs,
    orderedInputs,
    prompt,
  } = await createVideoRecord({
    prompt: rawPrompt,
    ownerUserId: authUserId,
    toolMediaIds: toolMediaInputs.map((media) => media.mediaId),
    toolMediaPositions,
    manifest: input.inputManifest,
    preparedLegacyInputs,
    model,
    inputMode,
    ratio,
    duration,
    omniReferenceTaskType,
    outputFormat,
    createGeneration: (tx, authoritativeInputs, prompt) => {
      const authoritativePaths = authoritativeInputs.map(
        (media) => media.localPath,
      );
      return tx.generation.create({
        data: {
      userId,
      authUserId,
      requestKey: input.requestKey, canvasId: input.canvasId,
      type: "video_gen",
      source,
      prompt,
      templateData: JSON.stringify({
        taskType: "video_gen",
        prompt,
        ...generationContextSnapshot(input),
        model,
        inputMode,
        resolution,
        ratio,
        duration,
        seed,
        cameraFixed,
        watermark,
        returnLastFrame,
        generateAudio,
        webSearch,
        omniReferenceTaskType,
        outputFormat,
        referenceAssets: buildVideoReferenceAssets({
          mediaInputs: authoritativeInputs,
          inputMode,
        }),
        imagePaths: authoritativePaths,
      }),
      status: "running",
      localPath: null,
      model,
      externalProvider: "volcengine",
      externalTaskId: null,
      finishedAt: null,
      } as any,
      });
    },
  });
  let mediaFiles: SeedanceMediaFile[] = [];
  if (orderedInputs.length > 0) {
    if (inputMode === "first_frame") {
      mediaFiles = orderedInputs.slice(0, 1).map((media) => ({
        type: "image" as const,
        url: media.modelUrl,
        role: "first_frame" as const,
      }));
    } else if (inputMode === "first_last_frame") {
      mediaFiles = orderedInputs.slice(0, 2).map((media, i) => ({
        type: "image" as const,
        url: media.modelUrl,
        role: i === 0 ? ("first_frame" as const) : ("last_frame" as const),
      }));
    } else if (inputMode === "multimodal") {
      mediaFiles = orderedInputs.map((media) => {
        const mediaType = media.kind as SeedanceMediaFile["type"];
        const role = videoInputRole(inputMode, mediaType, media.position);
        return { type: mediaType, url: media.modelUrl, role } as SeedanceMediaFile;
      });
    }
  }
  void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
  syncAdminAssetFeed(record.id);

  await Logger.generation(
    "task_create",
    `用户 ${userId} 创建 ${modelSpec.label} 视频任务`,
    "info",
    record.id,
    {
      prompt: prompt.substring(0, 100),
      model,
      provider: "volcengine",
      inputMode,
      resolution,
      ratio,
      duration,
      mediaCount: mediaFiles.length,
      ...(lockedToolMediaInputs.length
        ? buildToolMediaLogMetadata(lockedToolMediaInputs)
        : {
            inputMedia: mediaFiles.map((file) => ({
              type: file.type,
              role: file.role,
              url: file.type === "video" ? file.url.split(/[?#]/, 1)[0] : file.url,
            })),
            inputPreviewUrl:
              mediaFiles.find((file) => file.type === "image")?.url || "",
          }),
    },
    userId
  );

  try {
    const created = await seedanceCreateTask({
      model: model as SeedanceModelId,
      prompt,
      inputMode,
      mediaFiles,
      resolution,
      ratio,
      duration,
      seed,
      cameraFixed,
      watermark,
      returnLastFrame,
      generateAudio,
      webSearch,
      omniReferenceTaskType,
      outputFormat,
    });

    const createdTaskId = cleanString(created?.id);
    if (!createdTaskId) throw new Error("创建任务失败：未返回任务ID");

    await prisma.generation.update({ where: { id: record.id }, data: { externalTaskId: createdTaskId } });
    void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    syncAdminAssetFeed(record.id);
    await Logger.api(
      "volcengine_request",
      `${modelSpec.label} 任务 ${record.id} 已提交`,
      "success",
      Date.now() - startTime,
      { taskId: createdTaskId, model },
      userId
    );

    return { generationId: record.id, taskId: createdTaskId, status: "running" };
  } catch (e: any) {
    const rawMsg = providerFailureText(e, "生成失败");
    const friendly = toFriendlyError(rawMsg);
    const storageMsg = formatFriendlyMessageForStorage(friendly);
    const status = Number(e?.statusCode || 0) || inferErrorStatus(rawMsg);
    await logUnknownFriendlyVideoError(friendly, record.id, authUserId, model, status);
    await prisma.generation.update({
      where: { id: record.id },
      data: { status: "failed", finishedAt: new Date(), errorMsg: storageMsg },
    });
    void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    syncAdminAssetFeed(record.id);
    await Logger.api(
      "volcengine_error",
      `${modelSpec.label} 任务失败: ${rawMsg}`,
      "error",
      Date.now() - startTime,
      { error: rawMsg, model },
      userId
    );
    throw new VideoGenerationError({
      message: friendly.message,
      status,
      friendlyError: friendly,
      generationId: record.id,
      displayInHistory: true,
    });
  }
}

export async function createVideoGeneration(input: CreateVideoGenerationInput): Promise<CreateVideoGenerationResult> {
  return runGenerationRequestIdempotently({
    requestKey: input.requestKey,
    execute: async () => { await reserveRuntimeGeneration(input.requestKey); return createVideoGenerationOnce(input); },
    findExisting: findVideoGenerationByRequestKey,
    mapExisting: videoResultFromExisting,
  });
}

/**
 * grok-video-1.5（KIE 平台 grok-imagine-video-1-5-preview）图生视频。
 * 走 KIE 统一 jobs 接口，externalProvider 标记为 "kie"，
 * 结果由 app/api/history 的轮询逻辑（已支持 kie + video_gen）拉取落库。
 */
type KieVideoGenerationArgs = {
  authUserId: number;
  userId: string;
  source: NonNullable<CreateVideoGenerationInput["source"]>;
  prompt: string;
  model: string;
  localInputPaths: string[];
  legacySourcePaths: string[];
  legacyPaths: string[];
  toolMediaInputs: GenerationToolMediaInput[];
  toolMediaPositions?: number[];
  preflightInputs?: ResolvedGenerationInput[];
  input: CreateVideoGenerationInput;
};

async function createGrokVideoGeneration(args: KieVideoGenerationArgs): Promise<CreateVideoGenerationResult> {
  const {
    authUserId,
    userId,
    source,
    prompt: rawPrompt,
    model,
    localInputPaths,
    legacySourcePaths,
    legacyPaths,
    toolMediaInputs,
    toolMediaPositions,
    preflightInputs,
    input,
  } = args;
  const modelSpec = getVideoModelSpec(model);
  const startTime = Date.now();

  // grok-imagine-video-1.5 为图生视频：必须且仅取 1 张输入图
  if (localInputPaths.length < 1) {
    const friendly = toFriendlyError("该模型需要上传 1 张输入图片");
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }

  const resolution = mapGrokResolution(cleanString(input.resolution));
  const aspectRatio = mapGrokAspectRatio(cleanString(input.ratio));
  const duration = mapGrokDuration(input.duration);
  // 内容过滤(NSFW)默认开启，且不暴露给用户配置
  const nsfwChecker = true;
  const preparedLegacyInputs = await prepareVideoLegacyInputs({ model,
    manifestPaths: legacySourcePaths,
    localPaths: legacyPaths,
    folder: "grok",
  });
  const {
    generation: record,
    inputs: lockedToolMediaInputs,
    orderedInputs,
    prompt,
  } = await createVideoRecord({
    prompt: rawPrompt,
    ownerUserId: authUserId,
    toolMediaIds: toolMediaInputs.map((media) => media.mediaId),
    toolMediaPositions,
    manifest: input.inputManifest,
    preparedLegacyInputs,
    model,
    inputMode: "first_frame",
    createGeneration: (tx, authoritativeInputs, prompt) => {
      const authoritativePaths = authoritativeInputs.map(
        (media) => media.localPath,
      );
      return tx.generation.create({
        data: {
      userId,
      authUserId,
      requestKey: input.requestKey, canvasId: input.canvasId,
      type: "video_gen",
      source,
      prompt,
      templateData: JSON.stringify({
        taskType: "video_gen",
        prompt,
        ...generationContextSnapshot(input),
        model,
        inputMode: "first_frame",
        resolution,
        ratio: aspectRatio,
        duration,
        nsfwChecker,
        referenceAssets: buildVideoReferenceAssets({
          mediaInputs: authoritativeInputs.slice(0, 1),
          inputMode: "first_frame",
        }),
        imagePaths: authoritativePaths.slice(0, 1),
      }),
      status: "running",
      localPath: null,
      model,
      externalProvider: "kie",
      externalTaskId: null,
      finishedAt: null,
      } as any,
      });
    },
  });
  const imageUrl = orderedInputs[0]?.modelUrl;
  void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
  syncAdminAssetFeed(record.id);

  await Logger.generation(
    "task_create",
    `用户 ${userId} 创建 ${modelSpec.label} 视频任务`,
    "info",
    record.id,
    {
      prompt: prompt.substring(0, 100),
      model,
      provider: "kie",
      inputMode: "first_frame",
      resolution,
      ratio: aspectRatio,
      duration,
      mediaCount: 1,
      ...(lockedToolMediaInputs.length
        ? buildToolMediaLogMetadata(lockedToolMediaInputs)
        : { inputPreviewUrl: imageUrl }),
    },
    userId
  );

  try {
    const kieInput: Record<string, unknown> = {
      prompt,
      image_urls: [imageUrl],
      aspect_ratio: aspectRatio,
      resolution,
      duration,
      nsfw_checker: nsfwChecker,
    };

    const created = await kieCreateTask({ model: getKieVideoApiModel(model), input: kieInput });
    const createdTaskId = cleanString(created?.taskId);
    if (!createdTaskId) throw new Error("创建任务失败：未返回任务ID");

    await prisma.generation.update({ where: { id: record.id }, data: { externalTaskId: createdTaskId } });
    void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    syncAdminAssetFeed(record.id);
    await Logger.api(
      "kie_request",
      `${modelSpec.label} 任务 ${record.id} 已提交`,
      "success",
      Date.now() - startTime,
      { taskId: createdTaskId, model },
      userId
    );

    return { generationId: record.id, taskId: createdTaskId, status: "running" };
  } catch (e: any) {
    const rawMsg = providerFailureText(e, "生成失败");
    const friendly = toFriendlyError(rawMsg);
    const storageMsg = formatFriendlyMessageForStorage(friendly);
    const status = Number(e?.statusCode || 0) || inferErrorStatus(rawMsg);
    await logUnknownFriendlyVideoError(friendly, record.id, authUserId, model, status);
    await prisma.generation.update({
      where: { id: record.id },
      data: { status: "failed", finishedAt: new Date(), errorMsg: storageMsg },
    });
    void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    syncAdminAssetFeed(record.id);
    await Logger.api(
      "kie_error",
      `${modelSpec.label} 任务失败: ${rawMsg}`,
      "error",
      Date.now() - startTime,
      { error: rawMsg, model },
      userId
    );
    throw new VideoGenerationError({
      message: friendly.message,
      status,
      friendlyError: friendly,
      generationId: record.id,
      displayInHistory: true,
    });
  }
}

/**
 * gemini-omni-video（KIE 多模态参考生视频）。
 * 走 KIE 统一 jobs 接口，externalProvider 标记为 "kie"，
 * 结果由 app/api/history 的轮询逻辑（已支持 kie + video_gen）拉取落库。
 * 说明：character_ids（角色ID）/ audio_ids 不在本工具暴露，故不发送。
 */
async function createGeminiOmniVideoGeneration(args: KieVideoGenerationArgs): Promise<CreateVideoGenerationResult> {
  const {
    authUserId,
    userId,
    source,
    prompt: rawPrompt,
    model,
    legacySourcePaths,
    legacyPaths,
    toolMediaInputs,
    toolMediaPositions,
    input,
  } = args;
  const modelSpec = getVideoModelSpec(model);
  const startTime = Date.now();

  const resolution = mapGeminiResolution(cleanString(input.resolution));
  const aspectRatio = mapGeminiAspectRatio(cleanString(input.ratio));
  const duration = mapGeminiDuration(input.duration);

  const preparedLegacyInputs = await prepareVideoLegacyInputs({ model,
    manifestPaths: legacySourcePaths,
    localPaths: legacyPaths,
    folder: "gemini",
  });
  const {
    generation: record,
    inputs: lockedToolMediaInputs,
    orderedInputs,
    prompt,
  } = await createVideoRecord({
    prompt: rawPrompt,
    ownerUserId: authUserId,
    toolMediaIds: toolMediaInputs.map((media) => media.mediaId),
    toolMediaPositions,
    manifest: input.inputManifest,
    preparedLegacyInputs,
    model,
    inputMode: "multimodal",
    createGeneration: (tx, authoritativeInputs, prompt) => {
      const authoritativePaths = authoritativeInputs.map(
        (media) => media.localPath,
      );
      return tx.generation.create({
        data: {
      userId,
      authUserId,
      requestKey: input.requestKey, canvasId: input.canvasId,
      type: "video_gen",
      source,
      prompt,
      templateData: JSON.stringify({
        taskType: "video_gen",
        prompt,
        ...generationContextSnapshot(input),
        model,
        inputMode: "multimodal",
        resolution,
        ratio: aspectRatio,
        duration,
        referenceAssets: buildVideoReferenceAssets({
          mediaInputs: authoritativeInputs,
          inputMode: "multimodal",
        }),
        imagePaths: authoritativePaths,
      }),
      status: "running",
      localPath: null,
      model,
      externalProvider: "kie",
      externalTaskId: null,
      finishedAt: null,
      } as any,
      });
    },
  });
  const imageUrls: string[] = [];
  const videoUrls: string[] = [];
  orderedInputs.forEach((media) => {
    if (media.kind === "video") videoUrls.push(media.modelUrl);
    else if (media.kind === "image") imageUrls.push(media.modelUrl);
  });
  // 仅取第 1 个视频；裁剪窗口按文档上限 10s
  const videoEntry = videoUrls.length > 0 ? { url: videoUrls[0], start: 0, ends: 10 } : null;
  void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
  syncAdminAssetFeed(record.id);

  await Logger.generation(
    "task_create",
    `用户 ${userId} 创建 ${modelSpec.label} 视频任务`,
    "info",
    record.id,
    {
      prompt: prompt.substring(0, 100),
      model,
      provider: "kie",
      inputMode: "multimodal",
      resolution,
      ratio: aspectRatio,
      duration,
      mediaCount: imageUrls.length + (videoEntry ? 1 : 0),
      ...(lockedToolMediaInputs.length
        ? buildToolMediaLogMetadata(lockedToolMediaInputs)
        : { inputPreviewUrl: imageUrls[0] || videoEntry?.url || "" }),
    },
    userId
  );

  try {
    const kieInput: Record<string, unknown> = {
      prompt,
      duration,
      aspect_ratio: aspectRatio,
      resolution,
    };
    if (imageUrls.length > 0) kieInput.image_urls = imageUrls.slice(0, 7);
    if (videoEntry) kieInput.video_list = [videoEntry];

    const created = await kieCreateTask({ model: getKieVideoApiModel(model), input: kieInput });
    const createdTaskId = cleanString(created?.taskId);
    if (!createdTaskId) throw new Error("创建任务失败：未返回任务ID");

    await prisma.generation.update({ where: { id: record.id }, data: { externalTaskId: createdTaskId } });
    void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    syncAdminAssetFeed(record.id);
    await Logger.api(
      "kie_request",
      `${modelSpec.label} 任务 ${record.id} 已提交`,
      "success",
      Date.now() - startTime,
      { taskId: createdTaskId, model },
      userId
    );

    return { generationId: record.id, taskId: createdTaskId, status: "running" };
  } catch (e: any) {
    const rawMsg = providerFailureText(e, "生成失败");
    const friendly = toFriendlyError(rawMsg);
    const storageMsg = formatFriendlyMessageForStorage(friendly);
    const status = Number(e?.statusCode || 0) || inferErrorStatus(rawMsg);
    await logUnknownFriendlyVideoError(friendly, record.id, authUserId, model, status);
    await prisma.generation.update({
      where: { id: record.id },
      data: { status: "failed", finishedAt: new Date(), errorMsg: storageMsg },
    });
    void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    syncAdminAssetFeed(record.id);
    await Logger.api(
      "kie_error",
      `${modelSpec.label} 任务失败: ${rawMsg}`,
      "error",
      Date.now() - startTime,
      { error: rawMsg, model },
      userId
    );
    throw new VideoGenerationError({
      message: friendly.message,
      status,
      friendlyError: friendly,
      generationId: record.id,
      displayInHistory: true,
    });
  }
}

async function createWanVideoGeneration(args: KieVideoGenerationArgs): Promise<CreateVideoGenerationResult> {
  const { authUserId, userId, source, model, input, legacySourcePaths, legacyPaths,
    toolMediaInputs, toolMediaPositions, preflightInputs } = args;
  const inputMode = normalizeVideoInputMode(model, cleanString(input.inputMode));
  const settings = {
    inputMode,
    resolution: cleanString(input.resolution).toLowerCase() || "1080p",
    ratio: cleanString(input.ratio) || "adaptive",
    duration: input.duration ?? 5,
    generateAudio: boolValue(input.generateAudio, true),
    watermark: boolValue(input.watermark, false),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  };
  if ((input.inputMode && input.inputMode !== inputMode) || input.webSearch || input.returnLastFrame || input.cameraFixed
    || (input.outputFormat && input.outputFormat !== "mp4") || input.omniReferenceTaskType) {
    const friendly = toFriendlyError("Wan3.0 不支持当前输入模式或高级参数");
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  const preparedLegacyInputs = await prepareVideoLegacyInputs({ model,
    manifestPaths: legacySourcePaths, localPaths: legacyPaths, folder: "wan3", preflightInputs,
  });
  const { generation: record, orderedInputs, prompt } = await createVideoRecord({
    prompt: args.prompt,
    ownerUserId: authUserId,
    toolMediaIds: toolMediaInputs.map((media) => media.mediaId),
    toolMediaPositions,
    manifest: input.inputManifest,
    preparedLegacyInputs,
    model, inputMode, ratio: settings.ratio, duration: settings.duration,
    createGeneration: async (tx, authoritativeInputs, prompt) => {
      let request;
      try {
        request = buildWanVideoRequest({ ...settings, prompt,
          media: authoritativeInputs.map((media) => ({ type: media.kind as WanVideoInput["media"][number]["type"], url: media.modelUrl })) });
      } catch (error) {
        const friendly = toFriendlyError(error instanceof Error ? error.message : "Wan3.0 参数无效");
        throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
      }
      return tx.generation.create({ data: {
        userId, authUserId, requestKey: input.requestKey, canvasId: input.canvasId, type: "video_gen", source, prompt, model,
        status: "running", localPath: null, externalProvider: WAN_PROVIDER_ID, externalTaskId: null, finishedAt: null,
        templateData: JSON.stringify({ taskType: "video_gen", prompt, ...generationContextSnapshot(input),
          model, providerModel: model, ...settings, webSearch: false,
          providerRequest: request.body,
          referenceAssets: buildVideoReferenceAssets({ mediaInputs: authoritativeInputs, inputMode }),
          imagePaths: authoritativeInputs.map((media) => media.localPath),
        }),
      } as any });
    },
  });
  void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
  syncAdminAssetFeed(record.id);
  try {
    const created = await wanSubmitVideo({ ...settings, prompt,
      media: orderedInputs.map((media) => ({ type: media.kind as WanVideoInput["media"][number]["type"], url: media.modelUrl })) });
    await prisma.generation.update({ where: { id: record.id }, data: { externalTaskId: created.taskId } });
    syncAdminAssetFeed(record.id);
    return { generationId: record.id, taskId: created.taskId, status: "running" };
  } catch (error) {
    const raw = providerFailureText(error, "Wan3.0 生成失败");
    const friendly = toFriendlyError(raw);
    const status = Number((error as { statusCode?: number })?.statusCode) || inferErrorStatus(raw);
    await logUnknownFriendlyVideoError(friendly, record.id, authUserId, model, status);
    await prisma.generation.update({ where: { id: record.id }, data: {
      status: "failed", finishedAt: new Date(), errorMsg: formatFriendlyMessageForStorage(friendly),
    } });
    void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    syncAdminAssetFeed(record.id);
    throw new VideoGenerationError({ message: friendly.message, status, friendlyError: friendly,
      generationId: record.id, displayInHistory: true });
  }
}

async function createMiniMaxH3VideoGeneration(
  args: KieVideoGenerationArgs,
): Promise<CreateVideoGenerationResult> {
  const {
    authUserId,
    userId,
    source,
    prompt: rawPrompt,
    model,
    localInputPaths,
    legacySourcePaths,
    legacyPaths,
    toolMediaInputs,
    toolMediaPositions,
    preflightInputs,
    input,
  } = args;
  const modelSpec = getVideoModelSpec(model);
  const startTime = Date.now();
  const requestedInputMode = cleanString(input.inputMode);
  const inputMode = normalizeVideoInputMode(model, requestedInputMode);
  const requestedResolution = cleanString(input.resolution).toLowerCase() || "768p";
  const requestedRatio = cleanString(input.ratio);
  const ratio = ["first_frame", "first_last_frame"].includes(inputMode)
    ? "adaptive"
    : requestedRatio || "9:16";
  const duration = cleanString(input.duration) === ""
    ? 5
    : Number(input.duration);

  if (requestedInputMode && requestedInputMode !== inputMode) {
    const friendly = toFriendlyError(`${modelSpec.label} 不支持当前输入模式`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (!modelSupportsResolution(model, requestedResolution)) {
    const friendly = toFriendlyError(`${modelSpec.label} 不支持 ${requestedResolution}`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  const resolution: MiniMaxH3CreateInput["resolution"] = requestedResolution === "2k"
    ? "2k"
    : requestedResolution === "480p"
      ? "480p"
      : "768p";
  if (
    !Number.isInteger(duration)
    || duration < modelSpec.minDurationSeconds
    || duration > modelSpec.maxDurationSeconds
  ) {
    const friendly = toFriendlyError(
      `${modelSpec.label} 时长仅支持 ${modelSpec.minDurationSeconds}-${modelSpec.maxDurationSeconds}s 整数`,
    );
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (boolValue(input.generateAudio, false)) {
    const friendly = toFriendlyError(`${modelSpec.label} 不支持生成音频`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (boolValue(input.webSearch, false)) {
    const friendly = toFriendlyError(`${modelSpec.label} 不支持联网搜索`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (boolValue(input.returnLastFrame, false)) {
    const friendly = toFriendlyError(`${modelSpec.label} 不支持返回尾帧`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (boolValue(input.cameraFixed, false)) {
    const friendly = toFriendlyError(`${modelSpec.label} 不支持固定镜头`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (Number.isFinite(input.seed) && Number(input.seed) !== -1) {
    const friendly = toFriendlyError(`${modelSpec.label} 不支持随机种子`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (inputMode === "first_frame" && localInputPaths.length < 1) {
    const friendly = toFriendlyError("首帧图模式至少需要上传 1 张图片");
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (inputMode === "first_last_frame" && localInputPaths.length < 2) {
    const friendly = toFriendlyError("首尾帧模式需要上传首帧和尾帧图片");
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (inputMode === "multimodal" && localInputPaths.length < 1) {
    const friendly = toFriendlyError("多模态参考模式至少需要 1 个素材");
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }

  const preparedLegacyInputs = await prepareVideoLegacyInputs({ model,
    manifestPaths: legacySourcePaths,
    localPaths: legacyPaths,
    folder: "minimax_h3",
    preflightInputs,
  });
  const {
    generation: record,
    inputs: lockedToolMediaInputs,
    orderedInputs,
    prompt,
  } = await createVideoRecord({
    prompt: rawPrompt,
    ownerUserId: authUserId,
    toolMediaIds: toolMediaInputs.map((media) => media.mediaId),
    toolMediaPositions,
    manifest: input.inputManifest,
    preparedLegacyInputs,
    model,
    inputMode,
    ratio,
    duration,
    createGeneration: async (tx, authoritativeInputs, prompt) => {
      if (prompt.length > 7_000) {
        const friendly = toFriendlyError(`${modelSpec.label} 提示词不能超过 7000 个字符`);
        throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
      }
      await assertMiniMaxH3ConcurrencyAvailable(tx, model);
      return tx.generation.create({
        data: {
        userId,
        authUserId,
        requestKey: input.requestKey, canvasId: input.canvasId,
        type: "video_gen",
        source,
        prompt,
        templateData: JSON.stringify({
          taskType: "video_gen",
          prompt,
          ...generationContextSnapshot(input),
          model,
          providerModel: modelSpec.upstreamModelId,
          inputMode,
          resolution,
          ratio,
          duration,
          watermark: boolValue(input.watermark, false),
          generateAudio: false,
          webSearch: false,
          referenceAssets: buildVideoReferenceAssets({
            mediaInputs: authoritativeInputs,
            inputMode,
          }),
          imagePaths: authoritativeInputs.map((media) => media.localPath),
        }),
        status: "running",
        localPath: null,
        model,
        externalProvider: "minimax",
        externalTaskId: null,
        finishedAt: null,
        } as any,
      });
    },
  });
  const media: MiniMaxH3Media[] = orderedInputs.map((item) => ({
    type: item.kind as MiniMaxH3Media["type"],
    url: item.modelUrl,
  }));
  void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
  syncAdminAssetFeed(record.id);

  await Logger.generation(
    "task_create",
    `用户 ${userId} 创建 ${modelSpec.label} 视频任务`,
    "info",
    record.id,
    {
      prompt: prompt.substring(0, 100),
      model,
      provider: "minimax",
      inputMode,
      resolution,
      ratio,
      duration,
      mediaCount: media.length,
      ...(lockedToolMediaInputs.length
        ? buildToolMediaLogMetadata(lockedToolMediaInputs)
        : {}),
    },
    userId,
  );

  try {
    const created = await miniMaxSubmitVideo({
      model: modelSpec.upstreamModelId as MiniMaxH3CreateInput["model"],
      prompt,
      inputMode,
      resolution,
      ratio,
      duration,
      watermark: boolValue(input.watermark, false),
      media,
    });
    await prisma.generation.update({
      where: { id: record.id },
      data: { externalTaskId: created.taskId },
    });
    void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    syncAdminAssetFeed(record.id);
    await Logger.api(
      "minimax_request",
      `${modelSpec.label} 任务 ${record.id} 已提交`,
      "success",
      Date.now() - startTime,
      { taskId: created.taskId, model },
      userId,
    );
    return { generationId: record.id, taskId: created.taskId, status: "running" };
  } catch (error: any) {
    const rawMsg = providerFailureText(error, "生成失败");
    const friendly = toFriendlyError(rawMsg);
    const storageMsg = formatFriendlyMessageForStorage(friendly);
    const status = Number(error?.statusCode || 0) || inferErrorStatus(rawMsg);
    await logUnknownFriendlyVideoError(friendly, record.id, authUserId, model, status);
    await prisma.generation.update({
      where: { id: record.id },
      data: { status: "failed", finishedAt: new Date(), errorMsg: storageMsg },
    });
    void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    syncAdminAssetFeed(record.id);
    await Logger.api(
      "minimax_error",
      `${modelSpec.label} 任务失败: ${rawMsg}`,
      "error",
      Date.now() - startTime,
      { error: rawMsg, model },
      userId,
    );
    throw new VideoGenerationError({
      message: friendly.message,
      status,
      friendlyError: friendly,
      generationId: record.id,
      displayInHistory: true,
    });
  }
}

async function createApimartVideoGeneration(args: KieVideoGenerationArgs): Promise<CreateVideoGenerationResult> {
  const {
    authUserId,
    userId,
    source,
    prompt: rawPrompt,
    model,
    localInputPaths,
    legacySourcePaths,
    legacyPaths,
    toolMediaInputs,
    toolMediaPositions,
    preflightInputs,
    input,
  } = args;
  const modelSpec = getVideoModelSpec(model);
  const startTime = Date.now();
  const requestedInputMode = cleanString(input.inputMode);
  const inputMode = normalizeVideoInputMode(model, requestedInputMode);

  if (!isApimartSeedanceFaceModel(model) && model !== APIMART_SEEDANCE_25_MODEL_ID) {
    const friendly = toFriendlyError("当前 APIMart 视频模型不支持");
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (requestedInputMode && requestedInputMode !== inputMode) {
    const friendly = toFriendlyError(`${modelSpec.label} 不支持当前输入模式`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }

  const resolution = mapSeedanceResolution(cleanString(input.resolution));
  const ratio = mapSeedanceRatio(cleanString(input.ratio || "9:16"));
  const duration = mapApimartDuration(input.duration, modelSpec);
  const seedance25Options = model === APIMART_SEEDANCE_25_MODEL_ID ? {
    outputFormat: (cleanString(input.outputFormat) || "mp4") as SeedanceOutputFormat,
    ...(inputMode === "multimodal" ? { omniReferenceTaskType: (cleanString(input.omniReferenceTaskType) || "auto") as SeedanceOmniReferenceTaskType } : {}),
    watermark: boolValue(input.watermark, false),
  } : {};
  const returnLastFrame = boolValue(input.returnLastFrame, false);
  const generateAudio = boolValue(input.generateAudio, false);
  const webSearch = boolValue(input.webSearch, false);

  if (!modelSupportsResolution(model, resolution)) {
    const friendly = toFriendlyError(`${modelSpec.label} 不支持 ${resolution}`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (!(duration === -1 && modelSpec.allowAutoDuration) && (!Number.isInteger(duration) || duration < modelSpec.minDurationSeconds || duration > modelSpec.maxDurationSeconds)) {
    const friendly = toFriendlyError(`${modelSpec.label} 时长仅支持 ${modelSpec.minDurationSeconds}-${modelSpec.maxDurationSeconds}s`);
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (inputMode === "first_frame" && localInputPaths.length < 1) {
    const friendly = toFriendlyError("首帧图模式至少需要上传 1 张图片");
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (inputMode === "first_last_frame" && localInputPaths.length < 2) {
    const friendly = toFriendlyError("首尾帧模式需要上传首帧和尾帧图片");
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (inputMode === "multimodal" && localInputPaths.length < 1) {
    const friendly = toFriendlyError("全能参考模式至少需要 1 个素材");
    throw new VideoGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }

  const preparedLegacyInputs = await prepareVideoLegacyInputs({ model,
    manifestPaths: legacySourcePaths,
    localPaths: legacyPaths,
    folder: "apimart_seedance",
    preflightInputs,
  });
  const {
    generation: record,
    inputs: lockedToolMediaInputs,
    orderedInputs,
    prompt,
  } = await createVideoRecord({
    prompt: rawPrompt,
    ownerUserId: authUserId,
    toolMediaIds: toolMediaInputs.map((media) => media.mediaId),
    toolMediaPositions,
    manifest: input.inputManifest,
    preparedLegacyInputs,
    model,
    inputMode,
    createGeneration: (tx, authoritativeInputs, prompt) => {
      const authoritativeReferencePaths = authoritativeInputs.map(
        (media) => media.localPath,
      );
      return tx.generation.create({
        data: {
      userId,
      authUserId,
      requestKey: input.requestKey, canvasId: input.canvasId,
      type: "video_gen",
      source,
      prompt,
      templateData: JSON.stringify({
        taskType: "video_gen",
        prompt,
        ...generationContextSnapshot(input),
        model,
        inputMode,
        resolution,
        ratio,
        duration,
        ...seedance25Options,
        returnLastFrame,
        generateAudio,
        webSearch,
        referenceAssets: buildVideoReferenceAssets({
          mediaInputs: authoritativeInputs,
          inputMode,
        }),
        imagePaths: authoritativeReferencePaths,
      }),
      status: "running",
      localPath: null,
      model,
      externalProvider: "apimart",
      externalTaskId: null,
      finishedAt: null,
      } as any,
      });
    },
  });
  let referenceMediaFiles: Array<{ type: "image" | "video" | "audio"; url: string; role?: string }> = [];
  if (inputMode === "first_frame") {
    referenceMediaFiles = orderedInputs.slice(0, 1).map((media) => ({ type: "image" as const, url: media.modelUrl, role: "first_frame" }));
  } else if (inputMode === "first_last_frame") {
    referenceMediaFiles = orderedInputs.slice(0, 2).map((media, index) => ({
      type: "image" as const,
      url: media.modelUrl,
      role: index === 0 ? "first_frame" : "last_frame",
    }));
  } else if (inputMode === "multimodal") {
    referenceMediaFiles = orderedInputs.map((media) => {
      const mediaType = media.kind as "image" | "video" | "audio";
      const role = videoInputRole(inputMode, mediaType, media.position);
      return { type: mediaType, url: media.modelUrl, role };
    });
  }
  void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
  syncAdminAssetFeed(record.id);

  await Logger.generation(
    "task_create",
    `用户 ${userId} 创建 ${modelSpec.label} 视频任务`,
    "info",
    record.id,
    {
      prompt: prompt.substring(0, 100),
      model,
      provider: "apimart",
      inputMode,
      resolution,
      ratio,
      duration,
      mediaCount: referenceMediaFiles.length,
      ...(lockedToolMediaInputs.length
        ? buildToolMediaLogMetadata(lockedToolMediaInputs)
        : {}),
    },
    userId
  );

  try {
    const created = await apimartSubmitVideo({
      model,
      prompt,
      mediaFiles: referenceMediaFiles,
      resolution,
      size: ratio,
      duration,
      returnLastFrame,
      generateAudio,
      webSearch,
      ...seedance25Options,
    });

    await prisma.generation.update({ where: { id: record.id }, data: { externalTaskId: created.taskId } });
    void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    syncAdminAssetFeed(record.id);
    await Logger.api(
      "apimart_request",
      `${modelSpec.label} 任务 ${record.id} 已提交`,
      "success",
      Date.now() - startTime,
      lockedToolMediaInputs.length
        ? { taskId: created.taskId, model, ...buildToolMediaLogMetadata(lockedToolMediaInputs) }
        : { taskId: created.taskId, model, request: created.request },
      userId
    );

    return { generationId: record.id, taskId: created.taskId, status: "running" };
  } catch (e: any) {
    const rawMsg = providerFailureText(e, "生成失败");
    const friendly = toFriendlyError(rawMsg);
    const storageMsg = formatFriendlyMessageForStorage(friendly);
    const status = Number(e?.statusCode || 0) || inferErrorStatus(rawMsg);
    await logUnknownFriendlyVideoError(friendly, record.id, authUserId, model, status);
    await prisma.generation.update({
      where: { id: record.id },
      data: { status: "failed", finishedAt: new Date(), errorMsg: storageMsg },
    });
    void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    syncAdminAssetFeed(record.id);
    await Logger.api(
      "apimart_error",
      `${modelSpec.label} 任务失败: ${rawMsg}`,
      "error",
      Date.now() - startTime,
      { error: rawMsg, model },
      userId
    );
    throw new VideoGenerationError({
      message: friendly.message,
      status,
      friendlyError: friendly,
      generationId: record.id,
      displayInHistory: true,
    });
  }
}
