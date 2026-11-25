import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const settings = new Map<string, string>();
  const state = {
    settings,
    inTransaction: false,
    beforeTransaction: null as (() => void) | null,
    transactionError: null as Error | null,
    reads: [] as Array<{ key: string; inTransaction: boolean }>,
    requireAdminRequest: vi.fn(),
    findUnique: vi.fn(async ({ where }: any) => {
      state.reads.push({ key: where.key, inTransaction: state.inTransaction });
      const value = settings.get(where.key);
      return value === undefined ? null : { value };
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      settings.set(where.key, update?.value ?? create.value);
      return { key: where.key, value: settings.get(where.key) };
    }),
    deleteMany: vi.fn(async ({ where }: any) => ({ count: settings.delete(where.key) ? 1 : 0 })),
    transaction: vi.fn(),
  };
  return state;
});

vi.mock("@/lib/admin-auth", () => ({ requireAdminRequest: mocks.requireAdminRequest }));
vi.mock("@/lib/prisma", () => ({
  default: {
    appSetting: { findUnique: mocks.findUnique, upsert: mocks.upsert },
    $transaction: mocks.transaction,
  },
}));

import { GET, POST } from "@/app/api/admin/providers/route";

const baseProvider = {
  id: "custom-bound-provider",
  name: "Bound Provider",
  protocol: "openai",
  baseUrl: "https://llm.example.test/v1",
  egressMode: "direct",
  allowLegacyFallback: false,
  apiKey: "saved-key",
  imageModels: [],
  videoModels: [],
  chatModels: ["bound-model"],
  modelProtocols: {},
  enabled: true,
  sortOrder: 10,
};

const transactionClient = {
  appSetting: { findUnique: mocks.findUnique, upsert: mocks.upsert, deleteMany: mocks.deleteMany },
};

function request(
  providers: unknown[],
  expectedRevision = mocks.settings.get("providers.revision") || "legacy-v1",
) {
  return new Request("http://localhost/api/admin/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedRevision,
      providers,
      proxyAction: { action: "keep" },
    }),
  }) as any;
}

function singleProviderRequest(
  provider: unknown,
  expectedRevision = mocks.settings.get("providers.revision") || "legacy-v1",
) {
  return new Request("http://localhost/api/admin/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedRevision,
      provider,
      proxyAction: { action: "keep" },
    }),
  }) as any;
}

