import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = {
    $queryRaw: vi.fn(),
    mediaReference: {
      count: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    mediaAsset: {
      updateMany: vi.fn(),
    },
  };
  return {
    client,
    transaction: vi.fn(async (callback: (tx: typeof client) => unknown) => callback(client)),
    mediaLibraryItemFindFirst: vi.fn(),
    readFile: vi.fn(),
    getOssObjectBufferByUrl: vi.fn(),
    uploadToolMedia: vi.fn(),
    releaseToolMedia: vi.fn(),
    loggerError: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    mediaLibraryItem: { findFirst: mocks.mediaLibraryItemFindFirst },
    ...mocks.client,
    $transaction: mocks.transaction,
  },
}));

vi.mock("node:fs/promises", () => ({
  default: { readFile: mocks.readFile },
  readFile: mocks.readFile,
}));

vi.mock("@/lib/oss", () => ({
  getOssObjectBufferByUrl: mocks.getOssObjectBufferByUrl,
}));

vi.mock("@/lib/tool-media/service", () => ({
  uploadToolMedia: mocks.uploadToolMedia,
  releaseToolMedia: mocks.releaseToolMedia,
}));

vi.mock("@/lib/logger", () => ({
  Logger: { error: mocks.loggerError },
}));

import {
  BATCH_WORKSPACE_REFERENCE_TYPE,
  BatchProductLibraryError,
  batchProductLibrarySnapshotMediaId,
  importBatchProductLibrarySnapshot,
  releaseBatchWorkspaceReference,
} from "@/lib/batch-product-library/service";

const requestKey = "22222222-2222-4222-8222-222222222222";
const batchId = "11111111-1111-4111-8111-111111111111";

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    scope: "shared",
    ownerUserId: null,
    kind: "image",
    isDeleted: false,
    title: "按摩椅产品图",
    fileUrl: "/uploads/products/shared/image/chair.png",
    mimeType: "image/png",
    ...overrides,
  };
}

function adapter(overrides: Record<string, unknown> = {}) {
  return {
    modeKey: "image_batch",
    sourceId: `image_batch:${batchId}`,
    attach: vi.fn(async (_tx: unknown, mediaId: string) => ({
      value: { id: "relation-1", mediaId },
      reused: false,
    })),
    hasBusinessReference: vi.fn(async () => false),
    ...overrides,
  };
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    authUserId: 7,
    batchId,
    productLibraryItemId: 12,
    requestKey,
    adapter: adapter(),
    ...overrides,
  };
}

