// Protocol tests isolate billing persistence.
vi.mock("@/lib/billing/llm", () => ({ beginLlmCost: vi.fn(async () => ({ id: 1, snapshot: {} })), finishLlmCost: vi.fn(async () => undefined) }));
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setting: vi.fn(async () => null as null | { value: string }),
  getUserId: vi.fn(),
  relay: vi.fn(),
  requireCanvasEntryEnabled: vi.fn(),
  getRegisteredProviders: vi.fn(),
  getVisibleToolboxModels: vi.fn(),
  getLlmRouteBinding: vi.fn(),
  readProxySettingRaw: vi.fn(),
  resolveProviderProxyFromRaw: vi.fn(),
  transaction: vi.fn(),
  fetchWithProviderEgress: vi.fn(),
  loggerLog: vi.fn(),
}));

vi.mock("@/lib/prompt-reverse-media-url", () => ({ resolvePromptReverseMediaUrl: mocks.relay }));
vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/providers/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/registry")>();
  return { ...actual, getRegisteredProviders: mocks.getRegisteredProviders };
});
vi.mock("@/lib/image-edit-models", () => ({
  getVisibleToolboxModels: mocks.getVisibleToolboxModels,
  getVisibleImageEditModels: mocks.getVisibleToolboxModels,
}));
vi.mock("@/lib/llm-routing/bindings", () => ({
  getLlmRouteBinding: mocks.getLlmRouteBinding,
}));
vi.mock("@/lib/providers/proxy-config", () => ({
  readProxySettingRaw: mocks.readProxySettingRaw,
  resolveProviderProxyFromRaw: mocks.resolveProviderProxyFromRaw,
}));
vi.mock("@/lib/prisma", () => ({
  default: { $transaction: mocks.transaction, appSetting: { findUnique: mocks.setting } },
}));
vi.mock("@/lib/providers/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/transport")>();
  return { ...actual, fetchWithProviderEgress: mocks.fetchWithProviderEgress };
});
vi.mock("@/lib/logger", () => ({ Logger: { log: mocks.loggerLog } }));

const providers = [
  {
    id: "openai-a",
    name: "OpenAI A",
    protocol: "openai" as const,
    baseUrl: "https://a.example.com/v1",
    apiKey: "secret-a",
    egressMode: "direct" as const,
    llmProtocol: "openai-chat" as const,
    imageModels: [],
    videoModels: [],
    chatModels: ["model-a"],
    modelProtocols: {},
    enabled: true,
    sortOrder: 1,
  },
  {
    id: "openai-b",
    name: "OpenAI B",
    protocol: "openai" as const,
    baseUrl: "https://b.example.com/v1",
    apiKey: "secret-b",
    egressMode: "direct" as const,
    llmProtocol: "openai-chat" as const,
    imageModels: [],
    videoModels: [],
    chatModels: ["model-b"],
    modelProtocols: {},
    enabled: true,
    sortOrder: 2,
  },
  {
    id: "disabled",
    name: "Disabled",
    protocol: "openai" as const,
    baseUrl: "https://disabled.example.com/v1",
    apiKey: "secret-disabled",
    egressMode: "direct" as const,
    llmProtocol: "openai-chat" as const,
    imageModels: [],
    videoModels: [],
    chatModels: ["disabled-model"],
    modelProtocols: {},
    enabled: false,
    sortOrder: 3,
  },
];

