import { createImageTaskSchema } from "@/lib/generation/task-input-schema";
import { describe, it, expect } from "vitest";
import { getGoogleImageOptions, normalizeGoogleImageSettings, validateGoogleImageSettings, extractGoogleGrounding } from "@/lib/google-image-settings";
import { buildGoogleAiStudioImageRequest } from "@/lib/google-ai-studio-image";
import { getImageModelParams } from "@/lib/generation/image-model-params";
const nano = "gemini-nano-banana-2.1";
const flash = "gemini-3.1-flash-image";
const lite = "gemini-3.1-flash-lite-image";
const pro = "gemini-3-pro-image";
describe("Google image settings contract", () => {
  it("keeps Google settings and 512 in Agent tool validation and submission parameters", () => {
    const params = { resolution: "512", googleThinkingLevel: "high", googleSearchMode: "web_image" };
    expect(createImageTaskSchema.safeParse({ model: flash, prompt: "cat", ...params }).success).toBe(true);
    expect(createImageTaskSchema.safeParse({ model: lite, prompt: "cat", ...params }).success).toBe(false);
  });
  it("uses model-specific thinking levels and defaults", () => {
    expect(getGoogleImageOptions(nano)?.thinking.map(o => o.value)).toEqual(["minimal", "medium", "high"]);
    expect(normalizeGoogleImageSettings(nano, {})).toEqual({ googleThinkingLevel: "medium", googleSearchMode: "off" });
    expect(normalizeGoogleImageSettings(lite, {})).toEqual({ googleThinkingLevel: "minimal", googleSearchMode: "off" });
    expect(getGoogleImageOptions(pro)?.thinking).toEqual([]);
  });
  it("fills missing ratios, scopes 512 to Flash and corrects Pro ratios", () => {
    expect(getImageModelParams(flash).aspectRatios.map(o => o.value)).toEqual(getGoogleImageOptions(nano)?.ratios);
    expect(getImageModelParams(flash).resolutions.map(o => o.value)).toEqual(["512", "1K", "2K", "4K"]);
    for (const model of [nano, lite, pro]) expect(getImageModelParams(model).resolutions.map(o => o.value)).not.toContain("512");
    expect(getImageModelParams(pro).aspectRatios.map(o => o.value)).toEqual(["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]);
  });
  it.each(["web", "image", "web_image"])("maps %s to generateContent searchTypes", googleSearchMode => {
    const request = buildGoogleAiStudioImageRequest({ model: nano, prompt: "cat", googleThinkingLevel: "high", googleSearchMode });
    expect(request).toMatchObject({ generationConfig: { thinkingConfig: { thinkingLevel: "HIGH" } }, tools: [{ googleSearch: { searchTypes: { ...(googleSearchMode !== "image" ? { webSearch: {} } : {}), ...(googleSearchMode !== "web" ? { imageSearch: {} } : {}) } } }] });
    expect(request).not.toHaveProperty("previous_interaction_id");
  });
  it("omits search when disabled and thinking when unspecified", () => {
    const request = buildGoogleAiStudioImageRequest({ model: nano, prompt: "cat", googleSearchMode: "off" });
    expect(request).not.toHaveProperty("tools");
    expect(request.generationConfig).not.toHaveProperty("thinkingConfig");
    expect(buildGoogleAiStudioImageRequest({ model: pro, prompt: "cat", googleSearchMode: "web" }).tools).toEqual([{ googleSearch: {} }]);
  });
  it.each([
    [lite, { googleSearchMode: "web" }], [pro, { googleSearchMode: "image" }],
    [flash, { googleThinkingLevel: "medium" }], [pro, { googleThinkingLevel: "high" }],
    [nano, { resolution: "512" }], [pro, { aspectRatio: "8:1" }],
  ])("rejects unsupported settings for %s", (model, settings) => {
    expect(() => validateGoogleImageSettings(model, settings)).toThrow();
  });
  it("returns source webpages, rejects unsafe links, and preserves Google's search entry point", () => {
    expect(extractGoogleGrounding({ candidates: [{ groundingMetadata: { searchEntryPoint: { renderedContent: "<div>Google</div>" }, groundingChunks: [{ image: { sourceUri: "https://example.com/page", imageUri: "https://example.com/image.jpg", title: "Image source" } }, { web: { uri: "javascript:alert(1)", title: "bad" } }] } }] })).toEqual({ renderedContent: "<div>Google</div>", sources: [{ url: "https://example.com/page", title: "Image source" }] });
  });
});
