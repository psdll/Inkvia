import { describe, expect, it } from "vitest";
import { sora2Models, type Sora2ModelSpec } from "@/lib/sora2";
import {
  LIVE_VIDEO_BATCH_DEFAULT_DURATION_SECONDS,
  LIVE_VIDEO_BATCH_MAX_MEDIA,
} from "@/lib/live-video-batch/contracts";
import {
  filterLiveVideoBatchModelSpecs,
  getLiveVideoBatchInputModes,
  getLiveVideoBatchSnapshotModelSpec,
  getLiveVideoDurationOptions,
  supportsLiveVideoBatchModel,
  supportsLiveVideoDuration,
} from "@/lib/live-video-batch/video-models";

function spec(overrides: Partial<Sora2ModelSpec> = {}): Sora2ModelSpec {
  return {
    id: "test-video-model",
    label: "test-video-model",
    provider: "kie",
    supportedInputModes: ["multimodal"],
    supportsGenerateAudio: false,
    supportsWebSearch: false,
    supportedResolutions: ["720p"],
    minDurationSeconds: 1,
    maxDurationSeconds: 10,
    allowAutoDuration: false,
    ...overrides,
  };
}

describe("live video batch contracts", () => {
  it("uses four seconds only as the backward-compatible default", () => {
    expect(LIVE_VIDEO_BATCH_DEFAULT_DURATION_SECONDS).toBe(4);
    expect(LIVE_VIDEO_BATCH_MAX_MEDIA).toBe(10);
  });

  it("exposes full continuous and discrete duration options", () => {
    expect(getLiveVideoDurationOptions(spec({
      minDurationSeconds: 4,
      maxDurationSeconds: 7,
    }))).toEqual([4, 5, 6, 7]);
    expect(getLiveVideoDurationOptions(spec({
      durationOptions: [4, 6, 8, 10],
    }))).toEqual([4, 6, 8, 10]);
    expect(supportsLiveVideoDuration(spec(), 7)).toBe(true);
    expect(supportsLiveVideoDuration(spec({ durationOptions: [4, 8] }), 6)).toBe(false);
  });

  it("accepts only multimodal models with at least one valid duration", () => {
    expect(supportsLiveVideoBatchModel(spec())).toBe(true);
    expect(supportsLiveVideoBatchModel(spec({
      supportedInputModes: ["text_to_video"],
    }))).toBe(false);
    expect(supportsLiveVideoBatchModel(spec({
      supportedInputModes: ["first_frame"],
    }))).toBe(false);
    expect(supportsLiveVideoBatchModel(spec({
      minDurationSeconds: 5,
      maxDurationSeconds: 10,
    }))).toBe(true);
    expect(supportsLiveVideoBatchModel(spec({
      durationOptions: [5, 10],
    }))).toBe(true);
  });

  it("fixes Live batches to multimodal without exposing other modes", () => {
    expect(getLiveVideoBatchInputModes(spec({
      supportedInputModes: ["text_to_video", "first_frame", "first_last_frame", "multimodal"],
    }))).toEqual(["multimodal"]);
  });

  it("filters the technical model list by the administrator-enabled ids", () => {
    const compatible = sora2Models.find((model) =>
      model.supportedInputModes.includes("multimodal"),
    );
    expect(compatible).toBeTruthy();

    expect(filterLiveVideoBatchModelSpecs([
      compatible!.id,
      "provider-only-model",
    ]).map((model) => model.id)).toEqual([compatible!.id]);
    expect(filterLiveVideoBatchModelSpecs([])).toEqual([]);
  });

  it("keeps legacy first-frame snapshots readable without re-exposing that mode", () => {
    expect(getLiveVideoBatchSnapshotModelSpec("grok-video-1.5")?.id).toBe("grok-video-1.5");
    expect(filterLiveVideoBatchModelSpecs(["grok-video-1.5"])).toEqual([]);
    expect(getLiveVideoBatchSnapshotModelSpec("unknown-model")).toBeNull();
    expect(getLiveVideoBatchSnapshotModelSpec("")).toBeNull();
  });

});
