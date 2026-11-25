import { AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID, AICOMING_HAIYA_GPT_IMAGE_25_UPSTREAM_MODELS } from "@/lib/aicoming-merchant-models";
import { GPT_IMAGE_25_RATIOS, buildGptImage25OutputParams, getGptImage25QualityOptions, normalizeGptImage25Mode } from "@/lib/gpt-image-25-models";

export const AICOMING_GPT_IMAGE_25_RATIOS = GPT_IMAGE_25_RATIOS.filter((ratio) => ratio !== "auto");
// Exact-model price_tiers.max_pixels from https://aicoming.top/api/v1/models?per_page=500 (2026-09-09).
const PIXEL_BUDGETS = { "1K": 1048576, "2K": 4194304, "4K": 8294400 } as const;

export function isAicomingGptImage25Model(model: unknown) {
  return model === AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID;
}

// Choose explicit pixels within the selected tier; this is local sizing, not a vendor pixel mapping table.
export function mapAicomingGptImage25Pixels(aspectRatio: string, resolution: string) {
  if (!AICOMING_GPT_IMAGE_25_RATIOS.includes(aspectRatio as never)) throw new Error("海牙 GPT-Image-2.5 请选择明确的图片比例");
  const budget = PIXEL_BUDGETS[resolution as keyof typeof PIXEL_BUDGETS];
  if (!budget) throw new Error("海牙 GPT-Image-2.5 仅支持 1K、2K、4K 分辨率");
  const [rw, rh] = aspectRatio.split(":").map(Number);
  const ratio = Math.max(rw, rh) / Math.min(rw, rh);
  const short = Math.floor(Math.min(Math.sqrt(budget / ratio), 3840 / ratio) / 16) * 16;
  const long = Math.floor(short * ratio / 16) * 16;
  return rw >= rh ? `${long}x${short}` : `${short}x${long}`;
}

export type AicomingGptImage25Input = {
  prompt: string;
  mode?: string;
  quality?: string;
  aspectRatio?: string;
  resolution?: string;
  imageUrls?: string[];
  requestKey?: string;
  background?: string;
  outputFormat?: string;
};

export function buildAicomingHaiyaGptImage25Request(input: AicomingGptImage25Input) {
  const mode = normalizeGptImage25Mode(input.mode);
  const quality = input.quality?.trim().toLowerCase() || "medium";
  if (!getGptImage25QualityOptions(AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID).some((option) => option.value === quality)) {
    throw new Error("海牙 GPT-Image-2.5 画质请选择低、标准、高、超高或极致");
  }
  const resolution = input.resolution?.trim().toUpperCase() || "2K";
  const aspectRatio = input.aspectRatio?.trim() || "1:1";
  const size = mapAicomingGptImage25Pixels(aspectRatio, resolution);
  const imageUrls = (input.imageUrls || []).map((url) => url.trim()).filter(Boolean);
  if (imageUrls.some((url) => !/^https?:\/\//i.test(url))) throw new Error("海牙 GPT-Image-2.5 参考图需要公开 HTTP(S) 地址");
  return {
    endpoint: "/images/generations",
    idempotencyKey: input.requestKey?.trim() || "",
    body: {
      model: AICOMING_HAIYA_GPT_IMAGE_25_UPSTREAM_MODELS[mode],
      prompt: input.prompt.trim(),
      size,
      quality,
      n: 1,
      ...buildGptImage25OutputParams(input),
      ...(imageUrls.length ? { image: imageUrls } : {}),
    },
  };
}
