import { describe, expect, it } from "vitest";
import { buildVideoTemplatePayload } from "@/lib/video-template-reuse";

describe("video template reuse", () => {
  it("restores ordinary media and omits historical face-library records", () => {
    const payload = buildVideoTemplatePayload({
      type: "video_gen",
      model: "doubao-seedance-2.0-fast-face",
      templateData: JSON.stringify({
        prompt: "legacy prompt",
        inputMode: "multimodal",
        avatarAssetUris: ["asset://legacy"],
        avatarPreviewUrls: ["/uploads/legacy-cover.png"],
        imagePaths: ["asset://legacy", "/uploads/chair.png"],
        referenceAssets: [
          { kind: "avatar", assetUri: "asset://legacy", url: "/uploads/legacy-cover.png" },
          { kind: "image", url: "/uploads/chair.png" },
          { kind: "video", url: "/uploads/clip.mp4" },
          { kind: "audio", url: "/uploads/speech.wav" },
        ],
      }),
    });

    expect(payload.prompt).toBe("legacy prompt");
    expect(payload.inputMode).toBe("multimodal");
    expect(payload).not.toHaveProperty("avatarAssetUris");
    expect(payload).not.toHaveProperty("avatarPreviewUrls");
    expect(payload.imagePaths).toEqual(["/uploads/chair.png", "/uploads/clip.mp4", "/uploads/speech.wav"]);
    expect(payload.referenceAssets).toEqual([
      { kind: "image", url: "/uploads/chair.png", role: "reference_image" },
      { kind: "video", url: "/uploads/clip.mp4", role: "reference_video" },
      { kind: "audio", url: "/uploads/speech.wav", role: "reference_audio" },
    ]);
  });

  it("retains ordinary references from old mixed path lists", () => {
    const payload = buildVideoTemplatePayload({
      type: "video_gen",
      model: "doubao-seedance-2.0-fast-face",
      inputImages: ["/uploads/cover.png", "/uploads/chair.png"],
      params: { imagePaths: ["asset://legacy", "/uploads/chair.png"] },
    });

    expect(payload.inputMode).toBe("first_frame");
    expect(payload.imagePaths).toEqual(["/uploads/chair.png"]);
  });

  it("preserves an ordinary path when a legacy record also has a provider asset URI", () => {
    const payload = buildVideoTemplatePayload({
      type: "video_gen",
      inputImages: ["/uploads/chair.png"],
      params: { imagePaths: ["asset://legacy", "/uploads/chair.png"] },
    });

    expect(payload.imagePaths).toEqual(["/uploads/chair.png"]);
  });

  it("does not restore the preview as an ordinary upload when it is the only historical input", () => {
    const payload = buildVideoTemplatePayload({
      type: "video_gen",
      model: "doubao-seedance-2.0-face",
      inputImages: ["/uploads/cover.png"],
      params: { avatarAssetUri: "asset://legacy", avatarPreviewUrl: "/uploads/cover.png" },
    });

    expect(payload.inputMode).toBe("text_to_video");
    expect(payload.imagePaths).toEqual([]);
    expect(payload.referenceAssets).toEqual([]);
  });

  it("does not carry previous asset mentions into a regenerated video prompt", () => {
    const payload = buildVideoTemplatePayload({
      type: "video_gen",
      prompt: "参考@图片1和@视频1生成新镜头",
      model: "doubao-seedance-2-0-260128",
      inputImages: ["/uploads/chair.png"],
      params: {
        model: "doubao-seedance-2-0-260128",
        imagePaths: ["/uploads/chair.png"],
      },
    });

    expect(payload.prompt).toBe("参考和生成新镜头");
  });

  it("keeps Seedance 2.5 task subtype and output format in reusable templates only", () => {
    const seedance25 = buildVideoTemplatePayload({
      type: "video_gen",
      prompt: "extend",
      model: "doubao-seedance-2-5-260628",
      params: {
        model: "doubao-seedance-2-5-260628",
        inputMode: "multimodal",
        omniReferenceTaskType: "extend",
        outputFormat: "mov",
      },
    });
    const fast = buildVideoTemplatePayload({
      type: "video_gen",
      prompt: "keep unchanged",
      model: "doubao-seedance-2-0-fast-260128",
      params: {
        model: "doubao-seedance-2-0-fast-260128",
        omniReferenceTaskType: "extend",
        outputFormat: "mov",
      },
    });

    expect(seedance25).toMatchObject({ omniReferenceTaskType: "extend", outputFormat: "mov" });
    expect(fast).not.toHaveProperty("omniReferenceTaskType");
    expect(fast).not.toHaveProperty("outputFormat");
  });
});
