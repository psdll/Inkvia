import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: { appSetting: { findUnique: vi.fn(async () => null) } } }));
import { buildKieNanoBanana21Request, buildApimartNanoBanana21Request } from "@/lib/nano-banana-21-providers";
import { buildOpenRouterImageRequest } from "@/lib/openrouter-image";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins } from "@/lib/providers/registry";
import { getImageModelParams } from "@/lib/generation/image-model-params";
import { getCanvasImageModelParams } from "@/lib/canvas/image-task";
import { getGptImage2OfficialBatchOptions } from "@/components/batch-workbench/batch-settings-panel";
import { createImageTaskSchema } from "@/lib/generation/task-input-schema";
import { getGoogleImageOptions } from "@/lib/google-image-settings";
const refs = ["https://example.com/1.png", "https://example.com/2.png"];
describe("Nano Banana 2.1 provider contracts", () => {
  it.each(["nano-banana-2-1", "gemini-nano-banana-2.1-apimart", "gemini-nano-banana-2.1-openrouter"])("registers %s with provider-specific UI options", model => {
    const entry = IMAGE_EDIT_MODEL_DEFINITIONS.find(m => m.id === model)!;
    expect(entry).toBeDefined();
    const provider = getBuiltinProviders().find(p => p.id === entry.provider)!;
    const merged = mergeSavedProvidersWithBuiltins([{ ...provider, imageModels: [], enabled: false, apiKey: "saved" }]).find(p => p.id === provider.id)!;
    expect(merged.imageModels).toContain(entry.upstreamModelId || model);
    expect(merged.enabled).toBe(false); expect(merged.apiKey).toBe("saved");
    const params = getImageModelParams(model);
    expect(params.aspectRatios).toHaveLength(15);
    expect(params.resolutions.map(o => o.value)).toEqual(["1K", "2K", "4K"]);
    expect(params.qualities).toEqual([]); expect(getGoogleImageOptions(model)).toBeNull();
    expect(getCanvasImageModelParams(model)).toEqual(params);
    expect(getGptImage2OfficialBatchOptions(model, "4K", "1:8").ratioOptions.map(o => o.value)).toEqual(params.aspectRatios.map(o => o.value));
    expect(createImageTaskSchema.safeParse({ model, prompt: "photo", aspectRatio: "1:8", resolution: "4K" }).success).toBe(true);
  });
  it.each([[[]], [refs]])("builds exact Kie request for %j", imageUrls => {
    expect(buildKieNanoBanana21Request({ prompt: "photo", aspectRatio: "1:8", resolution: "4K", imageUrls })).toEqual({ model: "nano-banana-2-1", input: { prompt: "photo", aspect_ratio: "1:8", resolution: "4K", output_format: "png", ...(imageUrls.length ? { image_input: imageUrls } : {}) } });
  });
  it("enforces Kie boundaries and rejects invalid tiers", () => {
    expect(buildKieNanoBanana21Request({ prompt: "a".repeat(20000), imageUrls: Array(10).fill(refs[0]) }).input.image_input).toHaveLength(10);
    expect(() => buildKieNanoBanana21Request({ prompt: "a".repeat(20001) })).toThrow();
    expect(() => buildKieNanoBanana21Request({ prompt: "photo", imageUrls: Array(11).fill(refs[0]) })).toThrow();
    expect(() => buildKieNanoBanana21Request({ prompt: "photo", resolution: "512" })).toThrow();
    expect(createImageTaskSchema.safeParse({ model: "nano-banana-2-1", prompt: "photo", imagePaths: Array(11).fill("uploads/1.png") }).success).toBe(false);
  });
  it.each([[[]], [refs]])("builds exact APIMart official request for %j", imageUrls => {
    expect(buildApimartNanoBanana21Request({ prompt: "photo", aspectRatio: "auto", resolution: "4K", imageUrls })).toEqual({ model: "gemini-nano-banana-2.1", prompt: "photo", size: "auto", resolution: "4K", n: 1, ...(imageUrls.length ? { image_urls: imageUrls } : {}) });
  });
  it("uses the current OpenRouter endpoint tag and omits unsupported fields", () => {
    const result = buildOpenRouterImageRequest({ model: "gemini-nano-banana-2.1-openrouter", prompt: "photo", aspectRatio: "1:8", resolution: "4K", imageUrls: refs, quality: "high", background: "transparent" });
    expect(result.endpoint).toBe("/images");
    expect(result.body).toMatchObject({ model: "google/gemini-nano-banana-2.1", aspect_ratio: "1:8", resolution: "4K", n: 1 });
    expect(result.body).not.toHaveProperty("provider");
    for (const field of ["quality", "background", "output_format", "response_format", "reasoning", "tools"]) expect(result.body).not.toHaveProperty(field);
  });
});
