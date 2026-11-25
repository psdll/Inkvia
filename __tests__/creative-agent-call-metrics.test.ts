import { describe, expect, it } from "vitest";
import { projectLlmUsage, summarizeLlmAttempts, type CreativeLlmAttempt } from "@/lib/creative-agent/call-metrics";
const attempt = (callId: string, usage: CreativeLlmAttempt["usage"], purpose: "main" | "title" = "main"): CreativeLlmAttempt => ({ callId, runId: "r", providerId: "fixture", modelId: "fixture", purpose, status: "succeeded", timing: { startedAt: "2026-10-16T01:00:00Z", dispatchedAt: "2026-10-16T01:00:01Z" }, usage });
it("projects only actual safe numeric provider fields", () => {
  expect(projectLlmUsage({ inputTokens: 10, outputTokens: 0, cachedInputTokens: -1, reasoningOutputTokens: NaN, totalTokens: null, apiKey: "secret" } as any)).toEqual({ inputTokens: 10, outputTokens: 0 });
  expect(projectLlmUsage()).toEqual({});
});
it("deduplicates call ids and separates title, cache and reasoning coverage without adding them to input/output", () => {
  const first = attempt("one", { inputTokens: 100, outputTokens: 40, reasoningOutputTokens: 30, cachedInputTokens: 70 });
  const unknown = { ...attempt("two", {}), status: "unknown" as const };
  const result = summarizeLlmAttempts([first, first, unknown, attempt("title", { inputTokens: 10, outputTokens: 4 }, "title")]);
  expect(result).toMatchObject({ calls: 3, reportedCalls: 2, missingCalls: 1, unknownCalls: 1, usage: { inputTokens: 110, outputTokens: 44, cachedInputTokens: 70, reasoningOutputTokens: 30 }, coverage: { inputTokens: 2, reasoningOutputTokens: 1 }, main: { calls: 2 }, title: { calls: 1 } });
  expect(summarizeLlmAttempts([unknown]).usage).toEqual({});
});
it("separates an unresolved durable intent from actual transport and known pretransport rejection", () => {
  const intent: CreativeLlmAttempt = { ...attempt("intent", {}, "title"), status: "prepared", timing: { startedAt: "start", intentAt: "intent" } };
  expect(summarizeLlmAttempts([intent])).toMatchObject({ calls: 0, missingCalls: 0, pendingIntentCalls: 1, title: { pendingIntentCalls: 1 } });
  expect(summarizeLlmAttempts([{ ...intent, status: "failed" }])).toMatchObject({ calls: 0, pendingIntentCalls: 0 });
});
