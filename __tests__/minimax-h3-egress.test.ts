import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchWithProviderEgress: vi.fn(),
  resolveProviderRequestContext: vi.fn(),
}));

vi.mock("@/lib/providers/transport", () => ({
  fetchWithProviderEgress: mocks.fetchWithProviderEgress,
  resolveProviderRequestContext: mocks.resolveProviderRequestContext,
}));

import { miniMaxGetVideoTask, miniMaxSubmitVideo } from "@/lib/minimax-video";

describe("MiniMax-H3 official egress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProviderRequestContext.mockResolvedValue({
      provider: {
        id: "minimax",
        name: "MiniMax 官方",
        baseUrl: "https://saved-minimax.example/",
        apiKey: "saved-minimax-key",
      },
      decision: { providerId: "minimax", mode: "direct", cacheKey: "direct" },
    });
  });

  it("submits and polls through the saved direct provider context", async () => {
    mocks.fetchWithProviderEgress
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: "h3-task" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        task: {
          id: "h3-task",
          model: "MiniMax-H3",
          status: "succeeded",
          content: { url: "https://cdn.test/h3.mp4" },
        },
      }), { status: 200 }));

    await expect(miniMaxSubmitVideo({
      prompt: "city",
      inputMode: "text_to_video",
      resolution: "768p",
      ratio: "16:9",
      duration: 5,
      watermark: false,
      media: [],
    })).resolves.toMatchObject({ taskId: "h3-task" });
    await expect(miniMaxGetVideoTask("h3-task"))
      .resolves.toMatchObject({ task: { status: "succeeded" } });

    expect(mocks.resolveProviderRequestContext).toHaveBeenNthCalledWith(1, "minimax");
    expect(mocks.fetchWithProviderEgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ providerId: "minimax", mode: "direct" }),
      "https://saved-minimax.example/v2/video_generation",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer saved-minimax-key",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(mocks.fetchWithProviderEgress.mock.calls[0][2].headers).not.toHaveProperty("Idempotency-Key");
    expect(mocks.fetchWithProviderEgress.mock.calls[1][1])
      .toBe("https://saved-minimax.example/v2/query/video_generation/h3-task");
  });

  it("does not retry an undocumented non-idempotent create request", async () => {
    mocks.fetchWithProviderEgress.mockRejectedValueOnce(new Error("socket reset"));

    await expect(miniMaxSubmitVideo({
      prompt: "city",
      inputMode: "text_to_video",
      resolution: "768p",
      ratio: "16:9",
      duration: 5,
      watermark: false,
      media: [],
    })).rejects.toThrow("socket reset");
    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledTimes(1);
  });

  it("preserves the official HTTP status without leaking the saved key", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { message: "saved-minimax-key sensitive input" },
    }), { status: 422 }));

    const request = miniMaxSubmitVideo({
      prompt: "city",
      inputMode: "text_to_video",
      resolution: "768p",
      ratio: "16:9",
      duration: 5,
      watermark: false,
      media: [],
    });

    await expect(request).rejects.toMatchObject({ statusCode: 422 });
    await expect(request).rejects.not.toThrow("saved-minimax-key");
  });
});
