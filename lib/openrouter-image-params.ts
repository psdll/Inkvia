import { OPENROUTER_NANO_BANANA_21_MODEL, NANO_BANANA_21_RATIOS } from "@/lib/nano-banana-21-providers";
// Verified against /api/v1/images/models/{model}/endpoints, 2026-09-24.
export const OPENROUTER_IMAGE_MODELS = [
  { id: OPENROUTER_NANO_BANANA_21_MODEL, label: "Nano Banana 2.1（OpenRouter）", upstreamModelId: "google/gemini-nano-banana-2.1" },
  { id: "gpt-image-2.5-sunburst-openrouter", label: "GPT-Image-2.5 Pro（OpenRouter）", upstreamModelId: "openai/gpt-image-2.5-sunburst" },
  { id: "gpt-image-2-openrouter", label: "GPT-Image-2（OpenRouter）", upstreamModelId: "openai/gpt-image-2" },
  { id: "gemini-3-pro-image-openrouter", label: "nano-banana-pro（OpenRouter）", upstreamModelId: "google/gemini-3-pro-image" },
  { id: "gpt-image-2.5-flare-openrouter", label: "GPT-Image-2.5 Fast（OpenRouter）", upstreamModelId: "openai/gpt-image-2.5-flare" },
  { id: "gpt-image-2.6-flare-openrouter", label: "GPT-Image-2.6 Fast（OpenRouter）", upstreamModelId: "openai/gpt-image-2.6-flare" },
  { id: "gpt-image-2.6-sunburst-openrouter", label: "GPT-Image-2.6 Pro（OpenRouter）", upstreamModelId: "openai/gpt-image-2.6-sunburst" },
] as const;

export function getOpenRouterImageModel(model: unknown) {
  return OPENROUTER_IMAGE_MODELS.find(item => item.id === model);
}
export function isOpenRouterImageModel(model: unknown) { return !!getOpenRouterImageModel(model); }
export function isOpenRouterGpt26Model(model: unknown) {
  return getOpenRouterImageModel(model)?.upstreamModelId.startsWith("openai/gpt-image-2.6-") === true;
}

export function supportsOpenRouterGptAdvancedSettings(model: unknown) {
  return /^openai\/gpt-image-2\.[56]-/.test(getOpenRouterImageModel(model)?.upstreamModelId || "");
}

// Aspect ratios listed by both exact 2.6 endpoints, checked 2026-11-05.
const GPT_IMAGE_26_RATIOS = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"];

export function getOpenRouterImageParams(model: string, aspectRatio?: string) {
  const gemini = getOpenRouterImageModel(model)?.upstreamModelId.startsWith("google/") === true;
  const option = (value: string) => ({ value, label: value === "auto" ? "自适应" : value });
  const labels: Record<string, string> = { auto: "自动", low: "低", medium: "标准", high: "高", xhigh: "超高", max: "极致" };
  return {
    aspectRatios: (isOpenRouterGpt26Model(model) ? GPT_IMAGE_26_RATIOS : model === OPENROUTER_NANO_BANANA_21_MODEL ? NANO_BANANA_21_RATIOS : gemini ? ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] : ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21"]).map(option),
    resolutions: ["1K", "2K", "4K"].map(option),
    qualities: (gemini ? [] : ["low", "medium", "high", ...(supportsOpenRouterGptAdvancedSettings(model) ? ["xhigh", "max"] : [])]).map(value => ({ value, label: labels[value] })),
    backgrounds: getOpenRouterBackgroundOptions(model),
    defaultAspectRatio: "1:1",
    defaultResolution: gemini ? "2K" : "1K",
    defaultQuality: gemini ? "" : "medium",
    maxReferences: gemini ? 14 : 16,
  };
}

export function getOpenRouterBackgroundOptions(model: unknown) {
  if (!supportsOpenRouterGptAdvancedSettings(model)) return [];
  return [
    { value: "auto", label: "自适应" },
    { value: "transparent", label: "透明" },
    { value: "opaque", label: "不透明" },
  ];
}

// UI tiers are pixel budgets, bounded by GPT Image custom-size rules.
// OpenRouter accepts explicit pixels through the Images API `size` shorthand.
export function mapOpenRouterGptImagePixels(aspectRatio: string, resolution: string) {
  const budget = ({ "1K": 1048576, "2K": 4194304, "4K": 8294400 } as Record<string, number>)[resolution];
  if (!budget || aspectRatio === "auto" || !getOpenRouterImageParams("gpt-image-2-openrouter").aspectRatios.some(o => o.value === aspectRatio)) throw new Error("请选择明确的比例和 1K、2K 或 4K 分辨率");
  const [width, height] = aspectRatio.split(":").map(Number);
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  const rw = width / divisor, rh = height / divisor;
  const step = Math.floor(Math.min(Math.sqrt(budget / (rw * rh)), 3840 / Math.max(rw, rh)) / 16) * 16;
  return `${rw * step}x${rh * step}`;
}

// Aspect ratio and resolution remain independently selectable.
export function mapOpenRouterReferencePixels(width: number, height: number, resolution: string) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error("无法读取第一张参考图的尺寸");
  const budget = ({ "1K": 1048576, "2K": 4194304, "4K": 8294400 } as Record<string, number>)[resolution];
  if (!budget) throw new Error("请选择 1K、2K 或 4K 分辨率");
  const ratio = Math.max(1 / 3, Math.min(3, width / height));
  const h = Math.min(Math.sqrt(budget / ratio), 3840 / Math.max(1, ratio));
  let outputWidth = Math.floor(h * ratio / 16) * 16;
  let outputHeight = Math.floor(h / 16) * 16;
  outputWidth = Math.min(outputWidth, outputHeight * 3);
  outputHeight = Math.min(outputHeight, outputWidth * 3);
  return `${outputWidth}x${outputHeight}`;
}

export function getOpenRouterResolutionDisplayOptions(model: string, aspectRatio: string) {
  return getOpenRouterImageParams(model, aspectRatio).resolutions.map(option => ({ ...option, disabled: false }));
}
