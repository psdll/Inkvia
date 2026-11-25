import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ default: { appSetting: { findUnique: vi.fn(async () => null) } } }));
vi.mock("@/lib/providers/transport", () => ({ resolveProviderRequestContext: vi.fn(), fetchWithProviderEgress: vi.fn() }));
import { buildOpenRouterImageRequest, openRouterGenerateImage } from "@/lib/openrouter-image";
import { OPENROUTER_IMAGE_MODELS, getOpenRouterImageParams, mapOpenRouterGptImagePixels, getOpenRouterResolutionDisplayOptions } from "@/lib/openrouter-image-params";
import { fetchWithProviderEgress, resolveProviderRequestContext } from "@/lib/providers/transport";
import { getBuiltinProviders, getRegisteredProviders } from "@/lib/providers/registry";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { getImageModelParams } from "@/lib/generation/image-model-params";
import { createImageTaskSchema } from "@/lib/generation/task-input-schema";
import { supportsProviderModelFetch } from "@/lib/providers/model-fetch";

describe("OpenRouter image contract", () => {
  it.each(["flare", "sunburst"])("registers GPT Image 2.6 %s with its own upstream route", (mode) => {
    const model = `gpt-image-2.6-${mode}-openrouter`;
    const upstreamModel = `openai/gpt-image-2.6-${mode}`;
    const reference = "https://example.com/cup.png";
    const input = { model, prompt: "cup", aspectRatio: "1:1", resolution: "1K", quality: "xhigh", background: "transparent" };
    const expected = { model: upstreamModel, prompt: "cup", size: "1024x1024", quality: "xhigh", background: "transparent", output_format: "png", n: 1 };
    expect(buildOpenRouterImageRequest(input)).toMatchObject({ endpoint: "/images", body: expected });
    expect(buildOpenRouterImageRequest({ ...input, imageUrls: [reference] }).body).toEqual({
      ...expected, input_references: [{ type: "image_url", image_url: { url: reference } }],
    });
    expect(getOpenRouterImageParams(model).aspectRatios.map(option => option.value))
      .toEqual(["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"]);
    expect(createImageTaskSchema.parse({ model, prompt: "cup", quality: "xhigh" })).toMatchObject({ model, quality: "xhigh" });
  });
  for (const model of OPENROUTER_IMAGE_MODELS) {
    it(`${model.id}: prompt-only and ordered reference requests match the Images API`, () => {
      const input = { model: model.id, prompt: "测试", quality: "max", resolution: "4K", aspectRatio: "16:9" };
      const plain = buildOpenRouterImageRequest(input);
      const refs = ["https://example.com/one.png", "data:image/jpeg;base64,YQ=="];
      const edit = buildOpenRouterImageRequest({ ...input, imageUrls: refs });
      expect(plain.endpoint).toBe("/images");
      expect(plain.body).toMatchObject({ model: model.upstreamModelId, prompt: "测试", n: 1 });
      expect(plain.body).not.toHaveProperty("input_references");
      expect(edit.body.input_references?.map(item => item.image_url.url)).toEqual(refs);
      for (const forbidden of ["response_format", "messages", "modalities", "image"]) expect(edit.body).not.toHaveProperty(forbidden);
      if (model.upstreamModelId.startsWith("google/")) {
        expect(plain.body).toHaveProperty("aspect_ratio", "16:9"); expect(plain.body).not.toHaveProperty("size"); expect(plain.body).toHaveProperty("resolution", "4K"); if (model.id === "gemini-nano-banana-2.1-openrouter") expect(plain.body).not.toHaveProperty("provider"); else expect(plain.body.provider).toEqual({ only: ["google-ai-studio/global"], allow_fallbacks: false }); expect(plain.body).not.toHaveProperty("quality"); expect(plain.body).not.toHaveProperty("background");
      } else {
        expect(plain.body).toHaveProperty("size", "3840x2160"); expect(plain.body).not.toHaveProperty("aspect_ratio"); expect(plain.body).toMatchObject({ output_format: "png" });
        const supportsAdvancedSettings = model.upstreamModelId !== "openai/gpt-image-2";
        if (supportsAdvancedSettings) expect(plain.body).toHaveProperty("background", "auto");
        else expect(plain.body).not.toHaveProperty("background"); expect(plain.body).not.toHaveProperty("resolution"); expect(plain.body).not.toHaveProperty("provider");
        expect(plain.body).toHaveProperty("quality", supportsAdvancedSettings ? "max" : "medium");
      }
      expect(getImageModelParams(model.id)).toEqual(getOpenRouterImageParams(model.id));
    });
    it(`${model.id}: accepts the documented reference boundary and rejects excess/masks`, () => {
      const limit = getOpenRouterImageParams(model.id).maxReferences;
      const input = { model: model.id, prompt: "test", imageUrls: Array(limit).fill("https://example.com/ref.png") };
      expect(buildOpenRouterImageRequest(input).body.input_references).toHaveLength(limit);
      expect(() => buildOpenRouterImageRequest({ ...input, imageUrls: [...input.imageUrls, input.imageUrls[0]] })).toThrow(`最多支持 ${limit}`);
      expect(() => buildOpenRouterImageRequest({ ...input, maskUrl: "https://example.com/mask.png" })).toThrow("遮罩");
    });
  }
  it.each(["gpt-image-2.5-sunburst-openrouter", "gpt-image-2.5-flare-openrouter"])("%s preserves transparent backgrounds and rejects JPEG", (model) => {
    expect(buildOpenRouterImageRequest({ model, prompt: "chair", background: "transparent" }).body).toMatchObject({ background: "transparent", output_format: "png" });
    expect(buildOpenRouterImageRequest({ model, prompt: "chair", background: "transparent", outputFormat: "webp" }).body).toMatchObject({ background: "transparent", output_format: "webp" });
    expect(() => buildOpenRouterImageRequest({ model, prompt: "chair", background: "transparent", outputFormat: "jpeg" })).toThrow("JPEG");
  });
  it("offers only the model-specific background choices", () => {
    expect(getOpenRouterImageParams("gpt-image-2-openrouter").backgrounds).toEqual([]);
    for (const background of [undefined, "auto", "opaque", "transparent"]) {
      expect(buildOpenRouterImageRequest({ model: "gpt-image-2-openrouter", prompt: "chair", background }).body).not.toHaveProperty("background");
    }
    expect(getOpenRouterImageParams("gemini-3-pro-image-openrouter").backgrounds).toEqual([]);
  });
  it("maps every GPT ratio/tier to valid explicit pixels without conflicting normalized dimensions", () => {
    for (const model of OPENROUTER_IMAGE_MODELS.filter(m => m.upstreamModelId.startsWith("openai/"))) {
      for (const ratio of getOpenRouterImageParams(model.id).aspectRatios.filter(o => o.value !== "auto")) {
        for (const resolution of ["1K", "2K", "4K"]) {
          const request = buildOpenRouterImageRequest({ model: model.id, prompt: "chair", aspectRatio: ratio.value, resolution });
          const [w, h] = mapOpenRouterGptImagePixels(ratio.value, resolution).split("x").map(Number);
          expect(request.body).toHaveProperty("size", `${w}x${h}`);
          expect(request.body).not.toHaveProperty("aspect_ratio");
          expect(request.body).not.toHaveProperty("resolution");
          expect(Math.max(w, h)).toBeLessThanOrEqual(3840);
          expect(w % 16).toBe(0); expect(h % 16).toBe(0);
          expect(w * h).toBeGreaterThanOrEqual(655360); expect(w * h).toBeLessThanOrEqual(8294400);
          const [rw, rh] = ratio.value.split(":").map(Number);
          expect(w / h).toBeCloseTo(rw / rh, 8);
          expect(request.settings).toEqual({ aspectRatio: ratio.value, resolution });
        }
      }
    }
  });
  it("preserves the selected tier with adaptive GPT aspect ratio and omits Gemini ratio", () => {
    const gpt = buildOpenRouterImageRequest({ model: "gpt-image-2-openrouter", prompt: "chair", aspectRatio: "auto", resolution: "4K" });
    expect(gpt.body).toHaveProperty("aspect_ratio", "auto"); expect(gpt.body).not.toHaveProperty("size");
    expect(gpt.body).toHaveProperty("resolution", "4K");
    expect(gpt.settings.resolution).toBe("4K");
    expect(getOpenRouterImageParams("gpt-image-2-openrouter", "auto").resolutions.map(o => o.value)).toEqual(["1K", "2K", "4K"]);
    for (const model of OPENROUTER_IMAGE_MODELS) {
      expect(getOpenRouterResolutionDisplayOptions(model.id, "auto").every(o => !o.disabled)).toBe(true);
      for (const resolution of ["1K", "2K", "4K"]) {
        const request = buildOpenRouterImageRequest({ model: model.id, prompt: "test", aspectRatio: "auto", resolution });
        expect(request.settings.resolution).toBe(resolution);
        expect(request.body).not.toHaveProperty("size");
        expect(request.body).toHaveProperty("resolution", resolution);
      }
    }
    const gemini = buildOpenRouterImageRequest({ model: "gemini-3-pro-image-openrouter", prompt: "chair", aspectRatio: "auto", resolution: "2K" });
    expect(gemini.body).not.toHaveProperty("aspect_ratio"); expect(gemini.body).toHaveProperty("resolution", "2K");
  });
  it("uses reference proportions and the chosen tier for adaptive GPT explicit size", () => {
    for (const model of OPENROUTER_IMAGE_MODELS.filter(m => m.upstreamModelId.startsWith("openai/"))) {
      for (const dimensions of [{ width: 1086, height: 1448 }, { width: 937, height: 613 }, { width: 9000, height: 100 }, { width: 100, height: 9000 }]) {
        let previousArea = 0;
        for (const resolution of ["1K", "2K", "4K"]) {
          const request = buildOpenRouterImageRequest({ model: model.id, prompt: "test", aspectRatio: "auto", resolution, imageUrls: ["https://example.com/first.png"], firstReferenceDimensions: dimensions });
          expect(request.settings).toEqual({ aspectRatio: "auto", resolution });
          expect(request.body).not.toHaveProperty("resolution");
          expect(request.body).not.toHaveProperty("aspect_ratio");
          if (!("size" in request.body)) throw new Error("Missing explicit adaptive size");
          const [w, h] = request.body.size.split("x").map(Number);
          expect(w % 16).toBe(0); expect(h % 16).toBe(0);
          expect(Math.max(w, h)).toBeLessThanOrEqual(3840);
          expect(w * h).toBeGreaterThan(previousArea);
          expect(w * h).toBeGreaterThanOrEqual(655360);
          expect(w * h).toBeLessThanOrEqual(8294400);
          expect(w / h).toBeGreaterThanOrEqual(1 / 3);
          expect(w / h).toBeLessThanOrEqual(3);
          expect(Math.abs(w / h - Math.max(1 / 3, Math.min(3, dimensions.width / dimensions.height)))).toBeLessThan(0.04);
          previousArea = w * h;
        }
      }
    }
  });
  it("registers isolated models, preserves enablement and merges existing OpenRouter capabilities", async () => {
    const provider = getBuiltinProviders().find(p => p.id === "openrouter")!;
    expect(provider.enabled).toBe(false);
    expect(provider.envKeyName).toBe("");
    expect(provider.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(supportsProviderModelFetch(provider)).toBe(true);
    const saved = { ...provider, imageModels: [], apiKey: "saved-test-key", enabled: true, egressMode: "direct" };
    const db = { appSetting: { findUnique: vi.fn(async () => ({ value: JSON.stringify([saved]) })) } };
    const merged = (await getRegisteredProviders(db as any)).find(p => p.id === "openrouter")!;
    expect(merged.apiKey).toBe("saved-test-key");
    expect(merged.egressMode).toBe("direct");
    for (const model of OPENROUTER_IMAGE_MODELS) {
      expect(isProviderModelEnabled([provider], "image", model.id)).toBe(false);
      expect(isProviderModelEnabled([merged], "image", model.id)).toBe(true);
      expect(isProviderModelEnabled([{ ...merged, imageModels: [] }], "image", model.id)).toBe(false);
      expect(isProviderModelEnabled([{ ...merged, id: "kie" }], "image", model.id)).toBe(false);
    }
  });
});

describe("OpenRouter transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveProviderRequestContext).mockResolvedValue({ provider: { id: "openrouter", name: "OpenRouter", baseUrl: "https://saved.example/api/v1/", apiKey: "private-test-key" }, decision: { mode: "direct", providerId: "openrouter" } } as any);
  });
  it("uses saved URL/key and provider egress; decodes MIME and preserves actual cost", async () => {
    vi.mocked(fetchWithProviderEgress).mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: "YQ==", media_type: "image/webp" }], usage: { cost: 0.13 } })) as any);
    const result = await openRouterGenerateImage({ model: OPENROUTER_IMAGE_MODELS[0].id, prompt: "test" });
    expect(result).toEqual({ images: ["data:image/webp;base64,YQ=="], usage: { cost: 0.13 } });
    expect(fetchWithProviderEgress).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchWithProviderEgress).mock.calls[0][1]).toBe("https://saved.example/api/v1/images");
    expect(vi.mocked(fetchWithProviderEgress).mock.calls[0][2]?.headers).toMatchObject({ Authorization: "Bearer private-test-key", "Content-Type": "application/json" });
  });
  it("redacts failures and never retries a billable POST", async () => {
    vi.mocked(fetchWithProviderEgress).mockResolvedValue(new Response(JSON.stringify({ error: { message: "private-test-key rejected" } }), { status: 400 }) as any);
    await expect(openRouterGenerateImage({ model: OPENROUTER_IMAGE_MODELS[1].id, prompt: "test" })).rejects.not.toThrow("private-test-key");
    expect(fetchWithProviderEgress).toHaveBeenCalledTimes(1);
  });
  it("does not treat text-only or empty responses as a generated image", async () => {
    vi.mocked(fetchWithProviderEgress).mockResolvedValue(new Response(JSON.stringify({ data: [] })) as any);
    await expect(openRouterGenerateImage({ model: OPENROUTER_IMAGE_MODELS[1].id, prompt: "test" })).rejects.toThrow("未返回可用图片");
  });
});

