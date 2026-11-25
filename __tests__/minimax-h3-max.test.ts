import { describe, expect, it } from "vitest";

import { createVideoTaskSchema } from "@/lib/generation/task-input-schema";
import { getLiveVideoBatchInputModes } from "@/lib/live-video-batch/video-models";
import { getMiniMaxH3UploadContract, validateMiniMaxH3MediaSet } from "@/lib/minimax-h3-media-policy";
import {
  MINIMAX_H3_MAX_MODEL_ID,
  MINIMAX_H3_MAX_UPSTREAM_MODEL,
  MINIMAX_PROVIDER_ID,
  isMiniMaxH3VideoModel,
} from "@/lib/minimax-models";
import { MINIMAX_H3_MAX_DEFAULT_PRICE_RULES } from "@/lib/minimax-pricing";
import { buildMiniMaxH3Request } from "@/lib/minimax-video";
import { mergeSavedProvidersWithBuiltins } from "@/lib/providers/registry";
import { getVideoModelSpec, normalizeVideoModelId, sora2Models } from "@/lib/sora2";
import { VIDEO_MODEL_DEFINITIONS } from "@/lib/toolbox-models";

describe("MiniMax-H3-Max official integration", () => {
  it("registers the exact Max identity, capabilities and existing-provider backfill", () => {
    expect(MINIMAX_H3_MAX_MODEL_ID).toBe("minimax-h3-max");
    expect(MINIMAX_H3_MAX_UPSTREAM_MODEL).toBe("MiniMax-H3-Max");
    expect(isMiniMaxH3VideoModel(MINIMAX_H3_MAX_MODEL_ID)).toBe(true);
    expect(normalizeVideoModelId(MINIMAX_H3_MAX_MODEL_ID)).toBe(MINIMAX_H3_MAX_MODEL_ID);

    const spec = getVideoModelSpec(MINIMAX_H3_MAX_MODEL_ID);
    expect(spec).toMatchObject({
      id: MINIMAX_H3_MAX_MODEL_ID,
      label: "MiniMax-H3-Max",
      provider: MINIMAX_PROVIDER_ID,
      upstreamModelId: MINIMAX_H3_MAX_UPSTREAM_MODEL,
      supportedInputModes: ["first_frame", "first_last_frame", "text_to_video"],
      supportedResolutions: ["480p", "768p"],
      minDurationSeconds: 5,
      maxDurationSeconds: 15,
      allowAutoDuration: false,
      supportsGenerateAudio: false,
      supportsWebSearch: false,
      supportsReferenceAudio: false,
      referenceLimits: { images: 2, videos: 0, audios: 0, total: 2, standaloneAudio: false },
    });
    expect(VIDEO_MODEL_DEFINITIONS.find((item) => item.id === MINIMAX_H3_MAX_MODEL_ID)).toMatchObject({
      provider: MINIMAX_PROVIDER_ID,
      upstreamModelId: MINIMAX_H3_MAX_UPSTREAM_MODEL,
    });
    expect(sora2Models.filter((item) => item.id === MINIMAX_H3_MAX_MODEL_ID)).toHaveLength(1);

    const saved = mergeSavedProvidersWithBuiltins([{
      id: MINIMAX_PROVIDER_ID,
      name: "MiniMax 官方",
      protocol: "openai",
      baseUrl: "https://api.minimaxi.com",
      envKeyName: "",
      egressMode: "direct",
      imageModels: [],
      videoModels: ["MiniMax-H3"],
      chatModels: [],
      modelProtocols: {},
      enabled: true,
      sortOrder: 0,
    }]);
    expect(saved.find((provider) => provider.id === MINIMAX_PROVIDER_ID)?.videoModels).toEqual([
      "MiniMax-H3",
      "MiniMax-H3-Max",
    ]);
  });

  it("builds exact Max V2 text and frame requests without unsupported fields", () => {
    expect(buildMiniMaxH3Request({
      model: MINIMAX_H3_MAX_UPSTREAM_MODEL,
      prompt: "fast city flythrough",
      inputMode: "text_to_video",
      resolution: "480p",
      ratio: "21:9",
      duration: 5,
      watermark: true,
      media: [],
    })).toEqual({
      endpoint: "/v2/video_generation",
      body: {
        model: "MiniMax-H3-Max",
        content: [{ type: "text", text: "fast city flythrough" }],
        resolution: "480P",
        duration: 5,
        ratio: "21:9",
        aigc_watermark: true,
      },
    });

    const frameRequest = buildMiniMaxH3Request({
      model: MINIMAX_H3_MAX_UPSTREAM_MODEL,
      prompt: "move from first to last",
      inputMode: "first_last_frame",
      resolution: "768p",
      ratio: "16:9",
      duration: 15,
      watermark: false,
      media: [
        { type: "image", url: "https://assets.test/first.png" },
        { type: "image", url: "https://assets.test/last.png" },
      ],
    });
    expect(frameRequest.body).toEqual({
      model: "MiniMax-H3-Max",
      content: [
        { type: "text", text: "move from first to last" },
        { type: "image_url", image_url: { url: "https://assets.test/first.png" }, role: "first_frame" },
        { type: "image_url", image_url: { url: "https://assets.test/last.png" }, role: "last_frame" },
      ],
      resolution: "768P",
      duration: 15,
      ratio: "adaptive",
      aigc_watermark: false,
    });
    expect(frameRequest.body).not.toHaveProperty("references");
    expect(frameRequest.body).not.toHaveProperty("generate_audio");
    expect(frameRequest.body).not.toHaveProperty("return_last_frame");

    expect(() => buildMiniMaxH3Request({
      model: MINIMAX_H3_MAX_UPSTREAM_MODEL,
      prompt: "unsupported reference",
      inputMode: "multimodal",
      resolution: "768p",
      ratio: "16:9",
      duration: 5,
      watermark: false,
      media: [{ type: "video", url: "https://assets.test/reference.mp4" }],
    })).toThrow(/multimodal/i);
    expect(() => buildMiniMaxH3Request({
      model: MINIMAX_H3_MAX_UPSTREAM_MODEL,
      prompt: "unsupported resolution",
      inputMode: "text_to_video",
      resolution: "2k",
      ratio: "16:9",
      duration: 5,
      watermark: false,
      media: [],
    })).toThrow(/2K/);
  });

  it("exposes only image uploads and rejects Max multimodal media", () => {
    expect(getMiniMaxH3UploadContract(MINIMAX_H3_MAX_MODEL_ID)).toEqual(expect.objectContaining({
      allowedKinds: ["image"],
      maxBytes: { image: 30 * 1024 * 1024 },
    }));

    const issues = validateMiniMaxH3MediaSet({
      modelId: MINIMAX_H3_MAX_MODEL_ID,
      media: [{
        fileName: "reference.mp4",
        byteSize: 1024,
        probe: {
          version: 1,
          kind: "video",
          detectedMime: "video/mp4",
          width: 1920,
          height: 1080,
          durationSeconds: 5,
          frameRate: 24,
          videoCodec: "h264",
          audioCodecs: ["aac"],
        },
      }],
    });
    expect(issues).toContainEqual(expect.objectContaining({ code: "media_kind_unsupported" }));
  });

  it("uses Max defaults and rejects unsupported agent options", () => {
    expect(createVideoTaskSchema.parse({
      model: MINIMAX_H3_MAX_MODEL_ID,
      prompt: "animate quickly",
      inputMode: "first_frame",
      mediaPaths: ["/uploads/first.png"],
    })).toMatchObject({
      resolution: "768p",
      ratio: "adaptive",
      returnLastFrame: false,
    });
    expect(createVideoTaskSchema.safeParse({
      model: MINIMAX_H3_MAX_MODEL_ID,
      prompt: "animate",
      inputMode: "text_to_video",
      duration: 4,
      resolution: "768p",
    }).success).toBe(false);
    expect(createVideoTaskSchema.safeParse({
      model: MINIMAX_H3_MAX_MODEL_ID,
      prompt: "animate",
      inputMode: "text_to_video",
      duration: 5,
      resolution: "2k",
    }).success).toBe(false);
  });

  it("uses first-frame mode in the batch workspace", () => {
    expect(getLiveVideoBatchInputModes(getVideoModelSpec(MINIMAX_H3_MAX_MODEL_ID))).toEqual(["first_frame"]);
  });

  it("declares the official Max output-second prices", () => {
    expect(MINIMAX_H3_MAX_DEFAULT_PRICE_RULES).toEqual([
      expect.objectContaining({
        provider: "minimax",
        model: "minimax-h3-max",
        unitType: "second",
        unitPrice: 0.33,
        matchConditions: { resolution: "480p" },
      }),
      expect.objectContaining({
        provider: "minimax",
        model: "minimax-h3-max",
        unitType: "second",
        unitPrice: 0.5,
        matchConditions: { resolution: "768p" },
      }),
    ]);
  });
});
