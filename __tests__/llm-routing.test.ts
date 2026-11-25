// Route/protocol tests isolate durable billing; billing integration has its own regression tests.
vi.mock("@/lib/billing/llm", () => ({ beginLlmCost: vi.fn(async () => ({ id: 1, snapshot: {} })), finishLlmCost: vi.fn(async () => undefined) }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig } from "@/lib/providers/types";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  transaction: vi.fn(),
  fetchWithProviderEgress: vi.fn(),
  loggerLog: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    appSetting: { findUnique: mocks.findUnique, upsert: mocks.upsert },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/providers/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/transport")>();
  return { ...actual, fetchWithProviderEgress: mocks.fetchWithProviderEgress };
});
vi.mock("@/lib/logger", () => ({ Logger: { log: mocks.loggerLog } }));

import { getLlmRouteBinding, saveLlmRouteBinding } from "@/lib/llm-routing/bindings";
import { resolveLlmEndpoint } from "@/lib/llm-routing/endpoint";
import { LlmGatewayError, callOpenAiChatCompletion, getPublicLlmError } from "@/lib/llm-routing/gateway";
import { resolveLlmRoute, resolveLlmRouteFromProviders } from "@/lib/llm-routing/resolver";
import { getLlmScenario, LLM_SCENARIOS } from "@/lib/llm-routing/scenarios";
import { getProvidersOverview } from "@/lib/providers/registry";
import { callLlmForScenario } from "@/lib/llm-routing/gateway";
import {
  getLlmProtocolAdapter,
  hasLlmProtocolAdapter,
} from "@/lib/llm-routing/adapters/registry";

const transactionClient = {
  appSetting: { findUnique: mocks.findUnique, upsert: mocks.upsert },
};

beforeEach(() => {
  mocks.transaction.mockReset();
  mocks.transaction.mockImplementation(async (callback: any) => callback(transactionClient));
});

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "openai-a",
    name: "OpenAI A",
    protocol: "openai",
    baseUrl: "https://llm.example.test/v1",
    egressMode: "direct",
    apiKey: "sk-secret",
    imageModels: [],
    videoModels: [],
    chatModels: ["shared-model"],
    modelProtocols: {},
    enabled: true,
    sortOrder: 0,
    ...overrides,
  };
}

