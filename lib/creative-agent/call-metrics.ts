import type { LlmUsage } from "@/lib/llm-routing/types";

/** Safe durable projection. Missing fields mean unreported, never measured zero. */
export type CreativeLlmAttempt = {
  callId: string; runId: string; purpose: "main" | "title"; providerId: string; modelId: string;
  status: "prepared" | "dispatched" | "succeeded" | "failed" | "unknown";
  usage: Partial<Record<keyof LlmUsage, number>>;
  usageReceivedAt?: string;
  legacyReceipt?: boolean;
  timing: { startedAt: string; intentAt?: string; dispatchedAt?: string; endedAt?: string; elapsedMs?: number; dispatchMs?: number; bodyCompleteMs?: number; headersMs?: number; firstPacketMs?: number; firstTextMs?: number; firstThinkingMs?: number; firstToolDeltaMs?: number };
  structure?: { requestBytes: number; requestCharacters: number; messageCount: number };
};
export function projectLlmUsage(usage?: LlmUsage | null): CreativeLlmAttempt["usage"] {
  const result: CreativeLlmAttempt["usage"] = {};
  for (const key of ["inputTokens", "outputTokens", "totalTokens", "cachedInputTokens", "cacheCreationInputTokens", "reasoningOutputTokens"] as const) {
    const value = usage?.[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) result[key] = value;
  }
  return result;
}
export function summarizeLlmAttempts(attempts: CreativeLlmAttempt[]) {
  const unique = [...new Map(attempts.filter(a => a?.callId).map(a => [a.callId, a])).values()];
  const totals = (all: CreativeLlmAttempt[]) => {
    const items = all.filter(a => a.timing?.dispatchedAt || a.legacyReceipt);
    const pendingIntentCalls = all.filter(a => a.status === "prepared" && a.timing?.intentAt && !a.timing.dispatchedAt).length;
    const usage: CreativeLlmAttempt["usage"] = {};
    const coverage: Partial<Record<keyof LlmUsage, number>> = {};
    for (const item of items) for (const [key, value] of Object.entries(projectLlmUsage(item.usage as LlmUsage))) {
      const field = key as keyof LlmUsage;
      usage[field] = (usage[field] ?? 0) + value; coverage[field] = (coverage[field] ?? 0) + 1;
    }
    return { pendingIntentCalls, calls: items.length, reportedCalls: items.filter(a => a.usage.inputTokens != null && a.usage.outputTokens != null).length, missingCalls: items.filter(a => a.usage.inputTokens == null || a.usage.outputTokens == null).length, unknownCalls: items.filter(a => a.status === "unknown" || a.status === "dispatched").length, usage, coverage };
  };
  return { ...totals(unique), main: totals(unique.filter(a => a.purpose === "main")), title: totals(unique.filter(a => a.purpose === "title")) };
}
