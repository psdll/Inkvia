import { Type, createAssistantMessageEventStream, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { repairPendingToolResults, resumeCompletedCreativeAgentTurn, runCreativeAgent } from "@/lib/creative-agent/runner";
import type { CreativeAgentStore } from "@/lib/creative-agent/store";
import type { Run } from "@/lib/creative-agent/store-types";

vi.mock("@/lib/creative-agent/media-broker", () => ({ waitForCreativeAgentMedia: vi.fn() }));
vi.mock("@/lib/creative-agent/llm-broker", () => ({ createCreativeAgentModelStream: vi.fn() }));
const model: Model<Api> = { id: "offline", name: "Offline", provider: "local", api: "openai-completions", baseUrl: "http://not-used.invalid", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const run: Run = { id: "r", sessionId: "s", canvasId: 1, actorUserId: 1, epoch: 1, status: "running", error: null, updatedAt: new Date(1000).toISOString(), createdAt: new Date(1000).toISOString(), workerId: "test", leaseExpiresAt: null, input: { actorUserId: 1, canvasId: 1, messageId: "m", text: "生成图片", matchingPolicyVersion: 2, baseRevision: "1", selection: { nodeIds: [], edgeIds: [], references: [] } } };
const cancel = { cancelled: true, message: "用户取消本次生成" };
const call = (id: string, name = "image_generate") => ({ type: "toolCall" as const, id, name, arguments: {} });
function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "toolUse"): AssistantMessage {
  return { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, stopReason, timestamp: 2000, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
function fixture(results: Record<string, unknown> = cancel, calls = [call("cancel")]) {
  const actions: any[] = [];
  const store = { assertFence: vi.fn(), getRun: vi.fn(async () => run), getRecoveryContext: vi.fn(async () => ""), getTranscript: vi.fn(async (): Promise<any[]> => []), saveTranscript: vi.fn(), saveAssistant: vi.fn(), appendEvent: vi.fn(async () => undefined), waitForActions: vi.fn(), defer: vi.fn(), actionReceipts: vi.fn(async () => actions), finish: vi.fn(), control: vi.fn() };
  const execute = vi.fn(async (id: string) => {
    const result = id === "cancel" ? results : { generationIds: [12] };
    actions.push({ id, kind: "image.generate", state: "succeeded", result });
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: { result } };
  });
  const tools = [{ name: "image_generate", label: "generate", description: "generate", parameters: Type.Object({}), execute }];
  const stream = vi.fn(() => {
    const message = stream.mock.calls.length === 1 ? assistant(calls) : assistant([{ type: "text", text: "继续" }], "stop");
    const output = createAssistantMessageEventStream();
    queueMicrotask(() => { output.push({ type: "start", partial: message }); output.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message }); });
    return output;
  });
  const awaitMedia = vi.fn(async () => ({ pendingGenerationIds: [] as number[], generations: [{ generationId: 12, status: "success", mediaType: "image", outputs: [{ url: "/out.png", nodeId: "n" }], nodeIds: ["n"] }] }));
  const retryMedia = vi.fn(async () => null), advancePlan = vi.fn(async () => "complete" as const);
  const deps = { store: store as unknown as CreativeAgentStore, model, tools, stream, awaitMedia, retryMedia, advancePlan };
  return { store, actions, execute, tools, stream, awaitMedia, retryMedia, advancePlan, deps };
}

