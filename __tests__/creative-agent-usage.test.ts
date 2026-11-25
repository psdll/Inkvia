import { describe, expect, it } from "vitest";
import { summarizeCreativeAgentUsage } from "@/lib/creative-agent/usage";
import { applyAgentEvents, restoreAgentSnapshot } from "@/components/creative-agent/state";

const reply = (input: number, output: number, cacheRead: number, decodeMs?: number) => ({
  role: "assistant", model: "model", usage: { input, output, cacheRead, cacheWrite: 0, totalTokens: input + output + cacheRead },
  creativeUsage: { reported: true, cacheReported: true, ...(decodeMs ? { decodeMs } : {}) },
});
describe("creative Agent usage", () => {
  it("counts tool-call replies and cached input once, weighting speed by decode time", () => {
    const history = [reply(80, 10, 20, 1000), { role: "toolResult" }, reply(100, 60, 200, 2000)];
    expect(summarizeCreativeAgentUsage(history)).toMatchObject({ inputTokens: 400, outputTokens: 70, cachedInputTokens: 220, tokensPerSecond: 70 / 3, latestContextTokens: 360, model: "model" });
    expect(summarizeCreativeAgentUsage(history).cacheHitPercent).toBeCloseTo(55);
    expect(summarizeCreativeAgentUsage(history)).toEqual(summarizeCreativeAgentUsage(JSON.parse(JSON.stringify(history))));
  });
  it("recovers old saved usage without inventing historical speed", () => {
    expect(summarizeCreativeAgentUsage([{ role: "assistant", usage: { input: 80, output: 10, cacheRead: 20, cacheWrite: 0 } }])).toMatchObject({ inputTokens: 100, outputTokens: 10, cacheHitPercent: 20 });
    expect(summarizeCreativeAgentUsage([reply(80, 10, 20)]).tokensPerSecond).toBeUndefined();
  });
  it("distinguishes missing provider usage and missing cache details from a reported zero", () => {
    expect(summarizeCreativeAgentUsage([]).reportedCalls).toBe(0);
    expect(summarizeCreativeAgentUsage([{ ...reply(0, 0, 0), creativeUsage: { reported: false } }])).toMatchObject({ reportedCalls: 0, missingCalls: 1 });
    expect(summarizeCreativeAgentUsage([reply(0, 0, 0)]).reportedCalls).toBe(1);
    expect(summarizeCreativeAgentUsage([{ ...reply(10, 1, 0), creativeUsage: { reported: true, cacheReported: false } }]).cacheHitPercent).toBeUndefined();
    const legacy = { role: "assistant", usage: { input: 100, output: 1, cacheRead: 0, cacheWrite: 0 } };
    expect(summarizeCreativeAgentUsage([legacy, reply(80, 10, 20)])).toMatchObject({ cacheHitPercent: 10, cacheHitPercentIsLowerBound: true });
  });
  it("restores totals and ignores old usage events when replaying the snapshot's event log", () => {
    const run = { id: "r", sessionId: "s", canvasId: 1, status: "completed" as const, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    const usage = summarizeCreativeAgentUsage([reply(80, 10, 20)]);
    const snapshot = restoreAgentSnapshot({ sessionId: "s", messages: [], run, latestSequence: 10, usage });
    const event = { sequence: 5, runId: "r", type: "usage.updated" as const, payload: { usage: summarizeCreativeAgentUsage([]) }, createdAt: run.createdAt };
    expect(applyAgentEvents(snapshot, [event], run).usage).toEqual(usage);
    const updated = { ...event, sequence: 11, payload: { usage: summarizeCreativeAgentUsage([reply(200, 30, 0)]) } };
    const next = applyAgentEvents(snapshot, [updated, updated], run);
    expect(next.usage?.inputTokens).toBe(200);
  });
});
