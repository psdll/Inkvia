export type ModelContextPolicy = { contextWindow: number; maxOutputTokens: number; outputParameter: "max_tokens" | "max_completion_tokens"; inputPerMillion?: string; outputPerMillion?: string; currency?: string };

/** Explicit conservative fallback, not a claim about the provider's advertised capacity. */
export function getAgentModelContextPolicy(modelId: string): ModelContextPolicy {
  let settings: Record<string, any> = {};
  try { settings = JSON.parse(process.env.INKVIA_AGENT_CONTEXT_LIMITS || "{}"); } catch { throw new Error("AGENT_CONTEXT_CONFIG_INVALID"); }
  const entry = settings[modelId] || {};
  const contextWindow = entry.contextWindow ?? 8192;
  const maxOutputTokens = entry.maxOutputTokens ?? 2048;
  if (!Number.isSafeInteger(contextWindow) || !Number.isSafeInteger(maxOutputTokens) || contextWindow < 2048 || maxOutputTokens < 128 || maxOutputTokens >= contextWindow || contextWindow > 2_000_000) throw new Error("AGENT_CONTEXT_CONFIG_INVALID");
  return { contextWindow, maxOutputTokens, outputParameter: entry.outputParameter === "max_completion_tokens" ? "max_completion_tokens" : "max_tokens", inputPerMillion: entry.inputPerMillion, outputPerMillion: entry.outputPerMillion, currency: entry.currency };
}