describe("explicit media cancellation is a durable preparation stop", () => {
  it("ends live cancellation without another model call or plan advancement", async () => {
    const f = fixture(); await runCreativeAgent(run, f.deps);
    expect(f.stream).toHaveBeenCalledOnce(); expect(f.advancePlan).not.toHaveBeenCalled();
    expect(f.store.finish).toHaveBeenCalledWith("r", 1, "completed");
  });
  it.each([false, true])("blocks all remaining calls in the mixed batch, preceding error=%s", async precedingError => {
    const f = fixture(cancel, [...(precedingError ? [call("missing", "unavailable")] : []), call("cancel"), call("later")]);
    await runCreativeAgent(run, f.deps);
    expect(f.execute.mock.calls.map(args => args[0])).toEqual(["cancel"]);
    expect(f.stream).toHaveBeenCalledOnce(); expect(f.advancePlan).not.toHaveBeenCalled();
    expect(f.store.saveTranscript.mock.calls.some(args => args[2].some((m: any) => m.role === "assistant" && m.stopReason === "error"))).toBe(false);
  });
  it.each([false, true])("repairs cancellation without executing later calls, already persisted=%s", async persisted => {
    const f = fixture();
    f.store.getTranscript.mockResolvedValue([{ role: "user", content: "生成图片", timestamp: 1000 }, assistant([call("cancel"), call("later")]), ...(persisted ? [{ role: "toolResult", toolName: "image_generate", toolCallId: "cancel", content: [], details: { result: cancel }, isError: false, timestamp: 2001 }] : [])]);
    if (persisted) f.actions.push({ id: "cancel", kind: "image.generate", state: "succeeded", result: cancel });
    await runCreativeAgent(run, f.deps);
    expect(f.execute.mock.calls.map(args => args[0])).toEqual(persisted ? [] : ["cancel"]);
    expect(f.stream).not.toHaveBeenCalled(); expect(f.advancePlan).not.toHaveBeenCalled();
    expect(f.store.saveTranscript.mock.calls.at(-1)?.[2].filter((m: any) => m.role === "toolResult")).toHaveLength(2);
  });
  it("observes previously submitted media across worker ticks without retry or advancing cancelled work", async () => {
    const f = fixture(cancel, [call("submitted"), call("cancel"), call("later")]);
    f.awaitMedia.mockResolvedValueOnce({ pendingGenerationIds: [12], generations: [] });
    await runCreativeAgent(run, f.deps);
    expect(f.execute.mock.calls.map(args => args[0])).toEqual(["submitted", "cancel"]);
    expect(f.awaitMedia).toHaveBeenCalledWith(run, [12], undefined);
    expect(f.store.defer).toHaveBeenCalledWith("r", 1, "waiting_action");
    f.store.getTranscript.mockResolvedValue(f.store.saveTranscript.mock.calls.at(-1)![2]);
    expect(await resumeCompletedCreativeAgentTurn(run, f.deps)).toBe(true);
    expect(f.stream).toHaveBeenCalledOnce(); expect(f.advancePlan).not.toHaveBeenCalled(); expect(f.retryMedia).not.toHaveBeenCalled();
    expect(f.store.saveAssistant).toHaveBeenCalledWith("r", 1, "r:media:completed", expect.stringContaining("1 项成功"));
  });
  it.each([{ cancelled: true, revisionRequested: true, revision: "改背景" }, { cancelled: true, skipped: true }])("preserves revision/skip continuation: %j", async result => {
    const f = fixture(result); await runCreativeAgent(run, f.deps);
    expect(f.stream).toHaveBeenCalledTimes(2); expect(f.advancePlan).toHaveBeenCalledOnce();
  });
  it("stops video cancellation through the same media boundary", async () => {
    const f = fixture(cancel, [call("cancel", "video_generate")]);
    f.deps.tools.push({ ...f.tools[0], name: "video_generate" });
    await runCreativeAgent(run, f.deps);
    expect(f.stream).toHaveBeenCalledOnce(); expect(f.advancePlan).not.toHaveBeenCalled();
  });
  it("preserves failed submitted results without using their approved retry after cancellation", async () => {
    const f = fixture();
    f.actions.push({ id: "submitted", kind: "image.generate", state: "succeeded", result: { generationIds: [12], mediaRequest: { args: { prompt: "old" } } } });
    f.awaitMedia.mockResolvedValue({ pendingGenerationIds: [], generations: [{ generationId: 12, status: "failed", mediaType: "image", outputs: [], nodeIds: [] }] });
    await expect(runCreativeAgent(run, f.deps)).rejects.toMatchObject({ code: "MEDIA_GENERATION_FAILED" });
    expect(f.retryMedia).not.toHaveBeenCalled(); expect(f.advancePlan).not.toHaveBeenCalled();
    expect(f.store.saveAssistant).toHaveBeenCalledWith("r", 1, "r:media:completed", expect.stringContaining("1 项失败"));
  });
  it("does not treat an unknown recovered dispatch as cancellation", async () => {
    const f = fixture(); f.execute.mockRejectedValueOnce(new Error("dispatch unknown"));
    await expect(repairPendingToolResults([assistant([call("cancel"), call("later")])], f.tools)).rejects.toThrow("dispatch unknown");
    expect(f.execute).toHaveBeenCalledOnce();
  });
  it("does not stop a fresh user turn because an older transcript contains cancellation", async () => {
    const f = fixture({ cancelled: true, revisionRequested: true });
    f.store.getTranscript.mockResolvedValue([{ role: "user", content: "旧任务", timestamp: 0 }, assistant([call("old")]), { role: "toolResult", toolName: "image_generate", toolCallId: "old", content: [], details: { result: cancel }, isError: false, timestamp: 1 }]);
    await runCreativeAgent(run, f.deps);
    expect(f.stream).toHaveBeenCalledTimes(2);
  });
});