describe("provider saves protect configured LLM route bindings", () => {
  beforeEach(() => {
    mocks.settings.clear();
    mocks.requireAdminRequest.mockReset();
    mocks.requireAdminRequest.mockReturnValue({ ok: true, username: "admin" });
    mocks.findUnique.mockClear();
    mocks.upsert.mockClear();
    mocks.deleteMany.mockClear();
    mocks.reads.length = 0;
    mocks.beforeTransaction = null;
    mocks.transactionError = null;
    mocks.transaction.mockReset();
    mocks.transaction.mockImplementation(async (callback: any) => {
      if (mocks.transactionError) throw mocks.transactionError;
      mocks.beforeTransaction?.();
      mocks.inTransaction = true;
      try {
        return await callback(transactionClient);
      } finally {
        mocks.inTransaction = false;
      }
    });
    delete process.env.BOUND_PROVIDER_KEY;
  });

  function bind(scenarioId = "canvas.chat", providerId = "custom-bound-provider", modelId = "bound-model") {
    mocks.settings.set(
      scenarioId === "canvas.chat" ? "llm_route.canvas.chat" : "llm_route.image.role_prompt",
      JSON.stringify({ version: 1, providerId, modelId }),
    );
  }

  async function expectConflict(providers: unknown[], scenarioId = "canvas.chat") {
    const before = mocks.settings.get("providers.registry");
    const response = await POST(request(providers));
    const payload = await response.json();
    expect(response.status).toBe(409);
    expect(payload.error).toContain(scenarioId);
    expect(payload.error).toContain("先切换路由");
    expect(mocks.settings.get("providers.registry")).toBe(before);
  }

  it("blocks a save when a configured binding is already orphaned", async () => {
    bind("canvas.chat", "ghost-provider", "ghost-model");
    await expectConflict([baseProvider]);
  });

  it("blocks deleting a provider used by a configured binding", async () => {
    mocks.settings.set("providers.registry", JSON.stringify([baseProvider]));
    bind();
    const response = await POST(request([]));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("只能停用");
    expect(JSON.parse(mocks.settings.get("providers.registry") || "[]")).toEqual([baseProvider]);
  });

  it("blocks disabling a provider used by a configured binding", async () => {
    mocks.settings.set("providers.registry", JSON.stringify([baseProvider]));
    bind();
    await expectConflict([{ ...baseProvider, enabled: false, apiKey: undefined }]);
  });

  it("blocks clearing the shared platform key while an LLM route uses the provider", async () => {
    mocks.settings.set("providers.registry", JSON.stringify([baseProvider]));
    bind();
    const before = mocks.settings.get("providers.registry");

    const response = await POST(request([
      { ...baseProvider, apiKey: undefined, clearApiKey: true },
    ]));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.status).toBe("missing-key");
    expect(mocks.settings.get("providers.registry")).toBe(before);
    expect(mocks.settings.get("llm_route.canvas.chat")).toContain(baseProvider.id);
  });

  it("blocks removing the configured model from chatModels", async () => {
    mocks.settings.set("providers.registry", JSON.stringify([baseProvider]));
    bind("image.role_prompt");
    await expectConflict([{ ...baseProvider, apiKey: undefined, chatModels: [] }], "image.role_prompt");
  });

  it("allows saving providers when no configured route exists", async () => {
    const response = await POST(request([baseProvider]));

    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(JSON.parse(mocks.settings.get("providers.registry") || "[]")).toEqual([
      expect.objectContaining({ id: "custom-bound-provider", apiKey: "saved-key" }),
    ]);
    expect(mocks.settings.get("providers.revision")).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("saves one provider without validating or rewriting another provider with an empty Base URL", async () => {
    const kieProvider = {
      ...baseProvider,
      id: "kie",
      name: "KIE.AI",
      baseUrl: "https://api.kie.ai",
      allowLegacyFallback: true,
      apiKey: undefined,
      chatModels: [],
      sortOrder: 1,
    };
    const unfinishedCustomProvider = {
      ...baseProvider,
      id: "custom-existing",
      name: "Custom Provider",
      protocol: "openai",
      baseUrl: "",
      allowLegacyFallback: true,
      apiKey: "custom-existing-key",
      chatModels: [],
      sortOrder: 6,
    };
    mocks.settings.set("providers.registry", JSON.stringify([kieProvider, unfinishedCustomProvider]));

    const response = await POST(singleProviderRequest({ ...kieProvider, apiKey: "kie-new-key" }));
    const saved = JSON.parse(mocks.settings.get("providers.registry") || "[]");

    expect(response.status).toBe(200);
    expect(saved.find((provider: any) => provider.id === "kie")?.apiKey).toBe("kie-new-key");
    expect(saved.find((provider: any) => provider.id === "custom-existing")).toEqual(unfinishedCustomProvider);
  });

  it("ignores an unrelated orphaned LLM binding when saving one provider", async () => {
    mocks.settings.set("providers.registry", JSON.stringify([baseProvider]));
    bind("canvas.chat", "ghost-provider", "ghost-model");

    const response = await POST(singleProviderRequest({ ...baseProvider, name: "Updated Provider" }));

    expect(response.status).toBe(200);
    expect(JSON.parse(mocks.settings.get("providers.registry") || "[]")[0].name).toBe("Updated Provider");
  });

  it("saves a proxy without validating an unrelated unfinished provider form", async () => {
    mocks.settings.set("providers.registry", JSON.stringify([{ ...baseProvider, baseUrl: "" }]));
    const response = await POST(new Request("http://localhost/api/admin/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: "legacy-v1",
        proxyAction: { action: "set", url: "http://proxy.example.test:7890" },
      }),
    }) as any);

    expect(response.status).toBe(200);
    expect(JSON.parse(mocks.settings.get("providers.proxy") || "{}")).toMatchObject({
      state: "configured",
      url: "http://proxy.example.test:7890",
    });
    expect(JSON.parse(mocks.settings.get("providers.registry") || "[]")[0].baseUrl).toBe("");
  });

  it("rejects an old page without a revision and prevents sequential stale overwrites", async () => {
    const missingRevision = new Request("http://localhost/api/admin/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providers: [baseProvider], proxyAction: { action: "keep" } }),
    }) as any;
    const missingResponse = await POST(missingRevision);
    expect(missingResponse.status).toBe(409);
    expect((await missingResponse.json()).status).toBe("stale-revision");

    const staleRevision = "legacy-v1";
    const first = await POST(request([{ ...baseProvider, name: "first" }], staleRevision));
    expect(first.status).toBe(200);
    const second = await POST(request([{ ...baseProvider, name: "second" }], staleRevision));
    expect(second.status).toBe(409);
    expect((await second.json()).status).toBe("stale-revision");
    expect(JSON.parse(mocks.settings.get("providers.registry") || "[]")[0].name).toBe("first");
  });

  it("returns providers, proxy and revision from one no-store transaction snapshot", async () => {
    const response = await GET(new Request("http://localhost/api/admin/providers") as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toMatchObject({
      success: true,
      revision: "legacy-v1",
      proxy: { overrideState: "inherit" },
    });
    expect(mocks.reads).toEqual(expect.arrayContaining([
      { key: "providers.registry", inTransaction: true },
      { key: "providers.proxy", inTransaction: true },
      { key: "providers.revision", inTransaction: true },
    ]));
  });

  it("deep-sanitizes the admin snapshot without proxy credentials, full URLs, keys or auth headers", async () => {
    const apiKey = "sk-provider-super-secret";
    const proxyUrl = "http://proxy-user:proxy-password@proxy.example.test:8080";
    mocks.settings.set("providers.registry", JSON.stringify([{ ...baseProvider, apiKey }]));
    mocks.settings.set("providers.proxy", JSON.stringify({ version: 1, state: "configured", url: proxyUrl }));

    const response = await GET(new Request("http://localhost/api/admin/providers") as any);
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload.proxy).toMatchObject({
      source: "database",
      preview: "http://proxy.example.test:8080",
      hasCredentials: true,
    });
    for (const secret of [apiKey, proxyUrl, "proxy-user", "proxy-password", "Proxy-Authorization"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("re-reads saved providers and bindings inside the transaction", async () => {
    mocks.settings.set("providers.registry", JSON.stringify([baseProvider]));
    mocks.beforeTransaction = () => {
      mocks.settings.set("providers.registry", JSON.stringify([{ ...baseProvider, apiKey: "transaction-key" }]));
    };

    const response = await POST(request([{ ...baseProvider, apiKey: undefined }]));

    expect(response.status).toBe(200);
    expect(JSON.parse(mocks.settings.get("providers.registry") || "[]")[0].apiKey).toBe("transaction-key");
    expect(mocks.reads).toEqual(expect.arrayContaining([
      { key: "providers.registry", inTransaction: true },
      { key: "llm_route.canvas.chat", inTransaction: true },
      { key: "llm_route.image.role_prompt", inTransaction: true },
    ]));
  });

  it("maps a provider save serialization conflict to a retryable 409", async () => {
    mocks.transactionError = Object.assign(new Error("write conflict"), { code: "P2034" });

    const response = await POST(request([baseProvider]));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toContain("重试");
  });

  it("returns sanitized no-store responses for unexpected snapshot and save failures", async () => {
    mocks.transactionError = new Error("database-secret-must-not-leak");

    const getResponse = await GET(new Request("http://localhost/api/admin/providers") as any);
    const getPayload = await getResponse.json();
    expect(getResponse.status).toBe(500);
    expect(getResponse.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(getPayload)).not.toContain("database-secret-must-not-leak");

    const postResponse = await POST(request([baseProvider]));
    const postPayload = await postResponse.json();
    expect(postResponse.status).toBe(500);
    expect(postResponse.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(postPayload)).not.toContain("database-secret-must-not-leak");
  });

  it("fixes custom providers to the supported OpenAI Chat endpoint", async () => {
    const response = await POST(request([{
      ...baseProvider,
      llmProtocol: "openai-chat",
      llmEndpointTemplate: "deployments/{model}/chat/completions",
    }]));

    expect(response.status).toBe(200);
    expect(JSON.parse(mocks.settings.get("providers.registry") || "[]")[0]).toMatchObject({
      llmProtocol: "openai-chat",
      llmEndpointTemplate: "chat/completions",
    });
  });
});
