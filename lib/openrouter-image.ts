import { OPENROUTER_NANO_BANANA_21_MODEL, validateProviderNanoBanana21 } from "@/lib/nano-banana-21-providers";
import sharp from "sharp";
import { resolveLocalUploadPath } from "@/lib/tool-media/media-probe";
import { getOpenRouterImageModel, getOpenRouterImageParams, mapOpenRouterGptImagePixels, mapOpenRouterReferencePixels } from "@/lib/openrouter-image-params";
import { buildGptImage25OutputParams } from "@/lib/gpt-image-25-models";
import { buildGptImage26GifParams, type GptImage26AnimationSettings } from "@/lib/gpt-image-26-animation";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import { fetchWithProviderEgress, resolveProviderRequestContext } from "@/lib/providers/transport";
import { providerErrorSensitiveValues, sanitizeProviderErrorText } from "@/lib/providers/error-safety";

export type OpenRouterImageInput = GptImage26AnimationSettings & {
  model: string; prompt: string; aspectRatio?: string; resolution?: string;
  quality?: string; background?: string; outputFormat?: string; imageUrls?: string[]; maskUrl?: string;
  firstReferenceDimensions?: { width: number; height: number };
};

export async function readOpenRouterReferenceDimensions(localPath: string) {
  const metadata = await sharp(resolveLocalUploadPath(localPath)).metadata();
  if (!metadata.width || !metadata.height) throw new Error("无法读取第一张参考图的尺寸，请重新上传");
  const rotated = metadata.orientation !== undefined && metadata.orientation >= 5;
  return { width: rotated ? metadata.height : metadata.width, height: rotated ? metadata.width : metadata.height };
}

