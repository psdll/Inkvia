import { isSeedream55Model, VOLC_SEEDREAM_55_MODEL, buildVolcSeedream55Request } from "@/lib/volcengine-seedream-55";
import { buildApimartSeedream55Request } from "@/lib/apimart-seedream-55";
import { isProviderNanoBanana21, validateProviderNanoBanana21 } from "@/lib/nano-banana-21-providers";
import { validateGoogleImageSettings } from "@/lib/google-image-settings";
import { GOOGLE_NANO_BANANA_21_MODEL, validateGoogleNanoBanana21Input } from "@/lib/google-nano-banana-21";
import { supportsOpenRouterGptAdvancedSettings } from "@/lib/openrouter-image-params";
import { isQwenImage3Model } from "@/lib/qwen-image-3-models";
import { z } from "zod";
import { buildGptImage26GifParams } from "@/lib/gpt-image-26-animation";
import { isGptImageVariantModel } from "@/lib/gpt-image-25-models";
import {
  getVideoModelSpec,
  normalizeVideoModelId,
  normalizeVideoInputMode,
  isSeedance25VideoModel,
} from "@/lib/sora2";
import { isMiniMaxH3VideoModel } from "@/lib/minimax-models";
import { isWanVideoModel } from "@/lib/wan-models";
import { isGptImage2OfficialProviderModel } from "@/lib/gpt-image-2-official";
import { isQwenImage21Model } from "@/lib/work-fisher-image-params";
import { isTuziGptImage2Model } from "@/lib/tuzi-image-params";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/image-edit-models";
import { APIMART_NANO_BANANA_PRO_MODEL_ID } from "@/lib/apimart-image-models";
export const IMAGE_TOOL_MODELS = Array.from(new Set([
  ...IMAGE_EDIT_MODEL_DEFINITIONS.map((model) => model.id),
  APIMART_NANO_BANANA_PRO_MODEL_ID,
  "gpt-image-2-text-to-image",
  "gpt-image-2-image-to-image",
]));

const nonEmptyString = z.string().trim().min(1);
const promptSchema = z.string().trim().min(1).max(4000);
const videoPromptSchema = z.string().trim().min(1).max(20000);
const mediaPathSchema = z.string().trim().min(1).max(2000);

function isSeedreamImageModel(model: string | undefined) {
  return String(model || "").startsWith("doubao-seedream-");
}

function isSeedreamProModel(model: string | undefined) {
  return String(model || "") === "doubao-seedream-5.0-pro";
}

function isGptImageModel(model: string | undefined) {
  const v = String(model || "");
  return v.startsWith("gpt-image-2");
}

function isNanoBanana2LiteModel(model: string | undefined) {
  const v = String(model || "");
  return v === "nano-banana-2-lite" || v === "gemini-3.1-flash-lite-image";
}

