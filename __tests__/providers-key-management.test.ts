import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: async (callback: (client: object) => unknown) => callback({
      appSetting: { findUnique: async () => null },
    }),
  },
}));

import {
  buildProviderOverviewItem,
  getBuiltinProviders,
  getRegisteredProviders,
  maskApiKey,
  mergeProviderSecretsForSave,
  toResolvedProvider,
} from "@/lib/providers/registry";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import { resolveTarget } from "@/lib/providers/upstream";
import type { ProviderConfig } from "@/lib/providers/types";

const baseProvider: ProviderConfig = {
  id: "apimart",
  name: "APIMART",
  protocol: "apimart",
  baseUrl: "https://api.apimart.ai/v1",
  envKeyName: "APIMART_API_KEY",
  egressMode: "proxy",
  imageModels: [],
  videoModels: [],
  chatModels: ["gpt-5.5"],
  modelProtocols: {},
  enabled: true,
  sortOrder: 0,
};

describe("provider API key management", () => {
  it("ignores the existing KIE environment key when the admin has not saved a key", () => {
    const original = process.env.KIE_API_KEY;
    process.env.KIE_API_KEY = "existing-kie-environment-key";
    try {
      const kie = getBuiltinProviders().find((provider) => provider.id === "kie");
      expect(kie).toMatchObject({ envKeyName: "KIE_API_KEY" });
      expect(toResolvedProvider(kie!).apiKey).toBe("");
      expect(buildProviderOverviewItem(kie!, { builtin: true })).toMatchObject({
        hasKey: false,
        keySource: "none",
      });
    } finally {
      if (original === undefined) delete process.env.KIE_API_KEY;
      else process.env.KIE_API_KEY = original;
    }
  });

  it("preserves an existing saved key when admin saves metadata without a new key", () => {
    const [merged] = mergeProviderSecretsForSave(
      [{ ...baseProvider, name: "APIMART updated" }],
      [{ ...baseProvider, apiKey: "sk-existing-secret" }],
    );

    expect(merged.apiKey).toBe("sk-existing-secret");
    expect(merged.name).toBe("APIMART updated");
  });

  it("updates or clears a saved key only when the request explicitly asks for it", () => {
    const [updated] = mergeProviderSecretsForSave(
      [{ ...baseProvider, apiKey: " sk-new-secret " }],
      [{ ...baseProvider, apiKey: "sk-existing-secret" }],
    );
    expect(updated.apiKey).toBe("sk-new-secret");

    const [cleared] = mergeProviderSecretsForSave(
      [{ ...baseProvider, clearApiKey: true }],
      [{ ...baseProvider, apiKey: "sk-existing-secret" }],
    );
    expect(cleared.apiKey).toBeUndefined();
  });

  it("never exposes the raw key in provider overview but reports saved state", () => {
    const overview = buildProviderOverviewItem(
      { ...baseProvider, apiKey: "sk-1234567890abcdef" },
      { builtin: true },
    );

    expect(overview).not.toHaveProperty("apiKey");
    expect(overview.hasKey).toBe(true);
    expect(overview.keyPreview).toMatch(/cdef$/);
    expect(maskApiKey("abcd")).not.toContain("abcd");
  });

  it("uses a whitelist DTO even when persisted data contains unexpected secret-like fields", () => {
    const overview = buildProviderOverviewItem(
      {
        ...baseProvider,
        apiKey: "sk-secret",
        password: "unexpected-password",
        proxyUrl: "http://user:secret@proxy:7890",
        token: "unexpected-token",
      } as ProviderConfig,
      { builtin: true },
    );

    expect(JSON.stringify(overview)).not.toContain("unexpected-password");
    expect(JSON.stringify(overview)).not.toContain("unexpected-token");
    expect(JSON.stringify(overview)).not.toContain("user:secret");
  });

  it("re-locks identity and environment key fields when reading historical persisted providers", async () => {
    const client = {
      appSetting: {
        findUnique: async () => ({ value: JSON.stringify([
          { ...baseProvider, protocol: "openai", envKeyName: "DATABASE_URL" },
          {
            id: "custom-history",
            name: "History",
            protocol: "gemini",
            baseUrl: "https://example.test/v1",
            envKeyName: "DATABASE_URL",
            egressMode: "direct",
            imageModels: ["fake-image"],
            videoModels: ["fake-video"],
            chatModels: ["chat"],
            modelProtocols: {},
            enabled: true,
            sortOrder: 20,
          },
        ]) }),
      },
    } as any;

    const providers = await getRegisteredProviders(client);
    expect(providers.find((provider) => provider.id === "apimart")).toMatchObject({
      protocol: "apimart",
      envKeyName: "APIMART_API_KEY",
      allowLegacyFallback: true,
    });
    expect(providers.find((provider) => provider.id === "custom-history")).toMatchObject({
      envKeyName: "",
      llmProtocol: "openai-chat",
      llmEndpointTemplate: "chat/completions",
      imageModels: [],
      videoModels: [],
      allowLegacyFallback: false,
    });
  });

  it("prefers the saved key over env when resolving a provider", () => {
    const original = process.env.APIMART_API_KEY;
    process.env.APIMART_API_KEY = "env-secret";
    try {
      const resolved = toResolvedProvider({ ...baseProvider, apiKey: "saved-secret" });
      expect(resolved.apiKey).toBe("saved-secret");
      expect(resolved.hasKey).toBe(true);
    } finally {
      if (original === undefined) delete process.env.APIMART_API_KEY;
      else process.env.APIMART_API_KEY = original;
    }
  });

  it("never uses an environment key when the admin page has not saved a key", () => {
    const original = process.env.APIMART_API_KEY;
    process.env.APIMART_API_KEY = "env-secret-that-must-not-be-used";
    try {
      const resolved = toResolvedProvider(baseProvider);
      const overview = buildProviderOverviewItem(baseProvider, {
        builtin: true,
      });

      expect(resolved.apiKey).toBe("");
      expect(resolved.hasKey).toBe(false);
      expect(overview.hasKey).toBe(false);
      expect(overview.keySource).toBe("none");
      expect(JSON.stringify(overview)).not.toContain("env-secret-that-must-not-be-used");
    } finally {
      if (original === undefined) delete process.env.APIMART_API_KEY;
      else process.env.APIMART_API_KEY = original;
    }
  });

  it("does not call a local key fallback when a provider is unavailable", () => {
    expect(() => resolvedProviderApiKey(null)).toThrow("API Key 未配置");
  });

  it("does not expose or resolve a builtin environment key for a changed origin", () => {
    const originalKey = process.env.APIMART_API_KEY;
    const originalBase = process.env.APIMART_BASE_URL;
    process.env.APIMART_API_KEY = "hidden-env-secret";
    process.env.APIMART_BASE_URL = "https://api.apimart.ai/v1";
    try {
      const changed = { ...baseProvider, baseUrl: "https://attacker.example/v1" };
      const resolved = toResolvedProvider(changed);
      const overview = buildProviderOverviewItem(changed, {
        builtin: true,
      });

      expect(resolved.apiKey).toBe("");
      expect(resolved.hasKey).toBe(false);
      expect(overview.hasKey).toBe(false);
      expect(JSON.stringify(overview)).not.toContain("hidden-env-secret");
    } finally {
      if (originalKey === undefined) delete process.env.APIMART_API_KEY;
      else process.env.APIMART_API_KEY = originalKey;
      if (originalBase === undefined) delete process.env.APIMART_BASE_URL;
      else process.env.APIMART_BASE_URL = originalBase;
    }
  });

  it("uses an entered key for a new provider without requiring an environment variable name", async () => {
    const provider = await resolveTarget({
      id: "custom-new-provider",
      baseUrl: "https://api.example.com/v1",
      apiKey: "saved-admin-key",
    });

    expect(provider).toMatchObject({
      baseUrl: "https://api.example.com/v1",
      apiKey: "saved-admin-key",
      hasKey: true,
    });
  });
});
