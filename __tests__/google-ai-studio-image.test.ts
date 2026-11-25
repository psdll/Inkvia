import { describe, expect, it } from "vitest";
import { buildGoogleAiStudioImageRequest, isGoogleAiStudioImageModel } from "@/lib/google-ai-studio-image";
import { GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL } from "@/lib/toolbox-models";
import { createImageTaskSchema } from "@/lib/generation/task-input-schema";

describe("Google AI Studio nano-banana-2-lite official mapping", () => {
  it("recognizes the official lite model id", () => {
    expect(isGoogleAiStudioImageModel(GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL)).toBe(true);
  });

  it("builds image generation config with 1K output", () => {
    const request = buildGoogleAiStudioImageRequest({
      prompt: "A clean product photo",
      aspectRatio: "4:5",
      resolution: "1K",
    });

    expect(request).toMatchObject({
      contents: [{ role: "user", parts: [{ text: "A clean product photo" }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: "4:5",
          imageSize: "1K",
        },
      },
    });
  });

  it("limits official lite agent image inputs to 10 references", () => {
    const parsed = createImageTaskSchema.safeParse({
      prompt: "Edit",
      model: GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL,
      imagePaths: Array.from({ length: 11 }, (_, index) => `uploads/${index}.png`),
    });

    expect(parsed.success).toBe(false);
  });
});
