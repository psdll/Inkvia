import { isSunoModel, sunoPrompt, type SunoSettings } from "@/lib/suno-models";
import { subtitleRemovalSchema, type SubtitleRemovalOptions } from "./subtitle-removal";
import type { CanvasLlmMediaReference } from "./llm-media";
import { buildPromptWithAssetReferences } from "@/lib/prompt-asset-references";
import type { CanvasCreativeSettings, CreativeSelection } from "@/lib/canvas/creative-presets/types";
import { createEmptyCanvasDocumentV2, type CanvasEdge, type CanvasNode, type CanvasNodeData } from "@/lib/canvas/document";
import type { CanvasNodePatch } from "@/lib/canvas/operations";
import { getVideoModelSpec } from "@/lib/sora2";
import { collectCanvasTextReferences } from "@/lib/canvas/text-references";
import { buildCanvasTaskMediaInput, collectCanvasTaskAssets } from "@/lib/canvas/task-references";
import { buildCanvasSeedAudioInput, getCanvasAudioModelReferenceError } from "@/lib/canvas/seed-audio";
import { isSeedAudioModel, type SeedAudioFormat, type SeedAudioMediaReference } from "@/lib/seed-audio-models";
import { buildCanvasCharacterSheetPrompt } from "@/lib/canvas/character-sheet";
import type { CanvasGenerationOutput } from "@/lib/canvas/generation-outputs";

export type CanvasRunStepSubmission =
  | { kind: "subtitleRemoval"; sourceUrl: string; options: SubtitleRemovalOptions }
  | { kind: "control" }
  | { kind: "llm"; providerId: string; model: string; prompt: string; textList?: string[]; system?: string; thinkingLevel?: import("@/lib/llm-routing/reasoning").LlmThinkingLevel; mediaReferences?: CanvasLlmMediaReference[] }
  | ({ kind: "image"; model: string; prompt: string; textList?: string[]; aspectRatio: string; resolution: string; customSize?: string; quality: string; gptImage25Mode?: string; background?: string; googleThinkingLevel?: string; googleSearchMode?: string; outputFormat?: string; gifSize?: string; frameCount?: number; frameDurationMs?: number; seedream55?: import("@/lib/apimart-seedream-55").Seedream55Settings; speed?: string; midjourneyOptions?: unknown; imagePaths: string[] } & CanvasCreativeSettings)
  | {
      kind: "audio";
      suno?: SunoSettings;
      model: string;
      text: string;
      textList?: string[];
      audioFormat?: SeedAudioFormat;
      sampleRate?: number;
      references?: SeedAudioMediaReference[];
      voiceId: string;
      speed: number;
      pitch: number;
      volume: number;
      modifyPitch: number;
      modifyIntensity: number;
      modifyTimbre: number;
      soundEffect: "" | "spacious_echo" | "auditorium_echo" | "lofi_telephone" | "robotic";
      emotion?: import("@/lib/minimax-speech-models").MiniMaxSpeechEmotion;
    }
  | {
      kind: "video";
      creativePresets?: CreativeSelection;
      model: string;
      prompt: string; textList?: string[];
      mediaPaths: string[];
      inputMode?: string;
      resolution?: string;
      ratio?: string;
      duration?: number;
      cameraFixed?: boolean;
      watermark?: boolean;
      generateAudio?: boolean;
      omniReferenceTaskType?: "auto" | "edit" | "extend";
      outputFormat?: "mp4" | "mov";
    };

