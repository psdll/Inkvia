"use client";
import type { CanvasCreativeSettings, CreativeSelection, ImageAngle } from "@/lib/canvas/creative-presets/types";
import type { CanvasGenerationOutput } from "@/lib/canvas/generation-outputs";


function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type GenerationProgress = {
  generationId?: number;
  status: string;
  message?: string;
  elapsedMs?: number;
};

export const CANVAS_GENERATION_FOREGROUND_WAIT_MS = 30 * 60_000;
export const CANVAS_GENERATION_BACKGROUND_POLL_MS = 15_000;

export function canvasGenerationStatusText(elapsedSeconds?: number) {
  if (typeof elapsedSeconds === "number" && elapsedSeconds * 1_000 >= CANVAS_GENERATION_FOREGROUND_WAIT_MS) {
    return "仍在后台生成";
  }
  return `生成中${typeof elapsedSeconds === "number" ? ` ${elapsedSeconds}s` : ""}...`;
}

export function shouldResumeCanvasGeneration(input: {
  status?: string;
  generationId?: number;
  error?: string;
}) {
  if (!input.generationId) return false;
  if (input.status === "running" || input.status === "submitting") return true;
  return input.status === "failed" && String(input.error || "").trim() === "生成超时";
}

type RunImageGenOptions = CanvasCreativeSettings & {
  canvasId: number;
  sessionId: string;
  requestKey: string;
  model?: string;
  prompt: string;
  textList?: string[];
  aspectRatio?: string;
  resolution?: string;
  customSize?: string;
  quality?: string;
  gptImage25Mode?: string;
  background?: string;
  googleThinkingLevel?: string;
  googleSearchMode?: string;
  outputFormat?: string;
  gifSize?: string;
  frameCount?: number;
  frameDurationMs?: number; seedream55?: import("@/lib/apimart-seedream-55").Seedream55Settings;
  speed?: string;
  midjourneyOptions?: unknown;
  imagePaths?: string[];
  onProgress?: (progress: GenerationProgress) => void;
};

export type SubmittedImageGeneration = {
  generationId?: number;
  status: string;
  url?: string;
  outputs?: CanvasGenerationOutput[];
};

function isDoneStatus(status: string) {
  return ["success", "completed", "done", "succeeded"].includes(status);
}

function isFailedStatus(status: string) {
  return ["failed", "error", "cancelled", "canceled"].includes(status);
}

export async function waitForGenerationOutputs(
  generationId: number,
  onProgress?: (progress: GenerationProgress) => void,
  intervalMs = 2500,
  maxMs = CANVAS_GENERATION_FOREGROUND_WAIT_MS,
  shouldCancel?: () => boolean,
  backgroundPollMs = CANVAS_GENERATION_BACKGROUND_POLL_MS,
): Promise<CanvasGenerationOutput[]> {
  const startedAt = Date.now();
  let backgroundWait = false;

  while (true) {
    if (shouldCancel?.()) throw new Error("运行已取消");
    if (!backgroundWait && Date.now() - startedAt >= maxMs) {
      backgroundWait = true;
      onProgress?.({ generationId, status: "background", message: "仍在后台生成", elapsedMs: Date.now() - startedAt });
    }
    await sleep(backgroundWait ? backgroundPollMs : intervalMs);
    if (shouldCancel?.()) throw new Error("运行已取消");

    let payload: any = null;
    let permanentError: Error | null = null;
    try {
      const res = await fetch(`/api/canvas/generation/${generationId}`, { cache: "no-store" });
      payload = await res.json().catch(() => null);
      if ([400, 401, 403, 404, 410, 422].includes(res.status)) {
        permanentError = new Error(payload?.error || (res.status === 404 || res.status === 410 ? "生成任务已不存在" : "无法继续查询生成任务，请检查登录状态与权限"));
        throw permanentError;
      }
      if (!res.ok || payload?.success === false) throw new Error(payload?.error || "查询任务状态失败");
    } catch {
      if (permanentError) throw permanentError;
      onProgress?.({
        generationId,
        status: "retrying",
        message: "状态查询失败，继续重试",
        elapsedMs: Date.now() - startedAt,
      });
      continue;
    }

    const status = String(payload?.status || "running");

    if (isDoneStatus(status) && payload.url) return payload.outputs?.length
      ? payload.outputs : [{ url: String(payload.url), generationId }];
    if (isFailedStatus(status)) throw new Error(payload.error || "生成失败");
    onProgress?.({
      generationId,
      status: backgroundWait ? "background" : status,
      message: payload?.notice || (backgroundWait ? "仍在后台生成" : undefined),
      elapsedMs: Date.now() - startedAt,
    });
  }
}

export async function waitForGenerationResult(
  ...args: Parameters<typeof waitForGenerationOutputs>
): Promise<string> {
  return (await waitForGenerationOutputs(...args))[0].url;
}

