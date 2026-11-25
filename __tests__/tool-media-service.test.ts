import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mediaAssetCreate: vi.fn(),
  mediaAssetFindUnique: vi.fn(),
  mediaAssetFindMany: vi.fn(),
  mediaAssetUpdateMany: vi.fn(),
  assertUploadDiskWatermark: vi.fn(),
  saveUploadedFile: vi.fn(),
  saveBufferFile: vi.fn(),
  resolveLocalUploadPathForExternalApiWithRelay: vi.fn(),
  resolveLocalUploadPathForExternalApiWithRelayBuffer: vi.fn(),
  deleteOssObjects: vi.fn(),
  ensureDir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  remove: vi.fn(),
  saveRemoteFile: vi.fn(),
  probeLocalMedia: vi.fn(),
  resolveLocalUploadPath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    mediaAsset: {
      create: mocks.mediaAssetCreate,
      findUnique: mocks.mediaAssetFindUnique,
      findMany: mocks.mediaAssetFindMany,
      updateMany: mocks.mediaAssetUpdateMany,
    },
  },
}));
vi.mock("@/lib/upload-limits", () => ({
  assertUploadDiskWatermark: mocks.assertUploadDiskWatermark,
}));
// All filesystem writes are mocked here; policy enforcement has dedicated tests.
vi.mock("@/lib/runtime-isolation", () => ({ assertWritablePath: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  saveUploadedFile: mocks.saveUploadedFile,
  saveBufferFile: mocks.saveBufferFile,
  saveRemoteFile: mocks.saveRemoteFile,
}));
vi.mock("@/lib/external-assets", () => ({
  resolveLocalUploadPathForExternalApiWithRelay: mocks.resolveLocalUploadPathForExternalApiWithRelay,
  resolveLocalUploadPathForExternalApiWithRelayBuffer: mocks.resolveLocalUploadPathForExternalApiWithRelayBuffer,
}));
vi.mock("@/lib/oss", () => ({
  deleteOssObjects: mocks.deleteOssObjects,
}));
vi.mock("fs-extra", () => ({
  default: {
    ensureDir: mocks.ensureDir,
    writeFile: mocks.writeFile,
    readFile: mocks.readFile,
    remove: mocks.remove,
  },
}));
vi.mock("@/lib/tool-media/media-probe", () => ({
  probeLocalMedia: mocks.probeLocalMedia,
  resolveLocalUploadPath: mocks.resolveLocalUploadPath,
  mergeStoredMediaProbe: (metadata: unknown, probe: unknown) => ({
    ...((metadata && typeof metadata === "object" && !Array.isArray(metadata)) ? metadata : {}),
    mediaProbe: probe,
  }),
  readStoredMediaProbe: (metadata: any) => metadata?.mediaProbe,
}));

import * as toolMediaService from "@/lib/tool-media/service";
import {
  listToolMediaDrafts,
  releaseOwnedUnreferencedToolMedia,
  releaseToolMedia,
  uploadToolMedia,
} from "@/lib/tool-media/service";

afterEach(() => {
  vi.useRealTimers();
});

const draftSessionId = "11111111-1111-4111-8111-111111111111";
const firstMediaId = "22222222-2222-4222-8222-222222222222";
const secondMediaId = "33333333-3333-4333-8333-333333333333";
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

function pngFingerprint(bytes = PNG_BYTES) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pngFile(name = "input.png") {
  return new File(
    [PNG_BYTES],
    name,
    { type: "image/png" },
  );
}

