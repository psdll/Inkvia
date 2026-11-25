import googleImageResponseFormat from "./fixtures/google-image-response-format.json";
import { GOOGLE_NANO_BANANA_21_RATIOS, GOOGLE_NANO_BANANA_21_RESOLUTIONS } from "@/lib/google-nano-banana-21";
import { beforeEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ send: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/providers/transport", () => ({ axiosWithProviderEgress: transport.send, resolveProviderRequestContext: transport.resolve, directAxios: vi.fn() }));
import { buildGoogleAiStudioImageRequest, googleAiStudioGenerateImage, isGoogleAiStudioImageModel } from "@/lib/google-ai-studio-image";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins } from "@/lib/providers/registry";
import { getImageModelParams } from "@/lib/generation/image-model-params";
import { createImageTaskSchema } from "@/lib/generation/task-input-schema";
import { GOOGLE_IMAGE_QUOTES } from "@/lib/billing/google-pricing";
import { getGptImage2OfficialBatchOptions } from "@/components/batch-workbench/batch-settings-panel";
import { getCanvasImageModelParams } from "@/lib/canvas/image-task";

const model = "gemini-nano-banana-2.1";
describe("Google Nano Banana 2.1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transport.resolve.mockResolvedValue({ provider: { name: "Google", baseUrl: "https://google.example", apiKey: "saved-key" }, decision: { providerId: "google-ai-studio", mode: "proxy" } });
    transport.send.mockResolvedValue({ status: 200, data: { candidates: [{ content: { parts: [{ thought: true, inlineData: { mimeType: "image/png", data: "dGhvdWdodA==" } }, { inlineData: { mimeType: "image/png", data: "ZmluYWw=" } }] } }], usageMetadata: { promptTokenCount: 5 } } });
  });
  it("registers the official model and upgrades saved capabilities without enabling a disabled provider", () => {
    expect(isGoogleAiStudioImageModel(model)).toBe(true);
    expect(IMAGE_EDIT_MODEL_DEFINITIONS).toContainEqual(expect.objectContaining({ id: model, label: "Nano Banana 2.1", provider: "google-ai-studio" }));
    const provider = getBuiltinProviders().find(p => p.id === "google-ai-studio")!;
    const upgraded = mergeSavedProvidersWithBuiltins([{ ...provider, enabled: false, imageModels: ["gemini-3.1-flash-image"], apiKey: "saved-key" }]).find(p => p.id === provider.id)!;
    expect(upgraded.imageModels).toContain(model);
    expect(upgraded.enabled).toBe(false);
    expect(upgraded.apiKey).toBe("saved-key");
  });
  it("exposes all 14 ratios plus auto and three resolutions", () => {
    const params = getImageModelParams(model);
    expect(params.aspectRatios.map(p => p.value)).toEqual(["auto", "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"]);
    expect(params.resolutions.map(p => p.value)).toEqual(["1K", "2K", "4K"]);
    expect(params.qualities).toEqual([]);
    expect(getCanvasImageModelParams(model)).toEqual(params);
    const batch = getGptImage2OfficialBatchOptions(model, "4K", "1:8");
    expect(batch.ratioOptions.map(p => p.value)).toEqual(params.aspectRatios.map(p => p.value));
    expect(batch.resolutionOptions.map(p => p.value)).toEqual(["1K", "2K", "4K"]);
  });
  it.each([0, 14])("accepts %i references in Agent", count => {
    expect(createImageTaskSchema.safeParse({ model, prompt: "photo", imagePaths: Array.from({ length: count }, (_, i) => `uploads/${i}.png`) }).success).toBe(true);
  });
  it("rejects 15 references in Agent", () => {
    expect(createImageTaskSchema.safeParse({ model, prompt: "photo", imagePaths: Array.from({ length: 15 }, (_, i) => `uploads/${i}.png`) }).success).toBe(false);
  });
  it.each([0, 14])("sends the documented request with %i references and returns only final images", async count => {
    const imageUrls = Array.from({ length: count }, (_, i) => `data:image/png;base64,${Buffer.from(String(i)).toString("base64")}`);
    const result = await googleAiStudioGenerateImage({ model, prompt: "photo", aspectRatio: "1:8", resolution: "4K", imageUrls });
    const request = transport.send.mock.calls[0][1];
    expect(request.url).toBe(`https://google.example/v1beta/models/${model}:generateContent`);
    expect(request.headers["x-goog-api-key"]).toBe("saved-key");
    expect(request.params).toBeUndefined();
    expect(request.data).toEqual({ contents: [{ role: "user", parts: [{ text: "photo" }, ...imageUrls.map(url => ({ inlineData: { mimeType: "image/png", data: url.split(",")[1] } }))] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], responseFormat: { image: { aspectRatio: "ASPECT_RATIO_ONE_BY_EIGHT", imageSize: "IMAGE_SIZE_FOUR_K" } } } });
    expect(request.data).not.toHaveProperty("n");
    expect(request.data.generationConfig).not.toHaveProperty("imageConfig");
    expect(result.images).toEqual(["data:image/png;base64,ZmluYWw="]);
    expect(result.raw.usageMetadata).toEqual({ promptTokenCount: 5 });
  });
  it.each([{ imageUrls: Array(15).fill("data:image/png;base64,eA==") }, { aspectRatio: "2:1" }, { resolution: "3K" }])("rejects unsupported input before network access: %j", async invalid => {
    await expect(googleAiStudioGenerateImage({ model, prompt: "photo", ...invalid })).rejects.toThrow();
    expect(transport.send).not.toHaveBeenCalled();
  });
  it("keeps auto ratio implicit", async () => {
    await googleAiStudioGenerateImage({ model, prompt: "photo", aspectRatio: "auto" });
    expect(transport.send.mock.calls[0][1].data.generationConfig.responseFormat).toEqual({ image: { imageSize: "IMAGE_SIZE_ONE_K" } });
  });
  it("maps the reported 3:4 / 2K failure to REST enum values", () => {
    const request = buildGoogleAiStudioImageRequest({ model, prompt: "猫咪", aspectRatio: "3:4", resolution: "2K" });
    expect(request.generationConfig).toHaveProperty("responseFormat", { image: { aspectRatio: "ASPECT_RATIO_THREE_BY_FOUR", imageSize: "IMAGE_SIZE_TWO_K" } });
  });
  it.each(GOOGLE_NANO_BANANA_21_RATIOS.flatMap(aspectRatio => GOOGLE_NANO_BANANA_21_RESOLUTIONS.map(resolution => [aspectRatio, resolution])))
    ("validates %s / %s against Google's live discovery schema snapshot", (aspectRatio, resolution) => {
      const request = buildGoogleAiStudioImageRequest({ model, prompt: "photo", aspectRatio, resolution });
      if (!("responseFormat" in request.generationConfig)) throw new Error("Missing image response format");
      const image = request.generationConfig.responseFormat.image;
      if (aspectRatio === "auto") expect(image).not.toHaveProperty("aspectRatio");
      else expect(googleImageResponseFormat.aspectRatio).toContain(image.aspectRatio);
      expect(googleImageResponseFormat.imageSize).toContain(image.imageSize);
    });
  it("preserves the existing Google builder contract", () => {
    expect(buildGoogleAiStudioImageRequest({ prompt: "photo", resolution: "2K" }).generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"], imageConfig: { imageSize: "2K" } });
  });
  it("uses the published token tariffs", () => {
    expect(GOOGLE_IMAGE_QUOTES[model]?.map(q => q.usd)).toEqual(["1.5", "7.5", "30"]);
  });
});
