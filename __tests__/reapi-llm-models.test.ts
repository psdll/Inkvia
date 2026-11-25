import { describe, expect, it } from "vitest";
import { openAiChatAdapter } from "@/lib/llm-routing/adapters/openai-chat";
import { resolveLlmRouteFromProviders } from "@/lib/llm-routing/resolver";
import {
  getBuiltinProviders,
  mergeSavedProvidersWithBuiltins,
} from "@/lib/providers/registry";

const REAPI_LLM_MODELS = [
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "gpt-5.5",
  "gpt-5.6-sol",
];

function reapiProvider() {
  const builtin = getBuiltinProviders().find((provider) => provider.id === "reapi")!;
  return mergeSavedProvidersWithBuiltins([{
    ...builtin,
    baseUrl: "https://reapi.ai/api/v1",
    apiKey: "saved-media-key",
    imageModels: ["gpt-image-2-official"],
    chatModels: REAPI_LLM_MODELS,
    enabled: true,
    sortOrder: -1,
  }]).find((provider) => provider.id === "reapi")!;
}

describe("reAPI LLM models", () => {
  it("removes the four saved chat models without changing the saved media gateway or key", () => {
    const reapi = reapiProvider();

    expect(reapi).toMatchObject({
      baseUrl: "https://reapi.ai/api/v1",
      apiKey: "saved-media-key",
      imageModels: expect.arrayContaining(["gpt-image-2.5-flare-official", "gpt-image-2.5-sunburst-official", "midjourney"]),
      chatModels: [],
      enabled: true,
    });
  });

  it.each(REAPI_LLM_MODELS)("rejects stale route bindings for removed model %s", (modelId) => {
    const reapi = reapiProvider();

    expect(resolveLlmRouteFromProviders({
      scenarioId: "canvas.chat",
      binding: { providerId: "reapi", modelId },
      providers: [reapi],
    })).toMatchObject({
      status: "model-disabled",
    });
  });

  it("rejects the removed models for image role prompts", () => {
    const reapi = reapiProvider();

    for (const modelId of ["deepseek-v4-flash", "deepseek-v4-pro", "gpt-5.6-sol"]) {
      expect(resolveLlmRouteFromProviders({
        scenarioId: "image.role_prompt",
        binding: { providerId: "reapi", modelId },
        providers: [reapi],
      })).toMatchObject({ status: "model-disabled" });
    }
    expect(resolveLlmRouteFromProviders({
      scenarioId: "image.role_prompt",
      binding: { providerId: "reapi", modelId: "gpt-5.5" },
      providers: [reapi],
    })).toEqual({ status: "model-disabled" });
  });

  it("requests strict JSON for reAPI GPT Agent calls without adding image-provider fields", () => {
    const messages = [{ role: "user" as const, content: "Return JSON" }];
    const request = openAiChatAdapter.buildRequest({
      scenarioId: "agent.chat",
      providerId: "reapi",
      providerName: "reAPI",
      modelId: "gpt-5.6-sol",
      protocol: "openai-chat",
      source: "configured",
      status: "ready",
      url: "https://reapi.ai/api/v1/chat/completions",
      apiKey: "saved-media-key",
      timeoutMs: 180_000,
    }, messages);

    expect(request.url).toBe("https://reapi.ai/api/v1/chat/completions");
    expect(JSON.parse(String(request.init.body))).toEqual({
      model: "gpt-5.6-sol",
      messages,
      stream: false,
      response_format: { type: "json_object" },
    });
  });

  it("keeps DeepSeek Agent JSON prompting compatible without an unsupported response_format field", () => {
    const messages = [{ role: "user" as const, content: "Return JSON" }];
    const request = openAiChatAdapter.buildRequest({
      scenarioId: "agent.chat",
      providerId: "reapi",
      providerName: "reAPI",
      modelId: "deepseek-v4-pro",
      protocol: "openai-chat",
      source: "configured",
      status: "ready",
      url: "https://reapi.ai/api/v1/chat/completions",
      apiKey: "saved-media-key",
      timeoutMs: 180_000,
    }, messages);

    expect(JSON.parse(String(request.init.body))).toEqual({
      model: "deepseek-v4-pro",
      messages,
      stream: false,
    });
  });
});
