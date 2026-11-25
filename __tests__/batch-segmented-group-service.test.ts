import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = {
    imageBatch: {
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    imageBatchGroup: {
      aggregate: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    imageBatchItem: {
      createMany: vi.fn(),
    },
    imageBatchMedia: {
      createMany: vi.fn(),
    },
    mediaAsset: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return {
    client,
    transaction: vi.fn(async (callback: (tx: typeof client) => unknown) => callback(client)),
  };
});

vi.mock("@/lib/prisma", () => ({
  default: { ...mocks.client, $transaction: mocks.transaction },
}));
vi.mock("@/lib/tool-media/service", () => ({
  uploadToolMedia: vi.fn(),
  releaseToolMedia: vi.fn(),
}));

import { createDetachedSegmentedPromptGroup } from "@/lib/image-batch/service";

const template = {
  id: "template-1",
  authUserId: 7,
  mode: "multi_prompt",
  status: "draft",
  version: 4,
  deletedAt: null,
  media: [
    { id: BigInt(11), mediaId: "media-a", role: "product", position: 0 },
    { id: BigInt(12), mediaId: "media-b", role: "product", position: 1 },
  ],
};

const validInput = {
  authUserId: 7,
  templateBatchId: "template-1",
  sharedPrompt: "",
  sharedSettings: {
    model: "nano-banana-pro",
    aspectRatio: "3:4",
    resolution: "2K",
  },
  generatedPrompt: [
    "【猎奇反差｜提示词1】",
    "皇宫片场正文",
    "【猎奇反差｜提示词2】",
    "商场儿童区正文",
    "【猎奇反差｜提示词3】",
    "门店考古展正文",
  ].join("\n"),
  mediaSnapshots: [
    { mediaId: "media-a", position: 0 },
    { mediaId: "media-b", position: 1 },
  ],
};

describe("createDetachedSegmentedPromptGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client.imageBatch.findFirst.mockResolvedValue(template);
    mocks.client.imageBatch.create.mockResolvedValue({ id: "history-1" });
    mocks.client.imageBatchGroup.aggregate.mockResolvedValue({ _max: { sequence: null } });
    mocks.client.imageBatchGroup.count.mockResolvedValue(0);
    mocks.client.imageBatchGroup.create.mockResolvedValue({ id: "group-1" });
    mocks.client.imageBatchGroup.findUnique.mockResolvedValue({
      id: "group-1",
      batchId: "history-1",
      items: [],
    });
    mocks.client.imageBatchItem.createMany.mockResolvedValue({ count: 3 });
    mocks.client.imageBatchMedia.createMany.mockResolvedValue({ count: 6 });
    mocks.client.mediaAsset.findMany.mockResolvedValue([
      { id: "media-a", status: "ready" },
      { id: "media-b", status: "soft_deleted" },
    ]);
    mocks.client.mediaAsset.updateMany.mockResolvedValue({ count: 2 });
  });

  it("creates body-only tasks from an empty page prompt and the click-time media snapshot", async () => {
    const result = await createDetachedSegmentedPromptGroup(validInput);

    expect(mocks.client.imageBatchItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          name: "猎奇反差｜提示词1",
          prompt: "皇宫片场正文",
          includeSharedPrompt: false,
        }),
        expect.objectContaining({
          name: "猎奇反差｜提示词2",
          prompt: "商场儿童区正文",
          includeSharedPrompt: false,
        }),
        expect.objectContaining({
          name: "猎奇反差｜提示词3",
          prompt: "门店考古展正文",
          includeSharedPrompt: false,
        }),
      ],
    });

    const mediaWrite = mocks.client.imageBatchMedia.createMany.mock.calls[0]?.[0];
    expect(mediaWrite.data).toHaveLength(6);
    const itemIds = new Set(mediaWrite.data.map((entry: { itemId: string }) => entry.itemId));
    expect(itemIds.size).toBe(3);
    for (const itemId of itemIds) {
      expect(mediaWrite.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ itemId, mediaId: "media-a", role: "product", position: 0 }),
        expect.objectContaining({ itemId, mediaId: "media-b", role: "product", position: 1 }),
      ]));
    }

    expect(mocks.client.mediaAsset.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["media-a", "media-b"] },
        ownerUserId: 7,
        purgedAt: null,
        status: { in: ["ready", "soft_deleted"] },
      },
      data: {
        status: "ready",
        softDeletedAt: null,
        retentionUntil: null,
      },
    });
    expect(mocks.client.imageBatch.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      group: expect.objectContaining({ id: "group-1" }),
    });
  });

  it("uses the captured snapshot even when the live template media changed", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      ...template,
      version: 99,
      media: [{ id: BigInt(30), mediaId: "new-live-media", role: "product", position: 0 }],
    });

    await expect(createDetachedSegmentedPromptGroup(validInput)).resolves.toMatchObject({
      group: { id: "group-1" },
    });
    const mediaWrite = mocks.client.imageBatchMedia.createMany.mock.calls[0]?.[0];
    expect(mediaWrite.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ mediaId: "media-a" }),
      expect.objectContaining({ mediaId: "media-b" }),
    ]));
    expect(mediaWrite.data).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ mediaId: "new-live-media" }),
    ]));
  });

  it("creates tasks without media when the click snapshot is empty", async () => {
    await expect(createDetachedSegmentedPromptGroup({
      ...validInput,
      mediaSnapshots: [],
    })).resolves.toMatchObject({
      group: { id: "group-1" },
    });
    expect(mocks.client.imageBatchMedia.createMany).not.toHaveBeenCalled();
    expect(mocks.client.mediaAsset.findMany).not.toHaveBeenCalled();
  });

  it("rejects a missing, unowned, or purged snapshot asset", async () => {
    mocks.client.mediaAsset.findMany.mockResolvedValue([{ id: "media-a", status: "ready" }]);
    await expect(createDetachedSegmentedPromptGroup({
      ...validInput,
    })).rejects.toMatchObject({
      status: 400,
      code: "BATCH_MEDIA_SNAPSHOT_INVALID",
    });
    expect(mocks.client.imageBatch.create).not.toHaveBeenCalled();
  });

  it("rejects style replication templates", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      ...template,
      mode: "style_replication",
    });
    await expect(createDetachedSegmentedPromptGroup(validInput)).rejects.toMatchObject({
      code: "BATCH_SEGMENTED_MODE_INVALID",
    });
  });

  it("rejects an empty generation model", async () => {
    await expect(createDetachedSegmentedPromptGroup({
      ...validInput,
      sharedSettings: { aspectRatio: "3:4", resolution: "2K" },
    })).rejects.toMatchObject({ code: "BATCH_MODEL_REQUIRED" });
  });

  it("returns parser failures without creating history", async () => {
    await expect(createDetachedSegmentedPromptGroup({
      ...validInput,
      generatedPrompt: "   \n\n",
    })).rejects.toMatchObject({
      status: 400,
      code: "PROMPT_SEGMENTS_NOT_FOUND",
    });
    expect(mocks.client.imageBatch.create).not.toHaveBeenCalled();
  });

  it("rolls back when task media creation fails", async () => {
    mocks.client.imageBatchMedia.createMany.mockRejectedValueOnce(new Error("write failed"));
    await expect(createDetachedSegmentedPromptGroup(validInput)).rejects.toThrow("write failed");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});
