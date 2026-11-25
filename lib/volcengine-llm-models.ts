export const DOUBAO_SEED_EVOLVING_MODEL_ID = "doubao-seed-evolving";

export function isDoubaoSeedEvolving(provider: string, model: string) {
  return provider === "volcengine" && model === DOUBAO_SEED_EVOLVING_MODEL_ID;
}

// Ark's shared image/video configuration stores the host; LLMs use /api/v3.
export function resolveVolcengineLlmBaseUrl(baseUrl: string) {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return new URL(base).pathname === "/" ? `${base}/api/v3` : base;
}
