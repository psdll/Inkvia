import { describe, expect, it } from "vitest";
import { buildApimartGptImageVariantRequest } from "@/lib/apimart-gpt-image-25";
import { buildOpenRouterImageRequest } from "@/lib/openrouter-image";
import { createImageTaskSchema } from "@/lib/generation/task-input-schema";

describe("GPT Image 2.6 GIF requests", () => {
  it.each(["flare", "sunburst"])("sends APIMart %s animation parameters without static dimensions", (mode) => {
    const request = buildApimartGptImageVariantRequest({
      model: "gpt-image-2.6-apimart", mode, prompt: "cat waving", outputFormat: "gif",
      gifSize: "512x512", frameCount: 9, frameDurationMs: 200,
      aspectRatio: "auto", resolution: "2K", quality: "low", imageUrls: ["https://example.com/cat.png"],
    });
    expect(request).toEqual({
      model: `gpt-image-2.6-${mode}`, prompt: "cat waving", quality: "low", n: 1,
      output_format: "gif", size: "512x512", frame_count: 9, frame_duration_ms: 200,
      image_urls: ["https://example.com/cat.png"],
    });
  });

  it.each(["flare", "sunburst"])("sends OpenRouter %s GIF settings and retains ordered references", (mode) => {
    const input = {
      model: `gpt-image-2.6-${mode}-openrouter`, prompt: "cat waving", outputFormat: "gif",
      gifSize: "512x512", frameCount: 9, frameDurationMs: 200, quality: "low",
      aspectRatio: "16:9", resolution: "4K", imageUrls: ["https://example.com/cat.png"],
    };
    expect(buildOpenRouterImageRequest(input).body).toEqual({
      model: `openai/gpt-image-2.6-${mode}`, prompt: "cat waving", quality: "low", n: 1,
      output_format: "gif", size: "512x512", frame_count: 9, frame_duration_ms: 200,
      input_references: [{ type: "image_url", image_url: { url: "https://example.com/cat.png" } }],
    });
    expect(createImageTaskSchema.parse(input)).toMatchObject({
      outputFormat: "gif", gifSize: "512x512", frameCount: 9, frameDurationMs: 200,
    });
  });

  it("enforces APIMart's frame and sprite-sheet boundaries before submission", () => {
    const input = { model: "gpt-image-2.6-apimart", prompt: "cat", outputFormat: "gif" };
    expect(() => buildApimartGptImageVariantRequest({ ...input, frameCount: 17 })).toThrow(/16/);
    expect(() => buildApimartGptImageVariantRequest({ ...input, gifSize: "1024x1024", frameCount: 2 })).toThrow(/尺寸/);
    expect(() => buildApimartGptImageVariantRequest({ ...input, frameDurationMs: 25 })).toThrow(/10/);
    expect(() => buildApimartGptImageVariantRequest({ ...input, model: "gpt-image-2.5-apimart" })).toThrow(/2.6/);
  });
});


it.each(["512x288", "288x512", "640x432", "768x768", "768x432", "432x768", "768x576", "576x768"])("preserves explicit %s GIF pixels for both providers and both modes", gifSize => {
  for (const mode of ["flare", "sunburst"]) {
    const input = { prompt: "cat waves", gifSize, outputFormat: "gif", frameCount: 9, frameDurationMs: 200, aspectRatio: "1:1", resolution: "4K" };
    const apimart = buildApimartGptImageVariantRequest({ ...input, model: "gpt-image-2.6-apimart", mode });
    const openrouter = buildOpenRouterImageRequest({ ...input, model: `gpt-image-2.6-${mode}-openrouter` }).body;
    for (const body of [apimart, openrouter]) {
      expect(body).toMatchObject({ size: gifSize, output_format: "gif", frame_count: 9, frame_duration_ms: 200, n: 1 });
      expect(body).not.toHaveProperty("resolution");
      expect(body).not.toHaveProperty("aspect_ratio");
    }
  }
});

it("accepts exact APIMart sheet boundaries and rejects overflow without rounding custom pixels", () => {
  const input = { model: "gpt-image-2.6-apimart", prompt: "cat", outputFormat: "gif", frameCount: 9 };
  expect(buildApimartGptImageVariantRequest({ ...input, gifSize: "1280x512" }).size).toBe("1280x512");
  expect(buildApimartGptImageVariantRequest({ ...input, gifSize: "960x960" }).size).toBe("960x960");
  for (const gifSize of ["1296x512", "976x960", "16x512"]) expect(() => buildApimartGptImageVariantRequest({ ...input, gifSize })).toThrow(/尺寸/);
  expect(() => buildApimartGptImageVariantRequest({ ...input, gifSize: "513x288" })).toThrow(/16/);
});

it("selects the largest exact-ratio APIMart GIF frame size for every supported frame count", async () => {
  const { getApimartGptImage26GifMaxSize } = await import("@/lib/gpt-image-26-animation");
  expect(getApimartGptImage26GifMaxSize("1:1", 9)).toBe("960x960");
  expect(getApimartGptImage26GifMaxSize("16:9", 9)).toBe("1280x720");
  expect(getApimartGptImage26GifMaxSize("9:16", 9)).toBe("720x1280");
  expect(getApimartGptImage26GifMaxSize("4:3", 9)).toBe("1088x816");
  expect(getApimartGptImage26GifMaxSize("3:4", 9)).toBe("816x1088");
  for (const ratio of ["1:1", "16:9", "9:16", "4:3", "3:4"]) {
    const [rw, rh] = ratio.split(":").map(Number);
    for (let frames = 2; frames <= 16; frames++) {
      const size = getApimartGptImage26GifMaxSize(ratio, frames)!;
      const [w, h] = size.split("x").map(Number);
      const [c, r] = frames <= 8 ? [4, 2] : frames === 9 ? [3, 3] : frames <= 12 ? [4, 3] : [4, 4];
      const fits = (w: number, h: number) => [[c, r], [r, c]].some(([cols, rows]) => {
        const sw = w * cols, sh = h * rows;
        return sw <= 3840 && sh <= 3840 && sw * sh >= 655360 && sw * sh <= 8294400 && Math.max(sw, sh) / Math.min(sw, sh) <= 3;
      });
      expect(w * rh).toBe(h * rw);
      expect(w % 16).toBe(0);
      expect(h % 16).toBe(0);
      expect(fits(w, h)).toBe(true);
      expect(fits(w + rw * 16, h + rh * 16)).toBe(false);
      const mediumSize = getApimartGptImage26GifMaxSize(ratio, frames, 768)!;
      const [mw, mh] = mediumSize.split("x").map(Number);
      expect(Math.max(mw, mh)).toBeLessThanOrEqual(768);
      expect(mw * rh).toBe(mh * rw);
      expect(mw % 16).toBe(0);
      expect(mh % 16).toBe(0);
      expect(fits(mw, mh)).toBe(true);
      expect(buildApimartGptImageVariantRequest({ model: "gpt-image-2.6-apimart", prompt: "cat", outputFormat: "gif", gifSize: size, frameCount: frames }).size).toBe(size);
    }
  }
  expect(getApimartGptImage26GifMaxSize("16:9", 0)).toBeNull();
  expect(getApimartGptImage26GifMaxSize("16:9", 17)).toBeNull();
});
