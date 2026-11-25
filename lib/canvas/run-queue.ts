import "server-only";

import crypto from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { CANVAS_SCHEMA_VERSION, type CanvasDocumentV2, type CanvasEdge, type CanvasNode } from "@/lib/canvas/document";
import { hashCanvasMutationPayload } from "@/lib/canvas/mutation-contract";
import { planCanvasRunSteps, type CanvasRunScope } from "@/lib/canvas/run-planner";

type Tx = Prisma.TransactionClient;

const uuidSchema = z.string().uuid();
const CANVAS_RUNNER_HEARTBEAT_MAX_AGE_MS = 120_000;

export class CanvasRunQueueError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message);
    this.name = "CanvasRunQueueError";
  }
}

type RunAccess = {
  id: number;
  revision: number;
  revision64: bigint;
  projectionRevision: bigint;
  settings: CanvasDocumentV2["settings"];
  viewport: CanvasDocumentV2["viewport"] | null;
  canEdit: boolean;
};

function isRecentCanvasWorkerHeartbeat(value: string, now = Date.now()) {
  try {
    const heartbeat = JSON.parse(value) as { successAt?: unknown };
    const successAt = Date.parse(String(heartbeat.successAt || ""));
    return Number.isFinite(successAt)
      && successAt <= now + 5_000
      && now - successAt <= CANVAS_RUNNER_HEARTBEAT_MAX_AGE_MS;
  } catch {
    return false;
  }
}

async function loadRunDocument(tx: Tx, canvasId: number, authUserId: number) {
  const accessRows = await tx.$queryRaw<RunAccess[]>(Prisma.sql`
    SELECT canvas."id", canvas."revision", canvas."revision64", canvas."projectionRevision", canvas."settings",
           canvas."data"->'viewport' AS "viewport",
           (canvas."authUserId" = ${authUserId} OR EXISTS (
             SELECT 1 FROM "CanvasMember" member
             WHERE member."canvasId" = canvas."id" AND member."userId" = ${authUserId}
               AND member."role" IN ('OWNER', 'EDITOR')
           )) AS "canEdit"
    FROM "Canvas" canvas
    WHERE canvas."id" = ${canvasId} AND canvas."deletedAt" IS NULL
    LIMIT 1
  `);
  const access = accessRows[0];
  if (!access) throw new CanvasRunQueueError("CANVAS_NOT_FOUND", "canvas not found", 404);
  if (!access.canEdit) throw new CanvasRunQueueError("CANVAS_FORBIDDEN", "canvas is read-only", 403);
  if (access.projectionRevision !== access.revision64) {
    throw new CanvasRunQueueError("CANVAS_PROJECTION_OUT_OF_SYNC", "canvas projection is not current", 503);
  }
  const [nodeRows, edgeRows] = await Promise.all([
    tx.$queryRaw<Array<{ data: unknown }>>(Prisma.sql`
      SELECT "data" FROM "CanvasNodeState" WHERE "canvasId" = ${canvasId} ORDER BY "nodeId" ASC
    `),
    tx.$queryRaw<Array<{ data: unknown }>>(Prisma.sql`
      SELECT "data" FROM "CanvasEdgeState" WHERE "canvasId" = ${canvasId} ORDER BY "edgeId" ASC
    `),
  ]);
  const viewport = access.viewport && Number.isFinite(access.viewport.x) && Number.isFinite(access.viewport.y)
    && Number.isFinite(access.viewport.zoom) && access.viewport.zoom > 0
    ? access.viewport
    : { x: 0, y: 0, zoom: 1 };
  const document: CanvasDocumentV2 = {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    mode: "smart",
    nodes: nodeRows.map((row) => row.data as CanvasNode),
    edges: edgeRows.map((row) => row.data as CanvasEdge),
    settings: access.settings,
    viewport,
  };
  return { access, document };
}

