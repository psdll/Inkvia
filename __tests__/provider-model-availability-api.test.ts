import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: { appSetting: { findUnique: vi.fn().mockResolvedValue(null) } } }));

const mocks = vi.hoisted(() => ({
  getVisibleImageEditModels: vi.fn(),
  getVisibleToolboxModels: vi.fn(),
  getRegisteredProviders: vi.fn(),
  getUserId: vi.fn(),
  requireCanvasEntryEnabled: vi.fn(),
  resolveLlmRoute: vi.fn(),
  resolveLlmRouteFromProviders: vi.fn(),
}));

vi.mock("@/lib/image-edit-models", () => ({
  getVisibleImageEditModels: mocks.getVisibleImageEditModels,
  getVisibleToolboxModels: mocks.getVisibleToolboxModels,
}));
vi.mock("@/lib/providers/registry", () => ({
  getRegisteredProviders: mocks.getRegisteredProviders,
}));
vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/llm-routing/resolver", () => ({
  resolveLlmRoute: mocks.resolveLlmRoute,
  resolveLlmRouteFromProviders: mocks.resolveLlmRouteFromProviders,
}));

const providers = [
  {
    id: "kie",
    name: "KIE.AI",
    protocol: "openai" as const,
    baseUrl: "https://api.kie.ai",
    egressMode: "direct" as const,
    imageModels: ["nano-banana-pro"],
    videoModels: ["grok-video-1.5"],
    chatModels: [],
    modelProtocols: {},
    enabled: true,
    sortOrder: 1,
  },
];

function nextRequest(url: string) {
  const request = new Request(url);
  Object.defineProperty(request, "nextUrl", { value: new URL(url) });
  return request as any;
}

describe("provider model availability APIs", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getRegisteredProviders.mockResolvedValue(providers);
    mocks.getUserId.mockResolvedValue("7");
    mocks.requireCanvasEntryEnabled.mockResolvedValue(null);
    mocks.resolveLlmRoute.mockResolvedValue({ status: "missing-binding" });
    mocks.resolveLlmRouteFromProviders.mockResolvedValue({ status: "missing-binding" });
  });

  it("exposes every globally visible image model even when its provider is unavailable", async () => {
    mocks.getVisibleImageEditModels.mockResolvedValue([
      { id: "nano-banana-pro", provider: "kie", category: "image" },
      { id: "gpt-image-2-official-reapi", provider: "reapi", category: "image" },
      { id: "gpt-image-2-aicoming-haiya", provider: "aicoming-haiya", category: "image" },
      { id: "gpt-image-2-tuzi", provider: "tuzi", category: "image" },
    ]);
    const { GET } = await import("@/app/api/image-edit/models/route");

    const response = await GET();
    const body = await response.json();

    expect(body.models.map((model: { id: string }) => model.id)).toEqual([
      "nano-banana-pro",
      "gpt-image-2-official-reapi",
      "gpt-image-2-aicoming-haiya",
      "gpt-image-2-tuzi",
    ]);
  });

  it("exposes globally visible MiniMax-H3 even when its provider is unavailable", async () => {
    mocks.getVisibleToolboxModels.mockResolvedValue([
      { id: "grok-video-1.5", provider: "kie", category: "video" },
      { id: "minimax-h3", provider: "minimax", category: "video" },
    ]);
    const { GET } = await import("@/app/api/toolbox/models/route");

    const response = await GET(nextRequest("http://localhost/api/toolbox/models?category=video"));
    const body = await response.json();

    expect(body.models.map((model: { id: string }) => model.id)).toEqual([
      "grok-video-1.5",
      "minimax-h3",
    ]);
  });

  it("includes the configured provider egress with each visible image model", async () => {
    mocks.getVisibleImageEditModels.mockResolvedValue([
      { id: "nano-banana-pro", provider: "kie", category: "image" },
    ]);
    const { GET } = await import("@/app/api/image-edit/models/route");

    const response = await GET();
    const body = await response.json();

    expect(body.models).toEqual([expect.objectContaining({
      id: "nano-banana-pro",
      provider: "kie",
      providerName: "KIE.AI",
      egressMode: "direct",
    })]);
  });

  it("leaves face tools independent from provider model selection", async () => {
    mocks.getVisibleToolboxModels.mockResolvedValue([
      { id: "swap", provider: "runninghub", category: "face" },
    ]);
    const { GET } = await import("@/app/api/toolbox/models/route");

    const response = await GET(nextRequest("http://localhost/api/toolbox/models?category=face"));
    const body = await response.json();

    expect(body.models).toEqual([]);
    expect(mocks.getVisibleToolboxModels).not.toHaveBeenCalled();
    expect(mocks.getRegisteredProviders).not.toHaveBeenCalled();
  });

  it("returns the same globally visible image and video models to the canvas", async () => {
    mocks.getVisibleImageEditModels.mockResolvedValue([
      {
        id: "nano-banana-pro",
        label: "nano-banana-pro",
        provider: "kie",
        category: "image",
      },
      {
        id: "gpt-image-2-official-reapi",
        label: "GPT-Image-2（re）",
        provider: "reapi",
        category: "image",
      },
    ]);
    mocks.getVisibleToolboxModels.mockResolvedValue([
      {
        id: "grok-video-1.5",
        label: "grok-video-1.5",
        provider: "kie",
        category: "video",
        supportedResolutions: ["480p", "720p"],
      },
      {
        id: "minimax-h3",
        label: "MiniMax-H3",
        provider: "minimax",
        category: "video",
        supportedResolutions: ["768p", "2k"],
      },
    ]);
    const { GET } = await import("@/app/api/canvas/models/route");

    const response = await GET(nextRequest("http://localhost/api/canvas/models"));
    const body = await response.json();

    expect(body.image.map((model: { id: string }) => model.id)).toEqual([
      "nano-banana-pro",
      "gpt-image-2-official-reapi",
    ]);
    expect(body.video.map((model: { id: string }) => model.id)).toEqual([
      "grok-video-1.5",
      "minimax-h3",
    ]);
  });

  it("exposes the visible Midjourney image adapter to the canvas", async () => {
    mocks.getVisibleImageEditModels.mockResolvedValue([{
      id: "midjourney-v8-reapi",
      label: "Midjourney-V8.2",
      provider: "reapi",
      category: "image",
    }]);
    mocks.getVisibleToolboxModels.mockResolvedValue([]);
    const { GET } = await import("@/app/api/canvas/models/route");

    const response = await GET(nextRequest("http://localhost/api/canvas/models"));
    const body = await response.json();

    expect(body.image.map((model: { id: string }) => model.id)).toEqual(["midjourney-v8-reapi"]);
    expect(mocks.getVisibleImageEditModels).toHaveBeenCalledTimes(1);
  });

  it("returns the configured display name to the live batch model list", async () => {
    mocks.getVisibleToolboxModels.mockResolvedValue([{
      id: "minimax-h3",
      label: "H3 自定义名称",
      provider: "minimax",
      category: "video",
      supportedResolutions: ["768p", "2k"],
    }]);
    const { GET } = await import("@/app/api/live-video-batches/models/route");

    const response = await GET();
    const body = await response.json();

    expect(body.models.map((model: { id: string }) => model.id)).toEqual(["minimax-h3"]);
    expect(body.models[0].label).toBe("H3 自定义名称");
  });
});
