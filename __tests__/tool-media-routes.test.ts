import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  uploadToolMedia: vi.fn(),
  uploadToolMediaFromSource: vi.fn(),
  listToolMediaDrafts: vi.fn(),
  releaseToolMedia: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/tool-media/service", () => ({
  uploadToolMedia: mocks.uploadToolMedia,
  uploadToolMediaFromSource: mocks.uploadToolMediaFromSource,
  listToolMediaDrafts: mocks.listToolMediaDrafts,
  releaseToolMedia: mocks.releaseToolMedia,
}));

import { POST as upload } from "@/app/api/tool-media/upload/route";
import { GET as drafts } from "@/app/api/tool-media/drafts/route";
import { POST as release } from "@/app/api/tool-media/release/route";

const draftSessionId = "11111111-1111-4111-8111-111111111111";
const mediaId = "22222222-2222-4222-8222-222222222222";
const reusedMediaId = "33333333-3333-4333-8333-333333333333";

function pngFile(name = "input.png") {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])],
    name,
    { type: "image/png" },
  );
}

describe("tool media routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserId.mockResolvedValue(7);
    mocks.uploadToolMedia.mockResolvedValue({
      mediaId,
      localPreviewUrl: "/uploads/tool_inputs/source.png",
      modelUrl: "https://app.example.com/uploads/tool_inputs/source.png",
      status: "ready",
      kind: "image",
    });
    mocks.uploadToolMediaFromSource.mockResolvedValue({
      mediaId,
      localPreviewUrl: "/uploads/tool_inputs/source.png",
      modelUrl: "https://app.example.com/uploads/tool_inputs/source.png",
      status: "ready",
      kind: "image",
      sizeBytes: 1234,
    });
    mocks.listToolMediaDrafts.mockResolvedValue([]);
    mocks.releaseToolMedia.mockResolvedValue({ releasedCount: 0 });
  });

  it.each([
    [
      "upload",
      () => {
        const form = new FormData();
        form.set("draftSessionId", draftSessionId);
        form.set("file", pngFile());
        return upload(new Request("http://localhost/api/tool-media/upload", { method: "POST", body: form }) as any);
      },
    ],
    [
      "drafts",
      () =>
        drafts(
          new Request(
            `http://localhost/api/tool-media/drafts?draftSessionId=${draftSessionId}`,
          ) as any,
        ),
    ],
    [
      "release",
      () =>
        release(
          new Request("http://localhost/api/tool-media/release", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ draftSessionId, mediaIds: [mediaId] }),
          }) as any,
        ),
    ],
  ])("requires getUserId authentication for %s", async (_name, invoke) => {
    mocks.getUserId.mockResolvedValue(null);

    const response = await invoke();

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it("uploads exactly one file for the authenticated user and ignores a client userId", async () => {
    const form = new FormData();
    form.set("draftSessionId", draftSessionId);
    form.set("userId", "999");
    form.set("file", pngFile());
    const request = new Request("http://localhost/api/tool-media/upload", {
      method: "POST",
      body: form,
    });

    const response = await upload(request as any);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      mediaId,
      localPreviewUrl: "/uploads/tool_inputs/source.png",
      modelUrl: "https://app.example.com/uploads/tool_inputs/source.png",
      status: "ready",
      kind: "image",
    });
    expect(mocks.uploadToolMedia).toHaveBeenCalledWith({
      ownerUserId: 7,
      draftSessionId,
      file: expect.objectContaining({ name: "input.png" }),
    });
  });

  it("imports and verifies one dragged source URL with the selected Seedance contract", async () => {
    const sourceUrl = "/uploads/products/shared/image/reference.png";
    const model = "doubao-seedance-2-0-260128";
    const form = new FormData();
    form.set("draftSessionId", draftSessionId);
    form.set("model", model);
    form.set("sourceUrl", sourceUrl);

    const response = await upload(new Request("http://localhost/api/tool-media/upload", {
      method: "POST",
      body: form,
    }) as any);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      mediaId,
      sizeBytes: 1234,
    });
    expect(mocks.uploadToolMedia).not.toHaveBeenCalled();
    expect(mocks.uploadToolMediaFromSource).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 7,
      draftSessionId,
      sourceUrl,
      modelId: model,
      allowedKinds: ["image", "video", "audio"],
    }));
  });

  it.each([
    "doubao-seedance-2-0-260128",
    "doubao-seedance-2-5-260628",
    "doubao-seedance-2-0-fast-260128",
    "doubao-seedance-2-0-mini-260615",
    "doubao-seedance-2.0-face",
    "doubao-seedance-2.0-fast-face",
  ])("opens the Seedance audio upload contract for %s", async (model) => {
    const form = new FormData();
    form.set("draftSessionId", draftSessionId);
    form.set("model", model);
    form.set("file", new File([new Uint8Array([0x49, 0x44, 0x33, 1])], "reference.mp3", { type: "audio/mpeg" }));

    const response = await upload(new Request("http://localhost/api/tool-media/upload", {
      method: "POST",
      body: form,
    }) as any);

    expect(response.status).toBe(200);
    expect(mocks.uploadToolMedia).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 7,
      draftSessionId,
      modelId: model,
      allowedKinds: ["image", "video", "audio"],
      maxBytes: {
        image: 30 * 1024 * 1024,
        video: 200 * 1024 * 1024,
        audio: 15 * 1024 * 1024,
      },
      allowedMimeTypes: expect.arrayContaining([
        "image/tiff",
        "image/heic",
        "image/heif",
        "video/mp4",
        "video/quicktime",
        "audio/mpeg",
        "audio/wav",
      ]),
      allowedAudioMimeTypes: [
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/x-wav",
        "audio/wave",
        "audio/vnd.wave",
      ],
    }));
  });

  it("opens the independent MiniMax-H3 upload contract", async () => {
    const form = new FormData();
    form.set("draftSessionId", draftSessionId);
    form.set("model", "minimax-h3");
    form.set("file", pngFile());

    const response = await upload(new Request("http://localhost/api/tool-media/upload", {
      method: "POST",
      body: form,
    }) as any);

    expect(response.status).toBe(200);
    expect(mocks.uploadToolMedia).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 7,
      draftSessionId,
      modelId: "minimax-h3",
      allowedKinds: ["image", "video", "audio"],
      maxBytes: {
        image: 30 * 1024 * 1024,
        video: 50 * 1024 * 1024,
        audio: 15 * 1024 * 1024,
      },
      allowedMimeTypes: expect.arrayContaining([
        "image/heic",
        "image/heif",
        "video/mp4",
        "video/quicktime",
        "audio/mpeg",
        "audio/wav",
      ]),
    }));
  });

  it("does not open the audio upload contract for Seedance 1.5", async () => {
    const form = new FormData();
    form.set("draftSessionId", draftSessionId);
    form.set("model", "doubao-seedance-1-5-pro-251215");
    form.set("file", pngFile());

    await upload(new Request("http://localhost/api/tool-media/upload", { method: "POST", body: form }) as any);

    expect(mocks.uploadToolMedia).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 7,
      draftSessionId,
      modelId: "doubao-seedance-1-5-pro-251215",
      file: expect.objectContaining({ name: "input.png" }),
      allowedKinds: ["image"],
      maxBytes: expect.objectContaining({ image: 30 * 1024 * 1024 }),
      allowedMimeTypes: expect.arrayContaining(["image/tiff", "image/heic", "image/heif"]),
    }));
  });

  it("rejects invalid upload sessions and multiple files before calling the service", async () => {
    const invalidSession = new FormData();
    invalidSession.set("draftSessionId", "not-a-uuid");
    invalidSession.set("file", pngFile());
    const invalidResponse = await upload(
      new Request("http://localhost/api/tool-media/upload", {
        method: "POST",
        body: invalidSession,
      }) as any,
    );

    const multiple = new FormData();
    multiple.set("draftSessionId", draftSessionId);
    multiple.append("file", pngFile("one.png"));
    multiple.append("file", pngFile("two.png"));
    const multipleResponse = await upload(
      new Request("http://localhost/api/tool-media/upload", {
        method: "POST",
        body: multiple,
      }) as any,
    );

    expect(invalidResponse.status).toBe(400);
    expect(multipleResponse.status).toBe(400);
    expect(mocks.uploadToolMedia).not.toHaveBeenCalled();
  });

  it("returns structured Seedance validation issues to the uploader", async () => {
    mocks.uploadToolMedia.mockRejectedValueOnce(Object.assign(
      new Error("reference.mp4 不符合当前 Seedance 模型要求"),
      {
        status: 400,
        code: "SEEDANCE_MEDIA_INVALID",
        issues: [{ code: "video_codec_unsupported", message: "视频编码必须是 H.264 或 H.265。" }],
      },
    ));
    const form = new FormData();
    form.set("draftSessionId", draftSessionId);
    form.set("model", "doubao-seedance-2-0-260128");
    form.set("file", pngFile());

    const response = await upload(new Request("http://localhost/api/tool-media/upload", {
      method: "POST",
      body: form,
    }) as any);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: "SEEDANCE_MEDIA_INVALID",
      issues: [{ code: "video_codec_unsupported" }],
    });
  });

  it("queries drafts only for the authenticated owner, UUID session, and saved media ids", async () => {
    const response = await drafts(
      new Request(
        `http://localhost/api/tool-media/drafts?draftSessionId=${draftSessionId}&mediaIds=${mediaId},invalid,${reusedMediaId}&userId=999`,
      ) as any,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, items: [] });
    expect(mocks.listToolMediaDrafts).toHaveBeenCalledWith({
      ownerUserId: 7,
      draftSessionId,
      mediaIds: [mediaId, reusedMediaId],
    });
  });

  it("releases only UUID media ids in the authenticated user's session", async () => {
    mocks.releaseToolMedia.mockResolvedValue({ releasedCount: 1 });
    const response = await release(
      new Request("http://localhost/api/tool-media/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: 999,
          draftSessionId,
          mediaIds: [mediaId, mediaId],
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, releasedCount: 1 });
    expect(mocks.releaseToolMedia).toHaveBeenCalledWith({
      ownerUserId: 7,
      draftSessionId,
      mediaIds: [mediaId],
    });
  });

  it("rejects malformed release payloads before calling the service", async () => {
    const response = await release(
      new Request("http://localhost/api/tool-media/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftSessionId, mediaIds: ["not-a-uuid"] }),
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(mocks.releaseToolMedia).not.toHaveBeenCalled();
  });
});
