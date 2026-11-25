import { isSunoModel } from "@/lib/suno-models";
import { MediaKitError } from "@/lib/volcengine-mediakit";
import { createSubtitleRemovalGeneration } from "./subtitle-removal-server";
import { CanvasCreativeInputError, composeCanvasCreativePrompt } from "@/lib/canvas/creative-presets/compose";
import { composeCanvasModelPrompt } from "@/lib/canvas/text-references";
import "server-only";

import { Prisma } from "@prisma/client";
import { canvasEdgeSchema, canvasNodeSchema, type CanvasEdge, type CanvasNode, type CanvasNodeData } from "@/lib/canvas/document";
import { createPrismaCanvasMutationStore } from "@/lib/canvas/prisma-mutation-store";
import { submitCanvasMutation, CanvasMutationServiceError } from "@/lib/canvas/mutation-service";
import {
  beginCanvasRunStepSubmission,
  CanvasRunQueueError,
  claimCanvasRunStepsForPolling,
  claimFairCanvasRunSteps,
  completeCanvasRunStep,
  markCanvasRunStepFailed,
  markCanvasRunStepWaiting,
  readCanvasRunStepOutput,
  recordCanvasRunStepOutput,
  recoverExpiredCanvasRunStepLeases,
  releaseCanvasRunStepPollingLease,
  type ClaimedCanvasRunStep,
} from "@/lib/canvas/run-queue";
import {
  buildCanvasRunStepSubmission,
  buildCanvasRunStepSuccessPatch,
  classifyGenerationRecord,
} from "@/lib/canvas/run-worker-contract";
import { getOrCreateGenerationMediaAsset } from "@/lib/canvas/generation-media";
import { getCanvasGenerationOutputs, type CanvasGenerationOutput } from "@/lib/canvas/generation-outputs";
import { canvasLlmChat } from "@/lib/canvas/llm";
import { createImageGeneration, ImageGenerationError } from "@/lib/generation/image-service";
import { createVideoGeneration, VideoGenerationError } from "@/lib/generation/video-service";
import { AudioGenerationError, createAudioGeneration } from "@/lib/generation/audio-service";
import type { CreateAudioGenerationInput } from "@/lib/generation/audio-service";
import { SEED_AUDIO_TIMEOUT_MS } from "@/lib/seed-audio-models";
import { finalizeGeneration } from "@/lib/generation/finalize";
import prisma from "@/lib/prisma";
import { canvasMetrics } from "@/lib/canvas/observability";
import { resolveAssetUrlForExternalApi } from "@/lib/external-assets";
import { getMediaDeliveryMode } from "@/lib/media-delivery/settings";

const OUTPUT_SLOT = "default";
const SUBMISSION_LEASE_MS = 180_000;
const APPLY_LEASE_MS = 60_000;

type StepInput = { node: CanvasNode; incomingNodes: CanvasNode[]; incomingEdges: CanvasEdge[] };
type StepOutput = { finishedAt: number; text?: string; url?: string; generationId?: number; mediaId?: string; outputs?: CanvasGenerationOutput[]; durationSeconds?: number; usageCharacters?: number };

async function bindImageOutputMedia(outputs: CanvasGenerationOutput[], authUserId: number, type: string) {
  return Promise.all(outputs.map(async (output) => {
    if (!output.generationId) return output;
    const media = await getOrCreateGenerationMediaAsset(prisma, {
      id: output.generationId, authUserId, type, localPath: output.url,
    });
    return { ...output, mediaId: media.mediaId, url: media.url };
  }));
}

async function resolveCanvasProviderMediaUrls(urls: readonly string[]) {
  // With platform hosting on, local uploads stay local here; the image/video service then hands
  // each file to the target platform's own hosting, or relays it through Aliyun OSS if needed.
  if (await getMediaDeliveryMode() === "platform") return urls.map(localUploadPathOrSelf);
  return Promise.all(urls.map((url) => resolveAssetUrlForExternalApi(url, "canvas-provider-inputs")));
}

function localUploadPathOrSelf(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if ((host === "localhost" || host === "127.0.0.1" || host === "::1") && parsed.pathname.startsWith("/uploads/")) return parsed.pathname;
  } catch {}
  return url;
}

function parseStepInput(value: unknown): StepInput {
  if (!value || typeof value !== "object" || !("node" in value)) throw new Error("RUN_STEP_INPUT_INVALID");
  const input = value as { node: unknown; incomingNodes?: unknown; incomingEdges?: unknown };
  return {
    node: canvasNodeSchema.parse(input.node) as CanvasNode,
    incomingNodes: canvasNodeSchema.array().parse(input.incomingNodes || []) as CanvasNode[],
    incomingEdges: canvasEdgeSchema.array().parse(input.incomingEdges || []) as CanvasEdge[],
  };
}

