import type { CanvasBreakdownData } from "@/lib/canvas/document";
import { getLlmModelModalities } from "@/lib/llm-routing/model-modalities";
import type { BreakdownEvent } from "./types";

/** Best video-understanding models first; anything else that accepts video follows. */
const PREFERRED_BREAKDOWN_MODELS = ["doubao-seed-evolving", "qwen3.8-max", "glm-5.3-flash", "qwen3.8-omni-flash", "MiniMax-M3", "qwen3.8-flash"];

export function listBreakdownModels<T extends { providerId: string; modelId: string }>(models: readonly T[]): T[] {
  const capable = models.filter(model => getLlmModelModalities(model.providerId, model.modelId)?.input.includes("video"));
  const rank = (model: T) => {
    const index = PREFERRED_BREAKDOWN_MODELS.indexOf(model.modelId);
    return index < 0 ? PREFERRED_BREAKDOWN_MODELS.length : index;
  };
  return [...capable].sort((a, b) => rank(a) - rank(b));
}

export function createBreakdownData(input: {
  sourceNodeId: string; sourceUrl: string; sourceName: string; providerId: string; model: string; now?: number;
}): CanvasBreakdownData {
  return {
    kind: "breakdown",
    title: `${input.sourceName} · 拉片`,
    sourceNodeId: input.sourceNodeId,
    sourceUrl: input.sourceUrl,
    sourceName: input.sourceName,
    providerId: input.providerId,
    model: input.model,
    status: "running",
    stage: "queued",
    progress: 0,
    message: "准备拉片",
    startedAt: input.now ?? Date.now(),
    shots: [],
    segments: [],
  };
}

/** Resets a finished or failed breakdown for another run, keeping where it sits on the canvas. */
export function restartBreakdownData(data: CanvasBreakdownData, model: { providerId: string; model: string }, now = Date.now()): CanvasBreakdownData {
  return {
    ...createBreakdownData({ sourceNodeId: data.sourceNodeId ?? "", sourceUrl: data.sourceUrl, sourceName: data.sourceName ?? "视频", providerId: model.providerId, model: model.model, now }),
    title: data.title,
    sourceNodeId: data.sourceNodeId,
  };
}

export function applyBreakdownEvent(data: CanvasBreakdownData, event: BreakdownEvent, now = Date.now()): CanvasBreakdownData {
  switch (event.type) {
    case "stage":
      return {
        ...data,
        stage: event.stage,
        progress: Math.max(data.progress ?? 0, event.progress),
        message: event.message,
        ...(event.stage === "done" ? { status: "success" as const, finishedAt: now, error: undefined } : {}),
      };
    case "video": return { ...data, video: event.video };
    case "shots": return { ...data, shots: event.shots };
    // The shots step starts the moment the overview lands; don't wait for its stage tick.
    case "overview": return data.stage === "overview"
      ? { ...data, overview: event.overview, stage: "shots", progress: Math.max(data.progress ?? 0, 0.4) }
      : { ...data, overview: event.overview };
    case "segments": return { ...data, segments: event.segments };
    // A reconnecting page receives earlier warnings again; keep each once.
    case "warning": return data.warnings?.includes(event.message) ? data : { ...data, warnings: [...(data.warnings ?? []), event.message].slice(-8) };
    case "job": return { ...data, jobId: event.jobId };
    case "audio": return { ...data, audio: event.audio };
    case "done": return { ...data, status: "success", stage: "done", progress: 1, finishedAt: data.finishedAt ?? now, error: undefined };
    case "error": return { ...data, status: "failed", error: event.error, finishedAt: now };
    case "ping": return data;
  }
}

/** A breakdown left running by a closed tab can never finish; offer a retry instead. */
export function settleAbandonedBreakdown(data: CanvasBreakdownData, now = Date.now()): CanvasBreakdownData {
  if (data.status !== "running") return data;
  return { ...data, status: "failed", error: "拉片在页面关闭或刷新时中断，可重新拉片", finishedAt: now };
}
