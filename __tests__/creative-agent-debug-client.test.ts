import { afterEach, describe, expect, it, vi } from "vitest";
import { groupDebugEvents, streamDebugEvents, DebugAccessError } from "@/components/creative-agent/debug/debug-client";
import { compareDebugRequests } from "@/components/creative-agent/debug/DebugDetails";
import type { DebugEvent } from "@/lib/creative-agent/debug-contracts";
const event = (id: string, sequence: number, status: DebugEvent["status"]): DebugEvent => ({ id, sequence, runId: "r", spanId: "m", parentSpanId: "run:r", type: sequence === 1 ? "model.prepared" : "model.completed", category: "model", title: sequence === 1 ? "请求 demo" : "完成", status, summary: sequence === 1 ? { modelId: "demo" } : { elapsedMs: 500 }, createdAt: `2026-10-14T01:00:0${sequence}Z`, hasDetail: true });
afterEach(() => vi.unstubAllGlobals());
describe("debug stream presentation", () => {
  it("deduplicates replayed events and preserves parent linkage and model metadata", () => {
    const steps = groupDebugEvents([event("b", 2, "success"), event("a", 1, "running"), event("a", 1, "running")]);
    expect(steps).toHaveLength(1); expect(steps[0]).toMatchObject({ title: "请求 demo", parentSpanId: "run:r", status: "success", eventCount: 2, summary: { modelId: "demo", elapsedMs: 500 } });
  });
  it("reassembles fragmented SSE frames and carries independent continuation cursors", async () => {
    const body = `data: ${JSON.stringify({ events: [event("a", 1, "running")], run: { id: "r" }, nextSequence: 1, nextPublicSequence: 8 })}\n\nevent: complete\ndata: {}\n\n`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(controller) { const encoded = new TextEncoder().encode(body); controller.enqueue(encoded.slice(0, 7)); controller.enqueue(encoded.slice(7)); controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } })));
    const receive = vi.fn(), cursor = { after: 0, publicAfter: 4 };
    expect(await streamDebugEvents("r", cursor, new AbortController().signal, receive)).toBe(true);
    expect(cursor).toEqual({ after: 1, publicAfter: 8 }); expect(receive).toHaveBeenCalledTimes(1);
  });
  it("stops on permission revocation instead of treating it as a reconnect", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("event: forbidden\ndata: {}\n\n", { headers: { "Content-Type": "text/event-stream" } })));
    await expect(streamDebugEvents("r", { after: 0, publicAfter: 0 }, new AbortController().signal, vi.fn())).rejects.toBeInstanceOf(DebugAccessError);
  });
  it("distinguishes omitted and newly added model context", () => {
    expect(compareDebugRequests({ model: "old", messages: [{ role: "user", content: "旧消息" }] }, { model: "new", messages: [{ role: "tool", content: "新工具结果" }] })).toMatchObject({ 新带入的消息: [{ content: "新工具结果" }], 未再带入的消息: [{ content: "旧消息" }], 变化的请求参数: [{ 参数: "model", 上次: "old", 本次: "new" }] });
  });
});
