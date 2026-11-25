import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "@/lib/providers/types";
import type { LlmScenarioId, ResolvedLlmRoute } from "@/lib/llm-routing/types";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), route: vi.fn() }));
// Transport assertions isolate the ledger, which has dedicated accounting tests.
vi.mock("@/lib/billing/llm", () => ({ beginLlmCost: vi.fn(async () => ({ id: 1 })), finishLlmCost: vi.fn(async () => undefined) }));
vi.mock("@/lib/prisma", () => ({ default: { appSetting: { findUnique: vi.fn() } } }));
vi.mock("@/lib/logger", () => ({ Logger: { log: vi.fn() } }));
vi.mock("@/lib/providers/transport", async (original) => ({
  ...await original<typeof import("@/lib/providers/transport")>(), fetchWithProviderEgress: mocks.fetch,
}));
vi.mock("@/lib/llm-routing/resolver", async (original) => ({
  ...await original<typeof import("@/lib/llm-routing/resolver")>(), resolveLlmRoute: mocks.route,
}));

import { BAILIAN_LLM_MODELS, QWEN_38_MAX_MODEL_ID, resolveBailianLlmBaseUrl } from "@/lib/bailian-llm-models";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins, toResolvedProvider } from "@/lib/providers/registry";
import { categorizeModels, listUpstreamModels } from "@/lib/providers/upstream";
import { supportsProviderModelFetch } from "@/lib/providers/model-fetch";
import { resolveLlmRouteFromProviders } from "@/lib/llm-routing/resolver";
import { callLlmForScenario } from "@/lib/llm-routing/gateway";
import { openAiChatAdapter } from "@/lib/llm-routing/adapters/openai-chat";
import { canvasLlmChat } from "@/lib/canvas/llm";

const provider: ProviderConfig = {
  id: "bailian", name: "阿里云百炼", protocol: "openai", baseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com",
  apiKey: "saved-key", egressMode: "direct", enabled: true, chatModels: [...BAILIAN_LLM_MODELS],
  imageModels: [], videoModels: ["wan3.0-video"], modelProtocols: {}, sortOrder: 0,
  llmEndpointTemplate: "chat/completions",
};
function route(scenarioId: LlmScenarioId = "canvas.chat", modelId: string = QWEN_38_MAX_MODEL_ID): ResolvedLlmRoute {
  const result = resolveLlmRouteFromProviders({ scenarioId, binding: { providerId: provider.id, modelId }, providers: [provider] });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error(result.status);
  return { ...result.route, egressDecision: { providerId: "bailian", mode: "direct", cacheKey: "direct" } };
}
const endpoint = `${provider.baseUrl}/compatible-mode/v1/chat/completions`;

