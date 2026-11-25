import { describe, expect, it } from "vitest";
import { getCanvasImageModelParams } from "@/lib/canvas/image-task";
import {
  getProviderModelCapability,
  isProviderModelEnabled,
} from "@/lib/providers/model-availability";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins } from "@/lib/providers/registry";
import { IMAGE_EDIT_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import { createImageTaskSchema } from "@/lib/generation/task-input-schema";

describe("EasyRouter Image 2 model configuration", () => {
  it("removes the EasyRouter platform and its image models", () => {
    expect(IMAGE_EDIT_MODEL_DEFINITIONS).not.toContainEqual(expect.objectContaining({
      id: "image 2",
      provider: "easyrouter",
      category: "image",
    }));

    expect(getBuiltinProviders()).not.toContainEqual(expect.objectContaining({
      id: "easyrouter",
      name: "EasyRouter",
      protocol: "openai",
      baseUrl: "https://easyrouter.io/v1",
      envKeyName: "EASYROUTER_API_KEY",
      egressMode: "proxy",
      imageModels: [],
    }));

    expect(getProviderModelCapability("easyrouter", "image", "gpt-image-2")).toMatchObject({
      adapterBacked: false,
    });
    expect(isProviderModelEnabled([{
      id: "easyrouter",
      name: "EasyRouter",
      protocol: "openai",
      baseUrl: "https://easyrouter.io/v1",
      envKeyName: "EASYROUTER_API_KEY",
      egressMode: "proxy",
      imageModels: ["gpt-image-2"],
      videoModels: [],
      chatModels: [],
      modelProtocols: {},
      enabled: true,
      sortOrder: 0,
    }], "image", "image 2")).toBe(false);

    expect(mergeSavedProvidersWithBuiltins([{
      id: "easyrouter",
      name: "EasyRouter",
      protocol: "openai",
      baseUrl: "https://easyrouter.io/v1",
      egressMode: "proxy",
      imageModels: ["image 2"],
      videoModels: [],
      chatModels: [],
      modelProtocols: {},
      enabled: true,
      sortOrder: 0,
    }]).find((provider) => provider.id === "easyrouter")).toBeUndefined();
  });

  it("uses the approved Image 2 ratios, resolutions, and custom size in canvas", () => {
    const params = getCanvasImageModelParams("image 2");

    expect(params.aspectRatios.map((item) => item.value)).toEqual([
      "1:1", "3:4", "4:3", "9:16", "16:9", "custom",
    ]);
    expect(params.resolutions.map((item) => item.value)).toEqual(["1K", "2K", "4K"]);
    expect(params.qualities.map((item) => item.value)).toEqual(["low", "medium", "high"]);
  });

  it("allows up to 16 EasyRouter Image 2 references in agent tasks", () => {
    const imagePaths = Array.from({ length: 16 }, (_, index) => `/uploads/reference-${index + 1}.png`);

    expect(createImageTaskSchema.safeParse({
      prompt: "combine all references",
      model: "image 2",
      imagePaths,
    }).success).toBe(true);
    expect(createImageTaskSchema.safeParse({
      prompt: "too many references",
      model: "image 2",
      imagePaths: [...imagePaths, "/uploads/reference-17.png"],
    }).success).toBe(false);
  });
});
