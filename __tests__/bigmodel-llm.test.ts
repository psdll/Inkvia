import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), route: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { appSetting: { findUnique: vi.fn() } } }));
vi.mock("@/lib/billing/llm", () => ({ beginLlmCost: vi.fn(async () => ({ id: 1 })), finishLlmCost: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({ Logger: { log: vi.fn() } }));
vi.mock("@/lib/providers/transport", async original => ({ ...await original<typeof import("@/lib/providers/transport")>(), fetchWithProviderEgress: mocks.fetch }));
vi.mock("@/lib/llm-routing/resolver", async original => ({ ...await original<typeof import("@/lib/llm-routing/resolver")>(), resolveLlmRoute: mocks.route }));
import { getBuiltinProviders, getRegisteredProviders, toResolvedProvider } from "@/lib/providers/registry";
import { isBuiltinProviderModel } from "@/lib/providers/model-availability";
import { supportsProviderModelFetch } from "@/lib/providers/model-fetch";
import { resolveLlmEndpoint } from "@/lib/llm-routing/endpoint";
import { resolveLlmRouteFromProviders } from "@/lib/llm-routing/resolver";
import { openAiChatAdapter } from "@/lib/llm-routing/adapters/openai-chat";
import { buildLlmThinkingParams, getLlmThinkingCapabilities } from "@/lib/llm-routing/reasoning";
import { getLlmModelModalities } from "@/lib/llm-routing/model-modalities";
import type { ProviderConfig } from "@/lib/providers/types";
import { canvasLlmChat } from "@/lib/canvas/llm";

const models = ["glm-5.3", "glm-5.3-flash"];
const provider: ProviderConfig = {
  id: "bigmodel", name: "智谱 BigModel", protocol: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  apiKey: "saved-test-key", enabled: true, egressMode: "direct", chatModels: models,
  imageModels: [], videoModels: [], modelProtocols: {}, sortOrder: 0,
};

describe("BigModel GLM 5.3 integration", () => {
  it.each(models)("uses the shared adapter for worker canvas calls with default thinking: %s", async modelId => {
    const result = resolveLlmRouteFromProviders({ scenarioId: "canvas.chat", binding: { providerId: provider.id, modelId }, providers: [provider] });
    if (result.status !== "ready") throw new Error(result.status);
    mocks.route.mockResolvedValue({ ...result, route: { ...result.route, egressDecision: { providerId: "bigmodel", mode: "direct", cacheKey: "direct" } } });
    mocks.fetch.mockResolvedValue(Response.json({ choices: [{ message: { content: "answer" } }] }));
    expect(await canvasLlmChat({ authUserId: 7, providerId: "bigmodel", model: modelId, prompt: "hello" })).toBe("answer");
    const [egress, url, init] = mocks.fetch.mock.calls.at(-1)!;
    expect(egress).toMatchObject({ providerId: "bigmodel", mode: "direct" });
    expect(url).toBe(`${provider.baseUrl}/chat/completions`);
    expect(JSON.parse(init.body)).toMatchObject({ model: modelId, thinking: { type: "enabled", clear_thinking: false } });
  });
  it("registers both models as an independent direct provider with no environment key fallback", () => {
    const builtin = getBuiltinProviders().find(p => p.id === "bigmodel")!;
    expect(builtin).toMatchObject({ baseUrl: provider.baseUrl, protocol: "openai", egressMode: "direct", enabled: false, envKeyName: "", chatModels: models });
    expect(toResolvedProvider(builtin)).toMatchObject({ apiKey: "", hasKey: false });
    expect(supportsProviderModelFetch(builtin)).toBe(false);
    for (const model of models) expect(isBuiltinProviderModel("bigmodel", "chat", model)).toBe(true);
  });
  it("backfills saved models while preserving saved key, URL and disabled state", async () => {
    const saved = { ...provider, apiKey: "kept-key", baseUrl: "https://saved.example/proxy", enabled: false, chatModels: ["custom-model"] };
    const registered = await getRegisteredProviders({ appSetting: { findUnique: async () => ({ value: JSON.stringify([saved]) }) } } as any);
    // The old default name is upgraded to the current "官方" name; everything else stays as saved.
    expect(registered.find(p => p.id === "bigmodel")).toMatchObject({ ...saved, name: "智谱 BigModel 官方", chatModels: ["custom-model", ...models] });
  });
  it.each(["https://open.bigmodel.cn", "https://open.bigmodel.cn/", "https://open.bigmodel.cn/api/paas/v4/"])("resolves the official endpoint from %s", baseUrl => {
    expect(resolveLlmEndpoint({ ...provider, baseUrl }, models[0])).toEqual({ ok: true, url: `${provider.baseUrl}/chat/completions` });
  });
  it("preserves explicitly saved gateway paths", () => {
    expect(resolveLlmEndpoint({ ...provider, baseUrl: "https://saved.example/proxy/v4/" }, models[0]))
      .toEqual({ ok: true, url: "https://saved.example/proxy/v4/chat/completions" });
  });
  it.each(models)("exposes only documented thinking options for %s", modelId => {
    const target = { providerId: "bigmodel", modelId };
    expect(getLlmThinkingCapabilities(target)).toEqual({ thinkingLevels: ["default", "low", "high", "max"], thinkingDefault: "max", reasoningControl: true });
    for (const level of ["default", "low", "high", "max"] as const) {
      expect(buildLlmThinkingParams(target, level)).toEqual({ thinking: { type: "enabled", clear_thinking: false }, ...(level === "default" ? {} : { reasoning_effort: level }) });
    }
    expect(() => buildLlmThinkingParams(target, "none")).toThrow();
    expect(() => buildLlmThinkingParams(target, "medium")).toThrow();
  });
  it.each(models)("uses documented fields for sync, streaming and Agent routes: %s", modelId => {
    for (const scenarioId of ["canvas.chat", "agent.chat", "image.role_prompt"] as const) {
      const result = resolveLlmRouteFromProviders({ scenarioId, binding: { providerId: provider.id, modelId }, providers: [provider] });
      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error(result.status);
      for (const stream of [false, true]) {
        const messages = [{ role: "user" as const, content: "hello" }];
        const request = openAiChatAdapter.buildRequest(result.route, messages, { tokens: 8192, parameter: "max_completion_tokens" }, stream);
        expect(request.url).toBe(`${provider.baseUrl}/chat/completions`);
        expect(request.init.headers).toMatchObject({ Authorization: "Bearer saved-test-key", "Content-Type": "application/json" });
        expect(JSON.parse(String(request.init.body))).toEqual({ model: modelId, messages, stream, thinking: { type: "enabled", clear_thinking: false }, max_tokens: 8192, ...(stream ? { tool_stream: true } : {}) });
      }
    }
  });
  it.each([
    [{ enabled: false }, "provider-disabled"], [{ apiKey: "" }, "missing-key"],
    [{ chatModels: [] }, "model-disabled"], [{ egressMode: "proxy" }, "missing-proxy"],
  ])("preserves routing gates %j", (overrides, status) => {
    expect(resolveLlmRouteFromProviders({ scenarioId: "canvas.chat", binding: { providerId: provider.id, modelId: models[0] }, providers: [{ ...provider, ...overrides } as ProviderConfig] }).status).toBe(status);
  });
  it("distinguishes text-only GLM from Flash visual input and preserves media payloads", () => {
    expect(getLlmModelModalities("bigmodel", models[0])).toEqual({ input: ["text"], output: ["text"] });
    expect(getLlmModelModalities("bigmodel", models[1])).toEqual({ input: ["text", "image", "video"], output: ["text"] });
    const result = resolveLlmRouteFromProviders({ scenarioId: "canvas.chat", binding: { providerId: provider.id, modelId: models[1] }, providers: [provider] });
    if (result.status !== "ready") throw new Error(result.status);
    const messages = [{ role: "user" as const, content: [{ type: "text" as const, text: "describe" }, { type: "image_url" as const, image_url: { url: "https://example.test/a.png" } }, { type: "video_url" as const, video_url: { url: "https://example.test/a.mp4" } }] }];
    expect(JSON.parse(String(openAiChatAdapter.buildRequest(result.route, messages).init.body)).messages).toEqual(messages);
  });
  it("reads cache usage without billing reasoning output twice", () => {
    expect(openAiChatAdapter.readUsage!({ usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40 } } }))
      .toMatchObject({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 40 });
  });
});
