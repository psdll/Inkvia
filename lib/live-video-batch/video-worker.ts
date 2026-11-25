import fs from "fs-extra";
import { Prisma } from "@prisma/client";
import {
  createVideoGeneration,
  type CreateVideoGenerationInput,
  type CreateVideoGenerationResult,
} from "@/lib/generation/video-service";
import {
  classifyFinalizeError,
  finalizeGeneration,
  finalizeRetryDelayMs,
} from "@/lib/generation/finalize";
import { LIVE_VIDEO_BATCH_MAX_MEDIA } from "@/lib/live-video-batch/contracts";
import {
  getLiveVideoBatchSnapshotModelSpec,
  supportsLiveVideoDuration,
} from "@/lib/live-video-batch/video-models";
import { normalizeGenerationSkillSnapshot } from "@/lib/generation/skill-metadata";
import prisma from "@/lib/prisma";

const db = prisma as any;
const DEFAULT_MAINTENANCE_SENTINEL = "/var/lib/inkvia-updater/state/maintenance";
let nextHeartbeatAt = 0;

type GenerationState = {
  id: number;
  status: string;
  localPath: string | null;
  errorMsg: string | null;
  finishedAt: Date | null;
  templateData?: string | null;
};

export type LiveVideoRequestSnapshot = {
  schemaVersion: 1;
  batchId: string;
  itemId: string;
  authUserId: number;
  sourceMediaId: string;
  mediaPath: string;
  prompt: string;
  userPrompt?: string;
  model: string;
  inputMode: "first_frame" | "multimodal";
  duration: number;
  ratio: string;
  resolution: string;
  generateAudio: boolean;
  skill?: { publicId?: string | null; name?: string | null; revision?: number | null };
};

type VideoWorkerDeps = {
  createVideoGeneration(input: CreateVideoGenerationInput): Promise<CreateVideoGenerationResult>;
  finalizeGeneration(generationId: number): Promise<unknown>;
  readGeneration(generationId: number): Promise<GenerationState | null>;
  readGenerationByRequestKey(requestKey: string): Promise<GenerationState | null>;
};

