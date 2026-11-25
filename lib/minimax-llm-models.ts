export const MINIMAX_M3_MODEL_ID = "MiniMax-M3";
export const MINIMAX_M31_FLASH_MODEL_ID = "MiniMax-M3.1-Flash";
export const MINIMAX_LLM_MODELS: readonly string[] = [MINIMAX_M3_MODEL_ID, MINIMAX_M31_FLASH_MODEL_ID];

export function isMiniMaxLlmModel(providerId: string, modelId: string): boolean {
  return providerId === "minimax" && MINIMAX_LLM_MODELS.includes(modelId);
}