describe("Qwen 3.8 Bailian integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["", "/", "/api/v1", "/compatible-mode/v1/", "/api/v1/services/aigc/video-generation/video-synthesis"])("normalizes saved base %s without changing the workspace", (suffix) => {
    expect(resolveBailianLlmBaseUrl(provider.baseUrl + suffix)).toBe(`${provider.baseUrl}/compatible-mode/v1`);
  });

  it.each(["", "https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com", "http://workspace.test", "https://user:key@workspace.test", "https://workspace.test/other", "https://workspace.test?key=secret", "https://workspace.test#fragment"])("rejects invalid or ambiguous base %s", (base) => {
    expect(() => resolveBailianLlmBaseUrl(base)).toThrow();
  });

  it("registers a chat model without enabling the provider or restoring removed saved models", () => {
    expect(getBuiltinProviders().find(p => p.id === "bailian")).toMatchObject({ enabled: false, chatModels: ["qwen3.8-max", "qwen3.8-flash", "qwen3.8-omni-flash"], videoModels: ["wan3.0-video"] });
    expect(mergeSavedProvidersWithBuiltins([{ ...provider, chatModels: [] }]).find(p => p.id === "bailian")?.chatModels).toEqual([]);
    expect(supportsProviderModelFetch(provider)).toBe(true);
    expect(categorizeModels([...BAILIAN_LLM_MODELS, "wan3.0-video"], "bailian")).toEqual({ chat: [...BAILIAN_LLM_MODELS], video: ["wan3.0-video"], image: [] });
  });

  it.each(["canvas.chat", "image.role_prompt", "agent.chat"] as const)("uses the compatible endpoint for %s", (scenarioId) => {
    expect(route(scenarioId)).toMatchObject({ url: endpoint, protocol: "openai-chat", apiKey: "saved-key" });
  });

  it.each([
    [{ enabled: false }, "provider-disabled"], [{ apiKey: "" }, "missing-key"],
    [{ chatModels: [] }, "model-disabled"], [{ egressMode: "proxy" }, "missing-proxy"],
  ])("retains availability gate %j", (overrides, status) => {
    expect(resolveLlmRouteFromProviders({ scenarioId: "canvas.chat", binding: { providerId: "bailian", modelId: QWEN_38_MAX_MODEL_ID }, providers: [{ ...provider, ...overrides } as ProviderConfig] }).status).toBe(status);
  });

  it.each(BAILIAN_LLM_MODELS)("preserves multimodal synchronous requests for %s", (modelId) => {
    const messages = [{ role: "user" as const, content: [{ type: "text", text: "Describe" }, { type: "image_url", image_url: { url: "https://example.test/a.png" } }] }];
    const request = openAiChatAdapter.buildRequest(route("canvas.chat", modelId), messages, { tokens: 2048, parameter: "max_tokens" });
    expect(request.url).toBe(endpoint);
    expect(request.init.headers).toMatchObject({ Authorization: "Bearer saved-key" });
    expect(JSON.parse(String(request.init.body))).toEqual({ model: modelId, messages, stream: false, max_tokens: 2048, ...(modelId.includes("omni") ? { modalities: ["text"] } : {}) });
  });

  it("lists upstream models using the same workspace compatible base", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "qwen3.8-max" }] })));
    const result = await listUpstreamModels({ provider: toResolvedProvider(provider), decision: route().egressDecision! });
    expect(result).toMatchObject({ ok: true, models: ["qwen3.8-max"] });
    expect(mocks.fetch).toHaveBeenCalledWith(expect.objectContaining({ providerId: "bailian" }), `${provider.baseUrl}/compatible-mode/v1/models`, expect.objectContaining({ headers: { Authorization: "Bearer saved-key" } }));
  });

  it.each(BAILIAN_LLM_MODELS)("uses the same routing in canvas background tasks for %s", async (modelId) => {
    mocks.route.mockResolvedValue({ status: "ready", route: route("canvas.chat", modelId) });
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "answer" } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })));
    expect(await canvasLlmChat({ authUserId: 7, providerId: "bailian", model: modelId, prompt: "hello" })).toBe("answer");
    expect(mocks.fetch.mock.calls[0][1]).toBe(endpoint);
  });

  it.each(BAILIAN_LLM_MODELS)("streams Agent reasoning and answer for %s", async (modelId) => {
    const chunks = [
      { choices: [{ index: 0, delta: { reasoning_content: "reason" } }] },
      { choices: [{ index: 0, delta: { content: '{"ok":true}' } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    ];
    mocks.fetch.mockResolvedValue(new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } }));
    const onDelta = vi.fn(async () => undefined);
    expect(await callLlmForScenario(route("agent.chat", modelId), [{ role: "user", content: "Return JSON" }], { onDelta })).toMatchObject({ text: '{"ok":true}', usage: { totalTokens: 15 } });
    expect(onDelta).toHaveBeenCalledWith({ kind: "analysis", text: "reason" });
    expect(onDelta).toHaveBeenCalledWith({ kind: "text", text: '{"ok":true}' });
    expect(JSON.parse(mocks.fetch.mock.calls[0][2].body)).toMatchObject({ model: modelId, stream: true, stream_options: { include_usage: true } });
  });
});
