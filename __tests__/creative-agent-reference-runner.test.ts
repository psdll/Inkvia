import { describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
const calls = vi.hoisted(() => ({ prepare: vi.fn(), read: vi.fn(), describe: vi.fn() }));
vi.mock("@/lib/creative-agent/reference-preparation", () => ({ prepareCreativeAgentReferences: calls.prepare }));
vi.mock("@/lib/creative-agent/attachments", () => ({ readCreativeAgentAttachments: calls.read, describeCreativeAgentAttachments: calls.describe }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/maintenance", () => ({ assertDurableWorkAdmission: vi.fn(), MaintenanceSubmissionError: class extends Error {} }));
vi.mock("@/lib/creative-agent/skill-packages", () => ({ creativeSkillIntegration: "", expandCreativeSkillCommand: async (text: string) => text }));
import { runCreativeAgent } from "@/lib/creative-agent/runner";
describe("sent attachments prepared before model input", () => {
  it("makes bindable references available before the stream and persists scoped history context", async () => {
    const order: string[] = [];
    const selection = { nodeIds: ["source", "new-source"], edgeIds: [], references: [{ canvasId: 17, nodeId: "source", kind: "image", label: "product.png", semanticHash: "a".repeat(64) }, { canvasId: 17, nodeId: "new-source", kind: "image", label: "new-product.png", semanticHash: "b".repeat(64) }] };
    const run = { id: "run", sessionId: "session", actorUserId: 7, canvasId: 17, epoch: 1, createdAt: new Date(1000).toISOString(), input: { messageId: "m", text: "use product", baseRevision: "1", attachments: [{ id: "attachment" }, { id: "duplicate-label" }, { id: "new-attachment" }], selection: { nodeIds: [], edgeIds: [], references: [] } } } as any;
    calls.prepare.mockImplementation(async () => { order.push("prepare"); return { selection, revision: "2" }; });
    calls.describe.mockResolvedValue([
      { id: "attachment", name: "product.png", mimeType: "image/png", reference: selection.references[0] },
      { id: "duplicate-label", name: "product.png (2)", mimeType: "image/png", reference: selection.references[0] },
      { id: "new-attachment", name: "new-product.png", mimeType: "image/png", reference: selection.references[1] },
    ]);
    calls.read.mockResolvedValue([{ type: "text", text: "attachment product.png" }]);
    const store = { getRun: vi.fn(async () => run), assertFence: vi.fn(async () => ({ ...run, input: { ...run.input, preparedSelection: selection } })), savePreparedReferences: vi.fn(async () => { order.push("persist"); return { ...run, input: { ...run.input, selection, baseRevision: "2" } }; }), getReferenceHistory: vi.fn(async () => "prior session reference historical-node"), getTranscript: vi.fn(async () => []), saveTranscript: vi.fn(), getRecoveryContext: vi.fn(async () => ""), saveAssistant: vi.fn(), appendEvent: vi.fn(), actionReceipts: vi.fn(async () => []), finish: vi.fn() };
    let context: any;
    await runCreativeAgent(run, { store: store as any, model: { id: "test", name: "test", provider: "local", api: "openai-completions", baseUrl: "http://unused", reasoning: false, input: ["text", "image"], contextWindow: 10000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }, tools: [], stream: (_model, value) => {
      order.push("stream"); context = value;
      const stream = createAssistantMessageEventStream();
      const message = { role: "assistant", content: [{ type: "text", text: "ready" }], api: "openai-completions", provider: "local", model: "test", stopReason: "stop", timestamp: 2000, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } as any;
      queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: "stop", message }); });
      return stream;
    } });
    expect(order).toEqual(["prepare", "persist", "stream"]);
    expect(context.systemPrompt).toContain('"nodeId":"source"');
    expect(JSON.parse(context.systemPrompt.split("运行上下文：")[1].split("\n")[0]).selection).toEqual(selection);
    expect(context.systemPrompt).toContain("historical-node");
    expect(context.systemPrompt).toContain('"id":"duplicate-label","name":"product.png (2)"');
    expect(context.systemPrompt).toContain("不同附件标签可以指向同一个已验证节点");
    expect(context.systemPrompt).toContain('"id":"new-attachment","name":"new-product.png"');
    expect(context.systemPrompt).toContain('"nodeId":"new-source"');
    expect(calls.describe).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 7, canvasId: 17, sessionId: "session", attachments: [{ id: "attachment" }, { id: "duplicate-label" }, { id: "new-attachment" }] }));
    expect(store.finish).toHaveBeenCalledWith("run", 1, "completed");
  });
});
