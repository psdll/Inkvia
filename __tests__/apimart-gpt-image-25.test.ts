import { describe, expect, it } from "vitest";
import {
  APIMART_GPT_IMAGE_25_MODEL_ID,
  APIMART_GPT_IMAGE_25_UPSTREAM_MODELS,
  buildApimartGptImage25Request,
  buildApimartGptImageVariantRequest,
} from "@/lib/apimart-gpt-image-25";
import { APIMART_GPT_IMAGE_26_MODEL_ID, APIMART_GPT_IMAGE_26_UPSTREAM_MODELS } from "@/lib/apimart-image-models";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins } from "@/lib/providers/registry";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { getImageModelParams, normalizeImageQuality } from "@/lib/generation/image-model-params";
import { createImageTaskSchema } from "@/lib/generation/task-input-schema";

describe("APIMart GPT Image 2.5 contract", () => {
  it.each(["flare", "sunburst"] as const)("maps %s to its exact upstream ID for generation and editing", (mode) => {
    const input = { prompt: " product photo ", mode, aspectRatio: "16:9", resolution: "2K", quality: "xhigh" };
    const expected = { model: APIMART_GPT_IMAGE_25_UPSTREAM_MODELS[mode], prompt: "product photo", size: "16:9", resolution: "2k", quality: "xhigh", n: 1 };
    expect(buildApimartGptImage25Request(input)).toEqual(expected);
    expect(buildApimartGptImage25Request({ ...input, imageUrls: ["https://example.com/first.png", "https://example.com/second.png"] }))
      .toEqual({ ...expected, image_urls: ["https://example.com/first.png", "https://example.com/second.png"] });
  });

  it.each(["low", "medium", "high", "xhigh", "max"])("preserves quality %s through shared parameters and the builder", (quality) => {
    expect(normalizeImageQuality(APIMART_GPT_IMAGE_25_MODEL_ID, quality)).toBe(quality);
    expect(buildApimartGptImage25Request({ prompt: "photo", quality }).quality).toBe(quality);
  });

  it("defaults to Flare and medium without copying hidden or unsupported sibling fields", () => {
    const request = buildApimartGptImage25Request({ prompt: "photo" });
    expect(request).toEqual({ model: "gpt-image-2.5-flare", prompt: "photo", resolution: "1k", quality: "medium", n: 1 });
    for (const key of ["mode", "background", "moderation", "output_format", "output_compression", "mask_url", "nsfw_check", "response_format"]) {
      expect(request).not.toHaveProperty(key);
    }
  });

  it("accepts the documented API auto quality without exposing another UI choice", () => {
    expect(buildApimartGptImage25Request({ prompt: "photo", quality: "auto" }).quality).toBe("auto");
    expect(getImageModelParams(APIMART_GPT_IMAGE_25_MODEL_ID).qualities).toHaveLength(5);
  });

  it("omits size for auto editing while preserving a user's explicit ratio", () => {
    const input = { prompt: "edit", aspectRatio: "auto", imageUrls: ["https://example.com/ref.png"] };
    expect(buildApimartGptImage25Request(input)).not.toHaveProperty("size");
    expect(buildApimartGptImage25Request({ ...input, aspectRatio: "9:21", resolution: "4K" })).toMatchObject({ size: "9:21", resolution: "4k" });
  });

  it("accepts sixteen ordered references and rejects seventeen without truncation", () => {
    const refs = Array.from({ length: 17 }, (_, i) => `https://example.com/${i}.png`);
    expect(buildApimartGptImage25Request({ prompt: "edit", imageUrls: refs.slice(0, 16) }).image_urls).toEqual(refs.slice(0, 16));
    expect(() => buildApimartGptImage25Request({ prompt: "edit", imageUrls: refs })).toThrow(/16/);
  });

  it.each([{ mode: "unknown" }, { quality: "ultra" }, { resolution: "8K" }, { aspectRatio: "8:1" }])("rejects invalid parameters instead of silently switching mode or quality: %j", (params) => {
    expect(() => buildApimartGptImage25Request({ prompt: "photo", ...params })).toThrow();
  });
});

