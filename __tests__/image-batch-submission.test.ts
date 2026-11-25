import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = {
    imageBatch: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    imageBatchItem: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    imageBatchOutput: {
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  };
  return {
    client,
    transaction: vi.fn(async (operation: unknown) => (
      typeof operation === "function"
        ? (operation as (tx: typeof client) => unknown)(client)
        : Promise.all(operation as Promise<unknown>[])
    )),
  };
});

vi.mock("@/lib/prisma", () => ({
  default: { ...mocks.client, $transaction: mocks.transaction },
}));

import {
  buildBatchRequestSnapshot,
  retryFailedBatchOutputs,
  stableBatchRequestKey,
  submitImageBatch,
  type BatchSnapshotMedia,
} from "@/lib/image-batch/submission";

const batchMedia: BatchSnapshotMedia[] = [
  { mediaId: "batch-product", role: "product", itemId: null, position: 0 },
  { mediaId: "batch-reference", role: "reference", itemId: null, position: 0 },
];

describe("image batch submission snapshots", () => {
  it("freezes custom GIF dimensions including group overrides", () => {
    const snapshot = buildBatchRequestSnapshot({ batch: { id: "batch", sharedPrompt: "", sharedSettings: { model: "gpt-image-2.6-apimart", outputFormat: "gif", gifSize: "512x288", frameCount: 9, frameDurationMs: 200 } }, item: { id: "item", prompt: "cat waves", includeSharedPrompt: false, overrides: { gifSize: "432x640" } }, media: [], batchIndex: 1, taskCount: 1, batchSubmittedAt: "2026-11-07T00:00:00Z" });
    expect(snapshot).toMatchObject({ outputFormat: "gif", gifSize: "432x640", frameCount: 9, frameDurationMs: 200 });
  });

  it("freezes Google quality and search overrides for queued tasks", () => {
    const snapshot = buildBatchRequestSnapshot({ batch: { id: "batch", sharedPrompt: "", sharedSettings: { model: "gemini-3.1-flash-image", googleThinkingLevel: "minimal", googleSearchMode: "off", resolution: "512" } }, item: { id: "item", prompt: "cat", includeSharedPrompt: false, overrides: { googleThinkingLevel: "high", googleSearchMode: "web_image" } }, media: [], batchIndex: 1, taskCount: 1, batchSubmittedAt: "2026-10-09T00:00:00Z" });
    expect(snapshot).toMatchObject({ googleThinkingLevel: "high", googleSearchMode: "web_image", resolution: "512" });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client.$executeRaw.mockResolvedValue(1);
    mocks.client.$queryRaw.mockResolvedValue([{ pg_advisory_xact_lock: null }]);
    mocks.client.imageBatchOutput.createMany.mockResolvedValue({ count: 1 });
    mocks.client.imageBatchOutput.findMany.mockResolvedValue([]);
    mocks.client.imageBatch.update.mockResolvedValue({ id: "batch" });
    mocks.client.imageBatchItem.updateMany.mockResolvedValue({ count: 1 });
  });

  it("freezes GPT Image 2.5 mode and quality overrides without leaking into shared settings", () => {
    const sharedSettings = { model: "gpt-image-2.5-apimart", gptImage25Mode: "flare", quality: "medium" };
    const snapshot = buildBatchRequestSnapshot({ batch: { id: "batch", sharedPrompt: "", sharedSettings }, item: { id: "item", prompt: "edit", includeSharedPrompt: false, overrides: { gptImage25Mode: "sunburst", quality: "max", background: "transparent", outputFormat: "webp" } }, media: [], batchIndex: 1, taskCount: 1, batchSubmittedAt: "2026-09-09T00:00:00Z" });
    expect(snapshot).toMatchObject({ model: "gpt-image-2.5-apimart", gptImage25Mode: "sunburst", quality: "max", background: "transparent", outputFormat: "webp" });
    expect(sharedSettings).toMatchObject({ gptImage25Mode: "flare", quality: "medium" });
  });

  it("freezes merged prompts, settings and effective media into schema version 1", () => {
    const snapshot = buildBatchRequestSnapshot({
      batch: {
        id: "11111111-1111-4111-8111-111111111111",
        sharedPrompt: "保持产品外观准确",
        sharedSettings: {
          model: "nano-banana-pro",
          aspectRatio: "3:4",
          resolution: "2K",
        },
      },
      item: {
        id: "22222222-2222-4222-8222-222222222222",
        prompt: "雪地冷色调场景",
        includeSharedPrompt: true,
        overrides: { aspectRatio: "1:1" },
      },
      media: batchMedia,
      batchIndex: 3,
      taskCount: 12,
      batchSubmittedAt: "2026-07-28T10:00:00.000Z",
    });

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      source: "batch",
      batchId: "11111111-1111-4111-8111-111111111111",
      itemId: "22222222-2222-4222-8222-222222222222",
      prompt: "保持产品外观准确\n雪地冷色调场景",
      model: "nano-banana-pro",
      aspectRatio: "1:1",
      resolution: "2K",
      toolMediaIds: ["batch-reference", "batch-product"],
      batchIndex: 3,
      taskCount: 12,
    });
  });

  it("uses item product/reference media as a complete role-level override", () => {
    const snapshot = buildBatchRequestSnapshot({
      batch: { id: "batch", sharedPrompt: "", sharedSettings: { model: "m" } },
      item: {
        id: "item",
        prompt: "场景",
        includeSharedPrompt: false,
        overrides: {},
      },
      media: [
        ...batchMedia,
        { mediaId: "item-product", role: "product", itemId: "item", position: 0 },
        { mediaId: "item-reference", role: "reference", itemId: "item", position: 0 },
      ],
      batchIndex: 1,
      taskCount: 1,
      batchSubmittedAt: "2026-07-28T10:00:00.000Z",
    });

    expect(snapshot.toolMediaIds).toEqual(["item-reference", "item-product"]);
  });

  it("keeps the original prompt only for Skill-generated segmented prompts", () => {
    const skillSnapshot = buildBatchRequestSnapshot({
      batch: {
        id: "batch",
        mode: "multi_prompt",
        sharedPrompt: "用户原始提示词",
        sharedSettings: {
          model: "m",
          skillUserPrompt: "用户原始提示词",
          skill: { id: "system:4", name: "商品分镜", revision: 2 },
        },
      },
      item: {
        id: "item",
        prompt: "Skill 生成的最终提示词",
        includeSharedPrompt: false,
        overrides: {},
      },
      media: [],
      batchIndex: 1,
      taskCount: 1,
      batchSubmittedAt: "2026-08-11T10:00:00.000Z",
    });
    const ordinarySnapshot = buildBatchRequestSnapshot({
      batch: {
        id: "batch",
        mode: "multi_prompt",
        sharedPrompt: "普通共享提示词",
        sharedSettings: { model: "m" },
      },
      item: {
        id: "item",
        prompt: "普通任务提示词",
        includeSharedPrompt: false,
        overrides: {},
      },
      media: [],
      batchIndex: 1,
      taskCount: 1,
      batchSubmittedAt: "2026-08-11T10:00:00.000Z",
    });

    expect(skillSnapshot.userPrompt).toBe("用户原始提示词");
    expect(skillSnapshot.skill).toEqual({
      id: "system:4",
      name: "商品分镜",
      revision: 2,
    });
    expect(ordinarySnapshot).not.toHaveProperty("userPrompt");
    expect(ordinarySnapshot).not.toHaveProperty("skill");
  });

  it("derives a deterministic UUID request key from output and attempt", () => {
    const first = stableBatchRequestKey("33333333-3333-4333-8333-333333333333", 1);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableBatchRequestKey("33333333-3333-4333-8333-333333333333", 1)).toBe(first);
    expect(stableBatchRequestKey("33333333-3333-4333-8333-333333333333", 2)).not.toBe(first);
  });

  it("submits only draft tasks and continues their output attempt sequence", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "batch",
      status: "success",
      lastSubmissionKey: null,
      sharedPrompt: "",
      sharedSettings: { model: "nano-banana-pro" },
      items: [
        {
          id: "success-item",
          name: "已完成任务",
          position: 0,
          prompt: "已完成",
          includeSharedPrompt: false,
          overrides: { model: "nano-banana-pro" },
          outputCount: 1,
          status: "success",
        },
        {
          id: "draft-item",
          name: "已修改任务",
          position: 1,
          prompt: "重新生成",
          includeSharedPrompt: false,
          overrides: { model: "nano-banana-pro" },
          outputCount: 1,
          status: "draft",
        },
      ],
      media: [
        { mediaId: "success-product", role: "product", itemId: "success-item", position: 0 },
        { mediaId: "draft-product", role: "product", itemId: "draft-item", position: 0 },
        { mediaId: "reference", role: "reference", itemId: "draft-item", position: 0 },
      ],
      outputs: [
        { id: "old-success", itemId: "success-item", slotIndex: 0, attempt: 1, status: "success" },
        { id: "old-draft", itemId: "draft-item", slotIndex: 0, attempt: 2, status: "success" },
      ],
    });

    const result = await submitImageBatch({
      authUserId: 7,
      batchId: "batch",
      idempotencyKey: "submit-draft-only",
    });

    const rows = mocks.client.imageBatchOutput.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      batchId: "batch",
      itemId: "draft-item",
      slotIndex: 0,
      attempt: 3,
      status: "queued",
    });
    expect(mocks.client.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.client.imageBatchItem.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ outputCount: 1, reused: false });
  });

  it("queues exactly one generation for every draft task regardless of legacy outputCount", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "batch",
      status: "draft",
      lastSubmissionKey: null,
      sharedPrompt: "",
      sharedSettings: { model: "nano-banana-pro" },
      items: [
        {
          id: "task-a",
          name: "任务 A",
          position: 0,
          prompt: "提示词 A",
          includeSharedPrompt: false,
          overrides: { model: "nano-banana-pro" },
          outputCount: 4,
          status: "draft",
        },
        {
          id: "task-b",
          name: "任务 B",
          position: 1,
          prompt: "提示词 B",
          includeSharedPrompt: false,
          overrides: { model: "nano-banana-pro" },
          outputCount: 3,
          status: "draft",
        },
      ],
      media: [
        { mediaId: "product-a", role: "product", itemId: "task-a", position: 0 },
        { mediaId: "product-b", role: "product", itemId: "task-b", position: 0 },
      ],
      outputs: [],
    });

    const result = await submitImageBatch({
      authUserId: 7,
      batchId: "batch",
      idempotencyKey: "one-output-per-task",
    });

    const rows = mocks.client.imageBatchOutput.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows.map((row: any) => ({
      itemId: row.itemId,
      slotIndex: row.slotIndex,
      taskCount: row.requestSnapshot.taskCount,
    }))).toEqual([
      { itemId: "task-a", slotIndex: 0, taskCount: 2 },
      { itemId: "task-b", slotIndex: 0, taskCount: 2 },
    ]);
    expect(result).toMatchObject({ outputCount: 2, reused: false });
  });

  it("regenerates one completed item while a sibling output is active", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "batch",
      status: "running",
      lastSubmissionKey: null,
      sharedPrompt: "",
      sharedSettings: { model: "nano-banana-pro" },
      items: [
        {
          id: "active-item",
          name: "生成中的任务",
          position: 0,
          prompt: "生成中",
          includeSharedPrompt: false,
          overrides: { model: "nano-banana-pro" },
          outputCount: 1,
          status: "running",
        },
        {
          id: "completed-item",
          name: "已完成任务",
          position: 1,
          prompt: "重新生成",
          includeSharedPrompt: false,
          overrides: { model: "nano-banana-pro" },
          outputCount: 1,
          status: "success",
        },
      ],
      media: [
        { mediaId: "active-product", role: "product", itemId: "active-item", position: 0 },
        { mediaId: "completed-product", role: "product", itemId: "completed-item", position: 0 },
      ],
      outputs: [
        { id: "active-output", itemId: "active-item", slotIndex: 0, attempt: 1, status: "running" },
        { id: "completed-output", itemId: "completed-item", slotIndex: 0, attempt: 1, status: "success" },
      ],
    });

    const result = await submitImageBatch({
      authUserId: 7,
      batchId: "batch",
      idempotencyKey: "regenerate-completed-item",
      itemIds: ["completed-item"],
    });

    const rows = mocks.client.imageBatchOutput.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      itemId: "completed-item",
      attempt: 2,
      status: "queued",
    });
    expect(result).toMatchObject({ outputCount: 1, reused: false });
  });

  it("queues a failed item retry even while a sibling output is active", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "batch",
      status: "running",
    });
    mocks.client.imageBatchOutput.findMany.mockResolvedValue([
      {
        id: "failed-output",
        batchId: "batch",
        itemId: "failed-item",
        slotIndex: 0,
        attempt: 1,
        status: "failed",
        requestSnapshot: { prompt: "retry me" },
      },
    ]);

    const result = await retryFailedBatchOutputs({
      authUserId: 7,
      batchId: "batch",
      itemIds: ["failed-item"],
    });

    expect(mocks.client.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.client.imageBatchOutput.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        batchId: "batch",
        itemId: { in: ["failed-item"] },
      },
    }));
    expect(mocks.client.imageBatchOutput.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          batchId: "batch",
          itemId: "failed-item",
          attempt: 2,
          status: "queued",
        }),
      ],
    });
    expect(mocks.client.imageBatchItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["failed-item"] }, batchId: "batch" },
      data: { status: "queued" },
    });
    expect(result).toMatchObject({ retryCount: 1, reusedCount: 0 });
  });

  it("casts the blocking retry lock result to a Prisma-supported type", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "batch",
      status: "failed",
    });

    await retryFailedBatchOutputs({
      authUserId: 7,
      batchId: "batch",
      itemIds: ["failed-item"],
    });

    const lockQuery = mocks.client.$queryRaw.mock.calls[0]?.[0] as {
      sql?: string;
      text?: string;
    };
    expect(lockQuery?.text || lockQuery?.sql).toMatch(
      /pg_advisory_xact_lock\([\s\S]*\)::text/,
    );
  });

  it("reuses an already active retry instead of creating another paid attempt", async () => {
    mocks.client.imageBatch.findFirst.mockResolvedValue({
      id: "batch",
      status: "queued",
    });
    mocks.client.imageBatchOutput.findMany.mockResolvedValue([
      {
        id: "queued-output",
        batchId: "batch",
        itemId: "failed-item",
        slotIndex: 0,
        attempt: 2,
        status: "queued",
        requestSnapshot: { prompt: "already queued" },
      },
      {
        id: "failed-output",
        batchId: "batch",
        itemId: "failed-item",
        slotIndex: 0,
        attempt: 1,
        status: "failed",
        requestSnapshot: { prompt: "old failure" },
      },
    ]);

    const result = await retryFailedBatchOutputs({
      authUserId: 7,
      batchId: "batch",
      itemIds: ["failed-item"],
    });

    expect(mocks.client.imageBatchOutput.createMany).not.toHaveBeenCalled();
    expect(mocks.client.imageBatchItem.updateMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ retryCount: 0, reusedCount: 1 });
  });
});