export async function submitImageGen(opts: RunImageGenOptions): Promise<SubmittedImageGeneration> {
  const res = await fetch("/api/canvas/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Canvas-Id": String(opts.canvasId),
      "X-Canvas-Session-Id": opts.sessionId,
    },
    body: JSON.stringify({
      requestKey: opts.requestKey,
      model: opts.model,
      prompt: opts.prompt,
      creativePresets: opts.creativePresets,
      imageAngle: opts.imageAngle,
      textList: opts.textList,
      aspectRatio: opts.aspectRatio,
      resolution: opts.resolution,
      customSize: opts.customSize,
      quality: opts.quality,
      gptImage25Mode: opts.gptImage25Mode,
      background: opts.background,
      googleThinkingLevel: opts.googleThinkingLevel,
      googleSearchMode: opts.googleSearchMode,
      outputFormat: opts.outputFormat,
      gifSize: opts.gifSize, frameCount: opts.frameCount, frameDurationMs: opts.frameDurationMs, seedream55: opts.seedream55,
      speed: opts.speed,
      midjourneyOptions: opts.midjourneyOptions,
      imagePaths: opts.imagePaths,
    }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload?.success) throw new Error(payload?.error || "生成失败");

  opts.onProgress?.({
    generationId: payload.generationId,
    status: payload.status || "submitted",
    message: "任务已提交",
  });

  return {
    generationId: payload.generationId ? Number(payload.generationId) : undefined,
    status: String(payload.status || "submitted"),
    url: isDoneStatus(String(payload.status || "")) && payload.outputPaths?.[0]
      ? String(payload.outputPaths[0])
      : undefined,
    outputs: isDoneStatus(String(payload.status || "")) && Array.isArray(payload.outputPaths)
      ? payload.outputPaths.filter(Boolean).map((url: string, index: number) => ({ url: String(url), ...(index === 0 && payload.generationId ? { generationId: Number(payload.generationId) } : {}) }))
      : undefined,
  };
}

export async function runImageGen(opts: RunImageGenOptions): Promise<string> {
  const submitted = await submitImageGen(opts);
  if (submitted.url) return submitted.url;
  if (!submitted.generationId) throw new Error("任务已提交但缺少任务 ID");
  return waitForGenerationResult(submitted.generationId, opts.onProgress);
}

export async function runVideoGen(opts: {
  canvasId: number;
  sessionId: string;
  requestKey: string;
  model?: string;
  prompt: string;
  textList?: string[];
  mediaPaths?: string[];
  duration?: number;
  ratio?: string;
  resolution?: string;
  generateAudio?: boolean;
  omniReferenceTaskType?: "auto" | "edit" | "extend";
  outputFormat?: "mp4" | "mov";
}): Promise<string> {
  const submitted = await submitVideoGen(opts);
  return waitForGenerationResult(submitted.generationId);
}

export async function submitVideoGen(opts: {
  creativePresets?: CreativeSelection;
  cameraFixed?: boolean;
  canvasId: number;
  sessionId: string;
  requestKey: string;
  model?: string;
  prompt: string;
  textList?: string[];
  mediaPaths?: string[];
  inputMode?: string;
  duration?: number;
  ratio?: string;
  resolution?: string;
  generateAudio?: boolean;
  omniReferenceTaskType?: "auto" | "edit" | "extend";
  outputFormat?: "mp4" | "mov";
}): Promise<{ generationId: number; taskId?: string; status: string }> {
  const res = await fetch("/api/canvas/generate-video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Canvas-Id": String(opts.canvasId),
      "X-Canvas-Session-Id": opts.sessionId,
    },
    body: JSON.stringify(opts),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload?.success) throw new Error(payload?.error || "生成失败");
  if (!payload.generationId) throw new Error("任务已提交但缺少任务 ID");
  return {
    generationId: Number(payload.generationId),
    taskId: payload.taskId ? String(payload.taskId) : undefined,
    status: String(payload.status || "submitted"),
  };
}

export type SubmittedAudioGeneration = {
  generationId: number;
  status: string;
  url?: string;
  durationSeconds?: number;
  usageCharacters?: number;
};

export class AudioSubmissionError extends Error {
  constructor(message: string, public readonly rejected: boolean) { super(message); }
}

export async function submitAudioGen(opts: {
  canvasId: number;
  sessionId: string;
  requestKey: string;
  model: string;
  text: string;
  textList?: string[];
  suno?: import("@/lib/suno-models").SunoSettings;
  audioFormat?: import("@/lib/seed-audio-models").SeedAudioFormat;
  sampleRate?: number;
  references?: import("@/lib/seed-audio-models").SeedAudioMediaReference[];
  voiceId: string;
  speed: number;
  pitch: number;
  volume: number;
  modifyPitch: number;
  modifyIntensity: number;
  modifyTimbre: number;
  soundEffect: string;
  emotion?: import("@/lib/minimax-speech-models").MiniMaxSpeechEmotion;
  signal?: AbortSignal;
}): Promise<SubmittedAudioGeneration> {
  const res = await fetch("/api/canvas/generate-audio", {
    method: "POST",
    signal: opts.signal,
    headers: {
      "Content-Type": "application/json",
      "X-Canvas-Id": String(opts.canvasId),
      "X-Canvas-Session-Id": opts.sessionId,
    },
    body: JSON.stringify(opts),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload?.success) throw new AudioSubmissionError(payload?.error || "音频生成失败", res.status >= 400 && res.status < 500);
  if (!payload.generationId) throw new Error("音频任务缺少 Generation ID");
  return {
    generationId: Number(payload.generationId),
    status: String(payload.status || "submitted"),
    url: payload.outputPath ? String(payload.outputPath) : undefined,
    durationSeconds: Number.isFinite(Number(payload.durationSeconds)) ? Number(payload.durationSeconds) : undefined,
    usageCharacters: Number.isFinite(Number(payload.usageCharacters)) ? Number(payload.usageCharacters) : undefined,
  };
}
