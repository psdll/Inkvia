import { describe, expect, it, vi } from "vitest";
import { creativeAgentChatMessages, readCreativeAgentChatResponse } from "@/lib/creative-agent/llm-stream";

function sse(chunks: unknown[], done = true) {
  return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join("") + (done ? "data: [DONE]\n\n" : ""), { headers: { "Content-Type": "text/event-stream" } });
}
describe("creative Agent model transport", () => {
  it("retains MiniMax structured thinking snapshots and opaque fields for the same model", async () => {
    const onThinking = vi.fn();
    const result = await readCreativeAgentChatResponse(sse([
      { choices: [{ delta: { reasoning_details: [{ index: 0, type: "reasoning.text", text: "先读" }] } }] },
      { choices: [{ delta: { reasoning_details: [{ index: 0, type: "reasoning.text", text: "先读取画布", signature: "opaque" }], tool_calls: [{ index: 0, id: "read", function: { name: "canvas_read", arguments: "{}" } }] }, finish_reason: "tool_calls" }] },
    ]), vi.fn(), vi.fn(), onThinking);
    expect(result.thinking).toBe("先读取画布");
    expect(onThinking.mock.calls.flat().join("")).toBe("先读取画布");
    const details = [{ index: 0, type: "reasoning.text", text: "先读取画布", signature: "opaque" }];
    expect(result.reasoningDetails).toEqual(details);
    const context = { messages: [JSON.parse(JSON.stringify({ role: "assistant", provider: "minimax", model: "MiniMax-M3", content: [{ type: "thinking", thinking: result.thinking }, { type: "toolCall", ...result.calls[0] }], creativeReasoningDetails: result.reasoningDetails }))] };
    const replay = creativeAgentChatMessages(context, { providerId: "minimax", modelId: "MiniMax-M3" })[0];
    expect(replay).toMatchObject({ reasoning_details: details, tool_calls: [{ id: "read" }] });
    expect(replay).not.toHaveProperty("reasoning_content");
    expect(creativeAgentChatMessages(context, { providerId: "bailian", modelId: "qwen3.8-max" })[0]).not.toHaveProperty("reasoning_details");
  });
  it.each([false, true])("preserves opaque encrypted reasoning for the next tool round (stream=%s)", async streaming => {
    const message = { content: "done", reasoning_content: "summary", encrypted_content: "opaque-signature" };
    const response = streaming ? sse([{ choices: [{ delta: message, finish_reason: "stop" }] }]) : Response.json({ choices: [{ message, finish_reason: "stop" }] });
    const result = await readCreativeAgentChatResponse(response, vi.fn(), vi.fn());
    expect(result.encryptedContent).toBe("opaque-signature");
    const assistant = { role: "assistant", provider: "volcengine", model: "doubao-seed-evolving", content: [{ type: "thinking", thinking: result.thinking }], creativeEncryptedContent: result.encryptedContent };
    const context = { messages: [JSON.parse(JSON.stringify(assistant))] };
    const replay = creativeAgentChatMessages(context, { providerId: "volcengine", modelId: "doubao-seed-evolving" });
    expect(replay[0]).toMatchObject({ reasoning_content: "summary", encrypted_content: "opaque-signature" });
    expect(creativeAgentChatMessages(context, { providerId: "bailian", modelId: "qwen3.8-max" })[0]).not.toHaveProperty("encrypted_content");
  });
  it("times streamed tool arguments from first content to finish, excluding trailing usage latency", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValueOnce(1000).mockReturnValueOnce(3000);
    try {
      const result = await readCreativeAgentChatResponse(sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "t", function: { name: "canvas_read", arguments: "{}" } }] } }] },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        { choices: [], usage: { completion_tokens: 20 } },
      ]), vi.fn(), vi.fn());
      expect(result.decodeMs).toBe(2000);
    } finally { clock.mockRestore(); }
  });
  it("streams text and preserves complete split tool arguments and usage", async () => {
    const onText = vi.fn(), onUsage = vi.fn();
    const result = await readCreativeAgentChatResponse(sse([
      { choices: [{ index: 0, delta: { content: "我来调整。", tool_calls: [{ index: 0, id: "call1", function: { name: "canvas_patch", arguments: '{"nodeId":' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"n1"}' } }] }, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 50 } } },
    ]), onText, onUsage);
    expect(result.calls).toEqual([{ id: "call1", name: "canvas_patch", arguments: { nodeId: "n1" } }]);
    expect(onText).toHaveBeenCalledWith("我来调整。");
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ prompt_tokens_details: { cached_tokens: 50 } }));
  });
  it("never executes partial or truncated tools", async () => {
    await expect(readCreativeAgentChatResponse(sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "t", function: { name: "canvas_patch", arguments: "{" } }] } }] }], false), vi.fn(), vi.fn())).rejects.toThrow("INCOMPLETE");
    await expect(readCreativeAgentChatResponse(sse([{ choices: [{ delta: { content: "半段剧本" }, finish_reason: "length" }] }]), vi.fn(), vi.fn())).rejects.toThrow("INCOMPLETE");
  });
  it("rejects a complete tool payload when the stream ends before DONE", async () => {
    const response = sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "t", function: { name: "canvas_patch", arguments: '{"nodeId":"n1"}' } }] }, finish_reason: "tool_calls" }] }], false);
    await expect(readCreativeAgentChatResponse(response, vi.fn(), vi.fn())).rejects.toThrow("INCOMPLETE");
  });
  it("supports non-streaming responses but rejects malformed or duplicated calls", async () => {
    const message = { content: null, tool_calls: [{ id: "a", function: { name: "canvas_read", arguments: "{}" } }] };
    const good = await readCreativeAgentChatResponse(Response.json({ choices: [{ message, finish_reason: "tool_calls" }] }), vi.fn(), vi.fn());
    expect(good.calls).toHaveLength(1);
    await expect(readCreativeAgentChatResponse(Response.json({ choices: [{ message: { ...message, tool_calls: [...message.tool_calls, ...message.tool_calls] }, finish_reason: "tool_calls" }] }), vi.fn(), vi.fn())).rejects.toThrow("DUPLICATED");
  });
  it("keeps tool result identities and images in model context", () => {
    const messages = creativeAgentChatMessages({ systemPrompt: "system", messages: [
      { role: "user", timestamp: 1, content: [{ type: "image", mimeType: "image/png", data: "YWJj" }] },
      { role: "toolResult", timestamp: 2, toolName: "canvas_read", toolCallId: "call-a", isError: false, content: [{ type: "text", text: "节点 n1" }] },
    ] });
    expect(messages[1]).toMatchObject({ role: "user", content: [{ image_url: { url: "data:image/png;base64,YWJj" } }] });
    expect(messages[2]).toMatchObject({ role: "tool", tool_call_id: "call-a", content: "节点 n1" });
  });
});
