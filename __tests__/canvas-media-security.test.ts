import { describe, expect, it } from "vitest";
import { validateCanvasMediaProbe } from "@/lib/canvas/media-security";

describe("canvas media security policy", () => {
  it("accepts bounded image and video probe results", () => {
    expect(validateCanvasMediaProbe({ kind: "image", width: 4096, height: 4096, decodedBytes: 67_108_864 }, 2_000_000)).toEqual([]);
    expect(validateCanvasMediaProbe({ kind: "video", width: 3840, height: 2160, durationSeconds: 600, frameCount: 18_000, trackCount: 2 }, 20_000_000)).toEqual([]);
  });

  it("rejects decompression bombs and extreme dimensions", () => {
    expect(validateCanvasMediaProbe({ kind: "image", width: 20_001, height: 100, decodedBytes: 8_000_000 }, 10_000)).toEqual(expect.arrayContaining([
      "MEDIA_DIMENSIONS_EXCEEDED",
      "MEDIA_COMPRESSION_RATIO_EXCEEDED",
    ]));
  });

  it("rejects excessive duration, frame and track counts", () => {
    expect(validateCanvasMediaProbe({
      kind: "video",
      width: 1920,
      height: 1080,
      durationSeconds: 7_201,
      frameCount: 1_000_001,
      trackCount: 17,
    }, 100_000_000)).toEqual([
      "MEDIA_DURATION_EXCEEDED",
      "MEDIA_FRAME_COUNT_EXCEEDED",
      "MEDIA_TRACK_COUNT_EXCEEDED",
    ]);
  });
});
