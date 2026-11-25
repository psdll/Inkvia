import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  buildBatchOutputErrorState,
  executeBatchGenerationSnapshot,
} from "@/lib/image-batch/worker";

const snapshot = {
  schemaVersion: 1 as const,
  source: "batch" as const,
  batchId: "11111111-1111-4111-8111-111111111111",
  itemId: "22222222-2222-4222-8222-222222222222",
  prompt: "产品棚拍",
  model: "nano-banana-pro",
  aspectRatio: "3:4",
  resolution: "2K",
  skill: { id: "system:4", name: "商品分镜", revision: 2 },
  toolMediaIds: ["33333333-3333-4333-8333-333333333333"],
  batchIndex: 1,
  taskCount: 1,
  batchSubmittedAt: "2026-07-28T10:00:00.000Z",
};

describe("image batch worker delegation", () => {
  it("keeps transient transport errors recoverable instead of marking the output failed", () => {
    expect(buildBatchOutputErrorState(new Error("read ECONNRESET"), true, 1)).toEqual({
      status: "waiting_provider",
      errorCode: null,
      errorMessage: null,
      finishedAt: null,
      retryDelayMs: 2_000,
    });
    expect(buildBatchOutputErrorState(new Error("upstream returned 503"), false, 6)).toEqual({
      status: "submitting",
      errorCode: null,
      errorMessage: null,
      finishedAt: null,
      retryDelayMs: 30_000,
    });
  });

  it("marks explicit authentication and validation errors terminal", () => {
    expect(buildBatchOutputErrorState(new Error("HTTP 401 unauthorized"), true, 1)).toEqual(
      expect.objectContaining({
        status: "failed",
        errorCode: "GENERATION_FAILED",
        finishedAt: expect.any(Date),
      }),
    );
    expect(buildBatchOutputErrorState(new Error("validation failed with 422"), false, 1)).toEqual(
      expect.objectContaining({
        status: "failed",
        errorCode: "GENERATION_SUBMIT_FAILED",
        finishedAt: expect.any(Date),
      }),
    );
  });

  it("preserves an unavailable-model error for the workbench instead of retrying or degrading", () => {
    const error = Object.assign(
      new Error("当前模型尚未被生成服务加载，请更换模型后重试"),
      { status: 400, code: "IMAGE_MODEL_NOT_AVAILABLE" },
    );

    expect(buildBatchOutputErrorState(error, false)).toEqual({
      status: "failed",
      errorCode: "IMAGE_MODEL_NOT_AVAILABLE",
      errorMessage: "当前模型尚未被生成服务加载，请更换模型后重试",
      finishedAt: expect.any(Date),
      retryDelayMs: null,
    });
  });

  it("claims one complete queued batch as a single concurrent submission wave", () => {
    const source = readFileSync("lib/image-batch/worker.ts", "utf8");

    expect(source).toContain("const queuedBatch = await tx.$queryRaw");
    expect(source).toContain(`WHERE "status" IN ('queued', 'submitting')`);
    expect(source).toContain('AND "batchId" = CAST(${queuedBatch[0].batchId} AS uuid)');
    expect(source).toContain("const rows = queuedBatch.length");
    expect(source).toContain("imageBatchOutput.updateMany");
    expect(source).toContain("await Promise.all(ids.map");
    const queuedWaveStart = source.indexOf('AND "batchId" = CAST(${queuedBatch[0].batchId} AS uuid)');
    const queuedWaveEnd = source.indexOf(": await tx.$queryRaw", queuedWaveStart);
    expect(source.slice(queuedWaveStart, queuedWaveEnd)).toContain(
      "LIMIT ${Math.max(1, Math.min(20, limit))}",
    );
  });

  it("reclaims expired submitting outputs with their existing request keys", () => {
    const source = readFileSync("lib/image-batch/worker.ts", "utf8").replace(/\r\n/g, "\n");

    expect(source).toContain(
      `WHERE "status" IN ('queued', 'submitting')`,
    );
    expect(source).toContain(
      `WHERE "status" IN ('queued', 'submitting')\n            AND "batchId"`,
    );
    expect(source).toContain(
      'const queuedIds = rows.filter((row) => row.status === "queued")',
    );
    expect(source).toContain(
      'const submittingIds = rows.filter((row) => row.status === "submitting")',
    );
  });

  it("allows bounded cross-group lanes without serializing tasks inside a group", () => {
    const worker = readFileSync("lib/image-batch/worker.ts", "utf8");
    const runner = readFileSync("scripts/image-batch-worker.ts", "utf8");

    expect(worker).toContain("await Promise.all(ids.map");
    expect(runner).toContain("IMAGE_BATCH_WORKER_GROUP_CONCURRENCY");
    expect(runner).toContain("IMAGE_BATCH_WORKER_CONCURRENCY");
    expect(runner).toContain("Math.min(8");
    expect(runner).toContain("IMAGE_BATCH_WORKER_GROUP_CONCURRENCY) || 2");
    expect(runner).toContain("IMAGE_BATCH_WORKER_CONCURRENCY) || 20");
    expect(runner).toContain("Math.min(20");
    expect(runner).toContain("Array.from({ length: groupConcurrency }");
    expect(runner).toContain("await Promise.all(");
  });

  it("recomputes only the changed item instead of rewriting every item for every output", () => {
    const source = readFileSync("lib/image-batch/worker.ts", "utf8");

    expect(source).toContain("recomputeBatchAggregate(output.batchId, output.itemId)");
    expect(source).toContain("changedItemId");
    expect(source).not.toContain("for (const [itemId, statuses] of byItem)");
  });

  it("binds a running generation before any provider finalization", async () => {
    const create = vi.fn().mockResolvedValue({ generationId: 17, taskId: "task", status: "running" });
    const finalize = vi.fn().mockResolvedValue("pending");
    const readGeneration = vi.fn().mockResolvedValue({
      id: 17,
      status: "running",
      localPath: null,
      errorMsg: null,
      finishedAt: null,
    });

    const result = await executeBatchGenerationSnapshot({
      authUserId: 7,
      requestKey: "44444444-4444-4444-8444-444444444444",
      snapshot,
      deps: {
        createImageGeneration: create,
        finalizeGeneration: finalize,
        readGeneration,
        readGenerationByRequestKey: vi.fn(),
      },
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      authUserId: 7,
      requestKey: "44444444-4444-4444-8444-444444444444",
      source: "batch",
      toolMediaIds: snapshot.toolMediaIds,
      skill: snapshot.skill,
    }));
    expect(finalize).not.toHaveBeenCalled();
    expect(readGeneration).not.toHaveBeenCalled();
    expect(result).toEqual({
      generationId: 17,
      status: "waiting_provider",
      errorMessage: null,
      finishedAt: null,
      retryDelayMs: 2_000,
    });
  });

  it("recovers an already-created generation by requestKey when submission throws late", async () => {
    const create = vi.fn().mockRejectedValue(new Error("late submit failure"));
    const readGenerationByRequestKey = vi.fn().mockResolvedValue({
      id: 19,
      status: "running",
      localPath: null,
      errorMsg: null,
      finishedAt: null,
    });

    const result = await executeBatchGenerationSnapshot({
      authUserId: 7,
      requestKey: "66666666-6666-4666-8666-666666666666",
      snapshot,
      deps: {
        createImageGeneration: create,
        finalizeGeneration: vi.fn(),
        readGeneration: vi.fn(),
        readGenerationByRequestKey,
      },
    });

    expect(readGenerationByRequestKey).toHaveBeenCalledWith(
      "66666666-6666-4666-8666-666666666666",
    );
    expect(result).toEqual({
      generationId: 19,
      status: "waiting_provider",
      errorMessage: null,
      finishedAt: null,
      retryDelayMs: 2_000,
    });
  });

  it("recognizes a result that completed synchronously without finalizing again", async () => {
    const create = vi.fn().mockResolvedValue({
      generationId: 18,
      taskId: "18",
      status: "success",
      outputPaths: ["/uploads/batch-image_results/2026-07-28/result.png"],
    });
    const finalize = vi.fn();

    const result = await executeBatchGenerationSnapshot({
      authUserId: 7,
      requestKey: "55555555-5555-4555-8555-555555555555",
      snapshot,
      deps: {
        createImageGeneration: create,
        finalizeGeneration: finalize,
        readGeneration: vi.fn(),
        readGenerationByRequestKey: vi.fn(),
      },
    });

    expect(finalize).not.toHaveBeenCalled();
    expect(result.status).toBe("success");
    expect(result.generationId).toBe(18);
  });
});
