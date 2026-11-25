// Route/protocol tests isolate durable billing; billing integration has its own regression tests.
vi.mock("@/lib/billing/llm", () => ({ beginLlmCost: vi.fn(async () => ({ id: 1, snapshot: {} })), finishLlmCost: vi.fn(async () => undefined) }));
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setting: vi.fn(async () => null as null | { value: string }),
  providerFetch: vi.fn(),
  fetchWithProviderEgress: vi.fn(),
  resolveProviderRequestContext: vi.fn(),
  resolveProviderEgress: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ default: { appSetting: { findUnique: mocks.setting } } }));

vi.mock("@/lib/providers/transport", () => ({
  providerFetch: mocks.providerFetch,
  fetchWithProviderEgress: mocks.fetchWithProviderEgress,
  resolveProviderRequestContext: mocks.resolveProviderRequestContext,
  resolveProviderEgress: mocks.resolveProviderEgress,
}));
vi.mock("@/lib/providers/resolve", () => ({
  resolvedProviderApiKey: (provider: { apiKey?: string } | null) => {
    const key = String(provider?.apiKey || "").trim();
    if (!key) throw new Error("API Key 未配置，请在管理员 API 配置中保存");
    return key;
  },
}));
vi.mock("@/lib/config", () => ({
  getVolcengineAgentChatModel: () => "doubao-chat",
  getVolcengineAgentMemoryModel: () => "doubao-memory",
  getVolcengineArkBaseUrl: () => "https://volc.example.test",
}));

import { canvasLlmChat } from "@/lib/canvas/llm";
import * as KieProvider from "@/lib/llm/kie-provider";
import * as KieResponsesProvider from "@/lib/llm/kie-responses-provider";
import * as VolcengineProvider from "@/lib/llm/volcengine-provider";

const encoder = new TextEncoder();

function streamingResponse(chunks: string[]): Response {
  let index = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index++]));
    },
  }), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function collectChunks(chunks: AsyncIterable<unknown>): Promise<unknown[]> {
  const result: unknown[] = [];
  for await (const chunk of chunks) result.push(chunk);
  return result;
}

function providerContext(id: string) {
  const proxied = id === "apimart";
  const provider = id === "kie"
    ? { id, name: "KIE", baseUrl: "https://kie.example.test", apiKey: "kie-secret", egressMode: "direct" }
    : id === "volcengine"
      ? { id, name: "Volcengine", baseUrl: "https://saved-volc.example.test", apiKey: "saved-volc-secret", egressMode: "direct" }
      : { id, name: "APIMart", baseUrl: "https://apimart.example.test/v1", apiKey: "apimart-secret", egressMode: "proxy" };
  return {
    provider,
    decision: proxied
      ? {
          providerId: id,
          mode: "proxy",
          cacheKey: "proxy-snapshot",
          agentSlot: "database",
          proxyUri: "http://proxy.example.test:8080",
        }
      : { providerId: id, mode: "direct", cacheKey: "direct" },
  };
}

