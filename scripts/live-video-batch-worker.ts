import { randomUUID } from "node:crypto";
import nextEnv, * as nextEnvNamespace from "@next/env";
import { prepareRuntime } from "./lib/runtime-isolation.cjs";
import { installRuntimeBoundaries } from "./lib/runtime-boundaries.cjs";
import { LIVE_VIDEO_BATCH_MAX_MEDIA } from "@/lib/live-video-batch/contracts";

const { loadEnvConfig } = nextEnv || nextEnvNamespace;
process.env.INKVIA_RUNTIME_PROFILE ||= "local";
loadEnvConfig(process.cwd(), process.env.INKVIA_RUNTIME_PROFILE === "local");

const roleArg = process.argv.find((argument) => argument.startsWith("--role="));
const role = roleArg?.slice("--role=".length) || "";
if (role !== "prompt" && role !== "video") {
  throw new Error("live-video-batch-worker requires --role=prompt or --role=video");
}

const workerId = `inkvia-live-video-${role}-worker:${process.pid}:${randomUUID()}`;
const concurrency = role === "prompt"
  ? Math.max(1, Math.min(
    LIVE_VIDEO_BATCH_MAX_MEDIA,
    Number(process.env.LIVE_VIDEO_PROMPT_CONCURRENCY) || LIVE_VIDEO_BATCH_MAX_MEDIA,
  ))
  : Math.max(1, Math.min(
    LIVE_VIDEO_BATCH_MAX_MEDIA,
    Number(process.env.LIVE_VIDEO_VIDEO_CONCURRENCY) || LIVE_VIDEO_BATCH_MAX_MEDIA,
  ));
const idleMs = Math.max(250, Number(process.env.LIVE_VIDEO_WORKER_IDLE_MS) || 500);
let stopping = false;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await prepareRuntime();
  installRuntimeBoundaries();
  const runIteration = role === "prompt"
    ? (await import("@/lib/live-video-batch/prompt-worker")).runLiveVideoPromptWorkerIteration
    : (await import("@/lib/live-video-batch/video-worker")).runLiveVideoVideoWorkerIteration;
  console.log(`[live-video-${role}-worker] started ${workerId} concurrency=${concurrency}`);
  let consecutiveFailures = 0;
  while (!stopping) {
    try {
      const processed = await runIteration(workerId, concurrency);
      consecutiveFailures = 0;
      if (!processed) await wait(idleMs);
    } catch (error) {
      consecutiveFailures += 1;
      console.error(`[live-video-${role}-worker] iteration failed`, error);
      if (consecutiveFailures >= 3) throw error;
      await wait(Math.max(idleMs, 3000));
    }
  }
  console.log(`[live-video-${role}-worker] stopped`);
}

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

void main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`[live-video-${role}-worker] fatal`, error);
    process.exit(1);
  });