export async function createQueuedCanvasRun(
  client: PrismaClient,
  input: {
    canvasId: number;
    authUserId: number;
    scope: CanvasRunScope;
    nodeIds: string[];
    expectedRevision: string;
    clientRequestId?: string;
    priority?: number;
  },
) {
  let expectedRevision: bigint;
  try {
    expectedRevision = BigInt(input.expectedRevision);
  } catch {
    throw new CanvasRunQueueError("CANVAS_REVISION_INVALID", "canvas revision is invalid", 400);
  }
  if (expectedRevision <= BigInt(0)) {
    throw new CanvasRunQueueError("CANVAS_REVISION_INVALID", "canvas revision is invalid", 400);
  }
  const requestKey = input.clientRequestId ? uuidSchema.parse(input.clientRequestId) : crypto.randomUUID();
  const normalizedNodeIds = [...new Set(input.nodeIds.map(String).filter(Boolean))].slice(0, 1_000);
  const priority = Math.min(Math.max(Math.floor(input.priority ?? 0), 0), 1_000);
  return client.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended('canvas-run-admission', 0))::text
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`canvas-run:${input.canvasId}`}, 0))::text
    `);
    const { access, document } = await loadRunDocument(tx, input.canvasId, input.authUserId);
    const requestHash = hashCanvasMutationPayload({
      canvasId: input.canvasId,
      revision: expectedRevision.toString(),
      scope: input.scope,
      nodeIds: normalizedNodeIds,
    });
    const duplicates = await tx.$queryRaw<Array<{ id: number; status: string; requestHash: string | null; queuedAt: Date }>>(Prisma.sql`
      SELECT "id", "status", "requestHash", "queuedAt" FROM "CanvasRun" WHERE "requestKey" = ${requestKey}::uuid LIMIT 1
    `);
    if (duplicates[0]) {
      if (duplicates[0].requestHash !== requestHash) throw new CanvasRunQueueError("RUN_REQUEST_KEY_REUSED", "run request key was reused for different input");
      return { ...duplicates[0], requestKey, graphRevision64: expectedRevision.toString(), idempotent: true, stepCount: null };
    }
    const heartbeatRows = await tx.$queryRaw<Array<{ value: string }>>(Prisma.sql`
      SELECT "value" FROM "AppSetting"
      WHERE "key" IN ('canvas_worker_heartbeat_generation', 'canvas_worker_heartbeat_all')
    `);
    if (process.env.CANVAS_SERVER_RUNNER_ENABLED === "0"
      || !heartbeatRows.some((row) => isRecentCanvasWorkerHeartbeat(row.value))) {
      throw new CanvasRunQueueError("CANVAS_RUNNER_UNAVAILABLE", "画布执行器暂时不可用，请稍后重试", 503);
    }
    if (access.revision64 !== expectedRevision) {
      throw new CanvasRunQueueError("CANVAS_STALE_REVISION", "canvas changed before the run was queued");
    }
    const steps = planCanvasRunSteps(document, { scope: input.scope, nodeIds: normalizedNodeIds, runRequestKey: requestKey });
    if (!steps.length) throw new CanvasRunQueueError("RUN_HAS_NO_EXECUTABLE_STEPS", "run contains no executable nodes", 400);
    if (steps.length > 1_000) throw new CanvasRunQueueError("RUN_STEP_LIMIT", "run exceeds 1000 steps", 400);
    const data = steps[0].input.node.data;
    const independentSubtitle = input.scope === "single" && steps.length === 1 && data.kind === "videoTask" && Boolean(data.subtitleRemoval);
    const activeRuns = await tx.$queryRaw<Array<{ id: number; state: { nodeIds?: string[] } | null }>>(Prisma.sql`
      SELECT "id", "state" FROM "CanvasRun"
      WHERE "canvasId" = ${input.canvasId}
        AND "status" IN ('queued', 'running', 'cancel_requested', 'submission_unknown')
      FOR UPDATE
    `);
    // Subtitle removal writes a new derived node; unrelated jobs can keep running.
    // Still protect a node from two runs applying competing output patches.
    if (activeRuns.some(run => !independentSubtitle || !Array.isArray(run.state?.nodeIds)
      || run.state.nodeIds.some(nodeId => steps.some(step => step.nodeId === nodeId)))) {
      throw new CanvasRunQueueError("CANVAS_RUN_ACTIVE", "所选节点已有执行中的任务，请完成后重试");
    }
    const userQueueRows = await tx.$queryRaw<Array<{ count: number | bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "count" FROM "CanvasRun"
      WHERE "authUserId" = ${input.authUserId}
        AND "status" IN ('queued', 'running', 'cancel_requested', 'submission_unknown')
    `);
    if (Number(userQueueRows[0]?.count ?? 0) >= 20) {
      throw new CanvasRunQueueError("CANVAS_USER_QUEUE_LIMIT", "too many active canvas runs for this user", 429);
    }
    const globalQueueRows = await tx.$queryRaw<Array<{ count: number | bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "count" FROM "CanvasRun"
      WHERE "status" IN ('queued', 'running', 'cancel_requested', 'submission_unknown')
    `);
    if (Number(globalQueueRows[0]?.count ?? 0) >= 2_000) {
      throw new CanvasRunQueueError("CANVAS_QUEUE_SATURATED", "canvas run queue is saturated", 503);
    }
    const state = {
      scope: input.scope,
      nodeIds: steps.map((step) => step.nodeId),
      nodes: Object.fromEntries(steps.map((step) => [step.nodeId, { status: "queued" }])),
      logs: [],
    };
    const run = await tx.canvasRun.create({
      data: {
        authUserId: input.authUserId,
        canvasId: input.canvasId,
        status: "queued",
        graphRevision: access.revision,
        graphRevision64: access.revision64,
        requestKey,
        requestHash,
        priority,
        state,
      },
      select: {
        id: true,
        status: true,
        queuedAt: true,
      },
    });
    for (const step of steps) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "CanvasRunStep" (
          "runId", "authUserId", "stepKey", "nodeId", "nodeKind", "status", "priority", "requestKey",
          "dependencies", "input", "provider", "attempts", "nextRetryAt", "createdAt", "updatedAt"
        ) VALUES (
          ${run.id}, ${input.authUserId}, ${step.stepKey}, ${step.nodeId}, ${step.nodeKind}, 'queued', ${priority},
          ${step.requestKey}::uuid, ${JSON.stringify(step.dependencies)}::jsonb, ${JSON.stringify(step.input)}::jsonb,
          ${step.provider ?? null}, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `);
    }
    return {
      ...run,
      requestKey,
      graphRevision64: access.revision64.toString(),
      idempotent: false,
      stepCount: steps.length,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: 5000,
    timeout: 30000,
  });
}

