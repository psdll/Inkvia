import type { CanvasCreativeSettings } from "@/lib/canvas/creative-presets/types";
import type { ImageModelParams, SelectOption } from "@/lib/generation/image-model-params";
import { createBrowserUuid } from "@/lib/browser/random-uuid";
import { MIDJOURNEY_V8_OUTPUT_COUNT, isMidjourneyV8Model, type MidjourneyV8Options } from "@/lib/midjourney-v8";

export {
  getImageModelParams as getCanvasImageModelParams,
  normalizeImageQuality as normalizeCanvasImageQuality,
} from "@/lib/generation/image-model-params";

export type CanvasSelectOption = SelectOption;
export type CanvasImageModelParams = ImageModelParams;

export type CanvasImageTaskSettings = CanvasCreativeSettings & {
  model: string;
  prompt: string;
  aspectRatio: string;
  resolution: string;
  customSize?: string;
  quality: string;
  gptImage25Mode?: string;
  background?: string;
  googleThinkingLevel?: string;
  googleSearchMode?: string;
  outputFormat?: string;
  gifSize?: string;
  frameCount?: number;
  frameDurationMs?: number; seedream55?: import("@/lib/apimart-seedream-55").Seedream55Settings;
  /** Midjourney V8.2：速度与进阶参数（只在选中 Midjourney 时生效） */
  midjourneySpeed?: string;
  midjourneyOptions?: MidjourneyV8Options;
  count: number;
};

export type CanvasTaskReference = {
  pinned?: boolean;
  id: string;
  url: string;
  name: string;
  sourceNodeId?: string;
  width?: number;
  height?: number;
};

export type CanvasTaskOutputStatus = "idle" | "submitting" | "running" | "success" | "failed" | "cancelled";

export type CanvasTaskOutput = {
  width?: number;
  height?: number;
  id: string;
  name?: string;
  requestKey?: string;
  mediaId?: string;
  status: CanvasTaskOutputStatus;
  generationId?: number;
  generationOutputsResolved?: boolean;
  startedAt?: number;
  finishedAt?: number;
  url?: string;
  error?: string;
};

export type CanvasTaskBatch = {
  id: string;
  createdAt: number;
  settings: CanvasImageTaskSettings;
  outputs: CanvasTaskOutput[];
  primaryOutputId?: string;
  expanded?: boolean;
};

export function getCanvasPrimaryImageOutput(batch?: CanvasTaskBatch) {
  const outputs = batch?.outputs.filter(output => output.status === "success" && output.url) || [];
  return outputs.find(output => output.id === batch?.primaryOutputId) || outputs[0];
}

export function isCanvasImageBatchExpanded(batch?: CanvasTaskBatch): boolean {
  return Boolean(batch && batch.expanded !== false
    && batch.outputs.filter(output => output.status === "success" && output.url).length > 1
    && !batch.outputs.some(output => ["idle", "submitting", "running"].includes(output.status)));
}

export type CanvasImageTaskData = {
  angleSource?: { sourceNodeId: string; url: string; mediaId?: string };
  preset?: "characterSheet";
  pinnedSource?: { sourceNodeId: string; url: string; mediaId?: string };
  references: CanvasTaskReference[];
  referenceOrder?: string[];
  settings: CanvasImageTaskSettings;
  batches: CanvasTaskBatch[];
  generatorPanelSize?: { width: number; height: number };
};

export function clampCanvasTaskCount(value: unknown): number {
  const count = Number(value);
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(8, Math.round(count)));
}

export function getCanvasImageDisplayCount(model: string, value: unknown): number {
  return isMidjourneyV8Model(model) ? MIDJOURNEY_V8_OUTPUT_COUNT : clampCanvasTaskCount(value);
}

export function getCanvasImageRequestCount(model: string, value: unknown): number {
  return isMidjourneyV8Model(model) ? 1 : clampCanvasTaskCount(value);
}

export function getCanvasImageSubmissionResolution(model: string, value: unknown): string | undefined {
  if (isMidjourneyV8Model(model)) return undefined;
  const resolution = String(value ?? "").trim();
  return resolution || undefined;
}

export function createCanvasTaskOutputs(count: unknown, makeId: () => string): CanvasTaskOutput[] {
  return Array.from(
    { length: clampCanvasTaskCount(count) },
    () => ({ id: makeId(), requestKey: createBrowserUuid(), status: "idle" }),
  );
}

export function canvasElapsedSeconds(startedAt: number | undefined, now = Date.now()): number {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

export function parseCanvasAspectRatio(value: string, fallback = 1): number {
  if (value === "auto") return fallback > 0 ? fallback : 1;
  const [width, height] = value.split(":").map(Number);
  return width > 0 && height > 0 ? width / height : fallback > 0 ? fallback : 1;
}
