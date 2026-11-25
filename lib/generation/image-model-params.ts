import { isSeedream55Model, VOLC_SEEDREAM_55_MODEL } from "@/lib/volcengine-seedream-55";
import { APIMART_SEEDREAM_55_MODEL, SEEDREAM_55_RATIOS, SEEDREAM_55_RESOLUTIONS } from "@/lib/apimart-seedream-55";
import { KIE_NANO_BANANA_21_MODEL, APIMART_NANO_BANANA_21_MODEL, NANO_BANANA_21_RATIOS } from "@/lib/nano-banana-21-providers";
import { getGoogleImageOptions } from "@/lib/google-image-settings";
import { GOOGLE_NANO_BANANA_21_MODEL, GOOGLE_NANO_BANANA_21_RATIOS, GOOGLE_NANO_BANANA_21_RESOLUTIONS } from "@/lib/google-nano-banana-21";
import { isOpenRouterImageModel, getOpenRouterImageParams } from "@/lib/openrouter-image-params";
import { QWEN_IMAGE_3_MODEL_ID, QWEN_IMAGE_3_RATIOS, QWEN_IMAGE_3_RESOLUTIONS, QWEN_IMAGE_3_QUALITIES, isQwenImage3Model } from "@/lib/qwen-image-3-models";
import { QWEN_IMAGE_21_MODEL_ID, QWEN_IMAGE_21_RATIOS, QWEN_IMAGE_21_RESOLUTIONS, isQwenImage21Model } from "@/lib/work-fisher-image-params";
import {
  EASYROUTER_IMAGE_2_ASPECT_RATIOS,
  EASYROUTER_IMAGE_2_RESOLUTIONS,
} from "@/lib/easyrouter-image-params";
import {
  AICOMING_HAIYA_GPT_IMAGE_2_RATIOS,
  REAPI_GPT_IMAGE_2_MODEL_ID,
  REAPI_GPT_IMAGE_2_RATIOS,
  getGptImage2OfficialRatios,
  isGptImage2OfficialProviderModel,
  isGptImage2OfficialSizeComboValid,
} from "@/lib/gpt-image-2-official";
import { AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID } from "@/lib/aicoming-merchant-models";
import {
  APIMART_GPT_IMAGE_26_MODEL_ID,
  APIMART_NANO_BANANA_PRO_ASPECT_RATIO_VALUES,
  APIMART_NANO_BANANA_PRO_MODEL_ID,
  APIMART_NANO_BANANA_PRO_RESOLUTION_VALUES,
} from "@/lib/apimart-image-models";
import { APIMART_MIDJOURNEY_V8_MODEL_ID, MIDJOURNEY_V8_MODEL_ID, MIDJOURNEY_V8_RATIOS } from "@/lib/midjourney-v8";
import {
  TUZI_GPT_IMAGE_2_ASPECT_RATIOS,
  TUZI_GPT_IMAGE_2_MODEL_ID,
  TUZI_GPT_IMAGE_2_RESOLUTIONS,
  getTuziGptImage2Ratios,
  isTuziGptImage2Model,
  isTuziGptImage2SizeComboValid,
} from "@/lib/tuzi-image-params";

import { REAPI_GPT_IMAGE_25_MODEL_ID } from "@/lib/gpt-image-25-models";
import { REAPI_GPT_IMAGE_25_RATIOS } from "@/lib/reapi-gpt-image-25";
import { APIMART_GPT_IMAGE_25_MODEL_ID } from "@/lib/apimart-gpt-image-25";
import { GPT_IMAGE_25_BACKGROUND_OPTIONS, supportsGptImage25Background, GPT_IMAGE_25_RATIOS, getGptImage25QualityOptions, isGptImageVariantModel } from "@/lib/gpt-image-25-models";
import { AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID } from "@/lib/aicoming-merchant-models";
import { AICOMING_GPT_IMAGE_25_RATIOS } from "@/lib/aicoming-gpt-image-25";

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type ImageModelParams = {
  aspectRatios: SelectOption[];
  resolutions: SelectOption[];
  qualities: SelectOption[];
  backgrounds?: SelectOption[];
  defaultAspectRatio: string;
  defaultResolution: string;
  defaultQuality: string;
};

const option = (value: string, label = value): SelectOption => ({ value, label });
const ratios = (values: string[]) => values.map((value) => option(value, value === "auto" ? "自适应" : value));
const resolutions = (values: string[]) => values.map((value) => option(value, value === "auto" ? "自适应" : value));