export type ClaimedCanvasRunStep = {
  canvasId?: number;
  id: bigint;
  runId: number;
  authUserId: number;
  nodeId: string;
  nodeKind: string;
  status: string;
  requestKey: string;
  input: unknown;
  provider: string | null;
  providerRequestId?: string | null;
  attempts: number;
};

export async function recoverExpiredCanvasRunStepLeases(client: PrismaClient, now = new Date()) {
  const retried = await client.$executeRaw(Prisma.sql`
    UPDATE "CanvasRunStep" SET "status" = 'queued', "updatedAt" = CURRENT_TIMESTAMP
    WHERE "status" = 'retry_wait' AND "nextRetryAt" <= ${now}
  `);
  const queued = await client.$executeRaw(Prisma.sql`
    UPDATE "CanvasRunStep" SET "status" = 'queued', "leaseOwner" = NULL, "leaseUntil" = NULL,
      "nextRetryAt" = ${now}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "status" = 'leased' AND "leaseUntil" <= ${now}
  `);
  const unknownSteps = await client.$queryRaw<Array<{ runId: number }>>(Prisma.sql`
    UPDATE "CanvasRunStep" SET "status" = 'submission_unknown', "leaseOwner" = NULL, "leaseUntil" = NULL,
      "errorCode" = 'SUBMISSION_OUTCOME_UNKNOWN', "updatedAt" = CURRENT_TIMESTAMP
    WHERE "status" = 'submitting' AND "leaseUntil" <= ${now}
    RETURNING "runId"
  `);
  if (unknownSteps.length) {
    await client.$executeRaw(Prisma.sql`
      UPDATE "CanvasRun" SET "status" = 'submission_unknown', "finishedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" IN (${Prisma.join([...new Set(unknownSteps.map((step) => step.runId))])})
        AND "status" NOT IN ('success', 'cancelled')
    `);
  }
  const released = await client.$executeRaw(Prisma.sql`
    UPDATE "CanvasRunStep" SET "leaseOwner" = NULL, "leaseUntil" = NULL, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "status" IN ('waiting_provider', 'applying') AND "leaseUntil" <= ${now}
  `);
  return { retried, queued, submissionUnknown: unknownSteps.length, released };
}

