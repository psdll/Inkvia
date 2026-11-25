import { sunoSettingsSchema, sunoTrackSchema, type SunoSettings, type SunoTrack } from "@/lib/suno-models";
import { subtitleRemovalSchema, type SubtitleRemovalOptions } from "./subtitle-removal";
import { creativeSelectionSchema, type CreativeSelection } from "@/lib/canvas/creative-presets/types";
import { z } from "zod";
import { LLM_THINKING_LEVELS, type LlmThinkingLevel } from "@/lib/llm-routing/reasoning";
import { MINIMAX_SPEECH_EMOTIONS, type MiniMaxSpeechEmotion } from "@/lib/minimax-speech-models";
import type { CanvasImageTaskData } from "@/lib/canvas/image-task";
import {
  breakdownOverviewSchema,
  breakdownSegmentSchema,
  breakdownShotSchema,
  breakdownVideoSchema,
  type BreakdownOverview,
  type BreakdownSegment,
  type BreakdownShot,
  type BreakdownVideo,
} from "@/lib/canvas/shot-breakdown/types";

export const CANVAS_SCHEMA_VERSION = 2 as const;

export type CanvasViewport = { x: number; y: number; zoom: number };

export type CanvasSettings = {
  snapToGrid: boolean;
  gridSize: number;
};

export type CanvasMediaVariant = { mediaId?: string; url: string; mimeType?: string; width?: number; height?: number };
export type CanvasMediaIdentity = {
  origin?: "upload" | "generated";
  mediaId?: string;
  variants?: Partial<Record<"thumbnail" | "preview" | "poster" | "waveform" | "original", CanvasMediaVariant>>;
};

export type CanvasNodeKind =
  | "image"
  | "video"
  | "audio"
  | "prompt"
  | "imageTask"
  | "videoTask"
  | "audioTask"
  | "llm"
  | "group"
  | "loop"
  | "compare"
  | "breakdown";

/** 拉片：a source video's shot-by-shot breakdown, filled in progressively. */
export type CanvasBreakdownData = {
  kind: "breakdown";
  title?: string;
  sourceNodeId?: string;
  sourceUrl: string;
  sourceName?: string;
  providerId?: string;
  model?: string;
  status: "running" | "success" | "failed";
  stage?: string;
  progress?: number;
  message?: string;
  error?: string;
  warnings?: string[];
  startedAt?: number;
  finishedAt?: number;
  video?: BreakdownVideo;
  overview?: BreakdownOverview;
  shots: BreakdownShot[];
  segments: BreakdownSegment[];
  /** 原片音轨 and 背景音乐 extracted from the source. */
  audio?: { soundtrack?: string; background?: string };
  /** Background job on the server; a reopened canvas reconnects to it. */
  jobId?: string;
  /** Canvas nodes this breakdown laid out (全片拆解 / 风格参考 / 片段). */
  outputs?: CanvasBreakdownOutputs;
};

export type CanvasBreakdownOutputs = {
  overview?: string;
  soundGroup?: string;
  soundtrack?: string;
  background?: string;
  framesGroup?: string;
  styleGroup?: string;
  styles?: string[];
  segments?: Array<{ index: number; group?: string; clip?: string; doc?: string }>;
};

type NodeStatus = "idle" | "submitting" | "running" | "success" | "failed" | "cancelled";

