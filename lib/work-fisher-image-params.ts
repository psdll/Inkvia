export const WORK_FISHER_PROVIDER_ID = "work-fisher";
export const QWEN_IMAGE_21_MODEL_ID = "qwen-image-global-2.1";
export const QWEN_IMAGE_21_LABEL = "Qwen-Image-Global-2.1（FisherAI）";
export const QWEN_IMAGE_21_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "21:9",
] as const;
export const QWEN_IMAGE_21_RESOLUTIONS = ["1K", "2K", "4K"] as const;
export const QWEN_IMAGE_21_MAX_REFERENCES = 10;

export function isQwenImage21Model(model: unknown) {
  return model === QWEN_IMAGE_21_MODEL_ID;
}

export function normalizeQwenImage21Params(input: {
  aspectRatio?: string;
  resolution?: string;
}) {
  const aspectRatio = input.aspectRatio?.trim() || "3:4";
  const resolution = input.resolution?.trim().toUpperCase() || "2K";
  if (!(QWEN_IMAGE_21_RATIOS as readonly string[]).includes(aspectRatio))
    throw new Error("Qwen-Image-Global-2.1 不支持该比例");
  if (!(QWEN_IMAGE_21_RESOLUTIONS as readonly string[]).includes(resolution))
    throw new Error("Qwen-Image-Global-2.1 仅支持 1K、2K、4K 分辨率");
  return { aspectRatio, resolution };
}
