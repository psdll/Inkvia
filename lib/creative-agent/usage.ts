import type { AssistantMessage } from "@earendil-works/pi-ai";

export type CreativeAgentUsageMetadata = { reported: boolean; cacheReported: boolean; decodeMs?: number; callId?: string; reasoningOutputTokens?: number; providerUsage?: import("./call-metrics").CreativeLlmAttempt["usage"] };
export type CreativeAgentUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens?: number;
  reasoningReportedCalls?: number;
  reportedCalls: number;
  missingCalls: number;
  cacheHitPercent?: number;
  cacheHitPercentIsLowerBound?: boolean;
  tokensPerSecond?: number;
  latestContextTokens?: number;
  model?: string;
};

/** Summarize the current branch, including tool-call replies, without replay accumulation. */
export function summarizeCreativeAgentUsage(messages: unknown[]): CreativeAgentUsage {
  const result: CreativeAgentUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reportedCalls: 0, missingCalls: 0 };
  const seen = new Set<string>();
  let decodeMs = 0, timedOutput = 0, cacheComplete = true;
  for (const raw of messages) {
    if (!raw || typeof raw !== "object" || !("role" in raw) || raw.role !== "assistant") continue;
    const message = raw as AssistantMessage & { creativeUsage?: CreativeAgentUsageMetadata };
    const usage = message.usage;
    const metadata = message.creativeUsage;
    if (metadata?.callId) { if (seen.has(metadata.callId)) continue; seen.add(metadata.callId); }
    const valid = usage && [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].every(n => Number.isSafeInteger(n) && n >= 0);
    const input = metadata?.providerUsage?.inputTokens ?? (valid ? usage.input + usage.cacheRead + usage.cacheWrite : 0);
    result.model = message.model;
    // Legacy messages used zero-filled SDK usage when the provider omitted it.
    if (!valid || !(metadata?.reported ?? input + usage.output > 0)) {
      result.missingCalls++;
      result.latestContextTokens = undefined;
      continue;
    }
    result.reportedCalls++;
    result.inputTokens += input;
    result.outputTokens += usage.output;
    if (metadata?.reasoningOutputTokens != null) { result.reasoningOutputTokens = (result.reasoningOutputTokens ?? 0) + metadata.reasoningOutputTokens; result.reasoningReportedCalls = (result.reasoningReportedCalls ?? 0) + 1; }
    result.cachedInputTokens += usage.cacheRead;
    result.latestContextTokens = input + usage.output;
    if (input > 0 && !(metadata?.cacheReported ?? usage.cacheRead > 0)) cacheComplete = false;
    if (metadata?.decodeMs && Number.isFinite(metadata.decodeMs) && metadata.decodeMs > 0 && usage.output > 0) {
      decodeMs += metadata.decodeMs;
      timedOutput += usage.output;
    }
  }
  if (result.inputTokens > 0 && (cacheComplete || result.cachedInputTokens > 0)) {
    result.cacheHitPercent = result.cachedInputTokens / result.inputTokens * 100;
    if (!cacheComplete) result.cacheHitPercentIsLowerBound = true;
  }
  if (decodeMs > 0) result.tokensPerSecond = timedOutput * 1000 / decodeMs;
  return result;
}

/** Absolute counters; cache/reasoning are subsets or provider-specific details, not extra total tokens. */
export type CreativeAgentUsageScopes = {
  currentRun: ReturnType<typeof import("./call-metrics").summarizeLlmAttempts>;
  currentBranch: CreativeAgentUsage;
  allAttempts: ReturnType<typeof import("./call-metrics").summarizeLlmAttempts> & { legacyUnverifiedCalls?: number; titleCoverage?: "linked-calls-only" };
};
