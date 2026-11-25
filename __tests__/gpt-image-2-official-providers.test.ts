import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractAicomingImageUrls,
  getAicomingGptImage2PollPath,
} from "@/lib/aicoming-image";
import {
  GPT_IMAGE_2_OFFICIAL_4K_RATIOS,
  GPT_IMAGE_2_OFFICIAL_RATIOS,
  mapGptImage2OfficialPixels,
  normalizeGptImage2OfficialParams,
} from "@/lib/gpt-image-2-official";
import {
  REAPI_GPT_IMAGE_2_MODEL_ID,
  buildReapiGptImage2Request,
  extractReapiImageUrls,
  getReapiGptImage2PollPath,
} from "@/lib/reapi-image";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import {
  getBuiltinProviders,
  mergeSavedProvidersWithBuiltins,
} from "@/lib/providers/registry";

describe("GPT-Image-2 official provider contracts", () => {
  afterEach(() => {
    delete process.env.REAPI_BASE_URL;
    vi.resetModules();
    vi.doUnmock("@/lib/prisma");
  });

  it("removes the reAPI model while retaining the disabled provider", async () => {
    expect(IMAGE_EDIT_MODEL_DEFINITIONS).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: REAPI_GPT_IMAGE_2_MODEL_ID,
        label: "GPT-Image-2（re）",
        provider: "reapi",
        upstreamModelId: "gpt-image-2-official",
      }),
    ]));

    expect(getBuiltinProviders()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "reapi", name: "reAPI", enabled: false }),
    ]));

    const findUnique = vi.fn().mockResolvedValue(null);
    vi.doMock("@/lib/prisma", () => ({ default: { appSetting: { findUnique } } }));
    const { getImageEditModelVisibility } = await import("@/lib/image-edit-models");
    await expect(getImageEditModelVisibility()).resolves.not.toHaveProperty(REAPI_GPT_IMAGE_2_MODEL_ID);
  });

  it("uses saved URL, environment URL, then provider default without environment keys", () => {
    process.env.REAPI_BASE_URL = "https://env.reapi.test/api/v1";
    const providers = getBuiltinProviders();

    expect(providers.find((provider) => provider.id === "reapi")?.baseUrl)
      .toBe("https://env.reapi.test/api/v1");
  });

  it("collapses the legacy custom reAPI row when the canonical provider is already saved", () => {
    const builtin = getBuiltinProviders().find((provider) => provider.id === "reapi")!;
    const providers = mergeSavedProvidersWithBuiltins([
      {
        ...builtin,
        id: "custom-gpt-image-2-official",
        imageModels: [],
        apiKey: "legacy-key",
        enabled: true,
      },
      {
        ...builtin,
        apiKey: "canonical-key",
        enabled: true,
      },
    ]);

    expect(providers.filter((provider) => provider.name === "reAPI")).toHaveLength(1);
    expect(providers.find((provider) => provider.id === "reapi")).toMatchObject({
      apiKey: "canonical-key",
      imageModels: builtin.imageModels,
      enabled: true,
    });
    expect(providers.some((provider) => provider.id === "custom-gpt-image-2-official")).toBe(false);
  });

  it("migrates a legacy-only custom reAPI row onto the builtin provider", () => {
    const builtin = getBuiltinProviders().find((provider) => provider.id === "reapi")!;
    const providers = mergeSavedProvidersWithBuiltins([{
      ...builtin,
      id: "custom-gpt-image-2-official",
      imageModels: [],
      apiKey: "legacy-key",
      enabled: true,
    }]);

    expect(providers.filter((provider) => provider.name === "reAPI")).toHaveLength(1);
    expect(providers.find((provider) => provider.id === "reapi")).toMatchObject({
      apiKey: "legacy-key",
      imageModels: builtin.imageModels,
      enabled: true,
    });
  });

  it("maps all supported ratios to exact pixels and restricts 4K", () => {
    expect(GPT_IMAGE_2_OFFICIAL_RATIOS).toEqual([
      "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3",
      "5:4", "4:5", "2:1", "1:2", "21:9", "9:21",
    ]);
    expect(GPT_IMAGE_2_OFFICIAL_4K_RATIOS).toEqual([
      "16:9", "9:16", "2:1", "1:2", "21:9", "9:21",
    ]);
    expect(mapGptImage2OfficialPixels("5:4", "1K")).toBe("1280x1024");
    expect(mapGptImage2OfficialPixels("3:2", "2K")).toBe("2048x1360");
    expect(mapGptImage2OfficialPixels("21:9", "4K")).toBe("3840x1648");
    expect(mapGptImage2OfficialPixels("9:21", "4K")).toBe("1648x3840");
    expect(() => mapGptImage2OfficialPixels("1:1", "4K")).toThrow("4K");
  });

  it("normalizes visible values to medium, 2K and a valid ratio", () => {
    expect(normalizeGptImage2OfficialParams({
      quality: "auto",
      resolution: "8K",
      aspectRatio: "custom",
    })).toEqual({ quality: "medium", resolution: "2K", aspectRatio: "1:1" });
    expect(normalizeGptImage2OfficialParams({
      quality: "high",
      resolution: "4K",
      aspectRatio: "1:1",
    })).toEqual({ quality: "high", resolution: "4K", aspectRatio: "16:9" });
  });

  it("builds reAPI payloads with only fields accepted by the live endpoint", () => {
    expect(buildReapiGptImage2Request({
      prompt: " city at night ",
      aspectRatio: "3:4",
      resolution: "2K",
      quality: "high",
    })).toEqual({
      endpoint: "/images/generations",
      body: {
        model: "gpt-image-2-official",
        prompt: "city at night",
        size: "3:4",
        resolution: "2k",
        quality: "high",
        n: 1,
      },
    });

    expect(buildReapiGptImage2Request({ prompt: "auto", aspectRatio: "auto" }).body.size)
      .toBe("auto");

    expect(buildReapiGptImage2Request({
      prompt: "replace background",
      imageUrls: [" https://cdn.test/a.png ", "https://cdn.test/b.png"],
    }).body).toMatchObject({
      image_urls: ["https://cdn.test/a.png", "https://cdn.test/b.png"],
      n: 1,
    });
  });

  it("rejects non-public or excessive references before a paid submission", () => {
    expect(() => buildReapiGptImage2Request({
      prompt: "x",
      imageUrls: ["data:image/png;base64,abc"],
    })).toThrow("公开 HTTP(S) URL");
  });

  it("maps polling paths and completed response URLs", () => {
    expect(getReapiGptImage2PollPath("task/unsafe")).toBe("/tasks/task%2Funsafe");
    expect(extractReapiImageUrls({ output: { image_urls: ["https://cdn.test/a.png", ""] } }))
      .toEqual(["https://cdn.test/a.png"]);
    expect(getAicomingGptImage2PollPath("task/unsafe")).toBe("/images/generations/task%2Funsafe");
    expect(extractAicomingImageUrls({ data: [{ url: "https://cdn.test/a.png" }, { url: "" }] }))
      .toEqual(["https://cdn.test/a.png"]);
  });
});
