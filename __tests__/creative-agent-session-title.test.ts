import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ saveLlmAttempt: vi.fn(), getSession: vi.fn(), claimSessionTitle: vi.fn(), finishSessionTitle: vi.fn(), call: vi.fn(), run: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/creative-agent/store", () => ({ creativeAgentStore: mocks }));
vi.mock("@/lib/prisma", () => ({ default: { creativeAgentRun: { findFirst: mocks.run } } }));
vi.mock("@/lib/creative-agent/model-catalog", () => ({ resolveCreativeAgentModel: mocks.resolve }));
vi.mock("@/lib/llm-routing/gateway", () => ({ callLlmForScenario: mocks.call }));
vi.mock("@/lib/creative-agent/model-context-policy", () => ({ getAgentModelContextPolicy: () => ({ outputParameter: "max_tokens", maxOutputTokens: 1024 }) }));
vi.mock("@/lib/maintenance", () => ({ assertDurableWorkAdmission: async () => {} }));
import { generateCreativeAgentSessionTitle } from "@/lib/creative-agent/session-title";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.saveLlmAttempt.mockResolvedValue(undefined);
  mocks.run.mockResolvedValue({ input: { model: { providerId: "test", modelId: "chosen" }, text: "用户输入", sessionId: "s" } });
  mocks.resolve.mockResolvedValue({ status: "ready", route: { providerId: "test", modelId: "chosen", protocol: "openai-chat" } });
  mocks.getSession.mockResolvedValue({ id: "s", title: "创作对话", titleSource: "auto", messageCount: 2 });
  mocks.claimSessionTitle.mockResolvedValue({ claimId: "claim", runId: "r", messageId: "message", history: [{ role: "user", text: "制作按摩椅客厅背景图" }] });
});

describe("complete short conversation titles", () => {
  it("uses the latest run's explicit model within the authorized conversation", async () => {
    await generateCreativeAgentSessionTitle(7, 2, "s");
    expect(mocks.run).toHaveBeenCalledWith({ where: { actorUserId: 7, canvasId: 2, sessionId: "s" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { input: true } });
    expect(mocks.resolve).toHaveBeenCalledWith({ providerId: "test", modelId: "chosen" });
    expect(mocks.call.mock.calls[0][0]).toMatchObject({ providerId: "test", modelId: "chosen" });
  });
  it("does not fall back to a platform model for legacy runs without a selection", async () => {
    mocks.run.mockResolvedValue({ input: { text: "旧消息" } });
    await generateCreativeAgentSessionTitle(7, 2, "s");
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.claimSessionTitle).not.toHaveBeenCalled();
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("requests a complete title within 15 characters and saves it unchanged", async () => {
    const title = "现代简约风格按摩椅客厅场景设计";
    expect(Array.from(title)).toHaveLength(15);
    mocks.call.mockResolvedValue({ text: JSON.stringify({ title }) });
    await generateCreativeAgentSessionTitle(7, 2, "s");
    expect(mocks.call.mock.calls[0][1][0].content).toContain("最多15个字符");
    expect(mocks.call.mock.calls[0][1][0].content).toContain("不得截取长标题");
    expect(mocks.finishSessionTitle).toHaveBeenCalledWith("s", "claim", "message", title);
  });
  it.each(["现代简约风格按摩椅客厅场景设计图", "按摩椅客厅设计…", "按摩椅客厅设计...", "客厅产品图\n背景方案"])("rejects invalid titles intact: %s", async title => {
    mocks.call.mockResolvedValue({ text: JSON.stringify({ title }) });
    const session = await generateCreativeAgentSessionTitle(7, 2, "s");
    expect(mocks.finishSessionTitle).not.toHaveBeenCalled();
    expect(session.title).toBe("创作对话");
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });
  it("does not rename a manually named conversation", async () => {
    mocks.getSession.mockResolvedValue({ title: "我的产品设计", titleSource: "manual", messageCount: 2 });
    await generateCreativeAgentSessionTitle(7, 2, "s");
    expect(mocks.call).not.toHaveBeenCalled();
  });
});

it("Task5 rejects a title hidden while claiming the durable attempt", async () => {
  mocks.claimSessionTitle.mockImplementation(async () => {
    mocks.resolve.mockResolvedValue({ status: "model-disabled" });
    return { claimId: "c", messageId: "m", history: [] };
  });
  await generateCreativeAgentSessionTitle(7, 2, "s");
  expect(mocks.call).not.toHaveBeenCalled();
});

it("Task5 records failed title usage separately with an exact billing request key", async () => {
  mocks.call.mockImplementation(async (_route, _messages, options) => {
    await options.beforeDispatch();
    throw Object.assign(new Error("stream failed"), { dispatched: true, usage: { inputTokens: 11, outputTokens: 7, reasoningOutputTokens: 6 } });
  });
  await generateCreativeAgentSessionTitle(7, 2, "s");
  const attempt = mocks.saveLlmAttempt.mock.calls.at(-1)?.[1];
  expect(attempt).toMatchObject({ purpose: "title", status: "unknown", usage: { inputTokens: 11, outputTokens: 7, reasoningOutputTokens: 6 } });
  expect(mocks.call.mock.calls[0][2].requestKey).toBe(attempt.callId);
});

it("I2 keeps a thrown final visibility lookup before transport out of actual attempts", async () => {
  mocks.resolve.mockReset().mockResolvedValueOnce({ status: "ready", route: { providerId: "test", modelId: "chosen", protocol: "openai-chat" } }).mockResolvedValueOnce({ status: "ready", route: { providerId: "test", modelId: "chosen", protocol: "openai-chat" } }).mockRejectedValueOnce(new Error("LLM_VISIBILITY_INVALID"));
  mocks.call.mockImplementation(async (_r, _m, options) => { await options.beforeDispatch(); throw new Error("must not transport"); });
  await generateCreativeAgentSessionTitle(7, 2, "s");
  const attempt = mocks.saveLlmAttempt.mock.calls.at(-1)?.[1];
  expect(attempt.status).toBe("failed"); expect(attempt.timing.dispatchedAt).toBeUndefined();
});
it("I3 retains successful provider usage when applying the title fails", async () => {
  mocks.call.mockResolvedValue({ text: '{"title":"杯子广告"}', usage: { inputTokens: 11, outputTokens: 7, reasoningOutputTokens: 6 } });
  mocks.finishSessionTitle.mockRejectedValue(new Error("title write failed"));
  await generateCreativeAgentSessionTitle(7, 2, "s");
  expect(mocks.saveLlmAttempt.mock.calls.at(-1)?.[1]).toMatchObject({ status: "succeeded", usage: { inputTokens: 11, outputTokens: 7, reasoningOutputTokens: 6 } });
});
