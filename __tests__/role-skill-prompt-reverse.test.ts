import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  getCurrentUser: vi.fn(async () => ({ id: 7, username: "alice" })),
  resolveSkill: vi.fn(async () => ({
    source: "system",
    id: BigInt(9),
    name: "商品精修",
    revision: 3,
    content: "服务端系统技能内容",
  })),
  create: vi.fn(),
  findUnique: vi.fn(async (): Promise<any> => null),
  findMany: vi.fn(async (): Promise<any[]> => []),
  update: vi.fn(),
  appSettingFindUnique: vi.fn(async () => null),
  resolveRoute: vi.fn(async () => ({
    status: "ready",
    route: {
      scenarioId: "image.role_prompt",
      providerId: "provider",
      providerName: "Provider",
      modelId: "model",
      protocol: "openai-chat",
      source: "configured",
      status: "ready",
      url: "https://example.com/v1/chat/completions",
      apiKey: "secret",
      timeoutMs: 60_000,
    },
  })),
}));

vi.mock("@/lib/server-auth", () => ({ getCurrentUser: fake.getCurrentUser }));
vi.mock("@/lib/role-skills/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/role-skills/repository")>()),
  resolveRoleSkillForExecution: fake.resolveSkill,
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    appSetting: { findUnique: fake.appSettingFindUnique },
    promptReverseTask: {
      create: fake.create,
      findUnique: fake.findUnique,
      findMany: fake.findMany,
      update: fake.update,
    },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/llm-routing/resolver", () => ({
  resolveLlmRoute: fake.resolveRoute,
  resolveLlmRouteFromProviders: vi.fn(),
  attachLlmEgressDecision: vi.fn(),
}));
vi.mock("@/lib/llm-routing/gateway", () => ({
  callLlmForScenario: vi.fn(),
  getPublicLlmError: vi.fn(() => "技能不可用"),
}));
vi.mock("@/lib/providers/registry", () => ({ getRegisteredProviders: vi.fn() }));
vi.mock("@/lib/providers/proxy-config", () => ({
  readProxySettingRaw: vi.fn(),
  resolveProviderProxyFromRaw: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ Logger: { log: vi.fn() } }));
vi.mock("@/lib/oss", () => ({
  isOssReady: vi.fn(() => false),
  uploadBufferToOss: vi.fn(),
  uploadLocalUploadPathToOss: vi.fn(),
}));
vi.mock("@/lib/external-assets", () => ({ resolveAssetUrlForExternalApi: vi.fn() }));
vi.mock("@/lib/prompt-reverse-media", () => ({ preparePromptReverseRelayImage: vi.fn() }));

function request(body: unknown, method = "POST") {
  const req = new Request("http://localhost/api/prompt-reverse", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  Object.defineProperty(req, "nextUrl", { value: new URL(req.url) });
  return req as any;
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    authUserId: 7,
    userId: "7",
    status: "pending",
    surface: "batch_workbench",
    systemPrompt: "服务端系统技能内容",
    userPrompt: "用户任务",
    requestedModel: null,
    llmProviderId: "provider",
    model: "model",
    mediaUrls: [],
    resolvedMediaUrls: [],
    generatedPrompt: null,
    errorMsg: null,
    skillSource: "system",
    skillId: BigInt(9),
    skillName: "商品精修",
    skillRevision: 3,
    createdAt: new Date("2026-08-05T00:00:00.000Z"),
    updatedAt: new Date("2026-08-05T00:00:00.000Z"),
    ...overrides,
  };
}

describe("prompt reverse role skill execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fake.getCurrentUser.mockResolvedValue({ id: 7, username: "alice" });
    fake.resolveSkill.mockResolvedValue({
      source: "system",
      id: BigInt(9),
      name: "商品精修",
      revision: 3,
      content: "服务端系统技能内容",
    });
    fake.create.mockResolvedValue(task());
    fake.findUnique.mockResolvedValue(null);
    fake.findMany.mockResolvedValue([]);
  });

  it("resolves the selected skill server-side and snapshots provenance", async () => {
    const { POST } = await import("@/app/api/prompt-reverse/route");
    const response = await POST(request({
      async: true,
      surface: "batch_workbench",
      roleSkillId: "system:9",
      systemPrompt: "客户端伪造内容",
      userPrompt: "用户任务",
      mediaUrls: [],
    }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(fake.resolveSkill).toHaveBeenCalledWith({ authUserId: 7, publicId: "system:9" });
    expect(fake.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        systemPrompt: expect.stringContaining("服务端系统技能内容"),
        skillSource: "system",
        skillId: BigInt(9),
        skillName: "商品精修",
        skillRevision: 3,
      }),
    });
    expect(body.task).not.toHaveProperty("systemPrompt");
    expect(body.task.skill).toEqual({ id: "system:9", name: "商品精修", revision: 3 });
  });

  it("never serializes the stored system prompt in ordinary task history", async () => {
    fake.findMany.mockResolvedValue([task({ status: "success", generatedPrompt: "生成结果" })]);
    const { GET } = await import("@/app/api/prompt-reverse/route");
    const req = request({}, "GET");
    Object.defineProperty(req, "url", {
      value: "http://localhost/api/prompt-reverse?surface=batch_workbench",
    });
    const response = await GET(req);
    const body = await response.json();
    expect(body.tasks[0]).not.toHaveProperty("systemPrompt");
    expect(body.tasks[0]).toMatchObject({
      userPrompt: "用户任务",
      skill: { id: "system:9", name: "商品精修", revision: 3 },
    });
  });
});
