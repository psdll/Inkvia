export const BIGMODEL_LLM_MODELS = ["glm-5.3", "glm-5.3-flash"] as const;
export const BIGMODEL_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

export function isBigModelGlm53(providerId: string, modelId: string): boolean {
  return providerId === "bigmodel" && (BIGMODEL_LLM_MODELS as readonly string[]).includes(modelId);
}

export function resolveBigModelLlmBaseUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  // Preserve administrator-saved gateway paths; only expand a bare host.
  return new URL(base).pathname === "/" ? `${base}/api/paas/v4` : base;
}
