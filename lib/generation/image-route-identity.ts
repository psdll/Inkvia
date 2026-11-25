import { isSeedream55Model, VOLC_SEEDREAM_55_MODEL, VOLC_SEEDREAM_55_UPSTREAM } from "@/lib/volcengine-seedream-55";
import { APIMART_SEEDREAM_55_UPSTREAM } from "@/lib/apimart-seedream-55";
import { DOUBAO_SEEDREAM_5_PRO_MODEL } from "@/lib/toolbox-models";
import { buildOpenRouterImageRequest } from "@/lib/openrouter-image";
import { getOpenRouterImageModel } from "@/lib/openrouter-image-params";
import { isQwenImage3Model, normalizeQwenImage3Params } from "@/lib/qwen-image-3-models";
import { REAPI_GPT_IMAGE_25_MODEL_ID, isGptImageVariantModel, normalizeGptImage25Mode } from "@/lib/gpt-image-25-models";
import { buildReapiGptImage25Request } from "@/lib/reapi-gpt-image-25";
import { isAicomingGptImage25Model, buildAicomingHaiyaGptImage25Request } from "@/lib/aicoming-gpt-image-25";
import { isApimartGptImageVariantModel, buildApimartGptImageVariantRequest } from "@/lib/apimart-gpt-image-25";
import { AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID, AICOMING_HAIYA_GPT_IMAGE_2_UPSTREAM_MODELS, AICOMING_HAIYA_NANO_BANANA_PRO_MODEL_ID, AICOMING_HAIYA_NANO_BANANA_PRO_UPSTREAM_MODEL } from "@/lib/aicoming-merchant-models";
import { isMidjourneyV8Model, MIDJOURNEY_V8_UPSTREAM_MODEL } from "@/lib/midjourney-v8";
import { REAPI_GPT_IMAGE_2_MODEL_ID, GPT_IMAGE_2_OFFICIAL_UPSTREAM_MODEL, normalizeGptImage2OfficialParams } from "@/lib/gpt-image-2-official";
import { isTuziGptImage2Model, TUZI_GPT_IMAGE_2_UPSTREAM_MODEL } from "@/lib/tuzi-image-params";
import { isEasyRouterImageModel, EASYROUTER_GPT_IMAGE_2_MODEL_ID } from "@/lib/easyrouter-image";
import { isGoogleAiStudioImageModel } from "@/lib/google-ai-studio-image";
import { JIEKOU_GPT_IMAGE_2_MODEL_ID, JIEKOU_GPT_IMAGE_2_EDIT_MODEL, JIEKOU_GPT_IMAGE_2_TEXT_MODEL } from "@/lib/jiekou-image";
import { isApimartImageModel } from "@/lib/apimart-image";
import { isApimartNanoBananaProModel, APIMART_NANO_BANANA_PRO_UPSTREAM_MODEL } from "@/lib/apimart-image-models";
import { APIMART_NANO_BANANA_21_MODEL, APIMART_NANO_BANANA_21_UPSTREAM } from "@/lib/nano-banana-21-providers";
import { getApimartImageModel } from "@/lib/config";

