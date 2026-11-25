import { describe, expect, it } from "vitest";
import {
  buildMiniMaxH3Request,
  getMiniMaxH3PollPath,
} from "@/lib/minimax-video";

describe("MiniMax-H3 official request adapter", () => {
  it("builds the exact text-to-video V2 request", () => {
    expect(buildMiniMaxH3Request({
      prompt: "city at night",
      inputMode: "text_to_video",
      resolution: "2k",
      ratio: "16:9",
      duration: 8,
      watermark: true,
      media: [],
    })).toEqual({
      endpoint: "/v2/video_generation",
      body: {
        model: "MiniMax-H3",
        content: [{ type: "text", text: "city at night" }],
        resolution: "2K",
        duration: 8,
        ratio: "16:9",
        aigc_watermark: true,
      },
    });
  });

  it("maps first and last frames into ordered content roles with adaptive ratio", () => {
    expect(buildMiniMaxH3Request({
      prompt: "grow up",
      inputMode: "first_last_frame",
      resolution: "768p",
      ratio: "9:16",
      duration: 6,
      watermark: false,
      media: [
        { type: "image", url: "https://assets.test/first.png" },
        { type: "image", url: "https://assets.test/last.png" },
      ],
    }).body).toEqual({
      model: "MiniMax-H3",
      content: [
        { type: "text", text: "grow up" },
        { type: "image_url", image_url: { url: "https://assets.test/first.png" }, role: "first_frame" },
        { type: "image_url", image_url: { url: "https://assets.test/last.png" }, role: "last_frame" },
      ],
      resolution: "768P",
      duration: 6,
      ratio: "adaptive",
      aigc_watermark: false,
    });
  });

  it("preserves ordered multimodal roles and omits legacy AIComing fields", () => {
    const request = buildMiniMaxH3Request({
      prompt: "follow 图片1 and 视频2",
      inputMode: "multimodal",
      resolution: "768p",
      ratio: "4:3",
      duration: 10,
      watermark: false,
      media: [
        { type: "image", url: "https://assets.test/one.png" },
        { type: "video", url: "https://assets.test/two.mp4" },
        { type: "audio", url: "https://assets.test/three.mp3" },
      ],
    });

    expect(request.body).toEqual({
      model: "MiniMax-H3",
      content: [
        { type: "text", text: "follow 图片1 and 视频2" },
        { type: "image_url", image_url: { url: "https://assets.test/one.png" }, role: "reference_image" },
        { type: "video_url", video_url: { url: "https://assets.test/two.mp4" }, role: "reference_video" },
        { type: "audio_url", audio_url: { url: "https://assets.test/three.mp3" }, role: "reference_audio" },
      ],
      resolution: "768P",
      duration: 10,
      ratio: "4:3",
      aigc_watermark: false,
    });
    expect(request.body).not.toHaveProperty("prompt");
    expect(request.body).not.toHaveProperty("image");
    expect(request.body).not.toHaveProperty("image_tail");
    expect(request.body).not.toHaveProperty("references");
    expect(request.body).not.toHaveProperty("seconds");
    expect(request.body).not.toHaveProperty("seed");
    expect(request.body).not.toHaveProperty("camera_fixed");
    expect(request.body).not.toHaveProperty("generate_audio");
    expect(request.body).not.toHaveProperty("return_last_frame");
  });

  it("uses the encoded official polling path", () => {
    expect(getMiniMaxH3PollPath("task/id")).toBe("/v2/query/video_generation/task%2Fid");
  });
});
