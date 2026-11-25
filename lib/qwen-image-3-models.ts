export const QWEN_IMAGE_3_MODEL_ID = "qwen-image-3.0";
export const QWEN_IMAGE_3_UPSTREAM_MODELS = {
  standard: "qwen-image-3.0",
  pro: "qwen-image-3.0-pro",
} as const;
export const QWEN_IMAGE_3_RATIOS = [
  "auto",
  "1:1",
  "9:16",
  "16:9",
  "3:4",
  "4:3",
  "3:2",
  "2:3",
];
export const QWEN_IMAGE_3_RESOLUTIONS = ["1K", "2K"];
export const QWEN_IMAGE_3_QUALITIES = [
  { value: "standard", label: "标准" },
  { value: "pro", label: "Pro" },
];
export const isQwenImage3Model = (model?: string) =>
  model === QWEN_IMAGE_3_MODEL_ID;

export function normalizeQwenImage3Params(input: {
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
}) {
  const aspectRatio = input.aspectRatio?.trim() || "1:1";
  const resolution =
    aspectRatio === "auto" && input.resolution === "auto"
      ? "2K"
      : input.resolution?.trim().toUpperCase() || "2K";
  const quality = input.quality?.trim() || "standard";
  if (!QWEN_IMAGE_3_RATIOS.includes(aspectRatio))
    throw new Error("Qwen-Image-3.0 画面比例无效");
  if (!QWEN_IMAGE_3_RESOLUTIONS.includes(resolution))
    throw new Error("Qwen-Image-3.0 清晰度仅支持 1K、2K");
  if (quality !== "standard" && quality !== "pro")
    throw new Error("Qwen-Image-3.0 图片质量仅支持标准、Pro");
  return {
    aspectRatio,
    resolution,
    quality,
    providerModel: QWEN_IMAGE_3_UPSTREAM_MODELS[quality],
  };
}

export function getQwenImage3Size(aspectRatio: string, resolution: string) {
  // Omit size for the provider's automatic composition. Resolution is then provider-selected.
  if (aspectRatio === "auto") return undefined;
  const [width, height] = aspectRatio.split(":").map(Number);
  const longEdge = resolution === "2K" ? 2048 : 1024;
  const scale = longEdge / Math.max(width, height);
  return `${Math.round(width * scale)}*${Math.round(height * scale)}`;
}
