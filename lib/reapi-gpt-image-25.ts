import { buildGptImage25OutputParams, GPT_IMAGE_25_RATIOS, getGptImage25QualityOptions, normalizeGptImage25Mode, REAPI_GPT_IMAGE_25_MODEL_ID, REAPI_GPT_IMAGE_25_UPSTREAM_MODELS } from "@/lib/gpt-image-25-models";

export const REAPI_GPT_IMAGE_25_RATIOS = GPT_IMAGE_25_RATIOS.filter((ratio) => ratio !== "auto");
// Local UI resolution presets, bounded by reAPI's exact-model custom-size rules.
const PIXEL_BUDGETS = { "1K": 1048576, "2K": 4194304, "4K": 8294400 } as const;

export function mapReapiGptImage25Pixels(aspectRatio: string, resolution: string) {
  if (!(REAPI_GPT_IMAGE_25_RATIOS as readonly string[]).includes(aspectRatio)) throw new Error("reAPI GPT-Image-2.5 请选择明确的图片比例");
  const budget = PIXEL_BUDGETS[resolution as keyof typeof PIXEL_BUDGETS];
  if (!budget) throw new Error("reAPI GPT-Image-2.5 请选择 1K、2K 或 4K 分辨率");
  const [rw, rh] = aspectRatio.split(":").map(Number);
  const ratio = Math.max(rw, rh) / Math.min(rw, rh);
  const short = Math.floor(Math.min(Math.sqrt(budget / ratio), 3840 / ratio) / 16) * 16;
  const long = Math.floor(short * ratio / 16) * 16;
  return rw >= rh ? `${long}x${short}` : `${short}x${long}`;
}

export type ReapiGptImage25Input = {
  prompt: string;
  mode?: string;
  quality?: string;
  aspectRatio?: string;
  resolution?: string;
  imageUrls?: string[];
  background?: string;
  outputFormat?: string;
};

export function buildReapiGptImage25Request(input: ReapiGptImage25Input) {
  const mode = normalizeGptImage25Mode(input.mode);
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 32000) throw new Error("reAPI GPT-Image-2.5 提示词需为 1–32000 个字符");
  const quality = input.quality?.trim().toLowerCase() || "medium";
  if (quality !== "auto" && !getGptImage25QualityOptions(REAPI_GPT_IMAGE_25_MODEL_ID).some((option) => option.value === quality)) throw new Error("reAPI GPT-Image-2.5 画质请选择低、标准、高、超高或极致");
  const size = mapReapiGptImage25Pixels(input.aspectRatio?.trim() || "1:1", input.resolution?.trim().toUpperCase() || "2K");
  const imageUrls = (input.imageUrls || []).map((url) => url.trim()).filter(Boolean);
  if (imageUrls.length > 16) throw new Error("reAPI GPT-Image-2.5 最多支持 16 张参考图");
  if (imageUrls.some((url) => !/^https?:\/\//i.test(url))) throw new Error("reAPI GPT-Image-2.5 参考图需要公开 HTTP(S) 地址");
  return {
    endpoint: "/images/generations",
    body: {
      model: REAPI_GPT_IMAGE_25_UPSTREAM_MODELS[mode],
      prompt,
      size,
      quality,
      n: 1,
      ...buildGptImage25OutputParams(input),
      ...(imageUrls.length ? { image_urls: imageUrls } : {}),
    },
  };
}