describe("LLM provider egress routing", () => {
  beforeEach(() => {
    mocks.setting.mockResolvedValue(null);
    mocks.providerFetch.mockReset();
    mocks.fetchWithProviderEgress.mockReset();
    mocks.resolveProviderRequestContext.mockReset();
    mocks.resolveProviderEgress.mockReset();
    mocks.resolveProviderEgress.mockResolvedValue({ providerId: "kie", mode: "direct", cacheKey: "direct" });
    mocks.resolveProviderRequestContext.mockImplementation(async (id: string) => providerContext(id));
    const chatResponse = new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }],
    }), { status: 200 });
    mocks.fetchWithProviderEgress.mockResolvedValue(chatResponse);
  });

  it("blocks an already queued Canvas selection after its model is hidden", async () => {
    mocks.setting.mockResolvedValue({ value: JSON.stringify({ ['llm:["apimart","chat-model"]']: false }) });
    await expect(canvasLlmChat({ authUserId: 7, providerId: "apimart", model: "chat-model", prompt: "hello" })).rejects.toThrow("已隐藏");
    expect(mocks.resolveProviderRequestContext).not.toHaveBeenCalled();
    expect(mocks.fetchWithProviderEgress).not.toHaveBeenCalled();
  });

  it("routes Canvas chat through its resolved provider and preserves the request timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await expect(canvasLlmChat({
      authUserId: 7,
      providerId: "apimart",
      model: "chat-model",
      prompt: "hello",
    })).resolves.toBe("ok");

    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "apimart", mode: "proxy" }),
      "https://apimart.example.test/v1/chat/completions",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
    expect(timeout).toHaveBeenCalledWith(120_000);
    timeout.mockRestore();
  });

  it("routes KIE chat completions through the kie egress policy", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "kie json" } }],
    }), { status: 200 }));

    await expect(KieProvider.chatJson(
      [{ role: "user", content: "hello" }],
      { models: ["gemini-test"] },
    )).resolves.toMatchObject({ model: "gemini-test", raw: "kie json" });

    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "kie", mode: "direct" }),
      "https://kie.example.test/gemini-test/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("routes both Volcengine JSON and streaming calls through the volcengine egress policy", async () => {
    mocks.fetchWithProviderEgress
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "{\"ok\":true}" } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(streamingResponse([
        'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
      ]));

    await VolcengineProvider.chatJson(
      [{ role: "user", content: "json" }],
      { models: ["doubao-memory"], responseFormat: "json_object" },
    );
    const stream = await VolcengineProvider.chatStream(
      [{ role: "user", content: "stream" }],
      { models: ["doubao-chat"] },
    );
    await collectChunks(stream.chunks);

    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledTimes(2);
    expect(mocks.fetchWithProviderEgress.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({ providerId: "volcengine", mode: "direct" }),
      expect.objectContaining({ providerId: "volcengine", mode: "direct" }),
    ]);
    expect(mocks.fetchWithProviderEgress.mock.calls.map((call) => call[1])).toEqual([
      "https://saved-volc.example.test/api/v3/chat/completions",
      "https://saved-volc.example.test/api/v3/chat/completions",
    ]);
    for (const call of mocks.fetchWithProviderEgress.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer saved-volc-secret" }),
      }));
    }
  });

  it("redacts reflected KIE credentials and endpoint URLs from upstream errors", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "upstream_error",
        message: "Bearer kie-secret https://kie.example.test/gemini-test/v1/chat/completions",
      },
    }), { status: 502 }));

    const error = await KieProvider.chatJson(
      [{ role: "user", content: "hello" }],
      { models: ["gemini-test"] },
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(JSON.stringify(error)).not.toContain("kie-secret");
    expect(JSON.stringify(error)).not.toContain("kie.example.test");
    expect(String(error?.message)).not.toContain("kie-secret");
    expect(String(error?.message)).not.toContain("kie.example.test");
  });

  it("redacts reflected Volcengine credentials and endpoint URLs from upstream errors", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "upstream_error",
        message: "Bearer saved-volc-secret https://saved-volc.example.test/api/v3/chat/completions",
      },
    }), { status: 502 }));

    const error = await VolcengineProvider.chatJson(
      [{ role: "user", content: "hello" }],
      { models: ["doubao-memory"] },
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(JSON.stringify(error)).not.toContain("saved-volc-secret");
    expect(JSON.stringify(error)).not.toContain("saved-volc.example.test");
    expect(String(error?.message)).not.toContain("saved-volc-secret");
    expect(String(error?.message)).not.toContain("saved-volc.example.test");
  });
});

describe("KIE Responses SSE parsing", () => {
  beforeEach(() => {
    mocks.providerFetch.mockReset();
    mocks.fetchWithProviderEgress.mockReset();
    mocks.resolveProviderRequestContext.mockReset();
    mocks.resolveProviderRequestContext.mockImplementation(async (id: string) => providerContext(id));
    mocks.resolveProviderEgress.mockReset();
    mocks.resolveProviderEgress.mockResolvedValue({ providerId: "kie", mode: "direct", cacheKey: "direct" });
  });

  async function runResponsesStream(chunks: string[]) {
    const response = streamingResponse(chunks);
    mocks.fetchWithProviderEgress.mockResolvedValue(response);
    const result = await KieResponsesProvider.chatStream(
      [{ role: "user", content: "hello" }],
      { models: ["gpt-5-test"] },
    );
    return collectChunks(result.chunks);
  }

  it("parses an SSE event fragmented across arbitrary byte chunks", async () => {
    await expect(runResponsesStream([
      "event: response.output_",
      'text.delta\ndata: {"type":"response.output_text.delta",',
      '"delta":"fragmented"}\n',
      "\n",
    ])).resolves.toEqual([{ delta: "fragmented" }]);
  });

  it("parses CRLF-delimited SSE events", async () => {
    await expect(runResponsesStream([
      "event: response.output_text.delta\r\n",
      'data: {"type":"response.output_text.delta","delta":"crlf"}\r\n\r\n',
    ])).resolves.toEqual([{ delta: "crlf" }]);
  });

  it("flushes the final SSE event when EOF arrives without an empty line", async () => {
    await expect(runResponsesStream([
      "event: response.output_text.delta\n",
      'data: {"type":"response.output_text.delta","delta":"tail"}\n\n',
      "event: response.completed\n",
      'data: {"type":"response.completed","response":{"status":"completed"}}',
    ])).resolves.toEqual([
      { delta: "tail" },
      { finishReason: "completed" },
    ]);
  });
});
