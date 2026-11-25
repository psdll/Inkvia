import { AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID } from "@/lib/aicoming-merchant-models";

export const REAPI_GPT_IMAGE_2_MODEL_ID = "gpt-image-2-official-reapi";
export const GPT_IMAGE_2_OFFICIAL_UPSTREAM_MODEL = "gpt-image-2-official";

export const GPT_IMAGE_2_OFFICIAL_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "2:1",
  "1:2",
  "21:9",
  "9:21",
] as const;

export const GPT_IMAGE_2_OFFICIAL_4K_RATIOS = [
  "16:9",
  "9:16",
  "2:1",
  "1:2",
  "21:9",
  "9:21",
] as const;

export const REAPI_GPT_IMAGE_2_RATIOS = ["auto", ...GPT_IMAGE_2_OFFICIAL_RATIOS] as const;
export const AICOMING_HAIYA_GPT_IMAGE_2_RATIOS = GPT_IMAGE_2_OFFICIAL_RATIOS.filter(
  (ratio) => ratio !== "5:4" && ratio !== "4:5",
);
const AICOMING_HAIYA_GPT_IMAGE_2_1K_HIDDEN_RATIOS = new Set(["3:2", "2:3"]);
export const GPT_IMAGE_2_OFFICIAL_QUALITIES = ["low", "medium", "high"] as const;
export const GPT_IMAGE_2_OFFICIAL_RESOLUTIONS = ["1K", "2K", "4K"] as const;

export type GptImage2OfficialQuality = typeof GPT_IMAGE_2_OFFICIAL_QUALITIES[number];
export type GptImage2OfficialResolution = typeof GPT_IMAGE_2_OFFICIAL_RESOLUTIONS[number];

export function isGptImage2OfficialProviderModel(model: unknown) {
  return model === REAPI_GPT_IMAGE_2_MODEL_ID
    || model === AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID;
}

export function getGptImage2OfficialRatios(model: unknown, resolution?: unknown): readonly string[] {
  if (model === REAPI_GPT_IMAGE_2_MODEL_ID) return REAPI_GPT_IMAGE_2_RATIOS;
  if (model === AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID) {
    return clean(resolution).toUpperCase() === "1K"
      ? AICOMING_HAIYA_GPT_IMAGE_2_RATIOS.filter(
          (ratio) => !AICOMING_HAIYA_GPT_IMAGE_2_1K_HIDDEN_RATIOS.has(ratio),
        )
      : AICOMING_HAIYA_GPT_IMAGE_2_RATIOS;
  }
  return GPT_IMAGE_2_OFFICIAL_RATIOS;
}

export function isGptImage2OfficialSizeComboValid(
  model: unknown,
  aspectRatio: unknown,
  resolution: unknown,
) {
  if (!isGptImage2OfficialProviderModel(model)) return false;
  const normalizedResolution = clean(resolution).toUpperCase();
  if (!GPT_IMAGE_2_OFFICIAL_RESOLUTIONS.includes(normalizedResolution as GptImage2OfficialResolution)) {
    return false;
  }
  const ratio = clean(aspectRatio);
  if (!getGptImage2OfficialRatios(model, normalizedResolution).includes(ratio as never)) return false;
  return normalizedResolution !== "4K" || GPT_IMAGE_2_OFFICIAL_4K_RATIOS.includes(ratio as never);
}

const PIXEL_SIZES: Record<GptImage2OfficialResolution, Partial<Record<string, string>>> = {
  "1K": {
    "1:1": "1024x1024",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
    "4:3": "1024x768",
    "3:4": "768x1024",
    "5:4": "1280x1024",
    "4:5": "1024x1280",
    "16:9": "1536x864",
    "9:16": "864x1536",
    "2:1": "2048x1024",
    "1:2": "1024x2048",
    "21:9": "2016x864",
    "9:21": "864x2016",
  },
  "2K": {
    "1:1": "2048x2048",
    "3:2": "2048x1360",
    "2:3": "1360x2048",
    "4:3": "2048x1536",
    "3:4": "1536x2048",
    "5:4": "2560x2048",
    "4:5": "2048x2560",
    "16:9": "2048x1152",
    "9:16": "1152x2048",
    "2:1": "2688x1344",
    "1:2": "1344x2688",
    "21:9": "2688x1152",
    "9:21": "1152x2688",
  },
  "4K": {
    "16:9": "3840x2160",
    "9:16": "2160x3840",
    "2:1": "3840x1920",
    "1:2": "1920x3840",
    "21:9": "3840x1648",
    "9:21": "1648x3840",
  },
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeGptImage2OfficialParams(input: {
  model?: unknown;
  quality?: unknown;
  resolution?: unknown;
  aspectRatio?: unknown;
  allowAuto?: boolean;
}) {
  const quality = clean(input.quality).toLowerCase();
  const normalizedQuality: GptImage2OfficialQuality = GPT_IMAGE_2_OFFICIAL_QUALITIES.includes(
    quality as GptImage2OfficialQuality,
  ) ? quality as GptImage2OfficialQuality : "medium";
  const resolution = clean(input.resolution).toUpperCase();
  const normalizedResolution: GptImage2OfficialResolution = GPT_IMAGE_2_OFFICIAL_RESOLUTIONS.includes(
    resolution as GptImage2OfficialResolution,
  ) ? resolution as GptImage2OfficialResolution : "2K";
  const modelRatios = isGptImage2OfficialProviderModel(input.model)
    ? getGptImage2OfficialRatios(input.model, normalizedResolution)
    : input.allowAuto
      ? REAPI_GPT_IMAGE_2_RATIOS
      : GPT_IMAGE_2_OFFICIAL_RATIOS;
  const supportedRatios: readonly string[] = normalizedResolution === "4K"
    ? modelRatios.filter((ratio) => GPT_IMAGE_2_OFFICIAL_4K_RATIOS.includes(ratio as never))
    : modelRatios;
  const requestedRatio = clean(input.aspectRatio);
  const aspectRatio = supportedRatios.includes(requestedRatio)
    ? requestedRatio
    : supportedRatios[0];
  return { quality: normalizedQuality, resolution: normalizedResolution, aspectRatio };
}

export function mapGptImage2OfficialPixels(aspectRatio: unknown, resolution: unknown) {
  const normalizedResolution = clean(resolution).toUpperCase() as GptImage2OfficialResolution;
  if (!GPT_IMAGE_2_OFFICIAL_RESOLUTIONS.includes(normalizedResolution)) {
    throw new Error("GPT-Image-2 分辨率无效");
  }
  const ratio = clean(aspectRatio);
  const size = PIXEL_SIZES[normalizedResolution][ratio];
  if (!size) {
    if (normalizedResolution === "4K") {
      throw new Error("GPT-Image-2 4K 仅支持宽幅比例");
    }
    throw new Error("GPT-Image-2 比例无效");
  }
  return size;
}

export function normalizeGptImage2OfficialReferences(imageUrls: unknown) {
  if (!Array.isArray(imageUrls)) return [];
  if (imageUrls.length > 16) throw new Error("GPT-Image-2 最多支持 16 张参考图");
  return imageUrls.map(clean).filter(Boolean).map((url) => {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("GPT-Image-2 参考图必须是公开 HTTP(S) URL");
    }
    return url;
  });
}

export function uniqueHttpUrls(values: unknown[]) {
  return Array.from(new Set(values.map(clean).filter((value) => /^https?:\/\//i.test(value))));
}
