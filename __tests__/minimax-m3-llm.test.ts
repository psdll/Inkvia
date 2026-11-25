// Protocol tests isolate billing persistence.
vi.mock("@/lib/billing/llm", () => ({ beginLlmCost: vi.fn(async () => ({ id: 1, snapshot: {} })), finishLlmCost: vi.fn(async () => undefined) }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "@/lib/providers/types";
import type { ResolvedLlmRoute } from "@/lib/llm-routing/types";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), setting: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { appSetting: { findUnique: mocks.setting } } }));
vi.mock("@/lib/logger", () => ({ Logger: { log: vi.fn() } }));
vi.mock("@/lib/providers/transport", async (original) => ({
  ...await original<typeof import("@/lib/providers/transport")>(), fetchWithProviderEgress: mocks.fetch,
}));

import { getBuiltinProviders, toResolvedProvider } from "@/lib/providers/registry";
import { categorizeModels } from "@/lib/providers/upstream";
import { resolveLlmRouteFromProviders } from "@/lib/llm-routing/resolver";
import { getLlmProtocolAdapter } from "@/lib/llm-routing/adapters/registry";
import { callLlmForScenario } from "@/lib/llm-routing/gateway";

const adapter = getLlmProtocolAdapter("anthropic-messages")!;
const provider: ProviderConfig = {
  id: "minimax", name: "MiniMax 官方", protocol: "openai", baseUrl: "https://api.minimax.cn",
  apiKey: "saved-key", egressMode: "direct", enabled: true, chatModels: ["MiniMax-M3"],
  imageModels: [], videoModels: ["MiniMax-H3"], modelProtocols: {}, sortOrder: 0,
};
function route(): ResolvedLlmRoute {
  const result = resolveLlmRouteFromProviders({ scenarioId: "canvas.chat", binding: { providerId: "minimax", modelId: "MiniMax-M3" }, providers: [provider] });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error(result.status);
  return { ...result.route, egressDecision: { providerId: "minimax", mode: "direct", cacheKey: "direct" } };
}