export const createImageTaskSchema = z
  .object({
    prompt: z.string().trim().max(4000),
    model: z.string().trim().min(1).max(160).optional(),
    aspectRatio: nonEmptyString.max(20).optional(),
    resolution: z.enum(["auto", "512", "1K", "1.5K", "2K", "3K", "4K", "480p", "720p", "1080p"]).optional(),
    customSize: z.string().trim().max(20).optional(),
    imagePaths: z.array(mediaPathSchema).max(16).default([]),
    count: z.coerce.number().int().min(1).max(10).default(1),
    quality: z.enum(["standard", "pro", "auto", "low", "medium", "high", "xhigh", "max"]).optional(),
    gptImage25Mode: z.enum(["flare", "sunburst"]).optional(),
    googleThinkingLevel: z.enum(["minimal", "medium", "high"]).optional(),
    googleSearchMode: z.enum(["off", "web", "image", "web_image"]).optional(),
    background: z.enum(["auto", "opaque", "transparent"]).optional(),
    moderation: z.enum(["auto", "low"]).optional(),
    outputFormat: z.enum(["png", "jpeg", "webp", "gif"]).optional(),
    seedream55: z.object({ layerDecomposition: z.boolean().optional(), layerMaxImages: z.number().int().min(2).max(100).optional(), textRecognition: z.boolean().optional() }).strict().optional(),
    gifSize: z.string().trim().max(20).optional(),
    frameCount: z.number().int().optional(),
    frameDurationMs: z.number().int().optional(),
    outputCompression: z.coerce.number().int().min(0).max(100).optional(),
    maskUrl: mediaPathSchema.optional(),
    seedreamOutputMode: z.enum(["single", "group"]).optional(),
    seedreamOutputCount: z.coerce.number().int().min(1).max(14).optional(),
    seedreamWebSearch: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (isSeedream55Model(value.model)) {
      try { (value.model === VOLC_SEEDREAM_55_MODEL ? buildVolcSeedream55Request : buildApimartSeedream55Request)({ ...value, ...value.seedream55, imageUrls: value.imagePaths }); }
      catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message }); }
    } else if (!value.prompt) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["prompt"], message: "请输入提示词" });

    try { buildGptImage26GifParams(value); }
    catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["outputFormat"], message: (error as Error).message }); }
    if (isQwenImage3Model(value.model)) {
      if (value.quality && !["standard", "pro"].includes(value.quality)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quality"], message: "Qwen-Image-3.0 图片质量仅支持标准、Pro" });
      if (value.imagePaths.length > 3) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["imagePaths"], message: "Qwen-Image-3.0 最多支持 3 张参考图" });
      if (value.resolution && !["1K", "2K"].includes(value.resolution)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["resolution"], message: "Qwen-Image-3.0 清晰度仅支持 1K、2K" });
    } else if (value.quality === "standard" || value.quality === "pro") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quality"], message: "标准/Pro 参数仅用于 Qwen-Image-3.0" });
    if (!isGptImageVariantModel(value.model) && !supportsOpenRouterGptAdvancedSettings(value.model) && (value.quality === "xhigh" || value.quality === "max")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quality"], message: "请选择当前模型提供的画质选项" });
    }
    if (!isGptImage2OfficialProviderModel(value.model) && !isTuziGptImage2Model(value.model) && value.count > 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["count"],
        message: "Only GPT-Image-2 reAPI/AIComing/TuZi models support up to 10 project tasks",
      });
    }
    try { validateGoogleImageSettings(value.model || "", value); } catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message }); }
    if (isProviderNanoBanana21(value.model || "")) {
      try { validateProviderNanoBanana21(value.model!, { ...value, referenceCount: value.imagePaths.length }); }
      catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message }); }
    }
    if (value.model === GOOGLE_NANO_BANANA_21_MODEL) {
      try { validateGoogleNanoBanana21Input({ ...value, referenceCount: value.imagePaths.length }); }
      catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message }); }
    }
    if (isQwenImage21Model(value.model) && value.imagePaths.length > 10) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["imagePaths"], message: "Qwen-Image-Global-2.1 最多支持 10 张参考图" });
    if (isSeedreamProModel(value.model) && value.imagePaths.length > 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imagePaths"],
        message: "Seedream 5.0 Pro accepts at most 10 reference images",
      });
    }
    if (isSeedreamImageModel(value.model) && value.imagePaths.length > 14) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imagePaths"],
        message: "Seedream image models accept at most 14 reference images",
      });
    }
    if (isGptImageModel(value.model) && value.imagePaths.length > 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imagePaths"],
        message: "GPT image models accept at most 16 reference images",
      });
    }
    if (isNanoBanana2LiteModel(value.model) && value.imagePaths.length > 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imagePaths"],
        message: "Nano Banana 2 Lite image models accept at most 10 reference images",
      });
    }
    if (value.model === APIMART_NANO_BANANA_PRO_MODEL_ID && value.imagePaths.length > 14) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imagePaths"],
        message: "Nano Banana Pro（am）最多支持 14 张参考图",
      });
    }
    if (value.model === "image 2" && value.imagePaths.length > 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imagePaths"],
        message: "EasyRouter Image 2 accepts at most 16 reference images",
      });
    }
    if (isSeedreamProModel(value.model) && value.seedreamOutputMode === "group") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["seedreamOutputMode"],
        message: "Seedream 5.0 Pro does not support group image generation",
      });
    }
    if (isSeedreamProModel(value.model) && value.seedreamWebSearch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["seedreamWebSearch"],
        message: "Seedream 5.0 Pro does not support web search",
      });
    }
    if (value.seedreamOutputMode === "group") {
      const requested = value.seedreamOutputCount ?? value.count;
      const maxOutput = Math.max(1, 15 - value.imagePaths.length);
      if (requested > maxOutput) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["seedreamOutputCount"],
          message: `Seedream group output count cannot exceed ${maxOutput} with current references`,
        });
      }
    }
  });

