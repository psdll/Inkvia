import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  createVideoGeneration: vi.fn(),
  saveUploadedFile: vi.fn(),
  VideoGenerationError: class VideoGenerationError extends Error {
    status: number;
    friendlyError: {
      title: string;
      message: string;
      action: string;
      raw: string;
      requestId: null;
      code: "VALIDATION";
    };
    generationId?: number;
    displayInHistory?: boolean;

    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
      this.friendlyError = {
        title: "参数不正确",
        message,
        action: "请检查后重试。",
        raw: message,
        requestId: null,
        code: "VALIDATION",
      };
    }
  },
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/generation/video-service", () => ({
  createVideoGeneration: mocks.createVideoGeneration,
  VideoGenerationError: mocks.VideoGenerationError,
}));
vi.mock("@/lib/storage", () => ({ saveUploadedFile: mocks.saveUploadedFile }));

import { POST } from "@/app/api/video-gen/route";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const requestKey = "33333333-3333-4333-8333-333333333333";

describe("video tool media submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserId.mockResolvedValue(7);
    mocks.createVideoGeneration.mockResolvedValue({
      generationId: 91,
      taskId: "provider-task",
      status: "running",
    });
  });

  it("accepts singular and array toolMediaId fields in request order", async () => {
    const formData = new FormData();
    formData.set("prompt", "animate");
    formData.set("userPrompt", "用户原始视频提示词");
    formData.set("model", "seedance-1.5-pro");
    formData.set("requestKey", requestKey);
    formData.append("toolMediaId", secondId);
    formData.append("toolMediaId[]", firstId);

    const response = await POST(new NextRequest("http://localhost/api/video-gen", {
      method: "POST",
      body: formData,
    }));

    expect(response.status).toBe(200);
    expect(mocks.createVideoGeneration).toHaveBeenCalledWith(expect.objectContaining({
      authUserId: 7,
      requestKey,
      userPrompt: "用户原始视频提示词",
      toolMediaIds: [secondId, firstId],
      mediaPaths: [],
    }));
    expect(mocks.saveUploadedFile).not.toHaveBeenCalled();
  });

  it("rejects a malformed request key before calling the service", async () => {
    const formData = new FormData();
    formData.set("prompt", "animate");
    formData.set("model", "seedance-1.5-pro");
    formData.set("requestKey", "not-a-uuid");

    const response = await POST(new NextRequest("http://localhost/api/video-gen", {
      method: "POST",
      body: formData,
    }));

    expect(response.status).toBe(400);
    expect(mocks.createVideoGeneration).not.toHaveBeenCalled();
  });

  it("rejects duplicate normalized tool media IDs before calling the service", async () => {
    const formData = new FormData();
    formData.set("prompt", "animate");
    formData.set("model", "seedance-1.5-pro");
    formData.append("toolMediaId", firstId.toUpperCase());
    formData.append("toolMediaId[]", firstId);

    const response = await POST(new NextRequest("http://localhost/api/video-gen", {
      method: "POST",
      body: formData,
    }));

    expect(response.status).toBe(400);
    expect(mocks.createVideoGeneration).not.toHaveBeenCalled();
    expect(mocks.saveUploadedFile).not.toHaveBeenCalled();
  });

  it("rejects a legacy media fallback when tool media IDs are present", async () => {
    const formData = new FormData();
    formData.set("prompt", "animate");
    formData.set("model", "seedance-1.5-pro");
    formData.set("toolMediaId", firstId);
    formData.set("media", new File(["legacy"], "legacy.png", { type: "image/png" }));

    const response = await POST(new NextRequest("http://localhost/api/video-gen", {
      method: "POST",
      body: formData,
    }));

    expect(response.status).toBe(400);
    expect(mocks.createVideoGeneration).not.toHaveBeenCalled();
    expect(mocks.saveUploadedFile).not.toHaveBeenCalled();
  });

  it("forwards a Seedance 2.0 family prompt, ordered media manifest, and generation parameters", async () => {
    const formData = new FormData();
    formData.set("prompt", "让图片1中的人物使用图片2中的产品");
    formData.set("userPrompt", "让@图片1中的人物使用@图片2中的产品");
    formData.set("model", "doubao-seedance-2.0-fast-face");
    formData.set("inputMode", "multimodal");
    formData.set("resolution", "720p");
    formData.set("ratio", "16:9");
    formData.set("duration", "8");
    formData.set("seed", "24680");
    formData.set("cameraFixed", "true");
    formData.set("watermark", "true");
    formData.set("returnLastFrame", "true");
    formData.set("generateAudio", "true");
    formData.set("webSearch", "true");
    formData.append("toolMediaId", secondId);
    formData.append("toolMediaId[]", firstId);
    formData.set("inputManifest", JSON.stringify({
      version: 1,
      items: [
        { position: 0, source: "tool_media", mediaId: secondId },
        { position: 1, source: "tool_media", mediaId: firstId },
      ],
    }));

    const response = await POST(new NextRequest("http://localhost/api/video-gen", {
      method: "POST",
      body: formData,
    }));

    expect(response.status).toBe(200);
    expect(mocks.createVideoGeneration).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "让图片1中的人物使用图片2中的产品",
      userPrompt: "让@图片1中的人物使用@图片2中的产品",
      model: "doubao-seedance-2.0-fast-face",
      inputMode: "multimodal",
      resolution: "720p",
      ratio: "16:9",
      duration: 8,
      seed: 24680,
      cameraFixed: true,
      watermark: true,
      returnLastFrame: true,
      generateAudio: true,
      webSearch: true,
      toolMediaIds: [secondId, firstId],
      inputManifest: {
        version: 1,
        items: [
          { position: 0, source: "tool_media", mediaId: secondId },
          { position: 1, source: "tool_media", mediaId: firstId },
        ],
      },
    }));
  });

  it("forwards Seedance 2.5 task subtype and output format", async () => {
    const formData = new FormData();
    formData.set("prompt", "edit video");
    formData.set("model", "doubao-seedance-2-5-260628");
    formData.set("inputMode", "multimodal");
    formData.set("ratio", "adaptive");
    formData.set("duration", "-1");
    formData.set("omniReferenceTaskType", "edit");
    formData.set("outputFormat", "mov");

    const response = await POST(new NextRequest("http://localhost/api/video-gen", {
      method: "POST",
      body: formData,
    }));

    expect(response.status).toBe(200);
    expect(mocks.createVideoGeneration).toHaveBeenCalledWith(expect.objectContaining({
      omniReferenceTaskType: "edit",
      outputFormat: "mov",
    }));
  });

  it("does not persist a legacy media fallback when valid tool IDs later fail service validation", async () => {
    const formData = new FormData();
    formData.set("prompt", "animate");
    formData.set("model", "seedance-1.5-pro");
    formData.set("toolMediaId", firstId);
    formData.set("media", new File(["legacy"], "legacy.png", { type: "image/png" }));

    const response = await POST(new NextRequest("http://localhost/api/video-gen", {
      method: "POST",
      body: formData,
    }));

    expect(response.status).toBe(400);
    expect(mocks.createVideoGeneration).not.toHaveBeenCalled();
    expect(mocks.saveUploadedFile).not.toHaveBeenCalled();
  });

  it("does not persist a legacy media fallback for malformed tool IDs", async () => {
    const formData = new FormData();
    formData.set("prompt", "animate");
    formData.set("model", "seedance-1.5-pro");
    formData.set("toolMediaId", "not-a-uuid");
    formData.set("media", new File(["legacy"], "legacy.png", { type: "image/png" }));

    const response = await POST(new NextRequest("http://localhost/api/video-gen", {
      method: "POST",
      body: formData,
    }));

    expect(response.status).toBe(400);
    expect(mocks.createVideoGeneration).not.toHaveBeenCalled();
    expect(mocks.saveUploadedFile).not.toHaveBeenCalled();
  });

  it("keeps saving the legacy media fallback when no tool media IDs are present", async () => {
    mocks.saveUploadedFile.mockResolvedValueOnce("/uploads/images/user-uploads/legacy.png");
    const formData = new FormData();
    formData.set("prompt", "animate");
    formData.set("model", "seedance-1.5-pro");
    formData.set("media", new File([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ], "legacy.png", { type: "image/png" }));

    const response = await POST(new NextRequest("http://localhost/api/video-gen", {
      method: "POST",
      body: formData,
    }));

    expect(response.status).toBe(200);
    expect(mocks.saveUploadedFile).toHaveBeenCalledTimes(1);
    expect(mocks.createVideoGeneration).toHaveBeenCalledWith(expect.objectContaining({
      toolMediaIds: [],
      mediaPaths: ["/uploads/images/user-uploads/legacy.png"],
    }));
  });

  it("rejects an invalid legacy Seedance file before saving it", async () => {
    const formData = new FormData();
    formData.set("prompt", "animate");
    formData.set("model", "doubao-seedance-2-0-260128");
    formData.set("media", new File(
      [new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1])],
      "reference.webm",
      { type: "video/webm" },
    ));

    const response = await POST(new NextRequest("http://localhost/api/video-gen", {
      method: "POST",
      body: formData,
    }));

    expect(response.status).toBe(400);
    expect(mocks.saveUploadedFile).not.toHaveBeenCalled();
    expect(mocks.createVideoGeneration).not.toHaveBeenCalled();
  });

  it("passes a validated mixed manifest to the video service in UI order", async () => {
    const legacyPath = "/uploads/product-library/first.png";
    const formData = new FormData();
    formData.set("prompt", "animate");
    formData.set("model", "seedance-1.5-pro");
    formData.set("toolMediaId", firstId);
    formData.append("mediaPath[]", legacyPath);
    formData.set(
      "inputManifest",
      JSON.stringify({
        version: 1,
        items: [
          { position: 0, source: "legacy_path", path: legacyPath },
          { position: 1, source: "tool_media", mediaId: firstId },
        ],
      }),
    );

    const response = await POST(
      new NextRequest("http://localhost/api/video-gen", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.createVideoGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        toolMediaIds: [firstId],
        mediaPaths: [legacyPath],
        inputManifest: expect.objectContaining({ version: 1 }),
      }),
    );
  });

  it("rejects old mixed video fields before saving or calling the service", async () => {
    const formData = new FormData();
    formData.set("prompt", "animate");
    formData.set("model", "seedance-1.5-pro");
    formData.set("toolMediaId", firstId);
    formData.append("mediaPath[]", "/uploads/product-library/first.png");

    const response = await POST(
      new NextRequest("http://localhost/api/video-gen", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createVideoGeneration).not.toHaveBeenCalled();
    expect(mocks.saveUploadedFile).not.toHaveBeenCalled();
  });
});
