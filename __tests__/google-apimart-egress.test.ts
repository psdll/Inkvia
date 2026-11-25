import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  axiosWithProviderEgress: vi.fn(),
  directAxios: vi.fn(),
  fetchWithProviderEgress: vi.fn(),
  resolveProviderRequestContext: vi.fn(),
}));

vi.mock("@/lib/providers/transport", () => ({
  axiosWithProviderEgress: mocks.axiosWithProviderEgress,
  directAxios: mocks.directAxios,
  fetchWithProviderEgress: mocks.fetchWithProviderEgress,
  resolveProviderRequestContext: mocks.resolveProviderRequestContext,
}));

import { apimartGetTask, apimartSubmitImage, apimartSubmitGptImageVariant } from "@/lib/apimart-image";
import {
  APIMART_SEEDANCE_FACE_MODEL,
  apimartSubmitVideo,
} from "@/lib/apimart-video";
import { googleAiStudioGenerateImage } from "@/lib/google-ai-studio-image";
import { GOOGLE_AI_STUDIO_FLASH_IMAGE_MODEL } from "@/lib/image-edit-models";

describe("Google AI Studio and APIMart provider egress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProviderRequestContext.mockImplementation(async (id: string) => {
      if (id === "google-ai-studio") {
        return {
          provider: {
            id,
            name: "Google AI Studio",
            baseUrl: "https://saved-google.example/api",
            apiKey: "saved-google-key",
          },
          decision: {
            providerId: id,
            mode: "proxy",
            cacheKey: "google-proxy",
            agentSlot: "database",
            proxyUri: "http://proxy.example:8080",
          },
        };
      }
      if (id === "apimart") {
        return {
          provider: {
            id,
            name: "APIMart",
            baseUrl: "https://saved-apimart.example/v1",
            apiKey: "saved-apimart-key",
          },
          decision: {
            providerId: id,
            mode: "proxy",
            cacheKey: "apimart-proxy",
            agentSlot: "database",
            proxyUri: "http://proxy.example:8080",
          },
        };
      }
      throw new Error(`unexpected provider ${id}`);
    });
  });

  it.each([["2.5", "flare"], ["2.5", "sunburst"], ["2.6", "flare"], ["2.6", "sunburst"]])("sends GPT Image %s %s through the saved APIMart transport and parses its task ID", async (version, mode) => {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(JSON.stringify({ code: 200, data: [{ status: "submitted", task_id: `task-${mode}` }] }), { status: 200 }));
    const result = await apimartSubmitGptImageVariant({ model: `gpt-image-${version}-apimart`, prompt: "photo", mode, background: "transparent", outputFormat: "png", quality: "xhigh", resolution: "2K", aspectRatio: "4:5" });
    expect(result.taskId).toBe(`task-${mode}`);
    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledWith(expect.objectContaining({ providerId: "apimart", mode: "proxy" }), "https://saved-apimart.example/v1/images/generations", expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer saved-apimart-key", "Content-Type": "application/json" } }));
    expect(JSON.parse(mocks.fetchWithProviderEgress.mock.calls[0][2].body)).toEqual({ model: `gpt-image-${version}-${mode}`, prompt: "photo", background: "transparent", output_format: "png", quality: "xhigh", resolution: "2k", size: "4:5", n: 1 });
  });

  it("uses one Google snapshot for the saved endpoint, key, and proxy decision", async () => {
    mocks.axiosWithProviderEgress.mockResolvedValue({
      status: 200,
      data: {
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }] } }],
      },
    });

    const result = await googleAiStudioGenerateImage({
      model: GOOGLE_AI_STUDIO_FLASH_IMAGE_MODEL,
      prompt: "draw",
    });

    expect(result.images).toEqual(["data:image/png;base64,aW1hZ2U="]);
    expect(mocks.axiosWithProviderEgress).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "google-ai-studio", mode: "proxy", cacheKey: "google-proxy" }),
      expect.objectContaining({
        url: `https://saved-google.example/api/v1beta/models/${encodeURIComponent(GOOGLE_AI_STUDIO_FLASH_IMAGE_MODEL)}:generateContent`,
        params: { key: "saved-google-key" },
        timeout: 120000,
      }),
    );
  });

  it("downloads a user reference image directly without the provider proxy", async () => {
    mocks.directAxios.mockResolvedValue({
      data: Buffer.from("reference"),
      headers: { "content-type": "image/webp" },
    });
    mocks.axiosWithProviderEgress.mockResolvedValue({
      status: 200,
      data: {
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "b3V0" } }] } }],
      },
    });

    await googleAiStudioGenerateImage({
      model: GOOGLE_AI_STUDIO_FLASH_IMAGE_MODEL,
      prompt: "edit",
      imageUrls: ["https://user-content.example/reference.webp"],
    });

    expect(mocks.directAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://user-content.example/reference.webp",
        method: "GET",
        responseType: "arraybuffer",
        timeout: 45000,
        proxy: false,
      }),
      { purpose: "media" },
    );
    expect(mocks.axiosWithProviderEgress).toHaveBeenCalledTimes(1);
  });

  it("routes APIMart submit and polling with their matching saved snapshot", async () => {
    mocks.fetchWithProviderEgress
      .mockResolvedValueOnce(new Response(JSON.stringify({ task_id: "task-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed" }), { status: 200 }));

    await apimartSubmitImage({ prompt: "draw" });
    await apimartGetTask("task-1");

    expect(mocks.fetchWithProviderEgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ providerId: "apimart", mode: "proxy", cacheKey: "apimart-proxy" }),
      "https://saved-apimart.example/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer saved-apimart-key" }),
      }),
    );
    expect(mocks.fetchWithProviderEgress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ providerId: "apimart", mode: "proxy", cacheKey: "apimart-proxy" }),
      "https://saved-apimart.example/v1/tasks/task-1?language=zh",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer saved-apimart-key" },
      }),
    );
  });

  it("routes APIMart video using its saved provider configuration", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValueOnce(Response.json({ task_id: "video-task" }));
    const submission = await apimartSubmitVideo({ model: APIMART_SEEDANCE_FACE_MODEL, prompt: "video" });

    expect(submission.taskId).toBe("video-task");
    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledOnce();
    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "apimart", mode: "proxy" }),
      "https://saved-apimart.example/v1/videos/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer saved-apimart-key" }),
      }),
    );
  });

  it("does not expose reflected Google credentials or endpoint URLs in errors", async () => {
    mocks.axiosWithProviderEgress.mockResolvedValue({
      status: 502,
      data: {
        error: {
          message: "Bearer saved-google-key https://saved-google.example/api/v1beta/models/private",
        },
      },
    });

    const error = await googleAiStudioGenerateImage({
      model: GOOGLE_AI_STUDIO_FLASH_IMAGE_MODEL,
      prompt: "draw",
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error?.message)).not.toContain("saved-google-key");
    expect(String(error?.message)).not.toContain("saved-google.example");
  });

  it("does not expose reflected APIMart credentials or endpoint URLs in errors", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(new Response(JSON.stringify({
      error: {
        message: "Bearer saved-apimart-key https://saved-apimart.example/v1/images/generations",
      },
    }), { status: 502 }));

    const error = await apimartSubmitImage({ prompt: "draw" }).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error?.message)).not.toContain("saved-apimart-key");
    expect(String(error?.message)).not.toContain("saved-apimart.example");
  });
});
