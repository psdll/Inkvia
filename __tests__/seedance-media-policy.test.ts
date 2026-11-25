import { describe, expect, it } from "vitest";

import {
  getSeedanceMediaPolicy,
  getSeedanceUploadContract,
  modelAllowsRealPersonFace,
  validateSeedanceMediaFile,
  validateSeedanceMediaSet,
  type SeedanceMediaProbe,
} from "@/lib/seedance-media-policy";
import {
  getVideoReferenceLimits,
  modelSupportsReferenceAudio,
  sora2Models,
} from "@/lib/sora2";

function probe(
  kind: SeedanceMediaProbe["kind"],
  overrides: Partial<SeedanceMediaProbe> = {},
): SeedanceMediaProbe {
  return {
    version: 1,
    kind,
    detectedMime:
      kind === "image"
        ? "image/jpeg"
        : kind === "video"
          ? "video/mp4"
          : "audio/mpeg",
    ...(kind === "image"
      ? { width: 1280, height: 720 }
      : kind === "video"
        ? {
            container: "mp4",
            width: 1280,
            height: 720,
            durationSeconds: 5,
            frameRate: 30,
            videoCodec: "h264",
            audioCodecs: ["aac"],
          }
        : {
            container: "mp3",
            durationSeconds: 5,
            audioCodecs: ["mp3"],
          }),
    ...overrides,
  };
}

describe("Seedance media policy registry", () => {
  it("covers every Seedance model exposed by the video catalog", () => {
    const seedanceModelIds = sora2Models
      .map((model) => model.id)
      .filter((modelId) => modelId.includes("seedance"));

    expect(seedanceModelIds.length).toBeGreaterThan(0);
    expect(
      seedanceModelIds.filter((modelId) => !getSeedanceMediaPolicy(modelId)),
    ).toEqual([]);
  });

  it("maps official 2.0 variants and APIMart face variants to the same material limits", () => {
    const official = getSeedanceMediaPolicy("doubao-seedance-2-0-260128");
    const fast = getSeedanceMediaPolicy("doubao-seedance-2-0-fast-260128");
    const mini = getSeedanceMediaPolicy("doubao-seedance-2-0-mini-260615");
    const face = getSeedanceMediaPolicy("doubao-seedance-2.0-face");
    const fastFace = getSeedanceMediaPolicy("doubao-seedance-2.0-fast-face");

    for (const policy of [official, fast, mini, face, fastFace]) {
      expect(policy?.ruleFamily).toBe("seedance-2.0");
      expect(policy?.limits).toMatchObject({
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
        maxTotal: 15,
        allowStandaloneAudio: false,
      });
    }

    expect(modelAllowsRealPersonFace("doubao-seedance-2-0-260128")).toBe(false);
    expect(modelAllowsRealPersonFace("doubao-seedance-2.0-face")).toBe(true);
    expect(modelAllowsRealPersonFace("doubao-seedance-2.0-fast-face")).toBe(true);

    for (const modelId of [
      "doubao-seedance-2-0-260128",
      "doubao-seedance-2-0-fast-260128",
      "doubao-seedance-2-0-mini-260615",
      "doubao-seedance-2.0-face",
      "doubao-seedance-2.0-fast-face",
    ]) {
      expect(modelSupportsReferenceAudio(modelId)).toBe(true);
      expect(getVideoReferenceLimits(modelId)).toEqual({
        images: 9,
        videos: 3,
        audios: 3,
        total: 15,
        standaloneAudio: false,
      });
    }
  });

  it("keeps Seedance 2.5 limits independent from Seedance 2.0", () => {
    const policy = getSeedanceMediaPolicy("doubao-seedance-2-5-260628");

    expect(policy?.ruleFamily).toBe("seedance-2.5");
    expect(policy?.limits).toMatchObject({
      maxImages: 30,
      maxVideos: 10,
      maxAudios: 10,
      maxTotal: 50,
      allowStandaloneAudio: true,
    });
    expect(policy?.video.durationSeconds).toEqual({ min: 2, max: 30 });
    expect(policy?.video.editDurationSeconds).toEqual({ min: 4, max: 30 });
    expect(policy?.audio.durationSeconds).toEqual({ min: 2, max: 30 });
  });

  it("derives upload contracts from the selected model policy", () => {
    expect(getSeedanceUploadContract("doubao-seedance-2-0-260128")).toMatchObject({
      allowedKinds: ["image", "video", "audio"],
      maxBytes: {
        image: 30 * 1024 * 1024,
        video: 200 * 1024 * 1024,
        audio: 15 * 1024 * 1024,
      },
      allowedAudioMimeTypes: [
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/x-wav",
        "audio/wave",
        "audio/vnd.wave",
      ],
    });
    expect(getSeedanceUploadContract("unknown-model")).toBeNull();
  });

  it("reports objective file-level violations before provider submission", () => {
    const issues = validateSeedanceMediaFile({
      modelId: "doubao-seedance-2-0-260128",
      fileName: "bad.mov",
      byteSize: 201 * 1024 * 1024,
      probe: probe("video", {
        detectedMime: "video/quicktime",
        container: "mov",
        width: 200,
        height: 720,
        durationSeconds: 16,
        frameRate: 23,
        videoCodec: "vp9",
      }),
    });

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "video_file_too_large",
        "video_dimension_out_of_range",
        "video_duration_out_of_range",
        "video_frame_rate_out_of_range",
        "video_codec_unsupported",
      ]),
    );
  });

  it("reports the exact duration overage to three decimals while keeping the maximum inclusive", () => {
    const boundaryIssues = validateSeedanceMediaFile({
      modelId: "doubao-seedance-2-0-260128",
      fileName: "boundary.mp4",
      byteSize: 1024,
      probe: probe("video", { durationSeconds: 15 }),
    });
    const overageIssues = validateSeedanceMediaFile({
      modelId: "doubao-seedance-2-0-260128",
      fileName: "overage.mp4",
      byteSize: 1024,
      probe: probe("video", { durationSeconds: 15.092971 }),
    });

    expect(boundaryIssues.map((issue) => issue.code)).not.toContain(
      "video_duration_out_of_range",
    );
    expect(
      overageIssues.find((issue) => issue.code === "video_duration_out_of_range"),
    ).toMatchObject({
      message:
        "视频实际时长 15.093 秒，超过模型上限 0.093 秒；允许范围为 2–15 秒。",
      actual: 15.092971,
      expected: "2–15s",
    });
  });

  it("validates cross-file counts and standalone-audio rules", () => {
    const tooManyVideos = validateSeedanceMediaSet({
      modelId: "doubao-seedance-2-0-260128",
      media: Array.from({ length: 4 }, (_, index) => ({
        mediaId: `video-${index}`,
        fileName: `video-${index}.mp4`,
        byteSize: 1024,
        probe: probe("video"),
      })),
    });
    const standaloneAudio = validateSeedanceMediaSet({
      modelId: "doubao-seedance-2-0-260128",
      media: [
        {
          mediaId: "audio-1",
          fileName: "audio.mp3",
          byteSize: 1024,
          probe: probe("audio"),
        },
      ],
    });

    expect(tooManyVideos.map((issue) => issue.code)).toContain("too_many_videos");
    expect(standaloneAudio.map((issue) => issue.code)).toContain(
      "standalone_audio_not_allowed",
    );
  });
});
