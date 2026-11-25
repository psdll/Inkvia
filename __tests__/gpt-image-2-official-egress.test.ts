import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchWithProviderEgress: vi.fn(),
  resolveProviderRequestContext: vi.fn(),
}));

vi.mock("@/lib/providers/transport", () => ({
  fetchWithProviderEgress: mocks.fetchWithProviderEgress,
  resolveProviderRequestContext: mocks.resolveProviderRequestContext,
}));

import {
  reapiGetImageTask,
  reapiSubmitImage,
  reapiSubmitGptImage25,
} from "@/lib/reapi-image";

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

describe("GPT-Image-2 official provider egress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProviderRequestContext.mockImplementation(async (id: string) => context(id));
  });

  it.each(["flare", "sunburst"])("reports the Cloudflare block for %s without leaking HTML or retrying", async (mode) => {
    mocks.fetchWithProviderEgress.mockResolvedValueOnce(new Response(
      '<!DOCTYPE html><html><title>Attention Required! | Cloudflare</title><body>client details</body></html>',
      { status: 403, headers: { "content-type": "text/html", "cf-ray": "a3defa660cedfb97-AMS" } },
    ));
    const error = await reapiSubmitGptImage25({ prompt: "chair", mode, background: "transparent", outputFormat: "png" }).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Cloudflare 网关拦截");
    expect((error as Error).message).toContain("HTTP 403");
    expect((error as Error).message).toContain("a3defa660cedfb97-AMS");
    expect((error as Error).message).not.toMatch(/<html|DOCTYPE|client details/);
    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledTimes(1);
  });

  it("identifies HTML during task polling instead of returning a pending task", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValueOnce(new Response("<html>maintenance</html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(reapiGetImageTask("existing-task")).rejects.toThrow("网页而非 API 数据");
  });

  it("preserves real JSON parameter errors", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "INVALID_REQUEST: size is invalid" } }), { status: 400 }));
    await expect(reapiSubmitGptImage25({ prompt: "chair" })).rejects.toThrow("INVALID_REQUEST: size is invalid");
  });

  it.each(["flare", "sunburst"])("submits 2.5 %s with explicit pixels, stored key and no async field", async (mode) => {
    mocks.fetchWithProviderEgress.mockResolvedValueOnce(new Response(JSON.stringify({ id: "task_25", status: "pending" }), { status: 200 }));
    await expect(reapiSubmitGptImage25({ prompt: "edit", mode, background: "transparent", outputFormat: "webp", quality: "xhigh", resolution: "2K", aspectRatio: "9:16", imageUrls: ["https://example.com/ref.png"] })).resolves.toMatchObject({ taskId: "task_25" });
    const [decision, url, init] = mocks.fetchWithProviderEgress.mock.calls[0];
    expect(decision).toMatchObject({ providerId: "reapi", mode: "direct" });
    expect(url).toBe("https://saved-reapi.example/v1/images/generations");
    expect(init.headers.Authorization).toBe("Bearer saved-reapi-key");
    expect(JSON.parse(init.body)).toEqual({ model: `gpt-image-2.5-${mode}-official`, prompt: "edit", background: "transparent", output_format: "webp", size: "1536x2720", quality: "xhigh", n: 1, image_urls: ["https://example.com/ref.png"] });
    mocks.fetchWithProviderEgress.mockReset().mockRejectedValueOnce(new Error("connection reset"));
    await expect(reapiSubmitGptImage25({ prompt: "edit", mode })).rejects.toThrow();
    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledTimes(1);
  });

  it("submits and polls reAPI through its configured egress without retrying an ambiguous POST", async () => {
    mocks.fetchWithProviderEgress
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "re-task", status: "processing" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "re-task",
        status: "completed",
        output: { image_urls: ["https://cdn.test/re.png"] },
      }), { status: 200 }));

    await expect(reapiSubmitImage({ prompt: "draw", resolution: "2K" }))
      .resolves.toMatchObject({ taskId: "re-task" });
    await expect(reapiGetImageTask("re-task"))
      .resolves.toMatchObject({ status: "completed" });

    expect(mocks.resolveProviderRequestContext).toHaveBeenCalledWith("reapi");
    expect(mocks.fetchWithProviderEgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ providerId: "reapi" }),
      "https://saved-reapi.example/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer saved-reapi-key" }),
      }),
    );
    expect(mocks.fetchWithProviderEgress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ providerId: "reapi" }),
      "https://saved-reapi.example/v1/tasks/re-task",
      expect.objectContaining({ method: "GET" }),
    );

    mocks.fetchWithProviderEgress.mockReset().mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(reapiSubmitImage({ prompt: "draw" })).rejects.toThrow();
    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledOnce();
  });

});