async function applyOutputMutation(step: ClaimedCanvasRunStep, output: StepOutput, failure?: string) {
  const existing = await prisma.$queryRaw<Array<{ revision: bigint }>>(Prisma.sql`
    SELECT mutation."revision" FROM "CanvasMutation" mutation
    JOIN "CanvasRun" run ON run."canvasId" = mutation."canvasId"
    WHERE run."id" = ${step.runId} AND mutation."clientMutationId" = ${step.requestKey}::uuid
    LIMIT 1
  `);
  if (existing[0]) return { applied: true, revision: existing[0].revision.toString(), idempotent: true };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = await prisma.$queryRaw<Array<{ canvasId: number; revision64: bigint; data: unknown }>>(Prisma.sql`
      SELECT run."canvasId", canvas."revision64", node."data"
      FROM "CanvasRun" run
      JOIN "Canvas" canvas ON canvas."id" = run."canvasId"
      LEFT JOIN "CanvasNodeState" node ON node."canvasId" = run."canvasId" AND node."nodeId" = ${step.nodeId}
      WHERE run."id" = ${step.runId} AND canvas."deletedAt" IS NULL
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) throw new Error("RUN_CANVAS_NOT_FOUND");
    if (!row.data) return { applied: false, reason: "node_deleted" };
    const currentNode = canvasNodeSchema.parse(row.data) as CanvasNode;
    if (currentNode.data.kind === "videoTask" && currentNode.data.subtitleRemoval && currentNode.data.status === "cancelled") return { applied: false, reason: "cancelled" };
    const patch = failure ? { data: { status: "failed", error: failure, finishedAt: output.finishedAt } } : buildCanvasRunStepSuccessPatch({
      runId: step.runId,
      stepId: step.id.toString(),
      nodeKind: step.nodeKind,
      pinnedNodeData: currentNode.data as CanvasNodeData,
      output,
      finishedAt: output.finishedAt,
    });
    try {
      const result = await submitCanvasMutation({
        canvasId: row.canvasId,
        actorUserId: step.authUserId,
        input: {
          protocolVersion: 1,
          clientMutationId: step.requestKey,
          clientSequence: 0,
          baseRevision: row.revision64.toString(),
          operations: [{ opId: `run-step-${step.id}`, kind: "node.patch", nodeId: step.nodeId, patch }],
        },
      }, createPrismaCanvasMutationStore(prisma));
      return { applied: true, revision: result.revision, idempotent: result.idempotent };
    } catch (error) {
      if (error instanceof CanvasMutationServiceError && error.code === "CANVAS_REVISION_CONFLICT") continue;
      throw error;
    }
  }
  throw new Error("RUN_OUTPUT_APPLY_CONFLICT");
}

async function persistAndApplyOutput(step: ClaimedCanvasRunStep, workerId: string, output: StepOutput) {
  const leaseUntil = new Date(Date.now() + APPLY_LEASE_MS);
  await recordCanvasRunStepOutput(prisma, {
    stepId: step.id,
    workerId,
    outputSlot: OUTPUT_SLOT,
    payload: output,
    mediaId: output.mediaId,
    generationId: output.generationId,
    leaseUntil,
  });
  await applyOutputMutation(step, output);
  await completeCanvasRunStep(prisma, {
    stepId: step.id,
    workerId,
    outputSlot: OUTPUT_SLOT,
    payload: output,
    mediaId: output.mediaId,
    generationId: output.generationId,
  });
}

async function submitStep(step: ClaimedCanvasRunStep, workerId: string) {
  await beginCanvasRunStepSubmission(prisma, {
    stepId: step.id,
    workerId,
    leaseUntil: new Date(Date.now() + (step.nodeKind === "audioTask" ? SEED_AUDIO_TIMEOUT_MS + 120_000 : SUBMISSION_LEASE_MS)),
  });
  try {
    const pinned = parseStepInput(step.input);
    const submission = buildCanvasRunStepSubmission({ nodeKind: step.nodeKind, ...pinned });
    if (submission.kind === "subtitleRemoval") {
      const generated = await createSubtitleRemovalGeneration({ ...submission, authUserId: step.authUserId, requestKey: step.requestKey, canvasId: step.canvasId });
      await markCanvasRunStepWaiting(prisma, {
        stepId: step.id, workerId, provider: "volcengine-mediakit", providerRequestId: String(generated.generationId),
        leaseUntil: new Date(Date.now() + 5_000),
      });
      return "waiting" as const;
    }

    if (submission.kind === "control") {
      await persistAndApplyOutput(step, workerId, { finishedAt: Date.now() });
      return "completed" as const;
    }
    if (submission.kind === "llm") {
      const text = await canvasLlmChat({ ...submission, authUserId: step.authUserId, prompt: composeCanvasModelPrompt(submission.prompt, submission.textList) });
      await persistAndApplyOutput(step, workerId, { text, finishedAt: Date.now() });
      return "completed" as const;
    }
    if (submission.kind === "audio") {
      const generated = await createAudioGeneration({
        ...submission,
        text: composeCanvasModelPrompt(submission.text, submission.textList),
        model: submission.model as CreateAudioGenerationInput["model"],
        authUserId: step.authUserId,
        requestKey: step.requestKey,
        source: "canvas", canvasId: step.canvasId,
      });
      if (generated.status !== "success" || !generated.outputPath) {
        await markCanvasRunStepWaiting(prisma, {
          stepId: step.id,
          workerId,
          provider: submission.kind,
          providerRequestId: String(generated.generationId),
          leaseUntil: new Date(Date.now() + 5_000),
        });
        return "waiting" as const;
      }
      const media = await getOrCreateGenerationMediaAsset(prisma, {
        id: generated.generationId,
        authUserId: step.authUserId,
        type: "audio_gen",
        localPath: generated.outputPath,
      });
      const musicRecord = isSunoModel(submission.model) ? await prisma.generation.findFirst({ where: { id: generated.generationId, authUserId: step.authUserId }, select: { id: true, localPath: true, templateData: true } }) : null;
      const musicOutputs = musicRecord ? await bindImageOutputMedia(getCanvasGenerationOutputs(musicRecord), step.authUserId, "audio_gen") : undefined;
      await persistAndApplyOutput(step, workerId, {
        generationId: generated.generationId,
        mediaId: media.mediaId,
        url: media.url,
        ...(musicOutputs?.length ? { outputs: musicOutputs } : {}),
        durationSeconds: generated.durationSeconds,
        usageCharacters: generated.usageCharacters,
        finishedAt: Date.now(),
      });
      return "completed" as const;
    }
    if (submission.kind === "image" && submission.imageAngle && !submission.imagePaths.length) throw new CanvasCreativeInputError("调整角度需要连接原图。");
    const generated = submission.kind === "image"
      ? await createImageGeneration({
          ...submission,
          prompt: composeCanvasCreativePrompt(submission),
          imagePaths: await resolveCanvasProviderMediaUrls(submission.imagePaths),
          authUserId: step.authUserId, requestKey: step.requestKey, source: "canvas", canvasId: step.canvasId, n: 1,
        })
      : await createVideoGeneration({
          ...submission,
          prompt: composeCanvasCreativePrompt(submission),
          mediaPaths: await resolveCanvasProviderMediaUrls(submission.mediaPaths),
          authUserId: step.authUserId, requestKey: step.requestKey, source: "canvas", canvasId: step.canvasId,
        });
    if (generated.status === "success" && "outputPaths" in generated && generated.outputPaths?.[0]) {
      const record = await prisma.generation.findFirst({
        where: { id: generated.generationId, authUserId: step.authUserId },
        select: { id: true, localPath: true, templateData: true },
      });
      const saved = record ? getCanvasGenerationOutputs(record) : [];
      const outputs = await bindImageOutputMedia(saved.length ? saved : generated.outputPaths.map((url, index) => ({
        url, ...(index === 0 ? { generationId: generated.generationId } : {}),
      })), step.authUserId, "image_edit");
      await persistAndApplyOutput(step, workerId, {
        generationId: generated.generationId,
        mediaId: outputs[0].mediaId,
        url: outputs[0].url,
        outputs,
        finishedAt: Date.now(),
      });
      return "completed" as const;
    }
    await markCanvasRunStepWaiting(prisma, {
      stepId: step.id,
      workerId,
      provider: submission.kind,
      providerRequestId: String(generated.generationId),
      leaseUntil: new Date(Date.now() + 5_000),
    });
    return "waiting" as const;
  } catch (error) {
    const creativeRejection = error instanceof CanvasCreativeInputError;
    const knownRejection = error instanceof MediaKitError || creativeRejection || error instanceof ImageGenerationError || error instanceof VideoGenerationError || error instanceof AudioGenerationError;
    try {
      await markCanvasRunStepFailed(prisma, {
        stepId: step.id,
        workerId,
        errorCode: creativeRejection ? "CREATIVE_SETTINGS_INVALID" : knownRejection ? "PROVIDER_REJECTED" : "SUBMISSION_OUTCOME_UNKNOWN",
        errorMessage: error instanceof Error ? error.message : String(error),
        submissionUnknown: !knownRejection,
      });
    } catch (markError) {
      if (markError instanceof CanvasRunQueueError && markError.code === "RUN_STEP_LEASE_LOST") return "cancelled" as const;
      throw markError;
    }
    return knownRejection ? "failed" as const : "submission_unknown" as const;
  }
}

async function pollStep(step: ClaimedCanvasRunStep, workerId: string) {
  if (step.status === "applying") {
    const stored = await readCanvasRunStepOutput(prisma, step.id, OUTPUT_SLOT);
    if (!stored) throw new Error("RUN_STEP_OUTPUT_MISSING");
    const output = stored.payload as StepOutput;
    await applyOutputMutation(step, output);
    await completeCanvasRunStep(prisma, {
      stepId: step.id, workerId, outputSlot: OUTPUT_SLOT, payload: output,
      mediaId: stored.mediaId || undefined, generationId: stored.generationId || undefined,
    });
    return "completed" as const;
  }

  const generationId = Number(step.providerRequestId);
  if (!Number.isInteger(generationId) || generationId < 1) throw new Error("RUN_PROVIDER_REQUEST_ID_INVALID");
  await finalizeGeneration(generationId).catch(() => "pending");
  const generation = await prisma.generation.findFirst({
    where: { id: generationId, authUserId: step.authUserId },
    select: { id: true, authUserId: true, type: true, status: true, localPath: true, templateData: true, errorMsg: true },
  });
  if (!generation) throw new Error("RUN_GENERATION_NOT_FOUND");
  const result = classifyGenerationRecord(generation);
  if (result.kind === "waiting") {
    await releaseCanvasRunStepPollingLease(prisma, { stepId: step.id, workerId });
    return "waiting" as const;
  }
  if (result.kind === "failed") {
    await markCanvasRunStepFailed(prisma, {
      stepId: step.id, workerId, errorCode: "PROVIDER_FAILED", errorMessage: result.error,
    });
    return "failed" as const;
  }
  if (step.nodeKind === "imageTask" || step.nodeKind === "audioTask") {
    const outputs = await bindImageOutputMedia(getCanvasGenerationOutputs(generation), step.authUserId, generation.type);
    await persistAndApplyOutput(step, workerId, {
      generationId: generation.id,
      mediaId: outputs[0].mediaId,
      url: outputs[0].url,
      durationSeconds: outputs[0].suno?.durationSeconds,
      outputs,
      finishedAt: Date.now(),
    });
    return "completed" as const;
  }
  const media = await getOrCreateGenerationMediaAsset(prisma, {
    id: generation.id,
    authUserId: generation.authUserId,
    type: generation.type,
    localPath: result.url,
  });
  await persistAndApplyOutput(step, workerId, {
    generationId: generation.id,
    mediaId: media.mediaId,
    url: media.url,
    finishedAt: Date.now(),
  });
  return "completed" as const;
}

export async function runCanvasWorkerBatch(input: { workerId: string; limit?: number }) {
  const recovery = await recoverExpiredCanvasRunStepLeases(prisma);
  canvasMetrics.increment("canvas_step_lease_recovery_total", recovery.queued + recovery.released);
  canvasMetrics.increment("canvas_submission_unknown_total", recovery.submissionUnknown);
  const [polling, queued] = await Promise.all([
    claimCanvasRunStepsForPolling(prisma, input),
    claimFairCanvasRunSteps(prisma, input),
  ]);
  const outcomes: string[] = [];
  for (const step of polling) {
    try {
      outcomes.push(await pollStep(step, input.workerId));
    } catch (error) {
      await markCanvasRunStepFailed(prisma, {
        stepId: step.id,
        workerId: input.workerId,
        errorCode: "WORKER_POLL_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      }).catch(() => null);
      outcomes.push("failed");
    }
  }
  for (const step of queued) {
    try {
      outcomes.push(await submitStep(step, input.workerId));
    } catch (error) {
      if (error instanceof CanvasRunQueueError && error.code === "RUN_STEP_LEASE_LOST") {
        outcomes.push("cancelled");
        continue;
      }
      await markCanvasRunStepFailed(prisma, {
        stepId: step.id,
        workerId: input.workerId,
        errorCode: "WORKER_SUBMIT_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      }).catch(() => null);
      outcomes.push("failed");
    }
  }
  canvasMetrics.increment("canvas_provider_failure_total", outcomes.filter((outcome) => outcome === "failed").length);
  canvasMetrics.increment("canvas_submission_unknown_total", outcomes.filter((outcome) => outcome === "submission_unknown").length);
  return {
    recovery,
    claimed: queued.length,
    polled: polling.length,
    completed: outcomes.filter((outcome) => outcome === "completed").length,
    waiting: outcomes.filter((outcome) => outcome === "waiting").length,
    failed: outcomes.filter((outcome) => outcome === "failed").length,
    submissionUnknown: outcomes.filter((outcome) => outcome === "submission_unknown").length,
  };
}