export async function claimFairCanvasRunSteps(
  client: PrismaClient,
  input: { workerId: string; limit?: number; now?: Date; leaseMs?: number },
): Promise<ClaimedCanvasRunStep[]> {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 20), 1), 100);
  const now = input.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + Math.max(input.leaseMs ?? 60_000, 10_000));
  return client.$transaction(async (tx) => {
    const users = await tx.$queryRaw<Array<{ authUserId: number }>>(Prisma.sql`
      SELECT step."authUserId"
      FROM "CanvasRunStep" step
      WHERE step."status" = 'queued' AND step."nextRetryAt" <= ${now}
        AND EXISTS (SELECT 1 FROM "CanvasRun" run WHERE run."id" = step."runId" AND run."status" IN ('queued', 'running'))
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(step."dependencies") dependency_key
          LEFT JOIN "CanvasRunStep" dependency
            ON dependency."runId" = step."runId" AND dependency."stepKey" = dependency_key
          WHERE dependency."id" IS NULL OR dependency."status" <> 'success'
        )
      GROUP BY step."authUserId"
      ORDER BY MAX(step."priority") DESC, MIN(step."createdAt") ASC
      LIMIT ${limit}
    `);
    const claimed: ClaimedCanvasRunStep[] = [];
    for (const user of users) {
      const rows = await tx.$queryRaw<ClaimedCanvasRunStep[]>(Prisma.sql`
        UPDATE "CanvasRunStep" step
        SET "status" = 'leased', "leaseOwner" = ${input.workerId}, "leaseUntil" = ${leaseUntil},
            "attempts" = "attempts" + 1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE step."id" = (
          SELECT candidate."id" FROM "CanvasRunStep" candidate
          WHERE candidate."authUserId" = ${user.authUserId}
            AND candidate."status" = 'queued' AND candidate."nextRetryAt" <= ${now}
            AND EXISTS (SELECT 1 FROM "CanvasRun" run WHERE run."id" = candidate."runId" AND run."status" IN ('queued', 'running'))
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(candidate."dependencies") dependency_key
              LEFT JOIN "CanvasRunStep" dependency
                ON dependency."runId" = candidate."runId" AND dependency."stepKey" = dependency_key
              WHERE dependency."id" IS NULL OR dependency."status" <> 'success'
            )
          ORDER BY (candidate."priority" + FLOOR(EXTRACT(EPOCH FROM (${now} - candidate."createdAt")) / 3600)) DESC,
                   candidate."createdAt" ASC
          LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING step."id", step."runId", step."authUserId", step."nodeId", step."nodeKind",
                  (SELECT run."canvasId" FROM "CanvasRun" run WHERE run."id" = step."runId") AS "canvasId",
                  step."status", step."requestKey"::text AS "requestKey", step."input", step."provider", step."attempts"
      `);
      if (rows[0]) claimed.push(rows[0]);
    }
    if (claimed.length) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "CanvasRun" SET "status" = 'running', "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" IN (${Prisma.join([...new Set(claimed.map((step) => step.runId))])}) AND "status" = 'queued'
      `);
    }
    return claimed;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5000,
    timeout: 15000,
  });
}

export async function beginCanvasRunStepSubmission(client: PrismaClient, input: { stepId: bigint; workerId: string; leaseUntil: Date }) {
  const updated = await client.$executeRaw(Prisma.sql`
    UPDATE "CanvasRunStep" SET "status" = 'submitting', "leaseUntil" = ${input.leaseUntil}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.stepId} AND "status" = 'leased' AND "leaseOwner" = ${input.workerId}
  `);
  if (updated !== 1) throw new CanvasRunQueueError("RUN_STEP_LEASE_LOST", "run step lease was lost");
}

export async function markCanvasRunStepWaiting(
  client: PrismaClient,
  input: { stepId: bigint; workerId: string; provider: string; providerRequestId: string; leaseUntil: Date },
) {
  const updated = await client.$executeRaw(Prisma.sql`
    UPDATE "CanvasRunStep" SET "status" = 'waiting_provider', "provider" = ${input.provider},
      "providerRequestId" = ${input.providerRequestId}, "submittedAt" = CURRENT_TIMESTAMP,
      "leaseUntil" = ${input.leaseUntil}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.stepId} AND "status" = 'submitting' AND "leaseOwner" = ${input.workerId}
  `);
  if (updated !== 1) throw new CanvasRunQueueError("RUN_STEP_LEASE_LOST", "run step lease was lost after submission");
}

export async function claimCanvasRunStepsForPolling(
  client: PrismaClient,
  input: { workerId: string; limit?: number; now?: Date; leaseMs?: number },
): Promise<ClaimedCanvasRunStep[]> {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 20), 1), 100);
  const now = input.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + Math.max(input.leaseMs ?? 30_000, 10_000));
  return client.$queryRaw<ClaimedCanvasRunStep[]>(Prisma.sql`
    UPDATE "CanvasRunStep" step
    SET "leaseOwner" = ${input.workerId}, "leaseUntil" = ${leaseUntil}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE step."id" IN (
      SELECT candidate."id" FROM "CanvasRunStep" candidate
      WHERE candidate."status" IN ('waiting_provider', 'applying')
        AND (candidate."leaseUntil" IS NULL OR candidate."leaseUntil" <= ${now})
        AND EXISTS (SELECT 1 FROM "CanvasRun" run WHERE run."id" = candidate."runId" AND run."status" = 'running')
      ORDER BY candidate."updatedAt" ASC
      LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    RETURNING step."id", step."runId", step."authUserId", step."nodeId", step."nodeKind",
              step."status", step."requestKey"::text AS "requestKey", step."input", step."provider",
              step."providerRequestId", step."attempts"
  `);
}

export async function markCanvasRunStepApplying(
  client: PrismaClient,
  input: { stepId: bigint; workerId: string; leaseUntil: Date },
) {
  const updated = await client.$executeRaw(Prisma.sql`
    UPDATE "CanvasRunStep" SET "status" = 'applying', "leaseUntil" = ${input.leaseUntil}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.stepId} AND "status" = 'waiting_provider' AND "leaseOwner" = ${input.workerId}
  `);
  if (updated !== 1) throw new CanvasRunQueueError("RUN_STEP_LEASE_LOST", "run step lease was lost before applying");
}

export async function recordCanvasRunStepOutput(
  client: PrismaClient,
  input: {
    stepId: bigint;
    workerId: string;
    outputSlot: string;
    payload: unknown;
    mediaId?: string;
    generationId?: number;
    leaseUntil: Date;
  },
) {
  const payloadHash = hashCanvasMutationPayload(input.payload);
  return client.$transaction(async (tx) => {
    const existing = await tx.$queryRaw<Array<{ payloadHash: string }>>(Prisma.sql`
      SELECT "payloadHash" FROM "CanvasRunOutput"
      WHERE "runStepId" = ${input.stepId} AND "outputSlot" = ${input.outputSlot}
      LIMIT 1 FOR UPDATE
    `);
    if (existing[0] && existing[0].payloadHash !== payloadHash) {
      throw new CanvasRunQueueError("RUN_OUTPUT_SLOT_REUSED", "run output slot contains different data");
    }
    if (!existing[0]) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "CanvasRunOutput" (
          "runStepId", "outputSlot", "mediaId", "generationId", "payload", "payloadHash", "createdAt"
        ) VALUES (
          ${input.stepId}, ${input.outputSlot}, ${input.mediaId ? Prisma.sql`${input.mediaId}::uuid` : null},
          ${input.generationId ?? null}, ${JSON.stringify(input.payload)}::jsonb, ${payloadHash}, CURRENT_TIMESTAMP
        )
      `);
    }
    const updated = await tx.$executeRaw(Prisma.sql`
      UPDATE "CanvasRunStep" SET "status" = 'applying', "leaseUntil" = ${input.leaseUntil}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.stepId} AND "status" IN ('submitting', 'waiting_provider', 'applying')
        AND "leaseOwner" = ${input.workerId}
    `);
    if (updated !== 1) throw new CanvasRunQueueError("RUN_STEP_LEASE_LOST", "run step lease was lost before output application");
    return { payloadHash, idempotent: Boolean(existing[0]) };
  });
}

