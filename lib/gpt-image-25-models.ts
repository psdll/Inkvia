import { isSeedream55Model } from "@/lib/volcengine-seedream-55";
import { isOpenRouterImageModel, getOpenRouterBackgroundOptions } from "@/lib/openrouter-image-params";
import { AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID } from "@/lib/aicoming-merchant-models";
import { APIMART_GPT_IMAGE_26_MODEL_ID } from "@/lib/apimart-image-models";

export const REAPI_GPT_IMAGE_25_MODEL_ID = "gpt-image-2.5-reapi";
export const REAPI_GPT_IMAGE_25_LABEL = "GPT-Image-2.5（re）";
export const REAPI_GPT_IMAGE_25_UPSTREAM_MODELS = { flare: "gpt-image-2.5-flare-official", sunburst: "gpt-image-2.5-sunburst-official" } as const;

export type GptImage25Mode = "flare" | "sunburst";
export const GPT_IMAGE_25_BACKGROUND_OPTIONS = [
  { value: "auto", label: "自适应" },
  { value: "transparent", label: "透明" },
  { value: "opaque", label: "不透明" },
];
export const GPT_IMAGE_25_OUTPUT_FORMAT_OPTIONS = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
];

// Verified exact-model contracts (2026-09-20):
// https://docs.apimart.ai/cn/api-reference/images/gpt-image-2.5/generation
// https://reapi.ai/docs/gpt-image-2-5
// All GPT-Image-2.5 product entries expose the same background choices.
export function supportsGptImage25Background(model: unknown) {
  return isGptImageVariantModel(model);
}

// Reuse the existing background control while respecting each provider's choices.
export function getImageBackgroundOptions(model: unknown) {
  return isOpenRouterImageModel(model) ? getOpenRouterBackgroundOptions(model) : (isSeedream55Model(model) || supportsGptImage25Background(model)) ? GPT_IMAGE_25_BACKGROUND_OPTIONS : [];
}
export function supportsImageBackground(model: unknown) {
  return getImageBackgroundOptions(model).length > 0;
}

export function buildGptImage25OutputParams(input: { background?: string; outputFormat?: string }) {
  const background = input.background?.trim().toLowerCase();
  const outputFormat = input.outputFormat?.trim().toLowerCase() || (background === "transparent" ? "png" : undefined);
  if (background && !GPT_IMAGE_25_BACKGROUND_OPTIONS.some((option) => option.value === background)) throw new Error("背景请选择自适应、透明或不透明");
  if (outputFormat && !GPT_IMAGE_25_OUTPUT_FORMAT_OPTIONS.some((option) => option.value === outputFormat)) throw new Error("输出格式请选择 PNG、JPEG 或 WebP");
  if (background === "transparent" && outputFormat === "jpeg") throw new Error("透明背景需要 PNG 或 WebP，JPEG 不支持透明背景");
  return { ...(background ? { background } : {}), ...(outputFormat ? { output_format: outputFormat } : {}) };
}

export type GptImage25VariantOptions = {
  gptImage25Variants?: Array<{ mode: GptImage25Mode; label: string }>;
};
export const GPT_IMAGE_25_MODE_OPTIONS = [
  { value: "flare", label: "快速生成" },
  { value: "sunburst", label: "精细编辑" },
] as const;
export const GPT_IMAGE_25_QUALITY_OPTIONS = [
  { value: "low", label: "低" },
  { value: "medium", label: "标准" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "超高" },
  { value: "max", label: "极致" },
] as const;
export const GPT_IMAGE_25_RATIOS = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21"] as const;

export function isGptImageVariantModel(model: unknown) {
  return model === APIMART_GPT_IMAGE_26_MODEL_ID || model === "gpt-image-2.5-apimart" || model === AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID || model === REAPI_GPT_IMAGE_25_MODEL_ID;
}

export function getGptImage25QualityOptions(_model: unknown) {
  return [...GPT_IMAGE_25_QUALITY_OPTIONS];
}

export function normalizeGptImage25Mode(value: unknown, model?: string): GptImage25Mode {
  if (value == null || value === "" || value === "flare") return "flare";
  if (value === "sunburst") return "sunburst";
  throw new Error(`GPT-Image-${model === APIMART_GPT_IMAGE_26_MODEL_ID ? "2.6" : "2.5"} 模式无效，请选择快速生成或精细编辑`);
}

export function getGptImage25ModeLabel(value: unknown) {
  return value === "sunburst" ? "精细编辑" : "快速生成";
}

// Keep the existing provider ID and mode in saved tasks and API requests.
// Only model selectors combine them into two independent choices.
export function getGptImage25SelectionValue(model: string, mode?: unknown) {
  return isGptImageVariantModel(model) ? `${model}:${mode === "sunburst" ? "pro" : "fast"}` : model;
}

export function getAvailableGptImage25Mode(model: string, mode: unknown, variants?: GptImage25VariantOptions["gptImage25Variants"]) {
  if (!isGptImageVariantModel(model)) return undefined;
  const requested = mode === "sunburst" ? "sunburst" : "flare";
  return variants?.length && !variants.some((variant) => variant.mode === requested) ? variants[0].mode : requested;
}

export function resolveGptImage25Selection(value: string): { model: string; gptImage25Mode?: GptImage25Mode } {
  const match = /^(.*):(fast|pro)$/.exec(value);
  return match && isGptImageVariantModel(match[1])
    ? { model: match[1], gptImage25Mode: match[2] === "pro" ? "sunburst" : "flare" }
    : { model: value };
}

export function getGptImage25ModelLabel(model: string, label: string, mode?: unknown, variants?: GptImage25VariantOptions["gptImage25Variants"]) {
  if (!isGptImageVariantModel(model)) return label;
  const configured = variants?.find((variant) => variant.mode === (mode === "sunburst" ? "sunburst" : "flare"));
  if (configured) return configured.label;
  const suffix = label.match(/[（(][^）)]*[）)]$/)?.[0] || "";
  return `GPT-Image-${model === APIMART_GPT_IMAGE_26_MODEL_ID ? "2.6" : "2.5"} ${mode === "sunburst" ? "Pro" : "Fast"}${suffix}`;
}

export function expandGptImage25ModelOptions<T extends { value: string; label: string } & GptImage25VariantOptions>(options: T[]): T[] {
  return options.flatMap((option) => isGptImageVariantModel(option.value)
    ? (option.gptImage25Variants || (["flare", "sunburst"] as const).map((mode) => ({ mode, label: getGptImage25ModelLabel(option.value, option.label, mode) }))).map(({ mode, label }) => ({
        ...option,
        value: getGptImage25SelectionValue(option.value, mode),
        label,
      }))
    : [option]);
}
