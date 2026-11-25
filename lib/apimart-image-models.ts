export const APIMART_NANO_BANANA_PRO_MODEL_ID = "nano-banana-pro-apimart";
export const APIMART_NANO_BANANA_PRO_UPSTREAM_MODEL = "gemini-3-pro-image-preview-official";

export const APIMART_NANO_BANANA_PRO_ASPECT_RATIO_VALUES = [
  "auto",
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;

export const APIMART_NANO_BANANA_PRO_RESOLUTION_VALUES = ["1K", "2K", "4K"] as const;

export function isApimartNanoBananaProModel(model: string) {
  return String(model || "").trim() === APIMART_NANO_BANANA_PRO_MODEL_ID;
}

export const APIMART_GPT_IMAGE_26_MODEL_ID = "gpt-image-2.6-apimart";
export const APIMART_GPT_IMAGE_26_LABEL = "GPT-Image-2.6（am）";
export const APIMART_GPT_IMAGE_26_UPSTREAM_MODELS = {
  flare: "gpt-image-2.6-flare",
  sunburst: "gpt-image-2.6-sunburst",
} as const;
