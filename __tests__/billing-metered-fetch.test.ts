import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  begin: vi.fn(),
  finish: vi.fn(),
}));
vi.mock("@/lib/providers/transport", () => ({
  fetchWithProviderEgress: mocks.fetch,
}));
vi.mock("@/lib/billing/llm", () => ({
  beginLlmCost: mocks.begin,
  finishLlmCost: mocks.finish,
}));
import { fetchWithLlmBilling } from "@/lib/billing/metered-fetch";
const send = () =>
  fetchWithLlmBilling({ providerId: "test" } as any, "https://test.invalid", {
    method: "POST",
    body: JSON.stringify({ model: "model" }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.begin.mockResolvedValue({ id: 1 });
  mocks.finish.mockResolvedValue(undefined);
});
describe("legacy LLM usage capture", () => {
  it("captures DeepSeek cache hits without adding them twice", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 70, prompt_cache_miss_tokens: 30 } }), { headers: { "content-type": "application/json" } }));
    await (await send()).text();
    expect(mocks.finish).toHaveBeenCalledWith({ id: 1 }, { inputTokens: 100, outputTokens: 20, cachedInputTokens: 70 }, true);
  });
  it("preserves JSON bytes and records cached input separately", async () => {
    const body = JSON.stringify({
      choices: [{ message: { content: "test" } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 30 },
      },
    });
    mocks.fetch.mockResolvedValue(
      new Response(body, { headers: { "content-type": "application/json" } }),
    );
    expect(await (await send()).text()).toBe(body);
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(mocks.finish).toHaveBeenCalledWith(
      { id: 1 },
      { inputTokens: 100, outputTokens: 20, cachedInputTokens: 30 },
      true,
    );
  });
  it("assembles fragmented Anthropic usage and preserves streaming output", async () => {
    const text =
      'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":20,"cache_creation_input_tokens":30}}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":40}}\n\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(text);
    mocks.fetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(c) {
            for (let i = 0; i < bytes.length; i += 7)
              c.enqueue(bytes.slice(i, i + 7));
            c.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    expect(await (await send()).text()).toBe(text);
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(mocks.finish).toHaveBeenCalledWith(
      { id: 1 },
      {
        inputTokens: 60,
        outputTokens: 40,
        cachedInputTokens: 20,
        cacheCreationInputTokens: 30,
      },
      true,
    );
  });
  it("keeps transport failures and records unknown usage", async () => {
    mocks.fetch.mockRejectedValue(new Error("transport failed"));
    await expect(send()).rejects.toThrow("transport failed");
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(mocks.finish).toHaveBeenCalledWith({ id: 1 }, null, false);
  });
  it("does not contact the provider when price admission fails", async () => {
    mocks.begin.mockRejectedValueOnce(new Error("missing price"));
    await expect(send()).rejects.toThrow("missing price");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
