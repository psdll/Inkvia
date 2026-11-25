import { VOLC_SEEDREAM_55_MODEL, VOLC_SEEDREAM_55_UPSTREAM } from "@/lib/volcengine-seedream-55";
import { APIMART_SEEDREAM_55_MODEL, APIMART_SEEDREAM_55_UPSTREAM } from "@/lib/apimart-seedream-55";
import { SUNO_MODELS } from "@/lib/suno-models";
import { VOLC_ASR_MODEL_ID, VOLC_ASR_MODEL_LABEL } from "@/lib/volcengine-asr-models";
import { KIE_NANO_BANANA_21_MODEL, APIMART_NANO_BANANA_21_MODEL, APIMART_NANO_BANANA_21_UPSTREAM } from "@/lib/nano-banana-21-providers";
import { GOOGLE_NANO_BANANA_21_MODEL } from "@/lib/google-nano-banana-21";
import { OPENROUTER_IMAGE_MODELS } from "@/lib/openrouter-image-params";
import { REAPI_GPT_IMAGE_25_MODEL_ID, REAPI_GPT_IMAGE_25_LABEL, REAPI_GPT_IMAGE_25_UPSTREAM_MODELS, type GptImage25VariantOptions } from "@/lib/gpt-image-25-models";
import { APIMART_GPT_IMAGE_25_MODEL_ID, APIMART_GPT_IMAGE_25_LABEL, APIMART_GPT_IMAGE_25_UPSTREAM_MODELS } from "@/lib/apimart-gpt-image-25";
import { sora2Models, type Sora2ResolutionValue } from "@/lib/sora2";
import {
  AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID,
  AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID,
  AICOMING_HAIYA_GPT_IMAGE_25_LABEL,
  AICOMING_HAIYA_GPT_IMAGE_25_UPSTREAM_MODELS,
  AICOMING_HAIYA_GPT_IMAGE_2_UPSTREAM_MODELS,
  AICOMING_HAIYA_NANO_BANANA_PRO_MODEL_ID,
  AICOMING_HAIYA_NANO_BANANA_PRO_UPSTREAM_MODEL,
  AICOMING_HAIYA_PROVIDER_ID,
} from "@/lib/aicoming-merchant-models";
import {
  APIMART_MIDJOURNEY_V8_MODEL_ID,
  APIMART_MIDJOURNEY_V8_MODEL_LABEL,
  MIDJOURNEY_V8_MODEL_ID,
  MIDJOURNEY_V8_MODEL_LABEL,
  MIDJOURNEY_V8_UPSTREAM_MODEL,
} from "@/lib/midjourney-v8";
import {
  APIMART_GPT_IMAGE_26_MODEL_ID,
  APIMART_GPT_IMAGE_26_LABEL,
  APIMART_GPT_IMAGE_26_UPSTREAM_MODELS,
  APIMART_NANO_BANANA_PRO_MODEL_ID,
  APIMART_NANO_BANANA_PRO_UPSTREAM_MODEL,
} from "@/lib/apimart-image-models";
import {
  MINIMAX_SPEECH_HD_MODEL_ID,
  MINIMAX_SPEECH_TURBO_MODEL_ID,
} from "@/lib/minimax-speech-models";

export const GOOGLE_AI_STUDIO_FLASH_IMAGE_MODEL = "gemini-3.1-flash-image";
export const GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL = "gemini-3.1-flash-lite-image";
export const GOOGLE_AI_STUDIO_PRO_IMAGE_MODEL = "gemini-3-pro-image";
export const DOUBAO_SEEDREAM_5_PRO_MODEL = "doubao-seedream-5.0-pro";
export const DOUBAO_SEEDREAM_5_LITE_MODEL = "doubao-seedream-5.0-lite";

export type ToolboxModelCategory = "face" | "image" | "video" | "audio";
export type ToolboxModelProvider = "openrouter" | "work-fisher" | "kie" | "volcengine" | "volcengine-speech" | "google-ai-studio" | "apimart" | "jiekou" | "easyrouter" | "reapi" | "aicoming-haiya" | "minimax" | "tuzi" | "bailian";

export type ToolboxModelDefinition = GptImage25VariantOptions & {
  id: string;
  label: string;
  provider: ToolboxModelProvider;
  category: ToolboxModelCategory;
  supportedResolutions?: Sora2ResolutionValue[];
  maxDurationSeconds?: number;
  allowAutoDuration?: boolean;
  /** Upstream provider model ID when it differs from the local adapter key. */
  upstreamModelId?: string;
  /** All upstream model IDs used by one local adapter across parameter tiers. */
  upstreamModelIds?: string[];
  /** 语音识别：只给 Agent 拆解视频用，不出现在画布音频生成的模型列表里 */
  purpose?: "speech-recognition";
};

