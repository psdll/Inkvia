import { buildApimartSeedream55Request, type Seedream55Settings } from "./apimart-seedream-55";
import type { VolcSeedreamGenerationBody } from "./volcengine";

export const VOLC_SEEDREAM_55_MODEL = "doubao-seedream-5.5";
export const VOLC_SEEDREAM_55_UPSTREAM = "doubao-seedream-5-5-261028";
export function isSeedream55Model(model: unknown) {
  return model === VOLC_SEEDREAM_55_MODEL || model === "seedream-5.5-apimart";
}
// Official recommended pixels: https://docs.volcengine.com/docs/ark/image-generation-api
// 2:1 and 1:2 are project presets satisfying the documented exact-pixel bounds.
const pixels: Record<string, string[]> = {
  "1:1": ["1024x1024", "1536x1536", "2048x2048"],
  "4:3": ["1152x864", "1792x1344", "2368x1776"],
  "3:4": ["864x1152", "1344x1792", "1776x2368"],
  "16:9": ["1424x800", "2048x1152", "2816x1584"],
  "9:16": ["800x1424", "1152x2048", "1584x2816"],
  "3:2": ["1248x832", "1872x1248", "2496x1664"],
  "2:3": ["832x1248", "1248x1872", "1664x2496"],
  "21:9": ["1568x672", "2352x1008", "3136x1344"],
  "2:1": ["1440x720", "2160x1080", "2880x1440"],
  "1:2": ["720x1440", "1080x2160", "1440x2880"],
};
export function buildVolcSeedream55Request(input: Seedream55Settings & {
  prompt: string; aspectRatio?: string; resolution?: string; customSize?: string; imageUrls?: string[]; background?: string; outputFormat?: string;
}): VolcSeedreamGenerationBody {
  // Shared 5.5 mode/size validation; construct the official transport explicitly.
  const validated = buildApimartSeedream55Request(input);
  const size = pixels[validated.size]?.[["1K", "1.5K", "2K"].indexOf(input.resolution || "2K")] || validated.size;
  return {
    model: VOLC_SEEDREAM_55_UPSTREAM,
    ...(validated.prompt ? { prompt: validated.prompt } : {}),
    size,
    ...(input.imageUrls?.length ? { image: input.imageUrls } : {}),
    output_format: validated.output_format, response_format: "url", watermark: false,
    ...(input.layerDecomposition ? { layer_decomposition: true, layer_decomposition_options: validated.layer_decomposition_options } : { background: validated.background }),
  };
}
export function readVolcSeedream55Outputs(raw: any): Array<{ url: string; size?: string; layer?: Record<string, any> }> {
  return (Array.isArray(raw?.data) ? raw.data : []).flatMap((item: any) => {
    if (typeof item?.url !== "string" || !/^https?:\/\//i.test(item.url)) return [];
    const layer = Object.fromEntries(["z_index", "name", "description", "bounding_box", "text_recognition"].filter(key => item[key] !== undefined).map(key => [key, item[key]]));
    return [{ url: item.url, ...(typeof item.size === "string" ? { size: item.size } : {}), ...(Object.keys(layer).length ? { layer } : {}) }];
  });
}
