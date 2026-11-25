export const TUZI_PROVIDER_ID = "tuzi";
export const TUZI_GPT_IMAGE_2_MODEL_ID = "gpt-image-2-tuzi";
export const TUZI_GPT_IMAGE_2_UPSTREAM_MODEL = "gpt-image-2";
export const TUZI_GPT_IMAGE_2_LABEL = "GPT-Image-2（tz）";

export const TUZI_GPT_IMAGE_2_ASPECT_RATIOS = [
  "auto",
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

export const TUZI_GPT_IMAGE_2_4K_RATIOS = [
  "16:9",
  "9:16",
  "2:1",
  "1:2",
  "21:9",
  "9:21",
] as const;

export const TUZI_GPT_IMAGE_2_RESOLUTIONS = ["1K", "2K", "4K"] as const;
export const TUZI_GPT_IMAGE_2_QUALITIES = ["low", "medium", "high"] as const;

export type TuziGptImage2Resolution = typeof TUZI_GPT_IMAGE_2_RESOLUTIONS[number];
export type TuziGptImage2Quality = typeof TUZI_GPT_IMAGE_2_QUALITIES[number];

const PIXEL_SIZES: Record<TuziGptImage2Resolution, Partial<Record<string, string>>> = {
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

export function isTuziGptImage2Model(model: unknown) {
  return clean(model) === TUZI_GPT_IMAGE_2_MODEL_ID;
}

export function getTuziGptImage2Ratios(resolution?: unknown): readonly string[] {
  return clean(resolution).toUpperCase() === "4K"
    ? TUZI_GPT_IMAGE_2_4K_RATIOS
    : TUZI_GPT_IMAGE_2_ASPECT_RATIOS;
}

export function isTuziGptImage2SizeComboValid(aspectRatio: unknown, resolution: unknown) {
  const normalizedResolution = clean(resolution).toUpperCase();
  if (!TUZI_GPT_IMAGE_2_RESOLUTIONS.includes(normalizedResolution as TuziGptImage2Resolution)) {
    return false;
  }
  return getTuziGptImage2Ratios(normalizedResolution).includes(clean(aspectRatio));
}

export function normalizeTuziGptImage2Params(input: {
  quality?: unknown;
  resolution?: unknown;
  aspectRatio?: unknown;
}) {
  const rawQuality = clean(input.quality).toLowerCase();
  const quality: TuziGptImage2Quality = TUZI_GPT_IMAGE_2_QUALITIES.includes(
    rawQuality as TuziGptImage2Quality,
  ) ? rawQuality as TuziGptImage2Quality : "medium";
  const rawResolution = clean(input.resolution).toUpperCase();
  const resolution: TuziGptImage2Resolution = TUZI_GPT_IMAGE_2_RESOLUTIONS.includes(
    rawResolution as TuziGptImage2Resolution,
  ) ? rawResolution as TuziGptImage2Resolution : "2K";
  const ratios = getTuziGptImage2Ratios(resolution);
  const requestedRatio = clean(input.aspectRatio);
  const aspectRatio = ratios.includes(requestedRatio)
    ? requestedRatio
    : resolution === "4K"
      ? "16:9"
      : "1:1";
  return { quality, resolution, aspectRatio };
}

export function mapTuziGptImage2Size(aspectRatio: unknown, resolution: unknown) {
  const normalizedResolution = clean(resolution).toUpperCase() as TuziGptImage2Resolution;
  if (!TUZI_GPT_IMAGE_2_RESOLUTIONS.includes(normalizedResolution)) {
    throw new Error("GPT-Image-2（tz）分辨率无效");
  }
  const ratio = clean(aspectRatio);
  if (ratio === "auto" && normalizedResolution !== "4K") return "auto";
  const size = PIXEL_SIZES[normalizedResolution][ratio];
  if (!size) {
    if (normalizedResolution === "4K") {
      throw new Error("GPT-Image-2（tz）4K 仅支持宽幅比例");
    }
    throw new Error("GPT-Image-2（tz）比例无效");
  }
  return size;
}
