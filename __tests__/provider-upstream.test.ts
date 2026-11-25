import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchWithProviderEgress: vi.fn(),
  getRegisteredProviders: vi.fn(),
  readProxySettingRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $transaction: async (callback: (client: object) => unknown) => callback({}),
  },
}));
vi.mock("@/lib/providers/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/transport")>();
  return { ...actual, fetchWithProviderEgress: mocks.fetchWithProviderEgress };
});
vi.mock("@/lib/providers/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/registry")>();
  return { ...actual, getRegisteredProviders: mocks.getRegisteredProviders };
});
vi.mock("@/lib/providers/proxy-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/proxy-config")>();
  return { ...actual, readProxySettingRaw: mocks.readProxySettingRaw };
});

import { listUpstreamModels, resolveDraftTarget, testProviderLine } from "@/lib/providers/upstream";
import { ProviderNetworkError } from "@/lib/providers/transport";

const savedProvider = {
  id: "kie",
  name: "KIE",
  protocol: "openai" as const,
  baseUrl: "https://saved.example/v1",
  egressMode: "direct" as const,
  allowLegacyFallback: true,
  apiKey: "saved-key",
  hasKey: true,
  imageModels: [],
  videoModels: [],
  chatModels: [],
  modelProtocols: {},
  enabled: true,
  sortOrder: 0,
};

describe("provider draft upstream requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRegisteredProviders.mockResolvedValue([savedProvider]);
    mocks.readProxySettingRaw.mockResolvedValue(null);
  });

  it("merges draft fields without trusting a client-selected environment variable", async () => {
    process.env.DATABASE_URL = "database-secret";
    const target = await resolveDraftTarget({
      id: "kie",
      baseUrl: "https://draft.example/v1",
      envKeyName: "DATABASE_URL",
      apiKey: "draft-key",
      egressMode: "direct",
      proxyAction: { action: "keep" },
    } as any);

    expect(target?.provider).toMatchObject({
      id: "kie",
      baseUrl: "https://draft.example/v1",
      apiKey: "draft-key",
      egressMode: "direct",
    });
    expect(target?.provider).not.toHaveProperty("envKeyName");
    expect(JSON.stringify(target)).not.toContain("database-secret");
  });

  it("rejects an explicit null draft egress instead of silently using the saved mode", async () => {
    await expect(resolveDraftTarget({
      id: "kie",
      egressMode: null,
    } as any)).rejects.toMatchObject({ kind: "invalid-egress" });
  });

  it.each([401, 405, 500])("treats an unauthenticated GET status %s as line reachable", async (status) => {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(null, { status }));
    const target = await resolveDraftTarget({ id: "kie", proxyAction: { action: "keep" } });
    const result = await testProviderLine(target!);

    expect(result).toMatchObject({ ok: true, status });
    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "direct" }),
      "https://saved.example/v1",
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
    const init = mocks.fetchWithProviderEgress.mock.calls.at(-1)?.[2];
    expect(JSON.stringify(init).toLowerCase()).not.toContain("authorization");
  });

  it("uses an unsaved proxy draft without writing it", async () => {
    const target = await resolveDraftTarget({
      id: "kie",
      egressMode: "proxy",
      proxyAction: { action: "set", url: "http://user:secret@proxy.test:7890" },
    });

    expect(target?.decision).toMatchObject({ mode: "proxy", proxyUri: "http://proxy.test:7890" });
    expect(target?.decision).not.toHaveProperty("proxyUri", expect.stringContaining("secret"));
  });

  it("reports real proxy authentication and TLS failures without exposing endpoints", async () => {
    const target = await resolveDraftTarget({ id: "kie", proxyAction: { action: "keep" } });
    mocks.fetchWithProviderEgress.mockRejectedValueOnce(
      new ProviderNetworkError("proxy-connect", "Proxy authentication failed (407)"),
    );
    await expect(testProviderLine(target!)).resolves.toMatchObject({
      ok: false,
      message: "代理认证失败（407）",
    });

    mocks.fetchWithProviderEgress.mockRejectedValueOnce(
      Object.assign(new Error("Provider request failed"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" }),
    );
    await expect(testProviderLine(target!)).resolves.toMatchObject({
      ok: false,
      message: "TLS 连接失败",
    });
  });

  it("allows a draft line GET but never sends a hidden key to a changed origin", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(null, { status: 405 }));
    const target = await resolveDraftTarget({
      id: "kie",
      baseUrl: "https://attacker.example/v1",
      egressMode: "direct",
    });

    expect(target?.provider.hasKey).toBe(false);
    expect(target?.provider.apiKey).toBe("");
    await expect(testProviderLine(target!)).resolves.toMatchObject({ ok: true, status: 405 });
    await expect(listUpstreamModels(target!)).resolves.toMatchObject({ ok: false, status: 0, models: [] });
    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.fetchWithProviderEgress.mock.calls[0][2]).toLowerCase()).not.toContain("authorization");
  });

  it("uses the MiniMax official v1 model-list path from the API root", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "MiniMax-H3" }],
    }), { status: 200 }));

    await expect(listUpstreamModels({
      provider: {
        ...savedProvider,
        id: "minimax",
        name: "MiniMax 官方",
        baseUrl: "https://api.minimaxi.com",
      },
      decision: { providerId: "minimax", mode: "direct", cacheKey: "direct" },
    })).resolves.toMatchObject({ ok: true, models: ["MiniMax-H3"] });

    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "minimax" }),
      "https://api.minimaxi.com/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("uses the DeepSeek official models endpoint and standard response schema", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(JSON.stringify({
      object: "list",
      data: [{ id: "deepseek-model", object: "model", owned_by: "deepseek" }],
    }), { status: 200 }));

    await expect(listUpstreamModels({
      provider: {
        ...savedProvider,
        id: "deepseek",
        name: "DeepSeek 官方",
        baseUrl: "https://api.deepseek.com",
      },
      decision: { providerId: "deepseek", mode: "direct", cacheKey: "direct" },
    })).resolves.toMatchObject({ ok: true, models: ["deepseek-model"] });

    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "deepseek" }),
      "https://api.deepseek.com/models",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer saved-key" },
      }),
    );
  });
});
