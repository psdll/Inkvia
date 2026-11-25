import type { CanvasNodeData } from "@/lib/canvas/document";
import type { CanvasImageTaskSettings } from "@/lib/canvas/image-task";
import { canvasHistoryReferences } from "@/lib/assets/canvas-history";
import { getImageModelParams } from "@/lib/generation/image-model-params";

type Generation = {
  id: number; type: string; model: string | null; prompt?: string | null;
  templateData: string | null; requestKey?: string | null; createdAt?: Date | string;
};
export type AgentMediaTask = Extract<CanvasNodeData, { kind: "imageTask" | "videoTask" }>;

/** Use the saved submission, not the user's current model or parameter defaults. */
export function buildCreativeAgentMediaTask(row: Generation, media: { mediaId: string; url: string; width?: number; height?: number }): AgentMediaTask {
  let saved: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.templateData || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed;
  } catch { /* Older records may not have a parameter snapshot. */ }
  const string = (key: string) => typeof saved[key] === "string" ? saved[key] as string : undefined;
  const model = string("model") || row.model || "";
  const prompt = row.prompt ?? string("prompt") ?? "";
  const references = canvasHistoryReferences(saved);
  const createdAt = row.createdAt ? new Date(row.createdAt).getTime() : 0;
  const requestKey = row.requestKey || undefined;
  if (row.type === "video_gen") {
    return {
      kind: "videoTask", title: `Agent 视频 · ${row.id}`, model, prompt,
      mediaPaths: references.map(ref => ref.url), inputMode: string("inputMode"),
      resolution: string("resolution"), ratio: string("ratio"),
      duration: typeof saved.duration === "number" ? saved.duration : undefined,
      cameraFixed: typeof saved.cameraFixed === "boolean" ? saved.cameraFixed : undefined,
      watermark: typeof saved.watermark === "boolean" ? saved.watermark : undefined,
      generateAudio: typeof saved.generateAudio === "boolean" ? saved.generateAudio : undefined,
      omniReferenceTaskType: saved.omniReferenceTaskType === "auto" || saved.omniReferenceTaskType === "edit" || saved.omniReferenceTaskType === "extend" ? saved.omniReferenceTaskType : undefined,
      outputFormat: saved.outputFormat === "mp4" || saved.outputFormat === "mov" ? saved.outputFormat : undefined,
      status: "success", requestKey, generationId: row.id, mediaId: media.mediaId,
      outputUrl: media.url, outputName: `Agent 视频 · ${row.id}`,
      variants: { original: { url: media.url, mediaId: media.mediaId, width: media.width, height: media.height } },
    };
  }
  const defaults = getImageModelParams(model);
  const settings: CanvasImageTaskSettings = {
    model, prompt, aspectRatio: string("aspectRatio") ?? defaults.defaultAspectRatio,
    resolution: string("resolution") ?? defaults.defaultResolution,
    quality: string("quality") ?? defaults.defaultQuality,
    count: typeof saved.outputCount === "number" ? saved.outputCount : 1,
    seedream55: saved.seedream55 as CanvasImageTaskSettings["seedream55"], customSize: string("customSize"), gptImage25Mode: string("gptImage25Mode"),
    background: string("background"), googleThinkingLevel: string("googleThinkingLevel"),
    googleSearchMode: string("googleSearchMode"), outputFormat: string("outputFormat"),
    gifSize: string("gifSize"), frameCount: typeof saved.frameCount === "number" ? saved.frameCount : undefined,
    frameDurationMs: typeof saved.frameDurationMs === "number" ? saved.frameDurationMs : undefined,
  };
  const outputId = `agent-output-${row.id}`;
  return {
    kind: "imageTask", title: `Agent 图片 · ${row.id}`,
    task: {
      settings,
      references: references.filter(ref => ref.kind === "image").map((ref, index) => ({ id: `agent-ref-${row.id}-${index}`, url: ref.url, name: ref.name || `参考图 ${index + 1}` })),
      batches: [{ id: `agent-batch-${row.id}`, createdAt, settings: { ...settings }, primaryOutputId: outputId,
        outputs: [{ id: outputId, name: `Agent 图片 · ${row.id}`, requestKey, generationId: row.id, generationOutputsResolved: true,
          mediaId: media.mediaId, url: media.url, width: media.width, height: media.height, status: "success" }] }],
    },
  };
}
