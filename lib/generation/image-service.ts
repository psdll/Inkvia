import { isSeedream55Model, VOLC_SEEDREAM_55_MODEL, buildVolcSeedream55Request, readVolcSeedream55Outputs } from "@/lib/volcengine-seedream-55";
import { validateVolcSeedream55Reference } from "@/lib/volcengine-seedream-55-input";
import { validateSeedream55Reference } from "@/lib/apimart-seedream-55-input";
import { APIMART_SEEDREAM_55_MODEL, APIMART_SEEDREAM_55_UPSTREAM, buildApimartSeedream55Request, type Seedream55Settings } from "@/lib/apimart-seedream-55";
import { apimartSubmitSeedream55 } from "@/lib/apimart-image";
import { captureGenerationImageOutputs } from "./agent-output-recovery";
import { prepareAgentImageRecovery, AgentOutputSavePendingError, type AgentOutputContract } from "./agent-output-observation";
import { imageProviderSnapshotModel, normalizeKieGptImage2Size } from "./image-route-identity";
import { KIE_NANO_BANANA_21_MODEL, APIMART_NANO_BANANA_21_MODEL, APIMART_NANO_BANANA_21_UPSTREAM, NANO_BANANA_21_RATIOS, isProviderNanoBanana21, validateProviderNanoBanana21, buildKieNanoBanana21Request } from "@/lib/nano-banana-21-providers";
import { normalizeGoogleImageSettings, validateGoogleImageSettings, extractGoogleGrounding } from "@/lib/google-image-settings";
import { GOOGLE_NANO_BANANA_21_MODEL, validateGoogleNanoBanana21Input } from "@/lib/google-nano-banana-21";
import { buildOpenRouterImageRequest, openRouterGenerateImage, readOpenRouterReferenceDimensions, validateOpenRouterImageOutputs } from "@/lib/openrouter-image";
import { getOpenRouterImageModel } from "@/lib/openrouter-image-params";
import { isQwenImage3Model, normalizeQwenImage3Params } from "@/lib/qwen-image-3-models";
import { buildBailianQwenImageRequest, bailianSubmitQwenImage } from "@/lib/bailian-qwen-image";
import { buildWorkFisherImageRequest, workFisherSubmitImage } from "@/lib/work-fisher-image";
import { isQwenImage21Model, normalizeQwenImage21Params } from "@/lib/work-fisher-image-params";
import { Prisma } from "@prisma/client";
import { reserveRuntimeGeneration } from "@/lib/runtime-generation-budget";
import { prisma } from "@/lib/prisma";
import { kieCreateTask } from "@/lib/kie";
import { redactInlineMedia, type MediaDeliveryTarget } from "@/lib/media-delivery/deliver";
import { deliverToolMediaForPlatform } from "@/lib/media-delivery/tool-media";
import { NANO_BANANA_2_LITE_MODEL, buildNanoBanana2LiteKieInput } from "@/lib/kie-image-lite";
import { Logger } from "@/lib/logger";
import { getApimartImageModel, getKieImageEditModel } from "@/lib/config";
import { saveRemoteFile } from "@/lib/storage";
import { volcSeedreamGenerate } from "@/lib/volcengine";
import { generationOutputFolder } from "@/lib/generation/output-folder";
import { buildGenerationPrompt } from "@/lib/generation/prompt-references";
import {
  isGenerationRequestKeyConflict,
  runGenerationRequestIdempotently,
} from "@/lib/generation/request-key-idempotency";
import {
  classifyExistingImageGenerationReplay,
  deriveImageTaskRequestKey,
  normalizeImageSubmissionRequestKey,
} from "@/lib/generation/image-request-key";
import { googleAiStudioGenerateImage, isGoogleAiStudioImageModel } from "@/lib/google-ai-studio-image";
import {
  EASYROUTER_GPT_IMAGE_2_MODEL_ID,
  easyRouterGenerateImage,
  isEasyRouterImageModel,
  mapEasyRouterGptImage2Size,
} from "@/lib/easyrouter-image";
import { tuziGenerateImage } from "@/lib/tuzi-image";
import {
  TUZI_GPT_IMAGE_2_UPSTREAM_MODEL,
  isTuziGptImage2Model,
  mapTuziGptImage2Size,
  normalizeTuziGptImage2Params,
} from "@/lib/tuzi-image-params";
import { buildReapiGptImage25Request } from "@/lib/reapi-gpt-image-25";
import { REAPI_GPT_IMAGE_25_MODEL_ID, isGptImageVariantModel } from "@/lib/gpt-image-25-models";
import { isAicomingGptImage25Model, buildAicomingHaiyaGptImage25Request } from "@/lib/aicoming-gpt-image-25";
import { isApimartGptImageVariantModel, normalizeGptImage25Mode, buildApimartGptImageVariantRequest } from "@/lib/apimart-gpt-image-25";
import {
  apimartSubmitImage,
  apimartSubmitGptImageVariant,
  apimartSubmitNanoBananaPro,
  apimartSubmitNanoBanana21,
  isApimartImageModel as isApimartImageModelId,
  isApimartNanoBananaProModel,
} from "@/lib/apimart-image";
import {
  APIMART_GPT_IMAGE_26_MODEL_ID,
  APIMART_NANO_BANANA_PRO_ASPECT_RATIO_VALUES,
  APIMART_NANO_BANANA_PRO_UPSTREAM_MODEL,
} from "@/lib/apimart-image-models";
import {
  JIEKOU_GPT_IMAGE_2_EDIT_MODEL,
  JIEKOU_GPT_IMAGE_2_MODEL_ID,
  JIEKOU_GPT_IMAGE_2_TEXT_MODEL,
  jiekouGptImage2Generate,
  mapJiekouGptImage2Size,
} from "@/lib/jiekou-image";
import {
  REAPI_GPT_IMAGE_2_MODEL_ID,
  reapiSubmitImage,
  reapiSubmitGptImage25,
} from "@/lib/reapi-image";
import { apimartSubmitMidjourneyV8 } from "@/lib/apimart-midjourney-v8";
import { reapiSubmitMidjourneyV8 } from "@/lib/reapi-midjourney-v8";
import {
  APIMART_MIDJOURNEY_V8_MODEL_ID,
  MIDJOURNEY_V8_OUTPUT_COUNT,
  MIDJOURNEY_V8_UPSTREAM_MODEL,
  MIDJOURNEY_V8_VERSION,
  isMidjourneyV8Model,
  mergeMidjourneyV8Options,
  normalizeMidjourneyV8Options,
  normalizeMidjourneyV8Ratio,
  normalizeMidjourneyV8Speed,
  parseMidjourneyV8PromptFlags,
  validateMidjourneyOptions,
} from "@/lib/midjourney-v8";
import {
  aicomingHaiyaSubmitImage,
  aicomingHaiyaGenerateGptImage25,
  aicomingHaiyaSubmitNanoBananaPro,
} from "@/lib/aicoming-image";
import {
  AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID,
  AICOMING_HAIYA_GPT_IMAGE_2_UPSTREAM_MODELS,
  AICOMING_HAIYA_NANO_BANANA_PRO_MODEL_ID,
  AICOMING_HAIYA_NANO_BANANA_PRO_UPSTREAM_MODEL,
} from "@/lib/aicoming-merchant-models";
import {
  GPT_IMAGE_2_OFFICIAL_UPSTREAM_MODEL,
  normalizeGptImage2OfficialParams,
} from "@/lib/gpt-image-2-official";
import {
  DOUBAO_SEEDREAM_5_LITE_MODEL,
  DOUBAO_SEEDREAM_5_PRO_MODEL,
  GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL,
  IMAGE_EDIT_MODEL_DEFINITIONS,
  isImageEditModelVisible,
} from "@/lib/image-edit-models";
import { formatFriendlyMessageForStorage, toFriendlyError, unknownFriendlyErrorLogMeta, type FriendlyError } from "@/lib/error-friendly";
import { providerFailureText } from "@/lib/providers/failure-capture";
import { upsertUsageLedgerForGenerationId } from "@/lib/billing-ledger";
import { persistGenerationProviderUsage } from "@/lib/billing/usage-persistence";
import { buildGptImage26GifParams, type GptImage26AnimationSettings } from "@/lib/gpt-image-26-animation";
import { assertBillingReady } from "@/lib/billing/admission";
import { upsertAdminAssetFeedForGenerationId } from "@/lib/admin-asset-feed";
import { snapshotLibraryInputs } from "@/lib/generation/input-snapshot";
import { runGenerationCompletionCreate } from "@/lib/maintenance";
import {
  GenerationInputManifestError,
  assertGenerationInputManifestMatches,
  interleaveGenerationInputValues,
  parseGenerationInputManifest,
  type GenerationInputManifestV1,
} from "@/lib/generation/input-manifest";
import {
  mapSeedreamSize,
  mapSeedreamModelId,
  buildSeedreamPrompt,
  dedupeImageUrlsByContent,
  mapImagePathToPublicUrl,
} from "@/lib/image-edit-helpers";
import { normalizeImageTaskCount, runImageTaskBatch } from "@/lib/generation/image-task-batch";
import {
  generationSkillMetadata,
  normalizeGenerationSkillSnapshot,
  type GenerationSkillSnapshot,
} from "@/lib/generation/skill-metadata";
import {
  IMAGE_MODEL_NOT_AVAILABLE_ERROR_CODE,
  type ImageBatchMode,
} from "@/lib/image-batch/contracts";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { getRegisteredProviders } from "@/lib/providers/registry";
import {
  buildToolMediaLogMetadata,
  createGenerationWithToolMedia,
  inspectToolMediaInputs,
  parseToolMediaIdsFromFormData,
  resolveOrderedGenerationInputs,
  ToolMediaInputError,
  type GenerationToolMediaInput,
} from "@/lib/tool-media/generation-inputs";

export type CreateImageGenerationInput = GptImage26AnimationSettings & {
  seedream55?: Seedream55Settings;
  agentOutputContract?: AgentOutputContract;
  authUserId: number;
  canvasId?: number;
  requestKey?: string;
  prompt: string;
  userPrompt?: string;
  skill?: GenerationSkillSnapshot;
  source?: "tool" | "agent" | "canvas" | "batch";
  model?: string;
  aspectRatio?: string;
  speed?: string;
  /** Midjourney V8.2 进阶参数（参数面板），见 normalizeMidjourneyV8Options */
  midjourneyOptions?: unknown;
  resolution?: string;
  customSize?: string;
  imagePaths?: string[];
  toolMediaIds?: string[];
  inputManifest?: GenerationInputManifestV1;
  callBackUrl?: string;
  quality?: string;
  gptImage25Mode?: string;
  background?: string;
  googleThinkingLevel?: string;
  googleSearchMode?: string;
  moderation?: string;
  outputFormat?: string;
  outputCompression?: number;
  n?: number;
  seed?: number;
  enableWebSearch?: boolean;
  maskUrl?: string;
  /** Internal v2 receipt identity; never accepted from public tool arguments. */
  exactProviderModel?: string;
  seedreamOutputMode?: "single" | "group";
  seedreamOutputCount?: number;
  seedreamWebSearch?: boolean;
  taskCount?: number;
  batchId?: string;
  batchMode?: ImageBatchMode;
  batchIndex?: number;
  batchSubmittedAt?: string;
};

export type CreateImageGenerationResult = {
  generationId: number;
  taskId: string;
  status: "running" | "success";
  outputPaths?: string[];
};

export type CreateImageGenerationBatchTaskResult = {
  batchIndex: number;
  generationId?: number;
  taskId?: string;
  status: "running" | "success" | "failed";
  error?: string;
  errorStatus?: number;
};

export type CreateImageGenerationBatchResult = {
  batchId: string;
  taskCount: number;
  succeededCount: number;
  failedCount: number;
  tasks: CreateImageGenerationBatchTaskResult[];
};

export class ImageGenerationError extends Error {
  status: number;
  friendlyError: ReturnType<typeof toFriendlyError>;
  generationId?: number;
  code?: string;

  constructor(input: {
    message: string;
    status: number;
    friendlyError: ReturnType<typeof toFriendlyError>;
    generationId?: number;
    code?: string;
  }) {
    super(input.message);
    this.name = "ImageGenerationError";
    this.status = input.status;
    this.friendlyError = input.friendlyError;
    this.generationId = input.generationId;
    this.code = input.code;
  }
}

const allowedModels = new Set<string>([
  ...IMAGE_EDIT_MODEL_DEFINITIONS.map((model) => model.id),
  "gpt-image-2-text-to-image",
  "gpt-image-2-image-to-image",
]);

export function resolveImageGenerationModel(
  selectedModel: unknown,
  defaultModel: string,
  knownModels: ReadonlySet<string> = allowedModels,
) {
  const selected = cleanString(selectedModel);
  if (!selected) return defaultModel;
  if (knownModels.has(selected)) return selected;
  const message = `当前模型“${selected}”尚未被生成服务加载，请更换模型或重启服务后重试`;
  throw new ImageGenerationError({
    message,
    status: 400,
    friendlyError: toFriendlyError(message),
    code: IMAGE_MODEL_NOT_AVAILABLE_ERROR_CODE,
  });
}

