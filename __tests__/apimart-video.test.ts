import { describe, expect, it } from "vitest";
import {
  APIMART_SEEDANCE_FACE_MODEL,
  APIMART_SEEDANCE_FAST_FACE_MODEL,
  buildApimartVideoRequest,
  extractApimartLastFrameUrl,
  extractApimartVideoUrls,
} from "@/lib/apimart-video";
import { getVideoModelSpec } from "@/lib/sora2";

describe("APIMart Seedance face video mapping", () => {
  it("exposes the documented base video capabilities for face models", () => {
    expect(getVideoModelSpec(APIMART_SEEDANCE_FACE_MODEL).supportedInputModes).toEqual([
      "multimodal",
      "first_last_frame",
      "first_frame",
      "text_to_video",
    ]);
    expect(getVideoModelSpec(APIMART_SEEDANCE_FAST_FACE_MODEL).supportedInputModes).toEqual([
      "first_last_frame",
      "first_frame",
      "multimodal",
      "text_to_video",
    ]);
  });

  it("builds a face video request with ordinary image, video and audio references", () => {
    const request = buildApimartVideoRequest({
      model: APIMART_SEEDANCE_FACE_MODEL,
      prompt: "A presenter walks through a studio",
      mediaFiles: [
        { type: "image", url: "https://example.com/person.png", role: "reference_image" },
        { type: "video", url: "https://example.com/motion.mp4" },
        { type: "audio", url: "https://example.com/sound.mp3" },
      ],
      resolution: "1080p",
      size: "16:9",
      duration: 20,
      generateAudio: true,
      returnLastFrame: true,
      webSearch: true,
    });

    expect(request).toMatchObject({
      model: "doubao-seedance-2.0-face",
      prompt: "A presenter walks through a studio",
      resolution: "1080p",
      size: "16:9",
      duration: 15,
      generate_audio: true,
      return_last_frame: true,
      tools: [{ type: "web_search" }],
      image_with_roles: [{ url: "https://example.com/person.png", role: "reference_image" }],
      video_urls: ["https://example.com/motion.mp4"],
      audio_urls: ["https://example.com/sound.mp3"],
    });
    expect(request).not.toHaveProperty("watermark");
  });

  it("preserves image order and roles on a face video request", () => {
    const request = buildApimartVideoRequest({
      model: APIMART_SEEDANCE_FACE_MODEL,
      prompt: "Two presenters talk in a studio",
      mediaFiles: [
        { type: "image", url: "https://example.com/start.png", role: "first_frame" },
        { type: "image", url: "https://example.com/end.png", role: "last_frame" },
      ],
    });

    expect(request).toMatchObject({
      image_with_roles: [
        { url: "https://example.com/start.png", role: "first_frame" },
        { url: "https://example.com/end.png", role: "last_frame" },
      ],
    });
  });

  it("keeps fast face resolution within supported options", () => {
    const request = buildApimartVideoRequest({
      model: APIMART_SEEDANCE_FAST_FACE_MODEL,
      prompt: "Fast video",
      resolution: "1080p",
      duration: 3,
    });

    expect(request).toMatchObject({
      model: "doubao-seedance-2.0-fast-face",
      resolution: "720p",
      duration: 4,
      generate_audio: false,
    });
  });

  it("uses APIMart documented defaults when optional size and duration are omitted", () => {
    const request = buildApimartVideoRequest({
      model: APIMART_SEEDANCE_FACE_MODEL,
      prompt: "Default params",
    });

    expect(request).toMatchObject({
      size: "16:9",
      duration: 5,
    });
  });

  it("builds a text-to-video face request without references", () => {
    const request = buildApimartVideoRequest({
      model: APIMART_SEEDANCE_FACE_MODEL,
      prompt: "A presenter walks through a city street",
      resolution: "720p",
      size: "9:16",
      duration: 5,
      generateAudio: true,
    });

    expect(request).toMatchObject({
      model: "doubao-seedance-2.0-face",
      prompt: "A presenter walks through a city street",
      resolution: "720p",
      size: "9:16",
      duration: 5,
      generate_audio: true,
    });
    expect(request).not.toHaveProperty("image_with_roles");
  });

  it("does not submit retired asset URLs as ordinary reference images", () => {
    expect(() => buildApimartVideoRequest({
      model: APIMART_SEEDANCE_FACE_MODEL,
      prompt: "Video",
      mediaFiles: [{ type: "image", url: "asset://asset_a" }],
    })).toThrow("参考素材地址不受支持");
  });

  it("extracts completed APIMart video urls", () => {
    const urls = extractApimartVideoUrls({
      data: {
        result: {
          videos: [
            { url: ["https://example.com/a.mp4", "https://example.com/b.mp4"] },
            { video_url: "https://example.com/c.mp4" },
            { url: ["https://example.com/a.mp4"] },
          ],
        },
      },
    });

    expect(urls).toEqual([
      "https://example.com/a.mp4",
      "https://example.com/b.mp4",
      "https://example.com/c.mp4",
    ]);
  });

  it("extracts alternate completed APIMart video result shapes", () => {
    expect(
      extractApimartVideoUrls({
        data: {
          result: {
            video_urls: ["https://example.com/a.mp4"],
            outputs: [{ download_url: "https://example.com/b.mp4" }],
          },
        },
      })
    ).toEqual(["https://example.com/a.mp4", "https://example.com/b.mp4"]);
  });

  it("extracts APIMart returned last frame urls", () => {
    expect(
      extractApimartLastFrameUrl({
        data: {
          result: {
            videos: [
              {
                url: ["https://example.com/video.mp4"],
                last_frame_url: "https://example.com/last-frame.png",
              },
            ],
          },
        },
      })
    ).toBe("https://example.com/last-frame.png");
  });

  it("extracts APIMart top-level result last frame urls", () => {
    expect(
      extractApimartLastFrameUrl({
        data: {
          status: "completed",
          result: {
            last_frame_url: "https://example.com/result-last-frame.jpg",
            videos: [{ url: ["https://example.com/video.mp4"] }],
          },
        },
      })
    ).toBe("https://example.com/result-last-frame.jpg");
  });
});
