import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JIEKOU_GPT_IMAGE_2_MODEL_ID,
  buildJiekouGptImage2Request,
  extractJiekouImageUrls,
  mapJiekouGptImage2Size,
} from "@/lib/jiekou-image";
import { IMAGE_EDIT_MODEL_DEFINITIONS, TOOLBOX_MODEL_DEFINITIONS } from "@/lib/toolbox-models";

describe("Jiekou GPT-Image-2 premium mapping", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/prisma");
    vi.resetModules();
  });

  it("builds the text-to-image request with documented parameter names", () => {
    const request = buildJiekouGptImage2Request({
      prompt: " A clean product photo ",
      aspectRatio: "16:9",
      resolution: "4K",
      quality: "high",
      background: "opaque",
      moderation: "low",
      outputFormat: "jpeg",
      n: 10,
    });

    expect(request).toMatchObject({
      endpoint: "/v3/gpt-image-2-text-to-image",
      providerModel: "gpt-image-2-text-to-image",
      body: {
        n: 10,
        size: "3840x2160",
        prompt: "A clean product photo",
        quality: "high",
        background: "opaque",
        moderation: "low",
        output_format: "jpeg",
      },
    });
    expect(request.body).not.toHaveProperty("image");
    expect(request.body).not.toHaveProperty("mask");
    expect(request.body).not.toHaveProperty("output_compression");
  });

  it("builds the edit request with image and optional mask only for edit mode", () => {
    const request = buildJiekouGptImage2Request({
      prompt: "Edit this image",
      aspectRatio: "9:21",
      resolution: "2K",
      quality: "medium",
      background: "auto",
      moderation: "low",
      outputFormat: "png",
      n: 3,
      imageUrls: [" https://example.com/a.png ", "", "https://example.com/b.webp"],
      maskUrl: " https://example.com/mask.png ",
    });

    expect(request).toMatchObject({
      endpoint: "/v3/gpt-image-2-edit",
      providerModel: "gpt-image-2-edit",
      body: {
        n: 3,
        size: "880x2048",
        prompt: "Edit this image",
        quality: "medium",
        background: "auto",
        output_format: "png",
        image: ["https://example.com/a.png", "https://example.com/b.webp"],
        mask: "https://example.com/mask.png",
      },
    });
    expect(request.body).not.toHaveProperty("moderation");
    expect(request.body).not.toHaveProperty("output_compression");
  });

  it("normalizes invalid values to documented defaults", () => {
    const request = buildJiekouGptImage2Request({
      prompt: "Poster",
      aspectRatio: "5:4",
      resolution: "8K",
      quality: "auto",
      background: "transparent",
      moderation: "strict",
      outputFormat: "webp",
      n: 20,
    });

    expect(request.body).toMatchObject({
      n: 10,
      size: "1024x1024",
      quality: "medium",
      background: "auto",
      moderation: "auto",
      output_format: "png",
    });
    expect(mapJiekouGptImage2Size("auto", "4K")).toBe("auto");
  });

  it("extracts generated image urls", () => {
    expect(extractJiekouImageUrls({ images: ["https://example.com/a.png", "", "https://example.com/a.png"] })).toEqual([
      "https://example.com/a.png",
    ]);
  });

  it("stays absent from toolbox even with saved visibility enabled", async () => {
    expect(IMAGE_EDIT_MODEL_DEFINITIONS.some((model) => model.id === JIEKOU_GPT_IMAGE_2_MODEL_ID)).toBe(false);
    expect(TOOLBOX_MODEL_DEFINITIONS.some((model) => model.id === JIEKOU_GPT_IMAGE_2_MODEL_ID)).toBe(false);

    vi.resetModules();
    const findUnique = vi.fn();
    vi.doMock("@/lib/prisma", () => ({
      default: {
        appSetting: {
          findUnique,
        },
      },
    }));
    const { getVisibleImageEditModels } = await import("@/lib/image-edit-models");

    findUnique.mockResolvedValueOnce(null);
    await expect(getVisibleImageEditModels()).resolves.toEqual(
      expect.not.arrayContaining([expect.objectContaining({ id: JIEKOU_GPT_IMAGE_2_MODEL_ID })])
    );

    findUnique.mockResolvedValueOnce({ value: JSON.stringify({ [JIEKOU_GPT_IMAGE_2_MODEL_ID]: true }) });
    const hiddenModels = await getVisibleImageEditModels();
    expect(hiddenModels.some((model) => model.id === JIEKOU_GPT_IMAGE_2_MODEL_ID)).toBe(false);
  });
});