export type ImageEditModelDefinition = ToolboxModelDefinition & {
  provider: "openrouter" | "bailian" | "work-fisher" | "kie" | "volcengine" | "google-ai-studio" | "apimart" | "jiekou" | "easyrouter" | "reapi" | "aicoming-haiya" | "tuzi";
  category: "image";
};

export const IMAGE_EDIT_MODEL_DEFINITIONS: ImageEditModelDefinition[] = [
  { id: "nano-banana-pro", label: "nano-banana-pro（ke）", provider: "kie", category: "image" },
  { id: "gpt-image-2", label: "GPT-Image-2（ke）", provider: "kie", category: "image" },
  { id: APIMART_GPT_IMAGE_25_MODEL_ID, label: APIMART_GPT_IMAGE_25_LABEL, provider: "apimart", category: "image", upstreamModelId: APIMART_GPT_IMAGE_25_UPSTREAM_MODELS.flare, upstreamModelIds: Object.values(APIMART_GPT_IMAGE_25_UPSTREAM_MODELS) },
  { id: APIMART_GPT_IMAGE_26_MODEL_ID, label: APIMART_GPT_IMAGE_26_LABEL, provider: "apimart", category: "image", upstreamModelId: APIMART_GPT_IMAGE_26_UPSTREAM_MODELS.flare, upstreamModelIds: Object.values(APIMART_GPT_IMAGE_26_UPSTREAM_MODELS) },
  { id: "gpt-image-2-apimart", label: "GPT-Image-2（am）", provider: "apimart", category: "image" },
  { id: VOLC_SEEDREAM_55_MODEL, label: "Seedream-5.5（火山官方）", provider: "volcengine", category: "image", upstreamModelId: VOLC_SEEDREAM_55_UPSTREAM },
  { id: APIMART_SEEDREAM_55_MODEL, label: "Seedream-5.5（am）", provider: "apimart", category: "image", upstreamModelId: APIMART_SEEDREAM_55_UPSTREAM },
  { id: APIMART_NANO_BANANA_PRO_MODEL_ID, label: "nano-banana-pro（am）", provider: "apimart", category: "image", upstreamModelId: APIMART_NANO_BANANA_PRO_UPSTREAM_MODEL },
  { id: REAPI_GPT_IMAGE_25_MODEL_ID, label: REAPI_GPT_IMAGE_25_LABEL, provider: "reapi", category: "image", upstreamModelId: REAPI_GPT_IMAGE_25_UPSTREAM_MODELS.flare, upstreamModelIds: Object.values(REAPI_GPT_IMAGE_25_UPSTREAM_MODELS) },
  { id: APIMART_MIDJOURNEY_V8_MODEL_ID, label: APIMART_MIDJOURNEY_V8_MODEL_LABEL, provider: "apimart", category: "image", upstreamModelId: MIDJOURNEY_V8_UPSTREAM_MODEL },
  { id: MIDJOURNEY_V8_MODEL_ID, label: MIDJOURNEY_V8_MODEL_LABEL, provider: "reapi", category: "image", upstreamModelId: MIDJOURNEY_V8_UPSTREAM_MODEL },
  {
    id: AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID,
    label: "GPT-Image-2（hai）",
    provider: AICOMING_HAIYA_PROVIDER_ID,
    category: "image",
    upstreamModelId: AICOMING_HAIYA_GPT_IMAGE_2_UPSTREAM_MODELS["1K"],
    upstreamModelIds: Object.values(AICOMING_HAIYA_GPT_IMAGE_2_UPSTREAM_MODELS),
  },
  {
    id: AICOMING_HAIYA_GPT_IMAGE_25_MODEL_ID,
    label: AICOMING_HAIYA_GPT_IMAGE_25_LABEL,
    provider: AICOMING_HAIYA_PROVIDER_ID,
    category: "image",
    upstreamModelId: AICOMING_HAIYA_GPT_IMAGE_25_UPSTREAM_MODELS.flare,
    upstreamModelIds: Object.values(AICOMING_HAIYA_GPT_IMAGE_25_UPSTREAM_MODELS),
  },
  {
    id: AICOMING_HAIYA_NANO_BANANA_PRO_MODEL_ID,
    label: "nano-banana-pro（hai）",
    provider: AICOMING_HAIYA_PROVIDER_ID,
    category: "image",
    upstreamModelId: AICOMING_HAIYA_NANO_BANANA_PRO_UPSTREAM_MODEL,
  },
  { id: "gpt-image-2-tuzi", label: "GPT-Image-2（tz）", provider: "tuzi", category: "image", upstreamModelId: "gpt-image-2" },
  { id: DOUBAO_SEEDREAM_5_PRO_MODEL, label: "Doubao-Seedream-5.0-Pro", provider: "volcengine", category: "image" },
  { id: DOUBAO_SEEDREAM_5_LITE_MODEL, label: "Doubao-Seedream-5.0-lite", provider: "volcengine", category: "image" },
  { id: "doubao-seedream-4.5", label: "Doubao-Seedream-4.5", provider: "volcengine", category: "image" },
  { id: "doubao-seedream-4.0", label: "Doubao-Seedream-4.0", provider: "volcengine", category: "image" },
  { id: KIE_NANO_BANANA_21_MODEL, label: "Nano Banana 2.1（Kie）", provider: "kie", category: "image" },
  { id: APIMART_NANO_BANANA_21_MODEL, label: "Nano Banana 2.1（APIMart）", provider: "apimart", category: "image", upstreamModelId: APIMART_NANO_BANANA_21_UPSTREAM },
  { id: GOOGLE_NANO_BANANA_21_MODEL, label: "Nano Banana 2.1", provider: "google-ai-studio", category: "image" },
  { id: GOOGLE_AI_STUDIO_FLASH_IMAGE_MODEL, label: "nano-banana-2", provider: "google-ai-studio", category: "image" },
  { id: GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL, label: "nano-banana-2-lite", provider: "google-ai-studio", category: "image" },
  { id: GOOGLE_AI_STUDIO_PRO_IMAGE_MODEL, label: "nano-banana-pro", provider: "google-ai-studio", category: "image" },
  { id: "qwen-image-3.0", label: "Qwen-Image-3.0", provider: "bailian", category: "image", upstreamModelIds: ["qwen-image-3.0", "qwen-image-3.0-pro"] },
  { id: "qwen-image-global-2.1", label: "Qwen-Image-Global-2.1（FisherAI）", provider: "work-fisher", category: "image" },
  ...OPENROUTER_IMAGE_MODELS.map(model => ({ ...model, provider: "openrouter" as const, category: "image" as const })),
];