export function buildCanvasRunStepSubmission(input: { nodeKind: string; node: CanvasNode; incomingNodes?: CanvasNode[]; incomingEdges?: CanvasEdge[] }): CanvasRunStepSubmission {
  const data = input.node.data;
  if (input.nodeKind !== data.kind) throw new Error("RUN_STEP_NODE_KIND_MISMATCH");
  if (data.kind === "videoTask" && data.subtitleRemoval) {
    const sourceUrl = data.mediaPaths[0];
    if (!sourceUrl) throw new Error("缺少去字幕原视频");
    return { kind: "subtitleRemoval", sourceUrl, options: subtitleRemovalSchema.parse(data.subtitleRemoval) };
  }
  const document = { ...createEmptyCanvasDocumentV2(), nodes: [...(input.incomingNodes || []), input.node], edges: input.incomingEdges || [] };
  const taskInput = data.kind === "imageTask" || data.kind === "videoTask"
    ? buildCanvasTaskMediaInput(document, input.node.id, [
        data.kind === "imageTask" && data.task.preset === "characterSheet"
          ? buildCanvasCharacterSheetPrompt(data.task.settings.prompt)
          : data.kind === "imageTask" ? data.task.settings.prompt : data.prompt,
      ].filter(Boolean).join("\n\n"))
    : null;
  if (data.kind === "imageTask") {
    if (data.task.preset === "characterSheet" && !taskInput!.imagePaths.length) throw new Error("角色设定图需要连接参考图片");
    return {
      kind: "image",
      model: data.task.settings.model,
      prompt: taskInput!.prompt,
      creativePresets: data.task.settings.creativePresets,
      imageAngle: data.task.settings.imageAngle,
      textList: taskInput!.textList,
      aspectRatio: data.task.preset === "characterSheet" ? "16:9" : data.task.settings.aspectRatio,
      resolution: data.task.settings.resolution,
      customSize: data.task.settings.customSize,
      quality: data.task.settings.quality,
      gptImage25Mode: data.task.settings.gptImage25Mode,
      background: data.task.settings.background,
      googleThinkingLevel: data.task.settings.googleThinkingLevel,
      googleSearchMode: data.task.settings.googleSearchMode,
      outputFormat: data.task.settings.outputFormat,
      gifSize: data.task.settings.gifSize, frameCount: data.task.settings.frameCount, frameDurationMs: data.task.settings.frameDurationMs, seedream55: data.task.settings.seedream55,
      speed: data.task.settings.midjourneySpeed,
      midjourneyOptions: data.task.settings.midjourneyOptions,
      imagePaths: taskInput!.imagePaths.slice(0, 32),
    };
  }
  if (data.kind === "videoTask") {
    const maxMedia = getVideoModelSpec(data.model).referenceLimits?.total ?? 32;
    return {
      kind: "video",
      creativePresets: data.creativePresets,
      model: data.model,
      prompt: taskInput!.prompt,
      textList: taskInput!.textList,
      mediaPaths: taskInput!.mediaPaths.slice(0, maxMedia),
      inputMode: data.inputMode,
      resolution: data.resolution,
      ratio: data.ratio,
      duration: data.duration,
      cameraFixed: data.cameraFixed,
      watermark: data.watermark,
      generateAudio: data.generateAudio,
      omniReferenceTaskType: data.omniReferenceTaskType,
      outputFormat: data.outputFormat,
    };
  }
  if (data.kind === "audioTask") {
    const referenceError = getCanvasAudioModelReferenceError(data.model, collectCanvasTaskAssets(document, input.node.id));
    if (referenceError) throw new Error(referenceError);
    const text = isSunoModel(data.model) ? sunoPrompt(data.suno) : data.prompt;
    const textList = collectCanvasTextReferences(document, input.node.id).map(reference => reference.content);
    return {
      kind: "audio",
      ...(isSunoModel(data.model) ? { suno: data.suno } : {}),
      model: data.model,
      text,
      textList,
      ...(isSeedAudioModel(data.model) ? { ...buildCanvasSeedAudioInput(document, input.node.id, text), audioFormat: data.audioFormat, sampleRate: data.sampleRate } : {}),
      voiceId: data.voiceId,
      speed: data.speed,
      pitch: data.pitch,
      volume: data.volume,
      modifyPitch: data.modifyPitch,
      modifyIntensity: data.modifyIntensity,
      modifyTimbre: data.modifyTimbre,
      soundEffect: data.soundEffect,
      ...(data.emotion ? { emotion: data.emotion } : {}),
    };
  }
  if (data.kind === "llm") {
    if (!data.providerId || !data.model) throw new Error("RUN_STEP_LLM_CONFIGURATION_MISSING");
    const assets = collectCanvasTaskAssets(document, input.node.id);
    return { kind: "llm", providerId: data.providerId, model: data.model, prompt: buildPromptWithAssetReferences(data.prompt, assets).modelPrompt, mediaReferences: assets.flatMap(({ kind, url }) => url ? [{ kind, url }] : []), textList: collectCanvasTextReferences(document, input.node.id).map(reference => reference.content), system: data.system, thinkingLevel: data.thinkingLevel };
  }
  if (data.kind === "loop") return { kind: "control" };
  throw new Error(`RUN_STEP_KIND_UNSUPPORTED:${data.kind}`);
}

