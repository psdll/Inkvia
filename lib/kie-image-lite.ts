export const NANO_BANANA_2_LITE_MODEL = "nano-banana-2-lite";

export const NANO_BANANA_2_LITE_ASPECT_RATIOS = [
  "1:1",
  "1:4",
  "1:8",
  "2:3",
  "3:2",
  "3:4",
  "4:1",
  "4:3",
  "4:5",
  "5:4",
  "8:1",
  "9:16",
  "16:9",
  "21:9",
  "auto",
] as const;

const NANO_BANANA_2_LITE_ASPECT_RATIO_SET = new Set<string>(NANO_BANANA_2_LITE_ASPECT_RATIOS);

function cleanString(value: unknown) {
  return String(value || "").trim();
}

export function normalizeNanoBanana2LiteAspectRatio(value: unknown) {
  const text = cleanString(value);
  return NANO_BANANA_2_LITE_ASPECT_RATIO_SET.has(text) ? text : "auto";
}

export function buildNanoBanana2LiteKieInput(input: {
  prompt: string;
  imageUrls?: string[];
  aspectRatio?: string;
}) {
  const imageUrls = Array.isArray(input.imageUrls)
    ? input.imageUrls.map((url) => cleanString(url)).filter(Boolean)
    : [];
  if (imageUrls.length > 10) {
    throw new Error("nano-banana-2-lite最多支持10张参考图");
  }
  return {
    prompt: cleanString(input.prompt),
    image_urls: imageUrls,
    aspect_ratio: normalizeNanoBanana2LiteAspectRatio(input.aspectRatio),
  };
}
