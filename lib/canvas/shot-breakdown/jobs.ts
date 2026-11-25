import "server-only";

import { randomUUID } from "node:crypto";
import { getPublicLlmError } from "@/lib/llm-routing/gateway";
import { runShotBreakdown, ShotBreakdownError } from "./server";
import type { BreakdownEvent } from "./types";

/**
 * 拉片 runs as a background job that outlives the request: refreshing or closing the
 * page only drops the live connection. The job keeps its latest state, not a full event
 * log (a long film would be tens of MB), so a returning page gets one snapshot and then
 * the live tail.
 */
type Listener = (event: BreakdownEvent) => void;
type Job = {
  id: string;
  userId: number;
  controller: AbortController;
  latest: Partial<Record<"video" | "shots" | "overview" | "segments" | "audio" | "stage", BreakdownEvent>>;
  warnings: BreakdownEvent[];
  terminal?: BreakdownEvent;
  listeners: Set<Listener>;
};

/** Finished jobs stay readable this long so a page reopened later still gets its result. */
const RETAIN_MS = 6 * 60 * 60_000;
// Survives dev hot reloads, which would otherwise orphan running jobs.
const jobs: Map<string, Job> = ((globalThis as { __canvasBreakdownJobs?: Map<string, Job> }).__canvasBreakdownJobs ??= new Map());

function record(job: Job, event: BreakdownEvent) {
  if (event.type === "ping" || event.type === "job") return;
  if (event.type === "warning") job.warnings.push(event);
  else if (event.type === "done" || event.type === "error") job.terminal = event;
  else job.latest[event.type] = event;
  for (const listener of job.listeners) listener(event);
}

export function startBreakdownJob(input: { authUserId: number; videoUrl: string; providerId: string; modelId: string }) {
  const job: Job = { id: randomUUID(), userId: input.authUserId, controller: new AbortController(), latest: {}, warnings: [], listeners: new Set() };
  jobs.set(job.id, job);
  void runShotBreakdown({ ...input, signal: job.controller.signal, emit: event => record(job, event) })
    .catch(error => {
      const message = job.controller.signal.aborted ? "已取消拉片"
        : error instanceof ShotBreakdownError ? error.message : getPublicLlmError(error);
      record(job, { type: "error", error: message || "拉片失败，请稍后重试" });
    })
    .finally(() => {
      if (!job.terminal) record(job, { type: "error", error: "拉片意外中断，可重新拉片" });
      setTimeout(() => jobs.delete(job.id), RETAIN_MS).unref?.();
    });
  return job;
}

export function findBreakdownJob(id: string, userId: number) {
  const job = jobs.get(id);
  return job && job.userId === userId ? job : null;
}

export function cancelBreakdownJob(job: Job) {
  job.controller.abort();
}

/** Current state first, then live events; returns an unsubscribe. */
export function followBreakdownJob(job: Job, listener: Listener) {
  const { video, shots, overview, segments, audio, stage } = job.latest;
  for (const event of [video, shots, overview, segments, audio, ...job.warnings, stage]) if (event) listener(event);
  if (job.terminal) {
    listener(job.terminal);
    return () => undefined;
  }
  job.listeners.add(listener);
  return () => { job.listeners.delete(listener); };
}
