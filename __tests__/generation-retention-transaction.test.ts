import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const callOrder: string[] = [];
  const tx = {
    log: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    usageLedger: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    adminAssetFeed: { updateMany: vi.fn(async () => ({ count: 1 })) },
    adminWorkFeed: { updateMany: vi.fn(async () => ({ count: 1 })) },
    imageBatchOutput: {
      findMany: vi.fn(async () => [{ itemId: "image-item", item: { groupId: "image-group" } }]),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    imageBatchMedia: { findMany: vi.fn(async () => []) },
    imageBatchItem: { deleteMany: vi.fn(async () => { callOrder.push("card"); return { count: 1 }; }) },
    imageBatchGroup: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    liveVideoBatchOutput: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
    liveVideoBatchItem: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
    liveVideoBatch: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    generationInputMedia: { findMany: vi.fn(async () => []) },
    mediaReference: { findMany: vi.fn(async () => []), deleteMany: vi.fn(async () => ({ count: 0 })) },
    mediaAsset: { updateMany: vi.fn(async () => ({ count: 0 })) },
    generation: { deleteMany: vi.fn(async () => { callOrder.push("generation"); return { count: 1 }; }) },
  };
  return {
    callOrder,
    tx,
    generationFindMany: vi.fn(),
    transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    computeRefs: vi.fn(async () => ["/uploads/generated/a.png"]),
    deleteRefs: vi.fn(async () => {
      callOrder.push("physical");
      return {
        deletedLocalFiles: 1,
        deletedOssObjects: 0,
        failedOssKeys: [],
        failedLocalFiles: [],
        skippedProtectedRefsCount: 0,
        ossError: "",
      };
    }),
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    generation: { findMany: mocks.generationFindMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/media-cleanup", () => ({
  computeDeletableRefsForGenerationIds: mocks.computeRefs,
  deleteStoredMediaRefs: mocks.deleteRefs,
}));
vi.mock("@/lib/media-cleanup-retry", () => ({
  enqueueMediaCleanupRetry: vi.fn(async () => null),
  enqueueMediaCleanupRetryIfNeeded: vi.fn(async () => null),
}));

import { pruneGenerationsAndFiles } from "@/lib/log-retention";

describe("generation retention transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callOrder.length = 0;
    mocks.generationFindMany
      .mockResolvedValueOnce([{ id: 101 }])
      .mockResolvedValueOnce([]);
  });

  it("removes cards and Generation in one transaction before physical output deletion", async () => {
    await expect(pruneGenerationsAndFiles(new Date("2026-08-01T00:00:00.000Z")))
      .resolves.toEqual(expect.objectContaining({ deletedGenerations: 1, deletedFiles: 1 }));

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.callOrder).toEqual(["card", "generation", "physical"]);
    expect(mocks.deleteRefs).toHaveBeenCalledWith(
      ["/uploads/generated/a.png"],
      expect.objectContaining({
        canonicalGenerationOutputs: true,
      }),
    );
    const cleanupOptions = (mocks.deleteRefs.mock.calls as unknown as Array<[string[], Record<string, unknown>]>)[0]?.[1];
    expect(cleanupOptions).not.toHaveProperty("protectedGenerationComparableRefs");
  });
});
