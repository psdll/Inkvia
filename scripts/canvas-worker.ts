import crypto from "node:crypto";
import os from "node:os";
import nextEnv, * as nextEnvNamespace from "@next/env";
import { prepareRuntime } from "../scripts/lib/runtime-isolation.cjs";
import { installRuntimeBoundaries } from "../scripts/lib/runtime-boundaries.cjs";

const { loadEnvConfig } = nextEnv || nextEnvNamespace;

process.env.INKVIA_RUNTIME_PROFILE ||= "local";
loadEnvConfig(process.cwd(), process.env.INKVIA_RUNTIME_PROFILE === "local");

async function main() {
const roleArg = process.argv.find((argument) => argument.startsWith("--role="));
const role = String(roleArg?.split("=")[1] || process.env.CANVAS_WORKER_ROLE || "all");
if (!["all", "generation", "media"].includes(role)) throw new Error(`invalid canvas worker role: ${role}`);
await prepareRuntime();
installRuntimeBoundaries();
const workerId = String(process.env.CANVAS_WORKER_ID || `${os.hostname()}:${process.pid}:${role}:${crypto.randomUUID().slice(0, 8)}`);
const intervalMs = Math.max(500, Number(process.env.CANVAS_WORKER_INTERVAL_MS) || 2_000);
const idleLogIntervalMs = Math.max(
  0,
  Number(process.env.CANVAS_WORKER_IDLE_LOG_MS) || 0,
);
let lastWorkerLogAt = 0;

function hasPositiveNumber(value: unknown): boolean {
  if (typeof value === "number") return value > 0;
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(hasPositiveNumber);
}

const { startNodeTracing, withMonitoringSpan } = await import("@/lib/monitoring/tracing");
const serviceName = role === "generation"
  ? "inkvia-canvas-generation-worker"
  : role === "media"
    ? "inkvia-canvas-media-worker"
    : "inkvia-canvas-worker";
const stopTracing = startNodeTracing(serviceName);
const [{ Prisma }, { default: prisma }, { runCanvasWorkerBatch }, { purgeExpiredCanvasTrashBatch }, { runCanvasMediaGcBatch }, { runToolMediaRelayMaintenanceBatch }, { purgeExpiredSystemRoleSkills }, snapshots] = await Promise.all([
  import("@prisma/client"),
  import("@/lib/prisma"),
  import("@/lib/canvas/run-worker"),
  import("@/lib/canvas/trash-retention"),
  import("@/lib/canvas/media-gc"),
  import("@/lib/tool-media/maintenance"),
  import("@/lib/role-skills/repository"),
  import("@/lib/canvas/snapshot-compactor"),
]);
let stopping = false;
let failures = 0;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function compactSnapshots() {
  const candidates = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT "id" FROM "Canvas" WHERE "deletedAt" IS NULL AND "projectionRevision" = "revision64"
      AND "snapshotRevision" < "revision64"
      AND ("revision64" - "snapshotRevision" >= 100 OR "updatedAt" < CURRENT_TIMESTAMP - INTERVAL '5 minutes')
    ORDER BY ("revision64" - "snapshotRevision") DESC, "updatedAt" ASC LIMIT 2
  `);
  for (const candidate of candidates) {
    await snapshots.compactCanvasSnapshot(prisma, candidate.id);
    await snapshots.pruneCanvasSnapshots(prisma, candidate.id, 3);
  }
  return candidates.length;
}

async function tick() {
  return withMonitoringSpan("canvas.worker.tick", {
    "worker.role": role,
    "operation.type": "batch",
  }, async () => {
  const generation = role === "media" ? null : await runCanvasWorkerBatch({ workerId, limit: 20 });
  const trashCleanup = role === "generation" ? null : await purgeExpiredCanvasTrashBatch(prisma, { limit: 20 });
  const gc = role === "generation" ? null : await runCanvasMediaGcBatch(prisma, { workerId: `${workerId}:gc`, limit: 25 });
  const toolMediaRelay = role === "generation" ? null : await runToolMediaRelayMaintenanceBatch(prisma, { workerId: `${workerId}:tool-relay`, limit: 25 });
  const systemSkillCleanup = role === "generation" ? null : await purgeExpiredSystemRoleSkills({ limit: 20 });
  const compacted = role === "media" ? 0 : await compactSnapshots();
  const successAt = new Date().toISOString();
  await prisma.appSetting.upsert({
    where: { key: `canvas_worker_heartbeat_${role}` },
    create: { key: `canvas_worker_heartbeat_${role}`, value: JSON.stringify({ workerId, role, successAt }) },
    update: { value: JSON.stringify({ workerId, role, successAt }) },
  });
  const payload = { at: successAt, workerId, role, generation, trashCleanup, gc, toolMediaRelay, systemSkillCleanup, compacted };
  const result = { generation, trashCleanup, gc, toolMediaRelay, systemSkillCleanup, compacted };
  const now = Date.now();
  if (
    idleLogIntervalMs === 0
    || hasPositiveNumber(result)
    || now - lastWorkerLogAt >= idleLogIntervalMs
  ) {
    lastWorkerLogAt = now;
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }
  });
}

try {
  while (!stopping) {
    try {
      await tick();
      failures = 0;
    } catch (error) {
      failures += 1;
      process.stderr.write(`[canvas-worker:${role}] ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    }
    if (stopping) break;
    const delay = Math.min(intervalMs * Math.max(1, 2 ** Math.min(failures, 5)), 60_000);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
} finally {
  await prisma.$disconnect();
  await stopTracing();
}
}

void main().catch((error) => {
  process.stderr.write(`[canvas-worker] ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
