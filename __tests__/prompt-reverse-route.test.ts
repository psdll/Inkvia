import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  loggerLog: vi.fn(),
  resolveAssetUrlForExternalApi: vi.fn(),
  isOssReady: vi.fn(),
  uploadLocalUploadPathToOss: vi.fn(),
  uploadBufferToOss: vi.fn(),
  preparePromptReverseRelayImage: vi.fn(),
  readFile: vi.fn(),
  resolveLlmRoute: vi.fn(),
  resolveLlmRouteFromProviders: vi.fn(),
  attachLlmEgressDecision: vi.fn((route: any) => ({
    ...route,
    egressDecision: { providerId: route.providerId, mode: "direct", cacheKey: "direct" },
  })),
  getRegisteredProviders: vi.fn(),
  readProxySettingRaw: vi.fn(),
  resolveProviderProxyFromRaw: vi.fn(),
  callLlmForScenario: vi.fn(),
  getPublicLlmError: vi.fn(),
  appSettingFindUnique: vi.fn(),
  transaction: vi.fn(async (callback: (client: Record<string, never>) => unknown) => callback({})),
  promptReverseTask: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/server-auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/logger", () => ({ Logger: { log: mocks.loggerLog } }));
vi.mock("@/lib/external-assets", () => ({ resolveAssetUrlForExternalApi: mocks.resolveAssetUrlForExternalApi }));
vi.mock("@/lib/oss", () => ({
  isOssReady: mocks.isOssReady,
  uploadLocalUploadPathToOss: mocks.uploadLocalUploadPathToOss,
  uploadBufferToOss: mocks.uploadBufferToOss,
}));
vi.mock("@/lib/prompt-reverse-media", () => ({
  preparePromptReverseRelayImage: mocks.preparePromptReverseRelayImage,
}));
vi.mock("node:fs/promises", () => ({ default: { readFile: mocks.readFile } }));
vi.mock("@/lib/llm-routing/resolver", () => ({
  resolveLlmRoute: mocks.resolveLlmRoute,
  resolveLlmRouteFromProviders: mocks.resolveLlmRouteFromProviders,
  attachLlmEgressDecision: mocks.attachLlmEgressDecision,
}));
vi.mock("@/lib/providers/registry", () => ({ getRegisteredProviders: mocks.getRegisteredProviders }));
vi.mock("@/lib/providers/proxy-config", () => ({
  readProxySettingRaw: mocks.readProxySettingRaw,
  resolveProviderProxyFromRaw: mocks.resolveProviderProxyFromRaw,
}));
vi.mock("@/lib/llm-routing/gateway", () => ({
  callLlmForScenario: mocks.callLlmForScenario,
  getPublicLlmError: mocks.getPublicLlmError,
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    appSetting: { findUnique: mocks.appSettingFindUnique },
    promptReverseTask: mocks.promptReverseTask,
    $transaction: mocks.transaction,
  },
}));

function makeRequest(body: unknown) {
  const req = new Request("http://localhost/api/prompt-reverse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  Object.defineProperty(req, "nextUrl", { value: new URL("http://localhost/api/prompt-reverse") });
  return req as any;
}

const routeA = {
  scenarioId: "image.role_prompt" as const,
  providerId: "configured-provider",
  providerName: "Configured Provider",
  modelId: "configured-model",
  protocol: "openai-chat" as const,
  source: "configured" as const,
  status: "ready" as const,
  url: "https://configured.example.com/v1/chat/completions",
  apiKey: "secret-configured",
  timeoutMs: 60_000,
};

const routeB = {
  ...routeA,
  providerId: "new-provider",
  providerName: "New Provider",
  modelId: "new-model",
  url: "https://new.example.com/v1/chat/completions",
  apiKey: "secret-new",
};

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    authUserId: 7,
    userId: "7",
    status: "pending",
    surface: "toolbox_image",
    systemPrompt: "role",
    userPrompt: "make image",
    requestedModel: null,
    llmProviderId: "configured-provider",
    model: "configured-model",
    mediaUrls: ["/uploads/a.png"],
    resolvedMediaUrls: [],
    generatedPrompt: null,
    errorMsg: null,
    createdAt: new Date("2026-07-09T00:00:00.000Z"),
    updatedAt: new Date("2026-07-09T00:00:00.000Z"),
    ...overrides,
  };
}