export async function readCanvasRunStepOutput(client: PrismaClient, stepId: bigint, outputSlot = "default") {
  const rows = await client.$queryRaw<Array<{ payload: unknown; mediaId: string | null; generationId: number | null }>>(Prisma.sql`
    SELECT "payload", "mediaId"::text AS "mediaId", "generationId" FROM "CanvasRunOutput"
    WHERE "runStepId" = ${stepId} AND "outputSlot" = ${outputSlot} LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function releaseCanvasRunStepPollingLease(client: PrismaClient, input: { stepId: bigint; workerId: string }) {
  await client.$executeRaw(Prisma.sql`
    UPDATE "CanvasRunStep" SET "leaseOwner" = NULL, "leaseUntil" = NULL, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.stepId} AND "status" = 'waiting_provider' AND "leaseOwner" = ${input.workerId}
  `);
}

export async function markCanvasRunStepFailed(
  client: PrismaClient,
  input: { stepId: bigint; workerId: string; errorCode: string; errorMessage: string; submissionUnknown?: boolean },
) {
  const status = input.submissionUnknown ? "submission_unknown" : "failed";
  await client.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ runId: number }>>(Prisma.sql`
      UPDATE "CanvasRunStep" SET "status" = ${status}, "errorCode" = ${input.errorCode},
        "errorMessage" = ${input.errorMessage.slice(0, 4000)}, "leaseOwner" = NULL, "leaseUntil" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.stepId} AND "status" IN ('leased', 'submitting', 'waiting_provider', 'applying')
        AND "leaseOwner" = ${input.workerId}
      RETURNING "runId"
    `);
    if (!rows[0]) throw new CanvasRunQueueError("RUN_STEP_LEASE_LOST", "run step lease was lost while failing");
    if (input.submissionUnknown) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "CanvasRun" SET "status" = 'submission_unknown', "finishedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${rows[0].runId} AND "status" NOT IN ('success', 'cancelled')
      `);
      return;
    }
    await tx.$executeRaw(Prisma.sql`
      UPDATE "CanvasRunStep" SET "status" = CASE
        WHEN "status" IN ('queued', 'retry_wait', 'leased') THEN 'cancelled'
        ELSE 'cancel_requested'
      END, "leaseOwner" = NULL, "leaseUntil" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "runId" = ${rows[0].runId} AND "id" <> ${input.stepId}
        AND "status" NOT IN ('success', 'failed', 'cancelled', 'submission_unknown')
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "CanvasRun" SET "status" = 'failed', "finishedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${rows[0].runId} AND "status" NOT IN ('success', 'cancelled')
    `);
  });
}

