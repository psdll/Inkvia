import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  MediaProbeError,
  mergeStoredMediaProbe,
  parseFfprobeJson,
  parseFrameRate,
  probeLocalMedia,
  probeMediaBuffer,
  readStoredMediaProbe,
  resolveLocalUploadPath,
} from "@/lib/tool-media/media-probe";

describe("tool media probe", () => {
  it("extracts actual image metadata with Sharp", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGP8z8AARAwMjDAGAC4GAQBL3sXbAAAAAElFTkSuQmCC",
      "base64",
    );

    const result = await probeMediaBuffer({
      buffer: png,
      kind: "image",
      fileName: "probe.png",
      declaredMime: "image/png",
    });

    expect(result).toMatchObject({
      version: 1,
      kind: "image",
      detectedMime: "image/png",
      width: 2,
      height: 3,
      frameCount: 1,
    });
  });

  it("parses MP4, H.264, frame rate, duration and audio codecs", () => {
    const result = parseFfprobeJson({
      kind: "video",
      fileName: "clip.mp4",
      declaredMime: "video/mp4",
      stdout: JSON.stringify({
        format: { duration: "5.25", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1920,
            height: 1080,
            avg_frame_rate: "30000/1001",
            nb_frames: "158",
          },
          { codec_type: "audio", codec_name: "aac" },
        ],
      }),
    });

    expect(result).toMatchObject({
      version: 1,
      kind: "video",
      detectedMime: "video/mp4",
      container: "mp4",
      width: 1920,
      height: 1080,
      durationSeconds: 5.25,
      videoCodec: "h264",
      audioCodecs: ["aac"],
      frameCount: 158,
    });
    expect(result.frameRate).toBeCloseTo(29.97, 2);
  });

  it("normalizes MOV/H.265 and WAV/PCM probe results", () => {
    const video = parseFfprobeJson({
      kind: "video",
      fileName: "clip.mov",
      declaredMime: "video/quicktime",
      stdout: JSON.stringify({
        format: { duration: "4", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
        streams: [{
          codec_type: "video",
          codec_name: "hevc",
          width: 1280,
          height: 720,
          avg_frame_rate: "30/1",
        }],
      }),
    });
    const audio = parseFfprobeJson({
      kind: "audio",
      fileName: "voice.wav",
      declaredMime: "audio/wav",
      stdout: JSON.stringify({
        format: { duration: "3", format_name: "wav" },
        streams: [{ codec_type: "audio", codec_name: "pcm_s16le" }],
      }),
    });

    expect(video).toMatchObject({ container: "mov", detectedMime: "video/quicktime", videoCodec: "h265" });
    expect(audio).toMatchObject({
      container: "wav",
      detectedMime: "audio/wav",
      durationSeconds: 3,
      audioCodecs: ["pcm_s16le"],
    });
    expect(parseFrameRate("60000/1001")).toBeCloseTo(59.94, 2);
    expect(parseFrameRate("0/0")).toBeUndefined();
  });

  it("preserves unrelated MediaAsset metadata when caching a probe", () => {
    const probe = parseFfprobeJson({
      kind: "audio",
      fileName: "voice.mp3",
      declaredMime: "audio/mpeg",
      stdout: JSON.stringify({
        format: { duration: "5", format_name: "mp3" },
        streams: [{ codec_type: "audio", codec_name: "mp3" }],
      }),
    });
    const merged = mergeStoredMediaProbe({ origin: "tool", nested: { keep: true } }, probe);

    expect(merged).toEqual({ origin: "tool", nested: { keep: true }, mediaProbe: probe });
    expect(readStoredMediaProbe(merged)).toEqual(probe);
    expect(readStoredMediaProbe({ mediaProbe: { version: 2 } })).toBeUndefined();
  });

  it("resolves only paths contained by the configured uploads root", () => {
    const uploadsRoot = path.resolve("C:/safe/uploads");

    expect(resolveLocalUploadPath("/uploads/tool_inputs/a.mp4", uploadsRoot)).toBe(
      path.resolve(uploadsRoot, "tool_inputs/a.mp4"),
    );
    expect(() => resolveLocalUploadPath("/uploads/../secret.txt", uploadsRoot)).toThrow(MediaProbeError);
    expect(() => resolveLocalUploadPath("https://example.com/a.mp4", uploadsRoot)).toThrow(MediaProbeError);
  });

  it("invokes ffprobe with a timeout and maps process failures separately from policy errors", async () => {
    const runner = vi.fn(async () => ({
      stdout: JSON.stringify({
        format: { duration: "5", format_name: "mp3" },
        streams: [{ codec_type: "audio", codec_name: "mp3" }],
      }),
    }));
    await probeLocalMedia(
      {
        localPath: "C:/safe/voice.mp3",
        kind: "audio",
        fileName: "voice.mp3",
        declaredMime: "audio/mpeg",
      },
      { ffprobeRunner: runner },
    );

    expect(runner).toHaveBeenCalledWith(
      "ffprobe",
      expect.arrayContaining(["-of", "json", "C:/safe/voice.mp3"]),
      expect.objectContaining({ timeout: 25_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }),
    );

    await expect(
      probeLocalMedia(
        {
          localPath: "C:/safe/broken.mp4",
          kind: "video",
          fileName: "broken.mp4",
          declaredMime: "video/mp4",
        },
        { ffprobeRunner: vi.fn(async () => { throw new Error("ENOENT"); }) },
      ),
    ).rejects.toMatchObject({ code: "MEDIA_PROBE_UNAVAILABLE" });
  });
});
