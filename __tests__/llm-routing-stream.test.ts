// Route/protocol tests isolate durable billing; billing integration has its own regression tests.
vi.mock("@/lib/billing/llm", () => ({ beginLlmCost: vi.fn(async () => ({ id: 1, snapshot: {} })), finishLlmCost: vi.fn(async () => undefined) }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readChatStream } from "@/lib/llm-routing/adapters/chat-stream";
const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/providers/transport", () => ({
  fetchWithProviderEgress: transport.fetch,
  ProviderNetworkError: class extends Error {},
}));
vi.mock("@/lib/logger", () => ({ Logger: { log: vi.fn() } }));
import { callLlmForScenario } from "@/lib/llm-routing/gateway";

const frame = (delta: unknown, finish_reason: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\r\n\r\n`;
const usage =
  'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}\n\n';
function response(text: string, split = 7) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += split)
          controller.enqueue(bytes.slice(i, i + split));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
const route = {
  scenarioId: "agent.chat",
  providerId: "test",
  providerName: "Test",
  modelId: "test",
  protocol: "openai-chat",
  source: "configured",
  status: "ready",
  url: "https://example.invalid/chat/completions",
  apiKey: "synthetic-secret",
  timeoutMs: 10000,
  egressDecision: { providerId: "test", mode: "direct", cacheKey: "direct" },
} as const;
describe("Agent stream protocol", () => {
  beforeEach(() => vi.clearAllMocks());
  it("streams public analysis and UTF-8 text independently while retaining final usage", async () => {
    const deltas: any[] = [];
    const result = await readChatStream(
      response(
        frame({ reasoning_content: "观察参考素材" }) +
          frame({ content: '{"content":"海景🌊"}' }) +
          frame({}, "stop") +
          usage +
          "data: [DONE]\n\n",
        1,
      ),
      async (delta) => {
        deltas.push(delta);
      },
    );
    expect(deltas).toEqual([
      { kind: "analysis", text: "观察参考素材" },
      { kind: "text", text: '{"content":"海景🌊"}' },
    ]);
    expect(result.choices[0].message.content).toBe('{"content":"海景🌊"}');
    expect(result.usage).toMatchObject({ total_tokens: 30 });
  });
  it.each([
    frame({ content: '{"content":"incomplete"}' }),
    frame({ content: "{}" }, "length") + usage + "data: [DONE]\n\n",
    "data: {invalid}\n\n",
    'data: {"error":{"message":"private-error"}}\n\n',
  ])(
    "rejects truncated, limited and failed streams before execution",
    async (text) => {
      await expect(
        readChatStream(response(text), async () => {}),
      ).rejects.toThrow("LLM_STREAM_INVALID_OR_INTERRUPTED");
    },
  );
  it("opts in only for Agent, keeps output limits and makes exactly one upstream request", async () => {
    transport.fetch.mockResolvedValue(
      response(frame({ content: '{"content":"hello"}' }, "stop") + usage),
    );
    const onDelta = vi.fn();
    const result = await callLlmForScenario(
      route,
      [{ role: "user", content: "hello" }],
      {
        onDelta,
        outputLimit: { tokens: 1234, parameter: "max_completion_tokens" },
      },
    );
    expect(transport.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(transport.fetch.mock.calls[0][2].body)).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 1234,
    });
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 20 });
    expect(onDelta).toHaveBeenCalled();
  });
  it("retains metering after a length-limited response and does not retry", async () => {
    transport.fetch.mockResolvedValue(
      response(frame({ content: "{}" }, "length") + usage),
    );
    await expect(
      callLlmForScenario(route, [], { onDelta: async () => {} }),
    ).rejects.toMatchObject({
      kind: "invalid-response",
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });
  it("accepts a server returning normal JSON without issuing a second request", async () => {
    transport.fetch.mockResolvedValue(
      new Response('{"choices":[{"message":{"content":"ok"}}]}'),
    );
    await expect(
      callLlmForScenario(route, [], { onDelta: async () => {} }),
    ).resolves.toMatchObject({ text: "ok" });
    expect(transport.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not enable streaming on other scenarios", async () => {
    transport.fetch.mockResolvedValue(
      new Response('{"choices":[{"message":{"content":"ok"}}]}'),
    );
    await callLlmForScenario({ ...route, scenarioId: "canvas.chat" }, [], {
      onDelta: async () => {},
    });
    expect(JSON.parse(transport.fetch.mock.calls[0][2].body)).toMatchObject({
      stream: false,
    });
  });
});

it('collects Qwen Omni text and usage for canvas without a streaming UI callback', async () => {
  transport.fetch.mockResolvedValue(response(frame({ content: 'recognized audio and video' }, 'stop') + usage));
  const result = await callLlmForScenario({ ...route, scenarioId: 'canvas.chat', modelId: 'qwen3.8-omni-flash' }, [{ role: 'user', content: 'describe' }]);
  expect(result.text).toBe('recognized audio and video');
  expect(result.usage?.totalTokens).toBe(30);
  expect(JSON.parse(transport.fetch.mock.calls.at(-1)![2].body)).toMatchObject({ stream: true, modalities: ['text'], stream_options: { include_usage: true } });
});
