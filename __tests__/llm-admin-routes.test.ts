import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { BAILIAN_LLM_MODELS } from "@/lib/bailian-llm-models";

// Routing tests isolate billing persistence, which has its own integration tests.
vi.mock("@/lib/billing/llm", () => ({
  beginLlmCost: vi.fn(async () => ({ id: 1, snapshot: {} })),
  finishLlmCost: vi.fn(async () => undefined),
}));

const mocks = vi.hoisted(() => {
  const settings = new Map<string, string>();
  const state = {
    settings,
    inTransaction: false,
    transactionError: null as Error | null,
    requireAdminRequest: vi.fn(),
    findUnique: vi.fn(async ({ where }: any) => {
      const value = settings.get(where.key);
      return value === undefined ? null : { value };
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      settings.set(where.key, update?.value ?? create.value);
      return { key: where.key, value: settings.get(where.key) };
    }),
    findFirstLog: vi.fn(),
    transaction: vi.fn(),
    fetchWithProviderEgress: vi.fn(),
    loggerLog: vi.fn(),
  };
  return state;
});

vi.mock("@/lib/admin-auth", () => ({ requireAdminRequest: mocks.requireAdminRequest }));
vi.mock("@/lib/prisma", () => ({
  default: {
    appSetting: { findUnique: mocks.findUnique, upsert: mocks.upsert },
    log: { findFirst: mocks.findFirstLog },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/providers/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/transport")>();
  return { ...actual, fetchWithProviderEgress: mocks.fetchWithProviderEgress };
});
vi.mock("@/lib/logger", () => ({ Logger: { log: mocks.loggerLog } }));

import { GET } from "@/app/api/admin/llm-routes/route";
import { POST as testRoute } from "@/app/api/admin/llm-routes/[scenarioId]/test/route";
import { POST as activateRoute } from "@/app/api/admin/llm-routes/[scenarioId]/activate/route";

const provider = {
  id: "openai-a",
  name: "OpenAI A",
  protocol: "openai",
  baseUrl: "https://llm.example.test/v1",
  egressMode: "direct" as const,
  apiKey: "sk-admin-secret",
  llmProtocol: "openai-chat",
  llmEndpointTemplate: "chat/completions",
  imageModels: [],
  videoModels: [],
  chatModels: ["chat-model"],
  modelProtocols: {},
  enabled: true,
  sortOrder: 100,
};

const transactionClient = {
  appSetting: { findUnique: mocks.findUnique, upsert: mocks.upsert },
};

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as any;
}

function params(scenarioId: string) {
  return { params: { scenarioId } };
}

describe("admin LLM routes API", () => {
  beforeEach(() => {
    mocks.settings.clear();
    mocks.settings.set("providers.registry", JSON.stringify([provider]));
    mocks.requireAdminRequest.mockReset();
    mocks.requireAdminRequest.mockReturnValue({ ok: true, username: "admin" });
    mocks.findUnique.mockClear();
    mocks.upsert.mockClear();
    mocks.findFirstLog.mockReset();
    mocks.findFirstLog.mockResolvedValue(null);
    mocks.fetchWithProviderEgress.mockReset();
    mocks.loggerLog.mockClear();
    mocks.transaction.mockReset();
    mocks.transactionError = null;
    mocks.transaction.mockImplementation(async (callback: any) => {
      if (mocks.transactionError) throw mocks.transactionError;
      mocks.inTransaction = true;
      try {
        return await callback(transactionClient);
      } finally {
        mocks.inTransaction = false;
      }
    });
  });

  it("rejects an unauthenticated GET", async () => {
    mocks.requireAdminRequest.mockReturnValue({ ok: false, error: "unauthorized" });

    const response = await GET(request("/api/admin/llm-routes"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("returns scenarios, safe candidates, configured/effective routes and parsed last calls without secrets", async () => {
    mocks.settings.set(
      "llm_route.canvas.chat",
      JSON.stringify({
        version: 2,
        providerId: "openai-a",
        modelId: "chat-model",
        networkRevision: `sha256:${"b".repeat(64)}`,
      }),
    );
    mocks.findFirstLog.mockImplementation(async ({ where }: any) => where.action === "llm_call_canvas_chat"
      ? {
        id: 91,
        action: where.action,
        level: "success",
        message: "LLM call succeeded",
        metadata: JSON.stringify({
          scenarioId: "canvas.chat",
          providerId: "openai-a",
          modelId: "chat-model",
          routeSource: "configured",
          status: "success",
          durationMs: 31,
          apiKey: "must-not-leak",
          url: "https://must-not-leak.test",
        }),
        duration: 31,
        createdAt: new Date("2026-07-10T01:02:03.000Z"),
      }
      : null);

    const response = await GET(request("/api/admin/llm-routes"));
    const payload = await response.json();
    const canvas = payload.scenarios.find((item: any) => item.id === "canvas.chat");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(canvas).toMatchObject({
      id: "canvas.chat",
      label: "画布对话",
      configured: { providerId: "openai-a", modelId: "chat-model" },
      effective: {
        scenarioId: "canvas.chat",
        providerId: "openai-a",
        modelId: "chat-model",
        source: "configured",
        status: "ready",
      },
      lastCall: {
        id: 91,
        status: "success",
        providerId: "openai-a",
        modelId: "chat-model",
        durationMs: 31,
        createdAt: "2026-07-10T01:02:03.000Z",
      },
    });
    expect(canvas.candidates).toContainEqual(expect.objectContaining({
      providerId: "openai-a",
      providerName: "OpenAI A",
      modelId: "chat-model",
      status: "ready",
    }));
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("sk-admin-secret");
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("chat/completions");
    expect(serialized).not.toContain("llm.example.test");
    expect(serialized).not.toContain("networkRevision");
    expect(serialized).not.toContain("sha256:");
  });

  it("tests a route with a real gateway call without writing the binding", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200 },
    ));

    const response = await testRoute(
      request("/api/admin/llm-routes/canvas.chat/test", "POST", {
        providerId: "openai-a",
        modelId: "chat-model",
      }),
      params("canvas.chat"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toMatchObject({ success: true, result: { text: "ok" } });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.settings.has("llm_route.canvas.chat")).toBe(false);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.loggerLog).toHaveBeenCalledWith(expect.objectContaining({ action: "llm_route_probe" }));
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("sk-admin-secret");
    expect(serialized).not.toContain("chat/completions");
    expect(serialized).not.toContain("llm.example.test");
    expect(serialized).not.toContain("networkRevision");
    expect(serialized).not.toContain("sha256:");
  });

  it("sends text and an inline PNG when testing the visual scenario", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: "vision-ok" } }] }),
      { status: 200 },
    ));

    const response = await testRoute(
      request("/api/admin/llm-routes/image.role_prompt/test", "POST", {
        providerId: "openai-a",
        modelId: "chat-model",
      }),
      params("image.role_prompt"),
    );

    expect(response.status).toBe(200);
    const [, , init] = mocks.fetchWithProviderEgress.mock.calls[0];
    const upstreamBody = JSON.parse(init.body);
    expect(upstreamBody.messages[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text", text: expect.any(String) }),
      expect.objectContaining({
        type: "image_url",
        image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
      }),
    ]));
  });

  it.each(BAILIAN_LLM_MODELS)("activates %s with a decodable image above Bailian's minimum dimensions", async (modelId) => {
    mocks.settings.set("providers.registry", JSON.stringify([{
      ...provider,
      id: "bailian",
      baseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com",
      chatModels: [...BAILIAN_LLM_MODELS],
    }]));
    mocks.fetchWithProviderEgress.mockImplementation(async (_decision, _url, init) => {
      const body = JSON.parse(init.body);
      const image = body.messages[0].content.find((part: any) => part.type === "image_url");
      const bytes = Buffer.from(image.image_url.url.split(",")[1], "base64");
      const { info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      expect(info.width).toBeGreaterThan(10);
      expect(info.height).toBeGreaterThan(10);
      expect(body.model).toBe(modelId);
      return new Response(JSON.stringify({ choices: [{ message: { content: "A blue square." } }] }), { status: 200 });
    });

    const response = await activateRoute(
      request("/api/admin/llm-routes/image.role_prompt/activate", "POST", { providerId: "bailian", modelId }),
      params("image.role_prompt"),
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(mocks.settings.get("llm_route.image.role_prompt")!)).toMatchObject({ providerId: "bailian", modelId });
  });

  it.each([activateRoute, testRoute])("rejects retired Agent default binding endpoints without an upstream request", async handler => {
    const oldValue = JSON.stringify({ version: 1, providerId: "old-provider", modelId: "old-model" });
    mocks.settings.set("llm_route.agent.chat", oldValue);
    const response = await handler(request("/api/admin/llm-routes/agent.chat/activate", "POST", { providerId: "openai-a", modelId: "chat-model" }), params("agent.chat"));
    expect(response.status).toBe(400);
    expect(mocks.fetchWithProviderEgress).not.toHaveBeenCalled();
    expect(mocks.settings.get("llm_route.agent.chat")).toBe(oldValue);
  });

  it("excludes Agent defaults from the admin catalog even with a saved legacy binding", async () => {
    mocks.settings.set("llm_route.agent.chat", JSON.stringify({ version: 1, providerId: "openai-a", modelId: "chat-model" }));
    const response = await GET(request("/api/admin/llm-routes"));
    expect((await response.json()).scenarios.map((item: { id: string }) => item.id)).toEqual(["canvas.chat", "image.role_prompt"]);
    expect(mocks.fetchWithProviderEgress).not.toHaveBeenCalled();
  });

  it("keeps the old binding when activation's real call fails", async () => {
    const oldValue = JSON.stringify({ version: 1, providerId: "old-provider", modelId: "old-model" });
    mocks.settings.set("llm_route.canvas.chat", oldValue);
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(
      JSON.stringify({ error: { message: "bad key sk-admin-secret at https://private.example.test/chat/completions" } }),
      { status: 401 },
    ));

    const response = await activateRoute(
      request("/api/admin/llm-routes/canvas.chat/activate", "POST", {
        providerId: "openai-a",
        modelId: "chat-model",
      }),
      params("canvas.chat"),
    );
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.success).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("sk-admin-secret");
    expect(JSON.stringify(payload)).not.toContain("private.example.test");
    expect(mocks.settings.get("llm_route.canvas.chat")).toBe(oldValue);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("keeps the visual binding when the model rejects images", async () => {
    const oldValue = JSON.stringify({ version: 1, providerId: "old-provider", modelId: "old-model" });
    mocks.settings.set("llm_route.image.role_prompt", oldValue);
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(JSON.stringify({
      error: { code: "model_capability_error", message: "model does not support images" },
    }), { status: 400 }));

    const response = await activateRoute(
      request("/api/admin/llm-routes/image.role_prompt/activate", "POST", {
        providerId: "openai-a",
        modelId: "chat-model",
      }),
      params("image.role_prompt"),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      success: false,
      error: "该模型不支持图片输入，请在 API 配置中更换模型。",
      status: "unsupported-image",
    });
    expect(mocks.settings.get("llm_route.image.role_prompt")).toBe(oldValue);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("writes a version 2 binding only after activation's real call succeeds", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200 },
    ));

    const response = await activateRoute(
      request("/api/admin/llm-routes/canvas.chat/activate", "POST", {
        providerId: "openai-a",
        modelId: "chat-model",
      }),
      params("canvas.chat"),
    );

    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(JSON.parse(mocks.settings.get("llm_route.canvas.chat") || "null")).toEqual({
      version: 2,
      providerId: "openai-a",
      modelId: "chat-model",
      networkRevision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(payload)).not.toContain("networkRevision");
    expect(JSON.stringify(payload)).not.toContain("sha256:");
    expect(JSON.stringify(payload)).not.toContain("sk-admin-secret");
    expect(JSON.stringify(payload)).not.toContain("llm.example.test");
  });

  it("does not let a slower successful activation overwrite a newer binding", async () => {
    mocks.settings.set("providers.registry", JSON.stringify([{
      ...provider,
      chatModels: ["chat-model", "newer-model"],
    }]));
    let releaseSlow!: () => void;
    let markSlowStarted!: () => void;
    const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const slowStarted = new Promise<void>((resolve) => { markSlowStarted = resolve; });
    mocks.fetchWithProviderEgress.mockImplementation(async (_decision, _url, init) => {
      const model = JSON.parse(String(init?.body ?? "{}")).model;
      if (model === "chat-model") {
        markSlowStarted();
        await slowGate;
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    });

    const slowActivation = activateRoute(
      request("/api/admin/llm-routes/canvas.chat/activate", "POST", {
        providerId: "openai-a",
        modelId: "chat-model",
      }),
      params("canvas.chat"),
    );
    await slowStarted;
    const newerResponse = await activateRoute(
      request("/api/admin/llm-routes/canvas.chat/activate", "POST", {
        providerId: "openai-a",
        modelId: "newer-model",
      }),
      params("canvas.chat"),
    );
    releaseSlow();
    const slowResponse = await slowActivation;

    expect(newerResponse.status).toBe(200);
    expect(slowResponse.status).toBe(409);
    expect(await slowResponse.json()).toMatchObject({ status: "route-changed" });
    expect(JSON.parse(mocks.settings.get("llm_route.canvas.chat") || "null")).toMatchObject({
      version: 2,
      providerId: "openai-a",
      modelId: "newer-model",
    });
  });

  it("revalidates providers in a serializable transaction and keeps the old binding when config changes after probe", async () => {
    const oldValue = JSON.stringify({ version: 1, providerId: "old-provider", modelId: "old-model" });
    mocks.settings.set("llm_route.canvas.chat", oldValue);
    mocks.fetchWithProviderEgress.mockImplementation(async () => {
      mocks.settings.set("providers.registry", JSON.stringify([{ ...provider, enabled: false }]));
      return new Response(JSON.stringify({ choices: [{ message: { content: "probe-ok" } }] }), { status: 200 });
    });

    const response = await activateRoute(
      request("/api/admin/llm-routes/canvas.chat/activate", "POST", {
        providerId: "openai-a",
        modelId: "chat-model",
      }),
      params("canvas.chat"),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.settings.get("llm_route.canvas.chat")).toBe(oldValue);
  });

  it.each([
    ["Base URL", (current: typeof provider) => ({ ...current, baseUrl: "https://changed.example.test/v1" })],
    ["API key", (current: typeof provider) => ({ ...current, apiKey: "sk-changed-secret" })],
    ["egress mode", (current: typeof provider) => ({ ...current, egressMode: "proxy" as const })],
  ])("returns 409 and keeps the old binding when %s changes during the activation probe", async (_field, mutate) => {
    const oldValue = JSON.stringify({ version: 1, providerId: "old-provider", modelId: "old-model" });
    mocks.settings.set("llm_route.canvas.chat", oldValue);
    mocks.fetchWithProviderEgress.mockImplementation(async () => {
      const changed = mutate(provider);
      mocks.settings.set("providers.registry", JSON.stringify([changed]));
      if (changed.egressMode === "proxy") {
        mocks.settings.set("providers.proxy", JSON.stringify({
          version: 1,
          state: "configured",
          url: "http://proxy-user:proxy-secret@proxy.example.test:8080",
        }));
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "probe-ok" } }] }), { status: 200 });
    });

    const response = await activateRoute(
      request("/api/admin/llm-routes/canvas.chat/activate", "POST", {
        providerId: "openai-a",
        modelId: "chat-model",
      }),
      params("canvas.chat"),
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(mocks.settings.get("llm_route.canvas.chat")).toBe(oldValue);
    expect(mocks.upsert).not.toHaveBeenCalled();
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("networkRevision");
    expect(serialized).not.toContain("sha256:");
    expect(serialized).not.toContain("sk-admin-secret");
    expect(serialized).not.toContain("sk-changed-secret");
    expect(serialized).not.toContain("changed.example.test");
    expect(serialized).not.toContain("proxy-secret");
  });

  it("returns 409 when proxy A changes to B during the activation probe without leaking either proxy", async () => {
    const oldValue = JSON.stringify({ version: 1, providerId: "old-provider", modelId: "old-model" });
    const proxiedProvider = { ...provider, egressMode: "proxy" as const };
    const proxyA = "http://proxy-user:proxy-a-secret@proxy-a.example.test:8080";
    const proxyB = "http://proxy-user:proxy-b-secret@proxy-b.example.test:8081";
    mocks.settings.set("providers.registry", JSON.stringify([proxiedProvider]));
    mocks.settings.set("providers.proxy", JSON.stringify({ version: 1, state: "configured", url: proxyA }));
    mocks.settings.set("llm_route.canvas.chat", oldValue);
    mocks.fetchWithProviderEgress.mockImplementation(async () => {
      mocks.settings.set("providers.proxy", JSON.stringify({ version: 1, state: "configured", url: proxyB }));
      return new Response(JSON.stringify({ choices: [{ message: { content: "probe-ok" } }] }), { status: 200 });
    });

    const response = await activateRoute(
      request("/api/admin/llm-routes/canvas.chat/activate", "POST", {
        providerId: "openai-a",
        modelId: "chat-model",
      }),
      params("canvas.chat"),
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(mocks.settings.get("llm_route.canvas.chat")).toBe(oldValue);
    expect(mocks.upsert).not.toHaveBeenCalled();
    const serialized = JSON.stringify(payload);
    for (const secret of ["networkRevision", "sha256:", "proxy-a", "proxy-b", "proxy-user", "sk-admin-secret", "llm.example.test"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("maps an activation serialization conflict to a retryable 409", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200 },
    ));
    mocks.transactionError = Object.assign(new Error("write conflict"), { code: "P2034" });

    const response = await activateRoute(
      request("/api/admin/llm-routes/canvas.chat/activate", "POST", {
        providerId: "openai-a",
        modelId: "chat-model",
      }),
      params("canvas.chat"),
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toContain("重试");
  });

  it.each([
    ["test", testRoute],
    ["activate", activateRoute],
  ])("rejects an unauthenticated %s request", async (_name, handler) => {
    mocks.requireAdminRequest.mockReturnValue({ ok: false, error: "unauthorized" });

    const response = await handler(
      request("/api/admin/llm-routes/canvas.chat/test", "POST", {
        providerId: "openai-a",
        modelId: "chat-model",
      }),
      params("canvas.chat"),
    );

    expect(response.status).toBe(401);
    expect(mocks.fetchWithProviderEgress).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown scenario", "unknown", "openai-a", "chat-model"],
    ["unknown provider", "canvas.chat", "missing", "chat-model"],
    ["unknown model", "canvas.chat", "openai-a", "missing-model"],
  ])("rejects %s before calling upstream", async (_name, scenarioId, providerId, modelId) => {
    const response = await testRoute(
      request(`/api/admin/llm-routes/${scenarioId}/test`, "POST", { providerId, modelId }),
      params(scenarioId),
    );

    expect(response.status).toBe(400);
    expect(mocks.fetchWithProviderEgress).not.toHaveBeenCalled();
  });
});
