import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getBuiltinProviders, getRegisteredProviders } from "@/lib/providers/registry";
import { resolveLlmEndpoint } from "@/lib/llm-routing/endpoint";
import { resolveLlmRouteFromProviders } from "@/lib/llm-routing/resolver";
import { openAiChatAdapter } from "@/lib/llm-routing/adapters/openai-chat";
import { getLlmModelModalities } from "@/lib/llm-routing/model-modalities";

const model = "doubao-seed-evolving";
describe("Doubao Seed Evolving integration", () => {
  it("registers the model and backfills saved platforms without enabling them", async () => {
    const builtin = getBuiltinProviders().find(p => p.id === "volcengine")!;
    expect(builtin.chatModels).toContain(model);
    const providers = await getRegisteredProviders({ appSetting: { findUnique: async () => ({ value: JSON.stringify([
      { ...builtin, chatModels: ["custom-model"], enabled: false },
    ]) }) } } as any);
    expect(providers.find(p => p.id === "volcengine")).toMatchObject({ enabled: false, chatModels: expect.arrayContaining([model, "custom-model"]) });
  });
  it.each(["https://ark.cn-beijing.volces.com", "https://ark.cn-beijing.volces.com/api/v3/"])("resolves the Ark endpoint from %s", baseUrl => {
    expect(resolveLlmEndpoint({ id: "volcengine", protocol: "volcengine", baseUrl }, model)).toEqual({ ok: true, url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions" });
  });
  it("builds streaming and multimodal Chat API requests and reads cache usage", () => {
    const provider = { ...getBuiltinProviders().find(p => p.id === "volcengine")!, apiKey: "test-key", chatModels: [model] };
    const result = resolveLlmRouteFromProviders({ scenarioId: "canvas.chat", binding: { providerId: provider.id, modelId: model }, providers: [provider] });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error(result.status);
    for (const stream of [false, true]) {
      const messages = [{ role: "user" as const, content: [{ type: "text" as const, text: "描述图片" }, { type: "image_url" as const, image_url: { url: "https://example.com/image.png" } }] }];
      const request = openAiChatAdapter.buildRequest(result.route, messages, undefined, stream);
      expect(request.url).toBe("https://ark.cn-beijing.volces.com/api/v3/chat/completions");
      expect(JSON.parse(request.init.body as string)).toEqual({ model, messages, stream, ...(stream ? { stream_options: { include_usage: true } } : {}) });
    }
    expect(openAiChatAdapter.readUsage!({ usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 10 } } })).toMatchObject({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 40, reasoningOutputTokens: 10 });
    expect(getLlmModelModalities("volcengine", model)).toEqual({ input: ["text", "image", "video"], output: ["text"] });
  });
});