export type CanvasNodeData =
  | ({ kind: "image"; url: string; name?: string; prompt?: string; model?: string; localPreview?: boolean } & CanvasMediaIdentity)
  | ({ kind: "video"; url: string; name?: string; prompt?: string; model?: string; posterUrl?: string } & CanvasMediaIdentity)
  | ({ kind: "audio"; sunoTrack?: SunoTrack; url: string; name?: string; prompt?: string; model?: string; waveformPeaks?: number[]; durationSeconds?: number } & CanvasMediaIdentity)
  | { kind: "prompt"; text: string; title?: string; format?: "markdown"; backgroundColor?: string }
  | { kind: "imageTask"; title?: string; task: CanvasImageTaskData }
  | {
      kind: "audioTask";
      suno?: SunoSettings;
      audioOutputs?: (SunoTrack & { url: string; generationId?: number; mediaId?: string })[];
      selectedAudioIndex?: number;
      title?: string;
      model: "speech-2.8-hd" | "speech-2.8-turbo" | string;
      prompt: string;
      voiceId: string;
      voiceName?: string;
      audioFormat?: import("@/lib/seed-audio-models").SeedAudioFormat;
      sampleRate?: number;
      referenceOrder?: string[];
      emotion?: MiniMaxSpeechEmotion;
      speed: number;
      pitch: number;
      volume: number;
      modifyPitch: number;
      modifyIntensity: number;
      modifyTimbre: number;
      soundEffect: "" | "spacious_echo" | "auditorium_echo" | "lofi_telephone" | "robotic";
      status: NodeStatus;
      requestKey?: string;
      generationId?: number;
      startedAt?: number;
      finishedAt?: number;
      outputUrl?: string;
      outputName?: string;
      waveformPeaks?: number[];
      durationSeconds?: number;
      usageCharacters?: number;
      error?: string;
      generatorPanelSize?: { width: number; height: number };
    }
  | {
      kind: "videoTask";
      subtitleRemoval?: SubtitleRemovalOptions;
      title?: string;
      creativePresets?: CreativeSelection;
      model: string;
      prompt: string;
      mediaPaths: string[];
      pinnedReferences?: { id: string; sourceNodeId: string; kind: "image" | "video" | "audio"; url: string; name: string }[];
      referenceOrder?: string[];
      inputMode?: string;
      resolution?: string;
      ratio?: string;
      duration?: number;
      cameraFixed?: boolean;
      watermark?: boolean;
      generateAudio?: boolean;
      omniReferenceTaskType?: "auto" | "edit" | "extend";
      outputFormat?: "mp4" | "mov";
      status: NodeStatus;
      requestKey?: string;
      generationId?: number;
      mediaId?: string;
      variants?: CanvasMediaIdentity["variants"];
      startedAt?: number;
      finishedAt?: number;
      outputUrl?: string;
      outputName?: string;
      error?: string;
      generatorPanelSize?: { width: number; height: number };
    }
  | {
      kind: "llm";
      title?: string;
      providerId?: string;
      model?: string;
      system?: string;
      thinkingLevel?: LlmThinkingLevel;
      prompt: string;
      referenceOrder?: string[];
      output?: string;
      status: NodeStatus;
      error?: string;
      resultFrameSize?: { width: number; height: number };
      generatorPanelSize?: { width: number; height: number };
    }
  | { kind: "group"; title: string; collapsed: boolean; stacked?: boolean; expandedSize?: { width: number; height: number }; tone?: "neutral" | "primary" | "success" | "warning" | "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "purple" | "pink" | "white" }
  | { kind: "loop"; title?: string; items: string[]; mode: "serial" | "parallel"; concurrency: number; status: NodeStatus }
  | { kind: "compare"; title?: string; beforeUrl: string; afterUrl: string; slider: number }
  | CanvasBreakdownData;

export type CanvasNode = {
  id: string;
  type: CanvasNodeKind;
  position: { x: number; y: number };
  data: CanvasNodeData;
  width?: number;
  height?: number;
  parentId?: string;
  extent?: "parent";
  zIndex?: number;
  hidden?: boolean;
};

export type CanvasEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: "default" | "smoothstep";
};

export type CanvasDocumentV2 = {
  schemaVersion: typeof CANVAS_SCHEMA_VERSION;
  mode: "smart";
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: CanvasViewport;
  settings: CanvasSettings;
};

const nodeStatusSchema = z.enum(["idle", "submitting", "running", "success", "failed", "cancelled"]);
const generatorPanelSizeSchema = z.object({ width: z.number().positive(), height: z.number().positive() });

const nodeDataSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), origin: z.enum(["upload", "generated"]).optional(), url: z.string().min(1), mediaId: z.string().uuid().optional(), variants: z.record(z.object({ mediaId: z.string().uuid().optional(), url: z.string().min(1), mimeType: z.string().optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional() })).optional(), name: z.string().optional(), prompt: z.string().optional(), model: z.string().optional() }),
  z.object({ kind: z.literal("video"), origin: z.enum(["upload", "generated"]).optional(), url: z.string().min(1), mediaId: z.string().uuid().optional(), variants: z.record(z.object({ mediaId: z.string().uuid().optional(), url: z.string().min(1), mimeType: z.string().optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional() })).optional(), name: z.string().optional(), prompt: z.string().optional(), model: z.string().optional(), posterUrl: z.string().optional() }),
  z.object({
    kind: z.literal("audio"),
    sunoTrack: sunoTrackSchema.optional(),
    origin: z.enum(["upload", "generated"]).optional(),
    url: z.string().min(1),
    mediaId: z.string().uuid().optional(),
    variants: z.record(z.object({ mediaId: z.string().uuid().optional(), url: z.string().min(1), mimeType: z.string().optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional() })).optional(),
    name: z.string().optional(),
    prompt: z.string().optional(),
    model: z.string().optional(),
    waveformPeaks: z.array(z.number().int().min(0).max(100)).length(80).optional(),
    durationSeconds: z.number().finite().nonnegative().optional(),
  }),
  z.object({ kind: z.literal("prompt"), text: z.string(), title: z.string().optional(), format: z.literal("markdown").optional(), backgroundColor: z.string().regex(/^(?:#[0-9a-fA-F]{6})?$/).optional() }),
  z.object({
    kind: z.literal("imageTask"),
    title: z.string().optional(),
    task: z.object({ referenceOrder: z.array(z.string()).optional(), generatorPanelSize: generatorPanelSizeSchema.optional() }).passthrough(),
  }),
  z.object({
    kind: z.literal("audioTask"),
    suno: sunoSettingsSchema.optional(),
    audioOutputs: z.array(sunoTrackSchema.extend({ url: z.string(), generationId: z.number().int().positive().optional(), mediaId: z.string().optional() })).optional(),
    selectedAudioIndex: z.number().int().nonnegative().optional(),
    title: z.string().optional(),
    model: z.string(),
    prompt: z.string(),
    voiceId: z.string(),
    voiceName: z.string().optional(),
    audioFormat: z.enum(["wav", "mp3", "pcm", "ogg_opus"]).optional(),
    sampleRate: z.number().int().positive().optional(),
    referenceOrder: z.array(z.string()).optional(),
    speed: z.number().min(0.5).max(2),
    pitch: z.number().int().min(-12).max(12),
    volume: z.number().min(0.01).max(10),
    modifyPitch: z.number().int().min(-100).max(100),
    modifyIntensity: z.number().int().min(-100).max(100),
    modifyTimbre: z.number().int().min(-100).max(100),
    soundEffect: z.enum(["", "spacious_echo", "auditorium_echo", "lofi_telephone", "robotic"]),
    emotion: z.enum(MINIMAX_SPEECH_EMOTIONS).optional(),
    status: nodeStatusSchema,
    requestKey: z.string().uuid().optional(),
    generationId: z.number().int().positive().optional(),
    startedAt: z.number().nonnegative().optional(),
    finishedAt: z.number().nonnegative().optional(),
    outputUrl: z.string().optional(),
    outputName: z.string().optional(),
    waveformPeaks: z.array(z.number().int().min(0).max(100)).length(80).optional(),
    durationSeconds: z.number().finite().nonnegative().optional(),
    usageCharacters: z.number().int().nonnegative().optional(),
    error: z.string().optional(),
    generatorPanelSize: generatorPanelSizeSchema.optional(),
  }),
  z.object({
    kind: z.literal("videoTask"),
    subtitleRemoval: subtitleRemovalSchema.optional(),
    title: z.string().optional(),
    creativePresets: creativeSelectionSchema.optional(),
    model: z.string(),
    prompt: z.string(),
    mediaPaths: z.array(z.string()),
    pinnedReferences: z.array(z.object({ id: z.string(), sourceNodeId: z.string(), kind: z.enum(["image", "video", "audio"]), url: z.string(), name: z.string() })).optional(),
    referenceOrder: z.array(z.string()).optional(),
    inputMode: z.string().optional(),
    resolution: z.string().optional(),
    ratio: z.string().optional(),
    duration: z.number().optional(),
    cameraFixed: z.boolean().optional(),
    watermark: z.boolean().optional(),
    generateAudio: z.boolean().optional(),
    omniReferenceTaskType: z.enum(["auto", "edit", "extend"]).optional(),
    outputFormat: z.enum(["mp4", "mov"]).optional(),
    status: nodeStatusSchema,
    requestKey: z.string().uuid().optional(),
    generationId: z.number().int().positive().optional(),
    mediaId: z.string().uuid().optional(),
    variants: z.record(z.object({ mediaId: z.string().uuid().optional(), url: z.string().min(1), mimeType: z.string().optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional() })).optional(),
    startedAt: z.number().nonnegative().optional(),
    finishedAt: z.number().nonnegative().optional(),
    outputUrl: z.string().optional(),
    outputName: z.string().optional(),
    error: z.string().optional(),
    generatorPanelSize: generatorPanelSizeSchema.optional(),
  }),
  z.object({
    kind: z.literal("llm"),
    title: z.string().optional(),
    providerId: z.string().optional(),
    model: z.string().optional(),
    system: z.string().optional(),
    thinkingLevel: z.enum(LLM_THINKING_LEVELS).optional(),
    prompt: z.string(),
    referenceOrder: z.array(z.string()).optional(),
    output: z.string().optional(),
    status: nodeStatusSchema,
    error: z.string().optional(),
    resultFrameSize: generatorPanelSizeSchema.optional(),
    generatorPanelSize: generatorPanelSizeSchema.optional(),
  }),
  z.object({
    kind: z.literal("group"),
    title: z.string(),
    collapsed: z.boolean(),
    stacked: z.boolean().optional(),
    expandedSize: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
    tone: z.enum(["neutral", "primary", "success", "warning", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "white"]).optional(),
  }),
  z.object({
    kind: z.literal("loop"),
    title: z.string().optional(),
    items: z.array(z.string()),
    mode: z.enum(["serial", "parallel"]),
    concurrency: z.number().int().min(1).max(8),
    status: nodeStatusSchema,
  }),
  z.object({
    kind: z.literal("compare"),
    title: z.string().optional(),
    beforeUrl: z.string(),
    afterUrl: z.string(),
    slider: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal("breakdown"),
    title: z.string().optional(),
    sourceNodeId: z.string().optional(),
    sourceUrl: z.string(),
    sourceName: z.string().optional(),
    providerId: z.string().optional(),
    model: z.string().optional(),
    status: z.enum(["running", "success", "failed"]),
    stage: z.string().optional(),
    progress: z.number().min(0).max(1).optional(),
    message: z.string().optional(),
    error: z.string().optional(),
    warnings: z.array(z.string()).optional(),
    startedAt: z.number().optional(),
    finishedAt: z.number().optional(),
    video: breakdownVideoSchema.optional(),
    overview: breakdownOverviewSchema.optional(),
    shots: z.array(breakdownShotSchema).default([]),
    segments: z.array(breakdownSegmentSchema).default([]),
    jobId: z.string().max(64).optional(),
    audio: z.object({ soundtrack: z.string().max(500).optional(), background: z.string().max(500).optional() }).optional(),
    outputs: z.object({
      overview: z.string().optional(),
      soundGroup: z.string().optional(),
      soundtrack: z.string().optional(),
      background: z.string().optional(),
      framesGroup: z.string().optional(),
      styleGroup: z.string().optional(),
      styles: z.array(z.string()).optional(),
      segments: z.array(z.object({ index: z.number().int(), group: z.string().optional(), clip: z.string().optional(), doc: z.string().optional() })).optional(),
    }).optional(),
  }),
]);

export const canvasNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["image", "video", "audio", "prompt", "imageTask", "videoTask", "audioTask", "llm", "group", "loop", "compare", "breakdown"]),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  data: nodeDataSchema,
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  parentId: z.string().optional(),
  extent: z.literal("parent").optional(),
  zIndex: z.number().int().optional(),
  hidden: z.boolean().optional(),
}).superRefine((node, context) => {
  if (node.type !== node.data.kind) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Node type must match data.kind", path: ["data", "kind"] });
  }
});