describe("MiniMax-M3 integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("classifies M3 as chat while preserving video siblings", () => {
    expect(categorizeModels(["MiniMax-M3", "MiniMax-H3", "MiniMax-H3-Max"], "minimax"))
      .toEqual({ chat: ["MiniMax-M3"], video: ["MiniMax-H3", "MiniMax-H3-Max"], image: [] });
    expect(getBuiltinProviders().find((p) => p.id === "minimax")?.chatModels).toContain("MiniMax-M3");
  });

  it.each(["canvas.chat", "image.role_prompt"] as const)("resolves %s through the Anthropic adapter", (scenarioId) => {
    expect(resolveLlmRouteFromProviders({ scenarioId, binding: { providerId: "minimax", modelId: "MiniMax-M3" }, providers: [provider] }))
      .toMatchObject({ status: "ready", route: { protocol: "anthropic-messages", url: "https://api.minimax.cn/anthropic/v1/messages", apiKey: "saved-key" } });
  });

  it.each(["", "/", "/v1", "/anthropic", "/anthropic/v1"])("uses the Agent-compatible OpenAI endpoint from saved base path %s", suffix => {
    expect(resolveLlmRouteFromProviders({ scenarioId: "agent.chat", binding: { providerId: "minimax", modelId: "MiniMax-M3" }, providers: [{ ...provider, baseUrl: `https://saved.example/proxy${suffix}` }] }))
      .toMatchObject({ status: "ready", route: { protocol: "openai-chat", url: "https://saved.example/proxy/v1/chat/completions", apiKey: "saved-key" } });
  });

  it.each(["", "/", "/v1", "/anthropic", "/anthropic/v1"])("normalizes the saved base path %s", (suffix) => {
    expect(adapter.resolveEndpoint(toResolvedProvider({ ...provider, baseUrl: `https://saved.example${suffix}` }), "MiniMax-M3"))
      .toEqual({ ok: true, url: "https://saved.example/anthropic/v1/messages" });
  });

  it.each([
    [{ enabled: false }, "provider-disabled"],
    [{ apiKey: "" }, "missing-key"],
    [{ chatModels: [] }, "model-disabled"],
    [{ egressMode: "proxy" }, "missing-proxy"],
  ])("preserves existing routing gates %j", (overrides, status) => {
    expect(resolveLlmRouteFromProviders({ scenarioId: "canvas.chat", binding: { providerId: "minimax", modelId: "MiniMax-M3" }, providers: [{ ...provider, ...overrides } as ProviderConfig] }).status).toBe(status);
  });

  it("translates system, remote/base64 images, output limits and preserves assistant blocks", () => {
    const history = [{ type: "thinking", thinking: "previous", signature: "sig" }, { type: "text", text: "answer" }];
    const request = adapter.buildRequest(route(), [
      { role: "system", content: "Follow instructions" },
      { role: "user", content: [{ type: "text", text: "describe" }, { type: "image_url", image_url: { url: "https://example.test/a.png" } }, { type: "image_url", image_url: { url: "data:image/png;base64,YQ==" } }] },
      { role: "assistant", content: history },
    ], { tokens: 2048, parameter: "max_completion_tokens" });
    expect(request.init.headers).toMatchObject({ Authorization: "Bearer saved-key", "Content-Type": "application/json" });
    expect(JSON.parse(String(request.init.body))).toEqual({ model: "MiniMax-M3", max_tokens: 2048, stream: false,
      system: [{ type: "text", text: "Follow instructions" }], messages: [
        { role: "user", content: [{ type: "text", text: "describe" }, { type: "image", source: { type: "url", url: "https://example.test/a.png" } }, { type: "image", source: { type: "base64", media_type: "image/png", data: "YQ==" } }] },
        { role: "assistant", content: history },
      ] });
  });

  it("reads only answer text and accounts for cached tokens", () => {
    const payload = { content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "answer" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 20, cache_creation_input_tokens: 3 } };
    expect(adapter.parseSuccess(payload, 200)).toEqual({ ok: true, text: "answer" });
    expect(adapter.readUsage?.(payload)).toEqual({ inputTokens: 33, outputTokens: 5, totalTokens: 38, cachedInputTokens: 20, cacheCreationInputTokens: 3 });
    expect(adapter.parseSuccess({ ...payload, stop_reason: "max_tokens" }, 200).ok).toBe(false);
  });

  it("sends a complete request through the existing egress gateway", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 1 } })));
    const result = await callLlmForScenario(route(), [{ role: "user", content: "hello" }]);
    expect(result.text).toBe("ok");
    expect(result.usage?.totalTokens).toBe(6);
    expect(mocks.fetch).toHaveBeenCalledWith(expect.objectContaining({ providerId: "minimax", mode: "direct" }), "https://api.minimax.cn/anthropic/v1/messages", expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }));
    const body = JSON.parse(mocks.fetch.mock.calls[0][2].body);
    expect(body).toEqual({ model: "MiniMax-M3", max_tokens: 8192, stream: false, messages: [{ role: "user", content: "hello" }] });
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("stream_options");
  });

  it("carries the explicit M3 thinking toggle through the shared gateway", async () => {
    mocks.fetch.mockResolvedValue(Response.json({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }));
    await callLlmForScenario(route(), [{ role: "user", content: "hello" }], { thinkingLevel: "adaptive" });
    expect(JSON.parse(mocks.fetch.mock.calls[0][2].body)).toMatchObject({ thinking: { type: "adaptive" } });
  });

  it("redacts upstream errors", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: "invalid saved-key" } }), { status: 401 }));
    await expect(callLlmForScenario(route(), [{ role: "user", content: "hello" }])).rejects.toThrow("invalid [redacted]");
  });
});

it('maps native video references to MiniMax video source blocks', () => {
  const request = adapter.buildRequest(route(), [{ role: 'user', content: [{ type: 'video_url', video_url: { url: 'https://cdn.example/clip.mp4' } }] }]);
  expect(JSON.parse(String(request.init.body)).messages[0].content).toEqual([{ type: 'video', source: { type: 'url', url: 'https://cdn.example/clip.mp4' } }]);
});
