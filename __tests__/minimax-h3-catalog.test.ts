import { describe, expect, it } from "vitest";
import {
  MINIMAX_H3_MAX_UPSTREAM_MODEL,
  MINIMAX_H3_MODEL_ID,
  MINIMAX_H3_PAID_CONCURRENCY,
  MINIMAX_H3_UPSTREAM_MODEL,
  MINIMAX_PROVIDER_ID,
} from "@/lib/minimax-models";
import { mergeSavedProvidersWithBuiltins, saveProviders } from "@/lib/providers/registry";
import { getVideoModelSpec, normalizeVideoModelId, sora2Models } from "@/lib/sora2";
import { VIDEO_MODEL_DEFINITIONS } from "@/lib/toolbox-models";

describe("MiniMax-H3 official catalog", () => {
  it("registers the official provider and exact upstream capability", () => {
    expect(MINIMAX_PROVIDER_ID).toBe("minimax");
    expect(MINIMAX_H3_MODEL_ID).toBe("minimax-h3");
    expect(MINIMAX_H3_UPSTREAM_MODEL).toBe("MiniMax-H3");
    expect(MINIMAX_H3_PAID_CONCURRENCY).toBe(15);

    expect(sora2Models.find((item) => item.id === MINIMAX_H3_MODEL_ID)).toMatchObject({
      id: MINIMAX_H3_MODEL_ID,
      label: "MiniMax-H3",
      provider: MINIMAX_PROVIDER_ID,
      upstreamModelId: MINIMAX_H3_UPSTREAM_MODEL,
      supportedInputModes: ["multimodal", "first_last_frame", "first_frame", "text_to_video"],
      supportedResolutions: ["768p", "2k"],
      minDurationSeconds: 4,
      maxDurationSeconds: 15,
      allowAutoDuration: false,
      supportsGenerateAudio: false,
      supportsWebSearch: false,
      supportsReferenceAudio: true,
    });
    expect(getVideoModelSpec(MINIMAX_H3_MODEL_ID).id).toBe(MINIMAX_H3_MODEL_ID);
    expect(normalizeVideoModelId(MINIMAX_H3_MODEL_ID)).toBe(MINIMAX_H3_MODEL_ID);
    expect(VIDEO_MODEL_DEFINITIONS.find((item) => item.id === MINIMAX_H3_MODEL_ID)).toMatchObject({
      provider: MINIMAX_PROVIDER_ID,
      upstreamModelId: MINIMAX_H3_UPSTREAM_MODEL,
    });
  });

  it("removes only the legacy H3 capability from the shared AIComing provider", () => {
    const providers = mergeSavedProvidersWithBuiltins([{
      id: "aicoming-haiya",
      name: "海牙科技（AIComing）",
      protocol: "openai",
      baseUrl: "https://api.aicoming.top/v1",
      envKeyName: "",
      egressMode: "direct",
      imageModels: ["gpt-image-2-1k", "gpt-image-2-2k", "gpt-image-2-4k"],
      videoModels: ["minimax-h3"],
      chatModels: [],
      modelProtocols: {},
      enabled: true,
      sortOrder: 0,
    }]);

    const aicoming = providers.find((item) => item.id === "aicoming-haiya");
    const minimax = providers.find((item) => item.id === MINIMAX_PROVIDER_ID);

    expect(aicoming).toBeTruthy();
    expect(aicoming?.imageModels).toEqual([
      "gpt-image-2-1k",
      "gpt-image-2-2k",
      "gpt-image-2-4k",
      "gpt-image-2.5-flare",
      "gpt-image-2.5-sunburst",
      "nano-banana-pro",
    ]);
    expect(aicoming?.videoModels).not.toContain("minimax-h3");
    expect(minimax).toMatchObject({
      id: MINIMAX_PROVIDER_ID,
      name: "MiniMax 官方",
      baseUrl: "https://api.minimaxi.com",
      envKeyName: "",
      egressMode: "direct",
      enabled: false,
      videoModels: [MINIMAX_H3_UPSTREAM_MODEL, MINIMAX_H3_MAX_UPSTREAM_MODEL],
    });
  });

  it("does not keep the retired local model in the active video catalog", () => {
    expect(sora2Models.some((item) => item.id === "minimax-h3-aicoming-haiya")).toBe(false);
    expect(VIDEO_MODEL_DEFINITIONS.some((item) => item.id === "minimax-h3-aicoming-haiya")).toBe(false);
  });

  it("removes the legacy H3 field when the shared AIComing provider is next saved", async () => {
    let stored = "";
    await saveProviders([{
      id: "aicoming-haiya",
      name: "海牙科技（AIComing）",
      protocol: "openai",
      baseUrl: "https://api.aicoming.top/v1",
      envKeyName: "",
      egressMode: "direct",
      apiKey: "saved-key",
      imageModels: ["gpt-image-2-1k"],
      videoModels: ["minimax-h3", "another-video-model"],
      chatModels: [],
      modelProtocols: {},
      enabled: true,
      sortOrder: 0,
    }], {
      appSetting: {
        upsert: async ({ create, update }: any) => {
          stored = String(create?.value || update?.value || "");
          return { key: "providers.registry", value: stored };
        },
      },
    } as any);

    const [saved] = JSON.parse(stored);
    expect(saved).toMatchObject({
      id: "aicoming-haiya",
      apiKey: "saved-key",
      imageModels: ["gpt-image-2-1k"],
      videoModels: ["another-video-model"],
    });
  });
});
