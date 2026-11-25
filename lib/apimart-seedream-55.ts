// Exact-model contract: https://docs.apimart.ai/cn/api-reference/images/seedream-5-5/generation
export const APIMART_SEEDREAM_55_MODEL = "seedream-5.5-apimart";
export const APIMART_SEEDREAM_55_UPSTREAM = "seedream-5-5";
export const SEEDREAM_55_RATIOS = ["auto", "1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9", "2:1", "1:2"];
export const SEEDREAM_55_RESOLUTIONS = ["1K", "1.5K", "2K"];
export type Seedream55Settings = { layerDecomposition?: boolean; layerMaxImages?: number; textRecognition?: boolean };
export function buildApimartSeedream55Request(input: Seedream55Settings & {
  prompt: string; aspectRatio?: string; resolution?: string; customSize?: string; imageUrls?: string[]; background?: string; outputFormat?: string;
}) {
  const refs = input.imageUrls || [];
  const layers = input.layerDecomposition === true;
  if (layers ? refs.length !== 1 : refs.length > 10) throw new Error(layers ? "图层拆分需要恰好 1 张参考图" : "Seedream 5.5 最多支持 10 张参考图");
  const prompt = input.prompt.trim();
  if (!layers && !prompt) throw new Error("请输入提示词");
  const resolution = input.resolution || "2K";
  if (!SEEDREAM_55_RESOLUTIONS.includes(resolution) && !(layers && resolution === "auto")) throw new Error("Seedream 5.5 分辨率请选择 1K、1.5K 或 2K");
  const outputFormat = input.outputFormat || "png";
  if (!["png", "jpeg"].includes(outputFormat)) throw new Error("Seedream 5.5 支持 PNG 或 JPEG");
  const body: Record<string, any> = { model: APIMART_SEEDREAM_55_UPSTREAM, ...(prompt ? { prompt } : {}), size: resolution, n: 1, output_format: outputFormat };
  if (refs.length) body.image_urls = refs;
  if (layers) {
    const maxImages = input.layerMaxImages ?? 30;
    if (!Number.isInteger(maxImages) || maxImages < 2 || maxImages > 100) throw new Error("图层输出上限请选择 2–100 张（含底图）");
    body.layer_decomposition = true;
    body.layer_decomposition_options = { max_images: maxImages, text_recognition: input.textRecognition ?? false };
    return body;
  }
  const background = input.background || "auto";
  if (!["auto", "transparent", "opaque"].includes(background)) throw new Error("请选择有效的背景类型");
  if (background === "transparent" && outputFormat !== "png") throw new Error("透明背景必须使用 PNG");
  body.background = background;
  const ratio = input.aspectRatio || "auto";
  const size = ratio === "custom" ? input.customSize?.trim().toLowerCase() || "" : ratio;
  const pixels = /^(\d+)x(\d+)$/.exec(size);
  if (pixels) {
    const width = Number(pixels[1]), height = Number(pixels[2]), area = width * height;
    if (area < 921600 || area > 4624220 || width / height < 1 / 16 || width / height > 16) throw new Error("精确尺寸总像素须为 921600–4624220，宽高比须在 1:16–16:1 之间");
    body.size = size;
  } else if (size !== "auto") {
    if (!SEEDREAM_55_RATIOS.includes(size)) throw new Error("Seedream 5.5 不支持该比例");
    body.size = size;
    body.resolution = resolution;
  }
  return body;
}

export function readSeedream55Outputs(data: any): Array<{ url: string; size?: string; layer?: Record<string, any> }> {
  return (Array.isArray(data?.result?.images) ? data.result.images : []).flatMap((group: any) => {
    const urls = Array.isArray(group.url) ? group.url : [];
    return urls.flatMap((url: unknown, index: number) => typeof url === "string" && /^https?:\/\//i.test(url) ? [{
      url,
      ...(Array.isArray(group.sizes) && group.sizes.length === urls.length && typeof group.sizes[index] === "string" ? { size: group.sizes[index] } : {}),
      ...(Array.isArray(group.layers) && group.layers.length === urls.length && group.layers[index] && typeof group.layers[index] === "object" ? { layer: group.layers[index] } : {}),
    }] : []);
  });
}

export function seedream55PixelTier(size: string) {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) return undefined;
  return Number(match[1]) * Number(match[2]) <= 2610000 ? "low" : "high";
}