describe("LLM routing scenarios and bindings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defines the fixed canvas, role-prompt, and Agent scenarios", () => {
    expect(LLM_SCENARIOS).toEqual({
      "canvas.chat": {
        id: "canvas.chat",
        label: "画布对话",
        settingKey: "llm_route.canvas.chat",
        allowOverride: true,
        visual: false,
        timeoutMs: 120_000,
        logAction: "llm_call_canvas_chat",
      },
      "image.role_prompt": {
        id: "image.role_prompt",
        label: "创作、批量技能",
        settingKey: "llm_route.image.role_prompt",
        allowOverride: false,
        visual: true,
        timeoutMs: 180_000,
        logAction: "llm_call_image_role_prompt",
      },
      "agent.chat": {
        id: "agent.chat",
        label: "Agent 对话",
        settingKey: "llm_route.agent.chat",
        allowOverride: false,
        visual: true,
        timeoutMs: 180_000,
        logAction: "llm_call_agent_chat",
      },
    });
    expect(getLlmScenario("agent.chat")).toMatchObject({
      settingKey: "llm_route.agent.chat",
      allowOverride: false,
      logAction: "llm_call_agent_chat",
    });
  });

  it("ignores retired Agent default bindings and rejects new ones", async () => {
    mocks.findUnique.mockResolvedValue({ value: JSON.stringify({ version: 1, providerId: "p", modelId: "m" }) });
    await expect(getLlmRouteBinding("agent.chat")).resolves.toBeNull();
    await expect(saveLlmRouteBinding("agent.chat", { providerId: "p", modelId: "m" })).rejects.toThrow("Agent 不支持平台默认模型绑定");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("reads and saves provider/model bindings under the scenario AppSetting key", async () => {
    mocks.findUnique.mockResolvedValue({ value: JSON.stringify({ providerId: "p", modelId: "m" }) });
    await expect(getLlmRouteBinding("canvas.chat")).resolves.toEqual({ providerId: "p", modelId: "m" });

    await saveLlmRouteBinding("canvas.chat", { providerId: "p2", modelId: "m2" });
    const value = JSON.stringify({ version: 1, providerId: "p2", modelId: "m2" });
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { key: "llm_route.canvas.chat" },
      create: { key: "llm_route.canvas.chat", value },
      update: { value },
    });

    await saveLlmRouteBinding("canvas.chat", {
      providerId: "p2",
      modelId: "m2",
      networkRevision: `sha256:${"a".repeat(64)}`,
    });
    const version2Value = JSON.stringify({
      version: 2,
      providerId: "p2",
      modelId: "m2",
      networkRevision: `sha256:${"a".repeat(64)}`,
    });
    expect(mocks.upsert).toHaveBeenLastCalledWith({
      where: { key: "llm_route.canvas.chat" },
      create: { key: "llm_route.canvas.chat", value: version2Value },
      update: { value: version2Value },
    });

    mocks.findUnique.mockResolvedValue({
      value: JSON.stringify({
        version: 2,
        providerId: "p2",
        modelId: "m2",
        networkRevision: `sha256:${"a".repeat(64)}`,
      }),
    });
    await expect(getLlmRouteBinding("canvas.chat")).resolves.toEqual({
      providerId: "p2",
      modelId: "m2",
      networkRevision: `sha256:${"a".repeat(64)}`,
    });
  });

  it("rejects binding payloads with an unknown version", async () => {
    mocks.findUnique.mockResolvedValue({
      value: JSON.stringify({ version: 3, providerId: "p", modelId: "m" }),
    });
    await expect(getLlmRouteBinding("canvas.chat")).resolves.toBeNull();
  });

  it("keeps disabled saved providers visible without exposing their saved key", async () => {
    mocks.findUnique.mockResolvedValue({
      value: JSON.stringify([
        provider({ id: "disabled-provider", enabled: false, apiKey: "saved-disabled-secret" }),
      ]),
    });

    const overview = await getProvidersOverview();
    const disabled = overview.providers.find((item) => item.id === "disabled-provider");
    expect(disabled).toMatchObject({
      id: "disabled-provider",
      enabled: false,
      hasKey: true,
      keySource: "saved",
    });
    expect(disabled).not.toHaveProperty("apiKey");
  });
});

describe("LLM endpoint templates", () => {
  it("uses compatible defaults and encodes model placeholders", () => {
    expect(resolveLlmEndpoint(provider(), "shared-model")).toEqual({
      ok: true,
      url: "https://llm.example.test/v1/chat/completions",
    });
    expect(resolveLlmEndpoint(provider({ id: "kie" }), "a/b c")).toEqual({
      ok: true,
      url: "https://llm.example.test/v1/a%2Fb%20c/v1/chat/completions",
    });
  });

  it.each([
    "https://evil.test/chat/completions",
    "../chat/completions",
    "%2e%2e/chat/completions",
    "{provider}/chat/completions",
    "/chat/completions",
  ])("rejects unsafe endpoint template %s", (llmEndpointTemplate) => {
    expect(resolveLlmEndpoint(provider({ llmProtocol: "openai-chat", llmEndpointTemplate }), "m")).toMatchObject({
      ok: false,
      reason: "invalid-endpoint",
    });
  });

  it("rejects a custom endpoint on a non-legacy protocol unless openai-chat is explicit", () => {
    const customGemini = provider({
      protocol: "gemini",
      llmProtocol: undefined,
      llmEndpointTemplate: "chat/completions",
    });

    expect(resolveLlmEndpoint(customGemini, "m")).toEqual({
      ok: false,
      reason: "unsupported-protocol",
    });
    expect(resolveLlmEndpoint({ ...customGemini, llmProtocol: "openai-chat" }, "m")).toMatchObject({
      ok: true,
    });
  });
});

