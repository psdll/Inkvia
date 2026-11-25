import type { LlmScenarioId } from "@/lib/llm-routing/types";

export const REAPI_LLM_MODELS: readonly string[] = [];

export const RETIRED_REAPI_LLM_MODELS = [
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "gpt-5.5",
  "gpt-5.6-sol",
] as const;

export type ReapiLlmModelId = typeof RETIRED_REAPI_LLM_MODELS[number];

const REAPI_LLM_MODEL_RULES: Record<ReapiLlmModelId, {
  vision: boolean;
  jsonMode: "prompt" | "response_format";
}> = {
  "deepseek-v4-flash": { vision: true, jsonMode: "prompt" },
  "deepseek-v4-pro": { vision: true, jsonMode: "prompt" },
  "gpt-5.5": { vision: false, jsonMode: "response_format" },
  "gpt-5.6-sol": { vision: true, jsonMode: "response_format" },
};

export function getReapiLlmModelRule(modelId: string) {
  return REAPI_LLM_MODEL_RULES[modelId as ReapiLlmModelId] ?? null;
}

export function reapiLlmModelSupportsScenario(modelId: string, scenarioId: LlmScenarioId): boolean {
  const rule = getReapiLlmModelRule(modelId);
  if (!rule) return true;
  if (scenarioId === "image.role_prompt") return rule.vision;
  return true;
}

export function resolveReapiLlmBaseUrl(providerBaseUrl: string, modelId: string): string {
  void modelId;
  return providerBaseUrl;
}

export function reapiLlmUsesJsonResponseFormat(modelId: string): boolean {
  return getReapiLlmModelRule(modelId)?.jsonMode === "response_format";
}
