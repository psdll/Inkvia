import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NANO_BANANA_2_LITE_MODEL,
  buildNanoBanana2LiteKieInput,
  normalizeNanoBanana2LiteAspectRatio,
} from "@/lib/kie-image-lite";
import {
  GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL,
  IMAGE_EDIT_MODEL_DEFINITIONS,
  TOOLBOX_MODEL_DEFINITIONS,
} from "@/lib/toolbox-models";

describe("Kie nano-banana-2-lite mapping", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/prisma");
    vi.resetModules();
  });

  it("builds the exact Kie input fields supported by nano-banana-2-lite", () => {
    const request = buildNanoBanana2LiteKieInput({
      prompt: " Edit this image ",
      imageUrls: [" https://example.com/a.png ", "", "https://example.com/b.webp"],
      aspectRatio: "4:5",
    });

    expect(request).toEqual({
      prompt: "Edit this image",
      image_urls: ["https://example.com/a.png", "https://example.com/b.webp"],
      aspect_ratio: "4:5",
    });
    expect(request).not.toHaveProperty("resolution");
    expect(request).not.toHaveProperty("output_format");
    expect(request).not.toHaveProperty("image_input");
  });

  it("defaults invalid aspect ratio to auto", () => {
    expect(normalizeNanoBanana2LiteAspectRatio("9:21")).toBe("auto");
    expect(normalizeNanoBanana2LiteAspectRatio("21:9")).toBe("21:9");
  });

  it("rejects more than 10 reference images", () => {
    expect(() =>
      buildNanoBanana2LiteKieInput({
        prompt: "Edit",
        imageUrls: Array.from({ length: 11 }, (_, index) => `https://example.com/${index}.png`),
        aspectRatio: "auto",
      })
    ).toThrow("nano-banana-2-lite");
  });

  it("removes the KIE model but retains the Google image model", () => {
    expect(IMAGE_EDIT_MODEL_DEFINITIONS.some((model) => model.id === NANO_BANANA_2_LITE_MODEL)).toBe(false);
    expect(TOOLBOX_MODEL_DEFINITIONS.some((model) => model.id === NANO_BANANA_2_LITE_MODEL)).toBe(false);
    expect(IMAGE_EDIT_MODEL_DEFINITIONS.some((model) => model.id === GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL)).toBe(true);
    expect(TOOLBOX_MODEL_DEFINITIONS.some((model) => model.id === GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL)).toBe(true);
  });

  it("cannot be restored by saved visibility settings and preserves Google visibility controls", async () => {
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
    await expect(getVisibleImageEditModels()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: NANO_BANANA_2_LITE_MODEL })])
    );

    findUnique.mockResolvedValueOnce({ value: JSON.stringify({ [NANO_BANANA_2_LITE_MODEL]: true }) });
    const hiddenModels = await getVisibleImageEditModels();
    expect(hiddenModels.some((model) => model.id === NANO_BANANA_2_LITE_MODEL)).toBe(false);

    findUnique.mockResolvedValueOnce({ value: JSON.stringify({ [GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL]: false }) });
    const hiddenOfficialModels = await getVisibleImageEditModels();
    expect(hiddenOfficialModels.some((model) => model.id === GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL)).toBe(false);
  });
});