function syncAdminAssetFeed(generationId: number | null | undefined) {
  if (!generationId) return;
  void upsertAdminAssetFeedForGenerationId(generationId).catch(() => null);
}

function cleanString(value: unknown) {
  return String(value || "").trim();
}

type ExistingImageGeneration = {
  id: number;
  status: string;
  externalTaskId: string | null;
  localPath: string | null;
  errorMsg: string | null;
};

async function findImageGenerationByRequestKey(requestKey: string) {
  return (await prisma.$queryRaw<ExistingImageGeneration[]>(Prisma.sql`
    SELECT "id", "status", "externalTaskId", "localPath", "errorMsg" FROM "Generation"
    WHERE "requestKey" = ${requestKey}::uuid LIMIT 1
  `))[0] || null;
}

function imageResultFromExisting(existing: ExistingImageGeneration): CreateImageGenerationResult {
  const replay = classifyExistingImageGenerationReplay(existing);
  if (replay.status === "failed") {
    const friendly = toFriendlyError(replay.error);
    throw new ImageGenerationError({
      message: friendly.message,
      status: 502,
      friendlyError: friendly,
      generationId: existing.id,
    });
  }
  return {
    generationId: existing.id,
    taskId: existing.externalTaskId || String(existing.id),
    status: replay.status,
    outputPaths: replay.status === "success" ? replay.outputPaths : undefined,
  };
}

function normalizeCallbackUrl(raw: string) {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
  } catch {
    return "";
  }
}

function inferErrorStatus(rawMsg: string) {
  if (
    rawMsg.includes("API Key 未配置") ||
    rawMsg.includes("管理员 API 配置") ||
    rawMsg.includes("GOOGLE_AI_STUDIO_PROXY_URL") ||
    rawMsg.includes("access permissions")
  ) {
    return 401;
  }
  if (rawMsg.includes("429")) return 429;
  return 500;
}

function toImageToolMediaError(error: unknown): ImageGenerationError {
  if (isGenerationRequestKeyConflict(error)) throw error;
  const message = error instanceof Error ? error.message : "素材不可用";
  const friendly = toFriendlyError(message);
  return new ImageGenerationError({
    message: friendly.message,
    status: error instanceof ToolMediaInputError ? error.status : 400,
    friendlyError: friendly,
  });
}

function inferImageProvider(model: string) {
  const registered = IMAGE_EDIT_MODEL_DEFINITIONS.find((item) => item.id === model)?.provider;
  if (registered) return registered;
  if (model === "gpt-image-2-text-to-image" || model === "gpt-image-2-image-to-image") return "kie";
  return "unknown";
}

