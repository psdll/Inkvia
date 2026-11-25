import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IMAGE_TOOL_MODELS } from "@/lib/generation/task-input-schema";
import { createImageTaskSchema } from "@/lib/generation/task-input-schema";
import { getCanvasImageModelParams } from "@/lib/canvas/image-task";
import {
  getBuiltinProviders,
  mergeSavedProvidersWithBuiltins,
} from "@/lib/providers/registry";
import { getProviderModelCapability } from "@/lib/providers/model-availability";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import * as apimartImage from "@/lib/apimart-image";
import {
  getGptImage2OfficialBatchOptions,
  normalizeGptImage2OfficialBatchSettings,
} from "@/components/batch-workbench/batch-settings-panel";

const MODEL_ID = "nano-banana-pro-apimart";
const UPSTREAM_MODEL = "gemini-3-pro-image-preview-official";

describe("APIMart Nano Banana Pro registration", () => {
  it("registers the official model across the provider and active image entry points", () => {
    expect(IMAGE_EDIT_MODEL_DEFINITIONS).toContainEqual(expect.objectContaining({
      id: MODEL_ID,
      label: "nano-banana-pro（am）",
      provider: "apimart",
      category: "image",
      upstreamModelId: UPSTREAM_MODEL,
    }));

    const provider = getBuiltinProviders().find((item) => item.id === "apimart");
    expect(provider?.imageModels).toContain(UPSTREAM_MODEL);
    expect(getProviderModelCapability("apimart", "image", UPSTREAM_MODEL))
      .toMatchObject({ adapterBacked: true });

    expect(getCanvasImageModelParams(MODEL_ID)).toMatchObject({
      aspectRatios: [
        { value: "auto", label: "自适应" },
        { value: "1:1", label: "1:1" },
        { value: "2:3", label: "2:3" },
        { value: "3:2", label: "3:2" },
        { value: "3:4", label: "3:4" },
        { value: "4:3", label: "4:3" },
        { value: "4:5", label: "4:5" },
        { value: "5:4", label: "5:4" },
        { value: "9:16", label: "9:16" },
        { value: "16:9", label: "16:9" },
        { value: "21:9", label: "21:9" },
      ],
      resolutions: [
        { value: "1K", label: "1K" },
        { value: "2K", label: "2K" },
        { value: "4K", label: "4K" },
      ],
      qualities: [],
      defaultAspectRatio: "auto",
      defaultResolution: "2K",
    });
    expect(IMAGE_TOOL_MODELS).toContain(MODEL_ID);

    const batchSource = readFileSync("app/image/image-tool.tsx", "utf8");
    expect(batchSource).toContain(`"${MODEL_ID}": APIMART_NANO_BANANA_PRO_ASPECT_RATIO_VALUES`);
    expect(batchSource).toContain(`"${MODEL_ID}": [`);
  });

  it("backfills the upstream capability into an existing saved APIMart provider", () => {
    const provider = mergeSavedProvidersWithBuiltins([{
      id: "apimart",
      name: "APIMART",
      protocol: "apimart",
      baseUrl: "https://api.apimart.ai/v1",
      egressMode: "proxy",
      imageModels: ["gpt-image-2-official"],
      videoModels: [],
      chatModels: [],
      modelProtocols: {},
      enabled: true,
      sortOrder: 0,
    }]).find((item) => item.id === "apimart")!;

    expect(provider.imageModels).toEqual(expect.arrayContaining([
      "gpt-image-2-official",
      UPSTREAM_MODEL,
    ]));
  });

  it("does not restore unrelated APIMart capabilities removed from saved configuration", () => {
    const provider = mergeSavedProvidersWithBuiltins([{
      id: "apimart",
      name: "APIMART",
      protocol: "apimart",
      baseUrl: "https://api.apimart.ai/v1",
      egressMode: "proxy",
      imageModels: [],
      videoModels: [],
      chatModels: [],
      modelProtocols: {},
      enabled: true,
      sortOrder: 0,
    }]).find((item) => item.id === "apimart")!;

    expect(provider.imageModels).toEqual(["seedream-5-5", UPSTREAM_MODEL, "gemini-nano-banana-2.1", "midjourney", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2.6-flare", "gpt-image-2.6-sunburst"]);
    expect(provider.imageModels).not.toContain("gpt-image-2-official");
  });
});

describe("APIMart Nano Banana Pro request contract", () => {
  const builder = (apimartImage as Record<string, unknown>).buildApimartNanoBananaProRequest;

  it("builds the documented official text-to-image JSON without sibling-model fields", () => {
    expect(builder).toBeTypeOf("function");
    if (typeof builder !== "function") return;

    const request = builder({
      prompt: " cinematic product photo ",
      aspectRatio: "16:9",
      resolution: "2K",
    });

    expect(request).toEqual({
      model: UPSTREAM_MODEL,
      prompt: "cinematic product photo",
      size: "16:9",
      n: 1,
      resolution: "2K",
    });
    for (const forbidden of [
      "official_fallback",
      "nsfw_check",
      "quality",
      "background",
      "moderation",
      "output_format",
      "output_compression",
      "mask_url",
    ]) {
      expect(request).not.toHaveProperty(forbidden);
    }
  });

  it("preserves ordered reference URLs in image_urls", () => {
    expect(builder).toBeTypeOf("function");
    if (typeof builder !== "function") return;

    expect(builder({
      prompt: "edit the product",
      aspectRatio: "4:5",
      resolution: "4K",
      imageUrls: [
        " https://cdn.test/ref-1.png ",
        "https://cdn.test/ref-2.webp",
      ],
    })).toEqual({
      model: UPSTREAM_MODEL,
      prompt: "edit the product",
      size: "4:5",
      n: 1,
      resolution: "4K",
      image_urls: [
        "https://cdn.test/ref-1.png",
        "https://cdn.test/ref-2.webp",
      ],
    });
  });

  it("accepts 14 references and rejects 15 before network I/O", () => {
    expect(builder).toBeTypeOf("function");
    if (typeof builder !== "function") return;

    const references = Array.from({ length: 15 }, (_, index) => `https://cdn.test/${index + 1}.png`);
    expect(builder({ prompt: "edit", imageUrls: references.slice(0, 14) }).image_urls)
      .toHaveLength(14);
    expect(() => builder({ prompt: "edit", imageUrls: references }))
      .toThrow("Nano Banana Pro（am）最多支持 14 张参考图");
  });
});

describe("APIMart Nano Banana Pro generation routing", () => {
  it("rejects more than 14 references in the agent entry point", () => {
    const result = createImageTaskSchema.safeParse({
      prompt: "edit",
      model: MODEL_ID,
      imagePaths: Array.from({ length: 15 }, (_, index) => `/tmp/${index + 1}.png`),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["imagePaths"],
        message: "Nano Banana Pro（am）最多支持 14 张参考图",
      }),
    ]));
  });

  it("routes the local model through its isolated APIMart submitter", () => {
    const service = readFileSync("lib/generation/image-service.ts", "utf8");

    expect(service).toContain("isApimartNanoBananaProModel(model)");
    expect(service).toContain("apimartSubmitNanoBananaPro({");
    expect(service).toContain("Nano Banana Pro（am）最多支持 14 张参考图");
    expect(service).toContain("APIMART_NANO_BANANA_PRO_UPSTREAM_MODEL");
  });

  it("exposes the documented ratios and reference cap in the batch workbench", () => {
    const options = getGptImage2OfficialBatchOptions(MODEL_ID, "2K", "1:1");

    expect(options.ratioOptions.map((option) => option.value)).toEqual([
      "auto",
      "1:1",
      "2:3",
      "3:2",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9",
    ]);
    expect(options.resolutionOptions.map((option) => option.value)).toEqual(["1K", "2K", "4K"]);
    expect(normalizeGptImage2OfficialBatchSettings(MODEL_ID, "3K", "9:21")).toEqual({
      model: MODEL_ID,
      resolution: "1K",
      aspectRatio: "1:1",
    });

    const panel = readFileSync("components/batch-workbench/batch-settings-panel.tsx", "utf8");
    expect(panel).toContain("isApimartNanoBananaProModel(batchModel) ? 14");
  });
});
