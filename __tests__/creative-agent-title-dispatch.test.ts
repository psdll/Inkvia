import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ resolve: vi.fn(), save: vi.fn(), apply: vi.fn(), claimValid: vi.fn(), transport: vi.fn(), begin: vi.fn(), settle: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { creativeAgentRun: { findFirst: async () => ({ input: { model: { providerId: "test", modelId: "model" } } }) } } }));
vi.mock("@/lib/creative-agent/store", () => ({ creativeAgentStore: { getSession: async () => ({ id: "s", titleSource: "auto", messageCount: 2 }), claimSessionTitle: async () => ({ claimId: "c", runId: "r", messageId: "m", history: [] }), assertSessionTitleClaim: m.claimValid, saveLlmAttempt: m.save, finishSessionTitle: m.apply } }));
vi.mock("@/lib/creative-agent/model-catalog", () => ({ resolveCreativeAgentModel: m.resolve }));
vi.mock("@/lib/providers/transport", () => ({ fetchWithProviderEgress: m.transport, ProviderNetworkError: class extends Error {} }));
vi.mock("@/lib/billing/llm", () => ({ beginLlmCost: m.begin, finishLlmCost: m.settle }));
vi.mock("@/lib/logger", () => ({ Logger: { log: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/maintenance", () => ({ assertDurableWorkAdmission: async () => {} }));
import { generateCreativeAgentSessionTitle } from "@/lib/creative-agent/session-title";
import { openAiChatAdapter } from "@/lib/llm-routing/adapters/openai-chat";
const route = { providerId: "test", modelId: "model", protocol: "openai-chat", scenarioId: "agent.chat", apiKey: "fixture", url: "https://not-called.invalid", timeoutMs: 1000, egressDecision: { providerId: "test", mode: "direct" } };
beforeEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); m.resolve.mockResolvedValue({ status: "ready", route }); m.save.mockResolvedValue(undefined); m.apply.mockResolvedValue(undefined); m.claimValid.mockResolvedValue(undefined); m.begin.mockResolvedValue({ id: 1 }); m.settle.mockResolvedValue(undefined); m.transport.mockResolvedValue(Response.json({ choices: [{ message: { content: '{"title":"杯子广告"}' } }], usage: { prompt_tokens: 11, completion_tokens: 7, completion_tokens_details: { reasoning_tokens: 6 } } })); });
const run = () => generateCreativeAgentSessionTitle(7, 2, "s");
const attempt = () => m.save.mock.calls.at(-1)?.[1];
it.each(["visibility", "save-intent", "build-request", "claim"])("I2/I4 real gateway rejects %s before transport without recording a dispatch", async stage => {
  if (stage === "visibility") m.resolve.mockResolvedValueOnce({ status: "ready", route }).mockResolvedValueOnce({ status: "ready", route }).mockRejectedValueOnce(new Error("LLM_VISIBILITY_INVALID"));
  if (stage === "save-intent") m.save.mockRejectedValueOnce(new Error("db failed"));
  if (stage === "build-request") vi.spyOn(openAiChatAdapter, "buildRequest").mockImplementation(() => { throw new Error("build failed"); });
  if (stage === "claim") m.claimValid.mockRejectedValue(new Error("title_claim_stale"));
  await run(); expect(m.transport).not.toHaveBeenCalled(); expect(attempt()).toMatchObject({ status: "failed", usage: {} }); expect(attempt().timing.dispatchedAt).toBeUndefined();
});
it.each([[401,"failed"], [429,"failed"], [408,"unknown"], [503,"unknown"]])("I2 real gateway records HTTP %i as %s and preserves reported usage", async (status, expected) => {
  m.transport.mockResolvedValue(Response.json({ error: { message: "fixture error" }, usage: { prompt_tokens: 11, completion_tokens: 7 } }, { status: Number(status) }));
  await run(); expect(m.transport).toHaveBeenCalledOnce(); expect(attempt()).toMatchObject({ status: expected, usage: { inputTokens: 11, outputTokens: 7 }, timing: { dispatchedAt: expect.any(String) } });
});
it("I2 real transport interruption is unknown, retaining dispatch evidence", async () => { m.transport.mockRejectedValue(new Error("socket closed")); await run(); expect(attempt()).toMatchObject({ status: "unknown", timing: { dispatchedAt: expect.any(String) } }); });
it("I3 title persistence failure preserves successful provider fact and exact usage", async () => { m.apply.mockRejectedValue(new Error("db failed")); await run(); expect(attempt()).toMatchObject({ status: "succeeded", usage: { inputTokens: 11, outputTokens: 7, reasoningOutputTokens: 6 } }); });