const NANO_RATIOS = ["auto", "1:1", "4:1", "8:1", "3:4", "1:4", "4:3", "16:9", "9:16", "3:2", "2:3"];
const NANO_PRO_RATIOS = ["auto", "1:1", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3"];
const NANO_LITE_RATIOS = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9", "auto"];
const GPT_RATIOS = ["auto", "1:1", "9:16", "16:9", "4:3", "3:4"];
const EASYROUTER_IMAGE_2_RATIOS = [...EASYROUTER_IMAGE_2_ASPECT_RATIOS, "custom"];
const GPT_EXTENDED_RATIOS = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21"];
const GPT_JIEKOU_RATIOS = ["auto", "1:1", "2:3", "3:2", "16:9", "9:16", "4:3", "3:4", "21:9", "9:21", "1:3", "3:1", "2:1", "1:2"];
const SEEDREAM_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3", "21:9"];
const QUALITY_OPTIONS = [option("low", "快速"), option("medium", "标准画质"), option("high", "高画质")];

const ratioValuesByModel: Record<string, string[]> = {
  [VOLC_SEEDREAM_55_MODEL]: [...SEEDREAM_55_RATIOS, "custom"],
  [APIMART_SEEDREAM_55_MODEL]: [...SEEDREAM_55_RATIOS, "custom"],
  [KIE_NANO_BANANA_21_MODEL]: NANO_BANANA_21_RATIOS,
  [APIMART_NANO_BANANA_21_MODEL]: NANO_BANANA_21_RATIOS,
  [GOOGLE_NANO_BANANA_21_MODEL]: GOOGLE_NANO_BANANA_21_RATIOS,
  [QWEN_IMAGE_3_MODEL_ID]: QWEN_IMAGE_3_RATIOS,
  [QWEN_IMAGE_21_MODEL_ID]: [...QWEN_IMAGE_21_RATIOS],
  "nano-banana-pro": NANO_PRO_RATIOS,
  [APIMART_NANO_BANANA_PRO_MODEL_ID]: [...APIMART_NANO_BANANA_PRO_ASPECT_RATIO_VALUES],
  "nano-banana-2": NANO_RATIOS,
  "nano-banana-2-lite": NANO_LITE_RATIOS,
  "gemini-3.1-flash-image": NANO_RATIOS,
  "gemini-3.1-flash-lite-image": NANO_LITE_RATIOS,
  "gemini-3-pro-image": NANO_RATIOS,
  "gpt-image-2": GPT_RATIOS,
  "gpt-image-2-apimart": GPT_EXTENDED_RATIOS,
  [APIMART_GPT_IMAGE_25_MODEL_ID]: [...GPT_IMAGE_25_RATIOS],
  [APIMART_GPT_IMAGE_26_MODEL_ID]: [...GPT_IMAGE_25_RATIOS],
  [AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID]: [...AICOMING_GPT_IMAGE_25_RATIOS],
  [REAPI_GPT_IMAGE_25_MODEL_ID]: [...REAPI_GPT_IMAGE_25_RATIOS],
  "gpt-image-2-jiekou": GPT_JIEKOU_RATIOS,
  [REAPI_GPT_IMAGE_2_MODEL_ID]: [...REAPI_GPT_IMAGE_2_RATIOS],
  [APIMART_MIDJOURNEY_V8_MODEL_ID]: [...MIDJOURNEY_V8_RATIOS],
  [MIDJOURNEY_V8_MODEL_ID]: [...MIDJOURNEY_V8_RATIOS],
  [AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID]: [...AICOMING_HAIYA_GPT_IMAGE_2_RATIOS],
  [TUZI_GPT_IMAGE_2_MODEL_ID]: [...TUZI_GPT_IMAGE_2_ASPECT_RATIOS],
  "image 2": EASYROUTER_IMAGE_2_RATIOS,
  "doubao-seedream-5.0-pro": SEEDREAM_RATIOS,
  "doubao-seedream-5.0-lite": SEEDREAM_RATIOS,
  "doubao-seedream-4.5": SEEDREAM_RATIOS,
  "doubao-seedream-4.0": SEEDREAM_RATIOS,
};

const resolutionValuesByModel: Record<string, string[]> = {
  [VOLC_SEEDREAM_55_MODEL]: SEEDREAM_55_RESOLUTIONS,
  [APIMART_SEEDREAM_55_MODEL]: SEEDREAM_55_RESOLUTIONS,
  [GOOGLE_NANO_BANANA_21_MODEL]: GOOGLE_NANO_BANANA_21_RESOLUTIONS,
  [QWEN_IMAGE_3_MODEL_ID]: QWEN_IMAGE_3_RESOLUTIONS,
  [QWEN_IMAGE_21_MODEL_ID]: [...QWEN_IMAGE_21_RESOLUTIONS],
  [APIMART_NANO_BANANA_PRO_MODEL_ID]: [...APIMART_NANO_BANANA_PRO_RESOLUTION_VALUES],
  [APIMART_MIDJOURNEY_V8_MODEL_ID]: ["auto"],
  [MIDJOURNEY_V8_MODEL_ID]: ["auto"],
  [TUZI_GPT_IMAGE_2_MODEL_ID]: [...TUZI_GPT_IMAGE_2_RESOLUTIONS],
  "image 2": [...EASYROUTER_IMAGE_2_RESOLUTIONS],
  "nano-banana-2-lite": ["1K"],
  "gemini-3.1-flash-lite-image": ["1K"],
  "doubao-seedream-5.0-pro": ["1K", "2K"],
  "doubao-seedream-5.0-lite": ["2K", "3K"],
  "doubao-seedream-4.5": ["2K", "4K"],
};

const qualityModels = new Set(["gpt-image-2-apimart", "gpt-image-2-jiekou", REAPI_GPT_IMAGE_2_MODEL_ID, AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID, TUZI_GPT_IMAGE_2_MODEL_ID, "image 2"]);

function isJiekouSizeComboValid(aspectRatio: string, resolution: string) {
  if (aspectRatio === "auto") return true;
  const allowed: Record<string, string[]> = {
    "1K": ["1:1", "2:3", "3:2"],
    "2K": ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "21:9", "9:21", "1:3", "3:1", "2:1", "1:2"],
    "4K": ["16:9", "9:16"],
  };
  return (allowed[resolution] || []).includes(aspectRatio);
}