describe("tool media service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T12:00:00.000Z"));
    mocks.assertUploadDiskWatermark.mockResolvedValue(undefined);
    mocks.saveUploadedFile.mockResolvedValue("/uploads/imports/2026-07-24/source.png");
    mocks.saveBufferFile.mockResolvedValue("/uploads/imports/2026-07-24/source.png");
    mocks.saveRemoteFile.mockResolvedValue("/uploads/imports/2026-07-24/remote-source.png");
    mocks.readFile.mockResolvedValue(Buffer.from(PNG_BYTES));
    mocks.resolveLocalUploadPath.mockImplementation((localPath: string) =>
      `C:/uploads/${String(localPath).replace(/^\/?uploads\//, "")}`,
    );
    mocks.resolveLocalUploadPathForExternalApiWithRelay.mockResolvedValue({
      url: "https://app.example.com/uploads/imports/2026-07-24/source.png",
      objectKey: null,
    });
    mocks.mediaAssetCreate.mockResolvedValue({
      id: firstMediaId,
      status: "ready",
    });
    mocks.mediaAssetFindUnique.mockResolvedValue(null);
    mocks.mediaAssetFindMany.mockResolvedValue([]);
    mocks.mediaAssetUpdateMany.mockResolvedValue({ count: 0 });
    mocks.deleteOssObjects.mockResolvedValue({ count: 1 });
    mocks.ensureDir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue(undefined);
    mocks.probeLocalMedia.mockResolvedValue({
      version: 1,
      kind: "image",
      detectedMime: "image/png",
      width: 1280,
      height: 720,
      frameCount: 1,
    });
  });

  it("rejects spoofed file contents before disk writes or MediaAsset creation", async () => {
    const spoofed = new File([new TextEncoder().encode("not a png")], "fake.png", {
      type: "image/png",
    });

    await expect(
      uploadToolMedia({ ownerUserId: 7, draftSessionId, file: spoofed }),
    ).rejects.toThrow("文件内容无法识别");

    expect(mocks.saveBufferFile).not.toHaveBeenCalled();
    expect(mocks.mediaAssetCreate).not.toHaveBeenCalled();
  });

  it("rejects MIME types outside the image and video allowlist before writing", async () => {
    const audio = new File(
      [new Uint8Array([0x49, 0x44, 0x33, 1])],
      "audio.mp3",
      { type: "audio/mpeg" },
    );

    await expect(
      uploadToolMedia({ ownerUserId: 7, draftSessionId, file: audio }),
    ).rejects.toThrow("不支持的文件类型");

    expect(mocks.saveBufferFile).not.toHaveBeenCalled();
    expect(mocks.mediaAssetCreate).not.toHaveBeenCalled();
  });

  it("rejects image files above the existing size limit before writing", async () => {
    const oversized = new File(
      [
        new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        new Uint8Array(20 * 1024 * 1024),
      ],
      "large.png",
      { type: "image/png" },
    );

    await expect(
      uploadToolMedia({ ownerUserId: 7, draftSessionId, file: oversized }),
    ).rejects.toThrow("文件过大");

    expect(mocks.saveBufferFile).not.toHaveBeenCalled();
    expect(mocks.mediaAssetCreate).not.toHaveBeenCalled();
  });

  it("checks disk capacity before writing a valid image", async () => {
    mocks.assertUploadDiskWatermark.mockRejectedValue(new Error("disk blocked"));

    await expect(
      uploadToolMedia({ ownerUserId: 7, draftSessionId, file: pngFile() }),
    ).rejects.toThrow("disk blocked");

    expect(mocks.assertUploadDiskWatermark).toHaveBeenCalledWith(
      [expect.objectContaining({ name: "input.png", type: "image/png" })],
      { label: "Tool media upload" },
    );
    expect(mocks.saveBufferFile).not.toHaveBeenCalled();
    expect(mocks.mediaAssetCreate).not.toHaveBeenCalled();
  });

  it("uses a PNG extension when saveBufferFile receives only image/png", async () => {
    const { saveBufferFile } = await vi.importActual<typeof import("@/lib/storage")>(
      "@/lib/storage",
    );

    const localPath = await saveBufferFile(Buffer.from([1]), "imports", {
      contentType: "image/png",
    });

    expect(localPath).toMatch(/^\/uploads\/imports\/2026-07-24\/[\w-]+\.png$/);
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]imports[\\/]2026-07-24[\\/][\w-]+\.png$/),
      expect.any(Buffer),
    );
  });

  it("stores only originalKey and returns previews derived from the saved local path", async () => {
    const result = await uploadToolMedia({
      ownerUserId: 7,
      draftSessionId,
      file: pngFile(),
    });

    expect(mocks.saveBufferFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      "imports",
      {
        contentType: "image/png",
      },
    );
    expect(mocks.saveUploadedFile).not.toHaveBeenCalled();
    expect(mocks.mediaAssetCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerUserId: 7,
        kind: "image",
        status: "ready",
        originalName: "input.png",
        declaredMime: "image/png",
        detectedMime: null,
        sizeBytes: BigInt(9),
        storageProvider: "local",
        originalKey: "/uploads/imports/2026-07-24/source.png",
        publicUrl: null,
        variants: {},
        metadata: {
          origin: "tool_input",
          draftSessionId,
          uploadFingerprint: pngFingerprint(),
          createdAt: "2026-07-24T12:00:00.000Z",
        },
        retentionUntil: new Date("2026-07-25T12:00:00.000Z"),
      }),
      select: { id: true, status: true },
    });
    expect(result).toEqual({
      mediaId: firstMediaId,
      localPreviewUrl: "/uploads/imports/2026-07-24/source.png",
      modelUrl: "https://app.example.com/uploads/imports/2026-07-24/source.png",
      status: "ready",
      kind: "image",
    });
    const persisted = JSON.stringify(
      mocks.mediaAssetCreate.mock.calls[0][0],
      (_key, value) => typeof value === "bigint" ? value.toString() : value,
    );
    expect(persisted).not.toContain("https://app.example.com");
    expect(persisted).not.toContain('"publicUrl":"/uploads/imports/2026-07-24/source.png"');
  });

  it("uses the server-selected batch profile without changing the tool default", async () => {
    mocks.saveBufferFile.mockResolvedValue("/uploads/batch_imports/2026-07-24/source.png");
    mocks.resolveLocalUploadPathForExternalApiWithRelayBuffer.mockResolvedValue({
      url: "https://app.example.com/uploads/batch_imports/2026-07-24/source.png",
      objectKey: null,
    });

    await uploadToolMedia({
      ownerUserId: 7,
      draftSessionId,
      file: pngFile(),
      storageProfile: "batch",
      metadata: { batchId: "44444444-4444-4444-8444-444444444444" },
    });

    expect(mocks.saveBufferFile).toHaveBeenCalledWith(expect.any(Buffer), "batch_imports", {
      contentType: "image/png",
    });
    expect(mocks.resolveLocalUploadPathForExternalApiWithRelayBuffer).toHaveBeenCalledWith(
      "/uploads/batch_imports/2026-07-24/source.png",
      "batch-input-relay",
      expect.any(Buffer),
      "image/png",
    );
    expect(mocks.mediaAssetCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        originalKey: "/uploads/batch_imports/2026-07-24/source.png",
        metadata: expect.objectContaining({
          origin: "tool_input",
          workspace: "batch",
          batchId: "44444444-4444-4444-8444-444444444444",
          draftSessionId,
        }),
      }),
    }));
  });

  it("normalizes a PNG saved from an untrusted .mp4 name before relaying it", async () => {
    mocks.saveBufferFile.mockResolvedValue("/uploads/imports/2026-07-24/source.png");

    await uploadToolMedia({
      ownerUserId: 7,
      draftSessionId,
      file: pngFile("input.mp4"),
    });

    expect(mocks.saveBufferFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      "imports",
      {
        contentType: "image/png",
      },
    );
    expect(mocks.resolveLocalUploadPathForExternalApiWithRelay).toHaveBeenCalledWith(
      "/uploads/imports/2026-07-24/source.png",
      "tool-input-relay",
    );
    expect(mocks.mediaAssetCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        originalName: "input.mp4",
        declaredMime: "image/png",
        detectedMime: null,
        originalKey: "/uploads/imports/2026-07-24/source.png",
        publicUrl: null,
      }),
    }));
  });

  it("deletes the new local and OSS copies when MediaAsset creation fails", async () => {
    mocks.resolveLocalUploadPathForExternalApiWithRelay.mockResolvedValue({
      url: "https://oss.example.com/relay/source.png?signature=temporary",
      objectKey: "uploads/tool-input-relay/2026-07-24/source.png",
    });
    mocks.mediaAssetCreate.mockRejectedValue(new Error("database unavailable"));

    await expect(
      uploadToolMedia({ ownerUserId: 7, draftSessionId, file: pngFile() }),
    ).rejects.toThrow("database unavailable");

    expect(mocks.deleteOssObjects).toHaveBeenCalledWith([
      "uploads/tool-input-relay/2026-07-24/source.png",
    ]);
    expect(mocks.mediaAssetCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          variants: {
            relay: {
              objectKey: "uploads/tool-input-relay/2026-07-24/source.png",
              createdAt: "2026-07-24T12:00:00.000Z",
            },
          },
        }),
      }),
    );
    const persisted = JSON.stringify(
      mocks.mediaAssetCreate.mock.calls[0][0],
      (_key, value) => typeof value === "bigint" ? value.toString() : value,
    );
    expect(persisted).not.toContain("signature=temporary");
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it("fails closed and removes the local copy when no public or relay URL is available", async () => {
    mocks.resolveLocalUploadPathForExternalApiWithRelay.mockRejectedValue(
      new Error("no external URL"),
    );

    await expect(
      uploadToolMedia({ ownerUserId: 7, draftSessionId, file: pngFile() }),
    ).rejects.toThrow("no external URL");

    expect(mocks.mediaAssetCreate).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it("deletes a relay object even when its upload reports no usable URL", async () => {
    mocks.resolveLocalUploadPathForExternalApiWithRelay.mockResolvedValue({
      url: "",
      objectKey: "uploads/tool-input-relay/2026-07-24/orphan.png",
    });

    await expect(
      uploadToolMedia({ ownerUserId: 7, draftSessionId, file: pngFile() }),
    ).rejects.toThrow("无法生成可供模型访问的素材 URL");

    expect(mocks.deleteOssObjects).toHaveBeenCalledWith([
      "uploads/tool-input-relay/2026-07-24/orphan.png",
    ]);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it("lists only ready tool inputs owned by the current user and draft session without relay URLs", async () => {
    mocks.mediaAssetFindMany.mockResolvedValue([
      {
        id: firstMediaId,
        kind: "image",
        status: "ready",
        originalName: "input.png",
        declaredMime: "image/png",
        sizeBytes: BigInt(9),
        originalKey: "/uploads/imports/2026-07-24/source.png",
        createdAt: new Date("2026-07-24T12:00:00.000Z"),
      },
    ]);

    const items = await listToolMediaDrafts({ ownerUserId: 7, draftSessionId });

    expect(mocks.mediaAssetFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerUserId: 7,
          status: "ready",
          AND: [
            { metadata: { path: ["origin"], equals: "tool_input" } },
            { metadata: { path: ["draftSessionId"], equals: draftSessionId } },
          ],
        },
      }),
    );
    expect(items).toEqual([
      {
        mediaId: firstMediaId,
        kind: "image",
        status: "ready",
        originalName: "input.png",
        mimeType: "image/png",
        sizeBytes: 9,
        localPreviewUrl: "/uploads/imports/2026-07-24/source.png",
        createdAt: "2026-07-24T12:00:00.000Z",
      },
    ]);
    expect(items[0]).not.toHaveProperty("modelUrl");
    expect(items[0]).not.toHaveProperty("variants");
  });

  it("also restores explicitly saved ready media ids owned by the current user", async () => {
    await listToolMediaDrafts({
      ownerUserId: 7,
      draftSessionId,
      mediaIds: [secondMediaId],
    });

    expect(mocks.mediaAssetFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerUserId: 7,
          status: "ready",
          purgedAt: null,
          OR: [
            {
              AND: [
                { metadata: { path: ["origin"], equals: "tool_input" } },
                { metadata: { path: ["draftSessionId"], equals: draftSessionId } },
              ],
            },
            { id: { in: [secondMediaId] } },
          ],
        },
      }),
    );
  });

  it("soft-deletes only ready owned session media with zero real generation inputs", async () => {
    mocks.mediaAssetFindMany.mockResolvedValue([
      {
        id: firstMediaId,
        status: "ready",
        metadata: { origin: "tool_input", draftSessionId },
        _count: { generationInputs: 0 },
      },
      {
        id: secondMediaId,
        status: "ready",
        metadata: { origin: "tool_input", draftSessionId },
        _count: { generationInputs: 1 },
      },
    ]);
    mocks.mediaAssetUpdateMany.mockResolvedValue({ count: 1 });

    const result = await releaseToolMedia({
      ownerUserId: 7,
      draftSessionId,
      mediaIds: [firstMediaId, secondMediaId],
    });

    expect(mocks.mediaAssetFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: [firstMediaId, secondMediaId] },
        ownerUserId: 7,
        status: "ready",
        AND: [
          { metadata: { path: ["origin"], equals: "tool_input" } },
          { metadata: { path: ["draftSessionId"], equals: draftSessionId } },
        ],
      },
      select: {
        id: true,
        status: true,
        metadata: true,
        _count: { select: { generationInputs: true } },
      },
    });
    expect(mocks.mediaAssetUpdateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [firstMediaId] },
        ownerUserId: 7,
        status: "ready",
        workspaceDraftMedia: { none: {} },
        batchMedia: { none: {} },
        liveVideoBatchItems: { none: {} },
        generationInputs: { none: {} },
        references: { none: {} },
        runOutputs: { none: {} },
        AND: [
          { metadata: { path: ["origin"], equals: "tool_input" } },
          { metadata: { path: ["draftSessionId"], equals: draftSessionId } },
        ],
      },
      data: {
        status: "soft_deleted",
        softDeletedAt: new Date("2026-07-24T12:00:00.000Z"),
        retentionUntil: new Date("2026-07-24T12:10:00.000Z"),
      },
    });
    expect(result).toEqual({ releasedCount: 1 });
  });

  it("treats repeated release and already referenced media as an idempotent no-op", async () => {
    mocks.mediaAssetFindMany.mockResolvedValue([
      {
        id: secondMediaId,
        status: "ready",
        metadata: { origin: "tool_input", draftSessionId },
        _count: { generationInputs: 1 },
      },
    ]);

    await expect(
      releaseToolMedia({
        ownerUserId: 7,
        draftSessionId,
        mediaIds: [secondMediaId],
      }),
    ).resolves.toEqual({ releasedCount: 0 });

    expect(mocks.mediaAssetUpdateMany).not.toHaveBeenCalled();
  });

  it("returns a cached media probe when restoring a Seedance-ready draft", async () => {
    const mediaProbe = {
      version: 1,
      kind: "image",
      detectedMime: "image/png",
      width: 1280,
      height: 720,
    };
    mocks.mediaAssetFindMany.mockResolvedValue([{
      id: firstMediaId,
      kind: "image",
      status: "ready",
      originalName: "input.png",
      declaredMime: "image/png",
      sizeBytes: BigInt(9),
      originalKey: "/uploads/imports/2026-07-24/source.png",
      metadata: { origin: "tool_input", draftSessionId, mediaProbe },
      createdAt: new Date("2026-07-24T12:00:00.000Z"),
    }]);

    const [item] = await listToolMediaDrafts({ ownerUserId: 7, draftSessionId });

    expect(item).toMatchObject({ mediaId: firstMediaId, probe: mediaProbe });
    expect(mocks.mediaAssetFindMany.mock.calls[0][0].select).toHaveProperty("metadata", true);
  });

  it("accepts official MP3 reference audio only when the caller opts in", async () => {
    const audio = new File(
      [new Uint8Array([0x49, 0x44, 0x33, 1])],
      "audio.mp3",
      { type: "audio/mpeg" },
    );

    const result = await uploadToolMedia({
      ownerUserId: 7,
      draftSessionId,
      file: audio,
      allowedKinds: ["image", "video", "audio"],
      maxBytes: { audio: 15 * 1024 * 1024 },
      allowedAudioMimeTypes: ["audio/mpeg", "audio/wav"],
    } as any);

    expect(result.kind).toBe("audio");
    expect(mocks.mediaAssetCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "audio", declaredMime: "audio/mpeg" }),
    }));
  });

  it("probes and caches objective metadata for a Seedance upload", async () => {
    const result = await uploadToolMedia({
      ownerUserId: 7,
      draftSessionId,
      file: pngFile(),
      modelId: "doubao-seedance-2-0-260128",
    });

    expect(mocks.probeLocalMedia).toHaveBeenCalledWith({
      localPath: expect.stringMatching(/[\\/]uploads[\\/]imports[\\/]2026-07-24[\\/]source\.png$/),
      kind: "image",
      fileName: "input.png",
      declaredMime: "image/png",
    });
    expect(mocks.mediaAssetCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        detectedMime: "image/png",
        metadata: expect.objectContaining({
          origin: "tool_input",
          draftSessionId,
          mediaProbe: expect.objectContaining({
            version: 1,
            width: 1280,
            height: 720,
          }),
        }),
      }),
    }));
    expect(result).toMatchObject({
      kind: "image",
      probe: expect.objectContaining({ width: 1280, height: 720 }),
    });
  });

  it("probes and caches objective metadata for a MiniMax-H3 upload", async () => {
    const result = await uploadToolMedia({
      ownerUserId: 7,
      draftSessionId,
      file: pngFile(),
      modelId: "minimax-h3",
    });

    expect(mocks.probeLocalMedia).toHaveBeenCalledOnce();
    expect(mocks.mediaAssetCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        detectedMime: "image/png",
        metadata: expect.objectContaining({
          mediaProbe: expect.objectContaining({ width: 1280, height: 720 }),
        }),
      }),
    }));
    expect(result).toMatchObject({
      kind: "image",
      probe: expect.objectContaining({ width: 1280, height: 720 }),
    });
  });

  it("removes a MiniMax-H3 upload immediately when its independent rules fail", async () => {
    mocks.probeLocalMedia.mockResolvedValue({
      version: 1,
      kind: "image",
      detectedMime: "image/png",
      width: 255,
      height: 255,
      frameCount: 1,
    });

    await expect(uploadToolMedia({
      ownerUserId: 7,
      draftSessionId,
      file: pngFile("too-small.png"),
      modelId: "minimax-h3",
    })).rejects.toMatchObject({
      code: "MINIMAX_H3_MEDIA_INVALID",
      status: 400,
      message: expect.stringContaining("256"),
    });

    expect(mocks.resolveLocalUploadPathForExternalApiWithRelay).not.toHaveBeenCalled();
    expect(mocks.mediaAssetCreate).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it("runs a dragged product-library source through the same Seedance probe", async () => {
    const uploadFromSource = (
      toolMediaService as typeof toolMediaService & {
        uploadToolMediaFromSource?: (input: {
          ownerUserId: number;
          draftSessionId: string;
          sourceUrl: string;
          modelId: string;
        }) => Promise<any>;
      }
    ).uploadToolMediaFromSource;

    expect(uploadFromSource).toBeTypeOf("function");
    if (!uploadFromSource) return;

    const result = await uploadFromSource({
      ownerUserId: 7,
      draftSessionId,
      sourceUrl: "/uploads/products/shared/image/reference.png",
      modelId: "doubao-seedance-2-0-260128",
    });

    expect(mocks.readFile).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]uploads[\\/]products[\\/]shared[\\/]image[\\/]reference\.png$/),
    );
    expect(mocks.probeLocalMedia).toHaveBeenCalledWith(expect.objectContaining({
      kind: "image",
      fileName: "reference.png",
      declaredMime: "image/png",
    }));
    expect(result).toMatchObject({
      mediaId: firstMediaId,
      sizeBytes: PNG_BYTES.byteLength,
      probe: expect.objectContaining({ width: 1280, height: 720 }),
    });
    expect(mocks.remove).not.toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]products[\\/]shared[\\/]image[\\/]reference\.png$/),
    );
  });

  it("rejects an out-of-range dragged product image before MediaAsset creation", async () => {
    const uploadFromSource = (
      toolMediaService as typeof toolMediaService & {
        uploadToolMediaFromSource?: (input: {
          ownerUserId: number;
          draftSessionId: string;
          sourceUrl: string;
          modelId: string;
        }) => Promise<any>;
      }
    ).uploadToolMediaFromSource;

    expect(uploadFromSource).toBeTypeOf("function");
    if (!uploadFromSource) return;
    mocks.probeLocalMedia.mockResolvedValue({
      version: 1,
      kind: "image",
      detectedMime: "image/png",
      width: 100,
      height: 100,
      frameCount: 1,
    });

    await expect(uploadFromSource({
      ownerUserId: 7,
      draftSessionId,
      sourceUrl: "/uploads/products/shared/image/too-small.png",
      modelId: "doubao-seedance-2-0-260128",
    })).rejects.toMatchObject({
      code: "SEEDANCE_MEDIA_INVALID",
      status: 400,
      message: expect.stringContaining("300"),
    });

    expect(mocks.mediaAssetCreate).not.toHaveBeenCalled();
  });

  it("removes a Seedance upload immediately when objective probe rules fail", async () => {
    mocks.probeLocalMedia.mockResolvedValue({
      version: 1,
      kind: "image",
      detectedMime: "image/png",
      width: 100,
      height: 100,
      frameCount: 1,
    });

    await expect(uploadToolMedia({
      ownerUserId: 7,
      draftSessionId,
      file: pngFile("too-small.png"),
      modelId: "doubao-seedance-2-0-260128",
    })).rejects.toMatchObject({
      code: "SEEDANCE_MEDIA_INVALID",
      status: 400,
      message: expect.stringContaining("300"),
    });

    expect(mocks.resolveLocalUploadPathForExternalApiWithRelay).not.toHaveBeenCalled();
    expect(mocks.mediaAssetCreate).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });

  it("reuses the same owned ready media id without writing the file again", async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue({
      id: firstMediaId,
      ownerUserId: 7,
      kind: "image",
      status: "ready",
      originalName: "input.png",
      declaredMime: "image/png",
      sizeBytes: BigInt(9),
      originalKey: "/uploads/imports/2026-07-24/source.png",
      metadata: { origin: "tool_input", draftSessionId, uploadFingerprint: pngFingerprint() },
      purgedAt: null,
    });

    const result = await uploadToolMedia({
      ownerUserId: 7,
      draftSessionId,
      file: pngFile(),
      mediaId: firstMediaId,
    });

    expect(result).toMatchObject({
      mediaId: firstMediaId,
      localPreviewUrl: "/uploads/imports/2026-07-24/source.png",
      status: "ready",
      kind: "image",
    });
    expect(mocks.saveBufferFile).not.toHaveBeenCalled();
    expect(mocks.mediaAssetCreate).not.toHaveBeenCalled();
  });

  it("rejects the same request id when file bytes differ despite matching metadata", async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue({
      id: firstMediaId,
      ownerUserId: 7,
      kind: "image",
      status: "ready",
      originalName: "input.png",
      declaredMime: "image/png",
      sizeBytes: BigInt(9),
      originalKey: "/uploads/imports/2026-07-24/source.png",
      metadata: { origin: "tool_input", draftSessionId, uploadFingerprint: pngFingerprint() },
      purgedAt: null,
    });
    const differentBytes = new Uint8Array(PNG_BYTES);
    differentBytes[differentBytes.length - 1] = 2;

    await expect(uploadToolMedia({
      ownerUserId: 7,
      draftSessionId,
      file: new File([differentBytes], "input.png", { type: "image/png" }),
      mediaId: firstMediaId,
    })).rejects.toMatchObject({ status: 409 });
    expect(mocks.saveBufferFile).not.toHaveBeenCalled();
  });

  it("rejects a request id that already belongs to another upload scope", async () => {
    mocks.mediaAssetFindUnique.mockResolvedValue({
      id: firstMediaId,
      ownerUserId: 8,
      kind: "image",
      status: "ready",
      originalName: "input.png",
      declaredMime: "image/png",
      sizeBytes: BigInt(9),
      originalKey: "/uploads/imports/foreign.png",
      metadata: { origin: "tool_input", draftSessionId: secondMediaId },
      purgedAt: null,
    });

    await expect(uploadToolMedia({
      ownerUserId: 7,
      draftSessionId,
      file: pngFile(),
      mediaId: firstMediaId,
    })).rejects.toMatchObject({ status: 409 });
    expect(mocks.saveBufferFile).not.toHaveBeenCalled();
  });

  it("reuses the matching winner after a concurrent request-key insert", async () => {
    mocks.mediaAssetFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: firstMediaId,
        ownerUserId: 7,
        kind: "image",
        status: "ready",
        originalName: "input.png",
        declaredMime: "image/png",
        sizeBytes: BigInt(9),
        originalKey: "/uploads/imports/winner.png",
        metadata: { origin: "tool_input", draftSessionId, uploadFingerprint: pngFingerprint() },
        purgedAt: null,
      });
    mocks.mediaAssetCreate.mockRejectedValue({ code: "P2002" });

    await expect(uploadToolMedia({
      ownerUserId: 7,
      draftSessionId,
      file: pngFile(),
      mediaId: firstMediaId,
    })).resolves.toMatchObject({
      mediaId: firstMediaId,
      localPreviewUrl: "/uploads/imports/winner.png",
    });
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.mediaAssetFindUnique).toHaveBeenCalledTimes(2);
  });

  it("rejects a different-byte winner after a concurrent request-key insert", async () => {
    const differentBytes = new Uint8Array(PNG_BYTES);
    differentBytes[differentBytes.length - 1] = 2;
    mocks.mediaAssetFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: firstMediaId,
        ownerUserId: 7,
        kind: "image",
        status: "ready",
        originalName: "input.png",
        declaredMime: "image/png",
        sizeBytes: BigInt(9),
        originalKey: "/uploads/imports/winner.png",
        metadata: {
          origin: "tool_input",
          draftSessionId,
          uploadFingerprint: pngFingerprint(differentBytes),
        },
        purgedAt: null,
      });
    mocks.mediaAssetCreate.mockRejectedValue({ code: "P2002" });

    await expect(uploadToolMedia({
      ownerUserId: 7,
      draftSessionId,
      file: pngFile(),
      mediaId: firstMediaId,
    })).rejects.toMatchObject({ code: "P2002" });
    expect(mocks.remove).toHaveBeenCalledOnce();
  });

  it("releases detached owned tool media even when it came from a legacy draft session", async () => {
    mocks.mediaAssetFindMany.mockResolvedValue([{
      id: firstMediaId,
      status: "ready",
      metadata: { origin: "tool_input", draftSessionId: "legacy-session" },
      _count: { generationInputs: 0 },
    }]);
    mocks.mediaAssetUpdateMany.mockResolvedValue({ count: 1 });

    await expect(releaseOwnedUnreferencedToolMedia({
      ownerUserId: 7,
      mediaIds: [firstMediaId],
    })).resolves.toEqual({ releasedCount: 1 });

    expect(mocks.mediaAssetFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: { in: [firstMediaId] },
        ownerUserId: 7,
        status: "ready",
        metadata: { path: ["origin"], equals: "tool_input" },
      },
    }));
    expect(mocks.mediaAssetUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: [firstMediaId] },
        ownerUserId: 7,
        workspaceDraftMedia: { none: {} },
        batchMedia: { none: {} },
        liveVideoBatchItems: { none: {} },
        generationInputs: { none: {} },
        references: { none: {} },
        runOutputs: { none: {} },
      }),
    }));
  });

  it("persists trusted product-library snapshot identity in batch metadata", async () => {
    mocks.resolveLocalUploadPathForExternalApiWithRelayBuffer.mockResolvedValue({
      url: "https://app.example.com/uploads/batch_imports/2026-07-24/source.png",
      objectKey: null,
    });
    await uploadToolMedia({
      ownerUserId: 7,
      draftSessionId,
      file: pngFile(),
      storageProfile: "batch",
      metadata: {
        batchId: "44444444-4444-4444-8444-444444444444",
        batchMode: "image_batch",
        productLibraryItemId: 12,
        productLibraryRequestKey: "55555555-5555-4555-8555-555555555555",
      },
    });

    expect(mocks.mediaAssetCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          workspace: "batch",
          batchMode: "image_batch",
          productLibraryItemId: 12,
          productLibraryRequestKey: "55555555-5555-4555-8555-555555555555",
        }),
      }),
    }));
  });
});

describe("tool media service timer isolation", () => {
  it("restores real timers before the next suite runs in the same fork", () => {
    expect(vi.isFakeTimers()).toBe(false);
  });
});
