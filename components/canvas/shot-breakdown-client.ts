"use client";

import type { BreakdownEvent } from "@/lib/canvas/shot-breakdown/types";

const ENDPOINT = "/api/canvas/shot-breakdown";

/** The job no longer exists on the server (finished long ago, or the server restarted). */
export class BreakdownJobGoneError extends Error {}

/** Reads the newline-delimited event stream; resolves true once the job finished or failed. */
async function readEvents(response: Response, onEvent: (event: BreakdownEvent) => void) {
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    if (payload?.code === "BREAKDOWN_JOB_NOT_FOUND") throw new BreakdownJobGoneError(payload.error || "拉片任务已结束");
    throw new Error(payload?.error || `拉片请求失败（${response.status}）`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let finished = false;
  const flush = (line: string) => {
    if (!line.trim()) return;
    let event: BreakdownEvent;
    try { event = JSON.parse(line) as BreakdownEvent; } catch { return; }
    if (event.type === "done" || event.type === "error") finished = true;
    onEvent(event);
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      flush(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  flush(buffer);
  return finished;
}

/** Starts a background 拉片 job and follows it; the first event carries its job id. */
export async function streamCanvasShotBreakdown(input: {
  canvasId: number;
  sessionId: string;
  videoUrl: string;
  providerId: string;
  modelId: string;
  signal?: AbortSignal;
  onEvent: (event: BreakdownEvent) => void;
}) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    signal: input.signal,
    headers: {
      "Content-Type": "application/json",
      "X-Canvas-Id": String(input.canvasId),
      "X-Canvas-Session-Id": input.sessionId,
    },
    body: JSON.stringify({ videoUrl: input.videoUrl, providerId: input.providerId, modelId: input.modelId }),
  });
  return readEvents(response, input.onEvent);
}

/** Reconnects to a running job: current state first, then live progress. */
export async function followCanvasShotBreakdown(input: { jobId: string; signal?: AbortSignal; onEvent: (event: BreakdownEvent) => void }) {
  const response = await fetch(`${ENDPOINT}?jobId=${encodeURIComponent(input.jobId)}`, { signal: input.signal, cache: "no-store" });
  return readEvents(response, input.onEvent);
}

export async function cancelCanvasShotBreakdown(jobId: string) {
  await fetch(`${ENDPOINT}?jobId=${encodeURIComponent(jobId)}`, { method: "DELETE" }).catch(() => undefined);
}