export function getImageModelParams(
  model: string,
  selectedResolution?: string,
  selectedAspectRatio?: string,
): ImageModelParams {
  if (isOpenRouterImageModel(model)) return getOpenRouterImageParams(model, selectedAspectRatio);
  const google = getGoogleImageOptions(model);
  const rawAspectRatios = ratios(google?.ratios || ratioValuesByModel[model] || NANO_PRO_RATIOS);
  const rawResolutions = resolutions(google?.resolutions || resolutionValuesByModel[model] || ["1K", "2K", "4K"]);
  const visibleAspectRatios = isTuziGptImage2Model(model) && selectedResolution
    ? rawAspectRatios.filter((item) => getTuziGptImage2Ratios(selectedResolution).includes(item.value))
    : isGptImage2OfficialProviderModel(model) && selectedResolution
      ? rawAspectRatios.filter((item) => getGptImage2OfficialRatios(model, selectedResolution).includes(item.value))
      : rawAspectRatios;
  const aspectRatios = model === "gpt-image-2-jiekou" && selectedResolution
    ? visibleAspectRatios.map((item) => ({ ...item, disabled: !isJiekouSizeComboValid(item.value, selectedResolution) }))
    : isTuziGptImage2Model(model) && selectedResolution
      ? visibleAspectRatios.map((item) => ({
          ...item,
          disabled: !isTuziGptImage2SizeComboValid(item.value, selectedResolution),
        }))
      : isGptImage2OfficialProviderModel(model) && selectedResolution
        ? visibleAspectRatios.map((item) => ({
            ...item,
            disabled: !isGptImage2OfficialSizeComboValid(model, item.value, selectedResolution),
          }))
        : visibleAspectRatios;
  const modelResolutions = model === "gpt-image-2-jiekou" && selectedAspectRatio
    ? rawResolutions.map((item) => ({ ...item, disabled: !isJiekouSizeComboValid(selectedAspectRatio, item.value) }))
    : isTuziGptImage2Model(model) && selectedAspectRatio
      ? rawResolutions.map((item) => ({
          ...item,
          disabled: !isTuziGptImage2SizeComboValid(selectedAspectRatio, item.value),
        }))
      : isGptImage2OfficialProviderModel(model) && selectedAspectRatio
        ? rawResolutions.map((item) => ({
            ...item,
            disabled: !isGptImage2OfficialSizeComboValid(model, selectedAspectRatio, item.value),
          }))
        : rawResolutions;
  const qualities = isQwenImage3Model(model) ? QWEN_IMAGE_3_QUALITIES : isGptImageVariantModel(model) ? getGptImage25QualityOptions(model) : qualityModels.has(model) ? QUALITY_OPTIONS : [];
  const defaultResolution = modelResolutions.some((item) => item.value === "2K") ? "2K" : modelResolutions[0]?.value || "1K";
  return {
    ...(isSeedream55Model(model) ? { maxReferences: 10 } : {}),
    aspectRatios,
    resolutions: modelResolutions,
    qualities,
    ...((isSeedream55Model(model) || supportsGptImage25Background(model)) ? { backgrounds: GPT_IMAGE_25_BACKGROUND_OPTIONS } : {}),
    defaultAspectRatio: isQwenImage3Model(model) ? "1:1" : isQwenImage21Model(model) ? "3:4" : aspectRatios[0]?.value || "auto",
    defaultResolution,
    defaultQuality: isQwenImage3Model(model) ? "standard" : qualities.some((item) => item.value === "medium") ? "medium" : "",
  };
}

export function normalizeImageQuality(model: string, quality: string): string {
  const params = getImageModelParams(model);
  return params.qualities.some((item) => item.value === quality)
    ? quality
    : params.defaultQuality;
}
