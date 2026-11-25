import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callLlmForScenario: vi.fn(),
  resolveLlmRoute: vi.fn(),
  resolveAssetUrlForExternalApi: vi.fn(),
  logger: vi.fn(),
}));

vi.mock("@/lib/llm-routing/gateway", () => ({
  callLlmForScenario: mocks.callLlmForScenario,
  getPublicLlmError: (error: unknown) => error instanceof Error ? error.message : "LLM 调用失败",
}));

vi.mock("@/lib/llm-routing/resolver", () => ({
  resolveLlmRoute: mocks.resolveLlmRoute,
}));

vi.mock("@/lib/external-assets", () => ({
  resolveAssetUrlForExternalApi: mocks.resolveAssetUrlForExternalApi,
}));

vi.mock("@/lib/oss", () => ({
  isOssReady: () => false,
  uploadBufferToOss: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  Logger: { log: mocks.logger },
}));

import { generateLiveVideoPrompt } from "@/lib/live-video-batch/prompt-executor";

describe("live video prompt executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveLlmRoute.mockResolvedValue({
      status: "ready",
      route: { providerId: "provider-1", modelId: "chat-1" },
    });
    mocks.resolveAssetUrlForExternalApi.mockImplementation(async (url: string) => url);
    mocks.callLlmForScenario.mockResolvedValue({
      text: "镜头缓慢推进，产品主体保持清晰，光线自然变化。",
      usage: { inputTokens: 10, outputTokens: 20 },
    });
  });

  it("runs one skill analysis with exactly one image", async () => {
    const result = await generateLiveVideoPrompt({
      systemPrompt: "你是商品短视频运动设计师。",
      userPrompt: "动作自然，避免改变产品结构。",
      mediaUrl: "https://example.com/product.png",
      origin: "http://localhost:3100",
      logUserId: "7",
    });

    expect(result).toMatchObject({
      generatedPrompt: "镜头缓慢推进，产品主体保持清晰，光线自然变化。",
      llmProviderId: "provider-1",
      model: "chat-1",
      resolvedMediaUrl: "https://example.com/product.png",
    });
    expect(mocks.callLlmForScenario).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.callLlmForScenario.mock.calls[0][1])).toContain(
      "https://example.com/product.png",
    );
    expect(mocks.logger).toHaveBeenCalledWith(expect.objectContaining({
      userId: "7",
      action: "live_video_prompt",
      level: "success",
    }));
  });

  it("fails before the LLM call when the media url is empty", async () => {
    await expect(generateLiveVideoPrompt({
      systemPrompt: "你是商品短视频运动设计师。",
      userPrompt: "动作自然。",
      mediaUrl: "",
      origin: "http://localhost:3100",
    })).rejects.toMatchObject({
      code: "LIVE_VIDEO_PROMPT_MEDIA_REQUIRED",
      status: 400,
    });
    expect(mocks.callLlmForScenario).not.toHaveBeenCalled();
  });

  it("fails with a stable code when the selected LLM route is unavailable", async () => {
    mocks.resolveLlmRoute.mockResolvedValue({ status: "unconfigured" });

    await expect(generateLiveVideoPrompt({
      systemPrompt: "你是商品短视频运动设计师。",
      userPrompt: "动作自然。",
      mediaUrl: "https://example.com/product.png",
      origin: "http://localhost:3100",
    })).rejects.toMatchObject({
      code: "LIVE_VIDEO_PROMPT_ROUTE_UNAVAILABLE",
      status: 503,
    });
    expect(mocks.callLlmForScenario).not.toHaveBeenCalled();
  });

  it("rejects an empty generated prompt", async () => {
    mocks.callLlmForScenario.mockResolvedValue({ text: "   " });

    await expect(generateLiveVideoPrompt({
      systemPrompt: "你是商品短视频运动设计师。",
      userPrompt: "动作自然。",
      mediaUrl: "https://example.com/product.png",
      origin: "http://localhost:3100",
    })).rejects.toMatchObject({
      code: "LIVE_VIDEO_PROMPT_EMPTY",
      status: 502,
    });
  });
});
