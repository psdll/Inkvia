import fs from "fs-extra";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  createImageGeneration,
  type CreateImageGenerationInput,
  type CreateImageGenerationResult,
} from "@/lib/generation/image-service";
import {
  classifyFinalizeError,
  finalizeGeneration,
  finalizeRetryDelayMs,
} from "@/lib/generation/finalize";
import {
  aggregateBatchStatus,
  IMAGE_MODEL_NOT_AVAILABLE_ERROR_CODE,
} from "@/lib/image-batch/contracts";
import type { ImageBatchRequestSnapshot } from "@/lib/image-batch/submission";

const db = prisma as any;
const MIGRATION_LOCK_ID = 720072007200;
const DEFAULT_MAINTENANCE_SENTINEL = "/var/lib/inkvia-updater/state/maintenance";

type GenerationState = {
  id: number;
  status: string;
  localPath: string | null;
  errorMsg: string | null;
  finishedAt: Date | null;
  templateData?: string | null;
};

export type BatchGenerationExecution = {
  generationId: number;
  status: "success" | "failed" | "waiting_provider";
  errorMessage: string | null;
  finishedAt: Date | null;
  retryDelayMs: number | null;
};

export type BatchOutputErrorState = {
  status: "submitting" | "waiting_provider" | "failed";
  errorCode: string | null;
  errorMessage: string | null;
  finishedAt: Date | null;
  retryDelayMs: number | null;
};

function finalizeAttemptFromTemplateData(templateData: string | null | undefined) {
  try {
    const metadata = JSON.parse(String(templateData || "{}"));
    return Math.max(1, Number(metadata?.finalize?.attempt) || 1);
  } catch {
    return 1;
  }
}

function generationRetryDelayMs(generation: GenerationState | null | undefined) {
  return finalizeRetryDelayMs(finalizeAttemptFromTemplateData(generation?.templateData));
}

export function buildBatchOutputErrorState(
  error: unknown,
  hasGenerationId: boolean,
  retryAttempt = 1,
): BatchOutputErrorState {
  const code = String((error as { code?: unknown } | null)?.code || "");
  if (classifyFinalizeError(error) === "terminal") {
    return {
      status: "failed",
      errorCode: code === IMAGE_MODEL_NOT_AVAILABLE_ERROR_CODE
        ? IMAGE_MODEL_NOT_AVAILABLE_ERROR_CODE
        : hasGenerationId
          ? "GENERATION_FAILED"
          : "GENERATION_SUBMIT_FAILED",
      errorMessage: String((error as { message?: unknown } | null)?.message || "生成失败"),
      finishedAt: new Date(),
      retryDelayMs: null,
    };
  }
  return {
    status: hasGenerationId ? "waiting_provider" : "submitting",
    errorCode: null,
    errorMessage: null,
    finishedAt: null,
    retryDelayMs: finalizeRetryDelayMs(retryAttempt),
  };
}

type BatchWorkerDeps = {
  createImageGeneration(input: CreateImageGenerationInput): Promise<CreateImageGenerationResult>;
  finalizeGeneration(generationId: number): Promise<unknown>;
  readGeneration(generationId: number): Promise<GenerationState | null>;
  readGenerationByRequestKey(requestKey: string): Promise<GenerationState | null>;
};

const defaultDeps: BatchWorkerDeps = {
  createImageGeneration,
  finalizeGeneration,
  readGeneration: (generationId) => db.generation.findUnique({
    where: { id: generationId },
    select: { id: true, status: true, localPath: true, errorMsg: true, finishedAt: true, templateData: true },
  }),
  readGenerationByRequestKey: (requestKey) => db.generation.findUnique({
    where: { requestKey },
    select: { id: true, status: true, localPath: true, errorMsg: true, finishedAt: true, templateData: true },
  }),
};