describe("batch product-library snapshot service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mediaLibraryItemFindFirst.mockResolvedValue(productRow());
    mocks.readFile.mockResolvedValue(Buffer.from("image-bytes"));
    mocks.getOssObjectBufferByUrl.mockResolvedValue(Buffer.from("oss-image"));
    mocks.client.$queryRaw.mockResolvedValue([{ pg_advisory_xact_lock: null }]);
    mocks.client.mediaReference.count.mockResolvedValue(1);
    mocks.client.mediaReference.deleteMany.mockResolvedValue({ count: 1 });
    mocks.client.mediaReference.upsert.mockResolvedValue({ id: BigInt(1) });
    mocks.client.mediaAsset.updateMany.mockResolvedValue({ count: 1 });
    mocks.uploadToolMedia.mockImplementation(async (input: { mediaId: string }) => ({
      mediaId: input.mediaId,
      status: "ready",
      kind: "image",
      localPreviewUrl: "/uploads/batch_imports/snapshot.png",
      modelUrl: "https://example.com/snapshot.png",
    }));
    mocks.releaseToolMedia.mockResolvedValue({ releasedCount: 1 });
  });

  it("imports a shared image into a batch snapshot and protects it in the same transaction", async () => {
    const input = validInput();
    const snapshotMediaId = batchProductLibrarySnapshotMediaId({
      authUserId: input.authUserId,
      batchId: input.batchId,
      modeKey: input.adapter.modeKey,
      requestKey: input.requestKey,
    });

    const result = await importBatchProductLibrarySnapshot(input);

    expect(mocks.mediaLibraryItemFindFirst).toHaveBeenCalledWith({
      where: { id: 12, isDeleted: false },
    });
    expect(mocks.uploadToolMedia).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 7,
      draftSessionId: `batch-product-library:${requestKey}`,
      storageProfile: "batch",
      mediaId: snapshotMediaId,
      metadata: {
        batchId,
        batchMode: "image_batch",
        productLibraryItemId: 12,
        productLibraryRequestKey: requestKey,
      },
    }));
    expect(input.adapter.attach).toHaveBeenCalledWith(mocks.client, snapshotMediaId);
    expect(mocks.client.mediaReference.upsert).toHaveBeenCalledWith({
      where: {
        mediaId_sourceType_sourceId: {
          mediaId: snapshotMediaId,
          sourceType: BATCH_WORKSPACE_REFERENCE_TYPE,
          sourceId: `image_batch:${batchId}`,
        },
      },
      create: {
        mediaId: snapshotMediaId,
        sourceType: BATCH_WORKSPACE_REFERENCE_TYPE,
        sourceId: `image_batch:${batchId}`,
      },
      update: {},
    });
    expect(mocks.client.mediaAsset.updateMany).toHaveBeenLastCalledWith({
      where: { id: snapshotMediaId },
      data: { referenceCount: 1 },
    });
    expect(result).toEqual({
      mediaId: snapshotMediaId,
      value: { id: "relation-1", mediaId: snapshotMediaId },
      reused: false,
    });
  });

  it("allows the current user's private image", async () => {
    mocks.mediaLibraryItemFindFirst.mockResolvedValue(productRow({
      scope: "private",
      ownerUserId: 7,
    }));

    await expect(importBatchProductLibrarySnapshot(validInput())).resolves.toMatchObject({
      mediaId: expect.any(String),
    });
  });

  it.each([
    [productRow({ scope: "private", ownerUserId: 8 }), 403, "PRODUCT_LIBRARY_FORBIDDEN"],
    [productRow({ kind: "video", mimeType: "video/mp4" }), 400, "PRODUCT_LIBRARY_IMAGE_REQUIRED"],
    [null, 404, "PRODUCT_LIBRARY_ITEM_NOT_FOUND"],
  ])("rejects inaccessible or invalid product-library rows", async (row, status, code) => {
    mocks.mediaLibraryItemFindFirst.mockResolvedValue(row);

    await expect(importBatchProductLibrarySnapshot(validInput())).rejects.toMatchObject({
      status,
      code,
    } satisfies Partial<BatchProductLibraryError>);
    expect(mocks.uploadToolMedia).not.toHaveBeenCalled();
  });

  it("derives stable IDs per qualified request and isolates workspaces and modes", () => {
    const base = {
      authUserId: 7,
      batchId,
      modeKey: "image_batch",
      requestKey,
    };

    expect(batchProductLibrarySnapshotMediaId(base)).toBe(
      batchProductLibrarySnapshotMediaId(base),
    );
    expect(batchProductLibrarySnapshotMediaId(base)).not.toBe(
      batchProductLibrarySnapshotMediaId({
        ...base,
        batchId: "33333333-3333-4333-8333-333333333333",
      }),
    );
    expect(batchProductLibrarySnapshotMediaId(base)).not.toBe(
      batchProductLibrarySnapshotMediaId({ ...base, modeKey: "live_video_batch" }),
    );
  });

  it("reuses the adapter relation on an idempotent retry", async () => {
    const nextAdapter = adapter({
      attach: vi.fn(async (_tx: unknown, mediaId: string) => ({
        value: { id: "existing", mediaId },
        reused: true,
      })),
    });

    await expect(importBatchProductLibrarySnapshot(validInput({
      adapter: nextAdapter,
    }))).resolves.toMatchObject({ reused: true, value: { id: "existing" } });
    expect(mocks.client.mediaReference.upsert).toHaveBeenCalledOnce();
  });

  it("uses configured OSS reads without fetching arbitrary URLs", async () => {
    mocks.mediaLibraryItemFindFirst.mockResolvedValue(productRow({
      fileUrl: "https://bucket.example.com/uploads/products/shared/image/chair.png",
    }));

    await importBatchProductLibrarySnapshot(validInput());

    expect(mocks.getOssObjectBufferByUrl).toHaveBeenCalledWith(
      "https://bucket.example.com/uploads/products/shared/image/chair.png",
    );
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("rejects an unreadable non-local product source", async () => {
    mocks.mediaLibraryItemFindFirst.mockResolvedValue(productRow({
      fileUrl: "https://attacker.example.net/arbitrary.png",
    }));
    mocks.getOssObjectBufferByUrl.mockResolvedValue(null);

    await expect(importBatchProductLibrarySnapshot(validInput())).rejects.toMatchObject({
      code: "PRODUCT_LIBRARY_SOURCE_UNREADABLE",
    });
    expect(mocks.uploadToolMedia).not.toHaveBeenCalled();
  });

  it("compensates the deterministic upload when the relation transaction fails", async () => {
    const nextAdapter = adapter({
      attach: vi.fn(async () => {
        throw new Error("relation failed");
      }),
    });

    await expect(importBatchProductLibrarySnapshot(validInput({
      adapter: nextAdapter,
    }))).rejects.toThrow("relation failed");
    expect(mocks.releaseToolMedia).toHaveBeenCalledWith({
      ownerUserId: 7,
      draftSessionId: `batch-product-library:${requestKey}`,
      mediaIds: [expect.any(String)],
    });
  });

  it("releases the workspace keepalive only after the final business relation", async () => {
    const retained = await releaseBatchWorkspaceReference(mocks.client, {
      mediaId: "44444444-4444-4444-8444-444444444444",
      sourceId: `image_batch:${batchId}`,
      hasBusinessReference: async () => true,
    });
    expect(retained).toBe(false);
    expect(mocks.client.mediaReference.deleteMany).not.toHaveBeenCalled();

    const released = await releaseBatchWorkspaceReference(mocks.client, {
      mediaId: "44444444-4444-4444-8444-444444444444",
      sourceId: `image_batch:${batchId}`,
      hasBusinessReference: async () => false,
    });
    expect(released).toBe(true);
    expect(mocks.client.mediaReference.deleteMany).toHaveBeenCalledWith({
      where: {
        mediaId: "44444444-4444-4444-8444-444444444444",
        sourceType: BATCH_WORKSPACE_REFERENCE_TYPE,
        sourceId: `image_batch:${batchId}`,
      },
    });
  });

  it("supports a future mode through the same adapter contract", async () => {
    const futureAdapter = adapter({
      modeKey: "future_catalog_batch",
      sourceId: `future_catalog_batch:${batchId}`,
      attach: vi.fn(async (_tx: unknown, mediaId: string) => ({
        value: { futureRelationId: "future-1", mediaId },
        reused: false,
      })),
    });

    await expect(importBatchProductLibrarySnapshot(validInput({
      adapter: futureAdapter,
    }))).resolves.toMatchObject({
      value: { futureRelationId: "future-1" },
    });
    expect(mocks.client.mediaReference.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        sourceId: `future_catalog_batch:${batchId}`,
      }),
    }));
  });
});