function request(body: unknown) {
  return new Request("http://localhost/api/canvas/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("canvas LLM business routes", () => {
  it.each([false, true])("rejects a hidden default or explicit selection before dispatch (override: %s)", async explicit => {
    mocks.setting.mockResolvedValue({ value: JSON.stringify({ ['llm:["openai-a","model-a"]']: false }) });
    const { POST } = await import("@/app/api/canvas/llm/route");
    const response = await POST(request({ prompt: "hello", ...(explicit ? { override: { providerId: "openai-a", modelId: "model-a" } } : {}) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "MODEL_HIDDEN" });
    expect(mocks.fetchWithProviderEgress).not.toHaveBeenCalled();
  });
  it.each(["high", "none", "max"] as const)("carries DeepSeek %s from the HTTP boundary to upstream", async thinkingLevel => {
    mocks.getRegisteredProviders.mockResolvedValue([{ ...providers[0], id: "deepseek", name: "DeepSeek", chatModels: ["deepseek-flash"] }]);
    mocks.getLlmRouteBinding.mockResolvedValue({ providerId: "deepseek", modelId: "deepseek-flash" });
    const { POST } = await import("@/app/api/canvas/llm/route");
    expect((await POST(request({ prompt: "hello", thinkingLevel }))).status).toBe(200);
    const body = JSON.parse(mocks.fetchWithProviderEgress.mock.calls[0][2].body);
    expect(body.thinking).toEqual({ type: thinkingLevel === "none" ? "disabled" : "enabled" });
    if (thinkingLevel !== "none") expect(body.reasoning_effort).toBe(thinkingLevel);
    else expect(body).not.toHaveProperty("reasoning_effort");
  });
  it.each(["high", "invalid", 123])("rejects unsupported or malformed thinking before dispatch: %s", async thinkingLevel => {
    const { POST } = await import("@/app/api/canvas/llm/route");
    expect((await POST(request({ prompt: "hello", thinkingLevel }))).status).toBe(400);
    expect(mocks.fetchWithProviderEgress).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    mocks.setting.mockResolvedValue(null);
    mocks.relay.mockImplementation(async (url: string) => url.replace("http://localhost/uploads/", "https://relay.example.com/"));
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: any) => callback({}));
    mocks.requireCanvasEntryEnabled.mockResolvedValue(null);
    mocks.getUserId.mockResolvedValue("7");
    mocks.getRegisteredProviders.mockResolvedValue(providers);
    mocks.getVisibleToolboxModels.mockResolvedValue([]);
    mocks.getLlmRouteBinding.mockResolvedValue({ providerId: "openai-a", modelId: "model-a" });
    mocks.readProxySettingRaw.mockResolvedValue(null);
    mocks.resolveProviderProxyFromRaw.mockReturnValue({ status: "missing" });
    mocks.fetchWithProviderEgress.mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "hello" } }],
    }), { status: 200 }));
  });

  it("uses the configured canvas default and returns only a public route snapshot", async () => {
    const { POST } = await import("@/app/api/canvas/llm/route");

    const res = await POST(request({ prompt: "hello", endpoint: "https://evil", key: "client-key" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(data).toMatchObject({
      success: true,
      text: "hello",
      route: {
        providerId: "openai-a",
        providerName: "OpenAI A",
        modelId: "model-a",
        protocol: "openai-chat",
        source: "configured",
        status: "ready",
      },
    });
    expect(data.durationMs).toEqual(expect.any(Number));
    expect(JSON.stringify(data)).not.toContain("secret-a");
    expect(JSON.stringify(data)).not.toContain("a.example.com");
    expect(mocks.fetchWithProviderEgress.mock.calls[0][0]).toMatchObject({
      providerId: "openai-a",
      mode: "direct",
    });
    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledTimes(1);
    const upstream = JSON.parse(mocks.fetchWithProviderEgress.mock.calls[0][2].body);
    expect(upstream.model).toBe("model-a");
  });

  it("accepts a text-reference-only prompt without losing its content", async () => {
    const { POST } = await import("@/app/api/canvas/llm/route");
    const response = await POST(request({ prompt: "", textList: ["人物保留", "背景保留"] }));
    expect(response.status).toBe(200);
    const upstream = JSON.parse(mocks.fetchWithProviderEgress.mock.calls[0][2].body);
    expect(upstream.messages).toEqual([{ role: "user", content: "人物保留背景保留" }]);
  });

  it("uses a valid provider/model override", async () => {
    const { POST } = await import("@/app/api/canvas/llm/route");

    const res = await POST(request({
      prompt: "hello",
      override: { providerId: "openai-b", modelId: "model-b" },
    }));
    const data = await res.json();

    expect(data.route).toMatchObject({ providerId: "openai-b", modelId: "model-b", source: "node-override" });
    expect(mocks.fetchWithProviderEgress.mock.calls[0][0]).toMatchObject({
      providerId: "openai-b",
      mode: "direct",
    });
    expect(JSON.parse(mocks.fetchWithProviderEgress.mock.calls[0][2].body).model).toBe("model-b");
  });

  it.each([false, true])("lists and dispatches MiniMax M3.1 Flash through the canvas route (image: %s)", async (withImage) => {
    const modelId = "MiniMax-M3.1-Flash";
    mocks.getRegisteredProviders.mockResolvedValue([{ ...providers[0], id: "minimax", name: "MiniMax 官方",
      baseUrl: "https://api.minimax.cn", chatModels: ["MiniMax-M3", modelId] }]);
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: "thinking", thinking: "internal" }, { type: "text", text: "ok" }], stop_reason: "end_turn",
      usage: { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 8 },
    })));
    const { GET } = await import("@/app/api/canvas/models/route");
    const listed = await (await GET(new Request("http://localhost/api/canvas/models") as any)).json();
    expect(listed.chat).toContainEqual(expect.objectContaining({ modelId, providerId: "minimax", protocol: "anthropic-messages", status: "ready" }));
    const { POST } = await import("@/app/api/canvas/llm/route");
    const response = await POST(request({ prompt: "hello", override: { providerId: "minimax", modelId },
      ...(withImage ? { imageUrls: ["https://cdn.example.com/reference.png"] } : {}) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, text: "ok", route: { modelId, protocol: "anthropic-messages" } });
    expect(mocks.fetchWithProviderEgress.mock.calls[0][1]).toBe("https://api.minimax.cn/anthropic/v1/messages");
    const upstream = JSON.parse(mocks.fetchWithProviderEgress.mock.calls[0][2].body);
    expect(upstream.model).toBe(modelId);
    expect(upstream).not.toHaveProperty("response_format");
    if (withImage) expect(upstream.messages[0].content).toContainEqual({ type: "image", source: { type: "url", url: "https://cdn.example.com/reference.png" } });
  });

  it("forwards ordered canvas visual references as OpenAI-compatible image content", async () => {
    const { POST } = await import("@/app/api/canvas/llm/route");

    const res = await POST(request({
      prompt: "比较这些参考素材",
      imageUrls: [
        " https://cdn.example.com/reference-a.png ",
        "/uploads/canvas/reference-b.png",
        "https://cdn.example.com/reference-a.png",
      ],
    }));

    expect(res.status).toBe(200);
    const upstream = JSON.parse(mocks.fetchWithProviderEgress.mock.calls[0][2].body);
    expect(upstream.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "比较这些参考素材" },
          { type: "image_url", image_url: { url: "https://cdn.example.com/reference-a.png" } },
          { type: "image_url", image_url: { url: "https://relay.example.com/canvas/reference-b.png" } },
        ],
      },
    ]);
  });

  it.each([
    ["a non-array payload", "https://cdn.example.com/reference.png"],
    ["a blob URL", ["blob:http://localhost/reference"]],
    ["a file URL", ["file:///tmp/reference.png"]],
  ])("rejects %s in visual references before calling the provider", async (_label, imageUrls) => {
    const { POST } = await import("@/app/api/canvas/llm/route");

    const res = await POST(request({ prompt: "分析参考图", imageUrls }));

    expect(res.status).toBe(400);
    expect(mocks.fetchWithProviderEgress).not.toHaveBeenCalled();
  });

  it("submits typed image references through the same relay", async () => {
    const { POST } = await import("@/app/api/canvas/llm/route");
    const res = await POST(request({ prompt: "识别", mediaReferences: [{ kind: "image", url: "/uploads/input.png" }] }));
    expect(res.status).toBe(200);
    expect(JSON.parse(mocks.fetchWithProviderEgress.mock.calls[0][2].body).messages[0].content[1])
      .toEqual({ type: "image_url", image_url: { url: "https://relay.example.com/input.png" } });
  });

  it("reports a model's unsupported modality before sending an upstream request", async () => {
    mocks.getRegisteredProviders.mockResolvedValue([{ ...providers[0], id: "deepseek", chatModels: ["deepseek-v4-flash-vision-exp"] }]);
    mocks.getLlmRouteBinding.mockResolvedValue({ providerId: "deepseek", modelId: "deepseek-v4-flash-vision-exp" });
    const { POST } = await import("@/app/api/canvas/llm/route");
    const res = await POST(request({ prompt: "识别", mediaReferences: [{ kind: "video", url: "/uploads/input.mp4" }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("不支持视频输入");
    expect(mocks.fetchWithProviderEgress).not.toHaveBeenCalled();
  });

  it("rejects explicit null media rather than silently dropping it", async () => {
    const { POST } = await import("@/app/api/canvas/llm/route");
    const res = await POST(request({ prompt: "识别", mediaReferences: null }));
    expect(res.status).toBe(400);
    expect(mocks.fetchWithProviderEgress).not.toHaveBeenCalled();
  });

  it("reports failed image preparation before an upstream request", async () => {
    mocks.relay.mockRejectedValueOnce(new Error("storage-private-detail"));
    const { POST } = await import("@/app/api/canvas/llm/route");
    const res = await POST(request({ prompt: "识别", mediaReferences: [{ kind: "image", url: "/uploads/input.png" }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("参考图片无法读取或转存");
    expect(mocks.fetchWithProviderEgress).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["a string", "openai-b/model-b"],
    ["an array", ["openai-b", "model-b"]],
    ["a missing modelId", { providerId: "openai-b" }],
    ["a missing providerId", { modelId: "model-b" }],
    ["an empty providerId", { providerId: "   ", modelId: "model-b" }],
    ["an empty modelId", { providerId: "openai-b", modelId: "   " }],
  ])("rejects a present override containing %s before route resolution", async (_label, override) => {
    const { POST } = await import("@/app/api/canvas/llm/route");

    const res = await POST(request({ prompt: "hello", override }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data).toEqual({ success: false, error: "模型覆盖配置无效" });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.getRegisteredProviders).not.toHaveBeenCalled();
    expect(mocks.fetchWithProviderEgress).not.toHaveBeenCalled();
    expect(mocks.loggerLog).not.toHaveBeenCalled();
  });

  it("rejects an invalid override without calling a fallback provider", async () => {
    const { POST } = await import("@/app/api/canvas/llm/route");

    const res = await POST(request({
      prompt: "hello",
      override: { providerId: "missing", modelId: "missing" },
    }));
    expect(res.status).toBe(503);
    expect(mocks.fetchWithProviderEgress).not.toHaveBeenCalled();
  });

  it("rejects missing prompt without calling the gateway", async () => {
    const { POST } = await import("@/app/api/canvas/llm/route");

    const res = await POST(request({ prompt: "   " }));

    expect(res.status).toBe(400);
    expect(mocks.fetchWithProviderEgress).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getUserId.mockResolvedValue(null);
    const { POST } = await import("@/app/api/canvas/llm/route");

    const res = await POST(request({ prompt: "hello" }));

    expect(res.status).toBe(401);
    expect(mocks.fetchWithProviderEgress).not.toHaveBeenCalled();
  });

  it("never exposes an upstream endpoint URL or key in public errors", async () => {
    mocks.fetchWithProviderEgress.mockRejectedValue(new Error(
      "fetch https://a.example.com/v1/chat/completions failed with secret-a",
    ));
    const { POST } = await import("@/app/api/canvas/llm/route");

    const res = await POST(request({ prompt: "hello" }));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe("LLM 网络连接失败，请稍后重试");
    expect(JSON.stringify(data)).not.toContain("a.example.com");
    expect(JSON.stringify(data)).not.toContain("secret-a");
  });

  it("lists ready registered chat candidates and a safe canvas default", async () => {
    const { GET } = await import("@/app/api/canvas/models/route");

    const res = await GET(new Request("http://localhost/api/canvas/models") as any);
    const data = await res.json();

    expect(data.chat).toEqual([
      expect.objectContaining({
        id: "model-a",
        modelId: "model-a",
        providerId: "openai-a",
        providerName: "OpenAI A",
        protocol: "openai-chat",
        status: "ready",
      }),
      expect.objectContaining({
        id: "model-b",
        modelId: "model-b",
        providerId: "openai-b",
        providerName: "OpenAI B",
        protocol: "openai-chat",
        status: "ready",
      }),
    ]);
    expect(data.canvasDefault).toMatchObject({
      providerId: "openai-a",
      modelId: "model-a",
      source: "configured",
      status: "ready",
    });
    expect(JSON.stringify(data)).not.toContain("secret-");
    expect(JSON.stringify(data)).not.toContain("example.com");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it.each(["missing", "invalid"] as const)(
    "does not list a proxy candidate when its proxy is %s",
    async (proxyStatus) => {
      mocks.getRegisteredProviders.mockResolvedValue([
        ...providers,
        {
          ...providers[0],
          id: "proxy-provider",
          name: "Proxy Provider",
          baseUrl: "https://proxy-provider.example.com/v1",
          chatModels: ["proxy-model"],
          egressMode: "proxy" as const,
        },
      ]);
      mocks.resolveProviderProxyFromRaw.mockReturnValue({ status: proxyStatus });
      const { GET } = await import("@/app/api/canvas/models/route");

      const res = await GET(new Request("http://localhost/api/canvas/models") as any);
      const data = await res.json();

      expect(data.chat).not.toContainEqual(expect.objectContaining({ providerId: "proxy-provider" }));
      expect(mocks.resolveProviderProxyFromRaw).toHaveBeenCalledWith("proxy-provider", null);
    },
  );
});
