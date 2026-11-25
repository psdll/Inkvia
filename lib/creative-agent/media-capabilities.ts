import { isSeedream55Model } from "@/lib/volcengine-seedream-55";
import { normalizeKieGptImage2Size } from "@/lib/generation/image-route-identity";
import { z } from "zod";
import { getImageModelParams, type ImageModelParams } from "@/lib/generation/image-model-params";
import { getVideoReferenceLimits, type Sora2ModelSpec } from "@/lib/sora2";
import { createImageTaskSchema } from "@/lib/generation/task-input-schema";
import { normalizeVideoCombination, validateVideoResolvedInputs } from "@/lib/generation/video-input-capabilities";
import type { MediaFacts } from "./media-files";
import type { EffectiveMediaIdentity } from "./effective-media-catalog";
import { CreativeAgentError } from "./errors";
const id = z.string().min(1).max(256);
export const refSchema = z.object({ nodeId: id, semanticHash: z.string().regex(/^[a-f0-9]{64}$/), batchId: id.optional(), outputId: id.optional(), mediaId: id.optional(), generationId: z.number().int().positive().optional() }).strict();
const common = { model: id, prompt: z.string().trim().min(1).max(20000), references: z.array(refSchema).max(16).default([]) };
export const imageSchema = z.object({ ...common, prompt: z.string().trim().max(20000), params: z.object({ customSize: id.optional(), seedream55: z.object({ layerDecomposition: z.boolean().optional(), layerMaxImages: z.number().int().min(2).max(100).optional(), textRecognition: z.boolean().optional() }).strict().optional(), count: z.number().int().min(1).max(4).default(1), aspectRatio: id.optional(), resolution: id.optional(), quality: z.string().max(64).optional(), background: id.optional(), outputFormat: z.enum(["png", "gif"]).describe("GIF 动图仅支持 APIMart/OpenRouter 的 GPT-Image-2.6，必须显式选择 gif").optional(), gifSize: id.optional(), frameCount: z.number().int().optional(), frameDurationMs: z.number().int().optional(), gptImage25Mode: z.enum(["flare", "sunburst"]).optional() }).strict().default({ count: 1 }) }).strict();
export const videoSchema = z.object({ ...common, params: z.object({ inputMode: z.enum(["text_to_video", "first_frame", "first_last_frame", "multimodal"]), ratio: id.optional(), resolution: id.optional(), duration: z.number().finite().int().optional(), generateAudio: z.boolean().optional(), cameraFixed: z.boolean().optional(), watermark: z.boolean().optional(), omniReferenceTaskType: z.enum(["auto", "edit", "extend"]).optional(), outputFormat: z.enum(["mp4", "mov"]).optional(), seed: z.number().int().min(0).max(2147483647).optional() }).strict() }).strict();
export type CreativeAgentMediaReference = z.infer<typeof refSchema>;
export type ResolvedReference = CreativeAgentMediaReference & { kind: "image" | "video" | "audio"; url: string; facts?: MediaFacts };
export type MediaCatalog = { image: ({ id: string; label: string; params: ImageModelParams } & Partial<EffectiveMediaIdentity>)[]; video: (Pick<Sora2ModelSpec, "id" | "label" | "supportedInputModes" | "supportedResolutions" | "minDurationSeconds" | "maxDurationSeconds" | "supportsGenerateAudio"> & Partial<Sora2ModelSpec> & Partial<EffectiveMediaIdentity>)[] };