function toGenerationInput(
  authUserId: number,
  requestKey: string,
  snapshot: ImageBatchRequestSnapshot,
): CreateImageGenerationInput {
  return {
    authUserId,
    requestKey,
    prompt: snapshot.prompt,
    userPrompt: snapshot.userPrompt,
    skill: snapshot.skill,
    source: "batch",
    model: snapshot.model,
    aspectRatio: snapshot.aspectRatio,
    resolution: snapshot.resolution,
    customSize: snapshot.customSize,
    quality: snapshot.quality,
    gptImage25Mode: snapshot.gptImage25Mode,
    background: snapshot.background,
    googleThinkingLevel: snapshot.googleThinkingLevel,
    googleSearchMode: snapshot.googleSearchMode,
    moderation: snapshot.moderation,
    outputFormat: snapshot.outputFormat,
    gifSize: snapshot.gifSize, frameCount: snapshot.frameCount, frameDurationMs: snapshot.frameDurationMs, seedream55: snapshot.seedream55,
    outputCompression: snapshot.outputCompression,
    n: snapshot.n,
    seed: snapshot.seed,
    enableWebSearch: snapshot.enableWebSearch,
    maskUrl: snapshot.maskUrl,
    seedreamOutputMode: snapshot.seedreamOutputMode,
    seedreamOutputCount: snapshot.seedreamOutputCount,
    seedreamWebSearch: snapshot.seedreamWebSearch,
    toolMediaIds: snapshot.toolMediaIds,
    batchId: snapshot.batchId,
    batchMode: snapshot.mode,
    batchIndex: snapshot.batchIndex,
    taskCount: snapshot.taskCount,
    batchSubmittedAt: snapshot.batchSubmittedAt,
  };
}

export async function executeBatchGenerationSnapshot(input: {
  authUserId: number;
  requestKey: string;
  snapshot: ImageBatchRequestSnapshot;
  deps?: BatchWorkerDeps;
}): Promise<BatchGenerationExecution> {
  const deps = input.deps || defaultDeps;
  let submitted: CreateImageGenerationResult;
  try {
    submitted = await deps.createImageGeneration(
      toGenerationInput(input.authUserId, input.requestKey, input.snapshot),
    );
  } catch (error) {
    const recovered = await deps.readGenerationByRequestKey(input.requestKey);
    if (!recovered) throw error;
    const recoveredStatus = String(recovered.status || "").toLowerCase();
    if (recovered.localPath || recoveredStatus === "success") {
      return {
        generationId: recovered.id,
        status: "success",
        errorMessage: null,
        finishedAt: recovered.finishedAt || new Date(),
        retryDelayMs: null,
      };
    }
    if (recoveredStatus === "failed" || recoveredStatus === "cancelled" || recoveredStatus === "canceled") {
      return {
        generationId: recovered.id,
        status: "failed",
        errorMessage: recovered.errorMsg || "生成失败",
        finishedAt: recovered.finishedAt || new Date(),
        retryDelayMs: null,
      };
    }
    return {
      generationId: recovered.id,
      status: "waiting_provider",
      errorMessage: null,
      finishedAt: null,
      retryDelayMs: generationRetryDelayMs(recovered),
    };
  }
  if (submitted.status === "success") {
    return {
      generationId: submitted.generationId,
      status: "success",
      errorMessage: null,
      finishedAt: new Date(),
      retryDelayMs: null,
    };
  }
  return {
    generationId: submitted.generationId,
    status: "waiting_provider",
    errorMessage: null,
    finishedAt: null,
    retryDelayMs: finalizeRetryDelayMs(1),
  };
}