describe("APIMart GPT Image 2.6 static images", () => {
  it("enforces the documented prompt and ordered reference boundaries", () => {
    const model = APIMART_GPT_IMAGE_26_MODEL_ID;
    const imageUrls = Array.from({ length: 16 }, (_, i) => `https://example.com/${i}.png`);
    const prompt = "图".repeat(32_000);
    expect(buildApimartGptImageVariantRequest({ model, prompt, imageUrls, aspectRatio: "auto" }))
      .toEqual({ model: "gpt-image-2.6-flare", prompt, image_urls: imageUrls, resolution: "1k", quality: "medium", n: 1 });
    expect(() => buildApimartGptImageVariantRequest({ model, prompt: prompt + "图" })).toThrow(/32000/);
    expect(() => buildApimartGptImageVariantRequest({ model, prompt, imageUrls: [...imageUrls, imageUrls[0]] })).toThrow(/16/);
    expect(() => buildApimartGptImageVariantRequest({ model, prompt, imageUrls: ["data:image/png;base64,cA=="] })).toThrow(/HTTP/);
    expect(() => buildApimartGptImageVariantRequest({ model, prompt, background: "transparent", outputFormat: "jpeg" })).toThrow(/PNG/);
  });

  it("backfills both upstream capabilities and preserves the existing provider switch", () => {
    const builtin = getBuiltinProviders().find((item) => item.id === "apimart")!;
    const [flare, sunburst] = Object.values(APIMART_GPT_IMAGE_26_UPSTREAM_MODELS);
    const upgraded = mergeSavedProvidersWithBuiltins([{ ...builtin, enabled: false, imageModels: ["gpt-image-2-official"] }]).find((item) => item.id === "apimart")!;
    expect(upgraded.imageModels).toEqual(expect.arrayContaining([flare, sunburst]));
    expect(isProviderModelEnabled([upgraded], "image", APIMART_GPT_IMAGE_26_MODEL_ID)).toBe(false);
    expect(isProviderModelEnabled([{ ...upgraded, enabled: true }], "image", APIMART_GPT_IMAGE_26_MODEL_ID)).toBe(true);
    expect(isProviderModelEnabled([{ ...upgraded, enabled: true, imageModels: [flare] }], "image", APIMART_GPT_IMAGE_26_MODEL_ID)).toBe(false);
    expect(getImageModelParams(APIMART_GPT_IMAGE_26_MODEL_ID)).toEqual(getImageModelParams(APIMART_GPT_IMAGE_25_MODEL_ID));
  });
});

describe("APIMart GPT Image 2.5 registration", () => {
  it("has one display entry requiring both real upstream models", () => {
    const entries = IMAGE_EDIT_MODEL_DEFINITIONS.filter((item) => item.provider === "apimart" && item.id.includes("gpt-image-2.5"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: APIMART_GPT_IMAGE_25_MODEL_ID, label: "GPT-Image-2.5（am）", provider: "apimart", upstreamModelIds: Object.values(APIMART_GPT_IMAGE_25_UPSTREAM_MODELS) });
    const provider = getBuiltinProviders().find((item) => item.id === "apimart")!;
    expect(isProviderModelEnabled([{ ...provider, enabled: true }], "image", APIMART_GPT_IMAGE_25_MODEL_ID)).toBe(true);
    expect(isProviderModelEnabled([{ ...provider, enabled: false }], "image", APIMART_GPT_IMAGE_25_MODEL_ID)).toBe(false);
    expect(isProviderModelEnabled([{ ...provider, enabled: true, imageModels: ["gpt-image-2.5-flare"] }], "image", APIMART_GPT_IMAGE_25_MODEL_ID)).toBe(false);
    const upgraded = mergeSavedProvidersWithBuiltins([{ ...provider, enabled: false, imageModels: ["gpt-image-2-official"] }]).find((item) => item.id === "apimart")!;
    expect(upgraded.enabled).toBe(false);
    expect(upgraded.imageModels).toEqual(expect.arrayContaining(Object.values(APIMART_GPT_IMAGE_25_UPSTREAM_MODELS)));
  });

  it("exposes exactly five quality options, sixteen ratio options and three resolutions", () => {
    const params = getImageModelParams(APIMART_GPT_IMAGE_25_MODEL_ID);
    expect(params.qualities.map((item) => item.value)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(params.aspectRatios).toHaveLength(16);
    expect(params.resolutions.map((item) => item.value)).toEqual(["1K", "2K", "4K"]);
    expect(normalizeImageQuality("gpt-image-2-apimart", "max")).toBe("medium");
  });

  it("preserves mode and new qualities in the Agent schema, but rejects them for 2.0", () => {
    const input = { prompt: "edit", model: APIMART_GPT_IMAGE_25_MODEL_ID, gptImage25Mode: "sunburst", quality: "max" };
    expect(createImageTaskSchema.parse(input)).toMatchObject(input);
    expect(createImageTaskSchema.safeParse({ ...input, model: "gpt-image-2-apimart" }).success).toBe(false);
  });
});
