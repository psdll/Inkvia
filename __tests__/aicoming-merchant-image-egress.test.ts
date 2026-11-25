import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  axiosWithProviderEgress: vi.fn(),
  fetchWithProviderEgress: vi.fn(),
  resolveProviderRequestContext: vi.fn(),
}));

vi.mock("@/lib/providers/transport", () => ({
  axiosWithProviderEgress: mocks.axiosWithProviderEgress,
  fetchWithProviderEgress: mocks.fetchWithProviderEgress,
  resolveProviderRequestContext: mocks.resolveProviderRequestContext,
}));

import {
  aicomingHaiyaGetImageTask,
  aicomingHaiyaSubmitImage,
  aicomingHaiyaGenerateGptImage25,
  aicomingHaiyaSubmitNanoBananaPro,
} from "@/lib/aicoming-image";

function context(id: string) {
  return {
    provider: {
      id,
      name: id,
      baseUrl: `https://saved-${id}.example/v1/`,
      apiKey: `saved-${id}-key`,
    },
    decision: { providerId: id, mode: "direct", cacheKey: "direct" },
  };
}

describe("AIComing merchant image egress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProviderRequestContext.mockImplementation(async (id: string) => context(id));
  });

  it("submits and polls Haiya through its independent saved URL, key and direct egress", async () => {
    mocks.fetchWithProviderEgress
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "haiya-task", status: "processing" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "haiya-task",
        status: "completed",
        data: [{ url: "https://cdn.test/haiya.png" }],
      }), { status: 200 }));

    await expect(aicomingHaiyaSubmitImage({
      prompt: "draw",
      resolution: "2K",
      aspectRatio: "16:9",
      requestKey: "haiya-request-1",
    })).resolves.toMatchObject({ taskId: "haiya-task" });
    await expect(aicomingHaiyaGetImageTask("haiya-task"))
      .resolves.toMatchObject({ status: "completed" });

    expect(mocks.resolveProviderRequestContext).toHaveBeenNthCalledWith(1, "aicoming-haiya");
    expect(mocks.fetchWithProviderEgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ providerId: "aicoming-haiya", mode: "direct" }),
      "https://saved-aicoming-haiya.example/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer saved-aicoming-haiya-key",
          "Idempotency-Key": "haiya-request-1",
        }),
      }),
    );
    expect(mocks.fetchWithProviderEgress.mock.calls[1][1])
      .toBe("https://saved-aicoming-haiya.example/v1/images/generations/haiya-task");
  });

  it.each(["flare", "sunburst"])("generates %s synchronously with saved credentials and accepts URL/Base64 results", async (mode) => {
    const quality = mode === "flare" ? "xhigh" : "max";
    for (const [data, image] of [[{ url: "https://cdn.test/result.png" }, "https://cdn.test/result.png"], [{ b64_json: "aW1hZ2U=" }, "data:image/png;base64,aW1hZ2U="]] as const) {
      mocks.axiosWithProviderEgress.mockResolvedValueOnce({ status: 200, data: { data: [data] } });
      await expect(aicomingHaiyaGenerateGptImage25({ prompt: "edit", mode, quality, aspectRatio: "1:1", resolution: "1K", imageUrls: ["https://example.com/ref.png"], requestKey: "same-key" })).resolves.toMatchObject({ images: [image] });
    }
    expect(mocks.axiosWithProviderEgress).toHaveBeenCalledTimes(2);
    expect(mocks.fetchWithProviderEgress).not.toHaveBeenCalled();
    for (const [decision, config] of mocks.axiosWithProviderEgress.mock.calls) {
      expect(decision).toMatchObject({ providerId: "aicoming-haiya", mode: "direct" });
      expect(config.url).toBe("https://saved-aicoming-haiya.example/v1/images/generations");
      expect(config.timeout).toBe(610000);
      expect(config.headers).toEqual({ Authorization: "Bearer saved-aicoming-haiya-key", "Content-Type": "application/json", "Idempotency-Key": "same-key" });
      expect(config.data).toEqual({ model: `gpt-image-2.5-${mode}`, prompt: "edit", size: "1024x1024", quality, n: 1, image: ["https://example.com/ref.png"] });
      expect(config.data).not.toHaveProperty("async");
    }
  });

  it("never resubmits a synchronous generation after an uncertain connection failure", async () => {
    mocks.axiosWithProviderEgress.mockRejectedValueOnce(new Error("connection reset"));
    await expect(aicomingHaiyaGenerateGptImage25({ prompt: "photo" })).rejects.toThrow(/结果未知/);
    expect(mocks.axiosWithProviderEgress).toHaveBeenCalledTimes(1);
  });

  it.each([400, 503])("surfaces an HTTP %i error without a second paid submission", async (status) => {
    mocks.axiosWithProviderEgress.mockResolvedValueOnce({ status, data: { error: { message: "provider rejected" } } });
    await expect(aicomingHaiyaGenerateGptImage25({ prompt: "photo" })).rejects.toThrow("provider rejected");
    expect(mocks.axiosWithProviderEgress).toHaveBeenCalledTimes(1);
  });

  it("submits nano-banana-pro through the same saved Haiya account", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "haiya-nano-task", status: "processing" }), { status: 202 }),
    );

    await expect(aicomingHaiyaSubmitNanoBananaPro({
      prompt: "edit",
      resolution: "4K",
      aspectRatio: "3:4",
      imageUrls: ["https://cdn.test/reference.png"],
      requestKey: "haiya-nano-request-1",
    })).resolves.toMatchObject({ taskId: "haiya-nano-task" });

    expect(mocks.resolveProviderRequestContext).toHaveBeenCalledWith("aicoming-haiya");
    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "aicoming-haiya", mode: "direct" }),
      "https://saved-aicoming-haiya.example/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer saved-aicoming-haiya-key",
          "Idempotency-Key": "haiya-nano-request-1",
        }),
        body: JSON.stringify({
          model: "nano-banana-pro",
          prompt: "edit",
          aspect_ratio: "3:4",
          image_size: "4K",
          n: 1,
          return_url: true,
          async: true,
          image: ["https://cdn.test/reference.png"],
        }),
      }),
    );
  });
});