const defaultDeps: VideoWorkerDeps = {
  createVideoGeneration,
  finalizeGeneration,
  readGeneration: (generationId) => db.generation.findUnique({
    where: { id: generationId },
    select: {
      id: true,
      status: true,
      localPath: true,
      errorMsg: true,
      finishedAt: true,
      templateData: true,
    },
  }),
  readGenerationByRequestKey: (requestKey) => db.generation.findUnique({
    where: { requestKey },
    select: {
      id: true,
      status: true,
      localPath: true,
      errorMsg: true,
      finishedAt: true,
      templateData: true,
    },
  }),
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

function generationExecution(generation: GenerationState) {
  const status = String(generation.status || "").toLowerCase();
  if (generation.localPath || status === "success") {
    return {
      generationId: generation.id,
      status: "success" as const,
      errorMessage: null,
      finishedAt: generation.finishedAt || new Date(),
      retryDelayMs: null,
    };
  }
  if (["failed", "cancelled", "canceled"].includes(status)) {
    return {
      generationId: generation.id,
      status: "failed" as const,
      errorMessage: generation.errorMsg || "视频生成失败",
      finishedAt: generation.finishedAt || new Date(),
      retryDelayMs: null,
    };
  }
  return {
    generationId: generation.id,
    status: "waiting_provider" as const,
    errorMessage: null,
    finishedAt: null,
    retryDelayMs: generationRetryDelayMs(generation),
  };
}

export function buildLiveVideoOutputErrorState(
  error: unknown,
  hasGenerationId: boolean,
  retryAttempt = 1,
) {
  if (classifyFinalizeError(error) === "terminal") {
    return {
      status: "failed" as const,
      errorCode: hasGenerationId ? "VIDEO_GENERATION_FAILED" : "VIDEO_SUBMIT_FAILED",
      errorMessage: String((error as { message?: unknown } | null)?.message || "视频生成失败"),
      finishedAt: new Date(),
      retryDelayMs: null,
    };
  }
  return {
    status: hasGenerationId ? "waiting_provider" as const : "submitting" as const,
    errorCode: null,
    errorMessage: null,
    finishedAt: null,
    retryDelayMs: finalizeRetryDelayMs(retryAttempt),
  };
}

export async function executeLiveVideoGenerationSnapshot(input: {
  requestKey: string;
  snapshot: LiveVideoRequestSnapshot;
  deps?: VideoWorkerDeps;
}) {
  const deps = input.deps || defaultDeps;
  let submitted: CreateVideoGenerationResult;
  try {
    submitted = await deps.createVideoGeneration({
      authUserId: input.snapshot.authUserId,
      requestKey: input.requestKey,
      source: "batch",
      prompt: input.snapshot.prompt,
      userPrompt: input.snapshot.userPrompt,
      skill: normalizeGenerationSkillSnapshot(input.snapshot.skill) || undefined,
      model: input.snapshot.model,
      toolMediaIds: [input.snapshot.sourceMediaId],
      inputMode: input.snapshot.inputMode,
      duration: input.snapshot.duration,
      resolution: input.snapshot.resolution,
      ratio: input.snapshot.ratio,
      generateAudio: input.snapshot.generateAudio,
    });
  } catch (error) {
    const recovered = await deps.readGenerationByRequestKey(input.requestKey);
    if (!recovered) throw error;
    return generationExecution(recovered);
  }
  if (submitted.status === "success") {
    return {
      generationId: submitted.generationId,
      status: "success" as const,
      errorMessage: null,
      finishedAt: new Date(),
      retryDelayMs: null,
    };
  }
  return {
    generationId: submitted.generationId,
    status: "waiting_provider" as const,
    errorMessage: null,
    finishedAt: null,
    retryDelayMs: finalizeRetryDelayMs(1),
  };
}

export async function recomputeLiveVideoOutputAggregate(batchId: string, changedItemId: string) {
  const rows = await db.liveVideoBatchOutput.findMany({
    where: { batchId },
    orderBy: [{ itemId: "asc" }, { attempt: "desc" }],
    select: { itemId: true, status: true },
  });
  const latest = new Map<string, string>();
  for (const row of rows) {
    if (!latest.has(row.itemId)) latest.set(row.itemId, String(row.status));
  }
  const changedStatus = latest.get(changedItemId);
  if (changedStatus) {
    await db.liveVideoBatchItem.update({
      where: { id: changedItemId },
      data: { videoStatus: changedStatus },
    });
  }
  const statuses = Array.from(latest.values());
  const active = statuses.some((status) => ["queued", "submitting", "waiting_provider"].includes(status));
  const successCount = statuses.filter((status) => status === "success").length;
  const terminalCount = statuses.filter((status) => ["success", "failed", "cancelled"].includes(status)).length;
  const status = active
    ? statuses.some((value) => value === "waiting_provider" || value === "submitting") ? "running" : "queued"
    : successCount === statuses.length && statuses.length > 0
      ? "success"
      : successCount > 0 && terminalCount === statuses.length
        ? "partial_success"
        : "failed";
  const terminal = ["success", "partial_success", "failed", "cancelled"].includes(status);
  await db.liveVideoBatch.update({
    where: { id: batchId },
    data: { status, finishedAt: terminal ? new Date() : null },
  });
  return status;
}

export async function processLiveVideoOutput(outputId: string, workerId: string) {
  const output = await db.liveVideoBatchOutput.findFirst({
    where: { id: outputId, leaseOwner: workerId },
  });
  if (!output) return "missing";
  const snapshot = output.requestSnapshot as LiveVideoRequestSnapshot;
  const snapshotSpec = getLiveVideoBatchSnapshotModelSpec(snapshot?.model);
  if (
    snapshot?.schemaVersion !== 1
    || !snapshotSpec
    || !(["first_frame", "multimodal"] as const).includes(snapshot.inputMode)
    || !snapshotSpec.supportedInputModes.includes(snapshot.inputMode)
    || !supportsLiveVideoDuration(snapshotSpec, snapshot.duration)
  ) {
    const updated = await db.liveVideoBatchOutput.updateMany({
      where: { id: output.id, leaseOwner: workerId },
      data: {
        status: "failed",
        errorCode: "UNSUPPORTED_SNAPSHOT",
        errorMessage: "视频任务快照无效",
        finishedAt: new Date(),
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    if (!updated.count) return "cancelled";
    await recomputeLiveVideoOutputAggregate(output.batchId, output.itemId);
    return "failed";
  }

  try {
    let execution;
    if (output.generationId) {
      await defaultDeps.finalizeGeneration(output.generationId);
      const generation = await defaultDeps.readGeneration(output.generationId);
      if (!generation) throw new Error("视频生成记录不存在");
      execution = generationExecution(generation);
    } else {
      execution = await executeLiveVideoGenerationSnapshot({
        requestKey: output.requestKey,
        snapshot,
      });
    }
    const updated = await db.liveVideoBatchOutput.updateMany({
      where: { id: output.id, leaseOwner: workerId },
      data: {
        generationId: execution.generationId,
        status: execution.status,
        errorCode: execution.status === "failed" ? "VIDEO_GENERATION_FAILED" : null,
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
    await recomputeLiveVideoOutputAggregate(output.batchId, output.itemId);
    return execution.status;
  } catch (error) {
    let retryAttempt = 1;
    if (output.generationId) {
      const generation = await defaultDeps.readGeneration(output.generationId).catch(() => null);
      retryAttempt = finalizeAttemptFromTemplateData(generation?.templateData);
    }
    const state = buildLiveVideoOutputErrorState(error, Boolean(output.generationId), retryAttempt);
    const updated = await db.liveVideoBatchOutput.updateMany({
      where: { id: output.id, leaseOwner: workerId },
      data: {
        status: state.status,
        errorCode: state.errorCode,
        errorMessage: state.errorMessage,
        finishedAt: state.finishedAt,
        nextPollAt: state.retryDelayMs ? new Date(Date.now() + state.retryDelayMs) : null,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    if (!updated.count) return "cancelled";
    await recomputeLiveVideoOutputAggregate(output.batchId, output.itemId);
    return state.status;
  }
}

export async function claimLiveVideoOutputs(
  workerId: string,
  limit = LIVE_VIDEO_BATCH_MAX_MEDIA,
) {
  return db.$transaction(async (tx: any) => {
    const rows = await tx.$queryRaw(Prisma.sql`
      SELECT "id", "status"
      FROM "LiveVideoBatchOutput"
      WHERE "status" IN ('queued', 'submitting', 'waiting_provider')
        AND ("nextPollAt" IS NULL OR "nextPollAt" <= NOW())
        AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${Math.max(1, Math.min(LIVE_VIDEO_BATCH_MAX_MEDIA, limit))}
    `) as Array<{ id: string; status: string }>;
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const queuedIds = rows.filter((row) => row.status === "queued").map((row) => row.id);
    if (queuedIds.length) {
      await tx.liveVideoBatchOutput.updateMany({
        where: { id: { in: queuedIds } },
        data: { status: "submitting", startedAt: new Date() },
      });
    }
    await tx.liveVideoBatchOutput.updateMany({
      where: { id: { in: ids } },
      data: {
        leaseOwner: workerId,
        leaseUntil: new Date(Date.now() + 60_000),
      },
    });
    return ids;
  });
}

export async function runLiveVideoVideoWorkerIteration(
  workerId: string,
  concurrency = LIVE_VIDEO_BATCH_MAX_MEDIA,
) {
  const sentinel = process.env.MAINTENANCE_SENTINEL || DEFAULT_MAINTENANCE_SENTINEL;
  if (await fs.pathExists(sentinel)) return 0;
  const ids = await claimLiveVideoOutputs(workerId, concurrency);
  await Promise.all(ids.map((id: string) => processLiveVideoOutput(id, workerId)));
  const now = Date.now();
  if (now >= nextHeartbeatAt) {
    const heartbeat = new Date(now).toISOString();
    await db.appSetting.upsert({
      where: { key: "live_video_video_worker_heartbeat" },
      create: { key: "live_video_video_worker_heartbeat", value: heartbeat },
      update: { value: heartbeat },
    });
    nextHeartbeatAt = now + 15_000;
  }
  return ids.length;
}