export async function recomputeBatchAggregate(batchId: string, changedItemId: string) {
  const rows = await db.imageBatchOutput.findMany({
    where: { batchId },
    orderBy: [{ itemId: "asc" }, { slotIndex: "asc" }, { attempt: "desc" }],
    select: { itemId: true, slotIndex: true, status: true, finishedAt: true },
  });
  const latest = new Map<string, any>();
  for (const row of rows) {
    const key = `${row.itemId}:${row.slotIndex}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  const changedItemStatuses = Array.from(latest.values())
    .filter((row) => row.itemId === changedItemId)
    .map((row) => row.status);
  if (changedItemStatuses.length) {
    await db.imageBatchItem.update({
      where: { id: changedItemId },
      data: { status: aggregateBatchStatus(changedItemStatuses) },
    });
  }
  const status = aggregateBatchStatus(Array.from(latest.values()).map((row) => row.status));
  const terminal = ["success", "failed", "partial_success", "cancelled"].includes(status);
  await db.imageBatch.update({
    where: { id: batchId },
    data: { status, finishedAt: terminal ? new Date() : null },
  });
  return status;
}

export async function processBatchOutput(outputId: string, workerId: string) {
  const output = await db.imageBatchOutput.findFirst({
    where: { id: outputId, leaseOwner: workerId },
    include: { batch: { select: { authUserId: true } } },
  });
  if (!output) return "missing";
  const snapshot = output.requestSnapshot as ImageBatchRequestSnapshot;
  if (snapshot?.schemaVersion !== 1) {
    const updated = await db.imageBatchOutput.updateMany({
      where: { id: output.id, leaseOwner: workerId },
      data: {
        status: "failed",
        errorCode: "UNSUPPORTED_SNAPSHOT_VERSION",
        errorMessage: "任务快照版本不受支持",
        finishedAt: new Date(),
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    if (!updated.count) return "cancelled";
    await recomputeBatchAggregate(output.batchId, output.itemId);
    return "failed";
  }
  try {
    let execution: BatchGenerationExecution;
    if (output.generationId) {
      await finalizeGeneration(output.generationId);
      const generation = await defaultDeps.readGeneration(output.generationId);
      const generationStatus = String(generation?.status || "").toLowerCase();
      execution = generation?.localPath || generationStatus === "success"
        ? { generationId: output.generationId, status: "success", errorMessage: null, finishedAt: generation?.finishedAt || new Date(), retryDelayMs: null }
        : generationStatus === "failed"
          ? { generationId: output.generationId, status: "failed", errorMessage: generation?.errorMsg || "生成失败", finishedAt: generation?.finishedAt || new Date(), retryDelayMs: null }
          : { generationId: output.generationId, status: "waiting_provider", errorMessage: null, finishedAt: null, retryDelayMs: generationRetryDelayMs(generation) };
    } else {
      execution = await executeBatchGenerationSnapshot({
        authUserId: output.batch.authUserId,
        requestKey: output.requestKey,
        snapshot,
      });
    }
    const updated = await db.imageBatchOutput.updateMany({
      where: { id: output.id, leaseOwner: workerId },
      data: {
        generationId: execution.generationId,
        status: execution.status,
        errorCode: execution.status === "failed" ? "GENERATION_FAILED" : null,
        errorMessage: execution.errorMessage,
        finishedAt: execution.finishedAt,
        nextPollAt: execution.status === "waiting_provider"
          ? new Date(Date.now() + (execution.retryDelayMs || finalizeRetryDelayMs(1)))
          : null,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    if (!updated.count) return "cancelled";
    await recomputeBatchAggregate(output.batchId, output.itemId);
    return execution.status;
  } catch (error: any) {
    let retryAttempt = 1;
    if (output.generationId) {
      try {
        const generation = await defaultDeps.readGeneration(output.generationId);
        retryAttempt = finalizeAttemptFromTemplateData(generation?.templateData);
      } catch {
        retryAttempt = 1;
      }
    }
    const errorState = buildBatchOutputErrorState(error, Boolean(output.generationId), retryAttempt);
    const updated = await db.imageBatchOutput.updateMany({
      where: { id: output.id, leaseOwner: workerId },
      data: {
        status: errorState.status,
        errorCode: errorState.errorCode,
        errorMessage: errorState.errorMessage,
        finishedAt: errorState.finishedAt,
        nextPollAt: errorState.retryDelayMs
          ? new Date(Date.now() + errorState.retryDelayMs)
          : null,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    if (!updated.count) return "cancelled";
    await recomputeBatchAggregate(output.batchId, output.itemId);
    return errorState.status;
  }
}

export async function claimBatchOutputs(workerId: string, limit = 4) {
  return db.$transaction(async (tx: any) => {
    const lock = await tx.$queryRaw(Prisma.sql`
      SELECT pg_try_advisory_xact_lock(${MIGRATION_LOCK_ID}) AS acquired
    `) as Array<{ acquired: boolean }>;
    if (!lock[0]?.acquired) return [];
    const queuedBatch = await tx.$queryRaw(Prisma.sql`
      SELECT "batchId"
      FROM "ImageBatchOutput"
      WHERE "status" IN ('queued', 'submitting')
        AND ("nextPollAt" IS NULL OR "nextPollAt" <= NOW())
        AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `) as Array<{ batchId: string }>;
    const rows = queuedBatch.length
      ? await tx.$queryRaw(Prisma.sql`
          SELECT "id", "status"
          FROM "ImageBatchOutput"
          WHERE "status" IN ('queued', 'submitting')
            AND "batchId" = CAST(${queuedBatch[0].batchId} AS uuid)
            AND ("nextPollAt" IS NULL OR "nextPollAt" <= NOW())
            AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())
          ORDER BY "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${Math.max(1, Math.min(20, limit))}
        `) as Array<{ id: string; status: string }>
      : await tx.$queryRaw(Prisma.sql`
          SELECT "id", "status"
          FROM "ImageBatchOutput"
          WHERE "status" = 'waiting_provider'
            AND ("nextPollAt" IS NULL OR "nextPollAt" <= NOW())
            AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())
          ORDER BY "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${Math.max(1, Math.min(20, limit))}
    `) as Array<{ id: string; status: string }>;
    if (rows.length) {
      const leaseUntil = new Date(Date.now() + 60_000);
      const queuedIds = rows.filter((row) => row.status === "queued").map((row) => row.id);
      const submittingIds = rows.filter((row) => row.status === "submitting").map((row) => row.id);
      const waitingProviderIds = rows.filter((row) => row.status === "waiting_provider").map((row) => row.id);
      if (queuedIds.length) {
        await tx.imageBatchOutput.updateMany({
          where: { id: { in: queuedIds } },
          data: {
            status: "submitting",
            startedAt: new Date(),
            leaseOwner: workerId,
            leaseUntil,
          },
        });
      }
      if (submittingIds.length) {
        await tx.imageBatchOutput.updateMany({
          where: { id: { in: submittingIds } },
          data: { leaseOwner: workerId, leaseUntil },
        });
      }
      if (waitingProviderIds.length) {
        await tx.imageBatchOutput.updateMany({
          where: { id: { in: waitingProviderIds } },
          data: { leaseOwner: workerId, leaseUntil },
        });
      }
    }
    return rows.map((row) => row.id);
  });
}

let nextHeartbeatAt = 0;

export async function runImageBatchWorkerIteration(workerId: string, concurrency = 4) {
  const sentinel = process.env.MAINTENANCE_SENTINEL || DEFAULT_MAINTENANCE_SENTINEL;
  if (await fs.pathExists(sentinel)) return 0;
  const ids = await claimBatchOutputs(workerId, concurrency);
  await Promise.all(ids.map((id: string) => processBatchOutput(id, workerId)));
  const now = Date.now();
  if (now >= nextHeartbeatAt) {
    const heartbeat = new Date(now).toISOString();
    await db.appSetting.upsert({
      where: { key: "image_batch_worker_heartbeat" },
      create: { key: "image_batch_worker_heartbeat", value: heartbeat },
      update: { value: heartbeat },
    });
    nextHeartbeatAt = now + 15_000;
  }
  return ids.length;
}