describe("POST /api/prompt-reverse", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.appSettingFindUnique.mockResolvedValue(null);
    mocks.resolveLlmRoute.mockResolvedValue({ status: "ready", route: routeA });
    mocks.resolveLlmRouteFromProviders.mockImplementation(({ binding }: any) => {
      if (binding?.providerId === routeA.providerId && binding?.modelId === routeA.modelId) {
        return { status: "ready", route: routeA };
      }
      return { status: "missing-binding" };
    });
    mocks.getRegisteredProviders.mockResolvedValue([]);
    mocks.readProxySettingRaw.mockResolvedValue(null);
    mocks.resolveProviderProxyFromRaw.mockReturnValue({ status: "missing" });
    mocks.getPublicLlmError.mockReturnValue("LLM 网络连接失败，请稍后重试");
    mocks.callLlmForScenario.mockImplementation(async (route: any) => ({
      text: "generated prompt",
      route: {
        scenarioId: route.scenarioId,
        providerId: route.providerId,
        providerName: route.providerName,
        modelId: route.modelId,
        protocol: route.protocol,
        source: route.source,
        status: route.status,
      },
      durationMs: 12,
    }));
    mocks.isOssReady.mockReturnValue(true);
    mocks.uploadLocalUploadPathToOss.mockImplementation(async (localPath: string) => `https://oss.example.com${localPath}`);
    mocks.readFile.mockResolvedValue(Buffer.from("large-png"));
    mocks.preparePromptReverseRelayImage.mockResolvedValue(Buffer.from("small-jpeg"));
    mocks.uploadBufferToOss.mockResolvedValue("https://oss.example.com/prompt-reverse-inputs/relay.jpg");
    mocks.resolveAssetUrlForExternalApi.mockImplementation(async (url: string) => url);
    mocks.promptReverseTask.create.mockResolvedValue(task());
    mocks.promptReverseTask.findUnique.mockResolvedValue(task());
    mocks.promptReverseTask.update.mockImplementation(async ({ data }: any) => task({
      status: data?.status || "running",
      generatedPrompt: data?.generatedPrompt || null,
      errorMsg: data?.errorMsg || null,
      finishedAt: data?.finishedAt || null,
    }));
  });

  it("rejects an empty system prompt before resolving a route", async () => {
    const { POST } = await import("@/app/api/prompt-reverse/route");

    const res = await POST(makeRequest({ systemPrompt: "", userPrompt: "make image", mediaUrls: [] }));

    expect(res.status).toBe(400);
    expect(mocks.resolveLlmRoute).not.toHaveBeenCalled();
    expect(mocks.callLlmForScenario).not.toHaveBeenCalled();
  });

  it("uses the configured batch role-prompt provider/model and a compressed media relay", async () => {
    const { POST } = await import("@/app/api/prompt-reverse/route");

    const res = await POST(makeRequest({
      surface: "batch_workbench",
      systemPrompt: "role",
      userPrompt: "make image",
      mediaUrls: ["/uploads/a.png"],
      model: "client-model-must-be-ignored",
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(data).toMatchObject({
      success: true,
      generatedPrompt: "generated prompt",
      llmProviderId: "configured-provider",
      model: "configured-model",
    });
    expect(mocks.resolveLlmRoute).toHaveBeenCalledWith("image.role_prompt");
    expect(mocks.callLlmForScenario).toHaveBeenCalledTimes(1);
    const [calledRoute, messages] = mocks.callLlmForScenario.mock.calls[0];
    expect(calledRoute).toMatchObject({ providerId: "configured-provider", modelId: "configured-model" });
    expect(messages[0]).toEqual({
      role: "system",
      content: expect.stringContaining("全局分段输出规则"),
    });
    expect(messages[0].content).toContain("标题可选");
    expect(messages[1].content).toEqual(expect.arrayContaining([
      { type: "image_url", image_url: { url: "https://oss.example.com/prompt-reverse-inputs/relay.jpg" } },
    ]));
    expect(mocks.preparePromptReverseRelayImage).toHaveBeenCalledWith(Buffer.from("large-png"));
    expect(mocks.uploadBufferToOss).toHaveBeenCalledWith(
      Buffer.from("small-jpeg"),
      "prompt-reverse-inputs",
      expect.stringMatching(/\.jpg$/),
      "image/jpeg",
    );
    expect(mocks.uploadLocalUploadPathToOss).not.toHaveBeenCalled();
  });

  it("compresses toolbox role-positioning media before handing it to the LLM", async () => {
    const { POST } = await import("@/app/api/prompt-reverse/route");

    const res = await POST(makeRequest({
      surface: "toolbox_image",
      systemPrompt: "role",
      userPrompt: "make image",
      mediaUrls: ["/uploads/a.png"],
    }));

    expect(res.status).toBe(200);
    expect(mocks.readFile).toHaveBeenCalled();
    expect(mocks.preparePromptReverseRelayImage).toHaveBeenCalledWith(Buffer.from("large-png"));
    expect(mocks.uploadBufferToOss).toHaveBeenCalledWith(
      Buffer.from("small-jpeg"),
      "prompt-reverse-inputs",
      expect.stringMatching(/\.jpg$/),
      "image/jpeg",
    );
    expect(mocks.uploadLocalUploadPathToOss).not.toHaveBeenCalled();
    const [, messages] = mocks.callLlmForScenario.mock.calls[0];
    expect(messages[0]).toEqual({ role: "system", content: "role" });
    expect(messages[1].content).toEqual(expect.arrayContaining([
      { type: "image_url", image_url: { url: "https://oss.example.com/prompt-reverse-inputs/relay.jpg" } },
    ]));
  });

  it("rejects an unavailable configured route before calling the gateway", async () => {
    mocks.resolveLlmRoute.mockResolvedValue({ status: "missing-key" });
    const { POST } = await import("@/app/api/prompt-reverse/route");

    const res = await POST(makeRequest({ systemPrompt: "role", userPrompt: "make image", mediaUrls: [] }));

    expect(res.status).toBe(500);
    expect(mocks.callLlmForScenario).not.toHaveBeenCalled();
  });

  it("fails a synchronous request with no persistent binding before calling the gateway", async () => {
    mocks.resolveLlmRoute.mockResolvedValue({ status: "missing-binding", route: routeA });
    const { POST } = await import("@/app/api/prompt-reverse/route");

    const res = await POST(makeRequest({ systemPrompt: "role", userPrompt: "make image", mediaUrls: [] }));

    expect(res.status).toBe(500);
    expect(mocks.callLlmForScenario).not.toHaveBeenCalled();
  });

  it("rejects an empty gateway output", async () => {
    mocks.callLlmForScenario.mockResolvedValue({ text: "   ", route: {}, durationMs: 1 });
    const { POST } = await import("@/app/api/prompt-reverse/route");

    const res = await POST(makeRequest({ systemPrompt: "role", userPrompt: "make image", mediaUrls: [] }));

    expect(res.status).toBe(502);
  });

  it("does not expose gateway endpoint URLs or keys in synchronous errors or logs", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 7, username: "alice", createdAt: new Date() });
    mocks.callLlmForScenario.mockRejectedValue(new Error(
      "fetch https://configured.example.com failed with secret-configured",
    ));
    const { POST } = await import("@/app/api/prompt-reverse/route");

    const res = await POST(makeRequest({ systemPrompt: "role", userPrompt: "make image", mediaUrls: [] }));
    const data = await res.json();

    expect(data.error).toBe("LLM 网络连接失败，请稍后重试");
    expect(JSON.stringify(data)).not.toContain("configured.example.com");
    expect(mocks.loggerLog).toHaveBeenCalledWith(expect.objectContaining({
      level: "error",
      message: "LLM 网络连接失败，请稍后重试",
    }));
  });

  it("returns a friendly error when material URLs cannot be resolved", async () => {
    mocks.isOssReady.mockReturnValue(false);
    mocks.resolveAssetUrlForExternalApi.mockRejectedValue(new Error("asset not public"));
    const { POST } = await import("@/app/api/prompt-reverse/route");

    const res = await POST(makeRequest({ systemPrompt: "role", userPrompt: "make image", mediaUrls: ["/uploads/a.png"] }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(String(data.error)).toContain("asset not public");
    expect(mocks.callLlmForScenario).not.toHaveBeenCalled();
  });

  it("creates an async task with a provider/model route snapshot", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 7, username: "alice", createdAt: new Date() });
    const { POST } = await import("@/app/api/prompt-reverse/route");

    const res = await POST(makeRequest({
      async: true,
      systemPrompt: "role",
      userPrompt: "make image",
      mediaUrls: ["/uploads/a.png"],
      model: "ignored-client-model",
      surface: "batch_workbench",
    }));
    const data = await res.json();

    expect(res.status).toBe(202);
    expect(data.task).toMatchObject({
      id: 42,
      llmProviderId: "configured-provider",
      model: "configured-model",
    });
    expect(mocks.promptReverseTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        llmProviderId: "configured-provider",
        model: "configured-model",
        requestedModel: null,
        surface: "batch_workbench",
      }),
    });
  });

  it("fails async task creation with no persistent binding before creating or calling", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 7, username: "alice", createdAt: new Date() });
    mocks.resolveLlmRoute.mockResolvedValue({ status: "missing-binding", route: routeA });
    const { POST } = await import("@/app/api/prompt-reverse/route");

    const res = await POST(makeRequest({
      async: true,
      systemPrompt: "role",
      userPrompt: "make image",
      mediaUrls: [],
    }));

    expect(res.status).toBe(500);
    expect(mocks.promptReverseTask.create).not.toHaveBeenCalled();
    expect(mocks.callLlmForScenario).not.toHaveBeenCalled();
  });

  it("runs a snapshotted async task on its original provider/model after the binding changes", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 7, username: "alice", createdAt: new Date() });
    mocks.resolveLlmRoute
      .mockResolvedValueOnce({ status: "ready", route: routeA })
      .mockResolvedValue({ status: "ready", route: routeB });
    const { POST } = await import("@/app/api/prompt-reverse/route");

    await POST(makeRequest({ async: true, systemPrompt: "role", userPrompt: "make image", mediaUrls: [] }));

    await vi.waitFor(() => expect(mocks.promptReverseTask.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: expect.objectContaining({ status: "success" }),
    }));
    expect(mocks.resolveLlmRoute).toHaveBeenCalledTimes(1);
    expect(mocks.resolveLlmRouteFromProviders).toHaveBeenCalledWith(expect.objectContaining({
      scenarioId: "image.role_prompt",
      binding: { providerId: "configured-provider", modelId: "configured-model" },
    }));
    expect(mocks.callLlmForScenario.mock.calls[0][0]).toMatchObject({
      providerId: "configured-provider",
      modelId: "configured-model",
    });
    expect(mocks.callLlmForScenario).toHaveBeenCalledTimes(1);
  });

  it("fails a resumed proxy task as missing-proxy before calling the gateway", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 7, username: "alice", createdAt: new Date() });
    mocks.getRegisteredProviders.mockResolvedValue([{
      id: "configured-provider",
      name: "Configured Provider",
      protocol: "openai",
      baseUrl: "https://configured.example.com/v1",
      apiKey: "secret-configured",
      chatModels: ["configured-model"],
      imageModels: [],
      videoModels: [],
      modelProtocols: {},
      enabled: true,
      egressMode: "proxy",
    }]);
    mocks.resolveProviderProxyFromRaw.mockReturnValue({ status: "missing" });
    mocks.resolveLlmRouteFromProviders.mockImplementation(({ proxyStatusByProviderId }: any) =>
      proxyStatusByProviderId?.["configured-provider"] === "missing"
        ? { status: "missing-proxy" }
        : { status: "ready", route: routeA },
    );
    const { POST } = await import("@/app/api/prompt-reverse/route");

    await POST(makeRequest({ async: true, systemPrompt: "role", userPrompt: "make image", mediaUrls: [] }));

    await vi.waitFor(() => expect(mocks.promptReverseTask.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: expect.objectContaining({ status: "failed" }),
    }));
    expect(mocks.resolveLlmRouteFromProviders).toHaveBeenCalledWith(expect.objectContaining({
      proxyStatusByProviderId: { "configured-provider": "missing" },
    }));
    expect(mocks.callLlmForScenario).not.toHaveBeenCalled();
  });

  it("fails a legacy task without a snapshotted route instead of selecting a fallback provider", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 7, username: "alice", createdAt: new Date() });
    mocks.getRegisteredProviders.mockResolvedValue([{
      id: "apimart",
      chatModels: ["legacy-model"],
    }]);
    mocks.promptReverseTask.findUnique.mockResolvedValue(task({
      llmProviderId: null,
      model: null,
      requestedModel: "legacy-model",
    }));
    const { POST } = await import("@/app/api/prompt-reverse/route");

    await POST(makeRequest({ async: true, systemPrompt: "role", userPrompt: "make image", mediaUrls: [] }));

    await vi.waitFor(() => expect(mocks.promptReverseTask.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: expect.objectContaining({ status: "failed" }),
    }));
    expect(mocks.resolveLlmRouteFromProviders).toHaveBeenCalledWith(expect.objectContaining({
      scenarioId: "image.role_prompt",
      binding: null,
    }));
    expect(mocks.callLlmForScenario).not.toHaveBeenCalled();
  });

  it("stores and logs only public gateway errors for async tasks", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 7, username: "alice", createdAt: new Date() });
    mocks.callLlmForScenario.mockRejectedValue(new Error(
      "fetch https://configured.example.com failed with secret-configured",
    ));
    const { POST } = await import("@/app/api/prompt-reverse/route");

    await POST(makeRequest({ async: true, systemPrompt: "role", userPrompt: "make image", mediaUrls: [] }));

    await vi.waitFor(() => expect(mocks.promptReverseTask.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: expect.objectContaining({
        status: "failed",
        errorMsg: "LLM 网络连接失败，请稍后重试",
      }),
    }));
    expect(mocks.loggerLog).toHaveBeenCalledWith(expect.objectContaining({
      level: "error",
      message: "LLM 网络连接失败，请稍后重试",
    }));
  });

  it("serializes provider/model fields in surface-scoped task history", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 7, username: "alice", createdAt: new Date() });
    mocks.promptReverseTask.findMany.mockResolvedValue([task({ status: "success", generatedPrompt: "generated prompt" })]);
    const { GET } = await import("@/app/api/prompt-reverse/route");

    const request = makeRequest({});
    Object.defineProperty(request, "url", {
      value: "http://localhost/api/prompt-reverse?surface=batch_workbench",
    });
    const res = await GET(request as any);
    const data = await res.json();

    expect(data.tasks[0]).toMatchObject({
      id: 42,
      llmProviderId: "configured-provider",
      model: "configured-model",
      surface: "toolbox_image",
    });
    expect(mocks.promptReverseTask.findMany).toHaveBeenCalledWith({
      where: {
        authUserId: 7,
        deletedAt: null,
        surface: "batch_workbench",
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("defaults old clients to the toolbox surface", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 7, username: "alice", createdAt: new Date() });
    mocks.promptReverseTask.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/prompt-reverse/route");

    await GET(makeRequest({}) as any);

    expect(mocks.promptReverseTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ surface: "toolbox_image" }),
      }),
    );
  });
});
