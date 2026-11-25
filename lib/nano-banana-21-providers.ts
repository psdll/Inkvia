import { GOOGLE_NANO_BANANA_21_RATIOS, GOOGLE_NANO_BANANA_21_RESOLUTIONS } from "@/lib/google-nano-banana-21";

// Exact provider contracts verified 2026-10-13; see docs/nano-banana-21-providers.md.
export const KIE_NANO_BANANA_21_MODEL = "nano-banana-2-1";
export const APIMART_NANO_BANANA_21_MODEL = "gemini-nano-banana-2.1-apimart";
export const OPENROUTER_NANO_BANANA_21_MODEL = "gemini-nano-banana-2.1-openrouter";
export const APIMART_NANO_BANANA_21_UPSTREAM = "gemini-nano-banana-2.1";
export const NANO_BANANA_21_PROVIDER_MODELS = [KIE_NANO_BANANA_21_MODEL, APIMART_NANO_BANANA_21_MODEL, OPENROUTER_NANO_BANANA_21_MODEL];
export const isProviderNanoBanana21 = (model: string) => NANO_BANANA_21_PROVIDER_MODELS.includes(model);
export const NANO_BANANA_21_RATIOS = GOOGLE_NANO_BANANA_21_RATIOS;
export const NANO_BANANA_21_RESOLUTIONS = GOOGLE_NANO_BANANA_21_RESOLUTIONS;

type Input = { prompt: string; aspectRatio?: string; resolution?: string; imageUrls?: string[] };
export function validateProviderNanoBanana21(model: string, input: { prompt?: string; aspectRatio?: string; resolution?: string; referenceCount: number }) {
  if (input.aspectRatio && !NANO_BANANA_21_RATIOS.includes(input.aspectRatio)) throw new Error("Nano Banana 2.1 不支持该宽高比");
  if (input.resolution && !NANO_BANANA_21_RESOLUTIONS.includes(input.resolution)) throw new Error("Nano Banana 2.1 仅支持 1K、2K、4K 分辨率");
  const limit = model === KIE_NANO_BANANA_21_MODEL ? 10 : model === OPENROUTER_NANO_BANANA_21_MODEL ? 14 : undefined;
  if (limit && input.referenceCount > limit) throw new Error(`Nano Banana 2.1 最多支持 ${limit} 张参考图`);
  if (model === KIE_NANO_BANANA_21_MODEL && (input.prompt?.length || 0) > 20000) throw new Error("Nano Banana 2.1（Kie）提示词不能超过 20000 字符");
}
export function buildKieNanoBanana21Request(input: Input) {
  validateProviderNanoBanana21(KIE_NANO_BANANA_21_MODEL, { ...input, referenceCount: input.imageUrls?.length || 0 });
  return { model: KIE_NANO_BANANA_21_MODEL, input: {
    prompt: input.prompt, aspect_ratio: input.aspectRatio || "auto", resolution: input.resolution || "1K", output_format: "png",
    ...(input.imageUrls?.length ? { image_input: input.imageUrls } : {}),
  } };
}
export function buildApimartNanoBanana21Request(input: Input) {
  validateProviderNanoBanana21(APIMART_NANO_BANANA_21_MODEL, { ...input, referenceCount: input.imageUrls?.length || 0 });
  return { model: APIMART_NANO_BANANA_21_UPSTREAM, prompt: input.prompt, size: input.aspectRatio || "auto", resolution: input.resolution || "1K", n: 1,
    ...(input.imageUrls?.length ? { image_urls: input.imageUrls } : {}),
  };
}