export async function cancelCanvasRun(client: PrismaClient, input: { runId: number; authUserId: number }) {
  return client.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: number; status: string }>>(Prisma.sql`
      SELECT "id", "status" FROM "CanvasRun" WHERE "id" = ${input.runId} AND "authUserId" = ${input.authUserId}
      LIMIT 1 FOR UPDATE
    `);
    const run = rows[0];
    if (!run) throw new CanvasRunQueueError("RUN_NOT_FOUND", "run not found", 404);
    if (["success", "failed", "cancelled"].includes(run.status)) return { id: run.id, status: run.status, idempotent: true };
    await tx.$executeRaw(Prisma.sql`
      UPDATE "CanvasRunStep" SET "status" = CASE
        WHEN "status" IN ('queued', 'retry_wait', 'leased', 'submission_unknown') THEN 'cancelled'
        ELSE 'cancel_requested'
      END, "leaseOwner" = NULL, "leaseUntil" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "runId" = ${run.id} AND "status" NOT IN ('success', 'failed', 'cancelled')
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "CanvasRun" SET "status" = 'cancelled', "finishedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${run.id}
    `);
    return { id: run.id, status: "cancelled", idempotent: false };
  });
}

export type CanvasSubmissionReconciliationDecision = "retry_not_submitted" | "attach_provider_request" | "fail";