describe("LLM route resolution", () => {
  it("resolves an executable route and egress decision in one serializable transaction", async () => {
    mocks.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.key === "providers.registry") return { value: JSON.stringify([provider()]) };
      if (where.key === "llm_route.canvas.chat") {
        return { value: JSON.stringify({ providerId: "openai-a", modelId: "shared-model" }) };
      }
      return null;
    });

    await expect(resolveLlmRoute("canvas.chat")).resolves.toMatchObject({
      status: "ready",
      route: {
        providerId: "openai-a",
        modelId: "shared-model",
        egressDecision: { providerId: "openai-a", mode: "direct", cacheKey: "direct" },
      },
    });
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
  });

  it("matches a binding by provider/model pair when model names collide", () => {
    const result = resolveLlmRouteFromProviders({
      scenarioId: "canvas.chat",
      binding: { providerId: "openai-b", modelId: "shared-model" },
      providers: [provider(), provider({ id: "openai-b", name: "OpenAI B", sortOrder: 1 })],
    });
    expect(result).toMatchObject({
      status: "ready",
      route: {
        providerId: "openai-b",
        providerName: "OpenAI B",
        modelId: "shared-model",
        protocol: "openai-chat",
        source: "configured",
        status: "ready",
      },
    });
  });

  it.each(["canvas.chat", "image.role_prompt", "agent.chat"] as const)(
    "requires a persistent binding for %s instead of selecting a provider fallback",
    (scenarioId) => {
      const providers = [
        provider({ id: "openai-a", sortOrder: 0 }),
        provider({ id: "apimart", protocol: "apimart", chatModels: ["role-model"], sortOrder: 1 }),
      ];
      expect(resolveLlmRouteFromProviders({ scenarioId, binding: null, providers })).toEqual({
        status: "missing-binding",
      });
    },
  );

  it("ignores legacy-fallback provider metadata when no persistent binding exists", () => {
    const custom = provider({
      id: "custom-chat",
      allowLegacyFallback: false,
      sortOrder: -10,
    });
    const builtin = provider({ id: "kie", allowLegacyFallback: true, sortOrder: 0 });

    expect(resolveLlmRouteFromProviders({
      scenarioId: "canvas.chat",
      binding: null,
      providers: [custom, builtin],
    })).toEqual({ status: "missing-binding" });
  });

  it.each(["missing-proxy", "invalid-proxy"] as const)(
    "reports %s before calling a configured proxy route",
    (status) => {
      const configured = provider({ id: "google-ai-studio", egressMode: "proxy" });
      expect(resolveLlmRouteFromProviders({
        scenarioId: "canvas.chat",
        binding: { providerId: configured.id, modelId: "shared-model" },
        providers: [configured],
        proxyStatusByProviderId: {
          [configured.id]: status === "missing-proxy" ? "missing" : "invalid",
        },
      })).toEqual({ status });
    },
  );

  it("fails closed when a proxy route is evaluated without a resolved proxy snapshot", () => {
    const configured = provider({ id: "google-ai-studio", egressMode: "proxy" });
    expect(resolveLlmRouteFromProviders({
      scenarioId: "canvas.chat",
      binding: { providerId: configured.id, modelId: "shared-model" },
      providers: [configured],
    })).toEqual({ status: "missing-proxy" });
  });

  it("does not evaluate proxy state for an unbound provider", () => {
    const apimart = provider({
      id: "apimart",
      protocol: "apimart",
      egressMode: "proxy",
      chatModels: ["role-model"],
    });
    expect(resolveLlmRouteFromProviders({
      scenarioId: "image.role_prompt",
      binding: null,
      providers: [apimart],
      proxyStatusByProviderId: { apimart: "missing" },
    })).toEqual({ status: "missing-binding" });
  });

  it("uses a valid node override and rejects an invalid override without a default fallback", () => {
    const providers = [provider(), provider({ id: "openai-b", sortOrder: 1 })];
    const base = {
      scenarioId: "canvas.chat" as const,
      binding: { providerId: "openai-a", modelId: "shared-model" },
      providers,
    };
    expect(resolveLlmRouteFromProviders({
      ...base,
      override: { providerId: "openai-b", modelId: "shared-model" },
    })).toMatchObject({ status: "ready", route: { providerId: "openai-b", source: "node-override" } });
    expect(resolveLlmRouteFromProviders({
      ...base,
      override: { providerId: "openai-b", modelId: "disabled-model" },
    })).toEqual({ status: "model-disabled" });
  });

  it("allows a valid canvas node override without a persistent default binding", () => {
    const configured = provider({ id: "openai-b" });
    expect(resolveLlmRouteFromProviders({
      scenarioId: "canvas.chat",
      binding: null,
      override: { providerId: configured.id, modelId: "shared-model" },
      providers: [configured],
    })).toMatchObject({
      status: "ready",
      route: { providerId: "openai-b", source: "node-override" },
    });
  });

  it("does not hide a proxy configuration failure behind an override fallback", () => {
    const direct = provider({ id: "kie", egressMode: "direct" });
    const proxied = provider({ id: "google-ai-studio", egressMode: "proxy", sortOrder: 1 });
    expect(resolveLlmRouteFromProviders({
      scenarioId: "canvas.chat",
      binding: { providerId: direct.id, modelId: "shared-model" },
      override: { providerId: proxied.id, modelId: "shared-model" },
      providers: [direct, proxied],
      proxyStatusByProviderId: { [proxied.id]: "missing" },
    })).toEqual({ status: "missing-proxy" });
  });

  it.each([
    ["provider-disabled", provider({ enabled: false })],
    ["missing-key", provider({ apiKey: "" })],
    ["model-disabled", provider({ chatModels: [] })],
    ["unsupported-protocol", provider({ id: "gemini", protocol: "gemini" })],
    ["invalid-endpoint", provider({ llmProtocol: "openai-chat", llmEndpointTemplate: "../chat" })],
  ] as const)("reports %s for an unusable configured route", (status, configuredProvider) => {
    expect(resolveLlmRouteFromProviders({
      scenarioId: "canvas.chat",
      binding: { providerId: configuredProvider.id, modelId: "shared-model" },
      providers: [configuredProvider],
    })).toMatchObject({ status });
  });

  it("reports missing-binding when there is no binding or provider", () => {
    expect(resolveLlmRouteFromProviders({ scenarioId: "canvas.chat", binding: null, providers: [] })).toEqual({
      status: "missing-binding",
    });
  });
});