export function buildOpenRouterImageRequest(input: OpenRouterImageInput) {
  const model = getOpenRouterImageModel(input.model);
  if (!model) throw new Error("未知的 OpenRouter 图片模型");
  const params = getOpenRouterImageParams(input.model, input.aspectRatio);
  const animation = buildGptImage26GifParams(input);
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("OpenRouter 缺少提示词");
  if (input.maskUrl) throw new Error("OpenRouter 图片接口不支持遮罩编辑");
  const images = input.imageUrls || [];
  if (input.model === OPENROUTER_NANO_BANANA_21_MODEL) validateProviderNanoBanana21(input.model, { ...input, referenceCount: images.length });
  if (images.length > params.maxReferences) throw new Error(`该 OpenRouter 模型最多支持 ${params.maxReferences} 张参考图`);
  if (images.some(url => !/^https?:\/\//i.test(url) && !/^data:image\/(png|jpeg|webp);base64,/i.test(url))) throw new Error("OpenRouter 参考图必须是 HTTP(S) 地址或图片 data URL");
  const pick = (value: string | undefined, options: { value: string }[], fallback: string) => options.some(item => item.value === value) ? value! : fallback;
  const gemini = model.upstreamModelId.startsWith("google/");
  const aspectRatio = pick(input.aspectRatio, params.aspectRatios, params.defaultAspectRatio);
  const resolution = pick(input.resolution, params.resolutions, params.defaultResolution);
  const referenceSize = !gemini && aspectRatio === "auto" && images.length && input.firstReferenceDimensions
    ? mapOpenRouterReferencePixels(input.firstReferenceDimensions.width, input.firstReferenceDimensions.height, resolution)
    : undefined;
  // Ignore stale background preferences for models without a background control.
  const background = params.backgrounds.length ? input.background?.trim().toLowerCase() || "auto" : undefined;
  if (background && !params.backgrounds.some(option => option.value === background)) throw new Error("该 OpenRouter 模型不支持所选背景");
  const output = animation || (gemini ? {} : buildGptImage25OutputParams({ background, outputFormat: input.outputFormat || "png" }));
  return {
    endpoint: "/images",
    settings: { aspectRatio, resolution },
    body: {
      model: model.upstreamModelId, prompt, n: 1,
      ...(animation ? {} : gemini ? (aspectRatio === "auto" ? {} : { aspect_ratio: aspectRatio }) : referenceSize ? { size: referenceSize } : aspectRatio === "auto" ? { aspect_ratio: "auto", resolution } : { size: mapOpenRouterGptImagePixels(aspectRatio, resolution) }),
      ...(gemini ? { resolution } : { quality: pick(input.quality, params.qualities, params.defaultQuality) }),
      ...output,
      ...(images.length ? { input_references: images.map(url => ({ type: "image_url", image_url: { url } })) } : {}),
      // Verified live: the default Pro route returned 1K for 2K; AI Studio honored 2K.
      ...(input.model === "gemini-3-pro-image-openrouter" && resolution !== "1K" ? { provider: { only: ["google-ai-studio/global"], allow_fallbacks: false } } : {}),
    },
  };
}

// Gemini Pro's native tiers are approximately 1/4/16 MP, across all ten ratios.
// Allow native dimension rounding, but never silently accept a different tier.
// https://aistudio.google.com/docs/image-generation#aspect-ratios-and-image-size
export async function validateOpenRouterImageOutputs(input: OpenRouterImageInput, images: string[]) {
  if (input.outputFormat === "gif") {
    return Promise.all(images.map(async image => {
      const metadata = await sharp(Buffer.from(image.replace(/^data:[^;]+;base64,/i, ""), "base64"), { animated: true }).metadata();
      if (metadata.format !== "gif" || !metadata.pages || metadata.pages < 2) throw new Error("OpenRouter 未返回多帧 GIF 动图；原始结果已保留，本次不会自动重试。");
      return { width: metadata.width!, height: metadata.pageHeight || metadata.height!, frameCount: metadata.pages };
    }));
  }
  if (input.model !== "gemini-3-pro-image-openrouter") return;
  const { resolution, aspectRatio } = buildOpenRouterImageRequest(input).settings;
  const pixels = ({ "1K": 1024 ** 2, "2K": 2048 ** 2, "4K": 4096 ** 2 } as Record<string, number>)[resolution];
  const dimensions: { width: number; height: number }[] = [];
  for (const image of images) {
    const metadata = await sharp(Buffer.from(image.replace(/^data:[^;]+;base64,/i, ""), "base64")).metadata();
    const rotated = metadata.orientation !== undefined && metadata.orientation >= 5;
    const width = rotated ? metadata.height : metadata.width;
    const height = rotated ? metadata.width : metadata.height;
    if (!width || !height) throw new Error("OpenRouter 返回的图片无法读取原始尺寸");
    if (Math.abs(width * height / pixels - 1) > 0.1)
      throw new Error(`OpenRouter 返回图片分辨率不符：请求 ${resolution}，实际 ${width}×${height}；请检查平台路由，本次不会自动重试。`);
    if (aspectRatio !== "auto") {
      const [rw, rh] = aspectRatio.split(":").map(Number);
      if (Math.abs(width / height / (rw / rh) - 1) > 0.02)
        throw new Error(`OpenRouter 返回图片比例不符：请求 ${aspectRatio}，实际 ${width}×${height}；本次不会自动重试。`);
    }
    dimensions.push({ width, height });
  }
  return dimensions;
}

export async function openRouterGenerateImage(input: OpenRouterImageInput) {
  const request = buildOpenRouterImageRequest(input);
  const context = await resolveProviderRequestContext("openrouter");
  const base = context.provider.baseUrl.trim().replace(/\/+$/, "");
  const apiKey = resolvedProviderApiKey(context.provider);
  const url = `${base}${request.endpoint}`;
  const sensitive = providerErrorSensitiveValues(context.decision, apiKey, base, url);
  try {
    // No retries: a lost response may already have incurred a charge.
    const response = await fetchWithProviderEgress(context.decision, url, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request.body), signal: AbortSignal.timeout(600000),
    });
    const raw = await response.json() as any;
    if (!response.ok || raw?.error) throw new Error(`OpenRouter 请求失败 (${response.status}): ${raw?.error?.message || "响应无效"}`);
    const images = (Array.isArray(raw?.data) ? raw.data : []).flatMap((item: any) => {
      const mime = item?.media_type || "image/png";
      return typeof item?.b64_json === "string" && item.b64_json && /^image\/(png|jpeg|webp|gif)$/.test(mime) ? [`data:${mime};base64,${item.b64_json}`] : [];
    });
    if (!images.length) throw new Error("OpenRouter 未返回可用图片");
    return { images: images as string[], usage: raw.usage ?? null };
  } catch (error) {
    throw new Error(sanitizeProviderErrorText(error instanceof Error ? error.message : String(error), sensitive, "OpenRouter 图片生成失败"));
  }
}