export async function reconcileCanvasSubmissionUnknown(client: PrismaClient, input: {
  stepId: bigint;
  decision: CanvasSubmissionReconciliationDecision;
  operator: string;
  provider?: string;
  providerRequestId?: string;
  note?: string;
}) {
  if (input.decision === "attach_provider_request" && (!input.provider || !input.providerRequestId)) {
    throw new CanvasRunQueueError("RECONCILIATION_PROVIDER_REQUIRED", "provider and provider request ID are required", 400);
  }
  return client.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: bigint; runId: number; nodeId: string; status: string }>>(Prisma.sql`
      SELECT step."id", step."runId", step."nodeId", step."status"
      FROM "CanvasRunStep" step
      JOIN "CanvasRun" run ON run."id" = step."runId"
      WHERE step."id" = ${input.stepId}
      LIMIT 1 FOR UPDATE OF step, run
    `);
    const step = rows[0];
    if (!step) throw new CanvasRunQueueError("RUN_STEP_NOT_FOUND", "run step not found", 404);
    if (step.status !== "submission_unknown") {
      throw new CanvasRunQueueError("RUN_STEP_NOT_SUBMISSION_UNKNOWN", `run step is ${step.status}`);
    }
    if (input.decision === "retry_not_submitted") {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "CanvasRunStep" SET "status" = 'queued', "providerRequestId" = NULL,
          "errorCode" = NULL, "errorMessage" = NULL, "nextRetryAt" = CURRENT_TIMESTAMP,
          "leaseOwner" = NULL, "leaseUntil" = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${step.id} AND "status" = 'submission_unknown'
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "CanvasRun" SET "status" = 'running', "finishedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${step.runId}
      `);
    } else if (input.decision === "attach_provider_request") {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "CanvasRunStep" SET "status" = 'waiting_provider', "provider" = ${input.provider!},
          "providerRequestId" = ${input.providerRequestId!}, "submittedAt" = COALESCE("submittedAt", CURRENT_TIMESTAMP),
          "errorCode" = NULL, "errorMessage" = NULL, "leaseOwner" = NULL, "leaseUntil" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${step.id} AND "status" = 'submission_unknown'
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "CanvasRun" SET "status" = 'running', "finishedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${step.runId}
      `);
    } else {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "CanvasRunStep" SET "status" = 'failed', "errorCode" = 'SUBMISSION_RECONCILED_FAILED',
          "errorMessage" = ${String(input.note || "operator confirmed provider submission failure").slice(0, 4000)},
          "leaseOwner" = NULL, "leaseUntil" = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${step.id} AND "status" = 'submission_unknown'
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "CanvasRunStep" SET "status" = CASE
          WHEN "status" IN ('queued', 'retry_wait', 'leased') THEN 'cancelled' ELSE 'cancel_requested' END,
          "leaseOwner" = NULL, "leaseUntil" = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "runId" = ${step.runId} AND "id" <> ${step.id}
          AND "status" NOT IN ('success', 'failed', 'cancelled')
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "CanvasRun" SET "status" = 'failed', "finishedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${step.runId}
      `);
    }
    const auditEntry = [{
      at: new Date().toISOString(),
      nodeId: step.nodeId,
      message: `submission reconciliation: ${input.decision}`,
      operator: input.operator.slice(0, 200),
      note: String(input.note || "").slice(0, 1000),
    }];
    await tx.$executeRaw(Prisma.sql`
      UPDATE "CanvasRun" SET "state" = jsonb_set(
        COALESCE("state", '{}'::jsonb), '{logs}',
        COALESCE("state"->'logs', '[]'::jsonb) || ${JSON.stringify(auditEntry)}::jsonb, true
      ), "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${step.runId}
    `);
    return { stepId: step.id.toString(), runId: step.runId, decision: input.decision };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
}

export async function getCanvasRunDetail(client: PrismaClient, input: { runId: number; authUserId: number }) {
  const runs = await client.$queryRaw<Array<{
    id: number; canvasId: number; status: string; graphRevision64: bigint; state: unknown;
    queuedAt: Date; startedAt: Date; updatedAt: Date; finishedAt: Date | null;
  }>>(Prisma.sql`
    SELECT "id", "canvasId", "status", "graphRevision64", "state", "queuedAt", "startedAt", "updatedAt", "finishedAt"
    FROM "CanvasRun" WHERE "id" = ${input.runId} AND "authUserId" = ${input.authUserId} LIMIT 1
  `);
  if (!runs[0]) throw new CanvasRunQueueError("RUN_NOT_FOUND", "run not found", 404);
  const steps = await client.$queryRaw<Array<{
    id: bigint; nodeId: string; nodeKind: string; status: string; attempts: number; errorCode: string | null;
    errorMessage: string | null; submittedAt: Date | null; appliedAt: Date | null; updatedAt: Date;
  }>>(Prisma.sql`
    SELECT "id", "nodeId", "nodeKind", "status", "attempts", "errorCode", "errorMessage", "submittedAt", "appliedAt", "updatedAt"
    FROM "CanvasRunStep" WHERE "runId" = ${input.runId} ORDER BY "id" ASC
  `);
  return {
    ...runs[0],
    graphRevision64: runs[0].graphRevision64.toString(),
    steps: steps.map((step) => ({ ...step, id: step.id.toString() })),
  };
}

export async function completeCanvasRunStep(
  client: PrismaClient,
  input: {
    stepId: bigint;
    workerId: string;
    outputSlot: string;
    payload: unknown;
    mediaId?: string;
    generationId?: number;
  },
) {
  const payloadHash = hashCanvasMutationPayload(input.payload);
  return client.$transaction(async (tx) => {
    const existing = await tx.$queryRaw<Array<{ payloadHash: string }>>(Prisma.sql`
      SELECT "payloadHash" FROM "CanvasRunOutput"
      WHERE "runStepId" = ${input.stepId} AND "outputSlot" = ${input.outputSlot}
      LIMIT 1
    `);
    if (existing[0] && existing[0].payloadHash !== payloadHash) {
      throw new CanvasRunQueueError("RUN_OUTPUT_SLOT_REUSED", "run output slot contains different data");
    }
    if (!existing[0]) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "CanvasRunOutput" (
          "runStepId", "outputSlot", "mediaId", "generationId", "payload", "payloadHash", "createdAt"
        ) VALUES (
          ${input.stepId}, ${input.outputSlot}, ${input.mediaId ? Prisma.sql`${input.mediaId}::uuid` : null},
          ${input.generationId ?? null}, ${JSON.stringify(input.payload)}::jsonb, ${payloadHash}, CURRENT_TIMESTAMP
        )
      `);
    }
    const rows = await tx.$queryRaw<Array<{ runId: number }>>(Prisma.sql`
      UPDATE "CanvasRunStep" SET "status" = 'success', "appliedAt" = CURRENT_TIMESTAMP,
        "leaseOwner" = NULL, "leaseUntil" = NULL, "errorCode" = NULL, "errorMessage" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.stepId} AND "status" IN ('submitting', 'waiting_provider', 'applying', 'submission_unknown')
        AND ("leaseOwner" = ${input.workerId} OR "status" = 'submission_unknown')
      RETURNING "runId"
    `);
    if (rows[0]) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "CanvasRun" run SET "status" = 'success', "finishedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE run."id" = ${rows[0].runId}
          AND NOT EXISTS (SELECT 1 FROM "CanvasRunStep" step WHERE step."runId" = run."id" AND step."status" <> 'success')
      `);
    }
    return { idempotent: Boolean(existing[0]), payloadHash };
  });
}