export const VIDEO_MODEL_DEFINITIONS: ToolboxModelDefinition[] = sora2Models.map((model) => ({
  id: model.id,
  label: model.label,
  provider: model.provider,
  category: "video",
  supportedResolutions: [...model.supportedResolutions],
  upstreamModelId: model.upstreamModelId,
}));

export const AUDIO_MODEL_DEFINITIONS: ToolboxModelDefinition[] = [
  { id: "seed-audio-1.0", label: "Seed Audio 1.0", provider: "volcengine-speech", category: "audio" },
  { id: VOLC_ASR_MODEL_ID, label: VOLC_ASR_MODEL_LABEL, provider: "volcengine-speech", category: "audio", purpose: "speech-recognition" },
  { id: MINIMAX_SPEECH_HD_MODEL_ID, label: "Minimax-speech-2.8-hd", provider: "minimax", category: "audio" },
  { id: MINIMAX_SPEECH_TURBO_MODEL_ID, label: "Minimax-speech-2.8-turbo", provider: "minimax", category: "audio" },
  ...SUNO_MODELS.map(m => ({ id: m.id, label: m.label, provider: "apimart" as const, category: "audio" as const, upstreamModelId: "suno" })),
];

export const TOOLBOX_MODEL_DEFINITIONS: ToolboxModelDefinition[] = [
  ...IMAGE_EDIT_MODEL_DEFINITIONS,
  ...VIDEO_MODEL_DEFINITIONS,
  ...AUDIO_MODEL_DEFINITIONS,
];

export function getProviderUpstreamModelId(providerId: string, modelId: string): string {
  return TOOLBOX_MODEL_DEFINITIONS.find(
    (model) => model.provider === providerId && model.id === modelId,
  )?.upstreamModelId ?? modelId;
}

export function getToolboxModelDefinitions(category?: ToolboxModelCategory) {
  if (!category) return TOOLBOX_MODEL_DEFINITIONS;
  return TOOLBOX_MODEL_DEFINITIONS.filter((model) => model.category === category);
}
