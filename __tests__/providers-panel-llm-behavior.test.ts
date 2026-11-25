import { describe, expect, it } from "vitest";
import {
  boundScenarioLabels,
  isScenarioBoundToModel,
  resolveProviderLlmUiSettings,
} from "@/lib/providers/admin-ui";

const scenarios = [{
  id: "canvas.chat",
  label: "画布对话",
  visual: false,
  configured: { providerId: "provider-b", modelId: "shared-model" },
  effective: { providerId: "provider-b", modelId: "shared-model", status: "ready" },
  candidates: [],
}];

describe("provider LLM UI settings", () => {
  it("does not expose an unregistered native protocol as runnable", () => {
    expect(resolveProviderLlmUiSettings({
      id: "native-gemini",
      protocol: "gemini",
      chatModels: ["gemini-model"],
      llmProtocol: "gemini-generate-content",
    })).toMatchObject({ supportsLlm: false });
  });

  it.each(["gemini", "jimeng"] as const)(
    "does not infer OpenAI chat settings for %s from chat models",
    (protocol) => {
      expect(resolveProviderLlmUiSettings({
        id: `${protocol}-provider`,
        protocol,
        chatModels: ["chat-model"],
      })).toEqual({
        supportsLlm: false,
        defaultEndpointTemplate: null,
        llmProtocol: undefined,
        llmEndpointTemplate: undefined,
      });
    },
  );

  it.each([
    ["openai-provider", "openai", "chat/completions"],
    ["apimart-provider", "apimart", "chat/completions"],
    ["volcengine-provider", "volcengine", "chat/completions"],
    ["kie", "gemini", "{model}/v1/chat/completions"],
  ] as const)("applies the server legacy default for %s", (id, protocol, endpoint) => {
    expect(resolveProviderLlmUiSettings({ id, protocol, chatModels: [] })).toEqual({
      supportsLlm: true,
      defaultEndpointTemplate: endpoint,
      llmProtocol: "openai-chat",
      llmEndpointTemplate: endpoint,
    });
  });

  it("preserves an explicit OpenAI chat configuration on a non-legacy provider", () => {
    expect(resolveProviderLlmUiSettings({
      id: "custom-gemini",
      protocol: "gemini",
      chatModels: ["vision-model"],
      llmProtocol: "openai-chat",
      llmEndpointTemplate: "deployments/{model}/chat/completions",
    })).toEqual({
      supportsLlm: true,
      defaultEndpointTemplate: null,
      llmProtocol: "openai-chat",
      llmEndpointTemplate: "deployments/{model}/chat/completions",
    });
  });

  it("does not invent an endpoint for an explicit non-legacy provider", () => {
    expect(resolveProviderLlmUiSettings({
      id: "custom-jimeng",
      protocol: "jimeng",
      chatModels: ["chat-model"],
      llmProtocol: "openai-chat",
    })).toEqual({
      supportsLlm: true,
      defaultEndpointTemplate: null,
      llmProtocol: "openai-chat",
      llmEndpointTemplate: undefined,
    });
  });
});

describe("inline LLM scenario bindings", () => {
  it("matches active tags by provider and model", () => {
    expect(isScenarioBoundToModel(scenarios[0], "provider-b", "shared-model")).toBe(true);
    expect(isScenarioBoundToModel(scenarios[0], "provider-a", "shared-model")).toBe(false);
  });

  it("lists scenarios that protect a model from removal", () => {
    expect(boundScenarioLabels(scenarios, "provider-b", "shared-model")).toEqual(["画布对话"]);
    expect(boundScenarioLabels(scenarios, "provider-a", "shared-model")).toEqual([]);
  });
});
