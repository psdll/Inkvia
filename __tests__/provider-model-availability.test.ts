import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "@/lib/providers/types";
import {
  filterEnabledAdapterModels,
  getProviderModelCapability,
  hasConfiguredProviderModels,
  isProviderModelEnabled,
} from "@/lib/providers/model-availability";

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "kie",
    name: "KIE.AI",
    protocol: "openai",
    baseUrl: "https://api.kie.ai",
    egressMode: "direct",
    imageModels: ["gpt-image-2"],
    videoModels: [],
    chatModels: ["gpt-5.5"],
    modelProtocols: {},
    enabled: true,
    sortOrder: 0,
    ...overrides,
  };
}

describe("provider model availability", () => {
  it("derives image usages from the pages that expose the adapter", () => {
    expect(getProviderModelCapability("kie", "image", "gpt-image-2")).toEqual({
      adapterBacked: true,
      usages: ["创作", "批量", "画布"],
    });
    expect(getProviderModelCapability("reapi", "image", "midjourney")).toEqual({
      adapterBacked: true,
      usages: ["创作", "画布"],
    });
    expect(getProviderModelCapability("kie", "image", "unknown-image-model")).toEqual({
      adapterBacked: false,
      usages: [],
    });
  });

  it("does not expose retired KIE video adapters even with saved configuration", () => {
    expect(getProviderModelCapability("kie", "video", "gemini-omni-video")).toEqual({
      adapterBacked: false,
      usages: [],
    });
    expect(getProviderModelCapability("kie", "video", "grok-video-1.5")).toEqual({
      adapterBacked: false,
      usages: [],
    });
    const saved = provider({ videoModels: ["gemini-omni-video", "grok-video-1.5", "grok-imagine-video-1-5-preview"] });
    expect(filterEnabledAdapterModels([saved], "video")).toEqual([]);
    for (const model of saved.videoModels) expect(isProviderModelEnabled([saved], "video", model)).toBe(false);
  });

  it("only exposes a selected adapter model from an enabled provider", () => {
    expect(isProviderModelEnabled([provider()], "image", "gpt-image-2")).toBe(true);
    expect(isProviderModelEnabled([provider()], "image", "gpt-image-2-text-to-image")).toBe(true);
    expect(isProviderModelEnabled([provider({ imageModels: [] })], "image", "gpt-image-2")).toBe(false);
    expect(isProviderModelEnabled([provider({ enabled: false })], "image", "gpt-image-2")).toBe(false);
    expect(filterEnabledAdapterModels([provider()], "image").map((model) => model.id)).toContain("gpt-image-2");
  });

  it("detects configured models even when the provider cannot fetch an upstream catalog", () => {
    expect(hasConfiguredProviderModels(provider({
      id: "reapi",
      imageModels: ["gpt-image-2-official"],
      videoModels: [],
      chatModels: [],
    }))).toBe(true);
    expect(hasConfiguredProviderModels(provider({
      imageModels: [],
      videoModels: [],
      chatModels: [],
    }))).toBe(false);
  });
});