function option(value: string, options: { value: string; disabled?: boolean }[]) { return options.some(item => item.value === value && !item.disabled); }
function invalid(...requirementFields: string[]): never { throw Object.assign(new CreativeAgentError("MEDIA_PARAMS_INVALID", "该模型不支持这组生成参数", 400), { requirementFields }); }
export function normalizeCreativeMediaRequest(kind: string, raw: unknown, references: ResolvedReference[], catalog: MediaCatalog, strict = false) {
 const args = kind === "image.generate" ? imageSchema.parse(raw) : kind === "video.generate" ? videoSchema.parse(raw) : invalid();
 if (strict && references.some(reference => reference.facts?.state !== "verified")) throw new CreativeAgentError("REFERENCE_NOT_VERIFIED", "引用素材缺少已验证的真实媒体事实", 400);
 let params: Record<string, unknown>, units: number;
 if (kind === "image.generate") {
  const entry = catalog.image.find(model => model.id === args.model);
  const config = entry?.params;
  if (!config) throw new CreativeAgentError("MEDIA_MODEL_UNAVAILABLE", "图片模型尚未开放或未配置", 400);
  const requested = (args as z.infer<typeof imageSchema>).params;
  if (!args.prompt && !(isSeedream55Model(args.model) && requested.seedream55?.layerDecomposition)) invalid("prompt");
  params = { customSize: requested.customSize, seedream55: requested.seedream55, outputFormat: requested.outputFormat, gifSize: requested.gifSize, frameCount: requested.frameCount, frameDurationMs: requested.frameDurationMs, count: requested.count, aspectRatio: requested.aspectRatio ?? config.defaultAspectRatio, resolution: requested.resolution ?? config.defaultResolution, quality: requested.quality ?? config.defaultQuality, ...(requested.background ? { background: requested.background } : {}), ...(requested.gptImage25Mode ? { gptImage25Mode: requested.gptImage25Mode } : {}) };
  if (entry?.qualification && !entry.qualification.available) throw new CreativeAgentError("MEDIA_MODEL_UNAVAILABLE", entry.qualification.reasons.join(", "), 400);
  if (strict && requested.gptImage25Mode && !entry?.variants) invalid();
  if (entry?.variants) {
   const mode = requested.gptImage25Mode ?? (strict ? entry.variants[0]?.mode : "flare");
   if (!mode || !entry.variants.some(variant => variant.mode === mode)) invalid();
   if (strict || requested.gptImage25Mode) params.gptImage25Mode = mode;
  }
  if (strict) {
   const normalized = normalizeKieGptImage2Size({ model: args.model, aspectRatio: String(params.aspectRatio), resolution: String(params.resolution) });
   for (const key of ["aspectRatio", "resolution"] as const) {
    if (requested[key] !== undefined && normalized[key] !== requested[key]) throw Object.assign(new CreativeAgentError("NORMALIZATION_CONFLICT", key + " 与实际执行尺寸规则冲突", 400), { requirementFields: [`image.params.${key}`] });
    params[key] = normalized[key];
   }
  }
  const linked = getImageModelParams(args.model, String(params.resolution), String(params.aspectRatio));
  if ("maxReferences" in linked && typeof linked.maxReferences === "number" && references.length > linked.maxReferences) invalid();
  if (!option(String(params.aspectRatio), config.aspectRatios) || !option(String(params.aspectRatio), linked.aspectRatios)) invalid("image.params.aspectRatio");
  if (!option(String(params.resolution), config.resolutions) || !option(String(params.resolution), linked.resolutions)) invalid("image.params.resolution");
  if (params.quality !== "" && !option(String(params.quality), config.qualities)) invalid("image.params.quality");
  if (requested.background && !option(requested.background, config.backgrounds || [])) invalid("image.params.background");
  if (references.some(ref => ref.kind !== "image")) invalid("references.image");
  // Reuse input capability rules without narrowing this tool's 20k prompt limit
  // to the legacy tool's 4k text limit. The actual prompt remains unchanged.
  if (!createImageTaskSchema.safeParse({ ...params, quality: params.quality || undefined, model: args.model, prompt: "输入能力校验", imagePaths: references.map(ref => ref.url) }).success) invalid();
  units = requested.count;
 } else {
  const config = catalog.video.find(model => model.id === args.model);
  if (!config) throw new CreativeAgentError("MEDIA_MODEL_UNAVAILABLE", "视频模型尚未开放或未配置", 400);
  if (config.qualification && !config.qualification.available) throw new CreativeAgentError("MEDIA_MODEL_UNAVAILABLE", config.qualification.reasons.join(", "), 400);
  const requested = (args as z.infer<typeof videoSchema>).params;
  params = { ...requested, resolution: requested.resolution ?? config.supportedResolutions[0], duration: requested.duration ?? config.minDurationSeconds, ratio: requested.ratio ?? (strict && requested.inputMode === "text_to_video" ? config.supportedRatios?.find(ratio => ratio !== "adaptive") : config.supportedRatios?.[0]) ?? "16:9", generateAudio: requested.generateAudio ?? false, cameraFixed: requested.cameraFixed ?? false, watermark: requested.watermark ?? false };
  if (strict) {
   const normalized = normalizeVideoCombination({ model: args.model, ...params } as { model: string; ratio?: string; duration?: number; inputMode?: string }, references);
   for (const key of ["ratio", "duration"] as const) if (requested[key] !== undefined && normalized[key] !== requested[key]) throw Object.assign(new CreativeAgentError("NORMALIZATION_CONFLICT", key + " 与该输入组合的实际执行规则冲突", 400), { requirementFields: [`video.params.${key}`] });
   const { model: _model, ...normalizedParams } = normalized;
   params = normalizedParams;
  }
  const duration = Number(params.duration);
  if (!config.supportedInputModes.includes(requested.inputMode)) invalid("video.params");
  if (!config.supportedResolutions.includes(String(params.resolution) as never)) invalid("video.params.resolution");
  if (duration === -1 ? !config.allowAutoDuration : duration < config.minDurationSeconds || duration > config.maxDurationSeconds || (config.durationOptions && !config.durationOptions.includes(duration))) invalid("video.params.duration");
  if (!(config.supportedRatios || ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]).includes(String(params.ratio))) invalid("video.params.ratio");
  if (requested.generateAudio && !config.supportsGenerateAudio) invalid("video.params.generateAudio");
  const images = references.filter(ref => ref.kind === "image").length;
  if ((requested.inputMode === "text_to_video" && references.length) || (requested.inputMode === "first_frame" && (references.length !== 1 || images !== 1))
    || (requested.inputMode === "first_last_frame" && (references.length !== 2 || images !== 2))) invalid();
  if (requested.inputMode === "multimodal") {
   const limits = config.referenceLimits || getVideoReferenceLimits(args.model);
   if (!limits ? !strict : (references.length > 0 && images === 0 && !references.some(ref => ref.kind === "video") && !limits.standaloneAudio) || references.length > limits.total || images > limits.images || references.filter(ref => ref.kind === "video").length > limits.videos || references.filter(ref => ref.kind === "audio").length > limits.audios) invalid();
  }
  if (strict) {
   validateVideoResolvedInputs({ model: args.model, inputMode: requested.inputMode, ratio: String(params.ratio), duration: Number(params.duration), omniReferenceTaskType: requested.omniReferenceTaskType, outputFormat: requested.outputFormat, cameraFixed: requested.cameraFixed, seed: requested.seed, watermark: requested.watermark,
    inputs: references.map((reference, position) => ({ kind: reference.kind, position, localPath: reference.url, mediaId: reference.mediaId || reference.nodeId, fileName: reference.url.split("/").pop() || reference.nodeId, byteSize: reference.facts?.sizeBytes,
     probe: reference.facts?.state === "verified" ? { ...reference.facts, version: 1 as const, kind: reference.kind, detectedMime: reference.facts.detectedMime || "" } : undefined })) }, message => { throw new CreativeAgentError("MEDIA_PARAMS_INVALID", message, 400); });
  }
  units = 1;
 }
 return { args: { ...args, params }, params, references, units };
}