type ImageRouteInput = { seedream55?: import("@/lib/apimart-seedream-55").Seedream55Settings; model: string; referenceCount?: number; prompt?: string; quality?: string; resolution?: string; aspectRatio?: string; background?: string; gptImage25Mode?: string };
/** Extracted from image-service's actual route-dependent snapshot; no labels or ranking. */
export function imageProviderRequestContract(input: ImageRouteInput): { providerModel: string; declaredOutputCount?: number; maxOutputCount?: number; outputBasis?: string } {
  const { model } = input;
  if (isSeedream55Model(model)) return { providerModel: model === VOLC_SEEDREAM_55_MODEL ? VOLC_SEEDREAM_55_UPSTREAM : APIMART_SEEDREAM_55_UPSTREAM, ...(input.seedream55?.layerDecomposition ? { maxOutputCount: input.seedream55.layerMaxImages ?? 30, outputBasis: "layer_decomposition_max_images" } : { declaredOutputCount: 1 }) };
  // The normal operation has one image; Agent does not expose layer_decomposition.
  // https://docs.volcengine.com/docs/ark/image-generation-api?lang=en
  if (model === DOUBAO_SEEDREAM_5_PRO_MODEL) return { providerModel: model, declaredOutputCount: 1, outputBasis: "provider_single_image_operation" };
  const openRouter = getOpenRouterImageModel(model);
  // Images API n is the declared upper bound; native Google generateContent is a different contract.
  if (openRouter) { const request = buildOpenRouterImageRequest({ ...input, prompt: input.prompt || "输入能力校验" }); return { providerModel: request.body.model, declaredOutputCount: request.body.n }; }
  if (isQwenImage3Model(model)) return { providerModel: normalizeQwenImage3Params(input).providerModel };
  const params = { ...input, prompt: input.prompt || "输入能力校验", mode: isGptImageVariantModel(model) ? normalizeGptImage25Mode(input.gptImage25Mode, model) : undefined, outputFormat: "png" };
  if (model === REAPI_GPT_IMAGE_25_MODEL_ID) { const request = buildReapiGptImage25Request(params); return { providerModel: request.body.model, declaredOutputCount: request.body.n }; }
  if (isAicomingGptImage25Model(model)) { const request = buildAicomingHaiyaGptImage25Request(params); return { providerModel: request.body.model }; }
  if (model === AICOMING_HAIYA_NANO_BANANA_PRO_MODEL_ID) return { providerModel: AICOMING_HAIYA_NANO_BANANA_PRO_UPSTREAM_MODEL };
  if (model === AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID) return { providerModel: AICOMING_HAIYA_GPT_IMAGE_2_UPSTREAM_MODELS[normalizeGptImage2OfficialParams(input).resolution] };
  if (isMidjourneyV8Model(model)) return { providerModel: MIDJOURNEY_V8_UPSTREAM_MODEL };
  if (model === REAPI_GPT_IMAGE_2_MODEL_ID) return { providerModel: GPT_IMAGE_2_OFFICIAL_UPSTREAM_MODEL };
  if (isTuziGptImage2Model(model)) return { providerModel: TUZI_GPT_IMAGE_2_UPSTREAM_MODEL };
  if (isEasyRouterImageModel(model)) return { providerModel: EASYROUTER_GPT_IMAGE_2_MODEL_ID };
  if (isGoogleAiStudioImageModel(model)) return { providerModel: model };
  if (model === JIEKOU_GPT_IMAGE_2_MODEL_ID) return { providerModel: input.referenceCount ? JIEKOU_GPT_IMAGE_2_EDIT_MODEL : JIEKOU_GPT_IMAGE_2_TEXT_MODEL };
  if (isApimartGptImageVariantModel(model)) { const request = buildApimartGptImageVariantRequest(params); return { providerModel: request.model, declaredOutputCount: request.n }; }
  if (isApimartImageModel(model)) return { providerModel: model === APIMART_NANO_BANANA_21_MODEL ? APIMART_NANO_BANANA_21_UPSTREAM : isApimartNanoBananaProModel(model) ? APIMART_NANO_BANANA_PRO_UPSTREAM_MODEL : getApimartImageModel() };
  return { providerModel: model === "gpt-image-2" ? input.referenceCount ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image" : model };
}

export function imageProviderSnapshotModel(input: ImageRouteInput): string {
  return imageProviderRequestContract(input).providerModel;
}

/** Exact KIE GPT2 size normalization used by image-service's request body. */
export function normalizeKieGptImage2Size(input: { model: string; aspectRatio?: string; resolution?: string }) {
  if (!["gpt-image-2", "gpt-image-2-text-to-image", "gpt-image-2-image-to-image"].includes(input.model)) return input;
  const aspectRatio = ["auto", "1:1", "9:16", "16:9", "4:3", "3:4"].includes(input.aspectRatio || "") ? input.aspectRatio! : "auto";
  let resolution = ["1K", "2K", "4K"].includes(input.resolution || "") ? input.resolution! : "1K";
  if (aspectRatio === "auto") resolution = "1K";
  if (aspectRatio === "1:1" && resolution === "4K") resolution = "2K";
  return { ...input, aspectRatio, resolution };
}
