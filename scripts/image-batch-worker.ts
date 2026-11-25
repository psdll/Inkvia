import { randomUUID } from "node:crypto";
import nextEnv, * as nextEnvNamespace from "@next/env";
import { prepareRuntime } from "./lib/runtime-isolation.cjs";
import { installRuntimeBoundaries } from "./lib/runtime-boundaries.cjs";

const { loadEnvConfig } = nextEnv || nextEnvNamespace;

process.env.INKVIA_RUNTIME_PROFILE ||= "local";
loadEnvConfig(process.cwd(), process.env.INKVIA_RUNTIME_PROFILE === "local");

const workerId = `inkvia-image-batch-worker:${process.pid}:${randomUUID()}`;
const concurrency = Math.max(
  1,
  Math.min(20, Number(process.env.IMAGE_BATCH_WORKER_CONCURRENCY) || 20),
);
const groupConcurrency = Math.max(
  1,
  Math.min(8, Number(process.env.IMAGE_BATCH_WORKER_GROUP_CONCURRENCY) || 2),
);
const idleMs = Math.max(250, Number(process.env.IMAGE_BATCH_WORKER_IDLE_MS) || 500);
const maxConsecutiveFailures = 3;
let stopping = false;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLane(
  laneIndex: number,
  runImageBatchWorkerIteration: typeof import("@/lib/image-batch/worker").runImageBatchWorkerIteration,
) {
  const laneWorkerId = `${workerId}:lane-${laneIndex + 1}`;
  let consecutiveFailures = 0;
  while (!stopping) {
    try {
      const processed = await runImageBatchWorkerIteration(laneWorkerId, concurrency);
      consecutiveFailures = 0;
      if (!processed) await wait(idleMs);
    } catch (error) {
      consecutiveFailures += 1;
      console.error(`[image-batch-worker] lane ${laneIndex + 1} iteration failed`, error);
      if (consecutiveFailures >= maxConsecutiveFailures) throw error;
      await wait(Math.max(idleMs, 3000));
    }
  }
}

async function main() {
  await prepareRuntime();
  installRuntimeBoundaries();
  const { runImageBatchWorkerIteration } = await import("@/lib/image-batch/worker");
  console.log(
    `[image-batch-worker] started ${workerId} groupConcurrency=${groupConcurrency} pollConcurrency=${concurrency}`,
  );
  await Promise.all(
    Array.from({ length: groupConcurrency }, (_, laneIndex) => (
      runLane(laneIndex, runImageBatchWorkerIteration)
    )),
  );
  console.log("[image-batch-worker] stopped");
}

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

void main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[image-batch-worker] fatal", error);
    process.exit(1);
  });
