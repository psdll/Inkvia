import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID,
  AICOMING_HAIYA_NANO_BANANA_PRO_MODEL_ID,
  AICOMING_HAIYA_NANO_BANANA_PRO_UPSTREAM_MODEL,
  AICOMING_HAIYA_PROVIDER_ID,
} from "@/lib/aicoming-merchant-models";
import {
  buildAicomingHaiyaGptImage2Request,
} from "@/lib/aicoming-image";
import {
  REAPI_GPT_IMAGE_2_MODEL_ID,
  getGptImage2OfficialRatios,
  isGptImage2OfficialSizeComboValid,
} from "@/lib/gpt-image-2-official";
import { getProviderModelCapability } from "@/lib/providers/model-availability";
import {
  getBuiltinProviders,
  mergeSavedProvidersWithBuiltins,
} from "@/lib/providers/registry";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";

describe("AIComing merchant image providers", () => {
  afterEach(() => {
    delete process.env.AICOMING_HAIYA_BASE_URL;
    vi.resetModules();
    vi.doUnmock("@/lib/prisma");
  });

  it("registers the Haiya image adapters without replacing existing models", async () => {
    expect(IMAGE_EDIT_MODEL_DEFINITIONS).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID,
        label: "GPT-Image-2（hai）",
        provider: AICOMING_HAIYA_PROVIDER_ID,
        upstreamModelId: "gpt-image-2-1k",
        upstreamModelIds: [
          "gpt-image-2-1k",
          "gpt-image-2-2k",
          "gpt-image-2-4k",
        ],
      }),
      expect.objectContaining({
        id: AICOMING_HAIYA_NANO_BANANA_PRO_MODEL_ID,
        label: "nano-banana-pro（hai）",
        provider: AICOMING_HAIYA_PROVIDER_ID,
        upstreamModelId: AICOMING_HAIYA_NANO_BANANA_PRO_UPSTREAM_MODEL,
      }),
    ]));

    expect(getBuiltinProviders()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: AICOMING_HAIYA_PROVIDER_ID,
        name: "海牙科技（AIComing）",
        baseUrl: "https://api.aicoming.top/v1",
        envKeyName: "",
        egressMode: "direct",
        enabled: false,
        imageModels: [
          "gpt-image-2-1k",
          "gpt-image-2-2k",
          "gpt-image-2-4k",
          "gpt-image-2.5-flare",
          "gpt-image-2.5-sunburst",
          "nano-banana-pro",
        ],
      }),
    ]));

    for (const upstreamModelId of ["gpt-image-2-1k", "gpt-image-2-2k", "gpt-image-2-4k", "nano-banana-pro"]) {
      expect(getProviderModelCapability(AICOMING_HAIYA_PROVIDER_ID, "image", upstreamModelId))
        .toMatchObject({ adapterBacked: true });
    }

    const mergedHaiya = mergeSavedProvidersWithBuiltins([{
      ...getBuiltinProviders().find((provider) => provider.id === AICOMING_HAIYA_PROVIDER_ID)!,
      imageModels: ["gpt-image-2-1k"],
      enabled: true,
    }]).find((provider) => provider.id === AICOMING_HAIYA_PROVIDER_ID);
    expect(mergedHaiya?.imageModels).toEqual([
      "gpt-image-2-1k",
      "gpt-image-2-2k",
      "gpt-image-2-4k",
      "gpt-image-2.5-flare",
      "gpt-image-2.5-sunburst",
      "nano-banana-pro",
    ]);

    const findUnique = vi.fn().mockResolvedValue(null);
    vi.doMock("@/lib/prisma", () => ({ default: { appSetting: { findUnique } } }));
    const { getImageEditModelVisibility } = await import("@/lib/image-edit-models");
    await expect(getImageEditModelVisibility()).resolves.toMatchObject({
      [AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID]: false,
      [AICOMING_HAIYA_NANO_BANANA_PRO_MODEL_ID]: false,
    });
  });

  it("reads the Haiya URL from env only when no saved URL exists and never declares an env key", () => {
    process.env.AICOMING_HAIYA_BASE_URL = "https://env.haiya.test/v1";
    const haiya = getBuiltinProviders().find((provider) => provider.id === AICOMING_HAIYA_PROVIDER_ID);

    expect(haiya?.baseUrl).toBe("https://env.haiya.test/v1");
    expect(haiya?.envKeyName).toBe("");
  });

  it("maps Haiya resolution tiers to the exact upstream model IDs and pixel sizes", () => {
    expect(buildAicomingHaiyaGptImage2Request({
      prompt: " city at night ",
      aspectRatio: "16:9",
      resolution: "2K",
      quality: "high",
      imageUrls: ["https://cdn.test/ref.png"],
      requestKey: "request-haiya-1",
    })).toEqual({
      endpoint: "/images/generations",
      idempotencyKey: "request-haiya-1",
      body: {
        model: "gpt-image-2-2k",
        prompt: "city at night",
        size: "2048x1152",
        quality: "high",
        n: 1,
        response_format: "url",
        async: true,
        image: ["https://cdn.test/ref.png"],
      },
    });

    expect(buildAicomingHaiyaGptImage2Request({ prompt: "one", resolution: "1K" }).body.model)
      .toBe("gpt-image-2-1k");
    expect(buildAicomingHaiyaGptImage2Request({ prompt: "four", resolution: "4K", aspectRatio: "16:9" }).body.model)
      .toBe("gpt-image-2-4k");
  });

  it("hides unsupported 3:2 and 2:3 ratios only for Haiya 1K", () => {
    expect(getGptImage2OfficialRatios(AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID, "1K"))
      .not.toEqual(expect.arrayContaining(["3:2", "2:3"]));
    expect(getGptImage2OfficialRatios(AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID, "2K"))
      .toEqual(expect.arrayContaining(["3:2", "2:3"]));

    expect(isGptImage2OfficialSizeComboValid(AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID, "3:2", "1K"))
      .toBe(false);
    expect(isGptImage2OfficialSizeComboValid(AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID, "2:3", "1K"))
      .toBe(false);
    expect(isGptImage2OfficialSizeComboValid(REAPI_GPT_IMAGE_2_MODEL_ID, "3:2", "1K"))
      .toBe(true);
  });
});
