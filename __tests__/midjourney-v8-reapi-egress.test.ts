import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchWithProviderEgress: vi.fn(),
  resolveProviderRequestContext: vi.fn(),
}));

vi.mock("@/lib/providers/transport", () => ({
  fetchWithProviderEgress: mocks.fetchWithProviderEgress,
  resolveProviderRequestContext: mocks.resolveProviderRequestContext,
}));

import { reapiSubmitMidjourneyV8 } from "@/lib/reapi-midjourney-v8";

describe("reAPI Midjourney V8.2 egress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProviderRequestContext.mockResolvedValue({
      provider: {
        id: "reapi",
        name: "reAPI",
        baseUrl: "https://saved-reapi.example/api/v1/",
        apiKey: "saved-reapi-key",
      },
      decision: { providerId: "reapi", mode: "direct", cacheKey: "direct" },
    });
  });

  it("uses the saved reAPI provider and submits one exact edits request", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValueOnce(new Response(JSON.stringify({
      data: [{ task_id: "mj-task-82" }],
    }), { status: 200 }));

    await expect(reapiSubmitMidjourneyV8({
      prompt: "edit this",
      aspectRatio: "16:9",
      speed: "turbo",
      imageUrls: ["https://cdn.test/reference.png"],
    })).resolves.toMatchObject({ taskId: "mj-task-82" });

    expect(mocks.resolveProviderRequestContext).toHaveBeenCalledOnce();
    expect(mocks.resolveProviderRequestContext).toHaveBeenCalledWith("reapi");
    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledOnce();
    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "reapi", mode: "direct" }),
      "https://saved-reapi.example/api/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer saved-reapi-key" }),
        body: JSON.stringify({
          model: "midjourney",
          action: "edits",
          prompt: "edit this",
          version: "8.2",
          size: "16:9",
          speed: "turbo",
          image_urls: ["https://cdn.test/reference.png"],
        }),
      }),
    );
  });

  it("does not retry an ambiguous POST", async () => {
    mocks.fetchWithProviderEgress.mockRejectedValueOnce(new Error("ECONNRESET"));

    await expect(reapiSubmitMidjourneyV8({ prompt: "draw" })).rejects.toThrow("ECONNRESET");
    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledOnce();
  });
});