describe("Nano Banana Pro resolution routing", () => {
  it.each([undefined, "2K", "4K"])("keeps %s on AI Studio without fallback to the default route", resolution => {
    for (const imageUrls of [[], ["https://example.com/reference.png"]]) {
      const request = buildOpenRouterImageRequest({ model: "gemini-3-pro-image-openrouter", prompt: "chair", aspectRatio: "3:4", resolution, imageUrls });
      expect(request.body.provider).toEqual({ only: ["google-ai-studio/global"], allow_fallbacks: false });
    }
  });
  it("preserves default routing for the 1K tier", () => {
    expect(buildOpenRouterImageRequest({ model: "gemini-3-pro-image-openrouter", prompt: "chair", resolution: "1K" }).body).not.toHaveProperty("provider");
  });
});


it("retains GIF media type and actual usage from OpenRouter", async () => {
  vi.mocked(resolveProviderRequestContext).mockResolvedValue({ provider: { baseUrl: "https://openrouter.ai/api/v1", apiKey: "test-key" }, decision: {} } as any);
  vi.mocked(fetchWithProviderEgress).mockResolvedValue(new Response(JSON.stringify({ data: [{ media_type: "image/gif", b64_json: "R0lGODlh" }], usage: { cost: 0.012 } }), { status: 200 }));
  const result = await openRouterGenerateImage({ model: "gpt-image-2.6-flare-openrouter", prompt: "waves", outputFormat: "gif" });
  expect(result).toEqual({ images: ["data:image/gif;base64,R0lGODlh"], usage: { cost: 0.012 } });
});
