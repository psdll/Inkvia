import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const callOrder: string[] = [];
  const tx = {
    adminAssetFeed: { updateMany: vi.fn(async () => ({ count: 2 })) },
    adminWorkFeed: { updateMany: vi.fn(async () => ({ count: 2 })) },
    usageLedger: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    log: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    imageBatchOutput: {
      findMany: vi.fn(async () => [{ itemId: "image-item", item: { groupId: "image-group" } }]),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    imageBatchMedia: {
      findMany: vi.fn(async () => [{ mediaId: "image-media" }]),
    },
    imageBatchItem: {
      deleteMany: vi.fn(async () => {
        callOrder.push("image-card");
        return { count: 1 };
      }),
    },
    imageBatchGroup: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    liveVideoBatchOutput: {
      findMany: vi.fn(async () => [{ itemId: "live-item", batchId: "live-batch" }]),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    liveVideoBatchItem: {
      findMany: vi.fn(async () => [{ sourceMediaId: "live-media" }]),
      deleteMany: vi.fn(async () => {
        callOrder.push("live-card");
        return { count: 1 };
      }),
    },
    liveVideoBatch: {
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    generationInputMedia: {
      findMany: vi.fn(async () => [{ mediaId: "generation-media" }]),
    },
    mediaReference: {
      findMany: vi.fn(async () => [{ mediaId: "generation-output-media", sourceId: "generation:101:0" }]),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    mediaAsset: {
      updateMany: vi.fn(async () => {
        callOrder.push("media-release");
        return { count: 2 };
      }),
    },
    generation: {
      deleteMany: vi.fn(async () => {
        callOrder.push("database");
        return { count: 2 };
      }),
    },
    adminEvent: { createMany: vi.fn(async () => ({ count: 2 })) },
  };
  return {
    callOrder,
    tx,
    generationFindMany: vi.fn(),
    generationFindUnique: vi.fn(),
    generationDelete: vi.fn(),
    logFindMany: vi.fn(),
    logCreate: vi.fn(),
    transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    deleteStoredMediaRefs: vi.fn(async () => {
      callOrder.push("storage");
      return {
        deletedOssObjects: 2,
        deletedLocalFiles: 0,
        deletedOssKeys: ["uploads/generated/a.png", "uploads/generated/b.png"],
        failedOssKeys: [],
        skippedProtectedRefsCount: 0,
      };
    }),
    collectComparableMediaRefsByGenerationWhere: vi.fn(async () => new Set<string>()),
    invalidateAdminUserSummariesCache: vi.fn(async () => undefined),
    enqueueAdminEvent: vi.fn(async () => undefined),
    enqueueMediaCleanupRetryIfNeeded: vi.fn(async () => undefined),
    writeAdminAuditLog: vi.fn(async () => undefined),
    loggerLog: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: () => ({ ok: true, username: "admin" }),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    generation: {
      findMany: mocks.generationFindMany,
      findUnique: mocks.generationFindUnique,
      delete: mocks.generationDelete,
    },
    log: {
      findMany: mocks.logFindMany,
      create: mocks.logCreate,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/media-cleanup", () => ({
  collectMediaRefs: (value: unknown, out: Set<string>) => {
    if (typeof value === "string" && value.trim()) out.add(value.trim());
  },
  normalizeComparableMediaRef: (value: unknown) => String(value || "").trim(),
  collectComparableMediaRefsByGenerationWhere: mocks.collectComparableMediaRefsByGenerationWhere,
  deleteStoredMediaRefs: mocks.deleteStoredMediaRefs,
}));

vi.mock("@/lib/admin-asset-feed", () => ({
  markAdminAssetFeedDeleted: vi.fn(async () => 0),
}));

vi.mock("@/lib/admin-user-scope", () => ({
  invalidateAdminUserSummariesCache: mocks.invalidateAdminUserSummariesCache,
}));

vi.mock("@/lib/admin-operational", () => ({
  writeAdminAuditLog: mocks.writeAdminAuditLog,
}));

vi.mock("@/lib/media-cleanup-retry", () => ({
  enqueueMediaCleanupRetryIfNeeded: mocks.enqueueMediaCleanupRetryIfNeeded,
}));

vi.mock("@/lib/logger", () => ({
  Logger: { log: mocks.loggerLog },
}));

import { POST } from "@/app/api/admin/generation/delete/route";

const targetRows = [
  {
    id: 101,
    userId: "device-a",
    authUserId: 7,
    type: "image_gen",
    status: "success",
    model: "model-a",
    localPath: "/uploads/generated/a.png",
    templateData: null,
  },
  {
    id: 102,
    userId: "device-a",
    authUserId: 7,
    type: "image_gen",
    status: "success",
    model: "model-a",
    localPath: "/uploads/generated/b.png",
    templateData: null,
  },
];

describe("admin generation bulk deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callOrder.length = 0;
    mocks.generationFindMany.mockImplementation(async ({ where }: any) => {
      if (where?.id?.in) return targetRows.filter((row) => where.id.in.includes(row.id));
      if (where?.type === "import") return [];
      return [];
    });
    mocks.logFindMany.mockResolvedValue([]);
    mocks.logCreate.mockResolvedValue({});
    mocks.collectComparableMediaRefsByGenerationWhere.mockResolvedValue(new Set());
    mocks.deleteStoredMediaRefs.mockImplementation(async () => {
      mocks.callOrder.push("storage");
      return {
        deletedOssObjects: 2,
        deletedLocalFiles: 0,
        deletedOssKeys: ["uploads/generated/a.png", "uploads/generated/b.png"],
        failedOssKeys: [],
        skippedProtectedRefsCount: 0,
      };
    });
  });

  it("deletes a deduplicated id batch in one database operation and cleans storage after commit", async () => {
    const request = new NextRequest("http://localhost/api/admin/generation/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [101, 102, 102] }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      requestedCount: 2,
      deletedGenerations: 2,
      failedDeletes: 0,
      deletedOssObjects: 2,
    });
    expect(mocks.tx.generation.deleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.tx.generation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [101, 102] } },
    });
    expect(mocks.generationFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        type: "import",
        localPath: { in: ["/uploads/generated/a.png", "/uploads/generated/b.png"] },
      }),
    }));
    expect(mocks.deleteStoredMediaRefs).toHaveBeenCalledTimes(1);
    expect(mocks.tx.imageBatchItem.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["image-item"] } },
    });
    expect(mocks.tx.imageBatchGroup.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["image-group"] }, items: { none: {} } },
    });
    expect(mocks.tx.liveVideoBatchItem.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["live-item"] } },
    });
    expect(mocks.tx.liveVideoBatch.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["live-batch"] }, items: { none: {} } },
    });
    expect(mocks.tx.mediaAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ["image-media", "live-media", "generation-media", "generation-output-media"] },
        references: { none: {} },
        runOutputs: { none: {} },
        batchMedia: { none: {} },
        liveVideoBatchItems: { none: {} },
        generationInputs: { none: {} },
      }),
      data: expect.objectContaining({ status: "soft_deleted" }),
    }));
    expect(mocks.tx.mediaReference.deleteMany).toHaveBeenCalledWith({
      where: {
        sourceType: "generation",
        sourceId: { in: ["generation:101:0", "generation:102:0"] },
      },
    });
    expect(mocks.callOrder).toEqual([
      "image-card",
      "live-card",
      "database",
      "media-release",
      "storage",
    ]);
    expect(mocks.invalidateAdminUserSummariesCache).toHaveBeenCalledTimes(1);
  });

  it("keeps the single-id request compatible", async () => {
    const response = await POST(new NextRequest("http://localhost/api/admin/generation/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 101 }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      requestedCount: 1,
      deletedGenerations: 1,
      failedDeletes: 0,
    });
    expect(mocks.tx.generation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [101] } },
    });
  });

  it("reports ids that disappeared before a batch request", async () => {
    const response = await POST(new NextRequest("http://localhost/api/admin/generation/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [101, 999] }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      requestedCount: 2,
      deletedGenerations: 1,
      failedDeletes: 1,
      missingIds: [999],
    });
  });

  it("deletes audio using the same transaction, tombstones and protected storage cleanup", async () => {
    const audio = { ...targetRows[0], type: "audio_gen", localPath: "/uploads/canvas_audio_results/a.mp3" };
    mocks.generationFindMany.mockImplementation(async ({ where }: any) => where?.id?.in?.includes(101) ? [audio] : []);
    const response = await POST(new NextRequest("http://localhost/api/admin/generation/delete", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: 101 }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deletedGenerationIds: [101], deletedGenerations: 1 });
    expect(mocks.tx.generation.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [101] } } });
    expect(mocks.tx.adminWorkFeed.updateMany).toHaveBeenCalled();
    expect(mocks.deleteStoredMediaRefs).toHaveBeenCalledWith([audio.localPath], expect.objectContaining({ canonicalGenerationOutputs: true }));
    expect(mocks.callOrder.indexOf("database")).toBeLessThan(mocks.callOrder.indexOf("storage"));
  });

  it("persists a retry event when physical cleanup does not delete every candidate", async () => {
    mocks.deleteStoredMediaRefs.mockResolvedValueOnce({
      deletedOssObjects: 0,
      deletedLocalFiles: 0,
      deletedOssKeys: [],
      failedOssKeys: ["uploads/generated/a.png: temporary failure"] as string[],
      skippedProtectedRefsCount: 0,
      ossError: "temporary failure",
    } as any);

    const response = await POST(new NextRequest("http://localhost/api/admin/generation/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 101 }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.enqueueMediaCleanupRetryIfNeeded).toHaveBeenCalledWith(
      ["/uploads/generated/a.png"],
      expect.objectContaining({ ossError: "temporary failure" }),
      expect.objectContaining({
        source: "admin_generation_delete",
        generationIds: [101],
      }),
    );
  });

  it("uses one HTTP request for the selected works instead of one request per id", () => {
    const source = readFileSync(resolve(process.cwd(), "app/admin/page.tsx"), "utf8");
    const start = source.indexOf('if (confirmAction.type === "bulk_delete_generations")');
    const end = source.indexOf('if (confirmAction.type === "bulk_delete_imports")', start);
    const handler = source.slice(start, end);

    expect(handler).toContain('body: JSON.stringify({ ids })');
    expect(handler).toContain("Array.isArray(json?.failedOssKeysPreview) ? json.failedOssKeysPreview.length : 0");
    expect(handler).not.toContain("const concurrency = 5");
    expect(handler).not.toContain("const worker = async");
  });
});