export type GenerationRecordState = { status: string | null; localPath: string | null; errorMsg: string | null };

export function classifyGenerationRecord(record: GenerationRecordState):
  | { kind: "success"; url: string }
  | { kind: "failed"; error: string }
  | { kind: "waiting" } {
  const status = String(record.status || "").toLowerCase();
  if (record.localPath && ["success", "completed", "done", "succeeded"].includes(status)) {
    return { kind: "success", url: record.localPath };
  }
  if (["failed", "error", "cancelled", "canceled"].includes(status)) {
    return { kind: "failed", error: record.errorMsg || "generation failed" };
  }
  return { kind: "waiting" };
}

type SuccessOutput = { text?: string; url?: string; generationId?: number; mediaId?: string; outputs?: CanvasGenerationOutput[]; durationSeconds?: number; usageCharacters?: number };

export function buildCanvasRunStepSuccessPatch(input: {
  runId: number;
  stepId: string;
  nodeKind: string;
  pinnedNodeData: CanvasNodeData;
  output: SuccessOutput;
  finishedAt: number;
}): CanvasNodePatch {
  if (input.nodeKind === "llm" && input.pinnedNodeData.kind === "llm") {
    return { data: { output: input.output.text || "", status: "success" }, unsetDataKeys: ["error"] };
  }
  if (input.nodeKind === "videoTask" && input.pinnedNodeData.kind === "videoTask") {
    return {
      data: {
        outputUrl: input.output.url || "",
        generationId: input.output.generationId,
        mediaId: input.output.mediaId,
        variants: input.output.mediaId && input.output.url ? { original: { mediaId: input.output.mediaId, url: input.output.url } } : undefined,
        status: "success",
        finishedAt: input.finishedAt,
      },
      unsetDataKeys: ["error", "outputName"],
    };
  }
  if (input.nodeKind === "audioTask" && input.pinnedNodeData.kind === "audioTask") {
    return {
      data: {
        outputUrl: input.output.url || "",
        generationId: input.output.generationId,
        durationSeconds: input.output.durationSeconds,
        usageCharacters: input.output.usageCharacters,
        ...(input.output.outputs?.some(o => o.suno) ? {
          audioOutputs: input.output.outputs.filter(o => o.suno).map(o => ({ ...o.suno!, url: o.url, generationId: o.generationId, mediaId: o.mediaId })),
          selectedAudioIndex: 0,
          outputName: input.output.outputs[0]?.suno?.title,
        } : {}),
        status: "success",
        finishedAt: input.finishedAt,
      },
      unsetDataKeys: ["error", "waveformPeaks", ...(input.output.outputs?.some(o => o.suno) ? [] : ["outputName", "audioOutputs", "selectedAudioIndex"])],
    };
  }
  if (input.nodeKind === "imageTask" && input.pinnedNodeData.kind === "imageTask") {
    const batchId = `run-${input.runId}-step-${input.stepId}`;
    const existing = input.pinnedNodeData.task.batches.filter((batch) => batch.id !== batchId);
    return {
      data: {
        task: {
          ...input.pinnedNodeData.task,
          batches: [...existing, {
            id: batchId,
            createdAt: input.finishedAt,
            settings: input.pinnedNodeData.task.settings,
            outputs: (input.output.outputs?.length ? input.output.outputs : [input.output]).map((output, index) => ({
              id: `${batchId}-output-${index}`,
              status: "success",
              generationId: output.generationId,
              mediaId: output.mediaId,
              generationOutputsResolved: true,
              startedAt: input.finishedAt,
              finishedAt: input.finishedAt,
              url: output.url || "",
            })),
          }],
        },
      },
    };
  }
  if (input.nodeKind === "loop" && input.pinnedNodeData.kind === "loop") {
    return { data: { status: "success" } };
  }
  throw new Error("RUN_STEP_OUTPUT_KIND_MISMATCH");
}