export const canvasEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
  type: z.enum(["default", "smoothstep"]).optional(),
});

export const canvasDocumentV2Schema = z.object({
  schemaVersion: z.literal(CANVAS_SCHEMA_VERSION),
  mode: z.literal("smart"),
  nodes: z.array(canvasNodeSchema),
  edges: z.array(canvasEdgeSchema),
  viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().positive().finite() }),
  settings: z.object({ snapToGrid: z.boolean(), gridSize: z.number().int().positive() }),
});

export function createEmptyCanvasDocumentV2(): CanvasDocumentV2 {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    mode: "smart",
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: { snapToGrid: false, gridSize: 20 },
  };
}

export function normalizeCanvasMediaOrigins(document: CanvasDocumentV2): CanvasDocumentV2 {
  const incomingIds = new Set(document.edges.map((edge) => edge.target));
  let changed = false;
  const nodes = document.nodes.map((node): CanvasNode => {
    const data = node.data;
    if ((data.kind !== "image" && data.kind !== "video" && data.kind !== "audio") || data.origin) return node;
    const outpaintInput = data.kind === "image" && data.name === "扩图" && document.nodes.some((candidate) => (
      candidate.data.kind === "imageTask" && candidate.data.task.references.some((reference) => reference.url === data.url && reference.name === "扩图")
    ));
    const generated = incomingIds.has(node.id) || /^(edited-|video-frame-|group-grid-)/.test(node.id)
      || Boolean(data.prompt || data.model) || (data.kind === "image" && Boolean(data.localPreview)) || outpaintInput;
    changed = true;
    return { ...node, data: { ...data, origin: generated ? "generated" : "upload" } };
  });
  return changed ? { ...document, nodes } : document;
}

export function parseCanvasDocumentV2(value: unknown): CanvasDocumentV2 {
  return canvasDocumentV2Schema.parse(value) as CanvasDocumentV2;
}

export function isCanvasDocumentV2(value: unknown): value is CanvasDocumentV2 {
  return canvasDocumentV2Schema.safeParse(value).success;
}
