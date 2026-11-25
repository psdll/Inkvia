import { RETIRED_REAPI_LLM_MODELS } from "@/lib/reapi-llm-models";

const retiredModels: Record<string, readonly string[]> = {
  kie: ["gemini-omni-video", "grok-video-1.5", "grok-imagine-video-1-5-preview", "nano-banana-2", "nano-banana-2-lite"],
  jiekou: ["gpt-image-2-jiekou"],
  reapi: [...RETIRED_REAPI_LLM_MODELS, "gpt-image-2-official", "gpt-image-2-official-reapi"],
  volcengine: ["doubao-seedance-1-5-pro-251215", "doubao-seedance-1-0-pro-250528"],
};

export function isRetiredProviderModel(provider: string, model: string): boolean {
  // Retire the whole platform, including fetched or previously saved models.
  if (provider === "easyrouter" || provider === "runninghub") return true;
  const providerId = provider === "custom-gpt-image-2-official" ? "reapi" : provider;
  return retiredModels[providerId]?.includes(model) ?? false;
}
