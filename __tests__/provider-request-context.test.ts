import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transactionClient = { snapshot: "configuration-a" };
  return {
    transactionClient,
    transaction: vi.fn(async (callback: (client: typeof transactionClient) => unknown) => callback(transactionClient)),
    getRegisteredProviders: vi.fn(),
    readProxySettingRaw: vi.fn(),
    resolveProviderProxyFromRaw: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  default: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/providers/registry", () => ({
  getRegisteredProviders: mocks.getRegisteredProviders,
  toResolvedProvider: (provider: Record<string, unknown>) => ({
    ...provider,
    apiKey: String(provider.apiKey || ""),
    hasKey: Boolean(provider.apiKey),
  }),
}));
vi.mock("@/lib/providers/proxy-config", () => ({
  readProxySettingRaw: mocks.readProxySettingRaw,
  resolveProviderProxyFromRaw: mocks.resolveProviderProxyFromRaw,
}));

import { resolveProviderRequestContext } from "@/lib/providers/transport";

describe("atomic provider request context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRegisteredProviders.mockResolvedValue([{
      id: "apimart",
      name: "APIMart",
      protocol: "apimart",
      baseUrl: "https://configuration-a.example/v1",
      egressMode: "proxy",
      apiKey: "configuration-a-key",
      imageModels: [],
      videoModels: [],
      chatModels: [],
      modelProtocols: {},
      enabled: true,
      sortOrder: 0,
    }]);
    mocks.readProxySettingRaw.mockResolvedValue(
      JSON.stringify({ version: 1, state: "configured", url: "http://proxy-a.example:7890" }),
    );
    mocks.resolveProviderProxyFromRaw.mockReturnValue({
      status: "ready",
      source: "database",
      uri: "http://proxy-a.example:7890",
      preview: "http://proxy-a.example:7890",
      hasCredentials: false,
      fingerprint: "proxy-a-fingerprint",
    });
  });

  it("resolves provider identity, credentials and egress inside one serializable snapshot", async () => {
    const context = await resolveProviderRequestContext("apimart");

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.getRegisteredProviders).toHaveBeenCalledWith(mocks.transactionClient);
    expect(mocks.readProxySettingRaw).toHaveBeenCalledWith(mocks.transactionClient);
    expect(mocks.resolveProviderProxyFromRaw).toHaveBeenCalledWith(
      "apimart",
      expect.stringContaining("proxy-a.example"),
    );
    expect(context).toMatchObject({
      provider: {
        id: "apimart",
        baseUrl: "https://configuration-a.example/v1",
        apiKey: "configuration-a-key",
      },
      decision: {
        providerId: "apimart",
        mode: "proxy",
        cacheKey: "proxy-a-fingerprint",
      },
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.provider)).toBe(true);
    expect(Object.isFrozen(context.decision)).toBe(true);
  });
});