async function logUnknownFriendlyImageError(
  friendly: ReturnType<typeof toFriendlyError>,
  generationId: number | undefined,
  userId: string | number,
  model: string,
  status: number
) {
  const meta = unknownFriendlyErrorLogMeta(friendly, {
    provider: inferImageProvider(model),
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

function dedupeOutputImages(images: unknown[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    const value = cleanString(image);
    if (!value) continue;
    const key = value.startsWith("data:") ? value : value.replace(/([?&])_r=[^&]+(&|$)/, "$1");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

async function createExtraImageGenerationRecordIfMissing(input: {
  groupId: string;
  outputIndex: number;
  rawImage: string;
  allowBase64: boolean;
  userId: string;
  authUserId: number;
  source: "tool" | "agent" | "canvas" | "batch";
  prompt: string;
  templateData: string | null;
  model: string;
  externalProvider: string;
}) {
  const groupId = cleanString(input.groupId);
  const rawImage = cleanString(input.rawImage);
  if (!groupId || !rawImage || input.outputIndex < 1) return null;

  const existingGroupCount = await prisma.generation.count({
    where: {
      type: "image_edit",
      externalTaskId: groupId,
    },
  });
  if (existingGroupCount > input.outputIndex) return null;

  const localPath = await saveRemoteFile(
    rawImage,
    generationOutputFolder("image_edit", input.source),
    input.allowBase64,
    { providerId: input.externalProvider },
  );
  const existingSamePath = await prisma.generation.findFirst({
    where: {
      type: "image_edit",
      externalTaskId: groupId,
      localPath,
    },
    select: { id: true },
  });
  if (existingSamePath) return existingSamePath.id;

  const parentId = Number(groupId);
  if (!Number.isSafeInteger(parentId) || parentId < 1) return null;
  const activeParent = await prisma.generation.findFirst({
    where: {
      id: parentId,
      localPath: null,
      status: { in: ["running", "queued", "pending", "submitted", "processing"] },
    } as any,
    select: { id: true, canvasId: true },
  });
  if (!activeParent) return null;

  const extraRecord = await runGenerationCompletionCreate(() => prisma.generation.create({
    data: {
      userId: input.userId,
      canvasId: activeParent.canvasId,
      authUserId: input.authUserId,
      type: "image_edit",
      source: input.source,
      prompt: input.prompt,
      templateData: input.templateData,
      model: input.model,
      status: "success",
      localPath,
      externalProvider: input.externalProvider,
      externalTaskId: groupId,
      errorMsg: null,
      finishedAt: new Date(),
    } as any,
  }));
  return extraRecord.id;
}

async function createImageGenerationOnce(input: CreateImageGenerationInput): Promise<CreateImageGenerationResult> {
  const authUserId = input.authUserId;
  const userId = String(authUserId);
  const rawPrompt = cleanString(input.prompt);
  const userPrompt = cleanString(input.userPrompt);
  const qwen3Params = isQwenImage3Model(input.model) ? normalizeQwenImage3Params(input) : null;
  const qwenParams = qwen3Params || (isQwenImage21Model(input.model) ? normalizeQwenImage21Params(input) : null);
  const aspectRatio = qwenParams?.aspectRatio || cleanString(input.aspectRatio);
  const resolution = qwenParams?.resolution || cleanString(input.resolution);
  try {
    validateGoogleImageSettings(input.model || "", input);
  } catch (error) {
    const friendly = toFriendlyError(error instanceof Error ? error.message : "Google 图片参数不正确");
    throw new ImageGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  const googleSettings = normalizeGoogleImageSettings(input.model || "", input);
  const source = input.source || "tool";
  const legacySourcePaths = Array.isArray(input.imagePaths)
    ? input.imagePaths.map((path) => cleanString(path)).filter(Boolean)
    : [];
  const toolMediaPositions = input.inputManifest?.items.flatMap((item) =>
    item.source === "tool_media" ? [item.position] : [],
  );
  let inspectedToolMedia: GenerationToolMediaInput[] = [];
  let legacyPaths: string[] = [];
  let imagePaths: string[] = [];
  try {
    inspectedToolMedia = await inspectToolMediaInputs({
      ownerUserId: authUserId,
      toolMediaIds: input.toolMediaIds,
      toolMediaPositions,
    });
    if (inspectedToolMedia.some((media) => media.kind !== "image")) {
      throw new ToolMediaInputError("图片任务只能使用图片素材");
    }
    assertGenerationInputManifestMatches(
      input.inputManifest,
      inspectedToolMedia.map((media) => media.mediaId),
      legacySourcePaths,
    );
    if (
      !input.inputManifest &&
      inspectedToolMedia.length &&
      legacySourcePaths.length
    ) {
      throw new ToolMediaInputError(
        "素材来源已混合但缺少顺序信息，请刷新页面后重新提交",
      );
    }
    legacyPaths = await snapshotLibraryInputs(legacySourcePaths);
    imagePaths = input.inputManifest
      ? interleaveGenerationInputValues(
          input.inputManifest,
          inspectedToolMedia.map((media) => media.localPath),
          legacyPaths,
        )
      : inspectedToolMedia.length
        ? inspectedToolMedia.map((media) => media.localPath)
        : legacyPaths;
  } catch (error) {
    throw toImageToolMediaError(error);
  }
  const outputFolder = generationOutputFolder("image_edit", source);
  const batchId = cleanString(input.batchId);
  const batchMode = input.batchMode;
  const batchIndex = Number.isInteger(input.batchIndex) && Number(input.batchIndex) > 0 ? Number(input.batchIndex) : 0;
  const taskCount = Number.isInteger(input.taskCount) && Number(input.taskCount) > 0 ? Number(input.taskCount) : 0;
  const batchSubmittedAt = cleanString(input.batchSubmittedAt);
  const callbackUrl = normalizeCallbackUrl(cleanString(input.callBackUrl || process.env.KIE_CALLBACK_URL || ""));

  const officialQualityRaw = cleanString(input.quality).toLowerCase();
  const officialQualityTemplate = isGptImageVariantModel(cleanString(input.model))
    ? officialQualityRaw || "medium"
    : (["auto", "low", "medium", "high"] as const).includes(officialQualityRaw as any)
    ? officialQualityRaw
    : "auto";
  const officialOutputFormatRaw = cleanString(input.outputFormat).toLowerCase();
  const officialOutputFormatTemplate = (["jpeg", "png", "webp"] as const).includes(officialOutputFormatRaw as any)
    ? (officialOutputFormatRaw as "jpeg" | "png" | "webp")
    : "png";
  const outputCompressionRaw = Number(input.outputCompression);
  const outputCompression =
    Number.isFinite(outputCompressionRaw)
      ? Math.max(0, Math.min(100, Math.floor(outputCompressionRaw)))
      : undefined;
  const officialNumImagesTemplate = Number.isFinite(input.n)
    ? Math.max(1, Math.min(4, Math.floor(Number(input.n))))
    : 1;
  const jiekouNumImagesTemplate = Number.isFinite(input.n)
    ? Math.max(1, Math.min(10, Math.floor(Number(input.n))))
    : 1;

  if (!rawPrompt && !(isSeedream55Model(input.model) && input.seedream55?.layerDecomposition)) {
    const friendly = toFriendlyError("缺少提示词");
    throw new ImageGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }

  const startTime = Date.now();
  const envModel = getKieImageEditModel();
  const model = resolveImageGenerationModel(input.model, envModel);
  let animation: ReturnType<typeof buildGptImage26GifParams>;
  try {
    animation = buildGptImage26GifParams({ ...input, model });
    if (animation && (input.maskUrl || input.outputCompression !== undefined)) throw new Error("GIF 动图请移除蒙版和输出压缩设置");
  } catch (error) {
    const friendly = toFriendlyError((error as Error).message);
    throw new ImageGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  const animationSettings = animation ? { gifSize: animation.size, frameCount: animation.frame_count, frameDurationMs: animation.frame_duration_ms } : {};
  const openRouterModel = getOpenRouterImageModel(model);
  await assertBillingReady(model);
  const prompt = buildGenerationPrompt({
    kind: "image", model, prompt: rawPrompt,
    media: imagePaths.map((url) => ({ kind: "image", url })),
  }).modelPrompt;
  const providers = await getRegisteredProviders();
  if (!isProviderModelEnabled(providers, "image", model)) {
    const friendly = toFriendlyError("当前图片生成模型未在平台配置中启用");
    throw new ImageGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  const isKieNanoBanana21 = model === KIE_NANO_BANANA_21_MODEL;
  const isApimartNanoBanana21 = model === APIMART_NANO_BANANA_21_MODEL;
  const isNanoBananaPro = model === "nano-banana-pro";
  const isNanoBanana2Lite = model === NANO_BANANA_2_LITE_MODEL;
  const isNanoBanana2 = model === "nano-banana-2";
  const isGptImage2Unified = model === "gpt-image-2";
  const isGptImage2TextModel = model === "gpt-image-2-text-to-image";
  const isGptImage2EditModel = model === "gpt-image-2-image-to-image";
  const isJiekouGptImage2 = model === JIEKOU_GPT_IMAGE_2_MODEL_ID;
  const isReapiGptImage2 = model === REAPI_GPT_IMAGE_2_MODEL_ID;
  const isReapiGptImage25 = model === REAPI_GPT_IMAGE_25_MODEL_ID;
  const isMidjourneyV8 = isMidjourneyV8Model(model);
  const isApimartMidjourneyV8 = model === APIMART_MIDJOURNEY_V8_MODEL_ID;
  const isAicomingHaiyaGptImage25 = isAicomingGptImage25Model(model);
  const isAicomingHaiyaGptImage2 = model === AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID;
  const isAicomingHaiyaNanoBananaPro = model === AICOMING_HAIYA_NANO_BANANA_PRO_MODEL_ID;
  const isEasyRouterImage = isEasyRouterImageModel(model);
  const isTuziGptImage2 = isTuziGptImage2Model(model);
  const isQwenImage21 = isQwenImage21Model(model);
  const isGoogleAiStudioModel = isGoogleAiStudioImageModel(model);
  const isGoogleAiStudioLite = model === GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL;
  const isApimartImageModel = isApimartImageModelId(model);
  const isSeedream55 = model === APIMART_SEEDREAM_55_MODEL;
  const isVolcSeedream55 = model === VOLC_SEEDREAM_55_MODEL;
  const isApimartNanoBananaPro = isApimartNanoBananaProModel(model);
  const isSeedreamPro = model === DOUBAO_SEEDREAM_5_PRO_MODEL;
  const isSeedreamLite = model === DOUBAO_SEEDREAM_5_LITE_MODEL;
  const isSeedream45 = model === "doubao-seedream-4.5";
  const isSeedream40 = model === "doubao-seedream-4.0";
  const isSeedream5 = isSeedreamPro || isSeedreamLite;
  const isSeedreamModel = isVolcSeedream55 || isSeedream5 || isSeedream45 || isSeedream40;
  const gptImage2ResolvedModel = isGptImage2Unified
    ? imagePaths.length
      ? "gpt-image-2-image-to-image"
      : "gpt-image-2-text-to-image"
    : model;
  const isGptImage2Model =
    gptImage2ResolvedModel === "gpt-image-2-text-to-image" ||
    gptImage2ResolvedModel === "gpt-image-2-image-to-image" ||
    isGptImage2TextModel ||
    isGptImage2EditModel;
  const isGptImage2Edit = gptImage2ResolvedModel === "gpt-image-2-image-to-image" || isGptImage2EditModel;
  const seedreamModelId = isSeedreamModel ? mapSeedreamModelId(model) : "";
  const isNanoBananaEdit = model === "google/nano-banana-edit";
  const isNanoBananaFamily = isNanoBananaPro || isNanoBanana2;
  const effectiveResolution = isNanoBananaFamily ? resolution || (source === "agent" ? "2K" : "1K") : "";
  const effectiveGoogleAiStudioResolution = isGoogleAiStudioLite ? "1K" : model === GOOGLE_NANO_BANANA_21_MODEL ? resolution || "1K" : "";
  const effectiveSeedreamResolution = isSeedreamModel
    ? isVolcSeedream55 ? resolution || "2K" : isSeedreamPro
      ? resolution === "1K" || resolution === "2K"
        ? resolution
        : "2K"
      : isSeedreamLite
      ? resolution === "3K"
        ? "3K"
        : "2K"
      : isSeedream45
        ? resolution === "2K" || resolution === "4K"
          ? resolution
          : "2K"
        : resolution === "1K" || resolution === "2K" || resolution === "4K"
          ? resolution
          : "2K"
    : "";
  const seedreamOutputMode = !isSeedreamPro && input.seedreamOutputMode === "group" ? "group" : "single";
  const seedreamWebSearch = !isSeedreamPro && Boolean(input.seedreamWebSearch);
  const seedreamRequestedCount = Number.isFinite(input.seedreamOutputCount)
    ? Number(input.seedreamOutputCount)
    : 4;
  const imageInputCount = imagePaths.length;
  const seedreamMaxOutputCount = Math.max(1, 15 - imageInputCount);
  const seedreamOutputCount =
    seedreamOutputMode === "group"
      ? seedreamMaxOutputCount >= 2
        ? Math.max(2, Math.min(seedreamRequestedCount, seedreamMaxOutputCount))
        : 1
      : 1;
  const seedreamSequential =
    !isSeedreamPro && seedreamOutputMode === "group" && seedreamMaxOutputCount >= 2 ? "auto" : "disabled";
  const seedreamPrompt = buildSeedreamPrompt(prompt, seedreamOutputMode, seedreamOutputCount);

  const seedreamSnapshot = isSeedreamModel
    ? isSeedreamPro || isVolcSeedream55
      ? {
          imageInputCount,
        }
      : {
          imageInputCount,
          outputMode: seedreamOutputMode,
          outputCount: seedreamOutputCount,
          sequential: seedreamSequential,
          ...(seedreamWebSearch ? { webSearch: seedreamWebSearch } : {}),
        }
    : null;
  const googleAiStudioSnapshot = isGoogleAiStudioModel
    ? {
        providerModel: model,
      }
    : null;
  const easyRouterSnapshot = isEasyRouterImage
    ? {
        providerModel: EASYROUTER_GPT_IMAGE_2_MODEL_ID,
        endpoint: imagePaths.length ? "/images/edits" : "/images/generations",
        size: mapEasyRouterGptImage2Size({ aspectRatio, resolution, customSize: input.customSize }),
        quality: officialQualityTemplate === "auto" ? "medium" : officialQualityTemplate,
        outputFormat: "png",
      }
    : null;
  const gptImage25Mode = isGptImageVariantModel(model) ? normalizeGptImage25Mode(input.gptImage25Mode, model) : undefined;
  // Product output stays PNG; background is the only user-selectable output setting.
  const gptImage25Output = { background: input.background, outputFormat: animation ? "gif" : "png", ...animationSettings };
  const gptImage25Request = isApimartGptImageVariantModel(model)
    ? buildApimartGptImageVariantRequest({ model, prompt, mode: gptImage25Mode, quality: officialQualityTemplate, aspectRatio, resolution, ...gptImage25Output })
    : null;
  const reapiGptImage25Params = isReapiGptImage25 ? { ...gptImage25Output, aspectRatio: aspectRatio || "1:1", resolution: (resolution || "2K").toUpperCase(), quality: officialQualityTemplate } : null;
  const reapiGptImage25Request = reapiGptImage25Params
    ? buildReapiGptImage25Request({ prompt, mode: gptImage25Mode, ...reapiGptImage25Params })
    : null;
  const aicomingGptImage25Params = isAicomingHaiyaGptImage25 ? { ...gptImage25Output, aspectRatio: aspectRatio || "1:1", resolution: (resolution || "2K").toUpperCase(), quality: officialQualityTemplate } : null;
  const aicomingGptImage25Request = aicomingGptImage25Params
    ? buildAicomingHaiyaGptImage25Request({ prompt, mode: gptImage25Mode, ...aicomingGptImage25Params, requestKey: input.requestKey })
    : null;
  const apimartSnapshot = isApimartImageModel
    ? isSeedream55 ? { providerModel: APIMART_SEEDREAM_55_UPSTREAM, outputCount: 1 } : isApimartNanoBanana21 ? { providerModel: APIMART_NANO_BANANA_21_UPSTREAM, outputCount: 1 } : gptImage25Request
      ? { providerModel: gptImage25Request.model, mode: gptImage25Mode, quality: gptImage25Request.quality, outputCount: 1, background: ("background" in gptImage25Request ? gptImage25Request.background : undefined) || "auto", outputFormat: gptImage25Request.output_format || "png" }
      : isApimartNanoBananaPro
      ? {
          providerModel: APIMART_NANO_BANANA_PRO_UPSTREAM_MODEL,
          outputCount: 1,
        }
      : {
          providerModel: getApimartImageModel(),
          quality: officialQualityTemplate,
          outputCount: officialNumImagesTemplate,
          outputFormat: officialOutputFormatTemplate,
          ...(outputCompression !== undefined ? { outputCompression } : {}),
        }
    : null;
  const jiekouProviderModel = isJiekouGptImage2
    ? imagePaths.length
      ? JIEKOU_GPT_IMAGE_2_EDIT_MODEL
      : JIEKOU_GPT_IMAGE_2_TEXT_MODEL
    : "";
  const jiekouSnapshot = isJiekouGptImage2
    ? {
        providerModel: jiekouProviderModel,
        endpoint: imagePaths.length ? "/v3/gpt-image-2-edit" : "/v3/gpt-image-2-text-to-image",
        size: mapJiekouGptImage2Size(aspectRatio, resolution),
        quality: officialQualityTemplate,
        background: cleanString(input.background) || "auto",
        moderation: imagePaths.length ? null : cleanString(input.moderation) || "auto",
        outputCount: jiekouNumImagesTemplate,
        outputFormat: officialOutputFormatTemplate === "jpeg" ? "jpeg" : "png",
      }
    : null;
  const tuziParams = isTuziGptImage2
    ? normalizeTuziGptImage2Params({ quality: officialQualityTemplate, resolution, aspectRatio })
    : null;
  const tuziSnapshot = tuziParams
    ? {
        providerModel: TUZI_GPT_IMAGE_2_UPSTREAM_MODEL,
        endpoint: imagePaths.length ? "/images/edits" : "/images/generations",
        size: mapTuziGptImage2Size(tuziParams.aspectRatio, tuziParams.resolution),
        quality: tuziParams.quality,
        n: 1,
        outputFormat: "png",
        referenceImageCount: imagePaths.length,
      }
    : null;
  const gptImage2OfficialProviderParams = isReapiGptImage2 || isAicomingHaiyaGptImage2
    ? normalizeGptImage2OfficialParams({
        quality: officialQualityTemplate,
        resolution,
        aspectRatio,
        allowAuto: isReapiGptImage2,
      })
    : null;
  const aicomingHaiyaProviderModel = isAicomingHaiyaGptImage2 && gptImage2OfficialProviderParams
    ? AICOMING_HAIYA_GPT_IMAGE_2_UPSTREAM_MODELS[gptImage2OfficialProviderParams.resolution]
    : "";
  const gptImage2OfficialProviderSnapshot = gptImage2OfficialProviderParams
    ? {
        providerModel: aicomingHaiyaProviderModel || GPT_IMAGE_2_OFFICIAL_UPSTREAM_MODEL,
        quality: gptImage2OfficialProviderParams.quality,
        resolution: gptImage2OfficialProviderParams.resolution,
        aspectRatio: gptImage2OfficialProviderParams.aspectRatio,
        n: 1,
        outputFormat: "png",
        background: "auto",
        moderation: "low",
      }
    : null;
  // 提示词末尾的 --参数在这里解析：识别的转成结构化字段（优先于面板），V8.2 不支持的在提交前拦下，不扣费
  const midjourneyPromptFlags = isMidjourneyV8 ? parseMidjourneyV8PromptFlags(prompt) : null;
  const midjourneyPanelOptions = isMidjourneyV8 ? normalizeMidjourneyV8Options(input.midjourneyOptions) : null;
  const midjourneyOptions = isMidjourneyV8 ? mergeMidjourneyV8Options(midjourneyPanelOptions!.options, midjourneyPromptFlags!.options) : null;
  const midjourneyErrors = [
    ...(midjourneyPanelOptions?.errors ?? []),
    ...(midjourneyPromptFlags?.errors ?? []),
    ...(midjourneyOptions ? validateMidjourneyOptions(midjourneyOptions, normalizeMidjourneyV8Speed(input.speed)) : []),
    // reAPI 线路只接了 V8.2
    ...(isMidjourneyV8 && !isApimartMidjourneyV8 && midjourneyOptions?.version && midjourneyOptions.version !== MIDJOURNEY_V8_VERSION ? [`当前线路只支持 V8.2，其他版本请选 APIMart 线路的 Midjourney`] : []),
  ];
  if (midjourneyErrors.length) {
    // 直接给出具体原因（不走通用文案），提交前拦下，不扣费
    const message = `Midjourney 参数有误：${midjourneyErrors.join("；")}`;
    const friendly: FriendlyError = { title: "参数需要调整", message, action: "请按提示修改后重试，本次未提交、未扣费。", raw: message, requestId: null, code: "VALIDATION" };
    throw new ImageGenerationError({ message, status: 400, friendlyError: friendly });
  }
  const midjourneyV8Params = isMidjourneyV8
    ? {
        providerModel: MIDJOURNEY_V8_UPSTREAM_MODEL,
        version: midjourneyOptions?.version ?? MIDJOURNEY_V8_VERSION,
        // 提示词里写了 --ar 就以它为准，不再被面板的默认比例覆盖
        aspectRatio: normalizeMidjourneyV8Ratio(midjourneyPromptFlags?.size ?? aspectRatio),
        speed: normalizeMidjourneyV8Speed(input.speed),
        outputCount: MIDJOURNEY_V8_OUTPUT_COUNT,
        options: midjourneyOptions!,
        prompt: midjourneyPromptFlags!.prompt,
      }
    : null;
  const providerModel = imageProviderSnapshotModel({ model, referenceCount: imagePaths.length, prompt, aspectRatio, resolution, quality: qwen3Params?.quality ?? officialQualityTemplate, background: input.background, gptImage25Mode });
  if (input.exactProviderModel && input.exactProviderModel !== (isSeedreamModel ? seedreamModelId : providerModel)) {
    const friendly = toFriendlyError("实际生成路线与已确认方案不一致，请重新确认");
    throw new ImageGenerationError({ message: friendly.message, status: 409, friendlyError: friendly });
  }
  const effectiveResolutionSnapshot = effectiveResolution || effectiveGoogleAiStudioResolution || effectiveSeedreamResolution || resolution;

  if (!(await isImageEditModelVisible(model, gptImage25Mode))) {
    const friendly = toFriendlyError("该图片编辑模型已被管理员关闭");
    throw new ImageGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }

  // Which platform receives the reference images; drives the platform-hosting / Aliyun OSS choice.
  const mediaDeliveryTarget: MediaDeliveryTarget | null = openRouterModel ? { platform: "openrouter" }
    : isApimartMidjourneyV8 ? { platform: "apimart" }
    : qwen3Params ? { platform: "bailian", model: qwen3Params.providerModel }
    : isQwenImage21 ? { platform: "work-fisher" }
    : isSeedreamModel ? { platform: "volcengine" }
    : isTuziGptImage2 ? { platform: "tuzi" }
    : isGoogleAiStudioModel ? { platform: "google-ai-studio" }
    : isEasyRouterImage ? { platform: "easyrouter" }
    : isJiekouGptImage2 ? { platform: "jiekou" }
    : isMidjourneyV8 || isReapiGptImage2 || isReapiGptImage25 ? { platform: "reapi" }
    : isAicomingHaiyaGptImage2 || isAicomingHaiyaNanoBananaPro || isAicomingHaiyaGptImage25 ? { platform: "aicoming-haiya" }
    : isApimartImageModel ? { platform: "apimart" }
    : { platform: "kie" };

  let record: Awaited<ReturnType<typeof prisma.generation.create>>;
  let claimedToolMedia: GenerationToolMediaInput[] = [];
  try {
    const created = await createGenerationWithToolMedia({
      ownerUserId: authUserId,
      toolMediaIds: input.toolMediaIds,
      toolMediaPositions,
      mediaDeliveryTarget,
      role: "reference_image",
      createGeneration: (tx, lockedToolMedia) => {
        imagePaths = input.inputManifest
          ? interleaveGenerationInputValues(
              input.inputManifest,
              lockedToolMedia.map((media) => media.localPath),
              legacyPaths,
            )
          : lockedToolMedia.length
            ? lockedToolMedia.map((media) => media.localPath)
            : legacyPaths;
        return tx.generation.create({
        data: {
      userId,
      authUserId,
      requestKey: input.requestKey,
      canvasId: input.canvasId,
      type: "image_edit",
      source,
      prompt,
      templateData: JSON.stringify({
        taskType: "image_edit",
        prompt,
        ...(userPrompt ? { userPrompt } : {}),
        ...generationSkillMetadata(input.skill),
        ...(input.agentOutputContract ? {agentOutputContract: input.agentOutputContract}:{}),
        model,
        providerModel,
        ...animationSettings,
        ...googleSettings,
        ...(isProviderNanoBanana21(model) ? { outputCount: 1 } : {}),
        ...(qwen3Params ? { quality: qwen3Params.quality, outputCount: 1, outputFormat: "png" } : {}),
        source,
        aspectRatio: reapiGptImage25Params?.aspectRatio || aicomingGptImage25Params?.aspectRatio || midjourneyV8Params?.aspectRatio || tuziParams?.aspectRatio || gptImage2OfficialProviderParams?.aspectRatio || aspectRatio,
        resolution: reapiGptImage25Params?.resolution || aicomingGptImage25Params?.resolution || tuziParams?.resolution || gptImage2OfficialProviderParams?.resolution || effectiveResolutionSnapshot,
        customSize: cleanString(input.customSize),
        imagePaths,
        seedream: seedreamSnapshot,
        googleAiStudio: googleAiStudioSnapshot,
        easyrouter: easyRouterSnapshot,
        apimart: apimartSnapshot,
        ...(isSeedream55Model(model) ? { seedream55: input.seedream55, customSize: input.customSize, background: input.background || "auto", outputFormat: "png", outputCount: 1, imageInputCount } : {}),
        ...(gptImage25Request ? { gptImage25Mode, quality: gptImage25Request.quality, outputCount: 1, background: ("background" in gptImage25Request ? gptImage25Request.background : undefined) || "auto", outputFormat: gptImage25Request.output_format || "png" } : {}),
        ...(reapiGptImage25Request ? { gptImage25Mode, quality: reapiGptImage25Request.body.quality, outputCount: 1, background: reapiGptImage25Request.body.background || "auto", outputFormat: reapiGptImage25Request.body.output_format || "png", reapiGptImage25: { providerModel, mode: gptImage25Mode, size: reapiGptImage25Request.body.size } } : {}),
        ...(aicomingGptImage25Request ? { gptImage25Mode, quality: aicomingGptImage25Request.body.quality, outputCount: 1, background: aicomingGptImage25Request.body.background || "auto", outputFormat: aicomingGptImage25Request.body.output_format || "png", aicomingGptImage25: { providerModel, mode: gptImage25Mode, size: aicomingGptImage25Request.body.size } } : {}),
        jiekou: jiekouSnapshot,
        gptImage2OfficialProvider: gptImage2OfficialProviderSnapshot,
        midjourneyV8: midjourneyV8Params,
        ...(batchId && batchIndex && taskCount ? {
          batch: {
            id: batchId,
            ...(batchMode ? { mode: batchMode } : {}),
            index: batchIndex,
            size: taskCount,
            submittedAt: batchSubmittedAt || new Date().toISOString(),
          },
        } : {}),
        ...(jiekouSnapshot ? { outputCount: jiekouNumImagesTemplate, outputFormat: jiekouSnapshot.outputFormat, quality: jiekouSnapshot.quality } : {}),
        ...(gptImage2OfficialProviderSnapshot ? {
          outputCount: 1,
          outputFormat: "png",
          quality: gptImage2OfficialProviderSnapshot.quality,
        } : {}),
        ...(tuziSnapshot ? {
          outputCount: 1,
          outputFormat: "png",
          quality: tuziSnapshot.quality,
        } : {}),
        ...(midjourneyV8Params ? {
          outputCount: MIDJOURNEY_V8_OUTPUT_COUNT,
          billing: {
            unitType: "request",
            childBillable: false,
          },
        } : {}),
      }),
      status: "running",
      localPath: null,
      model,
      externalProvider: openRouterModel ? "openrouter" : isApimartMidjourneyV8 ? "apimart" : qwen3Params ? "bailian" : isQwenImage21 ? "work-fisher" : isAicomingHaiyaGptImage25 ? "aicoming-haiya" : isTuziGptImage2 ? "tuzi" : (isReapiGptImage2 || isReapiGptImage25) ? "reapi" : isMidjourneyV8 ? "reapi" : isAicomingHaiyaNanoBananaPro ? "aicoming-haiya" : isAicomingHaiyaGptImage2 ? "aicoming-haiya" : isEasyRouterImage ? "easyrouter" : isGoogleAiStudioModel ? "google-ai-studio" : isJiekouGptImage2 ? "jiekou" : isApimartImageModel ? "apimart" : isSeedreamModel ? "volcengine" : "kie",
      externalTaskId: null,
      finishedAt: null,
      } as any,
        });
      },
    });
    record = created.generation;
    claimedToolMedia = created.inputs;
  } catch (error) {
    throw toImageToolMediaError(error);
  }
  if (!isEasyRouterImage && !isTuziGptImage2) void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
  syncAdminAssetFeed(record.id);

  try {
    if (isProviderNanoBanana21(model)) {
      validateProviderNanoBanana21(model, { prompt, aspectRatio, resolution, referenceCount: imagePaths.length });
      if (input.maskUrl) throw new Error("该平台 Nano Banana 2.1 接口不支持独立遮罩参数");
    }
    if (model === GOOGLE_NANO_BANANA_21_MODEL) validateGoogleNanoBanana21Input({ aspectRatio, resolution, referenceCount: imagePaths.length });
    if (qwen3Params && imagePaths.length > 3) throw new Error("Qwen-Image-3.0 最多支持 3 张参考图");
    if (qwen3Params && input.maskUrl) throw new Error("Qwen-Image-3.0 不支持遮罩编辑");
    if (isQwenImage21 && imagePaths.length > 10) throw new Error("Qwen-Image-Global-2.1 最多支持 10 张参考图");
    if (isQwenImage21 && input.maskUrl) throw new Error("Qwen-Image-Global-2.1 不支持遮罩编辑");
    if (isSeedreamPro && imagePaths.length > 10) throw new Error("Doubao-Seedream-5.0-Pro最多支持10张参考图");
    if (isSeedreamModel && imagePaths.length > 14) throw new Error("Doubao-Seedream最多支持14张参考图");
    if (isNanoBanana2Lite && imagePaths.length > 10) throw new Error("nano-banana-2-lite最多支持10张参考图");
    if (isGoogleAiStudioLite && imagePaths.length > 10) throw new Error("nano-banana-2-lite（官方）最多支持10张参考图");
    if (gptImage25Request && imagePaths.length > 16) throw new Error(`${model === APIMART_GPT_IMAGE_26_MODEL_ID ? "GPT-Image-2.6" : "GPT-Image-2.5"} 最多支持 16 张参考图`);
    if (isSeedream55Model(model)) (isVolcSeedream55 ? buildVolcSeedream55Request : buildApimartSeedream55Request)({ ...input.seedream55, prompt: rawPrompt, aspectRatio, resolution, customSize: input.customSize, background: input.background, imageUrls: imagePaths });
    if (isApimartNanoBananaPro && imagePaths.length > 14) throw new Error("Nano Banana Pro（am）最多支持 14 张参考图");
    if (isEasyRouterImage && imagePaths.length > 16) throw new Error("EasyRouter Image 2 图片编辑最多支持 16 张参考图");
    if (isTuziGptImage2 && imagePaths.length > 16) throw new Error("GPT-Image-2（tz）最多支持 16 张参考图");
    if ((isReapiGptImage2 || isAicomingHaiyaGptImage2) && imagePaths.length > 16) {
      throw new Error("GPT-Image-2 官方平台最多支持 16 张参考图");
    }
    const uploadFolder = openRouterModel ? "openrouter-image-inputs" : isApimartMidjourneyV8 ? "apimart-image-inputs" : qwen3Params ? "bailian-qwen-image-inputs" : isQwenImage21 ? "work-fisher-image-inputs" : isSeedreamModel
      ? "seedream-inputs"
      : isTuziGptImage2
        ? "tuzi-image-inputs"
      : isEasyRouterImage
        ? "easyrouter-image-inputs"
      : isGoogleAiStudioModel
          ? "google-ai-studio-image-inputs"
          : isJiekouGptImage2
            ? "jiekou-image-inputs"
            : isMidjourneyV8 || isReapiGptImage2 || isReapiGptImage25
              ? "reapi-image-inputs"
              : isAicomingHaiyaGptImage2 || isAicomingHaiyaNanoBananaPro || isAicomingHaiyaGptImage25
                ? "aicoming-haiya-image-inputs"
            : isApimartImageModel
              ? "apimart-image-inputs"
              : "kie-image-edit-inputs";
    const preparedLegacyInputs = await Promise.all(legacyPaths.map(async (localPath, index) => ({
      manifestPath: legacySourcePaths[index],
      kind: "image",
      localPath,
      modelUrl: isGoogleAiStudioModel || isTuziGptImage2
        ? localPath
        : await mapImagePathToPublicUrl(localPath, uploadFolder, mediaDeliveryTarget),
    })));
    const orderedInputs = await deliverToolMediaForPlatform(await resolveOrderedGenerationInputs({
      manifest: input.inputManifest,
      toolMediaInputs: claimedToolMedia,
      legacyInputs: preparedLegacyInputs,
    }), uploadFolder, isGoogleAiStudioModel || isTuziGptImage2 ? null : mediaDeliveryTarget);
    if (isVolcSeedream55) for (const media of orderedInputs) await validateVolcSeedream55Reference(media.localPath, input.seedream55?.layerDecomposition === true);
    if (isSeedream55) for (const media of orderedInputs) await validateSeedream55Reference(media.localPath);
    const uploadedUrls = orderedInputs.map((media) => isTuziGptImage2 ? media.localPath : media.modelUrl);
    if (uploadedUrls.length !== imagePaths.length) {
      throw new ToolMediaInputError("素材数量与界面顺序不一致，请重新提交");
    }

    await Logger.generation(
      "task_create",
      `用户 ${userId} 创建图片编辑任务`,
      "info",
      record.id,
      {
        prompt: prompt.substring(0, 100),
        model,
        providerModel,
        ...googleSettings,
        ...(qwen3Params ? { quality: qwen3Params.quality, outputCount: 1, outputFormat: "png" } : {}),
        source,
        aspectRatio,
        resolution: effectiveResolutionSnapshot,
        imageCount: imagePaths.length,
        imagePaths,
        ...(claimedToolMedia.length
          ? buildToolMediaLogMetadata(claimedToolMedia)
          : { inputPublicUrls: uploadedUrls.map(redactInlineMedia) }),
        taskType: "image_edit",
        seedream: seedreamSnapshot,
        googleAiStudio: googleAiStudioSnapshot,
        easyrouter: easyRouterSnapshot,
        tuzi: tuziSnapshot,
        ...(reapiGptImage25Request ? { gptImage25Mode, quality: reapiGptImage25Request.body.quality, outputCount: 1, background: reapiGptImage25Request.body.background || "auto", outputFormat: reapiGptImage25Request.body.output_format || "png", reapiGptImage25: { providerModel, mode: gptImage25Mode, size: reapiGptImage25Request.body.size } } : {}),
        ...(aicomingGptImage25Request ? { gptImage25Mode, quality: aicomingGptImage25Request.body.quality, outputCount: 1, background: aicomingGptImage25Request.body.background || "auto", outputFormat: aicomingGptImage25Request.body.output_format || "png", aicomingGptImage25: { providerModel, mode: gptImage25Mode, size: aicomingGptImage25Request.body.size } } : {}),
        jiekou: jiekouSnapshot,
        gptImage2OfficialProvider: gptImage2OfficialProviderSnapshot,
      },
      userId
    );

    const preserveAgentImages = async (images: string[], provider: string, template: Record<string, any>) => {
      const recoveryTemplate = ["google-ai-studio", "openrouter", "tuzi", "easyrouter", "aicoming-haiya"].includes(provider)
        ? { ...template, billing: { ...template.billing, childBillable: false } } : template;
      await prepareAgentImageRecovery(images, recoveryTemplate, {
        preserveDuplicates: isVolcSeedream55,
        capture: sources => captureGenerationImageOutputs(record.id, sources),
        persist: next => prisma.generation.update({ where: { id: record.id }, data: { templateData: JSON.stringify(next) } }),
      });
      const { finalizeGeneration } = await import("./finalize");
      if (await finalizeGeneration(record.id) !== "done") throw new AgentOutputSavePendingError();
    };
    let taskId = "";
    if (openRouterModel) {
      const firstReferenceDimensions = !animation && aspectRatio === "auto" && openRouterModel.upstreamModelId.startsWith("openai/") && orderedInputs.length
        ? await readOpenRouterReferenceDimensions(orderedInputs[0].localPath)
        : undefined;
      const requestInput = { model, prompt, aspectRatio, resolution, quality: input.quality, background: input.background, outputFormat: input.outputFormat, imageUrls: uploadedUrls, maskUrl: input.maskUrl, firstReferenceDimensions, ...animationSettings };
      const request = buildOpenRouterImageRequest(requestInput);
      const templateData = JSON.stringify({ ...JSON.parse(record.templateData || "{}"),
        resolution: request.settings.resolution,
        aspectRatio: request.settings.aspectRatio,
        quality: "quality" in request.body ? request.body.quality : "",
        background: "background" in request.body ? request.body.background : undefined, outputFormat: request.body.output_format,
        outputCount: 1, openrouter: { endpoint: request.endpoint, request: request.body },
      });
      await prisma.generation.update({ where: { id: record.id }, data: { externalTaskId: String(record.id), templateData, errorMsg: null } });
      syncAdminAssetFeed(record.id);
      void (async () => {
        try {
          const generated = await openRouterGenerateImage(requestInput);
          const billingTemplate = await persistGenerationProviderUsage({ ...record, templateData }, { usage: generated.usage });
          try {
            const dimensions = await validateOpenRouterImageOutputs(requestInput, generated.images);
            if (dimensions) billingTemplate.openrouter.outputDimensions = dimensions;
          } catch (error) {
            // Keep the paid result and usage for recovery even when it fails size validation.
            const localPath = await saveRemoteFile(generated.images[0], outputFolder, true, { providerId: "openrouter" });
            await prisma.generation.update({ where: { id: record.id }, data: { localPath } });
            throw error;
          }
          if (input.agentOutputContract) { await preserveAgentImages(generated.images,"openrouter",billingTemplate); return; }
          const localPath = await saveRemoteFile(generated.images[0], outputFolder, true, { providerId: "openrouter" });
          await prisma.generation.update({ where: { id: record.id }, data: {
            status: "success", localPath, templateData: JSON.stringify(billingTemplate), errorMsg: null, finishedAt: new Date(),
          } });
        } catch (error) {
          if (error instanceof AgentOutputSavePendingError) return;
          const friendly = toFriendlyError(providerFailureText(error, "OpenRouter 图片生成失败"));
          await prisma.generation.update({ where: { id: record.id }, data: {
            status: "failed", errorMsg: formatFriendlyMessageForStorage(friendly), finishedAt: new Date(),
          } });
        } finally {
          void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
          syncAdminAssetFeed(record.id);
        }
      })();
      return { generationId: record.id, taskId: String(record.id), status: "running" };
    }
    if (qwen3Params) {
      const requestInput = { prompt, ...qwen3Params, imageUrls: uploadedUrls };
      const request = buildBailianQwenImageRequest(requestInput);
      const requestTemplate = JSON.stringify({ ...JSON.parse(record.templateData || "{}"),
        ...(aspectRatio === "auto" ? { resolution: "auto" } : {}),
        bailianQwenImage: { endpoint: request.endpoint, request: request.body },
      });
      await prisma.generation.update({ where: { id: record.id }, data: { templateData: requestTemplate } });
      const submitted = await bailianSubmitQwenImage(requestInput);
      await prisma.generation.update({ where: { id: record.id }, data: {
        externalTaskId: submitted.taskId, errorMsg: null,
        templateData: JSON.stringify({ ...JSON.parse(requestTemplate), providerStatus: "PENDING", phase: "generating" }),
      } });
      syncAdminAssetFeed(record.id);
      return { generationId: record.id, taskId: submitted.taskId, status: "running" };
    }
    if (isQwenImage21) {
      const requestInput = { prompt, aspectRatio, resolution, imageUrls: uploadedUrls };
      const request = buildWorkFisherImageRequest(requestInput);
      const requestTemplate = JSON.stringify({ ...JSON.parse(record.templateData || "{}"),
        workFisher: { endpoint: request.endpoint, request: request.body },
      });
      await prisma.generation.update({ where: { id: record.id }, data: { templateData: requestTemplate } });
      const submitted = await workFisherSubmitImage(requestInput);
      await prisma.generation.update({
        where: { id: record.id },
        data: { externalTaskId: submitted.taskId, errorMsg: null, templateData: JSON.stringify({ ...JSON.parse(requestTemplate), providerStatus: "SUBMITTED", phase: "generating" }) },
      });
      syncAdminAssetFeed(record.id);
      return { generationId: record.id, taskId: submitted.taskId, status: "running" };
    }
    if (isTuziGptImage2) {
      const params = tuziParams || normalizeTuziGptImage2Params({
        quality: officialQualityTemplate,
        resolution,
        aspectRatio,
      });
      await prisma.generation.update({
        where: { id: record.id },
        data: { externalTaskId: String(record.id), errorMsg: null },
      });
      syncAdminAssetFeed(record.id);

      void (async () => {
        try {
          const generated = await tuziGenerateImage({
            model,
            prompt,
            aspectRatio: params.aspectRatio,
            resolution: params.resolution,
            quality: params.quality,
            imageUrls: uploadedUrls,
            maskUrl: input.maskUrl,
          });
          const tuziBillingTemplate = await persistGenerationProviderUsage(record, {
            usage: (generated.raw as any)?.usage ?? null,
          });
          if (input.agentOutputContract) { await preserveAgentImages(generated.images, "tuzi", tuziBillingTemplate); return; }
          const first = cleanString(dedupeOutputImages(generated.images)[0]);
          if (!first) throw new Error("兔子 API 未返回可用图片");
          const localPath = await saveRemoteFile(first, outputFolder, /^data:/i.test(first), { providerId: "tuzi" });
          await prisma.generation.update({
            where: { id: record.id },
            data: {
              status: "success",
              templateData: JSON.stringify(tuziBillingTemplate),
              localPath,
              errorMsg: null,
              finishedAt: new Date(),
            },
          });
          void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
          syncAdminAssetFeed(record.id);
          await Logger.api(
            "tuzi_request",
            `Image edit task ${record.id} completed on TuZi`,
            "success",
            Date.now() - startTime,
            {
              model,
              providerModel,
              generationId: record.id,
              aspectRatio: params.aspectRatio,
              resolution: params.resolution,
              quality: params.quality,
              referenceImageCount: imagePaths.length,
              n: 1,
            },
            userId,
          );
        } catch (e: any) {
          if (e instanceof AgentOutputSavePendingError) return;
          const rawMsg = providerFailureText(e, "Generation failed");
          const friendly = toFriendlyError(rawMsg);
          await logUnknownFriendlyImageError(friendly, record.id, userId, model, inferErrorStatus(rawMsg));
          const storageMsg = formatFriendlyMessageForStorage(friendly);
          await prisma.generation.update({
            where: { id: record.id },
            data: { status: "failed", errorMsg: storageMsg, finishedAt: new Date() },
          });
          void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
          syncAdminAssetFeed(record.id);
          await Logger.generation(
            "task_failed",
            `Image edit task ${record.id} failed on TuZi: ${rawMsg}`,
            "error",
            record.id,
            {
              error: e?.message,
              stack: e?.stack,
              duration: Date.now() - startTime,
            },
            userId,
          );
        }
      })();

      await Logger.api(
        "tuzi_request",
        `Image edit task ${record.id} submitted to TuZi`,
        "success",
        Date.now() - startTime,
        {
          model,
          providerModel,
          generationId: record.id,
          aspectRatio: params.aspectRatio,
          resolution: params.resolution,
          quality: params.quality,
          referenceImageCount: imagePaths.length,
          n: 1,
        },
        userId,
      );
      return { generationId: record.id, taskId: String(record.id), status: "running" };
    }

    if (isEasyRouterImage) {
      if (uploadedUrls.length > 16) throw new Error("EasyRouter Image 2 图片编辑最多支持 16 张参考图");
      await prisma.generation.update({
        where: { id: record.id },
        data: { externalTaskId: String(record.id), errorMsg: null },
      });
      syncAdminAssetFeed(record.id);

      void (async () => {
        try {
          const generated = await easyRouterGenerateImage({
            model,
            prompt,
            aspectRatio,
            resolution,
            customSize: input.customSize,
            quality: officialQualityTemplate,
            imageUrls: uploadedUrls,
          });
          if (input.agentOutputContract) { await preserveAgentImages(generated.images, "easyrouter", JSON.parse(record.templateData || "{}")); return; }
          const first = cleanString(dedupeOutputImages(generated.images)[0]);
          if (!first) throw new Error("EasyRouter did not return any usable image");
          const localPath = await saveRemoteFile(first, outputFolder, /^data:/i.test(first), { providerId: "easyrouter" });
          await prisma.generation.update({
            where: { id: record.id },
            data: {
              status: "success",
              localPath,
              errorMsg: null,
              finishedAt: new Date(),
            },
          });
          syncAdminAssetFeed(record.id);
          await Logger.api(
            "easyrouter_request",
            `Image edit task ${record.id} completed on EasyRouter`,
            "success",
            Date.now() - startTime,
            {
              model,
              providerModel,
              generationId: record.id,
              aspectRatio,
              resolution,
              customSize: cleanString(input.customSize) || undefined,
              imageInputCount: uploadedUrls.length,
            },
            userId,
          );
        } catch (e: any) {
          if (e instanceof AgentOutputSavePendingError) return;
          const rawMsg = providerFailureText(e, "Generation failed");
          const friendly = toFriendlyError(rawMsg);
          await logUnknownFriendlyImageError(friendly, record.id, userId, model, inferErrorStatus(rawMsg));
          const storageMsg = formatFriendlyMessageForStorage(friendly);
          await prisma.generation.update({
            where: { id: record.id },
            data: { status: "failed", errorMsg: storageMsg, finishedAt: new Date() },
          });
          syncAdminAssetFeed(record.id);
          await Logger.generation(
            "task_failed",
            `Image edit task ${record.id} failed on EasyRouter: ${rawMsg}`,
            "error",
            record.id,
            {
              error: e?.message,
              stack: e?.stack,
              duration: Date.now() - startTime,
            },
            userId,
          );
        }
      })();

      await Logger.api(
        "easyrouter_request",
        `Image edit task ${record.id} submitted to EasyRouter`,
        "success",
        Date.now() - startTime,
        {
          model,
          providerModel,
          generationId: record.id,
          aspectRatio,
          resolution,
          customSize: cleanString(input.customSize) || undefined,
          imageInputCount: uploadedUrls.length,
        },
        userId,
      );
      return { generationId: record.id, taskId: String(record.id), status: "running" };
    }

    if (isGoogleAiStudioModel) {
      if (uploadedUrls.length > 16) throw new Error("Google AI Studio 图片模型最多支持 16 张参考图");
      await prisma.generation.update({
        where: { id: record.id },
        data: { externalTaskId: String(record.id), errorMsg: null },
      });
      void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
      syncAdminAssetFeed(record.id);

      void (async () => {
        let savingReturnedOutput = false;
        try {
          const generated = await googleAiStudioGenerateImage({
            model,
            prompt,
            aspectRatio,
            resolution: effectiveResolutionSnapshot,
            imageUrls: uploadedUrls,
            ...googleSettings,
          });
          let googleBillingTemplate = await persistGenerationProviderUsage(record, {
            usageMetadata: generated.raw?.usageMetadata || null,
          });
          const googleGrounding = extractGoogleGrounding(generated.raw);
          if (googleGrounding) {
            googleBillingTemplate = { ...googleBillingTemplate, googleGrounding };
            await prisma.generation.update({ where: { id: record.id }, data: { templateData: JSON.stringify(googleBillingTemplate) } });
          }
          if (input.agentOutputContract) { savingReturnedOutput = true; await preserveAgentImages(generated.images, "google-ai-studio", googleBillingTemplate); return; }
          const usableImages = dedupeOutputImages(generated.images);
          const first = cleanString(usableImages[0]);
          if (!first) throw new Error("Google AI Studio did not return any usable image");
          savingReturnedOutput = true;
          const localPath = await saveRemoteFile(
            first,
            outputFolder,
            /^data:/i.test(first),
            { providerId: "google-ai-studio" },
          );
          if (usableImages.length > 1) {
            for (let i = 1; i < usableImages.length; i++) {
              const image = cleanString(usableImages[i]);
              if (!image) continue;
              const extraRecordId = await createExtraImageGenerationRecordIfMissing({
                groupId: String(record.id),
                outputIndex: i,
                rawImage: image,
                allowBase64: /^data:/i.test(image),
                userId,
                authUserId,
                source,
                prompt,
                templateData: JSON.stringify({ ...googleBillingTemplate, billing: { billable: false, parentGenerationId: record.id, reason: "整次请求用量已计入主记录" } }),
                model,
                externalProvider: "google-ai-studio",
              });
              if (extraRecordId) {
                void upsertUsageLedgerForGenerationId(extraRecordId).catch(() => null);
                syncAdminAssetFeed(extraRecordId);
              }
            }
          }
          await prisma.generation.update({
            where: { id: record.id },
            data: {
              status: "success",
              localPath,
              errorMsg: null,
              templateData: JSON.stringify(googleBillingTemplate),
              finishedAt: new Date(),
            },
          });
          void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
          syncAdminAssetFeed(record.id);
          await Logger.api(
            "google_ai_studio_request",
            `Image edit task ${record.id} completed on Google AI Studio`,
            "success",
            Date.now() - startTime,
            {
              model,
              providerModel,
              generationId: record.id,
              aspectRatio,
              resolution: effectiveResolutionSnapshot,
              returnedCount: usableImages.length,
            },
            userId
          );
        } catch (e: any) {
          if (e instanceof AgentOutputSavePendingError) return;
          const rawMsg = providerFailureText(e, "Generation failed");
          const friendly = toFriendlyError(savingReturnedOutput ? `远程结果已返回，但下载保存失败（${rawMsg}）` : rawMsg);
          await logUnknownFriendlyImageError(friendly, record.id, userId, model, inferErrorStatus(rawMsg));
          const storageMsg = formatFriendlyMessageForStorage(friendly);
          await prisma.generation.update({
            where: { id: record.id },
            data: { status: "failed", errorMsg: storageMsg, finishedAt: new Date() },
          });
          void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
          syncAdminAssetFeed(record.id);
          await Logger.generation(
            "task_failed",
            savingReturnedOutput ? `Image edit task ${record.id} result saving failed after Google AI Studio completed: ${rawMsg}` : `Image edit task ${record.id} failed on Google AI Studio: ${rawMsg}`,
            "error",
            record.id,
            {
              error: e?.message,
              stack: e?.stack,
              ...(savingReturnedOutput ? { phase: "output_save", providerCompleted: true } : {}),
              duration: Date.now() - startTime,
            },
            userId
          );
        }
      })();

      await Logger.api(
        "google_ai_studio_request",
        `Image edit task ${record.id} submitted to Google AI Studio`,
        "success",
        Date.now() - startTime,
        {
          model,
          providerModel,
          generationId: record.id,
          aspectRatio,
          resolution: effectiveResolutionSnapshot,
        },
        userId
      );
      return { generationId: record.id, taskId: String(record.id), status: "running" };
    }

    if (isJiekouGptImage2) {
      if (uploadedUrls.length > 16) throw new Error("GPT-Image-2（优质）最多支持16张参考图");
      const jiekouMaskUrl =
        uploadedUrls.length && input.maskUrl
          ? await mapImagePathToPublicUrl(input.maskUrl, "jiekou-image-inputs")
          : "";
      await prisma.generation.update({
        where: { id: record.id },
        data: { externalTaskId: String(record.id), errorMsg: null },
      });
      void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
      syncAdminAssetFeed(record.id);

      void (async () => {
        try {
          const generated = await jiekouGptImage2Generate({
            prompt,
            aspectRatio,
            resolution,
            imageUrls: uploadedUrls,
            maskUrl: jiekouMaskUrl,
            quality: officialQualityTemplate,
            background: input.background,
            moderation: input.moderation,
            outputFormat: officialOutputFormatTemplate,
            n: jiekouNumImagesTemplate,
          });
          if (input.agentOutputContract) { await preserveAgentImages(generated.images, "jiekou", {
            ...JSON.parse(record.templateData || "{}"),
            jiekou: { ...(jiekouSnapshot || {}), endpoint: generated.endpoint, providerModel: generated.providerModel, request: generated.request, returnedCount: generated.images.length },
          }); return; }
          const usableImages = dedupeOutputImages(generated.images);
          const first = cleanString(usableImages[0]);
          if (!first) throw new Error("Jiekou did not return any usable image");
          const localPath = await saveRemoteFile(
            first,
            outputFolder,
            /^data:/i.test(first),
            { providerId: "jiekou" },
          );
          if (usableImages.length > 1) {
            for (let i = 1; i < usableImages.length; i++) {
              const image = cleanString(usableImages[i]);
              if (!image) continue;
              const extraRecordId = await createExtraImageGenerationRecordIfMissing({
                groupId: String(record.id),
                outputIndex: i,
                rawImage: image,
                allowBase64: /^data:/i.test(image),
                userId,
                authUserId,
                source,
                prompt,
                templateData: record.templateData,
                model,
                externalProvider: "jiekou",
              });
              if (extraRecordId) {
                void upsertUsageLedgerForGenerationId(extraRecordId).catch(() => null);
                syncAdminAssetFeed(extraRecordId);
              }
            }
          }
          await prisma.generation.update({
            where: { id: record.id },
            data: {
              status: "success",
              localPath,
              errorMsg: null,
              finishedAt: new Date(),
              templateData: JSON.stringify({
                ...(JSON.parse(record.templateData || "{}") as Record<string, any>),
                jiekou: {
                  ...(jiekouSnapshot || {}),
                  endpoint: generated.endpoint,
                  providerModel: generated.providerModel,
                  request: generated.request,
                  returnedCount: usableImages.length,
                },
                providerStatus: "success",
              }),
            },
          });
          void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
          syncAdminAssetFeed(record.id);
          await Logger.api(
            "jiekou_request",
            `Image edit task ${record.id} completed on Jiekou`,
            "success",
            Date.now() - startTime,
            {
              model,
              providerModel: generated.providerModel,
              generationId: record.id,
              endpoint: generated.endpoint,
              aspectRatio,
              resolution,
              imageInputCount: uploadedUrls.length,
              outputCount: jiekouNumImagesTemplate,
              returnedCount: usableImages.length,
            },
            userId
          );
        } catch (e: any) {
          if (e instanceof AgentOutputSavePendingError) return;
          const rawMsg = providerFailureText(e, "Generation failed");
          const friendly = toFriendlyError(rawMsg);
          await logUnknownFriendlyImageError(friendly, record.id, userId, model, inferErrorStatus(rawMsg));
          const storageMsg = formatFriendlyMessageForStorage(friendly);
          await prisma.generation.update({
            where: { id: record.id },
            data: { status: "failed", errorMsg: storageMsg, finishedAt: new Date() },
          });
          void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
          syncAdminAssetFeed(record.id);
          await Logger.generation(
            "task_failed",
            `Image edit task ${record.id} failed on Jiekou: ${rawMsg}`,
            "error",
            record.id,
            {
              error: e?.message,
              stack: e?.stack,
              duration: Date.now() - startTime,
            },
            userId
          );
        }
      })();

      await Logger.api(
        "jiekou_request",
        `Image edit task ${record.id} submitted to Jiekou`,
        "success",
        Date.now() - startTime,
        {
          model,
          providerModel,
          generationId: record.id,
          aspectRatio,
          resolution,
          imageInputCount: uploadedUrls.length,
          outputCount: jiekouNumImagesTemplate,
        },
        userId
      );
      return { generationId: record.id, taskId: String(record.id), status: "running" };
    }

    if (isAicomingHaiyaNanoBananaPro) {
      const submitted = await aicomingHaiyaSubmitNanoBananaPro({
        prompt,
        aspectRatio,
        resolution,
        imageUrls: uploadedUrls,
        requestKey: input.requestKey,
      });
      await prisma.generation.update({
        where: { id: record.id },
        data: {
          externalTaskId: submitted.taskId,
          errorMsg: null,
          templateData: JSON.stringify({
            ...(JSON.parse(record.templateData || "{}") as Record<string, any>),
            aicomingHaiyaNanoBananaPro: {
              providerModel: AICOMING_HAIYA_NANO_BANANA_PRO_UPSTREAM_MODEL,
              taskId: submitted.taskId,
              request: submitted.request,
            },
            providerStatus: "submitted",
          }),
        },
      });
      void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
      syncAdminAssetFeed(record.id);
      await Logger.api(
        "aicoming_request",
        `Image edit task ${record.id} submitted to Haiya AIComing nano-banana-pro`,
        "success",
        Date.now() - startTime,
        {
          model,
          providerModel,
          generationId: record.id,
          taskId: submitted.taskId,
          aspectRatio: submitted.request.aspect_ratio,
          resolution: submitted.request.image_size,
          imageInputCount: uploadedUrls.length,
          outputCount: 1,
        },
        userId,
      );
      return { generationId: record.id, taskId: submitted.taskId, status: "running" };
    }

    if (isAicomingHaiyaGptImage25) {
      if (uploadedUrls.length > 16) throw new Error("AIComing 图片模型最多支持 16 张参考图");
      const generationInput = { prompt, mode: gptImage25Mode, ...aicomingGptImage25Params!, imageUrls: uploadedUrls, requestKey: input.requestKey || `generation-${record.id}` };
      const request = buildAicomingHaiyaGptImage25Request(generationInput);
      const templateData = JSON.stringify({
        ...JSON.parse(record.templateData || "{}"),
        aicomingGptImage25: { providerModel, mode: gptImage25Mode, transport: "sync", request: request.body },
      });
      // Keep externalTaskId null: the polling finalizer must not query a fabricated upstream task ID.
      await prisma.generation.update({ where: { id: record.id }, data: { templateData, errorMsg: null } });
      syncAdminAssetFeed(record.id);
      void (async () => {
        try {
          const generated = await aicomingHaiyaGenerateGptImage25(generationInput);
          if (input.agentOutputContract) { await preserveAgentImages(generated.images, "aicoming-haiya", JSON.parse(templateData)); return; }
          const first = cleanString(dedupeOutputImages(generated.images)[0]);
          if (!first) throw new Error("海牙 GPT-Image-2.5 未返回可用图片");
          const localPath = await saveRemoteFile(first, outputFolder, /^data:/i.test(first), { providerId: "aicoming-haiya" });
          await prisma.generation.update({
            where: { id: record.id },
            data: { status: "success", localPath, errorMsg: null, finishedAt: new Date() },
          });
          void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
          syncAdminAssetFeed(record.id);
          await Logger.api("aicoming_request", `Image edit task ${record.id} completed on Haiya`, "success", Date.now() - startTime, { model, providerModel, generationId: record.id, transport: "sync", n: 1 }, userId);
        } catch (error: any) {
          if (error instanceof AgentOutputSavePendingError) return;
          const rawMsg = providerFailureText(error, "Generation failed");
          const friendly = toFriendlyError(rawMsg);
          await logUnknownFriendlyImageError(friendly, record.id, userId, model, inferErrorStatus(rawMsg));
          await prisma.generation.update({
            where: { id: record.id },
            data: { status: "failed", errorMsg: formatFriendlyMessageForStorage(friendly), finishedAt: new Date() },
          });
          void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
          syncAdminAssetFeed(record.id);
          await Logger.generation("task_failed", `Image edit task ${record.id} failed on Haiya: ${rawMsg}`, "error", record.id, { model, providerModel, transport: "sync", duration: Date.now() - startTime }, userId);
        }
      })();
      return { generationId: record.id, taskId: String(record.id), status: "running" };
    }

    if (isReapiGptImage2 || isAicomingHaiyaGptImage2 || isReapiGptImage25) {
      if (uploadedUrls.length > 16) throw new Error("图片模型最多支持 16 张参考图");
      const params = reapiGptImage25Params || gptImage2OfficialProviderParams
        || normalizeGptImage2OfficialParams({ quality: "medium", resolution: "2K", aspectRatio: "1:1" });
      if (isReapiGptImage25) {
        const request = buildReapiGptImage25Request({ prompt, mode: gptImage25Mode, ...params, imageUrls: uploadedUrls });
        await prisma.generation.update({ where: { id: record.id }, data: { templateData: JSON.stringify({ ...JSON.parse(record.templateData || "{}"), reapiGptImage25: { providerModel, mode: gptImage25Mode, request: request.body } }) } });
      }
      const submitted = isReapiGptImage25
        ? await reapiSubmitGptImage25({ prompt, mode: gptImage25Mode, ...params, imageUrls: uploadedUrls })
        : isReapiGptImage2
        ? await reapiSubmitImage({
            prompt,
            aspectRatio: params.aspectRatio,
            resolution: params.resolution,
            quality: params.quality,
            imageUrls: uploadedUrls,
          })
        : await aicomingHaiyaSubmitImage({
            prompt,
            aspectRatio: params.aspectRatio,
            resolution: params.resolution,
            quality: params.quality,
            imageUrls: uploadedUrls,
            requestKey: input.requestKey,
          });
      await prisma.generation.update({
        where: { id: record.id },
        data: {
          externalTaskId: submitted.taskId,
          errorMsg: null,
          templateData: JSON.stringify({
            ...(JSON.parse(record.templateData || "{}") as Record<string, any>),
            [isReapiGptImage25 ? "reapiGptImage25" : "gptImage2OfficialProvider"]: {
              ...(isReapiGptImage25 ? { providerModel, mode: gptImage25Mode, ...params } : gptImage2OfficialProviderSnapshot || {}),
              taskId: submitted.taskId,
              request: submitted.request,
            },
            providerStatus: "submitted",
          }),
        },
      });
      void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
      syncAdminAssetFeed(record.id);
      await Logger.api(
        (isReapiGptImage2 || isReapiGptImage25) ? "reapi_request" : "aicoming_request",
        `Image edit task ${record.id} submitted to ${isReapiGptImage2 || isReapiGptImage25 ? "reAPI" : isAicomingHaiyaGptImage2 ? "Haiya AIComing" : "AIComing"}`,
        "success",
        Date.now() - startTime,
        {
          model,
          providerModel,
          generationId: record.id,
          taskId: submitted.taskId,
          aspectRatio: params.aspectRatio,
          resolution: params.resolution,
          quality: params.quality,
          imageInputCount: uploadedUrls.length,
          outputCount: 1,
        },
        userId,
      );
      return { generationId: record.id, taskId: submitted.taskId, status: "running" };
    }

    if (isMidjourneyV8) {
      const params = midjourneyV8Params!;
      // APIMart 走结构化字段（提示词里的 --参数已解析出来）；reAPI 仍按原提示词透传
      const submitted = isApimartMidjourneyV8
        ? await apimartSubmitMidjourneyV8({ prompt: params.prompt, aspectRatio: params.aspectRatio, speed: params.speed, imageUrls: uploadedUrls, options: params.options })
        : await reapiSubmitMidjourneyV8({ prompt, aspectRatio: params.aspectRatio, speed: params.speed, imageUrls: uploadedUrls });
      const midjourneyAction = "action" in submitted && submitted.action ? submitted.action : uploadedUrls.length ? "edits" : "imagine";
      await prisma.generation.update({
        where: { id: record.id },
        data: {
          externalTaskId: submitted.taskId,
          errorMsg: null,
          templateData: JSON.stringify({
            ...(JSON.parse(record.templateData || "{}") as Record<string, any>),
            midjourneyV8: {
              ...params,
              action: midjourneyAction,
              taskId: submitted.taskId,
              request: submitted.request,
            },
            providerStatus: "submitted",
          }),
        },
      });
      void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
      syncAdminAssetFeed(record.id);
      await Logger.api(
        isApimartMidjourneyV8 ? "apimart_request" : "reapi_request",
        `Image task ${record.id} submitted to ${isApimartMidjourneyV8 ? "APIMart" : "reAPI"} Midjourney V8.2`,
        "success",
        Date.now() - startTime,
        {
          model,
          providerModel,
          generationId: record.id,
          taskId: submitted.taskId,
          action: midjourneyAction,
          aspectRatio: params.aspectRatio,
          speed: params.speed,
          imageInputCount: uploadedUrls.length,
          outputCount: MIDJOURNEY_V8_OUTPUT_COUNT,
        },
        userId,
      );
      return { generationId: record.id, taskId: submitted.taskId, status: "running" };
    }

    if (isApimartImageModel) {
      if (!isApimartNanoBanana21 && !isApimartNanoBananaPro && uploadedUrls.length > 16) throw new Error("GPT-Image-2（优质VIP）最多支持 16 张参考图");
      const apimartAspectAllowed = new Set(isApimartNanoBanana21 ? NANO_BANANA_21_RATIOS : isApimartNanoBananaPro
        ? APIMART_NANO_BANANA_PRO_ASPECT_RATIO_VALUES
        : [
            "auto",
            "1:1",
            "3:2",
            "2:3",
            "4:3",
            "3:4",
            "5:4",
            "4:5",
            "16:9",
            "9:16",
            "2:1",
            "1:2",
            "3:1",
            "1:3",
            "21:9",
            "9:21",
          ]);
      const apimartResolutionAllowed = new Set(["1K", "2K", "4K"]);
      const apimartAspectRatio = apimartAspectAllowed.has(aspectRatio) ? aspectRatio : "1:1";
      const apimartResolution = apimartResolutionAllowed.has(resolution) ? resolution : "1K";
      const apimartMaskUrl =
        !isSeedream55 && !isApimartNanoBanana21 && !isApimartNanoBananaPro && !gptImage25Request && uploadedUrls.length && input.maskUrl
          ? await mapImagePathToPublicUrl(input.maskUrl, "apimart-image-inputs", mediaDeliveryTarget)
          : "";
      const submitted = isSeedream55
        ? await apimartSubmitSeedream55({ ...input.seedream55, prompt: input.seedream55?.layerDecomposition ? rawPrompt : prompt, aspectRatio, resolution, customSize: input.customSize, background: input.background, outputFormat: "png", imageUrls: uploadedUrls })
        : isApimartNanoBanana21
        ? await apimartSubmitNanoBanana21({ prompt, aspectRatio, resolution, imageUrls: uploadedUrls })
        : gptImage25Request
        ? await apimartSubmitGptImageVariant({ model, prompt, mode: gptImage25Mode, quality: gptImage25Request.quality, aspectRatio, resolution, imageUrls: uploadedUrls, ...gptImage25Output })
        : isApimartNanoBananaPro
        ? await apimartSubmitNanoBananaPro({
            prompt,
            aspectRatio: apimartAspectRatio,
            resolution: apimartResolution,
            imageUrls: uploadedUrls,
          })
        : await apimartSubmitImage({
            prompt,
            aspectRatio: apimartAspectRatio,
            resolution: apimartResolution,
            imageUrls: uploadedUrls,
            maskUrl: apimartMaskUrl,
            quality: officialQualityTemplate,
            background: input.background,
            moderation: input.moderation,
            outputFormat: officialOutputFormatTemplate,
            outputCompression,
            n: officialNumImagesTemplate,
          });
      await prisma.generation.update({
        where: { id: record.id },
        data: {
          externalTaskId: submitted.taskId,
          errorMsg: null,
          templateData: JSON.stringify({
            ...(JSON.parse(record.templateData || "{}") as Record<string, any>),
            apimart: {
              ...(apimartSnapshot || {}),
              taskId: submitted.taskId,
              request: submitted.request,
            },
            providerStatus: "submitted",
          }),
        },
      });
      void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
      syncAdminAssetFeed(record.id);

      await Logger.api(
        "apimart_request",
        `Image edit task ${record.id} submitted to APIMart`,
        "success",
        Date.now() - startTime,
        {
          model,
          providerModel,
          generationId: record.id,
          taskId: submitted.taskId,
          aspectRatio: apimartAspectRatio,
          resolution: apimartResolution,
          imageInputCount: uploadedUrls.length,
          outputCount: isApimartNanoBanana21 || isApimartNanoBananaPro || gptImage25Request ? 1 : officialNumImagesTemplate,
        },
        userId
      );
      return { generationId: record.id, taskId: submitted.taskId, status: "running" };
    }

    if (isVolcSeedream55) {
      const request = buildVolcSeedream55Request({ ...input.seedream55, prompt: input.seedream55?.layerDecomposition ? rawPrompt : prompt, aspectRatio, resolution, customSize: input.customSize, background: input.background, imageUrls: uploadedUrls });
      const templateData = JSON.stringify({ ...JSON.parse(record.templateData || "{}"), volcengine: { endpoint: "/api/v3/images/generations", request }, imageInputCount: uploadedUrls.length });
      await prisma.generation.update({ where: { id: record.id }, data: { externalTaskId: String(record.id), templateData, errorMsg: null } });
      syncAdminAssetFeed(record.id);
      void (async () => {
        try {
          const generated = await volcSeedreamGenerate(request, { exactModel: true });
          const outputs = readVolcSeedream55Outputs(generated.raw);
          if (!outputs.length) throw new Error("Seedream 5.5 未返回可保存的图片");
          const savedTemplate = { ...JSON.parse(templateData), providerUsage: generated.raw?.usage, seedream55Outputs: outputs.map(({ url, ...metadata }) => metadata) };
          await preserveAgentImages(outputs.map(output => output.url), "volcengine", savedTemplate);
        } catch (error) {
          if (error instanceof AgentOutputSavePendingError) return;
          const friendly = toFriendlyError(providerFailureText(error, "Seedream 5.5 生成失败"));
          await prisma.generation.update({ where: { id: record.id }, data: { status: "failed", errorMsg: formatFriendlyMessageForStorage(friendly), finishedAt: new Date() } });
          void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
          syncAdminAssetFeed(record.id);
        }
      })();
      return { generationId: record.id, taskId: String(record.id), status: "running" };
    }

    if (isSeedreamModel) {
      const imageInput = uploadedUrls.length <= 1 ? uploadedUrls[0] || undefined : uploadedUrls;
      const seedreamRequest = {
        model: seedreamModelId,
        prompt: seedreamPrompt,
        ...(imageInput ? { image: imageInput } : {}),
        size: mapSeedreamSize(aspectRatio || "1:1", effectiveSeedreamResolution || "2K", model),
        ...(isSeedreamLite && seedreamWebSearch ? { tools: [{ type: "web_search" as const }] } : {}),
        ...(isSeedream5 ? { output_format: "png" as const } : {}),
        response_format: "url",
        watermark: false,
        ...(!isSeedreamPro ? { stream: false } : {}),
      } as const;
      await prisma.generation.update({
        where: { id: record.id },
        data: { externalTaskId: String(record.id), errorMsg: null },
      });
      void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
      syncAdminAssetFeed(record.id);

      void (async () => {
        try {
          const generate = input.exactProviderModel ? (body: Parameters<typeof volcSeedreamGenerate>[0]) => volcSeedreamGenerate(body, { exactModel: true }) : volcSeedreamGenerate;
          const seedream = await generate({
            ...seedreamRequest,
            ...(isSeedreamPro
              ? {}
              : seedreamSequential === "auto"
              ? {
                  sequential_image_generation: "auto" as const,
                  sequential_image_generation_options: { max_images: seedreamOutputCount },
                }
              : {
                  sequential_image_generation: "disabled" as const,
                }),
          });
          if (input.agentOutputContract) { await preserveAgentImages(seedream.urls, "volcengine", JSON.parse(record.templateData || "{}")); return; }
          const usableUrls = dedupeOutputImages(
            await dedupeImageUrlsByContent(seedream.urls, "volcengine"),
          ).slice(0, Math.max(1, seedreamOutputCount));
          const first = cleanString(usableUrls[0]);
          if (!first) throw new Error("Doubao-Seedream未返回可用结果");
          const localPath = await saveRemoteFile(
            first,
            outputFolder,
            false,
            { providerId: "volcengine" },
          );
          if (usableUrls.length > 1) {
            for (let i = 1; i < usableUrls.length; i++) {
              const u = cleanString(usableUrls[i]);
              if (!u) continue;
              const extraRecordId = await createExtraImageGenerationRecordIfMissing({
                groupId: String(record.id),
                outputIndex: i,
                rawImage: u,
                allowBase64: false,
                userId,
                authUserId,
                source,
                prompt,
                templateData: record.templateData,
                model,
                externalProvider: "volcengine",
              });
              if (extraRecordId) {
                void upsertUsageLedgerForGenerationId(extraRecordId).catch(() => null);
                syncAdminAssetFeed(extraRecordId);
              }
            }
          }
          await prisma.generation.update({
            where: { id: record.id },
            data: {
              status: "success",
              localPath,
              errorMsg: null,
              finishedAt: new Date(),
            },
          });
          void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
          syncAdminAssetFeed(record.id);
          await Logger.api(
            "volcengine_request",
            `图片编辑任务 ${record.id} 已提交到 Volcengine 并完成`,
            "success",
            Date.now() - startTime,
            {
              model,
              generationId: record.id,
              imageInputCount,
              outputMode: seedreamOutputMode,
              outputCount: seedreamOutputCount,
              returnedCount: usableUrls.length,
            },
            userId
          );
        } catch (e: any) {
          if (e instanceof AgentOutputSavePendingError) return;
          const rawMsg = providerFailureText(e, "生成失败");
          const friendly = toFriendlyError(rawMsg);
          await logUnknownFriendlyImageError(friendly, record.id, userId, model, inferErrorStatus(rawMsg));
          const storageMsg = formatFriendlyMessageForStorage(friendly);
          await prisma.generation.update({
            where: { id: record.id },
            data: { status: "failed", errorMsg: storageMsg, finishedAt: new Date() },
          });
          void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
          syncAdminAssetFeed(record.id);
          await Logger.generation(
            "task_failed",
            `图片编辑任务 ${record.id} 在 Volcengine 失败: ${rawMsg}`,
            "error",
            record.id,
            {
              error: e?.message,
              stack: e?.stack,
              duration: Date.now() - startTime,
            },
            userId
          );
        }
      })();

      await Logger.api(
        "volcengine_request",
        `图片编辑任务 ${record.id} 已提交到 Volcengine`,
        "success",
        Date.now() - startTime,
        {
          model,
          generationId: record.id,
          imageInputCount,
          outputMode: seedreamOutputMode,
          outputCount: seedreamOutputCount,
        },
        userId
      );
      return { generationId: record.id, taskId: String(record.id), status: "running" };
    }

    if (isNanoBanana2Lite) {
      const kieInput = buildNanoBanana2LiteKieInput({ prompt, imageUrls: uploadedUrls, aspectRatio });
      const created = await kieCreateTask({ model, input: kieInput });
      taskId = created.taskId;
    } else if (isNanoBananaEdit) {
      const kieInput: any = { prompt, image_urls: uploadedUrls, output_format: "png" };
      if (aspectRatio && aspectRatio !== "auto") kieInput.image_size = aspectRatio;
      const created = await kieCreateTask({ model, input: kieInput });
      taskId = created.taskId;
    } else if (isKieNanoBanana21) {
      const request = buildKieNanoBanana21Request({ prompt, aspectRatio, resolution, imageUrls: uploadedUrls });
      await prisma.generation.update({ where: { id: record.id }, data: { templateData: JSON.stringify({ ...JSON.parse(record.templateData || "{}"), kie: { request } }) } });
      const created = await kieCreateTask(request);
      taskId = created.taskId;
    } else if (isGptImage2Model) {
      const { aspectRatio: gptAspectRatio, resolution: gptResolution } = normalizeKieGptImage2Size({ model: gptImage2ResolvedModel, aspectRatio, resolution });
      if (isGptImage2Edit && uploadedUrls.length > 16) throw new Error("GPT-Image-2编辑图最多支持16张参考图");
      const kieInput: any = {
        prompt,
        aspect_ratio: gptAspectRatio,
        resolution: gptResolution,
        nsfw_checker: false,
      };
      if (isGptImage2Edit) kieInput.input_urls = uploadedUrls;
      const body: any = { model: gptImage2ResolvedModel, input: kieInput };
      if (callbackUrl) body.callBackUrl = callbackUrl;
      const created = await kieCreateTask(body);
      taskId = created.taskId;
    } else {
      const kieInput: any = { prompt, image_input: uploadedUrls, output_format: "png" };
      if (aspectRatio) kieInput.aspect_ratio = aspectRatio;
      if (effectiveResolution) kieInput.resolution = effectiveResolution;
      const created = await kieCreateTask({ model, input: kieInput });
      taskId = created.taskId;
    }

    await prisma.generation.update({
      where: { id: record.id },
      data: { externalTaskId: taskId, errorMsg: null },
    });
    if (!isEasyRouterImage) void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    syncAdminAssetFeed(record.id);
    await Logger.api(
      "kie_request",
      `图片编辑任务 ${record.id} 已提交到 KIE`,
      "success",
      Date.now() - startTime,
      {
        taskId,
        model,
        generationId: record.id,
      },
      userId
    );

    return { generationId: record.id, taskId, status: "running" };
  } catch (e: any) {
    const rawMsg = providerFailureText(e, "生成失败");
    const friendly = toFriendlyError(rawMsg);
    await logUnknownFriendlyImageError(friendly, record.id, userId, model, inferErrorStatus(rawMsg));
    const storageMsg = formatFriendlyMessageForStorage(friendly);
    await prisma.generation.update({
      where: { id: record.id },
      data: { status: "failed", errorMsg: storageMsg, finishedAt: new Date() },
    });
    if (!isEasyRouterImage) void upsertUsageLedgerForGenerationId(record.id).catch(() => null);
    syncAdminAssetFeed(record.id);
    await Logger.generation(
      "task_failed",
      `图片编辑任务 ${record.id} 提交失败: ${rawMsg}`,
      "error",
      record.id,
      {
        error: e?.message,
        stack: e?.stack,
        duration: Date.now() - startTime,
      },
      userId
    );
    throw new ImageGenerationError({
      message: friendly.message,
      status: inferErrorStatus(rawMsg),
      friendlyError: friendly,
      generationId: record.id,
    });
  }
}

export async function createImageGeneration(input: CreateImageGenerationInput): Promise<CreateImageGenerationResult> {
  return runGenerationRequestIdempotently({
    requestKey: input.requestKey,
    execute: async () => { await reserveRuntimeGeneration(input.requestKey); return createImageGenerationOnce(input); },
    findExisting: findImageGenerationByRequestKey,
    mapExisting: imageResultFromExisting,
  });
}

export async function createImageGenerationBatch(input: CreateImageGenerationInput): Promise<CreateImageGenerationBatchResult> {
  let taskCount: number;
  try {
    taskCount = isMidjourneyV8Model(input.model)
      ? 1
      : normalizeImageTaskCount(input.taskCount ?? 1);
  } catch (error) {
    const friendly = toFriendlyError(error instanceof Error ? error.message : "数量不合法");
    throw new ImageGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  if (!cleanString(input.prompt) && !(isSeedream55Model(input.model) && input.seedream55?.layerDecomposition)) {
    const friendly = toFriendlyError("缺少提示词");
    throw new ImageGenerationError({ message: friendly.message, status: 400, friendlyError: friendly });
  }
  const batchId = cleanString(input.batchId) || `image_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const batchSubmittedAt = cleanString(input.batchSubmittedAt) || new Date().toISOString();
  const entries = await runImageTaskBatch(taskCount, (batchIndex) =>
    createImageGeneration({
      ...input,
      requestKey: deriveImageTaskRequestKey(input.requestKey, batchIndex),
      taskCount,
      batchId,
      batchIndex,
      batchSubmittedAt,
    }),
  );
  const tasks = entries.map<CreateImageGenerationBatchTaskResult>((entry) => {
    if ("value" in entry) {
      return { batchIndex: entry.batchIndex, ...entry.value };
    }
    const error = entry.error;
    const generationId = error instanceof ImageGenerationError ? error.generationId : undefined;
    return {
      batchIndex: entry.batchIndex,
      generationId,
      status: "failed",
      error: error instanceof Error ? error.message : "生成失败",
      errorStatus: error instanceof ImageGenerationError ? error.status : 500,
    };
  });

  return {
    batchId,
    taskCount,
    succeededCount: tasks.filter((task) => task.status !== "failed").length,
    failedCount: tasks.filter((task) => task.status === "failed").length,
    tasks,
  };
}

function parseJsonObjectField(value: FormDataEntryValue | null): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

export function createImageGenerationInputFromFormData(authUserId: number, formData: FormData): CreateImageGenerationInput {
  const imagePathsRaw = cleanString(formData.get("imagePaths"));
  const imagePathSingle = cleanString(formData.get("imagePath"));
  let imagePaths: string[] = [];
  if (imagePathsRaw) {
    try {
      const parsed = JSON.parse(imagePathsRaw);
      if (Array.isArray(parsed)) imagePaths = parsed.map((x) => cleanString(x)).filter(Boolean);
    } catch {
      imagePaths = [];
    }
  } else if (imagePathSingle) {
    imagePaths = [imagePathSingle];
  }

  const seedreamOutputModeRaw = cleanString(formData.get("seedreamOutputMode")).toLowerCase();
  const seedreamOutputCountRaw = Number.parseInt(cleanString(formData.get("seedreamOutputCount")), 10);
  const nRaw = Number.parseInt(cleanString(formData.get("n")), 10);
  const seedRaw = Number.parseInt(cleanString(formData.get("seed")), 10);
  const outputCompressionRaw = Number.parseInt(cleanString(formData.get("outputCompression") || formData.get("output_compression")), 10);
  const seedreamWebSearchRaw = cleanString(formData.get("seedreamWebSearch")).toLowerCase();
  const enableWebSearchRaw = cleanString(formData.get("enableWebSearch") || formData.get("enable_web_search")).toLowerCase();
  const taskCountRaw = cleanString(formData.get("taskCount"));
  const toolMediaIds = parseToolMediaIdsFromFormData(formData);
  const inputManifest = parseGenerationInputManifest(formData.get("inputManifest"));
  assertGenerationInputManifestMatches(inputManifest, toolMediaIds, imagePaths);
  if (!inputManifest && toolMediaIds.length && imagePaths.length) {
    throw new GenerationInputManifestError(
      "素材来源已混合但缺少顺序信息，请刷新页面后重新提交",
    );
  }

  return {
    authUserId,
    requestKey: normalizeImageSubmissionRequestKey(formData.get("requestKey")),
    prompt: cleanString(formData.get("prompt")),
    userPrompt: cleanString(formData.get("userPrompt")) || undefined,
    skill: normalizeGenerationSkillSnapshot(formData.get("skill")) || undefined,
    aspectRatio: cleanString(formData.get("aspectRatio")),
    speed: cleanString(formData.get("speed")),
    midjourneyOptions: parseJsonObjectField(formData.get("midjourneyOptions")),
    resolution: cleanString(formData.get("resolution")),
    customSize: cleanString(formData.get("customSize")),
    source: cleanString(formData.get("source")) === "agent" ? "agent" : "tool",
    callBackUrl: cleanString(formData.get("callBackUrl")),
    model: cleanString(formData.get("model")),
    imagePaths,
    toolMediaIds,
    inputManifest: inputManifest || undefined,
    quality: cleanString(formData.get("quality")),
    gptImage25Mode: cleanString(formData.get("gptImage25Mode")),
    background: cleanString(formData.get("background")),
    googleThinkingLevel: cleanString(formData.get("googleThinkingLevel")),
    googleSearchMode: cleanString(formData.get("googleSearchMode")),
    moderation: cleanString(formData.get("moderation")),
    outputFormat: cleanString(formData.get("outputFormat") || formData.get("output_format")),
    gifSize: cleanString(formData.get("gifSize")) || undefined,
    frameCount: formData.get("frameCount") ? Number(formData.get("frameCount")) : undefined,
    seedream55: parseJsonObjectField(formData.get("seedream55")) as Seedream55Settings | undefined,
    frameDurationMs: formData.get("frameDurationMs") ? Number(formData.get("frameDurationMs")) : undefined,
    outputCompression: Number.isFinite(outputCompressionRaw) ? outputCompressionRaw : undefined,
    n: Number.isFinite(nRaw) ? nRaw : undefined,
    seed: Number.isFinite(seedRaw) ? seedRaw : undefined,
    enableWebSearch: enableWebSearchRaw === "on" || enableWebSearchRaw === "true" || enableWebSearchRaw === "1",
    maskUrl: cleanString(formData.get("maskUrl") || formData.get("mask_url")),
    seedreamOutputMode: seedreamOutputModeRaw === "group" ? "group" : "single",
    seedreamOutputCount: Number.isFinite(seedreamOutputCountRaw) ? seedreamOutputCountRaw : undefined,
    seedreamWebSearch: seedreamWebSearchRaw === "on" || seedreamWebSearchRaw === "true" || seedreamWebSearchRaw === "1",
    taskCount: taskCountRaw ? Number(taskCountRaw) : undefined,
    batchId: cleanString(formData.get("batchId")),
    batchSubmittedAt: cleanString(formData.get("batchSubmittedAt")),
  };
}
