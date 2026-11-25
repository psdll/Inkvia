import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = {
    $queryRaw: vi.fn(),
    imageBatch: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    imageBatchGroup: {
      create: vi.fn(),
      aggregate: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    imageBatchItem: {
      count: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    imageBatchMedia: {
      count: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    mediaAsset: {
      updateMany: vi.fn(),
    },
    generationInputMedia: {
      count: vi.fn(),
    },
  };
  return {
    client,
    transaction: vi.fn(async (callback: (tx: typeof client) => unknown) => callback(client)),
    uploadToolMedia: vi.fn(),
    releaseToolMedia: vi.fn(),
    importBatchProductLibrarySnapshot: vi.fn(),
    releaseBatchWorkspaceReference: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  default: { ...mocks.client, $transaction: mocks.transaction },
}));
vi.mock("@/lib/tool-media/service", () => ({
  uploadToolMedia: mocks.uploadToolMedia,
  releaseToolMedia: mocks.releaseToolMedia,
}));
vi.mock("@/lib/batch-product-library/service", () => ({
  importBatchProductLibrarySnapshot: mocks.importBatchProductLibrarySnapshot,
  releaseBatchWorkspaceReference: mocks.releaseBatchWorkspaceReference,
}));

import {
  ImageBatchServiceError,
  applyBatchPrompts,
  createDetachedSegmentedPromptGroup,
  createStyleReplicationGroups,
  createImageBatch,
  getOrCreateImageBatchTemplate,
  getImageBatchGroupHistory,
  getOwnedImageBatch,
  importImageBatchProductLibraryMedia,
  detachBatchMedia,
  listImageBatchGroups,
  listImageBatchGroupStatuses,
  previewBatchPrompts,
  uploadAndAttachBatchMedia,
  uploadAndAttachBatchMediaFiles,
  updateImageBatchDraft,
} from "@/lib/image-batch/service";

describe("image batch service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client.imageBatch.create.mockResolvedValue({ id: "batch-1", version: 1 });
    mocks.client.imageBatch.findUnique.mockResolvedValue({
      id: "batch-1",
      items: [],
      groups: [],
      media: [],
      outputs: [],
    });
    mocks.client.$queryRaw.mockResolvedValue([{ pg_advisory_xact_lock: null }]);
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "batch-1",
      authUserId: 7,
      mode: "style_replication",
      status: "draft",
      version: 3,
      deletedAt: null,
      items: [],
      media: [],
      outputs: [],
    });
    mocks.client.imageBatch.updateMany.mockResolvedValue({ count: 1 });
    mocks.client.imageBatch.update.mockResolvedValue({ version: 4 });
    mocks.client.imageBatchGroup.create.mockResolvedValue({
      id: "group-1",
      position: 0,
      name: "分组#1",
    });
    mocks.client.imageBatchGroup.findFirst.mockResolvedValue(null);
    mocks.client.imageBatchGroup.findUnique.mockResolvedValue({
      id: "group-1",
      batchId: "batch-1",
      items: [],
    });
    mocks.client.imageBatchGroup.findMany.mockResolvedValue([]);
    mocks.client.imageBatchGroup.aggregate.mockResolvedValue({ _max: { sequence: null } });
    mocks.client.imageBatchGroup.count.mockResolvedValue(0);
    mocks.client.imageBatchGroup.updateMany.mockResolvedValue({ count: 1 });
    mocks.client.imageBatchItem.createMany.mockResolvedValue({ count: 2 });
    mocks.client.imageBatchItem.create
      .mockResolvedValueOnce({ id: "item-1" })
      .mockResolvedValueOnce({ id: "item-2" });
    mocks.client.imageBatchItem.count.mockResolvedValue(0);
    mocks.client.imageBatchItem.findFirst.mockResolvedValue({ id: "item-1" });
    mocks.client.imageBatchItem.findMany.mockResolvedValue([]);
    mocks.client.imageBatchItem.update.mockResolvedValue({ id: "item-1" });
    mocks.client.imageBatchMedia.count.mockResolvedValue(0);
    mocks.client.imageBatchMedia.create.mockResolvedValue({
      id: BigInt(10),
      mediaId: "uploaded-media",
      role: "product",
      media: {},
    });
    mocks.client.imageBatchMedia.createMany.mockResolvedValue({ count: 6 });
    mocks.client.imageBatchMedia.findMany.mockResolvedValue([]);
    mocks.client.imageBatchMedia.findFirst.mockResolvedValue(null);
    mocks.client.generationInputMedia.count.mockResolvedValue(0);
    mocks.client.mediaAsset.updateMany.mockResolvedValue({ count: 1 });
    mocks.uploadToolMedia.mockResolvedValue({ mediaId: "uploaded-media" });
    mocks.releaseToolMedia.mockResolvedValue({ releasedCount: 0 });
    mocks.importBatchProductLibrarySnapshot.mockImplementation(async (input: any) => {
      const attached = await input.adapter.attach(mocks.client, "product-snapshot");
      return { mediaId: "product-snapshot", ...attached };
    });
    mocks.releaseBatchWorkspaceReference.mockImplementation(async (_tx: unknown, input: any) => {
      return !(await input.hasBusinessReference());
    });
  });

  it("imports product-library media through the image workspace adapter", async () => {
    mocks.client.imageBatchMedia.create.mockResolvedValueOnce({
      id: BigInt(12),
      mediaId: "product-snapshot",
      role: "product",
      position: 0,
      media: { id: "product-snapshot" },
    });

    const result = await importImageBatchProductLibraryMedia({
      authUserId: 7,
      batchId: "batch-1",
      productLibraryItemId: 12,
      requestKey: "22222222-2222-4222-8222-222222222222",
      itemId: null,
      role: "product",
    });

    expect(mocks.importBatchProductLibrarySnapshot).toHaveBeenCalledWith(expect.objectContaining({
      authUserId: 7,
      batchId: "batch-1",
      productLibraryItemId: 12,
      requestKey: "22222222-2222-4222-8222-222222222222",
      adapter: expect.objectContaining({
        modeKey: "image_batch",
        sourceId: "image_batch:batch-1",
      }),
    }));
    expect(mocks.client.imageBatchMedia.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        batchId: "batch-1",
        itemId: null,
        mediaId: "product-snapshot",
        role: "product",
      }),
    }));
    expect(result).toMatchObject({
      relation: { mediaId: "product-snapshot" },
      version: 4,
    });
  });

  it("reuses the same image relation on an idempotent product-library retry", async () => {
    mocks.client.imageBatchMedia.findFirst.mockResolvedValueOnce({
      id: BigInt(12),
      mediaId: "product-snapshot",
      role: "product",
      position: 0,
      media: { id: "product-snapshot" },
    });

    const result = await importImageBatchProductLibraryMedia({
      authUserId: 7,
      batchId: "batch-1",
      productLibraryItemId: 12,
      requestKey: "22222222-2222-4222-8222-222222222222",
      role: "product",
    });

    expect(mocks.client.imageBatchMedia.create).not.toHaveBeenCalled();
    expect(mocks.client.imageBatch.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ relation: { id: BigInt(12) }, version: 3 });
  });

  it("allows an idempotent image product-library retry at the product limit", async () => {
    mocks.client.imageBatchMedia.count.mockResolvedValue(20);
    mocks.client.imageBatchMedia.findFirst.mockResolvedValueOnce({
      id: BigInt(12),
      mediaId: "product-snapshot",
      role: "product",
      position: 19,
      media: { id: "product-snapshot" },
    });

    const result = await importImageBatchProductLibraryMedia({
      authUserId: 7,
      batchId: "batch-1",
      productLibraryItemId: 12,
      requestKey: "22222222-2222-4222-8222-222222222222",
      role: "product",
    });

    expect(mocks.client.imageBatchMedia.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ relation: { id: BigInt(12) }, version: 3 });
  });

  it("creates an owned versioned draft with server defaults", async () => {
    await createImageBatch({ authUserId: 7, mode: "multi_prompt", name: "夏季产品" });

    expect(mocks.client.imageBatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        authUserId: 7,
        mode: "multi_prompt",
        name: "夏季产品",
        status: "draft",
        version: 1,
      }),
    }));
  });

  it("never returns a deleted or foreign batch", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue(null);

    await expect(getOwnedImageBatch("batch-1", 8)).rejects.toMatchObject({
      name: "ImageBatchServiceError",
      status: 404,
      code: "BATCH_NOT_FOUND",
    } satisfies Partial<ImageBatchServiceError>);
    expect(mocks.client.imageBatch.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "batch-1", authUserId: 8, deletedAt: null },
    }));
  });

  it("returns a stable 409 error when optimistic draft update loses the race", async () => {
    mocks.client.imageBatch.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      updateImageBatchDraft({
        authUserId: 7,
        batchId: "batch-1",
        expectedVersion: 3,
        batch: { sharedPrompt: "保持产品准确" },
        itemChanges: [],
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "BATCH_VERSION_CONFLICT",
    });
  });

  it("marks a task draft when generation inputs change", async () => {
    await updateImageBatchDraft({
      authUserId: 7,
      batchId: "batch-1",
      expectedVersion: 3,
      itemChanges: [
        {
          op: "update",
          itemId: "item-1",
          patch: { prompt: "新的独立提示词" },
        },
      ],
    });

    expect(mocks.client.imageBatchItem.updateMany).toHaveBeenCalledWith({
      where: { id: "item-1", batchId: "batch-1" },
      data: {
        prompt: "新的独立提示词",
        status: "draft",
      },
    });
    expect(mocks.client.imageBatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "draft",
        finishedAt: null,
      }),
    }));
  });

  it("persists a legacy group rename without marking tasks for regeneration", async () => {
    await updateImageBatchDraft({
      authUserId: 7,
      batchId: "batch-1",
      expectedVersion: 3,
      itemChanges: [],
      groupChanges: [{ groupId: "legacy", name: "首批夏季海报" }],
    });

    expect(mocks.client.imageBatchGroup.create).toHaveBeenCalledWith({
      data: {
        authUserId: 7,
        batchId: "batch-1",
        position: 0,
        sequence: 1,
        name: "首批夏季海报",
      },
      select: { id: true },
    });
    expect(mocks.client.imageBatchItem.updateMany).toHaveBeenCalledWith({
      where: { batchId: "batch-1", groupId: null },
      data: { groupId: "group-1" },
    });
    expect(mocks.client.imageBatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { version: { increment: 1 } },
    }));
  });

  it("finds the reusable mode template directly instead of relying on the recent list limit", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "template",
      mode: "multi_prompt",
      version: 4,
      groups: [],
      items: [],
      media: [],
    });

    const template = await getOrCreateImageBatchTemplate({
      authUserId: 7,
      mode: "multi_prompt",
    });

    expect(mocks.client.imageBatch.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        authUserId: 7,
        mode: "multi_prompt",
        deletedAt: null,
        groups: { none: {} },
        items: { none: {} },
      },
      orderBy: [
        { updatedAt: "desc" },
        { createdAt: "desc" },
      ],
    }));
    expect(template.id).toBe("template");
  });

  it("returns the existing segmented-prompt group when a continuation request is retried", async () => {
    const requestKey = "22222222-2222-4222-8222-222222222222";
    const existingGroup = {
      id: "existing-group",
      batchId: requestKey,
      items: [{ id: "existing-item" }],
    };
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "template",
      authUserId: 7,
      mode: "multi_prompt",
      status: "draft",
      deletedAt: null,
    });
    mocks.client.imageBatchGroup.findFirst.mockResolvedValue(existingGroup);
    mocks.client.imageBatchGroup.findUnique.mockResolvedValue(existingGroup);

    const result = await createDetachedSegmentedPromptGroup({
      authUserId: 7,
      templateBatchId: "template",
      requestKey,
      sharedPrompt: "产品海报",
      sharedSettings: { model: "gpt-image-2" },
      generatedPrompt: "第一条提示词",
      mediaSnapshots: [],
    } as any);

    expect(result).toEqual({ group: existingGroup });
    expect(mocks.client.imageBatch.create).not.toHaveBeenCalled();
    expect(mocks.client.imageBatchGroup.create).not.toHaveBeenCalled();
  });

  it("marks a new Skill-generated segmented group with its original user prompt", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "template",
      authUserId: 7,
      mode: "multi_prompt",
      status: "draft",
      deletedAt: null,
    });

    await createDetachedSegmentedPromptGroup({
      authUserId: 7,
      templateBatchId: "template",
      requestKey: "22222222-2222-4222-8222-222222222222",
      sharedPrompt: "用户原始提示词",
      sharedSettings: { model: "gpt-image-2" },
      generatedPrompt: "第一条提示词",
      skill: { id: "system:4", name: "商品分镜", revision: 2 },
      mediaSnapshots: [],
    });

    expect(mocks.client.imageBatch.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sharedSettings: expect.objectContaining({
          skillUserPrompt: "用户原始提示词",
          skill: { id: "system:4", name: "商品分镜", revision: 2 },
        }),
      }),
    }));
  });

  it("recovers the existing segmented-prompt group after a concurrent retry collision", async () => {
    const requestKey = "22222222-2222-4222-8222-222222222222";
    const existingGroup = {
      id: "existing-group",
      batchId: requestKey,
      items: [{ id: "existing-item" }],
    };
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "template",
      authUserId: 7,
      mode: "multi_prompt",
      status: "draft",
      deletedAt: null,
    });
    mocks.client.imageBatchGroup.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingGroup);
    mocks.client.imageBatch.create.mockRejectedValue(
      Object.assign(new Error("unique collision"), { code: "P2002" }),
    );

    await expect(createDetachedSegmentedPromptGroup({
      authUserId: 7,
      templateBatchId: "template",
      requestKey,
      sharedPrompt: "产品海报",
      sharedSettings: { model: "gpt-image-2" },
      generatedPrompt: "第一条提示词",
      mediaSnapshots: [],
    })).resolves.toEqual({ group: existingGroup });
  });

  it("lists history groups for the requested grouped workflow mode", async () => {
    mocks.client.imageBatchGroup.findMany.mockResolvedValue([]);

    await listImageBatchGroups({
      authUserId: 7,
      mode: "multi_prompt",
      take: 5,
    });

    expect(mocks.client.imageBatchGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          batch: expect.objectContaining({
            authUserId: 7,
            mode: "multi_prompt",
          }),
        }),
      }),
    );
  });

  it("allows status and detail reads for multi-prompt history batches", async () => {
    mocks.client.imageBatchGroup.findMany.mockResolvedValue([]);
    mocks.client.imageBatchGroup.findFirst.mockResolvedValue({ id: "group-1" });

    await listImageBatchGroupStatuses({
      authUserId: 7,
      batchIds: "multi-batch",
    });
    await getImageBatchGroupHistory({
      authUserId: 7,
      batchId: "multi-batch",
      groupId: "group-1",
    });

    const statusWhere = mocks.client.imageBatchGroup.findMany.mock.calls[0][0].where;
    const detailWhere = mocks.client.imageBatchGroup.findFirst.mock.calls[0][0].where;
    expect(statusWhere.batch).not.toHaveProperty("mode");
    expect(detailWhere.batch).not.toHaveProperty("mode");
  });

  it("rejects a group name that cannot be used as a download filename", async () => {
    await expect(
      updateImageBatchDraft({
        authUserId: 7,
        batchId: "batch-1",
        expectedVersion: 3,
        itemChanges: [],
        groupChanges: [{ groupId: "group-1", name: "松胜:新品" }],
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "BATCH_GROUP_NAME_INVALID",
      message: '分组名称不能包含 \\ / : * ? " < > |',
    });
    expect(mocks.client.imageBatchGroup.updateMany).not.toHaveBeenCalled();
  });

  it("allows renaming a group while its batch is running", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "batch-1",
      authUserId: 7,
      version: 3,
      status: "running",
      deletedAt: null,
      items: [],
      media: [],
      outputs: [],
    });

    await updateImageBatchDraft({
      authUserId: 7,
      batchId: "batch-1",
      expectedVersion: 3,
      itemChanges: [],
      groupChanges: [{ groupId: "group-1", name: "生成中的新分组名" }],
    });

    expect(mocks.client.imageBatchGroup.updateMany).toHaveBeenCalledWith({
      where: { id: "group-1", batchId: "batch-1" },
      data: { name: "生成中的新分组名" },
    });
    expect(mocks.client.imageBatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { version: { increment: 1 } },
    }));
  });

  it("allows editing a completed task prompt while sibling tasks are running", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "batch-1",
      authUserId: 7,
      mode: "style_replication",
      version: 3,
      status: "running",
      deletedAt: null,
      items: [
        { id: "item-1", outputs: [{ slotIndex: 0, attempt: 1, status: "success" }] },
        { id: "item-2", outputs: [{ slotIndex: 0, attempt: 1, status: "running" }] },
      ],
      media: [],
      outputs: [],
    });

    await updateImageBatchDraft({
      authUserId: 7,
      batchId: "batch-1",
      expectedVersion: 3,
      itemChanges: [{ itemId: "item-1", patch: { prompt: "下一次使用的新提示词" } }],
    });

    expect(mocks.client.imageBatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { version: { increment: 1 } },
    }));
    expect(mocks.client.imageBatchItem.updateMany).toHaveBeenCalledWith({
      where: { id: "item-1", batchId: "batch-1" },
      data: { prompt: "下一次使用的新提示词", status: "draft" },
    });
  });

  it("rejects prompt edits for a task that is still running", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "batch-1",
      authUserId: 7,
      version: 3,
      status: "running",
      deletedAt: null,
      items: [
        { id: "item-1", outputs: [{ slotIndex: 0, attempt: 1, status: "running" }] },
      ],
      media: [],
      outputs: [],
    });

    await expect(
      updateImageBatchDraft({
        authUserId: 7,
        batchId: "batch-1",
        expectedVersion: 3,
        itemChanges: [{ itemId: "item-1", patch: { prompt: "不能修改" } }],
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "BATCH_ALREADY_RUNNING",
    });
    expect(mocks.client.imageBatch.updateMany).not.toHaveBeenCalled();
  });

  it("applies confirmed prompts as ordered independent tasks", async () => {
    await applyBatchPrompts({
      authUserId: 7,
      batchId: "batch-1",
      prompts: ["雪地场景", "咖啡馆场景"],
    });

    expect(mocks.client.imageBatchItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ batchId: "batch-1", position: 0, prompt: "雪地场景" }),
        expect.objectContaining({ batchId: "batch-1", position: 1, prompt: "咖啡馆场景" }),
      ],
    });
  });

  it("rejects prompt splitting above the existing 50-task limit instead of truncating silently", () => {
    const text = Array.from({ length: 51 }, (_, index) => `提示词 ${index + 1}`).join("\n");

    expect(() => previewBatchPrompts(text)).toThrowError("每次最多拆分 50 个任务");
  });

  it("creates one snapshot task per product and copies every reference", async () => {
    mocks.client.imageBatch.findFirst
      .mockResolvedValueOnce({
        id: "batch-1",
        authUserId: 7,
        mode: "style_replication",
        status: "draft",
        sharedPrompt: "保持产品准确，复刻参考图风格",
        sharedSettings: {
          schemaVersion: 1,
          model: "nano-banana-pro",
          aspectRatio: "3:4",
          resolution: "2K",
        },
        media: [
          { id: BigInt(1), mediaId: "product-1", role: "product", itemId: null, position: 0 },
          { id: BigInt(2), mediaId: "product-2", role: "product", itemId: null, position: 1 },
          { id: BigInt(3), mediaId: "reference-1", role: "reference", itemId: null, position: 0 },
          { id: BigInt(4), mediaId: "reference-2", role: "reference", itemId: null, position: 1 },
        ],
        _count: { items: 0 },
      })
      .mockResolvedValueOnce({
        id: "batch-1",
        authUserId: 7,
        items: [{ id: "item-1" }, { id: "item-2" }],
        media: [],
        outputs: [],
      });

    const batch = await createStyleReplicationGroups({
      authUserId: 7,
      batchId: "batch-1",
    });

    expect(mocks.client.imageBatchGroup.create).toHaveBeenCalledWith({
      data: {
        authUserId: 7,
        batchId: "batch-1",
        position: 0,
        sequence: 1,
        name: "分组#1",
      },
      select: { id: true },
    });
    expect(mocks.client.imageBatchItem.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        batchId: "batch-1",
        groupId: "group-1",
        position: 0,
        prompt: "保持产品准确，复刻参考图风格",
        includeSharedPrompt: false,
        overrides: expect.objectContaining({
          model: "nano-banana-pro",
          aspectRatio: "3:4",
          resolution: "2K",
        }),
        status: "draft",
      }),
      select: { id: true },
    });
    expect(mocks.client.imageBatchItem.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        batchId: "batch-1",
        groupId: "group-1",
        position: 1,
        prompt: "保持产品准确，复刻参考图风格",
        includeSharedPrompt: false,
      }),
      select: { id: true },
    });
    expect(mocks.client.imageBatchMedia.createMany).toHaveBeenNthCalledWith(1, {
      data: [
        expect.objectContaining({ batchId: "batch-1", itemId: "item-1", mediaId: "product-1", role: "product", position: 0 }),
        expect.objectContaining({ batchId: "batch-1", itemId: "item-1", mediaId: "reference-1", role: "reference", position: 0 }),
        expect.objectContaining({ batchId: "batch-1", itemId: "item-1", mediaId: "reference-2", role: "reference", position: 1 }),
      ],
    });
    expect(mocks.client.imageBatchMedia.createMany).toHaveBeenNthCalledWith(2, {
      data: [
        expect.objectContaining({ batchId: "batch-1", itemId: "item-2", mediaId: "product-2", role: "product", position: 0 }),
        expect.objectContaining({ batchId: "batch-1", itemId: "item-2", mediaId: "reference-1", role: "reference", position: 0 }),
        expect.objectContaining({ batchId: "batch-1", itemId: "item-2", mediaId: "reference-2", role: "reference", position: 1 }),
      ],
    });
    expect(mocks.client.imageBatch.update).toHaveBeenCalledWith({
      where: { id: "batch-1" },
      data: expect.objectContaining({ status: "draft", version: { increment: 1 } }),
    });
    expect(batch.items).toHaveLength(2);
  });

  it("increments the generated group number for every later snapshot", async () => {
    mocks.client.imageBatch.findFirst
      .mockResolvedValueOnce({
        id: "batch-1",
        authUserId: 7,
        mode: "style_replication",
        status: "draft",
        sharedPrompt: "保持产品内容并复制参考风格",
        sharedSettings: { model: "nano-banana-pro" },
        media: [
          { mediaId: "product-1", role: "product", itemId: null, position: 0 },
          { mediaId: "reference-1", role: "reference", itemId: null, position: 0 },
        ],
        _count: { items: 2 },
      })
      .mockResolvedValueOnce({
        id: "batch-1",
        authUserId: 7,
        items: [{ id: "item-3" }],
        groups: [{ id: "group-2", position: 1, name: "分组#2" }],
        media: [],
        outputs: [],
      });
    mocks.client.imageBatchGroup.findMany.mockResolvedValue([{ position: 0 }]);
    mocks.client.imageBatchGroup.aggregate.mockResolvedValue({ _max: { sequence: 1 } });
    mocks.client.imageBatchGroup.create.mockResolvedValue({
      id: "group-2",
      position: 1,
      name: "分组#2",
    });

    await createStyleReplicationGroups({ authUserId: 7, batchId: "batch-1" });

    expect(mocks.client.imageBatchGroup.create).toHaveBeenCalledWith({
      data: {
        authUserId: 7,
        batchId: "batch-1",
        position: 1,
        sequence: 2,
        name: "分组#2",
      },
      select: { id: true },
    });
  });

  it("keeps custom batches out of the style-replication group service", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "batch-1",
      authUserId: 7,
      mode: "multi_prompt",
      status: "draft",
      sharedPrompt: "保持产品准确，复刻参考图风格",
      sharedSettings: { model: "nano-banana-pro" },
      media: [],
      _count: { items: 0 },
    });

    await expect(createStyleReplicationGroups({
      authUserId: 7,
      batchId: "batch-1",
    })).rejects.toMatchObject({ code: "BATCH_GROUP_MODE_INVALID" });

    expect(mocks.client.imageBatchGroup.create).not.toHaveBeenCalled();
    expect(mocks.client.imageBatchItem.create).not.toHaveBeenCalled();
  });

  it("appends batch products after the highest persisted position", async () => {
    mocks.client.imageBatchMedia.findFirst.mockResolvedValue({ position: 4 });

    await uploadAndAttachBatchMedia({
      authUserId: 7,
      batchId: "batch-1",
      draftSessionId: "draft-1",
      file: new File(["image"], "product.png", { type: "image/png" }),
      itemId: null,
      role: "product",
    });

    expect(mocks.client.imageBatchMedia.findFirst).toHaveBeenCalledWith({
      where: { batchId: "batch-1", itemId: null, role: "product" },
      orderBy: [{ position: "desc" }, { id: "desc" }],
      select: { position: true },
    });
    expect(mocks.client.imageBatchMedia.count).toHaveBeenCalledTimes(1);
    expect(mocks.client.imageBatchMedia.create).toHaveBeenCalledWith({
      data: {
        batchId: "batch-1",
        itemId: null,
        mediaId: "uploaded-media",
        role: "product",
        position: 5,
      },
      include: { media: true },
    });
  });

  it("casts the advisory lock result to a Prisma-supported type", async () => {
    await uploadAndAttachBatchMedia({
      authUserId: 7,
      batchId: "batch-1",
      draftSessionId: "draft-1",
      file: new File(["image"], "product.png", { type: "image/png" }),
      itemId: null,
      role: "product",
    });

    const lockQuery = mocks.client.$queryRaw.mock.calls[0]?.[0] as {
      sql?: string;
      text?: string;
    };
    expect(lockQuery?.text || lockQuery?.sql).toMatch(
      /pg_advisory_xact_lock\([\s\S]*\)::text/,
    );
  });

  it("replaces the product only inside one task and marks that task draft", async () => {
    mocks.client.imageBatchMedia.findMany.mockResolvedValue([
      { id: BigInt(8), mediaId: "old-product", media: {} },
    ]);

    const result = await uploadAndAttachBatchMedia({
      authUserId: 7,
      batchId: "batch-1",
      draftSessionId: "draft-1",
      file: new File(["image"], "replacement.png", { type: "image/png" }),
      itemId: "item-1",
      role: "product",
    });

    expect(mocks.client.imageBatchMedia.deleteMany).toHaveBeenCalledWith({
      where: { batchId: "batch-1", itemId: "item-1", role: "product" },
    });
    expect(mocks.client.imageBatchItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { status: "draft" },
    });
    expect(mocks.client.imageBatch.update).toHaveBeenCalledWith({
      where: { id: "batch-1" },
      data: {
        status: "draft",
        finishedAt: null,
        version: { increment: 1 },
      },
      select: { version: true },
    });
    expect(result).toMatchObject({
      relation: expect.objectContaining({ mediaId: "uploaded-media" }),
      version: 4,
    });
  });

  it("attaches one uploaded file batch in one transaction and one version increment", async () => {
    mocks.client.imageBatchMedia.findFirst.mockResolvedValue({ position: 2 });
    mocks.uploadToolMedia.mockImplementation(async ({ file }: { file: File }) => ({
      mediaId: `media-${file.name}`,
    }));
    mocks.client.imageBatchMedia.create.mockImplementation(async ({ data }: any) => ({
      id: BigInt(data.position + 20),
      ...data,
      media: { id: data.mediaId },
    }));

    const result = await uploadAndAttachBatchMediaFiles({
      authUserId: 7,
      batchId: "batch-1",
      draftSessionId: "draft-1",
      files: [
        new File(["one"], "one.png", { type: "image/png" }),
        new File(["two"], "two.png", { type: "image/png" }),
      ],
      itemId: null,
      role: "product",
    });

    expect(mocks.uploadToolMedia).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.client.imageBatch.update).toHaveBeenCalledTimes(1);
    expect(mocks.client.imageBatchMedia.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ mediaId: "media-one.png", position: 3 }),
      include: { media: true },
    });
    expect(mocks.client.imageBatchMedia.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ mediaId: "media-two.png", position: 4 }),
      include: { media: true },
    });
    expect(result).toMatchObject({
      relations: [
        expect.objectContaining({ mediaId: "media-one.png" }),
        expect.objectContaining({ mediaId: "media-two.png" }),
      ],
      version: 4,
    });
  });

  it("releases completed uploads when another file in the same batch fails", async () => {
    mocks.uploadToolMedia.mockImplementation(async ({ file }: { file: File }) => {
      if (file.name === "broken.png") throw new Error("文件损坏");
      return { mediaId: "media-ready.png" };
    });

    await expect(uploadAndAttachBatchMediaFiles({
      authUserId: 7,
      batchId: "batch-1",
      draftSessionId: "draft-1",
      files: [
        new File(["ready"], "ready.png", { type: "image/png" }),
        new File(["broken"], "broken.png", { type: "image/png" }),
      ],
      itemId: null,
      role: "product",
    })).rejects.toThrow("broken.png：文件损坏");

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.releaseToolMedia).toHaveBeenCalledWith({
      ownerUserId: 7,
      draftSessionId: "draft-1",
      mediaIds: ["media-ready.png"],
    });
  });

  it("appends task product media for multi-prompt history batches", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "batch-1",
      authUserId: 7,
      mode: "multi_prompt",
      status: "draft",
      version: 3,
    });

    await uploadAndAttachBatchMedia({
      authUserId: 7,
      batchId: "batch-1",
      draftSessionId: "draft-1",
      file: new File(["image"], "second.png", { type: "image/png" }),
      itemId: "item-1",
      role: "product",
    });

    expect(mocks.client.imageBatchMedia.deleteMany).not.toHaveBeenCalled();
    expect(mocks.client.imageBatchMedia.findFirst).toHaveBeenCalledWith({
      where: { batchId: "batch-1", itemId: "item-1", role: "product" },
      orderBy: [{ position: "desc" }, { id: "desc" }],
      select: { position: true },
    });
  });

  it("still replaces task product media for style replication", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "batch-1",
      authUserId: 7,
      mode: "style_replication",
      status: "draft",
      version: 3,
    });

    await uploadAndAttachBatchMedia({
      authUserId: 7,
      batchId: "batch-1",
      draftSessionId: "draft-1",
      file: new File(["image"], "replacement.png", { type: "image/png" }),
      itemId: "item-1",
      role: "product",
    });

    expect(mocks.client.imageBatchMedia.deleteMany).toHaveBeenCalled();
  });

  it("increments the template version when shared media changes", async () => {
    await uploadAndAttachBatchMedia({
      authUserId: 7,
      batchId: "batch-1",
      draftSessionId: "draft-1",
      file: new File(["image"], "shared.png", { type: "image/png" }),
      itemId: null,
      role: "product",
    });

    expect(mocks.client.imageBatch.update).toHaveBeenCalledWith({
      where: { id: "batch-1" },
      data: { version: { increment: 1 } },
      select: { version: true },
    });
  });

  it("returns the new batch version after removing task media", async () => {
    mocks.client.imageBatchMedia.findFirst.mockResolvedValue({
      id: BigInt(8),
      batchId: "batch-1",
      itemId: "item-1",
      mediaId: "old-product",
      batch: { status: "success", version: 3 },
    });

    const result = await detachBatchMedia({
      authUserId: 7,
      batchId: "batch-1",
      relationId: BigInt(8),
    });

    expect(result).toEqual({
      detached: true,
      released: true,
      version: 4,
    });
  });

  it("increments the template version when shared media is removed", async () => {
    mocks.client.imageBatchMedia.findFirst.mockResolvedValue({
      id: BigInt(8),
      batchId: "batch-1",
      itemId: null,
      mediaId: "old-product",
      batch: { status: "draft", version: 3 },
    });
    mocks.client.imageBatch.update.mockResolvedValue({ version: 4 });

    await expect(detachBatchMedia({
      authUserId: 7,
      batchId: "batch-1",
      relationId: BigInt(8),
    })).resolves.toMatchObject({ version: 4 });

    expect(mocks.client.imageBatch.update).toHaveBeenCalledWith({
      where: { id: "batch-1" },
      data: { version: { increment: 1 } },
      select: { version: true },
    });
  });
});
