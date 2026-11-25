import { describe, expect, it } from "vitest";
import { mergeSavedProvidersWithBuiltins } from "@/lib/providers/registry";
import {
  getVideoModelSpec,
  isVolcengineVideoModel,
  sora2Models,
} from "@/lib/sora2";

const SEEDANCE_25_MODEL = "doubao-seedance-2-5-260628";

describe("Seedance 2.5 catalog isolation", () => {
  it("registers the official Seedance 2.5 capabilities", () => {
    const spec = sora2Models.find((item) => item.id === SEEDANCE_25_MODEL) as
      | (ReturnType<typeof getVideoModelSpec> & {
          supportsReferenceAudio?: boolean;
          referenceLimits?: {
            images: number;
            videos: number;
            audios: number;
            total: number;
            standaloneAudio: boolean;
          };
          supportedOutputFormats?: string[];
          supportedOmniReferenceTaskTypes?: string[];
        })
      | undefined;

    expect(spec).toMatchObject({
      id: SEEDANCE_25_MODEL,
      provider: "volcengine",
      supportedInputModes: ["multimodal", "first_last_frame", "first_frame", "text_to_video"],
      supportsGenerateAudio: true,
      supportsWebSearch: true,
      supportedResolutions: ["480p", "720p", "1080p"],
      supportedRatios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
      minDurationSeconds: 4,
      maxDurationSeconds: 30,
      allowAutoDuration: true,
      supportsReferenceAudio: true,
      referenceLimits: {
        images: 30,
        videos: 10,
        audios: 10,
        total: 50,
        standaloneAudio: true,
      },
      supportedOutputFormats: ["mp4", "mov"],
      supportedOmniReferenceTaskTypes: ["auto", "edit", "extend"],
    });
    expect(isVolcengineVideoModel(SEEDANCE_25_MODEL)).toBe(true);
    expect(getVideoModelSpec(SEEDANCE_25_MODEL).id).toBe(SEEDANCE_25_MODEL);
  });

  it("opens the same reference contract for every Seedance 2.0 variant", () => {
    for (const modelId of [
      "doubao-seedance-2-0-260128",
      "doubao-seedance-2-0-fast-260128",
      "doubao-seedance-2-0-mini-260615",
      "doubao-seedance-2.0-face",
      "doubao-seedance-2.0-fast-face",
    ]) {
      expect(getVideoModelSpec(modelId)).toMatchObject({
        supportsReferenceAudio: true,
        referenceLimits: {
          images: 9,
          videos: 3,
          audios: 3,
          total: 15,
          standaloneAudio: false,
        },
      });
    }
    expect(sora2Models.some((model) => model.id === "doubao-seedance-1-5-pro-251215")).toBe(false);
  });

  it("backfills only Seedance 2.5 into a saved Volcengine model list", () => {
    const savedVideoModels = ["doubao-seedance-2-0-260128"];
    const providers = mergeSavedProvidersWithBuiltins([{
      id: "volcengine",
      name: "火山引擎",
      protocol: "volcengine",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      envKeyName: "VOLCENGINE_ARK_API_KEY",
      egressMode: "direct",
      imageModels: [],
      videoModels: savedVideoModels,
      chatModels: [],
      modelProtocols: {},
      enabled: true,
      sortOrder: 0,
    }]);

    expect(providers.find((provider) => provider.id === "volcengine")?.videoModels).toEqual([
      ...savedVideoModels,
      SEEDANCE_25_MODEL,
    ]);
  });
});
