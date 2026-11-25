import { describe, expect, it } from "vitest";
import {
  ProviderAdminValidationError,
  computeProviderAdminRevision,
  sanitizeProviderAdminInput,
} from "@/lib/providers/admin-config";
import type { ProviderConfig } from "@/lib/providers/types";
import { getBuiltinProviders } from "@/lib/providers/registry";

describe("provider admin configuration", () => {
  it("creates an opaque revision that covers providers, proxy and LLM bindings", () => {
    const base = {
      "providers.registry": "provider-secret",
      "providers.proxy": "proxy-secret",
      "llm_route.canvas.chat": "canvas-binding",
      "llm_route.image.role_prompt": null,
    };
    const revision = computeProviderAdminRevision(base);

    expect(revision).toMatch(/^[a-f0-9]{64}$/);
    expect(revision).not.toContain("secret");
    expect(computeProviderAdminRevision({ ...base, "providers.proxy": "changed" })).not.toBe(revision);
    expect(computeProviderAdminRevision({ ...base, "llm_route.canvas.chat": "changed" })).not.toBe(revision);
  });

  it("locks builtin identity fields while accepting an explicit valid egress", () => {
    const [provider] = sanitizeProviderAdminInput([{
      id: "apimart",
      name: "APIMART custom label",
      protocol: "jimeng",
      baseUrl: "https://api.apimart.ai/v1",
      envKeyName: "ATTACKER_SELECTED_ENV",
      egressMode: "direct",
      imageModels: ["image-a"],
      videoModels: ["video-a"],
      chatModels: ["chat-a"],
      enabled: true,
      sortOrder: 0,
    }], []);

    expect(provider).toMatchObject({
      id: "apimart",
      protocol: "apimart",
      egressMode: "direct",
      allowLegacyFallback: true,
    });
  });

  it("rejects an invalid egress instead of normalizing it to direct", () => {
    expect(() => sanitizeProviderAdminInput([{
      id: "kie",
      name: "KIE",
      baseUrl: "https://api.kie.ai",
      egressMode: "sometimes",
    }], [])).toThrowError(ProviderAdminValidationError);
  });

  it.each([null, ""])("rejects the explicit invalid egress value %j", (egressMode) => {
    expect(() => sanitizeProviderAdminInput([{
      id: "kie",
      name: "KIE",
      baseUrl: "https://api.kie.ai",
      egressMode,
    }], [])).toThrowError(ProviderAdminValidationError);
  });

  it("creates only OpenAI-compatible chat custom providers with an immutable safe id", () => {
    const [provider] = sanitizeProviderAdminInput([{
      id: "custom-my-provider",
      name: "My Provider",
      protocol: "gemini",
      baseUrl: "https://example.test/v1",
      envKeyName: "SECRET_ENV",
      egressMode: "proxy",
      imageModels: ["fake-image"],
      videoModels: ["fake-video"],
      chatModels: [" chat-a ", "chat-a", "chat-b"],
      allowLegacyFallback: true,
      enabled: true,
      sortOrder: -100,
    }], []);

    expect(provider).toMatchObject({
      id: "custom-my-provider",
      protocol: "openai",
      llmProtocol: "openai-chat",
      llmEndpointTemplate: "chat/completions",
      egressMode: "proxy",
      imageModels: [],
      videoModels: [],
      chatModels: ["chat-a", "chat-b"],
      modelProtocols: {},
      allowLegacyFallback: false,
    });
    expect(provider.sortOrder).toBeGreaterThan(Math.max(...getBuiltinProviders().map(p => p.sortOrder)));
  });

  it.each([
    "other-id",
    "custom-UPPER",
    "custom-double--dash",
    `custom-${"a".repeat(60)}`,
  ])("rejects an invalid new custom id: %s", (id) => {
    expect(() => sanitizeProviderAdminInput([{
      id,
      name: "Invalid",
      baseUrl: "https://example.test/v1",
      egressMode: "direct",
      chatModels: [],
    }], [])).toThrowError(ProviderAdminValidationError);
  });

  it.each([
    "https://user:secret@example.test/v1",
    "https://example.test/v1?x=1",
    "https://example.test/v1#fragment",
    "file:///tmp/provider",
  ])("rejects an unsafe custom base URL: %s", (baseUrl) => {
    expect(() => sanitizeProviderAdminInput([{
      id: "custom-safe-id",
      name: "Unsafe",
      baseUrl,
      egressMode: "direct",
      chatModels: [],
    }], [])).toThrowError(ProviderAdminValidationError);
  });

  it("does not let a saved custom provider be hard-deleted", () => {
    const existing = [{
      id: "custom-existing",
      name: "Existing",
      protocol: "openai" as const,
      baseUrl: "https://example.test/v1",
      egressMode: "direct" as const,
      imageModels: [],
      videoModels: [],
      chatModels: ["chat"],
      modelProtocols: {},
      enabled: true,
      sortOrder: 8,
    }];

    expect(() => sanitizeProviderAdminInput([], existing)).toThrowError(ProviderAdminValidationError);
  });

  it("does not carry a hidden saved or environment key across a Base URL origin change", () => {
    const originalKey = process.env.KIE_API_KEY;
    process.env.KIE_API_KEY = "hidden-environment-key";
    const existing: ProviderConfig[] = [{
      id: "kie",
      name: "KIE",
      protocol: "openai",
      baseUrl: "https://api.kie.ai",
      egressMode: "direct",
      apiKey: "hidden-saved-key",
      imageModels: [],
      videoModels: [],
      chatModels: [],
      modelProtocols: {},
      enabled: true,
      sortOrder: 0,
    }];
    const changed = {
      ...existing[0],
      baseUrl: "https://attacker.example/v1",
      apiKey: "",
    };

    try {
      expect(() => sanitizeProviderAdminInput([changed], existing)).toThrowError(
        "平台 kie 的 Base URL 已换到新域名，请重新输入 API Key 或明确清除 Key",
      );

      const [rekeyed] = sanitizeProviderAdminInput([{ ...changed, apiKey: "new-explicit-key" }], existing);
      expect(rekeyed.apiKey).toBe("new-explicit-key");
      expect(rekeyed.clearApiKey).toBe(false);

      const [disabled] = sanitizeProviderAdminInput([{ ...changed, enabled: false }], existing);
      expect(disabled.enabled).toBe(false);
      expect(disabled.clearApiKey).toBe(true);
    } finally {
      if (originalKey === undefined) delete process.env.KIE_API_KEY;
      else process.env.KIE_API_KEY = originalKey;
    }
  });

  it("does not treat an environment key as an existing platform credential", () => {
    const originalKey = process.env.KIE_API_KEY;
    process.env.KIE_API_KEY = "environment-key-that-must-be-ignored";
    const existing: ProviderConfig[] = [{
      id: "kie",
      name: "KIE",
      protocol: "openai",
      baseUrl: "https://api.kie.ai",
      egressMode: "direct",
      imageModels: [],
      videoModels: [],
      chatModels: [],
      modelProtocols: {},
      enabled: true,
      sortOrder: 0,
    }];

    try {
      const [changed] = sanitizeProviderAdminInput([{
        ...existing[0],
        baseUrl: "https://new-kie.example/v1",
      }], existing);
      expect(changed.baseUrl).toBe("https://new-kie.example/v1");
      expect(changed.clearApiKey).toBe(false);
      expect(changed.apiKey).toBeUndefined();
    } finally {
      if (originalKey === undefined) delete process.env.KIE_API_KEY;
      else process.env.KIE_API_KEY = originalKey;
    }
  });
});
