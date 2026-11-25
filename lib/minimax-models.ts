export const MINIMAX_PROVIDER_ID = "minimax";
export const MINIMAX_H3_MODEL_ID = "minimax-h3";
export const MINIMAX_H3_UPSTREAM_MODEL = "MiniMax-H3";
export const MINIMAX_H3_MAX_MODEL_ID = "minimax-h3-max";
export const MINIMAX_H3_MAX_UPSTREAM_MODEL = "MiniMax-H3-Max";
export const MINIMAX_H3_PAID_CONCURRENCY = 15;

export const LEGACY_AICOMING_MINIMAX_H3_UPSTREAM_MODEL = "minimax-h3";

export function isMiniMaxH3VideoModel(modelId: string): boolean {
  const normalized = String(modelId || "").trim();
  return normalized === MINIMAX_H3_MODEL_ID || normalized === MINIMAX_H3_MAX_MODEL_ID;
}

export function isMiniMaxH3MaxVideoModel(modelId: string): boolean {
  return String(modelId || "").trim() === MINIMAX_H3_MAX_MODEL_ID;
}
