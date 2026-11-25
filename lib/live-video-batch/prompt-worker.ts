import fs from "fs-extra";
import { Prisma } from "@prisma/client";
import { LIVE_VIDEO_BATCH_MAX_MEDIA } from "@/lib/live-video-batch/contracts";
import { generateLiveVideoPrompt } from "@/lib/live-video-batch/prompt-executor";
import prisma from "@/lib/prisma";

const db = prisma as any;
const DEFAULT_MAINTENANCE_SENTINEL = "/var/lib/inkvia-updater/state/maintenance";
let nextHeartbeatAt = 0;

export async function recomputeLiveVideoPromptAggregate(batchId: string) {
  const items = await db.liveVideoBatchItem.findMany({
    where: { batchId },
    select: { promptStatus: true },
  });
  const statuses = items.map((item: any) => String(item.promptStatus || ""));
  const status = statuses.length > 0 && statuses.every((value: string) => value === "prompt_ready")
    ? "ready"
    : statuses.some((value: string) => value === "prompt_running")
      ? "prompt_running"
      : statuses.some((value: string) => value === "prompt_queued")
        ? "prompt_queued"
        : "prompt_failed";
  await db.liveVideoBatch.update({
    where: { id: batchId },
    data: { status, finishedAt: status === "prompt_failed" ? new Date() : null },
  });
  return status;
}

export async function processLiveVideoPromptJob(jobId: string, workerId: string) {
  const job = await db.liveVideoPromptJob.findFirst({
    where: { id: jobId, leaseOwner: workerId },
    include: { batch: { select: { authUserId: true } } },
  });
  if (!job) return "missing";
  const mediaSnapshot = job.mediaSnapshot && typeof job.mediaSnapshot === "object"
    ? job.mediaSnapshot as Record<string, unknown>
    : {};
  try {
    const result = await generateLiveVideoPrompt({
      systemPrompt: String(job.systemPrompt || ""),
      userPrompt: String(job.userPrompt || ""),
      mediaUrl: String(mediaSnapshot.mediaUrl || mediaSnapshot.mediaPath || ""),
      origin: String(process.env.APP_ORIGIN || process.env.NEXTAUTH_URL || "http://127.0.0.1:3000"),
      logUserId: String(job.batch.authUserId),
    });
    const updated = await db.$transaction(async (tx: any) => {
      const claimed = await tx.liveVideoPromptJob.updateMany({
        where: { id: job.id, leaseOwner: workerId },
        data: {
          status: "success",
          generatedPrompt: result.generatedPrompt,
          errorCode: null,
          errorMessage: null,
          finishedAt: new Date(),
          leaseOwner: null,
          leaseUntil: null,
        },
      });
      if (!claimed.count) return false;
      await tx.liveVideoBatchItem.update({
        where: { id: job.itemId },
        data: {
          prompt: result.generatedPrompt,
          promptStatus: "prompt_ready",
        },
      });
      return true;
    });
    if (!updated) return "cancelled";
    await recomputeLiveVideoPromptAggregate(job.batchId);
    return "success";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Skill 分析失败";
    const code = typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code || "LIVE_VIDEO_PROMPT_FAILED")
      : "LIVE_VIDEO_PROMPT_FAILED";
    const updated = await db.$transaction(async (tx: any) => {
      const claimed = await tx.liveVideoPromptJob.updateMany({
        where: { id: job.id, leaseOwner: workerId },
        data: {
          status: "failed",
          errorCode: code,
          errorMessage: message,
          finishedAt: new Date(),
          leaseOwner: null,
          leaseUntil: null,
        },
      });
      if (!claimed.count) return false;
      await tx.liveVideoBatchItem.update({
        where: { id: job.itemId },
        data: { promptStatus: "prompt_failed" },
      });
      return true;
    });
    if (!updated) return "cancelled";
    await recomputeLiveVideoPromptAggregate(job.batchId);
    return "failed";
  }
}

export async function claimLiveVideoPromptJobs(
  workerId: string,
  limit = LIVE_VIDEO_BATCH_MAX_MEDIA,
) {
  return db.$transaction(async (tx: any) => {
    const rows = await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "LiveVideoPromptJob"
      WHERE "status" IN ('queued', 'running')
        AND "availableAt" <= NOW()
        AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${Math.max(1, Math.min(LIVE_VIDEO_BATCH_MAX_MEDIA, limit))}
    `) as Array<{ id: string }>;
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    await tx.liveVideoPromptJob.updateMany({
      where: { id: { in: ids } },
      data: {
        status: "running",
        startedAt: new Date(),
        leaseOwner: workerId,
        leaseUntil: new Date(Date.now() + 60_000),
        errorCode: null,
        errorMessage: null,
      },
    });
    await tx.liveVideoBatchItem.updateMany({
      where: { promptJobs: { some: { id: { in: ids } } } },
      data: { promptStatus: "prompt_running" },
    });
    return ids;
  });
}

export async function runLiveVideoPromptWorkerIteration(
  workerId: string,
  concurrency = LIVE_VIDEO_BATCH_MAX_MEDIA,
) {
  const sentinel = process.env.MAINTENANCE_SENTINEL || DEFAULT_MAINTENANCE_SENTINEL;
  if (await fs.pathExists(sentinel)) return 0;
  const ids = await claimLiveVideoPromptJobs(workerId, concurrency);
  await Promise.all(ids.map((id: string) => processLiveVideoPromptJob(id, workerId)));
  const now = Date.now();
  if (now >= nextHeartbeatAt) {
    const heartbeat = new Date(now).toISOString();
    await db.appSetting.upsert({
      where: { key: "live_video_prompt_worker_heartbeat" },
      create: { key: "live_video_prompt_worker_heartbeat", value: heartbeat },
      update: { value: heartbeat },
    });
    nextHeartbeatAt = now + 15_000;
  }
  return ids.length;
}
