import { describe, expect, it } from "vitest";
import {
  LiveVideoApiError,
  normalizeLiveVideoModelSettings,
  retryLiveVideoVersionConflict,
  type LiveVideoModel,
} from "@/hooks/use-live-video-batch-workspace";

function model(overrides: Partial<LiveVideoModel> = {}): LiveVideoModel {
  return {
    id: "model-a",
    label: "Model A",
    provider: "test",
    providerName: "Test",
    supportedResolutions: ["720p", "1080p"],
    supportedRatios: ["adaptive", "9:16"],
    durationOptions: [4, 5, 6, 7, 8],
    supportsGenerateAudio: true,
    supportedInputModes: ["first_frame", "multimodal"],
    ...overrides,
  };
}

describe("live video batch client settings", () => {
  it.each([
    "doubao-seedance-2-0-260128",
    "doubao-seedance-2-5-260628",
    "doubao-seedance-2-0-fast-260128",
    "doubao-seedance-2-0-mini-260615",
    "doubao-seedance-2.0-face",
    "doubao-seedance-2.0-fast-face",
  ])("defaults %s to 720p when first selected", (modelId) => {
    const seedance = model({
      id: modelId,
      supportedResolutions: ["480p", "720p"],
    });

    expect(normalizeLiveVideoModelSettings(seedance).resolution).toBe("720p");
    expect(normalizeLiveVideoModelSettings(seedance, {
      model: "previous-model",
      resolution: "480p",
    }).resolution).toBe("720p");
  });

  it("keeps a saved Seedance resolution and leaves other model defaults unchanged", () => {
    const seedance = model({
      id: "doubao-seedance-2-0-260128",
      supportedResolutions: ["480p", "720p"],
    });
    expect(normalizeLiveVideoModelSettings(seedance, {
      model: seedance.id,
      resolution: "480p",
    }).resolution).toBe("480p");
    expect(normalizeLiveVideoModelSettings(model({
      id: "other-video-model",
      supportedResolutions: ["480p", "720p"],
    })).resolution).toBe("480p");
  });

  it("reloads the latest version and retries one conflicting mutation", async () => {
    const attemptedVersions: number[] = [];

    const result = await retryLiveVideoVersionConflict(
      3,
      async (version) => {
        attemptedVersions.push(version);
        if (version === 3) {
          throw new LiveVideoApiError(
            "分组已在其他页面更新，请刷新后重试",
            409,
            "LIVE_VIDEO_VERSION_CONFLICT",
          );
        }
        return { version };
      },
      async () => 4,
    );

    expect(result).toEqual({ version: 4 });
    expect(attemptedVersions).toEqual([3, 4]);
  });

  it("keeps supported non-duration values while using the shortest duration", () => {
    expect(normalizeLiveVideoModelSettings(model(), {
      model: "old",
      ratio: "9:16",
      resolution: "1080p",
      duration: 7,
      inputMode: "multimodal",
      generateAudio: true,
    })).toMatchObject({
      model: "model-a",
      ratio: "9:16",
      resolution: "1080p",
      duration: 4,
      inputMode: "multimodal",
      generateAudio: true,
    });
  });

  it("falls back invalid values to the new model capabilities", () => {
    expect(normalizeLiveVideoModelSettings(model(), {
      ratio: "1:1",
      resolution: "4k",
      duration: 12,
    })).toMatchObject({ ratio: "adaptive", resolution: "720p", duration: 4 });
    expect(normalizeLiveVideoModelSettings(model(), {
      inputMode: "first_last_frame" as never,
    }).inputMode).toBe("multimodal");
  });

  it("always uses the selected model's shortest duration", () => {
    expect(normalizeLiveVideoModelSettings(model({ durationOptions: [8, 6] }), {
      duration: 8,
    }).duration).toBe(6);
  });

  it("forces audio off when the model does not support it", () => {
    expect(normalizeLiveVideoModelSettings(model({ supportsGenerateAudio: false }), {
      generateAudio: true,
    }).generateAudio).toBe(false);
  });
});
