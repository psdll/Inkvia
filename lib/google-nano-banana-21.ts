// https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1 (2026-10-09)
export const GOOGLE_NANO_BANANA_21_MODEL = "gemini-nano-banana-2.1";
export const GOOGLE_NANO_BANANA_21_RATIOS = ["auto", "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];
export const GOOGLE_NANO_BANANA_21_RESOLUTIONS = ["1K", "2K", "4K"];
export const GOOGLE_NANO_BANANA_21_MAX_REFERENCES = 14;

export function validateGoogleNanoBanana21Input(input: { aspectRatio?: string; resolution?: string; referenceCount: number }) {
  if (input.referenceCount > GOOGLE_NANO_BANANA_21_MAX_REFERENCES) throw new Error("Nano Banana 2.1 最多支持 14 张参考图");
  if (input.aspectRatio && !GOOGLE_NANO_BANANA_21_RATIOS.includes(input.aspectRatio)) throw new Error("Nano Banana 2.1 不支持该宽高比");
  if (input.resolution && !GOOGLE_NANO_BANANA_21_RESOLUTIONS.includes(input.resolution)) throw new Error("Nano Banana 2.1 仅支持 1K、2K、4K 分辨率");
}
