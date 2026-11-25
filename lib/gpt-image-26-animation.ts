import { APIMART_GPT_IMAGE_26_MODEL_ID } from "@/lib/apimart-image-models";

export type GptImage26AnimationSettings = {
  gifSize?: string;
  frameCount?: number;
  frameDurationMs?: number;
};

export function supportsGptImage26Gif(model: unknown) {
  return model === APIMART_GPT_IMAGE_26_MODEL_ID
    || model === "gpt-image-2.6-flare-openrouter"
    || model === "gpt-image-2.6-sunburst-openrouter";
}

export function getGptImage26MaxFrames(model: string) {
  return model === APIMART_GPT_IMAGE_26_MODEL_ID ? 16 : 64;
}

function getApimartGifSheetLayout(frameCount: number) {
  return frameCount <= 8 ? [4, 2] : frameCount === 9 ? [3, 3] : frameCount <= 12 ? [4, 3] : [4, 4];
}

// Largest exact-ratio frame on the documented APIMart sheet, aligned to 16 pixels.
export function getApimartGptImage26GifMaxSize(ratio: string, frameCount: number, maxFrameEdge = 3840): string | null {
  if (!Number.isInteger(frameCount) || frameCount < 2 || frameCount > 16
    || !["1:1", "16:9", "9:16", "4:3", "3:4"].includes(ratio)) return null;
  const [rw, rh] = ratio.split(":").map(Number);
  const [columns, rows] = getApimartGifSheetLayout(frameCount);
  const scales = [[columns, rows], [rows, columns]].map(([c, r]) => {
    const w = rw * 16 * c, h = rh * 16 * r;
    if (Math.max(w, h) / Math.min(w, h) > 3) return 0;
    return Math.floor(Math.min(3840 / w, 3840 / h, Math.sqrt(8_294_400 / (w * h))));
  });
  const scale = Math.min(Math.max(...scales), Math.floor(maxFrameEdge / (Math.max(rw, rh) * 16)));
  return scale > 0 ? `${rw * 16 * scale}x${rh * 16 * scale}` : null;
}

// https://docs.apimart.ai/cn/api-reference/images/gpt-image-2.6/generation
// https://openrouter.ai/docs/guides/overview/multimodal/image-generation
export function buildGptImage26GifParams(input: GptImage26AnimationSettings & {
  model?: string; outputFormat?: string; background?: string;
}) {
  if (input.outputFormat !== "gif") return null;
  const model = input.model || "";
  if (!supportsGptImage26Gif(model)) throw new Error("GIF 输出请选择 GPT-Image-2.6 模型");
  const frameCount = input.frameCount ?? 9;
  const maxFrames = getGptImage26MaxFrames(model);
  if (!Number.isInteger(frameCount) || frameCount < 2 || frameCount > maxFrames) throw new Error(`GIF 帧数请选择 2–${maxFrames} 的整数`);
  const frameDurationMs = input.frameDurationMs ?? 200;
  if (!Number.isInteger(frameDurationMs) || frameDurationMs < 20 || (model === APIMART_GPT_IMAGE_26_MODEL_ID && frameDurationMs % 10)
    || (model !== APIMART_GPT_IMAGE_26_MODEL_ID && frameDurationMs > 2000)) {
    throw new Error("GIF 每帧时长需为至少 20 毫秒、10 的整数倍；OpenRouter 上限为 2000 毫秒");
  }
  if (input.background === "transparent") throw new Error("GIF 动图背景请选择自适应或不透明");
  const size = input.gifSize?.trim().toLowerCase() || "512x512";
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) throw new Error("GIF 单帧尺寸请填写像素宽高，例如 512x512");
  const width = Number(match[1]), height = Number(match[2]);
  if (!width || !height || width % 16 || height % 16) throw new Error("GIF 单帧尺寸宽高需为 16 的整数倍");
  if (model === APIMART_GPT_IMAGE_26_MODEL_ID) {
    const [columns, rows] = getApimartGifSheetLayout(frameCount);
    const fits = (c: number, r: number) => {
      const w = width * c, h = height * r;
      return w <= 3840 && h <= 3840 && w * h <= 8_294_400 && Math.max(w, h) / Math.min(w, h) <= 3;
    };
    if (!fits(columns, rows) && !fits(rows, columns)) throw new Error("GIF 尺寸与帧数超出拼图上限，请减小单帧尺寸或帧数");
  }
  return { output_format: "gif" as const, size, frame_count: frameCount, frame_duration_ms: frameDurationMs };
}
