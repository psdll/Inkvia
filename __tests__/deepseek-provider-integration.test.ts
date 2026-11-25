import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveLlmEndpoint } from "@/lib/llm-routing/endpoint";
import { resolveLlmRouteFromProviders } from "@/lib/llm-routing/resolver";
import { resolveProviderLlmUiSettings } from "@/lib/providers/admin-ui";
import { supportsProviderModelFetch } from "@/lib/providers/model-fetch";
import { getBuiltinProviders, getProvidersOverview } from "@/lib/providers/registry";
import { categorizeModels } from "@/lib/providers/upstream";

describe("DeepSeek official provider integration", () => {
  it("registers a disabled direct LLM provider with the official API root", () => {
    const provider = getBuiltinProviders().find((item) => item.id === "deepseek");

    expect(provider).toMatchObject({
      id: "deepseek",
      name: "DeepSeek 官方",
      protocol: "openai",
      baseUrl: "https://api.deepseek.com",
      envKeyName: "",
      egressMode: "direct",
      imageModels: [],
      videoModels: [],
      chatModels: [],
      enabled: false,
    });
    expect(supportsProviderModelFetch(provider!)).toBe(true);
    expect(resolveProviderLlmUiSettings(provider!)).toMatchObject({
      supportsLlm: true,
      llmProtocol: "openai-chat",
      llmEndpointTemplate: "chat/completions",
    });
    expect(resolveLlmEndpoint(provider!, "deepseek-model")).toEqual({
      ok: true,
      url: "https://api.deepseek.com/chat/completions",
    });
  });

  it("exposes the disabled platform in the existing safe admin provider list", async () => {
    const overview = await getProvidersOverview({
      appSetting: { findUnique: async () => null },
    } as any);

    expect(overview.providers.find((item) => item.id === "deepseek")).toMatchObject({
      id: "deepseek",
      builtin: true,
      enabled: false,
      hasKey: false,
      keySource: "none",
      chatModels: [],
    });
  });

  it("classifies every fetched DeepSeek model as LLM regardless of its name", () => {
    expect(categorizeModels([
      "deepseek-chat-model",
      "deepseek-v4-flash-vision-exp",
      "deepseek-video-reasoner",
    ], "deepseek")).toEqual({
      image: [],
      video: [],
      chat: [
        "deepseek-chat-model",
        "deepseek-v4-flash-vision-exp",
        "deepseek-video-reasoner",
      ],
    });
  });

  it("becomes an executable existing LLM route after a fetched model is saved", () => {
    const builtin = getBuiltinProviders().find((item) => item.id === "deepseek")!;
    const modelId = "deepseek-v4-flash-vision-exp";

    expect(resolveLlmRouteFromProviders({
      scenarioId: "image.role_prompt",
      binding: { providerId: "deepseek", modelId },
      providers: [{
        ...builtin,
        apiKey: "saved-deepseek-key",
        chatModels: [modelId],
        enabled: true,
      }],
    })).toMatchObject({
      status: "ready",
      route: {
        providerId: "deepseek",
        modelId,
        protocol: "openai-chat",
        url: "https://api.deepseek.com/chat/completions",
      },
    });
  });
});