describe("OpenAI Chat Completions gateway", () => {
  beforeEach(() => vi.clearAllMocks());

  const route = {
    scenarioId: "canvas.chat" as const,
    providerId: "openai-a",
    modelId: "shared-model",
    providerName: "OpenAI A",
    protocol: "openai-chat" as const,
    source: "configured" as const,
    status: "ready" as const,
    url: "https://llm.example.test/v1/chat/completions",
    apiKey: "sk-super-secret",
    timeoutMs: 120_000,
    egressDecision: { providerId: "openai-a", mode: "direct" as const, cacheKey: "direct" as const },
  };
  const messages = [{ role: "user" as const, content: "hello" }];
  const imageMessages = [{
    role: "user" as const,
    content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }],
  }];

  async function classifyGatewayPayload(payload: unknown, status = 400) {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(JSON.stringify(payload), { status }));
    return callLlmForScenario(route, imageMessages).catch((caught) => caught);
  }

  it("registers only the implemented OpenAI Chat adapter", () => {
    expect(hasLlmProtocolAdapter("openai-chat")).toBe(true);
    expect(getLlmProtocolAdapter("openai-chat")?.protocol).toBe("openai-chat");
    expect(hasLlmProtocolAdapter("gemini-generate-content")).toBe(false);
    expect(getLlmProtocolAdapter("gemini-generate-content")).toBeNull();
  });

  it("keeps a successful scenario call to one upstream fetch", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: "adapter-ok" } }] }),
      { status: 200 },
    ));
    await expect(callLlmForScenario(route, [{ role: "user", content: "hello" }]))
      .resolves.toMatchObject({ text: "adapter-ok" });
    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["code", { code: "unsupported_image_input", message: "request rejected" }],
    ["type", { type: "model_capability_error", param: "image", message: "request rejected" }],
    ["param", { code: "unsupported_modality", param: "vision", message: "request rejected" }],
  ])("maps structured image capability evidence from %s to the fixed public message", async (_field, errorPayload) => {
    const error = await classifyGatewayPayload({ error: errorPayload });

    expect(error).toMatchObject({ kind: "unsupported-image", status: 400 });
    expect(getPublicLlmError(error)).toBe("该模型不支持图片输入，请在 API 配置中更换模型。");
  });

  it.each([
    ["format code", { code: "unsupported_image_format", message: "model does not support images" }],
    ["schema type", { type: "request_schema_error", param: "image", message: "model does not support images" }],
    ["payload type", { type: "invalid_payload", param: "image", message: "model does not support images" }],
    ["mime param", { code: "unsupported_modality", param: "image_mime_type", message: "model does not support images" }],
    ["image_url param", { code: "unsupported_content_type", param: "messages[0].content[1].image_url", message: "model does not support images" }],
    ["base64 param", { type: "model_capability_error", param: "image_base64", message: "model does not support images" }],
  ])("keeps structured request-shape evidence from %s as an upstream failure", async (_field, errorPayload) => {
    const error = await classifyGatewayPayload({ error: errorPayload }, 422);

    expect(error).toMatchObject({ kind: "upstream", status: 422 });
    expect(getPublicLlmError(error)).toBe("LLM 上游请求失败，请稍后重试");
  });

  it.each([
    ["image input is not supported in this request format", "upstream"],
    ["model does not support images", "unsupported-image"],
    ["request rejected by upstream", "upstream"],
  ] as const)("classifies text-only failure %s as %s", async (message, kind) => {
    const error = await classifyGatewayPayload({ error: { message } });

    expect(error).toMatchObject({ kind, status: 400 });
    expect(getPublicLlmError(error)).toBe(kind === "unsupported-image"
      ? "该模型不支持图片输入，请在 API 配置中更换模型。"
      : "LLM 上游请求失败，请稍后重试");
  });

  it("surfaces an upstream reference-image download timeout as a media error", async () => {
    const error = await classifyGatewayPayload({
      error: {
        message: "Unable to download content from the provided URL before the timeout. Check that the URL is publicly accessible and responds promptly.",
      },
    });

    expect(error).toMatchObject({ kind: "media-download", status: 400 });
    expect(getPublicLlmError(error)).toBe("LLM 无法及时读取参考图，请重新上传后重试");
  });

  it.each([
    [
      "structured capability",
      { code: 40003, message: "request rejected", data: { error: { code: "unsupported_image_input" } } },
      "unsupported-image",
    ],
    [
      "model capability wording",
      { code: 40003, message: "model does not support images", data: null },
      "unsupported-image",
    ],
    [
      "request format wording",
      { code: 40003, message: "image input is not supported in this request format", data: null },
      "upstream",
    ],
  ] as const)("classifies wrapped HTTP-200 %s errors through the same image classifier", async (_label, payload, kind) => {
    const error = await classifyGatewayPayload(payload, 200);

    expect(error).toMatchObject({ kind, status: 200 });
    expect(getPublicLlmError(error)).toBe(kind === "unsupported-image"
      ? "该模型不支持图片输入，请在 API 配置中更换模型。"
      : "LLM 上游请求失败，请稍后重试");
  });

  it("maps gateway failures to fixed public messages without echoing endpoint URLs or keys", () => {
    const error = new LlmGatewayError(
      "network",
      "fetch https://llm.example.test/v1/chat/completions failed with sk-super-secret",
    );

    const message = getPublicLlmError(error);

    expect(message).toBe("LLM 网络连接失败，请稍后重试");
    expect(message).not.toContain("llm.example.test");
    expect(message).not.toContain("sk-super-secret");
  });

  it.each([
    [new LlmGatewayError("timeout", "raw timeout"), "LLM 请求超时，请稍后重试"],
    [new LlmGatewayError("invalid-response", "raw payload"), "LLM 返回内容无效，请稍后重试"],
    [new LlmGatewayError("upstream", "raw auth", 401), "LLM 服务认证失败，请联系管理员检查配置"],
    [new LlmGatewayError("upstream", "raw busy", 429), "LLM 服务繁忙，请稍后重试"],
    [new LlmGatewayError("upstream", "raw server", 503), "LLM 上游服务暂时不可用，请稍后重试"],
    [new LlmGatewayError("upstream", "raw request", 400), "LLM 上游请求失败，请稍后重试"],
  ])("maps error kind/status to a stable public message", (error, expected) => {
    expect(getPublicLlmError(error)).toBe(expected);
  });

  it.each([
    [
      new LlmGatewayError("upstream", "用户额度不足, 剩余额度: -11.50", 403),
      "LLM 服务额度不足，请充值或选择其他平台模型。",
    ],
    [
      new LlmGatewayError("upstream", "request forbidden", 403),
      "LLM 服务拒绝请求，请检查模型权限或选择其他平台模型。",
    ],
  ])("distinguishes quota exhaustion from other forbidden LLM responses", (error, expected) => {
    expect(getPublicLlmError(error)).toBe(expected);
  });

  it.each([
    [{ choices: [{ message: { content: "standard" } }] }, "standard"],
    [{ code: 0, data: { choices: [{ message: { content: "wrapped" } }] } }, "wrapped"],
    [{ choices: [{ message: { content: ["a", { type: "text", text: "b" }] } }] }, "ab"],
  ])("parses standard, APIMART, and text-array responses", async (payload, expected) => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    await expect(callOpenAiChatCompletion(route, messages)).resolves.toBe(expected);
    const [decision, url, init] = mocks.fetchWithProviderEgress.mock.calls[0];
    expect(decision).toBe(route.egressDecision);
    expect(url).toBe(route.url);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(route.timeoutMs);
    timeout.mockRestore();
    expect(JSON.parse(init.body)).toMatchObject({ model: "shared-model", messages, stream: false });
  });

  it("returns text, the resolved route, and duration from the scenario gateway", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: "generic" } }] }),
      { status: 200 },
    ));

    const result = await callLlmForScenario(route, messages);
    expect(result).toEqual({
      text: "generic",
      route: {
        scenarioId: "canvas.chat",
        providerId: "openai-a",
        providerName: "OpenAI A",
        modelId: "shared-model",
        protocol: "openai-chat",
        source: "configured",
        status: "ready",
      },
      durationMs: expect.any(Number),
    });
    expect(result.route).not.toHaveProperty("apiKey");
    expect(result.route).not.toHaveProperty("url");
  });

  it("classifies failures without leaking the API key into errors or log metadata", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "upstream echoed sk-super-secret" } }),
      { status: 401 },
    ));

    const error = await callOpenAiChatCompletion(route, messages).catch((caught) => caught);
    expect(error).toBeInstanceOf(LlmGatewayError);
    expect(error).toMatchObject({ kind: "upstream", status: 401 });
    expect(String(error.message)).not.toContain(route.apiKey);
    expect(mocks.loggerLog).toHaveBeenCalledTimes(1);
    const logged = mocks.loggerLog.mock.calls[0][0];
    expect(logged.action).toBe("llm_call_canvas_chat");
    expect(logged.metadata).toMatchObject({
      scenarioId: "canvas.chat",
      providerId: "openai-a",
      modelId: "shared-model",
      routeSource: "configured",
      status: "upstream-error",
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(logged.metadata)).not.toContain(route.apiKey);
  });
});
