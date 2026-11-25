// Contract: https://docs.apimart.ai/cn/api-reference/images/gpt-image-2.5/generation
export const APIMART_GPT_IMAGE_25_MODEL_ID = "gpt-image-2.5-apimart";
export const APIMART_GPT_IMAGE_25_LABEL = "GPT-Image-2.5（am）";
export const APIMART_GPT_IMAGE_25_UPSTREAM_MODELS = {
  flare: "gpt-image-2.5-flare",
  sunburst: "gpt-image-2.5-sunburst",
} as const;
export { GPT_IMAGE_25_MODE_OPTIONS, GPT_IMAGE_25_QUALITY_OPTIONS, GPT_IMAGE_25_RATIOS, normalizeGptImage25Mode, getGptImage25ModeLabel, type GptImage25Mode } from "@/lib/gpt-image-25-models";
import { buildGptImage25OutputParams, GPT_IMAGE_25_QUALITY_OPTIONS, GPT_IMAGE_25_RATIOS, normalizeGptImage25Mode } from "@/lib/gpt-image-25-models";
import { APIMART_GPT_IMAGE_26_MODEL_ID, APIMART_GPT_IMAGE_26_UPSTREAM_MODELS } from "@/lib/apimart-image-models";
import { buildGptImage26GifParams, type GptImage26AnimationSettings } from "@/lib/gpt-image-26-animation";

export function isApimartGptImageVariantModel(model: unknown) {
  return model === APIMART_GPT_IMAGE_25_MODEL_ID || model === APIMART_GPT_IMAGE_26_MODEL_ID;
}

export type ApimartGptImageVariantInput = GptImage26AnimationSettings & {
  model?: string;
  prompt: string;
  mode?: string;
  quality?: string;
  aspectRatio?: string;
  resolution?: string;
  imageUrls?: string[];
  background?: string;
  outputFormat?: string;
};

// Both versions use the same static-image contract.
// https://docs.apimart.ai/cn/api-reference/images/gpt-image-2.6/generation
export function buildApimartGptImageVariantRequest(input: ApimartGptImageVariantInput) {
  const is26 = input.model === APIMART_GPT_IMAGE_26_MODEL_ID;
  const name = is26 ? "GPT-Image-2.6" : "GPT-Image-2.5";
  const upstreamModels = is26 ? APIMART_GPT_IMAGE_26_UPSTREAM_MODELS : APIMART_GPT_IMAGE_25_UPSTREAM_MODELS;
  const prompt = input.prompt.trim();
  if (is26 && (!prompt || Array.from(prompt).length > 32_000)) {
    throw new Error(`${name} 提示词需为 1–32000 个字符`);
  }
  const mode = normalizeGptImage25Mode(input.mode, input.model);
  const animation = buildGptImage26GifParams(input);
  const quality = input.quality?.trim().toLowerCase() || "medium";
  if (quality !== "auto" && !GPT_IMAGE_25_QUALITY_OPTIONS.some((option) => option.value === quality)) {
    throw new Error(`${name} 画质无效，请选择低、标准、高、超高或极致`);
  }
  const resolution = input.resolution?.trim().toLowerCase() || "1k";
  if (!["1k", "2k", "4k"].includes(resolution)) throw new Error(`${name} 仅支持 1K、2K、4K 分辨率`);
  const ratio = input.aspectRatio?.trim() || "auto";
  if (!(GPT_IMAGE_25_RATIOS as readonly string[]).includes(ratio)) throw new Error(`${name} 比例无效`);
  const imageUrls = (input.imageUrls || []).map((url) => url.trim()).filter(Boolean);
  if (imageUrls.length > 16) throw new Error(`${name} 最多支持 16 张参考图`);
  if (imageUrls.some((url) => !/^https?:\/\//i.test(url))) throw new Error(`${name} 参考图需要公网 HTTP(S) 地址`);
  return {
    model: upstreamModels[mode],
    prompt,
    ...(!animation && ratio !== "auto" ? { size: ratio } : {}),
    ...(!animation ? { resolution } : {}),
    quality,
    // Product quantity fans out independent tasks; never multiply it upstream.
    n: 1,
    ...(animation || buildGptImage25OutputParams(input)),
    ...(imageUrls.length ? { image_urls: imageUrls } : {}),
  };
}

export const buildApimartGptImage25Request = buildApimartGptImageVariantRequest;
