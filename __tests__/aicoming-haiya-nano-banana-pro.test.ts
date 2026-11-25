import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AICOMING_HAIYA_NANO_BANANA_PRO_MODEL_ID,
  AICOMING_HAIYA_NANO_BANANA_PRO_UPSTREAM_MODEL,
  AICOMING_HAIYA_PROVIDER_ID,
} from "@/lib/aicoming-merchant-models";
import { buildAicomingHaiyaNanoBananaProRequest } from "@/lib/aicoming-image";
import { IMAGE_TOOL_MODELS } from "@/lib/generation/task-input-schema";
import { getCanvasImageModelParams } from "@/lib/canvas/image-task";
import { getProviderModelCapability } from "@/lib/providers/model-availability";
import { getBuiltinProviders } from "@/lib/providers/registry";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";

describe("AIComing Haiya nano-banana-pro", () => {
  it("registers one unique local model on the existing Haiya provider", () => {
    expect(AICOMING_HAIYA_NANO_BANANA_PRO_MODEL_ID).toBe("nano-banana-pro-aicoming-haiya");
    expect(AICOMING_HAIYA_NANO_BANANA_PRO_UPSTREAM_MODEL).toBe("nano-banana-pro");
    expect(IMAGE_EDIT_MODEL_DEFINITIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: AICOMING_HAIYA_NANO_BANANA_PRO_MODEL_ID,
        label: "nano-banana-pro（hai）",
        provider: AICOMING_HAIYA_PROVIDER_ID,
        category: "image",
        upstreamModelId: AICOMING_HAIYA_NANO_BANANA_PRO_UPSTREAM_MODEL,
      }),
    ]));

    const provider = getBuiltinProviders().find((item) => item.id === AICOMING_HAIYA_PROVIDER_ID);
    expect(provider?.imageModels).toContain(AICOMING_HAIYA_NANO_BANANA_PRO_UPSTREAM_MODEL);
    expect(getProviderModelCapability(
      AICOMING_HAIYA_PROVIDER_ID,
      "image",
      AICOMING_HAIYA_NANO_BANANA_PRO_UPSTREAM_MODEL,
    )).toMatchObject({ adapterBacked: true });
  });

  it("builds the documented async text-to-image payload without GPT-Image-2-only fields", () => {
    const request = buildAicomingHaiyaNanoBananaProRequest({
      prompt: " city at night ",
      aspectRatio: "16:9",
      resolution: "2K",
      quality: "high",
      requestKey: "haiya-nano-1",
    });

    expect(request).toEqual({
      endpoint: "/images/generations",
      idempotencyKey: "haiya-nano-1",
      body: {
        model: "nano-banana-pro",
        prompt: "city at night",
        aspect_ratio: "16:9",
        image_size: "2K",
        n: 1,
        return_url: true,
        async: true,
      },
    });
    expect(request.body).not.toHaveProperty("size");
    expect(request.body).not.toHaveProperty("quality");
    expect(request.body).not.toHaveProperty("response_format");
  });

  it("uses the same endpoint for image editing and sends public reference URLs in image", () => {
    expect(buildAicomingHaiyaNanoBananaProRequest({
      prompt: "replace the background",
      aspectRatio: "3:4",
      resolution: "4K",
      imageUrls: [
        "https://cdn.test/ref-1.png",
        "https://cdn.test/ref-1.png",
        "not-a-url",
        "https://cdn.test/ref-2.png",
      ],
    })).toMatchObject({
      endpoint: "/images/generations",
      body: {
        model: "nano-banana-pro",
        aspect_ratio: "3:4",
        image_size: "4K",
        image: ["https://cdn.test/ref-1.png", "https://cdn.test/ref-2.png"],
      },
    });
  });

  it("reuses nano-banana-pro parameters across canvas and role tools", () => {
    expect(getCanvasImageModelParams(AICOMING_HAIYA_NANO_BANANA_PRO_MODEL_ID)).toMatchObject({
      aspectRatios: expect.arrayContaining([
        expect.objectContaining({ value: "auto" }),
        expect.objectContaining({ value: "16:9" }),
        expect.objectContaining({ value: "2:3" }),
      ]),
      resolutions: [
        expect.objectContaining({ value: "1K" }),
        expect.objectContaining({ value: "2K" }),
        expect.objectContaining({ value: "4K" }),
      ],
    });
    expect(IMAGE_TOOL_MODELS).toContain(AICOMING_HAIYA_NANO_BANANA_PRO_MODEL_ID);
  });

  it("routes generation through Haiya while keeping the retired Rain model absent", () => {
    const service = readFileSync("lib/generation/image-service.ts", "utf8");
    expect(service).toContain("aicomingHaiyaSubmitNanoBananaPro");
    expect(service).toContain("isAicomingHaiyaNanoBananaPro");
    expect(service).toContain('isAicomingHaiyaNanoBananaPro ? "aicoming-haiya"');
    expect(IMAGE_EDIT_MODEL_DEFINITIONS.map((model) => model.id))
      .not.toContain("nano-banana-pro-aicoming");
  });
});
