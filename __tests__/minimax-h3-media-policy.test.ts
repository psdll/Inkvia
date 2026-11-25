import { describe, expect, it } from "vitest";
import {
  getMiniMaxH3UploadContract,
  validateMiniMaxH3MediaFile,
  validateMiniMaxH3MediaSet,
} from "@/lib/minimax-h3-media-policy";

const MIB = 1024 * 1024;

function media(overrides: Record<string, unknown> = {}) {
  return {
    fileName: "asset.png",
    byteSize: MIB,
    probe: {
      version: 1 as const,
      kind: "image" as const,
      detectedMime: "image/png",
      width: 1024,
      height: 1024,
    },
    ...overrides,
  };
}

describe("MiniMax-H3 media policy", () => {
  it("declares the exact upload limits without changing Seedance policy", () => {
    expect(getMiniMaxH3UploadContract("minimax-h3")).toEqual(expect.objectContaining({
      allowedKinds: ["image", "video", "audio"],
      maxBytes: { image: 30 * MIB, video: 50 * MIB, audio: 15 * MIB },
    }));
    expect(getMiniMaxH3UploadContract("doubao-seedance-2-0-260128")).toBeNull();
  });

  it("accepts the documented inclusive image boundaries", () => {
    expect(validateMiniMaxH3MediaSet({
      modelId: "minimax-h3",
      media: [media({
        byteSize: 30 * MIB,
        probe: {
          version: 1,
          kind: "image",
          detectedMime: "image/heic",
          width: 256,
          height: 640,
        },
      })],
    })).toEqual([]);
  });

  it("rejects H3 video size and frame-rate values outside the official boundary", () => {
    const issues = validateMiniMaxH3MediaSet({
      modelId: "minimax-h3",
      media: [media({
        fileName: "clip.mp4",
        byteSize: 50 * MIB + 1,
        probe: {
          version: 1,
          kind: "video",
          detectedMime: "video/mp4",
          container: "mp4",
          width: 1920,
          height: 1080,
          durationSeconds: 15,
          frameRate: 23.975,
          videoCodec: "h264",
          audioCodecs: ["aac"],
        },
      })],
    });

    expect(issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      "video_file_too_large",
      "video_frame_rate_out_of_range",
    ]));
  });

  it("reports the exact duration overage to three decimals while keeping the maximum inclusive", () => {
    const video = {
      fileName: "clip.mp4",
      byteSize: MIB,
      probe: {
        version: 1 as const,
        kind: "video" as const,
        detectedMime: "video/mp4",
        container: "mp4",
        width: 1344,
        height: 768,
        frameRate: 24,
        videoCodec: "h264",
        audioCodecs: ["aac"],
      },
    };

    expect(validateMiniMaxH3MediaFile({
      ...video,
      probe: { ...video.probe, durationSeconds: 15 },
    })).toEqual([]);
    expect(validateMiniMaxH3MediaFile({
      ...video,
      probe: { ...video.probe, durationSeconds: 15.083333 },
    })).toContainEqual(expect.objectContaining({
      code: "video_duration_out_of_range",
      message:
        "视频实际时长 15.083 秒，超过模型上限 0.083 秒；允许范围为 2–15 秒。",
      actual: 15.083333,
      expected: "2–15s",
    }));
  });

  it("allows standalone audio but enforces aggregate timed-media duration", () => {
    expect(validateMiniMaxH3MediaSet({
      modelId: "minimax-h3",
      media: [media({
        fileName: "voice.mp3",
        probe: {
          version: 1,
          kind: "audio",
          detectedMime: "audio/mpeg",
          container: "mp3",
          durationSeconds: 15,
          audioCodecs: ["mp3"],
        },
      })],
    })).toEqual([]);

    const issues = validateMiniMaxH3MediaSet({
      modelId: "minimax-h3",
      media: [
        media({
          fileName: "a.mp3",
          probe: { version: 1, kind: "audio", detectedMime: "audio/mpeg", container: "mp3", durationSeconds: 8, audioCodecs: ["mp3"] },
        }),
        media({
          fileName: "b.wav",
          probe: { version: 1, kind: "audio", detectedMime: "audio/wav", container: "wav", durationSeconds: 8, audioCodecs: ["pcm"] },
        }),
      ],
    });
    expect(issues.map((item) => item.code)).toContain("timed_media_duration_exceeded");
  });
});