export const createVideoTaskSchema = z
  .object({
    prompt: videoPromptSchema,
    model: z
      .string()
      .trim()
      .optional()
      .transform((value) => normalizeVideoModelId(value || "")),
    inputMode: z
      .enum(["text_to_video", "first_frame", "first_last_frame", "multimodal"])
      .optional(),
    mediaPaths: z.array(mediaPathSchema).max(50).default([]),
    ratio: z.enum(["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]).optional(),
    resolution: z.enum(["480p", "720p", "1080p", "768p", "2k"]).optional(),
    duration: z.coerce.number().int().min(-1).max(30).optional(),
    seed: z.coerce.number().int().optional(),
    cameraFixed: z.boolean().default(false),
    watermark: z.boolean().default(false),
    returnLastFrame: z.boolean().optional(),
    generateAudio: z.boolean().default(false),
    webSearch: z.boolean().default(false),
    omniReferenceTaskType: z.enum(["auto", "edit", "extend"]).optional(),
    outputFormat: z.enum(["mp4", "mov"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.inputMode) return;
    const model = normalizeVideoModelId(value.model || "");
    const spec = getVideoModelSpec(model);
    if (!spec.supportedInputModes.includes(value.inputMode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputMode"],
        message: `${spec.label} does not support this input mode`,
      });
    }
  })
  .transform((value) => {
    const inputMode = value.inputMode
      ? normalizeVideoInputMode(value.model, value.inputMode)
      : value.mediaPaths.length
        ? normalizeVideoInputMode(value.model, "")
        : "text_to_video";
    const isMiniMaxH3 = isMiniMaxH3VideoModel(value.model);
    return {
      ...value,
      resolution: value.resolution || (isMiniMaxH3 ? "768p" : "720p"),
      inputMode,
      ratio: value.ratio || (isMiniMaxH3 && ["first_frame", "first_last_frame"].includes(inputMode)
        ? "adaptive"
        : "9:16"),
      returnLastFrame: value.returnLastFrame ?? (!isMiniMaxH3 && !isWanVideoModel(value.model)),
    };
  })
  .superRefine((value, ctx) => {
    const spec = getVideoModelSpec(value.model);
    const isMiniMaxH3 = isMiniMaxH3VideoModel(value.model);
    const maxMedia = value.model === "doubao-seedance-2-0-fast-260128"
      ? 12
      : spec.id === value.model && spec.referenceLimits
        ? spec.referenceLimits.total
        : 12;
    if (value.mediaPaths.length > maxMedia) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mediaPaths"],
        message: `${spec.label} accepts at most ${maxMedia} media paths`,
      });
    }
    if (
      value.ratio === "adaptive"
      && !isSeedance25VideoModel(value.model)
      && !isMiniMaxH3
      && !isWanVideoModel(value.model)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ratio"],
        message: "adaptive ratio is only exposed to Seedance 2.5 in the agent tool",
      });
    }
    if (value.prompt.length > (isWanVideoModel(value.model) ? 20_000 : isMiniMaxH3 ? 7_000 : 4_000)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prompt"],
        message: `${spec.label} prompt cannot exceed 4000 characters`,
      });
    }
    if (isMiniMaxH3) {
      if (!spec.supportedResolutions.includes(value.resolution)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["resolution"],
          message: `${spec.label} does not support this resolution`,
        });
      }
      if (value.inputMode === "text_to_video" && value.ratio === "adaptive") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ratio"],
          message: `${spec.label} text-to-video requires a concrete ratio`,
        });
      }
      if (["first_frame", "first_last_frame"].includes(value.inputMode) && value.ratio !== "adaptive") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ratio"],
          message: `${spec.label} frame modes require adaptive ratio`,
        });
      }
      if (value.returnLastFrame) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["returnLastFrame"],
          message: `${spec.label} does not support returning a tail frame`,
        });
      }
      if (value.generateAudio || value.webSearch || value.cameraFixed || (value.seed !== undefined && value.seed !== -1)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [value.generateAudio ? "generateAudio" : value.webSearch ? "webSearch" : value.cameraFixed ? "cameraFixed" : "seed"],
          message: `${spec.label} does not support this parameter`,
        });
      }
    }
    if (value.duration !== undefined) {
      const invalidAuto = value.duration === -1 && !spec.allowAutoDuration;
      const invalidRange = value.duration !== -1
        && (value.duration < spec.minDurationSeconds || value.duration > spec.maxDurationSeconds);
      if (invalidAuto || invalidRange) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["duration"],
          message: `${spec.label} does not support this duration`,
        });
      }
    }
    if ((value.omniReferenceTaskType || value.outputFormat) && !isSeedance25VideoModel(value.model)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [value.omniReferenceTaskType ? "omniReferenceTaskType" : "outputFormat"],
        message: "these options are only supported by Seedance 2.5",
      });
    }
    if (value.inputMode === "first_frame" && value.mediaPaths.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mediaPaths"],
        message: "first_frame mode requires at least 1 media path",
      });
    }
    if (value.inputMode === "first_last_frame" && value.mediaPaths.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mediaPaths"],
        message: "first_last_frame mode requires at least 2 media paths",
      });
    }
    if (value.inputMode === "multimodal" && value.mediaPaths.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mediaPaths"],
        message: "multimodal mode requires at least 1 media path",
      });
    }
  });

