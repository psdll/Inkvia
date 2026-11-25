import { BAILIAN_LLM_MODELS } from "@/lib/bailian-llm-models";
import { MINIMAX_LLM_MODELS } from "@/lib/minimax-llm-models";
import { BIGMODEL_LLM_MODELS } from "@/lib/bigmodel-llm-models";
import { REAPI_LLM_MODELS } from "@/lib/reapi-llm-models";
import { DOUBAO_SEED_EVOLVING_MODEL_ID } from "@/lib/volcengine-llm-models";

/** Shared by the provider registry and browser-side removal controls. */
export function getBuiltinChatModels(providerId: string): readonly string[] {
  switch (providerId) {
    case "volcengine": return [DOUBAO_SEED_EVOLVING_MODEL_ID];
    case "minimax": return MINIMAX_LLM_MODELS;
    case "bailian": return BAILIAN_LLM_MODELS;
    case "bigmodel": return BIGMODEL_LLM_MODELS;
    case "reapi": return REAPI_LLM_MODELS;
    default: return [];
  }
}
