"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";

import { isSeedream55Model } from "@/lib/volcengine-seedream-55";
import { LLM_THINKING_LABELS, type LlmThinkingLevel } from "@/lib/llm-routing/reasoning";

import { googleImageSettingsSummary } from "@/lib/google-image-settings";
import { GoogleImageSettings } from "@/components/image/google-image-settings";

import { CanvasVideoSubtitleRemovalProvider, CanvasVideoSubtitleRemovalButton, CanvasSubtitleRemovalOverlay, useCanvasSubtitleRemoval } from "./CanvasVideoSubtitleRemoval";
import type { SubtitleRemovalOptions } from "@/lib/canvas/subtitle-removal";
import { sortAspectRatioOptions } from "@/lib/aspect-ratio-order";
import { CanvasEditableNodeName } from "./CanvasEditableNodeName";
import { CanvasAudioSpeedButton, CanvasAudioTrimButton, CanvasAudioTrimProvider, useCanvasAudioTrim } from "./CanvasAudioTrim";
import type { CanvasAudioClip } from "@/lib/canvas/audio-trim";
import { renameCanvasNodeData } from "@/lib/canvas/material-name";
import { CanvasNodeHeading } from "./CanvasNodeHeading";

import { isQwenImage3Model } from "@/lib/qwen-image-3-models";

import { isOpenRouterImageModel, getOpenRouterImageParams, getOpenRouterResolutionDisplayOptions } from "@/lib/openrouter-image-params";
import { supportsImageBackground, GPT_IMAGE_25_BACKGROUND_OPTIONS } from "@/lib/gpt-image-25-models";
import { supportsGptImage26Gif } from "@/lib/gpt-image-26-animation";
import { GptImage25OutputSettings } from "@/components/image/gpt-image-25-output-settings";

import { expandGptImage25ModelOptions, getGptImage25SelectionValue, getGptImage25ModelLabel } from "@/lib/gpt-image-25-models";

import * as React from "react";
import { friendlyErrorDisplayText } from "@/lib/error-friendly";
import { useCanvasReadOnly } from "./CanvasReadOnlyContext";
import { CanvasAngleButton, type AngleGenerationSettings } from "./creative/CanvasAngleEditor";
import type { ImageAngle } from "@/lib/canvas/creative-presets/types";
import type { PromptCreativeEditorHandle } from "@/components/ui/prompt-rich-editor";
import { CHARACTER_SHEET_TOKEN, withLegacyCreativeTokens } from "@/lib/canvas/creative-presets/inline-token";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Handle, NodeResizeControl, NodeResizer, NodeToolbar, Position, useConnection, useNodeId, useStore, useUpdateNodeInternals, type Node, type NodeProps } from "@xyflow/react";
import { AlignHorizontalSpaceAround, AlignVerticalSpaceAround, Archive, Clapperboard, ArrowUp, AtSign, Bot, Brush, ChevronDown, ChevronUp, CircleHelp, Download, Eye, Film, FolderInput, GitCompare, Grid3x3, ImageIcon, Layers3, LayoutGrid, ListRestart, Loader2, Maximize2, Minimize2, MessageSquareText, Music2, Pause, Play, RotateCcw, Scissors, Settings2, Ungroup, Volume2, VolumeX, WandSparkles, X } from "lucide-react";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { CanvasMediaImage as MediaImage } from "@/components/canvas/CanvasMediaImage";
import { getCanvasLocalVideoPosterSource } from "@/lib/canvas/media-url";
import { CanvasLodHandoff } from "./CanvasLodHandoff";
import { CanvasBreakdownNode } from "./CanvasBreakdownNode";
import { CanvasReplaceMediaButton } from "./CanvasReplaceMediaButton";
import { CanvasLodContext, CanvasPanelHiddenContext, CanvasRuntimeContext, useCanvasInteracting } from "./canvas-runtime-context";
import { CanvasVideoClipProvider, CanvasVideoClipButton, useCanvasVideoClip } from "./CanvasVideoClip";
import { CanvasVideoCropProvider, CanvasVideoCropOverlay, useCanvasVideoCrop } from "./CanvasVideoCrop";
import type { CanvasVideoClip } from "@/lib/canvas/video-clip";
import type { CanvasVideoSeparationMode, CanvasVideoSeparationJob } from "@/lib/canvas/video-separation";
import { CanvasVideoSeparateButton } from "./CanvasVideoSeparateButton";
import { CanvasVideoFrameContext, CanvasVideoFrameControl, CanvasVideoFrameProvider } from "./CanvasVideoFrameControls";
import type { VideoFrameMode } from "@/lib/video-frame";
import { invalidateCanvasVideoPoster, readCanvasVideoPoster, writeCanvasVideoPoster } from "@/lib/canvas/video-poster-cache";
import { isCanvasVideoPosterBlack } from "@/lib/canvas/video-poster-pixels";
import { hasCanvasThumbnailContent } from "@/lib/canvas/thumbnail-eligibility";
import { VideoPosterPreview } from "@/components/ui/video-poster-preview";
import type { CapturedVideoFrame } from "@/lib/browser/video-frame-capture";
import { CanvasImageCompareNode } from "./CanvasImageCompareNode";
import { CanvasAudioNode } from "@/components/canvas/CanvasAudioNode";
import { isSunoModel } from "@/lib/suno-models";
import { CanvasSunoResult } from "./CanvasSunoResult";
import { CanvasSunoPanel } from "./CanvasSunoPanel";
import { CanvasSeedAudioOutputOptions, CanvasSeedAudioParameters } from "@/components/canvas/CanvasSeedAudioParameters";
import { getCanvasAudioModelReferenceError } from "@/lib/canvas/seed-audio";
import { isSeedAudioModel, SEED_AUDIO_TEXT_MAX_LENGTH } from "@/lib/seed-audio-models";
import { useCanvasAudioPlayback } from "@/components/canvas/CanvasAudioPlayback";
import { CanvasMiniMaxVoiceDialog } from "@/components/canvas/CanvasMiniMaxVoiceDialog";
import { CanvasSpeechPromptEditor } from "@/components/canvas/CanvasSpeechPromptEditor";
import { CanvasSpeechParameters } from "@/components/canvas/CanvasSpeechParameters";
import { CanvasConnectionHandle } from "@/components/canvas/CanvasConnectionHandle";
import { CANVAS_GENERATOR_COLLAPSED_WIDTH, CANVAS_GENERATOR_COMPACT_MAX_WIDTH, CANVAS_GENERATOR_COMPACT_MIN_WIDTH, CanvasGeneratorShell } from "@/components/canvas/CanvasGeneratorShell";
import { CanvasTaskParameterPopover } from "@/components/canvas/CanvasTaskParameterPopover";
import { CanvasTextNode } from "@/components/canvas/CanvasTextNode";
import { getCanvasTextTaskFrameSize } from "@/lib/canvas/text-node";
import { canvasGenerationStatusText } from "@/components/canvas/run-node";
import { CanvasGenerationEffect } from "@/components/canvas/CanvasGenerationEffect";
import { getCanvasImageModelDisplayLabel, resolveCanvasModelId, useCanvasModels } from "@/components/canvas/use-canvas-models";
import { CANVAS_MEDIA_BODY_TARGET_HANDLE_ID, CANVAS_MEDIA_INPUT_HANDLE_ID, CANVAS_RIGHT_OUTPUT_HANDLE_ID, CANVAS_TASK_BODY_TARGET_HANDLE_ID, CANVAS_TASK_INPUT_HANDLE_ID } from "@/lib/canvas/connection-rules";
import type { CanvasNodeData, CanvasNodeKind } from "@/lib/canvas/document";
import type { CanvasGroupLayout } from "@/lib/canvas/graph";
import { canvasElapsedSeconds, getCanvasImageDisplayCount, getCanvasImageModelParams, getCanvasPrimaryImageOutput, isCanvasImageBatchExpanded } from "@/lib/canvas/image-task";
import { DEFAULT_CANVAS_AUDIO_NODE_SIZE, DEFAULT_CANVAS_MEDIA_NODE_SIZE, getCanvasMediaNodeSize } from "@/lib/canvas/media-size";
import { getCanvasImageResultLayout, getCanvasTaskPrimaryFrameSize, getCanvasTaskResultFrameSize } from "@/lib/canvas/task-references";
import { CanvasAspectRatioIcon } from "./CanvasAspectRatioIcon";
import { CanvasVideoModeIcon } from "./CanvasVideoModeIcon";
import type { PromptReferenceAsset } from "@/lib/prompt-asset-references";
import { insertMediaItem, swapMediaItems } from "@/lib/media-item-order";
import { getCanvasReferenceInsertion, isCanvasReferenceMediaDrag } from "@/lib/canvas/reference-drop";
import { CANVAS_TASK_POPOVER_DISMISS_EVENT } from "@/lib/canvas/task-popover-events";
import { isSeedance25VideoModel } from "@/lib/sora2";
import { isMiniMaxH3VideoModel } from "@/lib/minimax-models";
import { APIMART_MIDJOURNEY_V8_MODEL_ID, isMidjourneyV8Model, midjourneyVersionLabel, normalizeMidjourneyV8Speed } from "@/lib/midjourney-v8";
import { MidjourneySettings } from "@/components/image/midjourney-settings";
import { getVideoDisplayResolution, getVideoDisplaySpec } from "@/lib/video-resolution-visibility";
import { resolveCanvasVideoInputMode } from "@/lib/canvas/task-preferences";
import { getCanvasVideoReferenceError, type CanvasVideoReference } from "@/lib/canvas/video-references";
import { canvasImageTier } from "@/lib/canvas/render-runtime";
import { canvasMaterialToolbarPosition, canvasTaskPanelPosition } from "@/lib/canvas/node-overlay-position";
import { formatCanvasVideoTime } from "@/lib/canvas/video-playback";
import type { CanvasAudioWaveformData } from "@/lib/canvas/audio-waveform";
import { formatCanvasMediaResolution, hydrateCanvasMediaDimensions, hydrateCanvasTaskOutputDimensions } from "@/lib/canvas/media-metadata";
import { useCanvasImageResolution } from "./use-canvas-image-resolution";
import { isCreativeAgentMediaPlaceholder } from "@/lib/creative-agent/media-layout";
import { getCanvasLodZone, resolveCanvasLodZone } from "@/lib/canvas/visual-policy";
import { resetCanvasConnectionTargetTilts, scheduleCanvasConnectionTargetTilt, resetCanvasConnectionTargetTilt as resetTargetTilt, resolveCanvasConnectionCandidateState, resolveCanvasNodeConnectionTargetState } from "@/lib/canvas/connection-feedback";
import {
  getMiniMaxSpeechCapabilities,
  MINIMAX_SPEECH_TEXT_MAX_LENGTH,
} from "@/lib/minimax-speech-models";

const loadPromptRichEditor = () => import("@/components/ui/prompt-rich-editor").then((module) => module.PromptRichEditor);
const PromptRichEditor = dynamic(loadPromptRichEditor, {
  ssr: false,
  loading: () => <div className="flex min-h-20 items-center justify-center text-xs text-[var(--app-muted)]"><Loader2 className="mr-2 h-4 w-4 animate-spin" /><UiText id="canvas.m9bf8db3dc5ec" /></div>,
});

export type CanvasBreakdownModel = { providerId: string; modelId: string; label: string };

export type CanvasFlowNode = Node<CanvasNodeData, CanvasNodeKind>;
export type CanvasVideoFocusRequest = { nodeId: string; src: string; revision: number };

export type NodeEditor = {
  /** 多图节点里当前聚焦的一张（画布上单独点选，或从 Agent 对话定位）；收起时临时显示这一张，不改主图 */
  focusedOutput?: { nodeId: string; outputId: string; pulse: number } | null;
  focusOutput?: (nodeId: string, outputId: string) => void;
  videoFocusRequest?: CanvasVideoFocusRequest | null;
  consumeVideoFocusRequest?: (revision: number) => void;
  startTextWriting?: (id: string) => void;
  getTextNodeTitle?: (id: string) => string;
  updateData: (id: string, updater: (data: CanvasNodeData) => CanvasNodeData, historyMode?: "coalesce" | "replace" | "push") => void;
  expandAudioOutputs?: (id: string) => void;
  changeTaskModel: (id: string, model: string) => void;
  updateNodeSize: (id: string, size: { width: number; height: number }) => void;
  replaceMediaFile?: (id: string, file: File, outputId?: string) => Promise<void>;
  replaceMediaHistory?: (id: string, outputId?: string) => void;
  finishNodeResize?: () => void;
  hydrateAudioWaveform: (id: string, waveform: CanvasAudioWaveformData) => void;
  runNode: (id: string) => void;
  generateAngle?: (id: string, url: string, angle: ImageAngle, settings?: AngleGenerationSettings) => void;
  createCharacterSheet?: (id: string, url: string) => void;
  cancelNode: (id: string) => void;
  retryImageOutput: (id: string, batchId: string, outputId: string) => void;
  openTemplate: (id: string) => void;
  openImageEditor: (id: string, mode?: "preview" | "crop" | "brush" | "mask" | "outpaint" | "grid") => void;
  editOutput: (id: string, batchId: string, outputId: string, mode?: "preview" | "crop" | "brush" | "mask" | "outpaint" | "grid") => void;
  removeVideoSubtitles?: (id: string, sourceUrl: string, options: SubtitleRemovalOptions, size: { width: number; height: number }) => Promise<void>;
  /** 拉片：video-understanding models, best first; empty when none is enabled. */
  breakdownModels?: CanvasBreakdownModel[];
  breakdownVideo?: (id: string, sourceUrl: string, model?: CanvasBreakdownModel) => void;
  rerunBreakdown?: (id: string, model: CanvasBreakdownModel) => void;
  cancelBreakdown?: (id: string) => void;
  breakdownToImageTask?: (id: string, shotIndex: number) => void;
  breakdownToVideoTask?: (id: string, segmentIndex: number) => void;
  expandBreakdownFrames?: (id: string) => void;
  separateVideo?: (id: string, sourceUrl: string, onProgress?: (progress: number) => void, signal?: AbortSignal, mode?: CanvasVideoSeparationMode) => Promise<void>;
  videoSeparationJobs?: Record<string, CanvasVideoSeparationJob>;
  exportVideoClip?: (id: string, clip: CanvasVideoClip, sourceUrl: string, operation?: "crop") => Promise<void>;
  exportVideoFrame: (id: string, frame: CapturedVideoFrame, mode: VideoFrameMode, sourceUrl: string) => Promise<void>;
  exportAudioClip?: (id: string, clip: CanvasAudioClip, sourceUrl: string, speed?: number) => Promise<void>;
  previewMedia: (id: string) => void;
  downloadMedia: (id: string) => void;
  saveMediaToLibrary: (id: string) => void;
  previewOutput: (id: string, batchId: string, outputId: string) => void;
  downloadOutput: (id: string, batchId: string, outputId: string) => void;
  saveOutputToLibrary: (id: string, batchId: string, outputId: string) => void;
  groupAction: (id: string, action: "toggle" | "arrange" | "fit" | "preview" | "grid" | "download" | "ungroup", layout?: CanvasGroupLayout) => void;
  getTaskTextReferences?: (id: string) => import("@/lib/canvas/text-references").CanvasTextReference[];
  getTaskAssets: (id: string) => PromptReferenceAsset[];
  getTaskVideoReferences?: (id: string) => readonly CanvasVideoReference[];
  reorderTaskReferences: (id: string, orderedIds: string[]) => void;
  removeTaskReference: (id: string, referenceId: string) => void;
  locateCanvasNode: (id: string) => void;
  mentionTaskReference: (id: string, token: string) => void;
  getMediaName: (id: string) => string | undefined;
  getTaskResultName: (id: string, batchId?: string, outputId?: string) => string | undefined;
  isPanelVisible: (id: string) => boolean;
  isGroupSelected: (id: string) => boolean;
  isTaskPanelVisible: (id: string) => boolean;
  connectionInProgress: boolean;
  connectionFeedbackTarget: { nodeId: string; state: Exclude<CanvasConnectionTargetState, null> } | null;
};

export const CanvasNodeEditorContext = React.createContext<NodeEditor | null>(null);

function useCanvasConnectionInProgress() {
  const editor = React.useContext(CanvasNodeEditorContext);
  const xyflowConnectionInProgress = useConnection<CanvasFlowNode, boolean>((connection) => connection.inProgress);
  return xyflowConnectionInProgress || Boolean(editor?.connectionInProgress);
}

const labels: Record<CanvasNodeKind, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  prompt: "提示词",
  imageTask: "图片任务",
  videoTask: "视频任务",
  audioTask: "音频任务",
  llm: "LLM",
  group: "分组",
  loop: "循环",
  compare: "对比",
  breakdown: "拉片",
};

const icons: Record<CanvasNodeKind, React.ComponentType<{ className?: string }>> = {
  image: ImageIcon,
  video: Film,
  audio: Music2,
  prompt: MessageSquareText,
  imageTask: WandSparkles,
  videoTask: Film,
  audioTask: Music2,
  llm: Bot,
  group: Layers3,
  loop: ListRestart,
  compare: GitCompare,
  breakdown: Clapperboard,
};

const CANVAS_IMAGE_COUNT_OPTIONS = [1, 2, 4] as const;

function Status({ status, error }: { status?: string; error?: string }) {
  const { locale, label, error: uiError } = useUiLocale();
  if ((!status || status === "idle") && !error) return null;
  const display = friendlyErrorDisplayText(error || (status === "success" ? "已完成" : status === "failed" ? "失败" : status === "cancelled" ? "已取消" : "运行中"));
  const text = locale === "en" && error ? uiError(display) : label(display);
  return <span title={text} className={`block truncate rounded-lg bg-[var(--panel-2)] px-2 py-1 text-[10px] ${error || status === "failed" ? "text-[var(--error-fg,var(--app-fg))]" : "text-[var(--app-muted)]"}`}>{text}</span>;
}

function ActionButton({ onClick, disabled, children, unframed = false }: { onClick: () => void; disabled?: boolean; children: React.ReactNode; unframed?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={`nodrag inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[11px] text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-40 ${unframed ? "border-0 bg-[var(--canvas-task-param-bg)] shadow-none" : "border border-[var(--border)]"}`}>{children}</button>;
}

function TaskSubmitButton({ onClick, disabled, running, label }: { onClick: () => void; disabled?: boolean; running?: boolean; label: string }) {
  const readOnly = useCanvasReadOnly();
  const { text } = useUiLocale();
  const accessibleLabel = running ? text("workspaceFollowup.medf6ccec8f2b", { v0: label }) : label;
  return (
    <button type="button" onClick={onClick} disabled={readOnly || disabled} aria-label={accessibleLabel} title={accessibleLabel} className="canvas-task-submit-button nodrag">
      {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} />}
    </button>
  );
}

function ToolbarButton({ title, onClick, children, viewAction = false }: { title: string; onClick: () => void; children: React.ReactNode; viewAction?: boolean }) {
  const { text } = useUiLocale();
  const readOnly = useCanvasReadOnly();
  return <button type="button" disabled={readOnly && !viewAction} title={readOnly && !viewAction ? text("workspaceFollowup.mcc9bb310d483", { v0: title }) : title} aria-label={title} onClick={(event) => { event.stopPropagation(); onClick(); }} className="canvas-material-toolbar-item nodrag">{children}</button>;
}

function CanvasImageGridMenu({ onSplit, onCharacterSheet }: { onSplit(): void; onCharacterSheet(): void }) {
  const readOnly = useCanvasReadOnly();
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const select = (action: () => void) => {
    setOpen(false);
    action();
  };
  return <>
    <UiProps ids={{"title":["canvas.m6468a493168d"],"aria-label":["canvas.m6468a493168d"]}}><button ref={triggerRef} type="button" title="canvas.m6468a493168d" aria-label="canvas.m6468a493168d" aria-expanded={open} aria-haspopup="menu" disabled={readOnly}
      onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }} className="canvas-material-toolbar-item nodrag">
      <Grid3x3 className="h-4 w-4" /><UiText id="canvas.m6468a493168d" /><ChevronDown className="h-3 w-3" />
    </button></UiProps>
    <CanvasTaskParameterPopover open={open} anchorRef={triggerRef} onClose={() => setOpen(false)} width={158} maxHeight={84} side="bottom" className="canvas-image-grid-popover">
      <div data-canvas-image-grid-menu role="menu">
        <button type="button" role="menuitem" className="canvas-image-grid-option" onClick={() => select(onSplit)}><Grid3x3 className="h-3.5 w-3.5 shrink-0" /><span><UiText id="canvas.m7902a782e7c1" /></span></button>
        <button type="button" role="menuitem" className="canvas-image-grid-option" onClick={() => select(onCharacterSheet)}><ImageIcon className="h-3.5 w-3.5 shrink-0" /><span><UiText id="canvas.mdc301e7f2304" /></span></button>
      </div>
    </CanvasTaskParameterPopover>
  </>;
}

const CANVAS_MATERIAL_METADATA_TOOLBAR_OFFSET = 36;

function CanvasMaterialToolbar({ children }: { children: React.ReactNode }) {
  const nodeId = useNodeId();
  const [toolbar, setToolbar] = React.useState<HTMLElement | null>(null);
  const marker = React.useCallback((element: HTMLSpanElement | null) => setToolbar(element?.parentElement || null), []);
  const [size, setSize] = React.useState({ width: 0, height: 50 });
  React.useLayoutEffect(() => {
    if (!toolbar) return;
    const sync = () => setSize(previous => previous.width === toolbar.offsetWidth && previous.height === toolbar.offsetHeight
      ? previous : { width: toolbar.offsetWidth, height: toolbar.offsetHeight });
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [toolbar]);
  const position = useStore(state => {
    const node = nodeId ? state.nodeLookup.get(nodeId) : undefined;
    if (!node || !state.width || !state.height || !size.width) return null;
    const [vx, vy, zoom] = state.transform;
    return canvasMaterialToolbarPosition({
      x: node.internals.positionAbsolute.x * zoom + vx, y: node.internals.positionAbsolute.y * zoom + vy,
      width: node.measured.width || node.width || 350, zoom, viewportWidth: state.width, viewportHeight: state.height,
      toolbarWidth: size.width, toolbarHeight: size.height, offset: CANVAS_MATERIAL_METADATA_TOOLBAR_OFFSET,
    });
  }, (a, b) => a?.left === b?.left && a?.top === b?.top);
  const videoClip = useCanvasVideoClip();
  const videoCrop = useCanvasVideoCrop();
  // 工具条是固定屏幕大小的：画布缩小后会比节点宽好几倍，盖住旁边的节点。
  // 缩到 50% 以下只留图标；缩到 30% 以下先收起，鼠标移到这个节点或工具条上再出现。
  const zoom = useStore(state => state.transform[2]);
  const compact = zoom < .5;
  const tiny = zoom < .3;
  const [hovering, setHovering] = React.useState(false);
  React.useEffect(() => {
    if (!tiny || !nodeId) { setHovering(false); return; }
    // 不依赖 CSS.escape：部分环境（老浏览器、测试环境）没有它
    const nodeElement = [...document.querySelectorAll<HTMLElement>(".react-flow__node")].find(element => element.dataset.id === nodeId);
    const targets = [nodeElement, toolbar].filter((element): element is HTMLElement => element instanceof HTMLElement);
    let timer = 0;
    const enter = () => { window.clearTimeout(timer); setHovering(true); };
    const leave = () => { window.clearTimeout(timer); timer = window.setTimeout(() => setHovering(false), 160); };
    targets.forEach(element => { element.addEventListener("pointerenter", enter); element.addEventListener("pointerleave", leave); });
    if (nodeElement?.matches(":hover")) setHovering(true);
    return () => {
      window.clearTimeout(timer);
      targets.forEach(element => { element.removeEventListener("pointerenter", enter); element.removeEventListener("pointerleave", leave); });
    };
  }, [tiny, nodeId, toolbar]);
  if (videoClip?.editing || videoCrop?.editing) return null;
  return <NodeToolbar isVisible position={Position.Top} offset={CANVAS_MATERIAL_METADATA_TOOLBAR_OFFSET}
    style={position ? { transform: `translate(${position.left}px, ${position.top}px)` } : undefined}
    data-compact={compact || undefined} data-collapsed={tiny && !hovering || undefined}
    className="canvas-material-toolbar nodrag nopan nowheel" data-canvas-focus-toolbar onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <span ref={marker} hidden />{children}
  </NodeToolbar>;
}

function CanvasMaterialToolbarSeparator() {
  return <span className="canvas-material-toolbar-separator" aria-hidden="true" />;
}

function CanvasMaterialPreviewButton({ onClick }: { onClick: () => void }) {
  return <><CanvasMaterialToolbarSeparator /><UiProps ids={{"title":["canvas.m13d61fea9f17"]}}><ToolbarButton viewAction title="canvas.m13d61fea9f17" onClick={onClick}><Maximize2 className="h-4 w-4" /></ToolbarButton></UiProps></>;
}

function CanvasSaveToLibraryButton({ onClick }: { onClick: () => void }) {
  return <UiProps ids={{"title":["canvas.mb45494687e39"]}}><ToolbarButton title="canvas.mb45494687e39" onClick={onClick}><FolderInput className="h-4 w-4" /><UiText id="canvas.mb45494687e39" /></ToolbarButton></UiProps>;
}

function CanvasMaterialMetadata({
  id,
  kind,
  name,
  resolution,
}: {
  id: string;
  kind: "image" | "video" | "audio";
  name?: string;
  resolution?: string;
}) {
  const { label: uiLabel } = useUiLocale();
  const editor = React.useContext(CanvasNodeEditorContext);
  if (!name && !resolution) return null;
  const Icon = icons[kind];
  return (
    <CanvasNodeHeading
      data-canvas-material-metadata
      className="canvas-material-metadata"
    >
      <Icon className="canvas-material-metadata-icon" />
      <CanvasEditableNodeName name={name || uiLabel(labels[kind])} onRename={value => editor?.updateData(id, current => renameCanvasNodeData(current, value), "push")} />
      {resolution && <span className="ml-auto shrink-0 tabular-nums">{resolution}</span>}
    </CanvasNodeHeading>
  );
}

type CanvasVideoPlayerProps = {
  src: string;
  poster?: string;
  previewOnly?: boolean;
  prefetch?: boolean;
  className: string;
  onLoadedMetadata?: (video: HTMLVideoElement) => void;
};

export function CanvasVideoPlayer({ src, poster: posterUrl, previewOnly = false, prefetch = false, className, onLoadedMetadata }: CanvasVideoPlayerProps) {
  const surfaceRef = React.useRef<HTMLDivElement>(null);
  const pointerInside = React.useRef(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const editor = React.useContext(CanvasNodeEditorContext);
  const focusRequest = editor?.videoFocusRequest;
  const consumedFocusRevision = React.useRef(0);
  const [playbackRevision, setPlaybackRevision] = React.useState(0);
  const frameActions = React.useContext(CanvasVideoFrameContext);
  const subtitleEditing = Boolean(useCanvasSubtitleRemoval()?.editing);
  const cropEditing = Boolean(useCanvasVideoCrop()?.editing || subtitleEditing) && !previewOnly;
  const clipEditing = (Boolean(useCanvasVideoClip()?.editing) || cropEditing) && !previewOnly;
  const frameVideoRef = previewOnly ? undefined : frameActions?.videoRef;
  const frameTimeRef = previewOnly ? undefined : frameActions?.timeRef;
  const frameMenuOpen = !previewOnly && frameActions?.openMenu === "player";
  const connectionInProgress = useCanvasConnectionInProgress();
  const [hovered, setHovered] = React.useState(false);
  const runtime = React.useContext(CanvasRuntimeContext);
  const interacting = useCanvasInteracting();
  const queueOwner = React.useId();
  const [prepared, setPrepared] = React.useState(false);
  const [initializationFailed, setInitializationFailed] = React.useState(false);
  const [initializing, setInitializing] = React.useState(false);
  const [hasVideoFrame, setHasVideoFrame] = React.useState(false);
  const [failedPoster, setFailedPoster] = React.useState<string>();
  const candidatePoster = posterUrl || getCanvasLocalVideoPosterSource(src);
  const poster = candidatePoster === failedPoster ? undefined : candidatePoster;
  const nodeId = useNodeId();
  const selected = useStore(state => Boolean(nodeId && state.nodeLookup.get(nodeId)?.selected));
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const posterTier = useStore(state => {
    if (previewOnly) return 100;
    const node = nodeId ? state.nodeLookup.get(nodeId) : undefined;
    const tier = canvasImageTier(node?.measured.width ?? node?.width ?? 350, state.transform[2], dpr, false, previewOnly || prefetch);
    // 需要“原图”时按视频自身分辨率截帧（截取宽度另外受 videoWidth 限制），最高 3200
    return Math.max(400, tier === "original" ? 3200 : tier);
  });
  const [capturedFrame, setCapturedFrame] = React.useState(() => ({ source: src, ...runtime?.videoPosters?.get(src) }));
  const firstFrame = capturedFrame.source === src ? capturedFrame.url : undefined;
  const [posterCacheChecked, setPosterCacheChecked] = React.useState<string | null>(null);
  const [frameAttempted, setFrameAttempted] = React.useState(0);
  // Idle low-detail nodes only prepare a queued static frame. Hover can activate
  // the same player without mounting the full node or its playback controls.
  const needsFrame = posterCacheChecked === src && !poster && (!firstFrame || (capturedFrame.tier ?? 0) < posterTier) && frameAttempted < posterTier;
  const captureGeneration = React.useRef(0);
  const posterTime = React.useRef(0);
  const captureFirstFrame = React.useCallback(async (video: HTMLVideoElement) => {
    if (!needsFrame || interacting || video.readyState < 2 || video.seeking || Math.abs(video.currentTime - posterTime.current) > .1) return;
    // One bounded retry avoids caching a completely black fade-in frame.
    if (posterTime.current === 0 && Number.isFinite(video.duration) && video.duration > .2 && isCanvasVideoPosterBlack(video)) {
      posterTime.current = Math.min(.5, video.duration / 2);
      video.currentTime = posterTime.current;
      return;
    }
    setFrameAttempted(posterTier);
    const generation = captureGeneration.current;
    try {
      if (!video.videoWidth || !video.videoHeight) return;
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(posterTier, video.videoWidth);
      canvas.height = Math.max(1, Math.round(canvas.width * video.videoHeight / video.videoWidth));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = { url: canvas.toDataURL("image/jpeg", .9), tier: posterTier };
      // Decode before swapping sources so a quality upgrade never clears the old poster.
      const image = new Image();
      image.src = frame.url;
      await image.decode();
      if (captureGeneration.current !== generation) return;
      const cached = runtime?.videoPosters?.get(src);
      const best = cached && cached.tier > frame.tier ? cached : frame;
      runtime?.videoPosters?.set(src, best);
      writeCanvasVideoPoster(runtime?.owner, src, best);
      setCapturedFrame({ source: src, ...best });
      if (posterTime.current > 0 && video.paused) video.currentTime = 0;
      posterTime.current = 0;
    } catch { if (captureGeneration.current === generation) setInitializationFailed(true); /* Keep an existing poster on failed upgrades. */ }
  }, [needsFrame, interacting, posterTier, runtime, src]);
  React.useEffect(() => {
    if (prepared && videoRef.current) void captureFirstFrame(videoRef.current);
  }, [prepared, captureFirstFrame]);
  const finishInitialization = React.useRef<(() => void) | null>(null);
  const playRequested = React.useRef(false);
  const savedTime = React.useRef({ source: src, time: 0 });
  const disposeVideo = React.useCallback(() => {
    const video = videoRef.current;
    if (video) {
      if (video.readyState >= 1) savedTime.current = { source: src, time: video.currentTime };
      if (frameTimeRef && video.readyState >= 1) frameTimeRef.current = video.currentTime;
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    finishInitialization.current?.();
    finishInitialization.current = null;
  }, [frameTimeRef, src]);
  const attachVideo = React.useCallback((video: HTMLVideoElement | null) => {
    setHasVideoFrame(false);
    if (!video && videoRef.current) {
      if (videoRef.current.readyState >= 1) savedTime.current = { source: src, time: videoRef.current.currentTime };
      if (frameTimeRef && videoRef.current.readyState >= 1) frameTimeRef.current = videoRef.current.currentTime;
      videoRef.current.pause();
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
      finishInitialization.current?.();
    }
    videoRef.current = video;
    if (frameVideoRef) frameVideoRef.current = video;
  }, [frameVideoRef, frameTimeRef, src]);
  React.useEffect(() => {
    playRequested.current = false;
    setInitializing(false);
    setInitializationFailed(false);
    setFailedPoster(undefined);
    setPrepared(false);
    setCapturedFrame({ source: src, ...runtime?.videoPosters?.get(src) });
    setFrameAttempted(0);
    posterTime.current = 0;
    return () => { captureGeneration.current++; runtime?.videos.cancel(queueOwner); runtime?.retainedVideos.release(queueOwner); disposeVideo(); };
  }, [src, runtime, queueOwner, disposeVideo]);
  React.useEffect(() => {
    let cancelled = false;
    setPosterCacheChecked(null);
    if (poster || runtime?.videoPosters?.get(src)) {
      setPosterCacheChecked(src);
      return;
    }
    const fallback = setTimeout(() => setPosterCacheChecked(src), 150);
    void readCanvasVideoPoster(runtime?.owner, src).then(async cached => {
      if (!cached || cancelled) return;
      // A damaged stored image falls back to the bounded extraction queue.
      const image = new Image();
      image.src = cached.url;
      await image.decode();
      if (cancelled) return;
      if (isCanvasVideoPosterBlack(image)) {
        await invalidateCanvasVideoPoster(runtime?.owner, src);
        return;
      }
      const current = runtime?.videoPosters?.get(src);
      const best = current && current.tier > cached.tier ? current : cached;
      runtime?.videoPosters?.set(src, best);
      setCapturedFrame({ source: src, ...best });
    }).catch(() => {}).finally(() => { clearTimeout(fallback); if (!cancelled) setPosterCacheChecked(src); });
    return () => { cancelled = true; clearTimeout(fallback); };
  }, [src, poster, runtime]);
  React.useEffect(() => {
    if (prepared || initializationFailed) return;
    if (interacting || connectionInProgress || (!hovered && !needsFrame && !clipEditing)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const initialize = () => new Promise<void>(resolve => {
        if (cancelled) {
          resolve();
          return;
        }
        setInitializing(true);
        const timeout = setTimeout(() => {
          disposeVideo();
          runtime?.retainedVideos.release(queueOwner);
          setFrameAttempted(posterTier);
          setInitializationFailed(true);
          setPrepared(false);
        }, 10000);
        finishInitialization.current = () => {
          clearTimeout(timeout);
          finishInitialization.current = null;
          setInitializing(false);
          resolve();
        };
        runtime?.retainedVideos.retain(queueOwner, () => { disposeVideo(); setPrepared(false); setFrameAttempted(posterTier); });
        setPrepared(true);
      });
      // The one pointed-at video must not wait behind slow background posters.
      // Leaving it cancels unfinished initialization; idle extraction stays bounded.
      if (runtime && !hovered && !clipEditing) runtime.videos.add(queueOwner, initialize, prefetch ? -1 : 0);
      else void initialize();
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); runtime?.videos.cancel(queueOwner); };
  }, [clipEditing, hovered, prepared, initializationFailed, needsFrame, posterTier, interacting, connectionInProgress, runtime, queueOwner, prefetch]);
  React.useEffect(() => {
    if (!prepared || initializing || ((clipEditing || hovered || selected || frameActions?.openMenu || frameActions?.busy) && !interacting && !connectionInProgress)) return;
    videoRef.current?.pause();
    const timer = setTimeout(() => { disposeVideo(); runtime?.retainedVideos.release(queueOwner); setPrepared(false); }, previewOnly && (firstFrame || initializationFailed) ? 0 : 1500);
    return () => clearTimeout(timer);
  }, [clipEditing, hovered, selected, frameActions?.openMenu, frameActions?.busy, prepared, initializing, interacting, connectionInProgress, disposeVideo, runtime, queueOwner, previewOnly, firstFrame, initializationFailed]);
  const [paused, setPaused] = React.useState(true);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [volume, setVolume] = React.useState(1);
  const [muted, setMuted] = React.useState(false);

  React.useEffect(() => {
    setPaused(true);
    setCurrentTime(0);
    setDuration(0);
    setHovered(false);
    pointerInside.current = false;
    playRequested.current = false;
    if (frameTimeRef) frameTimeRef.current = 0;
    savedTime.current = { source: src, time: 0 };
    return () => {
      const video = videoRef.current;
      if (!video) return;
      video.pause();
      video.currentTime = 0;
    };
  }, [src]);

  React.useEffect(() => {
    if (!focusRequest || focusRequest.nodeId !== nodeId || focusRequest.src !== src ||
      consumedFocusRevision.current === focusRequest.revision || previewOnly || prefetch || interacting || connectionInProgress) return;
    // Focus can replace the LOD player or suppress mouse-enter during animation.
    // Consume one explicit request only after the full player can become active.
    consumedFocusRevision.current = focusRequest.revision;
    playRequested.current = true;
    setHovered(true);
    setInitializationFailed(false);
    setPlaybackRevision(value => value + 1);
    editor?.consumeVideoFocusRequest?.(focusRequest.revision);
  }, [focusRequest, nodeId, src, previewOnly, prefetch, interacting, connectionInProgress, editor?.consumeVideoFocusRequest]);

  React.useEffect(() => {
    if (!connectionInProgress && !interacting) return;
    const video = videoRef.current;
    if (video) {
      video.pause();
      if (frameTimeRef) frameTimeRef.current = video.currentTime;
    }
    setPaused(true);
  }, [connectionInProgress, interacting]);

  const beginHover = React.useCallback(() => {
    if (prefetch || cropEditing) return;
    // Remember intent even during gesture settling; initialization and playback
    // remain gated by interacting/connectionInProgress in their own effects.
    pointerInside.current = true;
    playRequested.current = true;
    setInitializationFailed(false);
    setHovered(true);
  }, [prefetch, cropEditing]);
  const endHover = React.useCallback(() => {
    if (clipEditing) { pointerInside.current = false; setHovered(false); return; }
    const cancelInitialization = playRequested.current && Boolean(finishInitialization.current);
    pointerInside.current = false;
    playRequested.current = false;
    const video = videoRef.current;
    if (video) {
      video.pause();
      if (frameTimeRef) frameTimeRef.current = video.currentTime;
    }
    if (cancelInitialization) {
      disposeVideo();
      runtime?.retainedVideos.release(queueOwner);
      setPrepared(false);
    }
    setPaused(true);
    setHovered(false);
  }, [clipEditing, disposeVideo, frameTimeRef, runtime, queueOwner]);
  React.useEffect(() => {
    if (prefetch || interacting || connectionInProgress) return;
    // LOD swaps and inert layers can change the hit target below a stationary
    // pointer without delivering mouse-enter/leave to the new player.
    const inside = surfaceRef.current?.matches(":hover") ?? false;
    if (inside && !pointerInside.current) beginHover();
    else if (!inside && pointerInside.current) endHover();
  }, [src, prefetch, interacting, connectionInProgress, beginHover, endHover]);

  // Reconcile pointer intent first, before resuming playback after a gesture.
  React.useEffect(() => {
    if (cropEditing || !playRequested.current || !hovered || !prepared || initializing || interacting || connectionInProgress) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    void video.play().catch(async (error) => {
      if (cancelled) return;
      if (error?.name !== "NotAllowedError") {
        setPaused(true);
        return;
      }
      video.muted = true;
      try {
        await video.play();
      } catch {
        if (!cancelled) setPaused(true);
      }
    });
    return () => { cancelled = true; };
  }, [cropEditing, hovered, prepared, initializing, interacting, connectionInProgress, playbackRevision]);

  const togglePlayback = () => {
    if (connectionInProgress || interacting) return;
    const video = videoRef.current;
    if (!video) {
      playRequested.current = true;
      setInitializationFailed(false);
      setHovered(true);
      return;
    }
    playRequested.current = video.paused;
    if (video.paused) void video.play().catch(() => setPaused(true));
    else video.pause();
  };

  const seek = (value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = value;
    setCurrentTime(value);
  };

  const changeVolume = (value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = value;
    video.muted = value === 0;
  };

  const toggleMuted = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.muted || video.volume === 0) {
      if (video.volume === 0) video.volume = 1;
      video.muted = false;
    } else {
      video.muted = true;
    }
  };

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const volumePercent = muted ? 0 : volume * 100;

  return (
    <div
      ref={surfaceRef}
      data-canvas-video-preview-only={previewOnly || undefined}
      className={`group/video relative overflow-hidden ${className}`}
      onMouseEnter={beginHover}
      onMouseLeave={endHover}
    >
      {poster ? <UiProps ids={{"alt":["canvas.mcd088db2247a"]}}><MediaImage data-canvas-video-poster src={poster} alt="canvas.mcd088db2247a" prefetch={prefetch} draggable={false} className="absolute inset-0 h-full w-full object-cover" thumbnailSize={previewOnly ? 100 : undefined} onError={() => setFailedPoster(poster)} /></UiProps> : firstFrame ? <UiProps ids={{"alt":["canvas.mcd088db2247a"]}}><img data-canvas-video-poster src={firstFrame} alt="canvas.mcd088db2247a" draggable={false} className="absolute inset-0 h-full w-full object-cover" /></UiProps> : <UiProps ids={{"aria-label":["canvas.m33fbff28ebcf","canvas.mb4c41958ebf0"]}}><div data-canvas-video-preview-state={initializationFailed ? "failed" : "loading"} role="img" aria-label={initializationFailed ? "canvas.m33fbff28ebcf" : "canvas.mb4c41958ebf0"} className="canvas-low-detail-skeleton canvas-low-detail-video-skeleton"><Film /></div></UiProps>}
      {prepared ? <video
          ref={attachVideo}
          crossOrigin="anonymous"
          src={src}
          playsInline
          preload={needsFrame ? "auto" : "metadata"}
          draggable={false}
          disablePictureInPicture
          data-canvas-video-player
          onError={() => {
            setFrameAttempted(posterTier);
            setInitializationFailed(true);
            disposeVideo();
            runtime?.retainedVideos.release(queueOwner);
            setPrepared(false);
          }}
          onLoadedData={(event) => {
            setHasVideoFrame(true);
            finishInitialization.current?.();
            void captureFirstFrame(event.currentTarget);
          }}
          onLoadedMetadata={(event) => {
            if (!needsFrame) finishInitialization.current?.();
            const video = event.currentTarget;
            setDuration(Number.isFinite(video.duration) ? video.duration : 0);
            const resumeTime = savedTime.current.source === src ? savedTime.current.time || frameTimeRef?.current || 0 : 0;
            if (resumeTime && Number.isFinite(video.duration)) video.currentTime = Math.min(resumeTime, Math.max(0, video.duration - 0.000001));
            onLoadedMetadata?.(video);
          }}
          onSeeked={(event) => { void captureFirstFrame(event.currentTarget); }}
          onClick={previewOnly ? undefined : togglePlayback}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onTimeUpdate={(event) => {
            setCurrentTime(event.currentTarget.currentTime);
            if (frameTimeRef && event.currentTarget.readyState >= 1) frameTimeRef.current = event.currentTarget.currentTime;
          }}
          onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
          onVolumeChange={(event) => {
            setVolume(event.currentTarget.volume);
            setMuted(event.currentTarget.muted);
          }}
          onEnded={(event) => {
            setPaused(true);
            setCurrentTime(event.currentTarget.currentTime);
            if (frameTimeRef) frameTimeRef.current = event.currentTarget.currentTime;
          }}
          className={`absolute inset-0 h-full w-full ${cropEditing ? "object-contain" : "object-cover"} transition-opacity duration-300 ease-out ${hasVideoFrame && (hovered || selected || (!poster && !firstFrame)) ? "opacity-100" : "opacity-0"}`}
        /> : null}
      {!previewOnly && <><CanvasVideoCropOverlay /><CanvasSubtitleRemovalOverlay /></>}
      {/* Idle players keep only the poster; the 20+ control elements mount on demand. */}
      {!previewOnly && !cropEditing && (hovered || frameMenuOpen || !paused) && <div
        data-canvas-video-controls
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        className="nodrag pointer-events-none canvas-video-controls group-hover/video:pointer-events-auto group-hover/video:opacity-100"
        style={frameMenuOpen ? { opacity: 1, pointerEvents: "auto" } : undefined}
      >
        <div className="canvas-video-control-row">
          <UiProps ids={{"aria-label":["canvas.mc3396195e91c","canvas.m8d12fc0d4eb2"]}}><button type="button" onClick={togglePlayback} aria-label={paused ? "canvas.mc3396195e91c" : "canvas.m8d12fc0d4eb2"} className="canvas-video-play-button">
            {paused ? <Play className="h-4 w-4 fill-current" /> : <Pause className="h-4 w-4 fill-current" />}
          </button></UiProps>
          <span className="canvas-video-time">{formatCanvasVideoTime(currentTime)}</span>
          <UiProps ids={{"aria-label":["canvas.m7dbd24c900ea"]}}><input
            type="range"
            aria-label="canvas.m7dbd24c900ea"
            min={0}
            max={duration || 1}
            step={0.01}
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => seek(Number(event.target.value))}
            style={{ backgroundImage: `linear-gradient(to right, #fff 0%, #fff ${progressPercent}%, rgba(255,255,255,.4) ${progressPercent}%, rgba(255,255,255,.4) 100%)` }}
            className="canvas-video-progress"
          /></UiProps>
          <span className="canvas-video-time">{formatCanvasVideoTime(duration)}</span>
          <div className="canvas-video-volume group/volume">
            <UiProps ids={{"aria-label":["canvas.md10a1eff9182","canvas.m7db2e189ecb0"]}}><button type="button" onClick={toggleMuted} aria-label={muted || volume === 0 ? "canvas.md10a1eff9182" : "canvas.m7db2e189ecb0"} className="canvas-video-volume-button">
              {muted || volume === 0 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button></UiProps>
            <div className="canvas-video-volume-slider">
            <UiProps ids={{"aria-label":["canvas.m8bf8b9780d34"]}}><input
              type="range"
              aria-label="canvas.m8bf8b9780d34"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(event) => changeVolume(Number(event.target.value))}
              style={{ backgroundImage: `linear-gradient(to right, #fff 0%, #fff ${volumePercent}%, rgba(255,255,255,.4) ${volumePercent}%, rgba(255,255,255,.4) 100%)` }}
            /></UiProps>
            </div>
          </div>
          <CanvasVideoFrameControl placement="player" visible={hovered || frameMenuOpen} />
        </div>
      </div>}
    </div>
  );
}

function useElapsedSeconds(active: boolean, startedAt?: number, finishedAt?: number) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active || !startedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  return canvasElapsedSeconds(startedAt, finishedAt || now);
}

function AudioReferenceContent({ asset }: { asset: PromptReferenceAsset }) {
  const { text, label: uiLabel } = useUiLocale();
  const { snapshot, toggle } = useCanvasAudioPlayback(asset.sourceNodeId || asset.id);
  const [metadata, setMetadata] = React.useState<{ url: string; seconds: number } | null>(null);
  const savedDuration = Number.isFinite(asset.durationSeconds) && (asset.durationSeconds ?? 0) > 0 ? asset.durationSeconds! : 0;
  const duration = snapshot.active && snapshot.durationSeconds > 0
    ? snapshot.durationSeconds
    : savedDuration || (metadata && metadata.url === asset.url ? metadata.seconds : 0);
  const label = `${snapshot.isPlaying ? text("workspaceFollowup.m8d12fc0d4eb2") : text("workspaceFollowup.mc3396195e91c")}${asset.token}`;

  return (
    <>
      <Music2 className="canvas-reference-audio-icon" aria-hidden="true" />
      <button
        type="button"
        data-canvas-reference-audio-play
        aria-label={uiLabel(label)}
        aria-pressed={snapshot.isPlaying}
        title={snapshot.error || label}
        disabled={!asset.url}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (asset.url) void toggle(asset.url, duration);
        }}
      >
        {snapshot.isPlaying ? <Pause className="h-2.5 w-2.5" fill="currentColor" /> : <Play className="ml-px h-2.5 w-2.5" fill="currentColor" />}
      </button>
      <span className="canvas-reference-duration">{duration > 0 ? `${duration.toFixed(1)}s` : "--s"}</span>
      {!duration && asset.url ? <audio
        key={asset.url}
        src={asset.url}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => {
          const seconds = event.currentTarget.duration;
          if (Number.isFinite(seconds) && seconds > 0) setMetadata({ url: asset.url!, seconds });
        }}
      /> : null}
    </>
  );
}

type ReferenceDropTarget = { id: string; placement: "before" | "after" | "swap" };

function ConnectedAssets({ nodeId, assets, allowInsertion = false, leading, videoInputMode }: { nodeId: string; assets: PromptReferenceAsset[]; allowInsertion?: boolean; leading?: React.ReactNode; videoInputMode?: string }) {
  const { text } = useUiLocale();
  const editor = React.useContext(CanvasNodeEditorContext);
  const interacting = useCanvasInteracting();
  const panelHidden = React.useContext(CanvasPanelHiddenContext);
  const stripRef = React.useRef<HTMLDivElement>(null);
  const pointerDragRef = React.useRef<{ pointerId: number; sourceId: string; x: number; y: number; moved: boolean } | null>(null);
  const [draggedId, setDraggedId] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<ReferenceDropTarget | null>(null);
  const [hoverPreview, setHoverPreview] = React.useState<{
    assetId: string;
    assetUrl?: string;
    anchor: { left: number; top: number; bottom: number; width: number };
  } | null>(null);
  const previewAsset = hoverPreview ? assets.find(asset => asset.id === hoverPreview.assetId && asset.url === hoverPreview.assetUrl) : undefined;
  const hoverPreviewTimerRef = React.useRef<number | null>(null);
  const [textPreview, setTextPreview] = React.useState<{ id: string; content: string; left: number; top: number } | null>(null);
  const clearHoverPreviewTimer = React.useCallback(() => {
    if (hoverPreviewTimerRef.current !== null) {
      window.clearTimeout(hoverPreviewTimerRef.current);
      hoverPreviewTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => clearHoverPreviewTimer, [clearHoverPreviewTimer]);

  const dismissReferencePreviews = React.useCallback(() => {
    clearHoverPreviewTimer();
    setHoverPreview(null);
    setTextPreview(null);
  }, [clearHoverPreviewTimer]);

  React.useEffect(() => {
    window.addEventListener(CANVAS_TASK_POPOVER_DISMISS_EVENT, dismissReferencePreviews);
    window.addEventListener("scroll", dismissReferencePreviews, true);
    window.addEventListener("resize", dismissReferencePreviews);
    return () => {
      window.removeEventListener(CANVAS_TASK_POPOVER_DISMISS_EVENT, dismissReferencePreviews);
      window.removeEventListener("scroll", dismissReferencePreviews, true);
      window.removeEventListener("resize", dismissReferencePreviews);
    };
  }, [dismissReferencePreviews]);

  const getDropTarget = (x: number, y: number): ReferenceDropTarget | null => {
    const strip = stripRef.current;
    const element = document.elementFromPoint(x, y);
    if (!strip || !(element instanceof Element) || !strip.contains(element)) return null;
    let target = element.closest<HTMLElement>("[data-canvas-reference-id]");
    let gapPlacement: "before" | "after" | undefined;
    if (!target && allowInsertion) {
      let nearestDistance = Infinity;
      for (const candidate of strip.querySelectorAll<HTMLElement>("[data-canvas-reference-id]")) {
        const rect = candidate.getBoundingClientRect();
        const dx = Math.max(rect.left - x, 0, x - rect.right);
        const dy = Math.max(rect.top - y, 0, y - rect.bottom);
        const distance = dx * dx + dy * dy;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          target = candidate;
        }
      }
      if (target) {
        const rect = target.getBoundingClientRect();
        if (y < rect.top || y > rect.bottom) gapPlacement = y < rect.top ? "before" : "after";
      }
    }
    const id = target?.dataset.canvasReferenceId;
    if (!target || !id || id === pointerDragRef.current?.sourceId) return null;
    const rect = target.getBoundingClientRect();
    const offset = (x - rect.left) / rect.width;
    return { id, placement: allowInsertion ? gapPlacement ?? (offset < 0.25 ? "before" : offset > 0.75 ? "after" : "swap") : "swap" };
  };

  const clearPointerDrag = () => {
    pointerDragRef.current = null;
    setDraggedId(null);
    setDropTarget(null);
  };

  const finishPointerDrag = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const target = cancelled ? null : getDropTarget(event.clientX, event.clientY);
    clearPointerDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.moved || !target) return;
    const sourceIndex = assets.findIndex((asset) => asset.id === drag.sourceId);
    const targetIndex = assets.findIndex((asset) => asset.id === target.id);
    const nextAssets = target.placement === "swap"
      ? swapMediaItems(assets, sourceIndex, targetIndex)
      : insertMediaItem(assets, sourceIndex, targetIndex, target.placement);
    if (nextAssets !== assets) editor?.reorderTaskReferences(nodeId, nextAssets.map((asset) => asset.id));
  };

  const textReferences = editor?.getTaskTextReferences?.(nodeId) || [];
  const textPreviewContent = textReferences.find(reference => reference.id === textPreview?.id)?.content;
  React.useLayoutEffect(() => {
    if (interacting || panelHidden || (hoverPreview && !previewAsset) || (textPreview && !textPreviewContent)) dismissReferencePreviews();
  }, [interacting, panelHidden, hoverPreview, previewAsset, textPreview, textPreviewContent, dismissReferencePreviews]);

  if (!assets.length && !textReferences.length && !allowInsertion) return null;

  const hoverPreviewPosition = hoverPreview && typeof window !== "undefined"
    ? {
        left: hoverPreview.anchor.left + hoverPreview.anchor.width / 2,
        bottom: window.innerHeight - hoverPreview.anchor.top + 8,
      }
    : undefined;

  return (
    <>
      <div
        ref={stripRef}
        className="canvas-reference-strip"
        data-canvas-task-assets
        data-canvas-reference-task-id={allowInsertion ? nodeId : undefined}
        onDragOver={allowInsertion ? (event) => {
          if (!isCanvasReferenceMediaDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
          clearHoverPreviewTimer();
          setHoverPreview(null);
          const target = getCanvasReferenceInsertion(event.target, event.clientX, event.clientY);
          setDropTarget(target?.referenceId ? { id: target.referenceId, placement: target.placement } : null);
        } : undefined}
        onDragLeave={allowInsertion ? (event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(null);
        } : undefined}
        onDrop={allowInsertion ? () => setDropTarget(null) : undefined}
      >
        {leading}
        {textReferences.map((reference, index) => (
          <div key={reference.id} className="canvas-text-reference nodrag nopan" data-canvas-text-reference={reference.id}
            onMouseEnter={event => {
              if (interacting || panelHidden) return;
              const rect = event.currentTarget.getBoundingClientRect();
              setTextPreview({ id: reference.id, content: reference.content, left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)), top: rect.top });
            }}
            onMouseLeave={() => setTextPreview(null)}
            onFocus={event => {
              if (interacting || panelHidden) return;
              const rect = event.currentTarget.getBoundingClientRect();
              setTextPreview({ id: reference.id, content: reference.content, left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)), top: rect.top });
            }}
            onBlur={() => setTextPreview(null)}
            onDoubleClick={event => { event.stopPropagation(); editor?.locateCanvasNode(reference.sourceNodeId); }}>
            <div className="canvas-reference-card" tabIndex={0} data-canvas-reference-kind="text" aria-label={text("workspaceFollowup.ma585b496c9ca", { v0: reference.name })} aria-describedby={`text-reference-${nodeId}-${reference.id}`}>
              <MessageSquareText className="h-5 w-5" />
              <span data-canvas-reference-sequence>{index + 1}</span>
              <UiProps ids={{"title":["canvas.m9ecb8d7eb8c5"]}}><button type="button" data-canvas-reference-remove aria-label={text("workspaceFollowup.ma9d14fe73dff", { v0: reference.name })} title="canvas.m9ecb8d7eb8c5"
                onClick={event => { event.stopPropagation(); dismissReferencePreviews(); editor?.removeTaskReference(nodeId, reference.id); }}><X className="h-2.5 w-2.5" /></button></UiProps>
            </div>
          </div>
        ))}
        {assets.map((asset, index) => (
          <UiProps key={asset.id} ids={{"title":["canvas.me4db5e1adee6","canvas.m8f43e77951da"]}}><div

            className="canvas-reference-card nodrag nopan touch-none select-none"
            draggable={false}
            data-canvas-reference-id={asset.id}
            data-canvas-reference-kind={asset.kind}
            data-dragging={draggedId === asset.id || undefined}
            data-drop-target={dropTarget?.id === asset.id && dropTarget.placement === "swap" || undefined}
            data-drop-placement={dropTarget?.id === asset.id ? dropTarget.placement : undefined}
            aria-label={`${asset.token}${asset.name ? ` · ${asset.name}` : ""}`}
            title={allowInsertion ? "canvas.me4db5e1adee6" : "canvas.m8f43e77951da"}
            onPointerDown={(event) => {
              if (assets.length < 2 || event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
              event.preventDefault();
              event.stopPropagation();
              clearHoverPreviewTimer();
              setHoverPreview(null);
              pointerDragRef.current = { pointerId: event.pointerId, sourceId: asset.id, x: event.clientX, y: event.clientY, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const drag = pointerDragRef.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              event.preventDefault();
              event.stopPropagation();
              if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
              drag.moved = true;
              setDraggedId(drag.sourceId);
              setDropTarget(getDropTarget(event.clientX, event.clientY));
            }}
            onPointerUp={(event) => finishPointerDrag(event)}
            onPointerCancel={(event) => finishPointerDrag(event, true)}
            onLostPointerCapture={clearPointerDrag}
            onDoubleClick={(event) => {
              event.stopPropagation();
              editor?.locateCanvasNode(asset.sourceNodeId || asset.id);
            }}
            onMouseEnter={(event) => {
              clearHoverPreviewTimer();
              setHoverPreview(null);
              if (interacting || panelHidden || pointerDragRef.current || asset.kind === "audio") return;
              const target = event.currentTarget;
              hoverPreviewTimerRef.current = window.setTimeout(() => {
                hoverPreviewTimerRef.current = null;
                if (!target.isConnected || !target.matches(":hover")) return;
                const rect = target.getBoundingClientRect();
                setHoverPreview({
                  assetId: asset.id,
                  assetUrl: asset.url,
                  anchor: { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width },
                });
              }, 400);
            }}
            onMouseLeave={() => { clearHoverPreviewTimer(); setHoverPreview(null); }}
          >
            {asset.kind === "video"
              ? <VideoPosterPreview videoSrc={asset.url || ""} alt={asset.name || asset.token} showPlayIcon={false} className="h-full w-full" />
              : asset.kind === "audio"
                ? <AudioReferenceContent asset={asset} />
                : <MediaImage src={asset.url || ""} alt={asset.name || asset.token} draggable={false} className="h-full w-full object-cover" screenPreviewSize={48} />}
            {asset.kind !== "audio" && <span data-canvas-reference-sequence data-canvas-reference-frame={asset.kind === "image" && (videoInputMode === "first_frame" || videoInputMode === "first_last_frame") || undefined}>
              {asset.kind === "image" && (videoInputMode === "first_frame" || videoInputMode === "first_last_frame") ? index === 0 ? <UiText id="canvas.m0eee51419641" /> : <UiText id="canvas.m8a07f2e0a84c" /> : index + 1}
            </span>}
            {asset.kind === "video" && asset.durationSeconds ? <span className="canvas-reference-duration">{formatCanvasVideoTime(asset.durationSeconds)}</span> : null}
            <button
              type="button"
              title={text("workspaceFollowup.m9aa25ced0779", { v0: asset.token })}
              aria-label={text("workspaceFollowup.m9aa25ced0779", { v0: asset.token })}
              data-canvas-reference-remove
              onClick={(event) => {
                event.stopPropagation();
                dismissReferencePreviews();
                editor?.removeTaskReference(nodeId, asset.id);
              }}
            ><X className="h-2.5 w-2.5" /></button>
            <button
              type="button"
              title={text("workspaceFollowup.m109a9ec04373", { v0: asset.token })}
              aria-label={text("workspaceFollowup.m109a9ec04373", { v0: asset.token })}
              data-canvas-reference-mention
              onClick={(event) => {
                event.stopPropagation();
                editor?.mentionTaskReference(nodeId, asset.token);
              }}
            ><AtSign className="h-2 w-2" /></button>
            {allowInsertion && dropTarget?.id === asset.id ? (
              <span data-canvas-reference-drop-hint>
                {dropTarget.placement === "before" ? <UiText id="canvas.m1787410b4571" /> : dropTarget.placement === "after" ? <UiText id="canvas.mf06969811ba2" /> : <UiText id="canvas.mc9c3d2d17549" />}
              </span>
            ) : null}
          </div></UiProps>
        ))}
      </div>
      {!interacting && !panelHidden && textPreview && textPreviewContent && typeof document !== "undefined" && createPortal(
        <div id={`text-reference-${nodeId}-${textPreview.id}`} role="tooltip" className="canvas-text-reference-label"
          style={{ left: textPreview.left, bottom: window.innerHeight - textPreview.top + 8, maxHeight: Math.max(0, Math.min(160, textPreview.top - 16)) }}>
          {textPreviewContent}
        </div>, document.body,
      )}
      {!interacting && !panelHidden && previewAsset && hoverPreviewPosition && typeof document !== "undefined" && createPortal(
        <div
          className="canvas-task-asset-hover-preview pointer-events-none fixed -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--canvas-controls-border)] bg-[var(--canvas-controls-bg)] p-1 shadow-[var(--canvas-shadow-dropdown)]"
          style={hoverPreviewPosition}
          data-canvas-task-asset-hover-preview
        >
          {previewAsset.kind === "video"
            ? <video src={previewAsset.url} autoPlay loop muted playsInline className="block max-h-[220px] max-w-[220px] rounded-lg bg-[var(--canvas-node-bg)] object-contain" />
            : <MediaImage src={previewAsset.url || ""} alt={previewAsset.name || previewAsset.token} draggable={false} className="block max-h-[220px] max-w-[220px] rounded-lg bg-[var(--canvas-node-bg)] object-contain" previewSize={{ width: 600, height: 600, mode: "contain" }} />}
        </div>,
        document.body,
      )}
    </>
  );
}

function CanvasAudioToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const tooltipId = React.useId();
  return (
    <section className="canvas-task-parameter-section">
      <div className="canvas-task-parameter-label canvas-video-audio-label">
        <span><UiText id="canvas.mb311c8ba2968" /></span>
        <span className="canvas-video-audio-help">
          <UiProps ids={{"aria-label":["canvas.m21a4f9214c58"]}}><button type="button" aria-label="canvas.m21a4f9214c58" aria-describedby={tooltipId} className="nodrag">
            <CircleHelp aria-hidden="true" />
          </button></UiProps>
          <span id={tooltipId} role="tooltip" className="canvas-video-audio-tooltip"><UiText id="canvas.m2b7949c4318d" /></span>
        </span>
      </div>
      <UiProps ids={{"aria-label":["canvas.mb311c8ba2968"]}}><div className="canvas-video-audio-options" role="group" aria-label="canvas.mb311c8ba2968">
        <button type="button" data-selected={checked} onClick={() => onChange(true)} className="canvas-task-parameter-option nodrag"><UiText id="canvas.m8da97ddda990" /></button>
        <button type="button" data-selected={!checked} onClick={() => onChange(false)} className="canvas-task-parameter-option nodrag"><UiText id="canvas.m3fd47edce45b" /></button>
      </div></UiProps>
    </section>
  );
}

function CanvasGenerationStatus({ elapsed, onCancel, message }: { elapsed?: number; onCancel?: () => void; message?: string }) {
  const { text, label, locale } = useUiLocale();
  const readOnly = useCanvasReadOnly();
  return <CanvasGenerationEffect label={message ? label(message) : locale === "en" ? (typeof elapsed === "number" ? text("workspaceFollowup.mcba1ad24204f", { v0: elapsed.toLocaleString("en-US") }) : text("workspaceFollowup.m51d3629e97b9")) : canvasGenerationStatusText(elapsed)} onCancel={readOnly ? undefined : onCancel} />;
}

function formatCanvasParamLabel(value: string) {
  return value === "auto" || value === "adaptive" ? "自适应" : value === "custom" ? "自定义" : value;
}


type CanvasConnectionTargetState = "valid" | "invalid" | null;

function useCanvasConnectionTargetState(id: string) {
  const editor = React.useContext(CanvasNodeEditorContext);
  const xyflowState = useConnection<CanvasFlowNode, CanvasConnectionTargetState>((connection) => {
    const connectionTargetsNode = connection.toNode?.id === id;
    if (!connection.inProgress || !connectionTargetsNode) return null;
    return resolveCanvasConnectionCandidateState(connection.isValid, true);
  });
  return resolveCanvasNodeConnectionTargetState(id, xyflowState, editor?.connectionFeedbackTarget ?? null);
}

function updateCanvasConnectionTargetTilt(event: React.PointerEvent<HTMLElement>, enabled: boolean, targetElement?: HTMLElement | null) {
  if (!enabled) return;
  const target = targetElement ?? event.currentTarget;
  scheduleCanvasConnectionTargetTilt(target, { x: event.clientX, y: event.clientY });
}

function resetCanvasConnectionTargetTilt(event: React.PointerEvent<HTMLElement>, targetElement?: HTMLElement | null) {
  const target = targetElement ?? event.currentTarget;
  resetTargetTilt(target);
}

function useCanvasNodeGeometrySync(id: string, version: unknown) {
  const nodeRef = React.useRef<HTMLDivElement>(null);
  const updateNodeInternals = useUpdateNodeInternals();

  React.useLayoutEffect(() => {
    const element = nodeRef.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => updateNodeInternals(id));
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      resetCanvasConnectionTargetTilts(element);
    };
  }, [id, updateNodeInternals, version]);

  return nodeRef;
}

type TaskNodeData = Extract<CanvasNodeData, { kind: "imageTask" | "videoTask" | "audioTask" | "llm" }>;
type MediaTaskNodeData = Extract<TaskNodeData, { kind: "imageTask" | "videoTask" | "audioTask" }>;

type CanvasTaskResultPlaceholderKind = "text" | "image" | "video" | "audio";

function CanvasTaskResultPlaceholder({ kind }: { kind: CanvasTaskResultPlaceholderKind }) {
  const { text } = useUiLocale();
  return (
    <div
      data-canvas-task-result-placeholder
      data-placeholder-kind={kind}
      role="img"
      aria-label={text("workspaceFollowup.me6f5b2ed9877", { v0: kind === "text" ? text("workspaceFollowup.mdd81861811e5") : kind === "image" ? text("workspaceFollowup.md24c10d37db0") : kind === "video" ? text("workspaceFollowup.mc20f7618d330") : text("workspaceFollowup.m296c632ec857") })}
      className={`canvas-task-result-placeholder canvas-task-result-placeholder--${kind}`}
    >
      {kind === "text" ? (
        <svg viewBox="0 0 48 48" aria-hidden="true" className="canvas-task-result-placeholder-icon">
          <rect x="8" y="10" width="32" height="4" rx="1.5" />
          <rect x="8" y="18" width="24" height="4" rx="1.5" />
          <rect x="8" y="26" width="32" height="4" rx="1.5" />
          <rect x="8" y="34" width="20" height="4" rx="1.5" />
        </svg>
      ) : kind === "image" ? (
        <svg viewBox="0 0 48 48" aria-hidden="true" className="canvas-task-result-placeholder-icon">
          <circle cx="35.5" cy="13.5" r="4" />
          <path d="M6 38 18.5 21l9 11.5 6-7.5L42 38H6Z" />
        </svg>
      ) : kind === "video" ? (
        <svg viewBox="0 0 48 48" aria-hidden="true" className="canvas-task-result-placeholder-icon">
          <path d="M15 9.5c0-2.1 2.35-3.35 4.1-2.18l22.1 14.5a2.62 2.62 0 0 1 0 4.36l-22.1 14.5C17.35 41.85 15 40.6 15 38.5v-29Z" />
        </svg>
      ) : (
        <Music2 className="canvas-task-result-placeholder-icon" />
      )}
    </div>
  );
}

function TaskResultFrame({ id, data, dragging, selected, onAngleOpenChange }: { id: string; data: MediaTaskNodeData; dragging: boolean; selected: boolean; onAngleOpenChange?(open: boolean): void }) {
  const { text, label: uiLabel, error: uiError } = useUiLocale();
  const readOnly = useCanvasReadOnly();
  const editor = React.useContext(CanvasNodeEditorContext);
  const expanded = data.kind === "imageTask" && isCanvasImageBatchExpanded(data.task.batches.at(-1));
  const panelsVisible = (editor?.isTaskPanelVisible(id) || false) && !dragging && !expanded;
  const connectionInProgress = useCanvasConnectionInProgress();
  const connectionTargetState = useCanvasConnectionTargetState(id);
  const latestBatch = data.kind === "imageTask" ? data.task.batches.at(-1) : undefined;
  const outputs = latestBatch?.outputs || [];
  const imageRunning = outputs.some((output) => output.status === "submitting" || output.status === "running");
  const videoRunning = data.kind === "videoTask" && (data.status === "submitting" || data.status === "running");
  const audioRunning = data.kind === "audioTask" && (data.status === "submitting" || data.status === "running");
  const running = imageRunning || videoRunning || audioRunning;
  const imageStartedAt = outputs.map((output) => output.startedAt).filter((value): value is number => typeof value === "number").sort((a, b) => a - b)[0];
  const imageFinishedAt = outputs.map((output) => output.finishedAt).filter((value): value is number => typeof value === "number").sort((a, b) => b - a)[0];
  const startedAt = data.kind === "imageTask" ? imageStartedAt : data.startedAt;
  const finishedAt = data.kind === "imageTask" ? imageFinishedAt : data.finishedAt;
  const elapsed = useElapsedSeconds(running, startedAt, finishedAt);
  const successful = imageRunning ? [] : outputs.filter((output) => output.status === "success" && output.url);
  const frameSize = getCanvasTaskPrimaryFrameSize(data);
  const primaryOutput = imageRunning ? undefined : getCanvasPrimaryImageOutput(latestBatch);
  const [angleOutputId, setAngleOutputId] = React.useState<string | null>(null);
  const angleOutput = successful.find((output) => output.id === angleOutputId) || primaryOutput;
  const multiImage = successful.length > 1 && !outputs.some(output => ["idle", "submitting", "running"].includes(output.status));
  // 展开按钮保持固定的屏幕大小，缩小画布时不会小到点不中
  // 缩小画布时按钮跟着变小一些（但不会小到点不中）：100% 时原大小，32% 左右约为原来的 0.6 倍
  const zoom = useStore(state => state.transform[2]);
  const expandScreenScale = zoom >= 1 ? 1 : Math.max(.55, Math.min(1, Math.sqrt(zoom) * 1.05));
  const expandScale = Math.min(expandScreenScale / Math.max(zoom, .1), 6);
  const expandCompact = zoom < .5;
  // 多图里单独聚焦的一张（画布点选或从对话定位）。收起时封面临时换成它，不改主图、不写入画布
  const focusedOutputId = editor?.focusedOutput?.nodeId === id ? editor.focusedOutput.outputId : undefined;
  const focusedOutput = multiImage && focusedOutputId ? successful.find(output => output.id === focusedOutputId) : undefined;
  const coverOutput = !expanded && focusedOutput ? focusedOutput : primaryOutput;
  // 序号按生成顺序，与对话里的“第 n 张”、Agent 的 #编号/n 一致；设为主图或换位置后也不变
  const outputNumber = (outputId: string) => successful.findIndex(output => output.id === outputId) + 1;
  const focusPulse = focusedOutput ? editor?.focusedOutput?.pulse : undefined;
  const updateBatch = (patch: { expanded?: boolean; primaryOutputId?: string }) => editor?.updateData(id, current => {
    if (current.kind !== "imageTask" || current.task.batches.at(-1)?.id !== latestBatch?.id) return current;
    return { ...current, task: { ...current.task, batches: current.task.batches.map(batch => batch.id === latestBatch?.id ? { ...batch, ...patch } : batch) } };
  }, patch.primaryOutputId ? "push" : "replace");
  const resultActions = (outputId: string, primary: boolean) => (
    <div className="canvas-image-result-actions nodrag nopan" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <button type="button" onClick={() => editor?.downloadOutput(id, latestBatch!.id, outputId)}><Download /><UiText id="canvas.m4673a2306165" /></button>
      <button type="button" onClick={() => primary ? updateBatch({ expanded: false }) : updateBatch({ primaryOutputId: outputId })}>
        {primary && <Minimize2 />}{primary ? <UiText id="canvas.mafd4b783536b" /> : <UiText id="canvas.m5713527328d7" />}
      </button>
    </div>
  );
  const angleControl = (imageUrl: string) => <CanvasAngleButton
    onOpenChange={onAngleOpenChange}
    imageUrl={imageUrl}
    initialModel={data.kind === "imageTask" ? getGptImage25SelectionValue(data.task.settings.model, data.task.settings.gptImage25Mode) : undefined}
    onApply={(angle, settings) => {
      if (!editor?.generateAngle) throw new Error("画布尚未准备好");
      editor.generateAngle(id, imageUrl, angle, settings);
    }}
  />;
  const failed = data.kind === "imageTask" ? outputs.find((output) => output.status === "failed")?.error : data.error;
  const audioResultUrl = data.kind === "audioTask" && data.status === "success" ? data.outputUrl : undefined;
  const videoResultUrl = data.kind === "videoTask" && data.status === "success" ? data.outputUrl : undefined;
  const resultUrl = data.kind === "imageTask" ? coverOutput?.url : data.kind === "audioTask" ? audioResultUrl : videoResultUrl;
  const resultName = data.kind === "imageTask" && latestBatch && coverOutput
    ? editor?.getTaskResultName(id, latestBatch.id, coverOutput.id) || coverOutput.name
    : data.kind === "videoTask" && data.outputUrl
      ? editor?.getTaskResultName(id) || data.outputName
      : data.kind === "audioTask" && data.outputUrl
        ? editor?.getTaskResultName(id) || data.outputName
      : undefined;
  const [resultDimensions, setResultDimensions] = React.useState<{ url: string; width: number; height: number } | null>(null);
  const imageResolution = useCanvasImageResolution(data.kind === "imageTask" ? resultUrl : undefined,
    coverOutput?.width && coverOutput.height ? `${coverOutput.width} × ${coverOutput.height}` : undefined);
  const resultResolution = imageResolution || (resultUrl && resultDimensions?.url === resultUrl
    ? `${resultDimensions.width} × ${resultDimensions.height}`
    : undefined);
  const updateData = editor?.updateData;
  React.useEffect(() => {
    if (!updateData || !videoResultUrl || resultDimensions?.url !== videoResultUrl
      || !(resultDimensions.width > 0 && resultDimensions.height > 0)) return;
    const { width, height } = resultDimensions;
    updateData(id, current => {
      if (current.kind !== "videoTask" || !current.subtitleRemoval || current.outputUrl !== videoResultUrl) return current;
      const original = current.variants?.original;
      if (current.ratio === `${width}:${height}` && original?.width === width && original?.height === height) return current;
      return { ...current, ratio: `${width}:${height}`, variants: { ...current.variants, original: { ...original, url: videoResultUrl, width, height } } };
    }, "replace");
  }, [updateData, id, videoResultUrl, resultDimensions]);
  React.useEffect(() => {
    if (!updateData || !latestBatch?.id || !coverOutput?.id || !resultUrl || !resultResolution) return;
    const [width, height] = resultResolution.split("×").map(Number);
    updateData(id, current => hydrateCanvasTaskOutputDimensions(current, latestBatch.id, coverOutput.id, resultUrl, width, height), "replace");
  }, [updateData, id, latestBatch?.id, coverOutput?.id, resultUrl, resultResolution]);

  const primaryCard = (
    <div className="relative flex w-full justify-center" style={{ width: frameSize.width, height: frameSize.height }}>
      {!expanded && <CanvasMaterialMetadata id={id} kind={data.kind === "videoTask" ? "video" : data.kind === "audioTask" ? "audio" : "image"} name={data.title || resultName || (data.kind === "imageTask" && data.task.preset === "characterSheet" ? text("workspaceFollowup.mdc301e7f2304") : uiLabel(labels[data.kind]))} resolution={data.kind === "audioTask" ? undefined : resultResolution} />}
      {/* 收起时和单张图完全一样：不叠卡片、没有悬停动画，只在角上留一个“N张”展开按钮 */}
      <div
        data-canvas-task-result
        data-canvas-connection-target-id={id}
        data-canvas-connection-target-state={connectionTargetState || undefined}
        onPointerMove={(event) => updateCanvasConnectionTargetTilt(event, connectionTargetState === "valid")}
        onPointerLeave={resetCanvasConnectionTargetTilt}
        key={expanded && focusedOutput?.id === primaryOutput?.id ? `pulse-${focusPulse}` : !expanded && focusedOutput ? `pulse-${focusPulse}` : undefined}
        onClick={multiImage && expanded && primaryOutput ? () => editor?.focusOutput?.(id, primaryOutput.id) : undefined}
        className={`canvas-material-frame canvas-task-output-frame canvas-connection-target group/material relative flex bg-[var(--canvas-node-bg)] ${multiImage ? "" : "transition-[width,height]"} ${selected ? "canvas-material-frame-selected" : ""} ${(expanded ? focusedOutput && focusedOutput.id === primaryOutput?.id : focusedOutput) ? "canvas-image-result-focused" : ""} ${connectionTargetState === "valid" ? "canvas-connection-target-valid" : ""} ${connectionTargetState === "invalid" ? "canvas-connection-target-invalid canvas-connection-target-invalid-frame" : ""}`}
        style={{ width: frameSize.width, height: frameSize.height, zIndex: 1 }}
      >
        <Handle
          id={CANVAS_TASK_BODY_TARGET_HANDLE_ID}
          data-canvas-task-body-target
          type="target"
          position={Position.Left}
          isConnectableStart={false}
          isConnectableEnd
          className="!z-10 !rounded-[inherit] !border-0 !bg-transparent !opacity-0"
          style={{ inset: 0, width: "auto", height: "auto", transform: "none", pointerEvents: connectionInProgress ? "auto" : "none" }}
        />
        {multiImage && expanded && primaryOutput && <span className="canvas-image-result-index" aria-label={text("workspaceFollowup.m10f9f03b7f8f", { v0: outputNumber(primaryOutput.id) })}>{outputNumber(primaryOutput.id)}</span>}
        {multiImage && !expanded && focusedOutput && focusedOutput.id !== primaryOutput?.id && <span className="canvas-image-result-index" aria-label={text("workspaceFollowup.m3d95bba33337", { v0: outputNumber(focusedOutput.id) })}>{outputNumber(focusedOutput.id)}/{successful.length}</span>}
        {multiImage && primaryOutput && (expanded ? resultActions(primaryOutput.id, true) : (
          <button type="button" className="canvas-image-result-expand nodrag nopan" aria-label={text("workspaceFollowup.m0cd2d2f64ebd", { v0: successful.length })} aria-expanded={false}
            style={{ transform: `scale(${expandScale})`, transformOrigin: "top right" }}
            onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); updateBatch({ expanded: true }); }}>
            <Maximize2 />{expandCompact ? successful.length : <UiText id="canvas.m0e48e46f8edf" values={{v0: String(successful.length)}} />}
          </button>
        ))}
        {resultUrl && data.kind !== "imageTask" && !(data.kind === "audioTask" && data.audioOutputs?.length) && editor?.replaceMediaFile && <CanvasReplaceMediaButton kind={data.kind === "videoTask" ? "video" : "audio"} onUpload={file => editor.replaceMediaFile!(id, file)} onHistory={() => editor.replaceMediaHistory?.(id)} />}
        {panelsVisible && data.kind === "imageTask" && latestBatch && coverOutput && <CanvasMaterialToolbar><UiProps ids={{"title":["canvas.m184506303bf5"]}}><ToolbarButton title="canvas.m184506303bf5" onClick={() => editor?.editOutput(id, latestBatch.id, coverOutput.id, "crop")}><Scissors className="h-4 w-4" /><UiText id="canvas.m184506303bf5" /></ToolbarButton></UiProps><UiProps ids={{"title":["canvas.m05731b92ad31"]}}><ToolbarButton title="canvas.m05731b92ad31" onClick={() => editor?.editOutput(id, latestBatch.id, coverOutput.id, "brush")}><Brush className="h-4 w-4" /><UiText id="canvas.m05731b92ad31" /></ToolbarButton></UiProps><CanvasImageGridMenu onSplit={() => editor?.editOutput(id, latestBatch.id, coverOutput.id, "grid")} onCharacterSheet={() => editor?.createCharacterSheet?.(id, coverOutput.url || "")} />{angleControl(angleOutput?.url || "")}<CanvasMaterialToolbarSeparator /><UiProps ids={{"title":["canvas.m4673a2306165"]}}><ToolbarButton viewAction title="canvas.m4673a2306165" onClick={() => editor?.downloadOutput(id, latestBatch.id, coverOutput.id)}><Download className="h-4 w-4" /><UiText id="canvas.m4673a2306165" /></ToolbarButton></UiProps><CanvasSaveToLibraryButton onClick={() => editor?.saveOutputToLibrary(id, latestBatch.id, coverOutput.id)} /><CanvasMaterialPreviewButton onClick={() => editor?.previewOutput(id, latestBatch.id, coverOutput.id)} /></CanvasMaterialToolbar>}
        {panelsVisible && data.kind === "videoTask" && videoResultUrl && <CanvasMaterialToolbar><CanvasVideoClipButton breakdown={editor?.breakdownVideo ? { models: editor.breakdownModels ?? [], onStart: model => editor.breakdownVideo!(id, videoResultUrl!, model) } : undefined} /><CanvasVideoSubtitleRemovalButton /><CanvasVideoSeparateButton job={editor?.videoSeparationJobs?.[id]} onSeparate={editor?.separateVideo ? (mode) => editor.separateVideo!(id, videoResultUrl!, undefined, undefined, mode) : undefined} /><CanvasVideoFrameControl placement="toolbar" /><CanvasMaterialToolbarSeparator /><UiProps ids={{"title":["canvas.m4673a2306165"]}}><ToolbarButton viewAction title="canvas.m4673a2306165" onClick={() => editor?.downloadMedia(id)}><Download className="h-4 w-4" /><UiText id="canvas.m4673a2306165" /></ToolbarButton></UiProps><CanvasSaveToLibraryButton onClick={() => editor?.saveMediaToLibrary(id)} /><CanvasMaterialPreviewButton onClick={() => editor?.previewMedia(id)} /></CanvasMaterialToolbar>}
        {panelsVisible && data.kind === "audioTask" && audioResultUrl && <CanvasMaterialToolbar><CanvasAudioTrimButton /><CanvasAudioSpeedButton /><UiProps ids={{"title":["canvas.m4673a2306165"]}}><ToolbarButton viewAction title="canvas.m4673a2306165" onClick={() => editor?.downloadMedia(id)}><Download className="h-4 w-4" /><UiText id="canvas.m4673a2306165" /></ToolbarButton></UiProps><CanvasSaveToLibraryButton onClick={() => editor?.saveMediaToLibrary(id)} /></CanvasMaterialToolbar>}
        <CanvasConnectionHandle handleId={CANVAS_TASK_INPUT_HANDLE_ID} type="target" connectionInProgress={connectionInProgress} />
      <div
        data-canvas-task-result-media
        className="canvas-task-result-media-surface absolute inset-0 overflow-hidden rounded-[inherit]"
      >
          {data.kind === "audioTask" && audioResultUrl && data.audioOutputs?.length ? (
            <CanvasSunoResult id={id} data={data} headerActions={editor?.replaceMediaFile ? <CanvasReplaceMediaButton kind="audio" placement="inline" onUpload={file => editor.replaceMediaFile!(id, file)} onHistory={() => editor.replaceMediaHistory?.(id)} /> : undefined} onSelect={index => editor?.updateData(id, current => {
              if (current.kind !== "audioTask") return current;
              const track = current.audioOutputs?.[index];
              return track ? { ...current, selectedAudioIndex: index, outputUrl: track.url, outputName: track.title, durationSeconds: track.durationSeconds, waveformPeaks: undefined } : current;
            })} onExpand={readOnly ? undefined : () => editor?.expandAudioOutputs?.(id)} onWaveformReady={waveform => editor?.updateData(id, current => current.kind === "audioTask" && current.outputUrl === data.outputUrl ? { ...current, waveformPeaks: waveform.waveformPeaks, durationSeconds: waveform.durationSeconds } : current, "replace")} />
          ) : data.kind === "audioTask" && audioResultUrl ? (
            <CanvasAudioNode
              id={id}
              selected={false}
              data={{
                kind: "audio",
                origin: "generated",
                url: audioResultUrl,
                name: resultName,
                prompt: data.prompt,
                model: data.model,
                waveformPeaks: data.waveformPeaks,
                durationSeconds: data.durationSeconds,
              }}
              onWaveformReady={(waveform) => editor?.hydrateAudioWaveform(id, waveform)}
            />
          ) : data.kind === "videoTask" && videoResultUrl ? (
            <CanvasVideoPlayer src={videoResultUrl} poster={data.variants?.poster?.url || data.variants?.thumbnail?.url} onLoadedMetadata={(video) => setResultDimensions({ url: videoResultUrl, width: video.videoWidth, height: video.videoHeight })} className={data.subtitleRemoval ? "h-full w-full object-contain" : "h-full w-full object-cover"} />
          ) : coverOutput ? (
            <div className="group/material relative h-full w-full overflow-hidden bg-[var(--input-bg)]">
              {!expanded && editor?.replaceMediaFile && <div className={multiImage ? "[&>div]:left-2 [&>div]:right-auto" : undefined}><CanvasReplaceMediaButton kind="image" onUpload={file => editor.replaceMediaFile!(id, file, coverOutput.id)} onHistory={() => editor.replaceMediaHistory?.(id, coverOutput.id)} /></div>}
              <UiProps ids={{"alt":["canvas.mc6a6d590a95d"]}}><MediaImage src={coverOutput.url!} alt={coverOutput.id === primaryOutput?.id ? "canvas.mc6a6d590a95d" : text("workspaceFollowup.m10f9f03b7f8f", { v0: outputNumber(coverOutput.id) })} draggable={false} onOriginalLoad={(event) => setResultDimensions({ url: coverOutput.url!, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} className="h-full w-full object-contain" previewSize={{ width: 1200, height: 1200 }} /></UiProps>
            </div>
          ) : running ? (
          <div className="flex h-full w-full items-center justify-center">
              <CanvasGenerationStatus elapsed={elapsed} message={data.kind === "audioTask" && isSunoModel(data.model) ? data.error : undefined} onCancel={data.kind === "audioTask" && isSunoModel(data.model) ? undefined : () => editor?.cancelNode(id)} />
            </div>
          ) : failed ? (
            <div data-canvas-task-failure className="flex h-full w-full items-center justify-center px-5 text-center text-xs text-[var(--app-muted)]"><span className="line-clamp-3">{uiError(friendlyErrorDisplayText(failed))}</span></div>
          ) : (
            <CanvasTaskResultPlaceholder kind={data.kind === "videoTask" ? "video" : data.kind === "audioTask" ? "audio" : "image"} />
          )}
        </div>
        <CanvasConnectionHandle type="source" connectionInProgress={connectionInProgress} />
      </div>
    </div>
  );
  if (!expanded || data.kind !== "imageTask") return primaryCard;
  const layout = getCanvasImageResultLayout(data);
  return (
    <div data-canvas-image-results-expanded className="grid" style={{ width: layout.width, height: layout.height, gap: layout.gap, gridTemplateColumns: `repeat(${layout.columns}, ${frameSize.width}px)` }}>
      {/* 展开时浮在所有节点之上，背后压暗；点暗处收起 */}
      <div aria-hidden="true" className="canvas-image-results-backdrop nodrag nopan" onPointerDown={event => { event.stopPropagation(); updateBatch({ expanded: false }); }} />
      {layout.outputs.map((output, index) => output.id === primaryOutput?.id
        ? <React.Fragment key={output.id}>{primaryCard}</React.Fragment>
        : <div key={focusedOutput?.id === output.id ? `${output.id}:${focusPulse}` : output.id} data-canvas-angle-source-selected={angleOutput?.id === output.id || undefined} className={`canvas-material-frame pointer-events-auto relative ${focusedOutput?.id === output.id ? "canvas-image-result-focused" : ""}`} style={{ width: frameSize.width, height: frameSize.height }} onClick={() => { setAngleOutputId(output.id); editor?.focusOutput?.(id, output.id); }}>
            <MediaImage src={output.url!} alt={text("workspaceFollowup.m54f6aa251961", { v0: index + 1 })} draggable={false} className="h-full w-full object-contain" previewSize={{ width: 1200, height: 1200 }} />
            <span className="canvas-image-result-index" aria-hidden="true">{outputNumber(output.id)}</span>
            {resultActions(output.id, false)}
            {angleOutput?.id === output.id && <div className="canvas-image-result-angle nodrag nopan">{angleControl(output.url!)}</div>}
          </div>)}
    </div>
  );
}

function ImageTaskPanel({ id, data, assets }: { id: string; data: Extract<CanvasNodeData, { kind: "imageTask" }>; assets: PromptReferenceAsset[] }) {
  const { text, label: uiLabel } = useUiLocale();
  const readOnly = useCanvasReadOnly();
  const editor = React.useContext(CanvasNodeEditorContext);
  const models = useCanvasModels();
  const [parameterPanelOpen, setParameterPanelOpen] = React.useState<"model" | "params" | null>(null);
  const imageModelTriggerRef = React.useRef<HTMLButtonElement>(null);
  const imageParamsTriggerRef = React.useRef<HTMLButtonElement>(null);
  const settings = data.task.settings;
  const isCharacterSheet = data.task.preset === "characterSheet";
  const creativeEditorRef = React.useRef<PromptCreativeEditorHandle>(null);
  const imagePrompt = withLegacyCreativeTokens(settings.prompt, settings.creativePresets);
  const availableImageModels = isCharacterSheet
    ? (models?.image || []).filter((model) => model.params.aspectRatios.some((option) => option.value === "16:9" && !option.disabled))
    : models?.image || [];
  const imageModel = resolveCanvasModelId(availableImageModels, settings.model);
  const selectedModel = models?.image.find((model) => model.id === imageModel);
  const params: ReturnType<typeof getCanvasImageModelParams> = isOpenRouterImageModel(imageModel) ? getOpenRouterImageParams(imageModel, settings.aspectRatio) : selectedModel?.params || getCanvasImageModelParams(imageModel || "nano-banana-pro", settings.resolution, settings.aspectRatio);
  const fixedImageCount = isMidjourneyV8Model(imageModel)
    ? getCanvasImageDisplayCount(imageModel, settings.count)
    : null;
  const isMidjourney = isMidjourneyV8Model(imageModel);
  const midjourneySpeed = normalizeMidjourneyV8Speed(settings.midjourneySpeed);
  const displayedImageCount = fixedImageCount ?? settings.count;
  const imageCountOptions = fixedImageCount ? [fixedImageCount] : [...CANVAS_IMAGE_COUNT_OPTIONS];
  const resolutionValue = params.resolutions.some((option) => option.value === settings.resolution && !option.disabled)
    ? settings.resolution
    : params.defaultResolution;
  const resolutionLabel = uiLabel(params.resolutions.find((option) => option.value === resolutionValue)?.label || resolutionValue);
  const running = data.task.batches.some((batch) => batch.outputs.some((output) => output.status === "submitting" || output.status === "running"));
  const updateSettings = (patch: Partial<typeof settings>) => editor?.updateData(id, (current) => current.kind === "imageTask" ? { ...current, task: { ...current.task, settings: { ...current.task.settings, ...patch } } } : current);
  const changeModel = (model: string) => {
    editor?.changeTaskModel(id, model);
    setParameterPanelOpen(null);
  };
  const imageModelOptions = expandGptImage25ModelOptions(availableImageModels.map((model) => ({ ...model, value: model.id })));
  const selectedImageModelValue = getGptImage25SelectionValue(imageModel, settings.gptImage25Mode);
  const qualityValue = params.qualities.some((option) => option.value === settings.quality)
    ? settings.quality
    : params.defaultQuality;
  const qualityLabel = uiLabel(params.qualities.find((option) => option.value === qualityValue)?.label || qualityValue);
  const gifOutput = supportsGptImage26Gif(imageModel) && settings.outputFormat === "gif";
  const parameterSummary = gifOutput ? text("workspaceFollowup.m695393ebdbf3", { v0: settings.gifSize || "512x512", v1: settings.frameCount ?? 9, v2: displayedImageCount }) : isMidjourney ? [
    uiLabel(formatCanvasParamLabel(settings.aspectRatio)),
    imageModel === APIMART_MIDJOURNEY_V8_MODEL_ID ? midjourneyVersionLabel(settings.midjourneyOptions?.version) : null,
    ({ relax: text("workspaceFollowup.ma63d2ddd3f94"), fast: text("workspaceFollowup.mdb945cfe9f9f"), turbo: text("workspaceFollowup.m89bc4cb34d02") } as const)[midjourneySpeed],
    settings.midjourneyOptions?.hd ? "HD" : null,
    text("workspaceFollowup.m2fd724033f0d", { v0: displayedImageCount }),
  ].filter(Boolean).join(" · ") : [
    (imageModel === "image 2" || (isSeedream55Model(imageModel) && !settings.seedream55?.layerDecomposition)) && settings.aspectRatio === "custom" ? settings.customSize || text("workspaceFollowup.m4eafa9e925b3") : uiLabel(formatCanvasParamLabel(settings.aspectRatio)),
    isQwenImage3Model(imageModel) ? qualityLabel : resolutionLabel,
    isQwenImage3Model(imageModel) ? (settings.aspectRatio === "auto" ? text("workspaceFollowup.mc424d127e2af") : resolutionLabel) : params.qualities.length ? qualityLabel : null,
    supportsImageBackground(imageModel) ? uiLabel(GPT_IMAGE_25_BACKGROUND_OPTIONS.find((option) => option.value === (settings.background || "auto"))?.label) : null,
    googleImageSettingsSummary(imageModel, settings, uiLabel),
    text("workspaceFollowup.m2fd724033f0d", { v0: displayedImageCount }),
  ].filter(Boolean).join(" · ");
  const parameterPopoverMaxHeight = parameterPanelOpen === "model" ? 400 : 560;
  const parameterAnchorRef = parameterPanelOpen === "params"
    ? imageParamsTriggerRef
    : imageModelTriggerRef;

  const renderImageTaskPanel = (expanded: boolean) => (
    <div
      data-canvas-task-panel
      data-canvas-image-task-panel
      className="canvas-generator-content"
    >
      <div className="pr-8">
        <ConnectedAssets nodeId={id} assets={assets} allowInsertion />
      </div>
      <div className={`canvas-generator-prompt-surface${expanded ? " canvas-generator-prompt-surface--expanded min-h-0 flex-1" : ""}`}>
        <UiProps ids={{"placeholder":["canvas.m1b3092f7022f"]}}><PromptRichEditor
          disabled={readOnly}
          value={imagePrompt}
          creativeEditorRef={creativeEditorRef}
          assets={assets}
          onValueChange={(prompt) => editor?.updateData(id, (current) => current.kind === "imageTask" ? { ...current, task: { ...current.task,
            preset: prompt.includes(CHARACTER_SHEET_TOKEN) ? "characterSheet" : undefined,
            settings: { ...current.task.settings, prompt, creativePresets: undefined, aspectRatio: prompt.includes(CHARACTER_SHEET_TOKEN) ? "16:9" : current.task.settings.aspectRatio },
          } } : current)}
          onKeyDown={(event) => {
            if (!event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              editor?.runNode(id);
            }
          }}
          placeholder="canvas.m1b3092f7022f"
          autoFocus={expanded}
          expanded={expanded}
          variant="canvasGenerator"
          className="nodrag"
        /></UiProps>
      </div>
      <div data-canvas-image-task-bottom-row className="mt-auto flex items-center gap-2">
        <div data-canvas-image-parameter-dock className="relative shrink-0">
          <div className="canvas-task-parameter-bar">
            <button ref={imageModelTriggerRef} type="button" aria-expanded={parameterPanelOpen === "model"} data-open={parameterPanelOpen === "model" || undefined} onClick={() => setParameterPanelOpen((value) => value === "model" ? null : "model")} className="canvas-task-parameter-trigger">
              <span className="whitespace-nowrap">{getGptImage25ModelLabel(imageModel, selectedModel?.label || getCanvasImageModelDisplayLabel(settings.model) || "选择图片模型", settings.gptImage25Mode, selectedModel?.gptImage25Variants)}</span>
              <ChevronDown className={`h-4 w-4 shrink-0 opacity-70 transition-transform ${parameterPanelOpen === "model" ? "rotate-180" : ""}`} />
            </button>
            <div className="canvas-task-parameter-divider" />
            <button ref={imageParamsTriggerRef} type="button" aria-expanded={parameterPanelOpen === "params"} data-open={parameterPanelOpen === "params" || undefined} onClick={() => setParameterPanelOpen((value) => value === "params" ? null : "params")} className="canvas-task-parameter-trigger">
              {!gifOutput && <span className="shrink-0 opacity-80"><CanvasAspectRatioIcon value={settings.aspectRatio} compact /></span>}
              <span className="whitespace-nowrap">{parameterSummary}</span>
              <ChevronDown className={`h-4 w-4 shrink-0 opacity-70 transition-transform ${parameterPanelOpen === "params" ? "rotate-180" : ""}`} />
            </button>
            <PresetPromptButton id={id} />
          </div>
          <CanvasTaskParameterPopover
            open={Boolean(parameterPanelOpen)}
            anchorRef={parameterAnchorRef}
            onClose={() => setParameterPanelOpen(null)}
            width={360}
            maxHeight={parameterPopoverMaxHeight}
            align="start"
            side="top"
            className={`canvas-image-parameter-popover${parameterPanelOpen === "model" ? " canvas-task-model-popover" : ""}`}
          >
            <div data-canvas-image-parameter-popover data-parameter-panel={parameterPanelOpen || undefined}>
              {parameterPanelOpen === "model" && (
                <div className="space-y-0.5">
                  {imageModelOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      data-selected={option.value === selectedImageModelValue}
                      onClick={() => changeModel(option.value)}
                      className="canvas-task-model-option"
                    >
                      <span className="canvas-task-model-label">{option.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {parameterPanelOpen === "params" && (
                <div
                  className="canvas-task-parameter-sections canvas-param-card-sections"
                  data-pair-quality-resolution={(params.qualities.length > 0 && !isMidjourney && !gifOutput) || undefined}
                  data-pair-count-format={supportsGptImage26Gif(imageModel) || undefined}
                >
                  <GoogleImageSettings canvas model={imageModel} settings={settings} onChange={updateSettings} />
                  {params.qualities.length ? (
                    <section className="canvas-task-parameter-section" data-param-card="quality">
                      <div className="canvas-task-parameter-label">{isQwenImage3Model(imageModel) ? <UiText id="canvas.m0ab5629be565" /> : <UiText id="canvas.m77ccdb7ba817" />}</div>
                      <div className={`grid ${isQwenImage3Model(imageModel) ? "grid-cols-2" : "grid-cols-3"} gap-2`}>
                        {params.qualities.map((option) => (
                          <button key={option.value} type="button" data-selected={option.value === qualityValue} disabled={option.disabled} onClick={() => !option.disabled && updateSettings({ quality: option.value })} className="canvas-task-parameter-option">
                            <span className="min-w-0 truncate">{uiLabel(option.label)}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {isMidjourney || gifOutput ? null : <section className="canvas-task-parameter-section" data-param-card="resolution">
                    <div className="canvas-task-parameter-label">{isQwenImage3Model(imageModel) ? <UiText id="canvas.m0e22652107f5" /> : <UiText id="canvas.mb92421822c21" />}</div>
                    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${isOpenRouterImageModel(imageModel) ? 3 : Math.min(3, Math.max(1, params.resolutions.length))}, minmax(0, 1fr))` }}>
                      {(isOpenRouterImageModel(imageModel) ? getOpenRouterResolutionDisplayOptions(imageModel, settings.aspectRatio) : params.resolutions).map((option) => (
                        <button key={option.value} type="button" data-selected={option.value === resolutionValue} disabled={option.disabled || (isQwenImage3Model(imageModel) && settings.aspectRatio === "auto")} onClick={() => !option.disabled && updateSettings({ resolution: option.value })} className="canvas-task-parameter-option">
                          <span className="min-w-0 truncate">{uiLabel(option.label)}</span>
                        </button>
                      ))}
                    </div>
                  </section>}
                  {!gifOutput && !(isSeedream55Model(imageModel) && settings.seedream55?.layerDecomposition) ? <section className="canvas-task-parameter-section" data-param-card="ratio">
                    <div className="canvas-task-parameter-label"><UiText id="canvas.m82a59f3d1c16" /></div>
                    <div className="canvas-image-parameter-ratio-grid" data-single-option={isCharacterSheet || undefined}>
                      {sortAspectRatioOptions(params.aspectRatios).filter((option) => !isCharacterSheet || option.value === "16:9").map((option) => {
                        const selected = option.value === settings.aspectRatio;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            data-selected={selected}
                            disabled={option.disabled}
                            onClick={() => !option.disabled && updateSettings({ aspectRatio: option.value })}
                            className="canvas-task-parameter-option canvas-task-aspect-option"
                          >
                            <CanvasAspectRatioIcon value={option.value} />
                            <span>{uiLabel(formatCanvasParamLabel(option.label))}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section> : null}
                  {isQwenImage3Model(imageModel) && settings.aspectRatio === "auto" ? <p className="text-xs text-[var(--app-muted)]"><UiText id="canvas.mf4ef031c8b95" /></p> : null}
                  {isMidjourney ? (
                    <MidjourneySettings
                      canvas
                      speed={midjourneySpeed}
                      showVersion={imageModel === APIMART_MIDJOURNEY_V8_MODEL_ID}
                      options={settings.midjourneyOptions ?? {}}
                      prompt={settings.prompt}
                      hasReferences={assets.some(asset => asset.kind === "image")}
                      disabled={readOnly}
                      onChange={patch => updateSettings({ ...(patch.speed ? { midjourneySpeed: patch.speed } : {}), ...(patch.options ? { midjourneyOptions: patch.options } : {}) })}
                    />
                  ) : null}
                  {(imageModel === "image 2" || (isSeedream55Model(imageModel) && !settings.seedream55?.layerDecomposition)) && settings.aspectRatio === "custom" ? (
                    <label className="canvas-task-parameter-section">
                      <span className="canvas-task-parameter-label"><UiText id="canvas.m8a2e28474a49" /></span>
                      <UiProps ids={{"aria-label":["canvas.m8a2e28474a49"]}}><input
                        value={settings.customSize || ""}
                        onChange={(event) => updateSettings({ customSize: event.target.value })}
                        placeholder="1024x1024"
                        aria-label="canvas.m8a2e28474a49"
                        className="canvas-task-parameter-input"
                      /></UiProps>
                    </label>
                  ) : null}
                  <GptImage25OutputSettings canvas model={imageModel} background={settings.background} outputFormat={settings.outputFormat} gifSize={settings.gifSize} frameCount={settings.frameCount} frameDurationMs={settings.frameDurationMs} seedream55={settings.seedream55} onChange={updateSettings} />
                  <section className="canvas-task-parameter-section" data-param-card="count">
                    <div className="canvas-task-parameter-label"><UiText id="canvas.m1e3c56a9a4ca" /></div>
                    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${imageCountOptions.length}, minmax(0, 1fr))` }}>
                      {imageCountOptions.map((count) => (
                        <button key={count} type="button" data-selected={displayedImageCount === count} aria-disabled={Boolean(fixedImageCount)} onClick={() => !fixedImageCount && updateSettings({ count })} className="canvas-task-parameter-option">
                          {count}<UiText id="canvas.me9e0fdc242b4" /></button>
                      ))}
                    </div>
                  </section>
                </div>
              )}
            </div>
          </CanvasTaskParameterPopover>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <TaskSubmitButton onClick={() => editor?.runNode(id)} disabled={running || !selectedModel} running={running} label={text("workspaceFollowup.m114a5a22f0ed", { v0: displayedImageCount })} />
        </div>
      </div>
    </div>
  );

  return (
    <UiProps ids={{"title":["canvas.mdc301e7f2304","canvas.mc62a58459251"]}}><CanvasGeneratorShell
      nodeId={id}
      title={isCharacterSheet ? "canvas.mdc301e7f2304" : "canvas.mc62a58459251"}
    >
      {(expanded) => renderImageTaskPanel(expanded)}
    </CanvasGeneratorShell></UiProps>
  );
}

function LlmTaskResultFrame({ id, data, dragging, selected }: { id: string; data: Extract<TaskNodeData, { kind: "llm" }>; dragging: boolean; selected: boolean }) {
  const { error: uiError } = useUiLocale();
  const readOnly = useCanvasReadOnly();
  const hasIncomingConnection = useStore(state => state.edges.some(edge => edge.target === id));
  const editor = React.useContext(CanvasNodeEditorContext);
  const [editingOutput, setEditingOutput] = React.useState(false);
  const [outputDraft, setOutputDraft] = React.useState("");
  const finishOutputEditing = () => {
    if (outputDraft !== data.output) {
      editor?.updateData(id, current => current.kind === "llm" && current.status !== "running" && current.status !== "submitting"
        ? { ...current, output: outputDraft } : current);
    }
    setEditingOutput(false);
  };
  const panelsVisible = (editor?.isTaskPanelVisible(id) || false) && !dragging;
  const connectionInProgress = useCanvasConnectionInProgress();
  const connectionTargetState = useCanvasConnectionTargetState(id);
  const running = data.status === "submitting" || data.status === "running";

  return (
    <div className="relative flex w-full justify-center">
      <div
        data-canvas-task-result
        data-canvas-llm-result
        data-canvas-connection-target-id={id}
        data-canvas-connection-target-state={connectionTargetState || undefined}
        onPointerMove={(event) => updateCanvasConnectionTargetTilt(event, connectionTargetState === "valid")}
        onPointerLeave={resetCanvasConnectionTargetTilt}
        className={`canvas-material-frame canvas-task-output-frame canvas-connection-target group/material relative flex bg-[var(--canvas-node-bg)] ${selected ? "canvas-material-frame-selected" : ""} ${connectionTargetState === "valid" ? "canvas-connection-target-valid" : ""} ${connectionTargetState === "invalid" ? "canvas-connection-target-invalid canvas-connection-target-invalid-frame" : ""}`}
        style={getCanvasTextTaskFrameSize(data)}
      >
        <CanvasNodeHeading className="canvas-text-node-title"><MessageSquareText className="h-3.5 w-3.5 shrink-0" /><CanvasEditableNodeName name={data.title || editor?.getTextNodeTitle?.(id) || "文本节点"} onRename={value => editor?.updateData(id, current => renameCanvasNodeData(current, value), "push")} /></CanvasNodeHeading>
        <Handle
          id={CANVAS_TASK_BODY_TARGET_HANDLE_ID}
          data-canvas-task-body-target
          type="target"
          position={Position.Left}
          isConnectableStart={false}
          isConnectableEnd
          className="!z-10 !rounded-[inherit] !border-0 !bg-transparent !opacity-0"
          style={{ inset: 0, width: "auto", height: "auto", transform: "none", pointerEvents: connectionInProgress ? "auto" : "none" }}
        />
        <CanvasConnectionHandle handleId={CANVAS_TASK_INPUT_HANDLE_ID} type="target" connectionInProgress={connectionInProgress} />
        <div data-canvas-text-output-scroll className="nowheel absolute inset-0 overflow-auto overscroll-contain rounded-[inherit] p-4 text-[13px] leading-6 text-[var(--canvas-controls-text)]"
          onWheel={event => { if (editingOutput && !event.ctrlKey && !event.metaKey) event.stopPropagation(); }}>
          {running ? (
            <div className="flex h-full items-center justify-center"><CanvasGenerationStatus onCancel={() => editor?.cancelNode(id)} /></div>
          ) : editingOutput ? (
            <UiProps ids={{"aria-label":["canvas.m2fc1a3300aa6"]}}><textarea aria-label="canvas.m2fc1a3300aa6" autoFocus value={outputDraft}
              className="nodrag nopan nowheel h-full w-full resize-none border-0 bg-transparent p-0 text-[13px] leading-6 text-[var(--canvas-controls-text)] outline-none"
              onChange={event => setOutputDraft(event.target.value)}
              onBlur={finishOutputEditing}
              onPointerDown={event => event.stopPropagation()}
              onDoubleClick={event => event.stopPropagation()}
              onKeyDown={event => {
                event.stopPropagation();
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Escape") { event.preventDefault(); setEditingOutput(false); }
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); finishOutputEditing(); }
              }} /></UiProps>
          ) : data.output !== undefined ? <div className="min-h-full select-none whitespace-pre-wrap break-words"
            onDoubleClick={event => {
              if (readOnly || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
              event.preventDefault();
              // Bubble to the board so the same double-click also focuses the node.
              setOutputDraft(data.output || "");
              setEditingOutput(true);
            }}>{data.output}</div> : data.error ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-[var(--canvas-controls-text-muted)]">{uiError(data.error)}</div>
          ) : (
            hasIncomingConnection ? <div className="flex h-full items-center justify-center" data-canvas-text-awaiting-prompt><CanvasTaskResultPlaceholder kind="text" /></div> : <div className="canvas-text-start" data-canvas-text-start>
              <div className="canvas-text-start-icon"><CanvasTaskResultPlaceholder kind="text" /></div>
              <div className="canvas-text-start-actions nodrag nopan">
                <p><UiText id="canvas.mcc70740f26cc" /></p>
                {!readOnly && <button type="button" onClick={() => editor?.startTextWriting?.(id)}><MessageSquareText /><UiText id="canvas.ma3437dfd5c1a" /></button>}
                <UiProps ids={{"title":["canvas.m5f128190fc09"]}}><button type="button" disabled title="canvas.m5f128190fc09"><Film /><UiText id="canvas.m0ea604fc4a26" /></button></UiProps>
                <UiProps ids={{"title":["canvas.m5f128190fc09"]}}><button type="button" disabled title="canvas.m5f128190fc09"><ImageIcon /><UiText id="canvas.m022997dcbac7" /></button></UiProps>
                <UiProps ids={{"title":["canvas.m5f128190fc09"]}}><button type="button" disabled title="canvas.m5f128190fc09"><Volume2 /><UiText id="canvas.m10933c57e52c" /></button></UiProps>
              </div>
            </div>
          )}
        </div>
        <CanvasConnectionHandle type="source" connectionInProgress={connectionInProgress} />
        {!readOnly && data.output !== undefined && <NodeResizeControl
          position="bottom-right"
          minWidth={350}
          minHeight={200}
          className="canvas-text-result-resize"
          onResize={(_, size) => editor?.updateNodeSize(id, { width: size.width, height: size.height })}
          onResizeEnd={() => editor?.finishNodeResize?.()}
        />}
      </div>
    </div>
  );
}

function PresetPromptButton({ id }: { id: string }) {
  const editor = React.useContext(CanvasNodeEditorContext);
  return (
    <>
      <div className="canvas-task-parameter-divider" aria-hidden="true" />
      <button type="button" className="canvas-task-parameter-trigger canvas-generator-preset-button" onClick={() => editor?.openTemplate(id)}>
        <MessageSquareText className="h-3.5 w-3.5 shrink-0" /><UiText id="canvas.mb46a606b401c" /></button>
    </>
  );
}

function VideoTaskPanel({ id, data, assets }: { id: string; data: Extract<CanvasNodeData, { kind: "videoTask" }>; assets: PromptReferenceAsset[] }) {
  const { text, label: uiLabel } = useUiLocale();
  const readOnly = useCanvasReadOnly();
  const editor = React.useContext(CanvasNodeEditorContext);
  const creativeEditorRef = React.useRef<PromptCreativeEditorHandle>(null);
  const videoPrompt = withLegacyCreativeTokens(data.prompt, data.creativePresets);
  const models = useCanvasModels();
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const advancedTriggerRef = React.useRef<HTMLButtonElement>(null);
  const model = resolveCanvasModelId(models?.video || [], data.model);
  const selectedVideoModel = models?.video.find((item) => item.id === model);
  const spec = React.useMemo(
    () => getVideoDisplaySpec(model, models?.video || []),
    [model, models?.video],
  );
  const isSeedance25 = isSeedance25VideoModel(model);
  const isMiniMaxH3 = isMiniMaxH3VideoModel(model);
  const videoReferences = editor?.getTaskVideoReferences?.(id) ?? assets;
  const hasReferenceMedia = videoReferences.length > 0;
  const hasReferenceVideo = videoReferences.some(reference => reference.kind === "video");
  const omniReferenceTaskType = data.omniReferenceTaskType === "edit" && !hasReferenceVideo ? "auto" : data.omniReferenceTaskType;
  const inputModeValue = resolveCanvasVideoInputMode(data.inputMode, spec, videoReferences);
  const referenceError = getCanvasVideoReferenceError(model, videoReferences, inputModeValue, true);
  const miniMaxH3TextMode = isMiniMaxH3 && inputModeValue === "text_to_video";
  const requiresAdaptive = (isSeedance25 || isMiniMaxH3) && (
    inputModeValue === "first_frame"
    || inputModeValue === "first_last_frame"
    || (isSeedance25 && omniReferenceTaskType === "edit")
    || (isSeedance25 && omniReferenceTaskType === "extend")
  );
  const ratioOptions = (spec.supportedRatios || ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"])
    .filter((value) => !requiresAdaptive || value === "adaptive")
    .filter((value) => !(miniMaxH3TextMode && value === "adaptive"))
    .map((value) => ({ value, label: value === "adaptive" || value === "auto" ? "自适应" : value }));
  const durationValues = spec.durationOptions || Array.from({ length: spec.maxDurationSeconds - spec.minDurationSeconds + 1 }, (_, index) => spec.minDurationSeconds + index);
  const durationOptions = omniReferenceTaskType === "edit" && isSeedance25
    ? [{ value: "-1", label: text("workspaceFollowup.m7eb336e42cb5") }]
    : [...(spec.allowAutoDuration ? [{ value: "-1", label: text("workspaceFollowup.m7eb336e42cb5") }] : []), ...durationValues.map((value) => ({ value: String(value), label: `${value}s` }))];
  const effectiveResolution = getVideoDisplayResolution(spec, data.resolution);
  const orderedInputModes = (["multimodal", "first_last_frame", "first_frame", "text_to_video"] as const)
    .filter((value) => spec.supportedInputModes.includes(value));
  const inputModeOptions = orderedInputModes.flatMap((value) => {
    const option = { value, label: value === "text_to_video" ? text("workspaceFollowup.m0ea604fc4a26") : value === "first_frame" ? text("workspaceFollowup.m7ad8efa70b58") : value === "first_last_frame" ? text("workspaceFollowup.ma44f24ac18b3") : text("workspaceFollowup.m47c8726b74ff"), disabled: value === "text_to_video" ? hasReferenceMedia : !hasReferenceMedia || Boolean(getCanvasVideoReferenceError(model, videoReferences, value)) };
    return isSeedance25 && value === "multimodal"
      ? [option, { value: "edit", label: text("workspaceFollowup.m4d3c81d0c90b"), disabled: !hasReferenceVideo }, { value: "extend", label: text("workspaceFollowup.m6042c5e9e4e0"), disabled: !hasReferenceMedia }]
      : [option];
  });
  const selectedInputModeValue = isSeedance25
    && inputModeValue === "multimodal"
    && (omniReferenceTaskType === "edit" || omniReferenceTaskType === "extend")
    ? omniReferenceTaskType
    : inputModeValue;
  const durationValue = String(data.duration ?? durationOptions[0]?.value ?? "");
  const storedDurationIndex = durationOptions.findIndex((option) => option.value === durationValue);
  const durationIndex = Math.max(0, storedDurationIndex);
  const durationLabel = uiLabel(storedDurationIndex >= 0
    ? durationOptions[storedDurationIndex]?.label
    : durationOptions[0]?.label);
  const effectiveRatio = ratioOptions.some((option) => option.value === data.ratio)
    ? data.ratio!
    : ratioOptions[0]?.value || "";
  const selectedInputModeLabel = inputModeOptions.find((option) => option.value === selectedInputModeValue)?.label;
  const videoParameterSummary = [
    uiLabel(formatCanvasParamLabel(effectiveRatio)),
    effectiveResolution,
    durationLabel,
  ].filter(Boolean).join(" · ");
  const running = data.status === "submitting" || data.status === "running";
  const videoParametersValid = data.inputMode === inputModeValue
    && data.resolution === effectiveResolution
    && data.ratio === effectiveRatio
    && storedDurationIndex >= 0;
  const update = (patch: Partial<typeof data>) => editor?.updateData(id, (current) => current.kind === "videoTask" ? { ...current, ...patch } : current);
  const changeModel = (nextModel: string) => {
    editor?.changeTaskModel(id, nextModel);
  };
  const changeInputMode = (nextMode: string) => {
    if (nextMode === "text_to_video" ? hasReferenceMedia : !hasReferenceMedia) return;
    if (nextMode === "edit" && !hasReferenceVideo) return;
    if (getCanvasVideoReferenceError(model, videoReferences, nextMode)) return;
    if (isSeedance25 && (nextMode === "edit" || nextMode === "extend")) {
      update({
        inputMode: "multimodal",
        omniReferenceTaskType: nextMode,
        ratio: "adaptive",
        ...(nextMode === "edit" ? { duration: -1 } : {}),
      });
      return;
    }
    const inputMode = nextMode as NonNullable<typeof data.inputMode>;
    update({
      inputMode,
      ...(isSeedance25 ? { omniReferenceTaskType: "auto" as const } : {}),
      ...((isSeedance25 || isMiniMaxH3) && (inputMode === "first_frame" || inputMode === "first_last_frame") ? { ratio: "adaptive" } : {}),
      ...(isMiniMaxH3 && inputMode === "text_to_video" && data.ratio === "adaptive" ? { ratio: "9:16" } : {}),
    });
  };
  const videoModelSelect = (
    <UiProps ids={{"placeholder":["canvas.mef8bd8d3b57c"]}}><FrostedSelect value={model} onChange={changeModel} options={(models?.video || []).map((item) => ({ value: item.id, label: item.label }))} placeholder="canvas.mef8bd8d3b57c" ariaLabel={text("workspaceFollowup.ma0afda31af33")} buttonClassName="canvas-task-model-trigger canvas-video-model-trigger !h-8 min-w-[88px] max-w-[240px]" menuClassName="canvas-task-parameter-popover canvas-video-model-menu" variant="canvas" showLeading={false} side="top" menuWidth={304} menuMaxHeight={400} optionHeight={52} /></UiProps>
  );

  return (
    <UiProps ids={{"title":["canvas.m89174fe72eee"]}}><CanvasGeneratorShell
      nodeId={id}
      title="canvas.m89174fe72eee"
    >
      {(expanded) => <div data-canvas-task-panel className="canvas-generator-content">
      <ConnectedAssets nodeId={id} assets={assets} allowInsertion videoInputMode={inputModeValue} />
      <div className={`canvas-generator-prompt-surface${expanded ? " canvas-generator-prompt-surface--expanded min-h-0 flex-1" : ""}`}>
        <UiProps ids={{"placeholder":["canvas.m80bf78b9db11"]}}><PromptRichEditor
          disabled={readOnly}
          value={videoPrompt}
          creativeEditorRef={creativeEditorRef}
          assets={assets}
          onValueChange={(prompt) => {
            update({ prompt, creativePresets: undefined });
          }}
          onKeyDown={(event) => {
            if (!event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              editor?.runNode(id);
            }
          }}
          placeholder="canvas.m80bf78b9db11"
          expanded={expanded}
          variant="canvasGenerator"
          className="nodrag"
        /></UiProps>
      </div>
      <div className="canvas-video-task-footer">
        <div className="canvas-task-parameter-bar min-w-0 flex-1">
          {videoModelSelect}
          <div className="canvas-task-parameter-divider" aria-hidden="true" />
          <button ref={advancedTriggerRef} type="button" data-canvas-video-parameter-trigger data-open={advancedOpen || undefined} aria-expanded={advancedOpen} disabled={!selectedVideoModel} onClick={() => setAdvancedOpen((open) => !open)} className="canvas-task-parameter-trigger canvas-video-advanced-trigger">
            {selectedInputModeLabel ? <span className="whitespace-nowrap">{selectedInputModeLabel} ·</span> : null}
            <CanvasAspectRatioIcon value={effectiveRatio || "adaptive"} compact />
            <span>{videoParameterSummary || <UiText id="canvas.mbf3ec7509a30" />}</span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
          </button>
          <CanvasTaskParameterPopover open={Boolean(selectedVideoModel && advancedOpen)} anchorRef={advancedTriggerRef} onClose={() => setAdvancedOpen(false)} width={344} maxHeight={560} align="start" side="top" className="canvas-video-advanced-popover">
            <div data-canvas-video-parameter-popover className="canvas-task-parameter-sections canvas-param-card-sections">
              {inputModeOptions.length > 1 ? (
                <UiProps ids={{"aria-label":["canvas.m1cb2da1e673a"]}}><section className="canvas-task-parameter-section" aria-label="canvas.m1cb2da1e673a">
                  <div className="canvas-task-parameter-label"><UiText id="canvas.m1cb2da1e673a" /></div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(3, inputModeOptions.length)}, minmax(0, 1fr))` }}>
                    {inputModeOptions.map((option) => (
                      <button key={option.value} type="button" data-selected={option.value === selectedInputModeValue} disabled={option.disabled} onClick={() => changeInputMode(option.value)} className="canvas-task-parameter-option canvas-video-mode-option">
                        <CanvasVideoModeIcon value={option.value} />
                        <span className="min-w-0 truncate">{uiLabel(option.label)}</span>
                      </button>
                    ))}
                  </div>
                </section></UiProps>
              ) : null}
              <section className="canvas-task-parameter-section">
                <div className="canvas-task-parameter-label"><UiText id="canvas.m82a59f3d1c16" /></div>
                <div className="canvas-video-parameter-ratio-grid" data-single-option={ratioOptions.length === 1 || undefined}>
                  {sortAspectRatioOptions(ratioOptions).map((option) => (
                    <button key={option.value} type="button" data-selected={option.value === effectiveRatio} onClick={() => update({ ratio: option.value })} className="canvas-task-parameter-option canvas-task-aspect-option">
                      <CanvasAspectRatioIcon value={option.value} />
                      <span>{uiLabel(option.label)}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="canvas-task-parameter-section">
                <div className="canvas-task-parameter-label"><UiText id="canvas.m0e22652107f5" /></div>
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, spec.supportedResolutions.length))}, minmax(0, 1fr))` }}>
                  {spec.supportedResolutions.map((resolution) => (
                    <button key={resolution} type="button" data-selected={resolution === effectiveResolution} onClick={() => update({ resolution })} className="canvas-task-parameter-option">{resolution}</button>
                  ))}
                </div>
              </section>
              <section className="canvas-task-parameter-section">
                <div className="canvas-task-parameter-label"><UiText id="canvas.m271665640dc3" /></div>
                <div className="canvas-video-duration-row">
                  <UiProps ids={{"aria-label":["canvas.m271665640dc3"]}}><input
                    type="range"
                    aria-label="canvas.m271665640dc3"
                    min={0}
                    max={Math.max(0, durationOptions.length - 1)}
                    step={1}
                    value={durationIndex}
                    disabled={durationOptions.length <= 1}
                    style={{ "--canvas-video-duration-progress": `${durationOptions.length <= 1 ? 100 : durationIndex / (durationOptions.length - 1) * 100}%` } as React.CSSProperties}
                    onChange={(event) => {
                      const option = durationOptions[Number(event.target.value)];
                      if (option) update({ duration: Number(option.value) });
                    }}
                  /></UiProps>
                  <span>{durationLabel}</span>
                </div>
              </section>
              {spec.supportsGenerateAudio ? <CanvasAudioToggle checked={Boolean(data.generateAudio)} onChange={(generateAudio) => update({ generateAudio })} /> : null}
            </div>
          </CanvasTaskParameterPopover>
          <PresetPromptButton id={id} />
        </div>
        <div className="flex shrink-0 items-center gap-1"><UiProps ids={{"label":["canvas.m56e56614fed0"]}}><TaskSubmitButton onClick={() => editor?.runNode(id)} disabled={running || !selectedVideoModel || !videoParametersValid || Boolean(referenceError)} running={running} label="canvas.m56e56614fed0" /></UiProps></div>
      </div>
      </div>}
    </CanvasGeneratorShell></UiProps>
  );
}

function AudioTaskPanel({ id, data, assets }: { id: string; data: Extract<CanvasNodeData, { kind: "audioTask" }>; assets: PromptReferenceAsset[] }) {
  const { text } = useUiLocale();
  const readOnly = useCanvasReadOnly();
  const editor = React.useContext(CanvasNodeEditorContext);
  const models = useCanvasModels();
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  const voiceTriggerRef = React.useRef<HTMLButtonElement>(null);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const parameterTriggerRef = React.useRef<HTMLButtonElement>(null);
  const running = data.status === "submitting" || data.status === "running";
  const model = resolveCanvasModelId(models?.audio || [], data.model);
  const capabilities = getMiniMaxSpeechCapabilities(model);
  const seedAudio = isSeedAudioModel(model);
  const referenceTexts = editor?.getTaskTextReferences?.(id) || [];
  const combinedText = [data.prompt.trim(), ...referenceTexts.map(reference => reference.content)].filter(Boolean).join("");
  const textLength = seedAudio ? [...combinedText].length : combinedText.length;
  const textLimit = seedAudio ? SEED_AUDIO_TEXT_MAX_LENGTH : MINIMAX_SPEECH_TEXT_MAX_LENGTH;
  const hasParameters = seedAudio || capabilities.parameters;
  const update = (patch: Partial<typeof data>) => editor?.updateData(id, (current) => current.kind === "audioTask" ? { ...current, ...patch } : current);

  if (isSunoModel(model)) return <CanvasSunoPanel id={id} model={model} value={data.suno} running={running} readOnly={readOnly}
    referenceText={referenceTexts.map(r => r.content).join("\n\n")}
    models={(models?.audio || []).map(item => ({ value: item.id, label: item.label, disabled: Boolean(getCanvasAudioModelReferenceError(item.id, assets)), hint: getCanvasAudioModelReferenceError(item.id, assets) || undefined }))}
    onChange={suno => update({ suno })} onModelChange={next => editor?.changeTaskModel(id, next)} onRun={() => editor?.runNode(id)} />;

  return (
    <>
      <UiProps ids={{"title":["canvas.m33a41a01434b"]}}><CanvasGeneratorShell
        nodeId={id}
        title="canvas.m33a41a01434b"
      >
        {(expanded) => <div data-canvas-task-panel data-canvas-audio-task-panel data-seed-audio-panel={seedAudio || undefined} className="canvas-generator-content">
          <ConnectedAssets nodeId={id} assets={assets} />
          {seedAudio ? <>
            <div className={`canvas-generator-prompt-surface${expanded ? " canvas-generator-prompt-surface--expanded min-h-0 flex-1" : ""}`}>
              <UiProps ids={{"placeholder":["canvas.mde4646410eb4"]}}><PromptRichEditor disabled={readOnly} value={data.prompt} assets={assets} onValueChange={(prompt) => update({ prompt })}
                onKeyDown={(event) => { if (!event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); if (!running && textLength <= textLimit) editor?.runNode(id); } }}
                placeholder="canvas.mde4646410eb4"
                autoFocus={expanded} expanded={expanded} variant="canvasGenerator" className="nodrag" /></UiProps>
            </div>
          </> : <CanvasSpeechPromptEditor value={data.prompt} model={model} expanded={expanded} onValueChange={(prompt) => update({ prompt })} onSubmit={() => { if (!running && textLength <= MINIMAX_SPEECH_TEXT_MAX_LENGTH) editor?.runNode(id); }} />}
          <div className="canvas-video-task-footer">
            <div className="canvas-task-parameter-bar min-w-0 flex-1">
              <UiProps ids={{"placeholder":["canvas.md3d0d14f6121"]}}><FrostedSelect
                value={model}
                onChange={(nextModel) => { setAdvancedOpen(false); setVoiceOpen(false); editor?.changeTaskModel(id, nextModel); }}
                options={(models?.audio || []).map((item) => ({ value: item.id, label: item.label, disabled: Boolean(getCanvasAudioModelReferenceError(item.id, assets)), hint: getCanvasAudioModelReferenceError(item.id, assets) || undefined }))}
                placeholder="canvas.md3d0d14f6121"
                ariaLabel={text("workspaceFollowup.m2aad9b7e45f8")}
                buttonClassName="canvas-task-model-trigger canvas-video-model-trigger !h-8 min-w-[88px] max-w-[240px]"
                menuClassName="canvas-task-parameter-popover canvas-video-model-menu"
                variant="canvas"
                showLeading={false}
                side="top"
                menuWidth={304}
                menuMaxHeight={400}
                optionHeight={52}
              /></UiProps>
              <div className="canvas-task-parameter-divider" aria-hidden="true" />
              {!seedAudio && <UiProps ids={{"title":["canvas.m74c516c07587"]}}><button ref={voiceTriggerRef} disabled={readOnly} type="button" onClick={() => setVoiceOpen(true)} className="canvas-task-parameter-trigger canvas-video-mode-trigger !h-8 max-w-[150px]" title="canvas.m74c516c07587"><Music2 className="h-4 w-4" /><span className="truncate">{data.voiceName || data.voiceId}</span><ChevronDown className="h-3.5 w-3.5" /></button></UiProps>}
              {seedAudio && <CanvasSeedAudioOutputOptions value={data} onChange={update} />}
              {hasParameters && <div className="canvas-task-parameter-divider" aria-hidden="true" />}
              {hasParameters && <UiProps ids={{"title":["canvas.m07aeba516047"],"aria-label":["canvas.m07aeba516047"]}}><button ref={parameterTriggerRef} type="button" aria-expanded={advancedOpen} aria-haspopup="dialog" data-open={advancedOpen || undefined} onClick={() => setAdvancedOpen((open) => !open)} className="canvas-task-parameter-trigger !h-8 !px-2" title="canvas.m07aeba516047" aria-label="canvas.m07aeba516047"><Settings2 className="h-4 w-4" /></button></UiProps>}
            </div>
            <div className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--app-muted)]">
              <span className="tabular-nums">{seedAudio ? `${textLength}/${textLimit}` : <>{textLength}/10000</>}</span>
              <UiProps ids={{"label":["canvas.mb311c8ba2968"]}}><TaskSubmitButton onClick={() => editor?.runNode(id)} disabled={running || !model || !combinedText || textLength > textLimit} running={running} label="canvas.mb311c8ba2968" /></UiProps>
            </div>
          </div>
          <CanvasTaskParameterPopover open={advancedOpen && hasParameters} anchorRef={parameterTriggerRef} onClose={() => setAdvancedOpen(false)} width={344} maxHeight={520} align="start" side="top" className="canvas-video-advanced-popover canvas-audio-compact-popover">
            {seedAudio ? <CanvasSeedAudioParameters value={data} onChange={update} /> : <CanvasSpeechParameters model={model} value={data} onChange={update} />}
          </CanvasTaskParameterPopover>
        </div>}
      </CanvasGeneratorShell></UiProps>
      {!readOnly && <CanvasMiniMaxVoiceDialog
        open={voiceOpen && !seedAudio}
        value={data.voiceId}
        model={model}
        onClose={() => setVoiceOpen(false)}
        onSelect={(voice) => update({ voiceId: voice.id, voiceName: voice.name })}
        returnFocusRef={voiceTriggerRef}
      />}
    </>
  );
}

function LlmTaskPanel({ id, data, assets }: { id: string; data: Extract<CanvasNodeData, { kind: "llm" }>; assets: PromptReferenceAsset[] }) {
  const { text, label: uiLabel } = useUiLocale();
  const readOnly = useCanvasReadOnly();
  const editor = React.useContext(CanvasNodeEditorContext);
  const models = useCanvasModels();
  const [systemOpen, setSystemOpen] = React.useState(false);
  const systemTriggerRef = React.useRef<HTMLButtonElement>(null);
  const requestedLlmSelection = data.providerId && data.model
    ? `${data.providerId}:${data.model}`
    : null;
  const selectedLlmModel = requestedLlmSelection
    ? models?.chat.find((model) => model.providerId === data.providerId && model.modelId === data.model)
    : undefined;
  const fallbackLlmModel = models?.chat.find((model) => (
    model.providerId === models?.canvasDefault.providerId
    && model.modelId === models?.canvasDefault.modelId
  )) || models?.chat[0];
  const displayedLlmModel = selectedLlmModel || fallbackLlmModel;
  const thinkingLevels = displayedLlmModel?.thinkingLevels ?? ["default"];
  const thinkingLevel = data.thinkingLevel && thinkingLevels.includes(data.thinkingLevel) ? data.thinkingLevel : "default";
  const selected = displayedLlmModel
    ? `${displayedLlmModel.providerId}:${displayedLlmModel.modelId}`
    : "";
  const options = (models?.chat || []).map((model) => ({
    value: `${model.providerId}:${model.modelId}`,
    label: model.label || model.modelId,
  }));
  const running = data.status === "submitting" || data.status === "running";
  const update = (patch: Partial<typeof data>) => editor?.updateData(id, (current) => current.kind === "llm" ? { ...current, ...patch } : current);
  const changeModel = (value: string) => {
    const separator = value.indexOf(":");
    update({ providerId: value.slice(0, separator), model: value.slice(separator + 1), thinkingLevel: "default" });
  };

  return (
    <UiProps ids={{"title":["canvas.m0d4bcbafb29e"]}}><CanvasGeneratorShell
      nodeId={id}
      title="canvas.m0d4bcbafb29e"
    >
      {(expanded) => <div data-canvas-task-panel data-canvas-llm-task-panel className="canvas-generator-content">
        <ConnectedAssets nodeId={id} assets={assets} />
        <div className={`canvas-generator-prompt-surface${expanded ? " canvas-generator-prompt-surface--expanded min-h-0 flex-1" : ""}`}>
          <UiProps ids={{"placeholder":["canvas.mf982d67cf7cf"]}}><PromptRichEditor
          disabled={readOnly}
            value={data.prompt}
            assets={assets}
            onValueChange={(prompt) => update({ prompt })}
            onKeyDown={(event) => {
              if (!event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                editor?.runNode(id);
              }
            }}
            placeholder="canvas.mf982d67cf7cf"
            autoFocus={expanded}
            expanded={expanded}
            variant="canvasGenerator"
            className="nodrag"
          /></UiProps>
        </div>
        <div className="canvas-llm-task-footer">
          <div className="canvas-task-parameter-bar min-w-0 flex-1">
            <FrostedSelect value={selected} onChange={changeModel} options={options} ariaLabel={text("workspaceFollowup.m2b982b77f76b")} className="min-w-0 max-w-[240px]" buttonClassName="canvas-task-model-trigger !h-8 min-w-[88px] max-w-[240px]" menuClassName="canvas-task-parameter-popover canvas-task-model-popover" variant="canvas" compact showLeading={false} side="top" menuWidth={360} menuMaxHeight={400} optionHeight={52} />
            {thinkingLevels.length > 1 && <FrostedSelect value={thinkingLevel} onChange={(value) => update({ thinkingLevel: value as LlmThinkingLevel })} options={thinkingLevels.map(value => ({ value, label: value === "default" ? text("workspaceFollowup.m1cdb213a0f4f") : text("workspaceFollowup.m0cb388835694", { v0: value === "none" ? text("workspaceFollowup.m3fd47edce45b") : uiLabel(LLM_THINKING_LABELS[value]) }) }))} ariaLabel={text("workspaceFollowup.m77c51dbe9b8c")} disabled={readOnly} variant="canvas" compact side="top" menuWidth={160} />}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <UiProps ids={{"title":["canvas.m68ea5dd4d7af"],"aria-label":["canvas.m68ea5dd4d7af"]}}><button ref={systemTriggerRef} type="button" title="canvas.m68ea5dd4d7af" aria-label="canvas.m68ea5dd4d7af" data-canvas-llm-system-settings data-open={systemOpen || undefined} aria-expanded={systemOpen} onClick={() => setSystemOpen((open) => !open)} className="canvas-task-parameter-trigger canvas-video-advanced-trigger"><Settings2 className="h-4 w-4" /></button></UiProps>
            <CanvasTaskParameterPopover open={systemOpen} anchorRef={systemTriggerRef} onClose={() => setSystemOpen(false)} width={360} maxHeight={420} align="start" side="top" className="canvas-llm-system-popover">
              <label className="block space-y-2">
                <span className="canvas-task-parameter-label"><UiText id="canvas.m0894b78b866e" /></span>
                <UiProps ids={{"placeholder":["canvas.m0b3bf0dda911"]}}><textarea value={data.system || ""} onChange={(event) => update({ system: event.target.value })} placeholder="canvas.m0b3bf0dda911" className="canvas-llm-system-textarea nodrag nowheel" /></UiProps>
              </label>
            </CanvasTaskParameterPopover>
            <UiProps ids={{"label":["canvas.m709692c59b90"]}}><TaskSubmitButton onClick={() => editor?.runNode(id)} disabled={running || !displayedLlmModel} running={running} label="canvas.m709692c59b90" /></UiProps>
          </div>
        </div>
      </div>}
    </CanvasGeneratorShell></UiProps>
  );
}

function ViewportFixedTaskPanel({ children, frameSize }: { children: React.ReactNode; frameSize: { width: number; height: number } }) {
  const nodeId = useNodeId();
  const zoom = useStore((state) => state.transform[2]);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = React.useState(250);
  const [panelWidth, setPanelWidth] = React.useState(CANVAS_GENERATOR_COLLAPSED_WIDTH);
  const scale = 1 / Math.max(zoom, 0.1);
  const position = useStore((state) => {
    const node = nodeId ? state.nodeLookup.get(nodeId) : undefined;
    if (!node || !state.width || !state.height) return null;
    const [vx, vy, z] = state.transform;
    return canvasTaskPanelPosition({
      x: node.internals.positionAbsolute.x * z + vx,
      y: node.internals.positionAbsolute.y * z + vy,
      width: frameSize.width,
      height: frameSize.height,
      zoom: z, viewportWidth: state.width, viewportHeight: state.height, panelWidth, panelHeight,
    });
  }, (a, b) => a?.left === b?.left && a?.top === b?.top && a?.maxHeight === b?.maxHeight);

  React.useEffect(() => {
    const syncWidth = () => setPanelWidth(window.innerWidth <= 720
      ? Math.max(CANVAS_GENERATOR_COMPACT_MIN_WIDTH, Math.min(CANVAS_GENERATOR_COMPACT_MAX_WIDTH, window.innerWidth - 32))
      : CANVAS_GENERATOR_COLLAPSED_WIDTH);
    syncWidth();
    window.addEventListener("resize", syncWidth);
    return () => window.removeEventListener("resize", syncWidth);
  }, []);

  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const syncHeight = () => setPanelHeight(panel.offsetHeight);
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      data-canvas-task-panel-anchor
      style={{
        position: "absolute",
        left: position?.left ?? "50%",
        top: position?.top ?? "100%",
        width: panelWidth * scale,
        height: panelHeight * scale,
        marginTop: position ? 0 : 16 * scale,
        marginLeft: position ? 0 : -(panelWidth * scale) / 2,
      }}
    >
      <div ref={panelRef} className="nowheel" style={{ width: panelWidth, maxHeight: position?.maxHeight, overflowY: "auto", transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}

function PersistentTaskPanel({ hidden, children }: { hidden: boolean; children: React.ReactNode }) {
  const panel = React.useRef<HTMLDivElement>(null);
  const focus = React.useRef<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    element.toggleAttribute("inert", hidden);
    if (!hidden) {
      const previous = focus.current;
      focus.current = null;
      if (previous?.isConnected && document.activeElement === document.body && document.hasFocus()) previous.focus({ preventScroll: true });
      return;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && element.contains(active)) { focus.current = active; active.blur(); }
    const changedFocus = (event: FocusEvent) => { if (event.target !== document.body) focus.current = null; };
    document.addEventListener("focusin", changedFocus);
    return () => document.removeEventListener("focusin", changedFocus);
  }, [hidden]);
  return <CanvasPanelHiddenContext.Provider value={hidden}><div ref={panel} data-canvas-task-panel-hidden={hidden || undefined} style={{ visibility: hidden ? "hidden" : "visible", pointerEvents: hidden ? "none" : undefined }} aria-hidden={hidden}>{children}</div></CanvasPanelHiddenContext.Provider>;
}

function TaskWorkspace({ id, data, dragging, selected }: { id: string; data: TaskNodeData; dragging: boolean; selected: boolean }) {
  const audioTrim = useCanvasAudioTrim();
  const videoClip = useCanvasVideoClip();
  const videoCrop = useCanvasVideoCrop();
  const subtitleRemoval = useCanvasSubtitleRemoval();
  const editor = React.useContext(CanvasNodeEditorContext);
  const panelOpen = editor?.isTaskPanelVisible(id) || false;
  const [anglePanelOpen, setAnglePanelOpen] = React.useState(false);
  const assets = React.useMemo(() => panelOpen ? editor?.getTaskAssets(id) || [] : [], [panelOpen, editor, id, data]);
  const panelsVisible = panelOpen && !dragging && !(data.kind === "imageTask" && isCanvasImageBatchExpanded(data.task.batches.at(-1)));
  const frameSize = data.kind === "llm" ? getCanvasTextTaskFrameSize(data) : getCanvasTaskResultFrameSize(data);
  const nodeGeometryRef = useCanvasNodeGeometrySync(id, data);

  return (
    <div ref={nodeGeometryRef} className="relative" style={{ width: frameSize.width }} data-canvas-task-workspace>
      {data.kind === "llm" ? <LlmTaskResultFrame id={id} data={data} dragging={dragging} selected={selected} /> : <TaskResultFrame id={id} data={data} dragging={dragging} selected={selected} onAngleOpenChange={setAnglePanelOpen} />}
      {panelOpen && !(data.kind === "videoTask" && data.subtitleRemoval) && <PersistentTaskPanel hidden={!panelsVisible || anglePanelOpen || Boolean(audioTrim?.editing) || Boolean(videoClip?.editing) || Boolean(videoCrop?.editing) || Boolean(subtitleRemoval?.editing)}><ViewportFixedTaskPanel frameSize={frameSize}>{data.kind === "imageTask" ? <ImageTaskPanel id={id} data={data} assets={assets} /> : data.kind === "audioTask" ? <AudioTaskPanel id={id} data={data} assets={assets} /> : data.kind === "llm" ? <LlmTaskPanel id={id} data={data} assets={assets} /> : <VideoTaskPanel id={id} data={data} assets={assets} />}</ViewportFixedTaskPanel></PersistentTaskPanel>}
    </div>
  );
}

function Body({ id, data }: { id: string; data: CanvasNodeData }) {
  const { text } = useUiLocale();
  const readOnly = useCanvasReadOnly();
  const editor = React.useContext(CanvasNodeEditorContext);
  const models = useCanvasModels();
  const update = (next: CanvasNodeData) => editor?.updateData(id, () => next);
  const hydrateDimensions = (width: number, height: number) => {
    editor?.updateNodeSize(id, getCanvasMediaNodeSize(width, height));
    editor?.updateData(id, (current) => hydrateCanvasMediaDimensions(current, width, height));
  };


  if (data.kind === "image") {
    return (
      <div
        className="h-full w-full overflow-hidden rounded-xl bg-[var(--input-bg)]"
      >
        <UiProps ids={{"alt":["canvas.m2cfcfd31ff3f"]}}><MediaImage
          src={data.url}
          alt={data.name || "canvas.m2cfcfd31ff3f"}
          draggable={false}
          cacheInMemory={false}
          onOriginalLoad={(event) => {
            const width = event.currentTarget.naturalWidth;
            const height = event.currentTarget.naturalHeight;
            editor?.updateData(id, (current) => {
              if (current.kind !== "image" || (current.variants?.original?.width && current.variants.original.height)) return current;
              return hydrateCanvasMediaDimensions(current, width, height);
            });
          }}
          className="h-full w-full object-cover"
        /></UiProps>
      </div>
    );
  }
  if (data.kind === "video") {
    return (
      <div
        className="h-full w-full overflow-hidden rounded-xl bg-[var(--input-bg)]"
      >
        <CanvasVideoPlayer
          src={data.url}
          poster={data.posterUrl || data.variants?.poster?.url || data.variants?.thumbnail?.url}
          onLoadedMetadata={(video) => hydrateDimensions(video.videoWidth, video.videoHeight)}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }
  if (data.kind === "audio") {
    return (
      <CanvasAudioNode
        id={id}
        data={data}
        selected={editor?.isPanelVisible(id) ?? false}
        onWaveformReady={(waveform) => editor?.hydrateAudioWaveform(id, waveform)}
      />
    );
  }
  if (data.kind === "prompt") {
    return (
      <div className="space-y-2">
        <UiProps ids={{"placeholder":["canvas.m2b2b83a62d66"]}}><textarea value={data.text} onChange={(event) => update({ ...data, text: event.target.value })} placeholder="canvas.m2b2b83a62d66" className="nodrag nowheel min-h-28 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-xs leading-5 text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary-bg)_24%,transparent)]" /></UiProps>
        <ActionButton onClick={() => editor?.openTemplate(id)}><MessageSquareText className="h-3.5 w-3.5" /><UiText id="canvas.mb46a606b401c" /></ActionButton>
      </div>
    );
  }
  if (data.kind === "imageTask") {
    const settings = data.task.settings;
    const gifOutput = supportsGptImage26Gif(settings.model) && settings.outputFormat === "gif";
    const model = resolveCanvasModelId(models?.image || [], settings.model);
    const selectedModel = models?.image.find((candidate) => candidate.id === model);
    const params = selectedModel?.params || models?.image[0]?.params || getCanvasImageModelParams("nano-banana-pro");
    const running = data.task.batches.some((batch) => batch.outputs.some((output) => output.status === "submitting" || output.status === "running"));
    const updateSettings = (patch: Partial<typeof settings>) => update({ ...data, task: { ...data.task, settings: { ...settings, ...patch } } });
    return (
      <div className="space-y-2">
        <UiProps ids={{"placeholder":["canvas.mc44545a9b162"]}}><FrostedSelect value={getGptImage25SelectionValue(model, settings.gptImage25Mode)} onChange={(model) => editor?.changeTaskModel(id, model)} options={expandGptImage25ModelOptions((models?.image || []).map((model) => ({ ...model, value: model.id })))} placeholder="canvas.mc44545a9b162" ariaLabel={text("workspaceFollowup.m48156e412e6b")} compact showLeading={false} side="auto" /></UiProps>
        <GoogleImageSettings model={model} settings={settings} onChange={updateSettings} />
        <GptImage25OutputSettings model={model} background={settings.background} outputFormat={settings.outputFormat} gifSize={settings.gifSize} frameCount={settings.frameCount} frameDurationMs={settings.frameDurationMs} seedream55={settings.seedream55} onChange={updateSettings} />
        <UiProps ids={{"placeholder":["canvas.m8a31ce04a746"]}}><textarea value={settings.prompt} onChange={(event) => updateSettings({ prompt: event.target.value })} placeholder="canvas.m8a31ce04a746" className="nodrag nowheel min-h-20 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--app-fg)] outline-none" /></UiProps>
        <div className="grid grid-cols-3 gap-1.5">
          {!gifOutput ? <FrostedSelect value={settings.aspectRatio} onChange={(aspectRatio) => updateSettings({ aspectRatio })} options={sortAspectRatioOptions(params.aspectRatios)} ariaLabel={text("workspaceFollowup.m5c6d39030a4a")} compact showLeading={false} side="auto" /> : null}
          {!gifOutput ? <FrostedSelect value={settings.resolution} onChange={(resolution) => updateSettings({ resolution })} options={params.resolutions} ariaLabel={text("workspaceFollowup.mb92421822c21")} compact showLeading={false} side="auto" /> : null}
          <FrostedSelect value={String(settings.count)} onChange={(count) => updateSettings({ count: Number(count) })} options={CANVAS_IMAGE_COUNT_OPTIONS.map((count) => ({ value: String(count), label: text("workspaceFollowup.m2fd724033f0d", { v0: count }) }))} ariaLabel={text("workspaceFollowup.m1e3c56a9a4ca")} compact showLeading={false} side="auto" />
        </div>
        <div className="flex gap-1.5"><ActionButton onClick={() => editor?.openTemplate(id)}><MessageSquareText className="h-3.5 w-3.5" /><UiText id="canvas.mb46a606b401c" /></ActionButton><ActionButton onClick={() => editor?.runNode(id)} disabled={running || !selectedModel}><Play className="h-3.5 w-3.5" />{running ? <UiText id="canvas.m969ef41f7e5b" /> : <UiText id="canvas.m1ad1463fe16f" />}</ActionButton></div>
      </div>
    );
  }
  if (data.kind === "videoTask") {
    const running = data.status === "submitting" || data.status === "running";
    const model = resolveCanvasModelId(models?.video || [], data.model);
    const selectedModel = models?.video.find((candidate) => candidate.id === model);
    return (
      <div className="space-y-2">
        <UiProps ids={{"placeholder":["canvas.mef8bd8d3b57c"]}}><FrostedSelect value={model} onChange={(model) => editor?.changeTaskModel(id, model)} options={(models?.video || []).map((model) => ({ value: model.id, label: model.label }))} placeholder="canvas.mef8bd8d3b57c" ariaLabel={text("workspaceFollowup.ma0afda31af33")} compact showLeading={false} side="auto" /></UiProps>
        <UiProps ids={{"placeholder":["canvas.mad0cd5aad260"]}}><textarea value={data.prompt} onChange={(event) => update({ ...data, prompt: event.target.value })} placeholder="canvas.mad0cd5aad260" className="nodrag nowheel min-h-20 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--app-fg)] outline-none" /></UiProps>
        <div className="flex gap-1.5"><ActionButton onClick={() => editor?.openTemplate(id)}><MessageSquareText className="h-3.5 w-3.5" /><UiText id="canvas.mb46a606b401c" /></ActionButton><ActionButton onClick={() => editor?.runNode(id)} disabled={running || !selectedModel}><Play className="h-3.5 w-3.5" />{running ? <UiText id="canvas.m969ef41f7e5b" /> : <UiText id="canvas.m56e56614fed0" />}</ActionButton></div>
        {data.outputUrl && <div className="group/output relative overflow-hidden rounded-xl border border-[var(--border)]"><CanvasVideoPlayer src={data.outputUrl} className="h-40 w-full bg-[var(--input-bg)] object-cover" /><div className="absolute right-1 top-1 hidden gap-1 group-hover/output:flex"><UiProps ids={{"title":["canvas.m13d61fea9f17"]}}><button type="button" onClick={() => editor?.previewMedia(id)} title="canvas.m13d61fea9f17" className="nodrag rounded-md bg-[var(--panel-bg)] p-1"><Eye className="h-3 w-3" /></button></UiProps><UiProps ids={{"title":["canvas.m4673a2306165"]}}><button type="button" onClick={() => editor?.downloadMedia(id)} title="canvas.m4673a2306165" className="nodrag rounded-md bg-[var(--panel-bg)] p-1"><Download className="h-3 w-3" /></button></UiProps></div></div>}
        <Status status={data.status} error={data.error} />
      </div>
    );
  }
  if (data.kind === "loop") {
    if (readOnly) return <div className="space-y-2 text-xs text-[var(--app-muted)]"><pre className="whitespace-pre-wrap">{data.items.join("\n")}</pre><p>{data.mode === "parallel" ? <UiText id="canvas.mbe050d58e9a7" /> : <UiText id="canvas.mf46aa4e6cafe" />}<UiText id="canvas.me0bcad4a0415" />{data.concurrency}</p><Status status={data.status} /></div>;
    return <div className="space-y-2 text-xs text-[var(--app-muted)]">
      <UiProps ids={{"placeholder":["canvas.m8048b816d72d"]}}><textarea value={data.items.join("\n")} onChange={(event) => update({ ...data, items: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) })} placeholder="canvas.m8048b816d72d" className="nodrag nowheel min-h-20 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-xs text-[var(--app-fg)] outline-none" /></UiProps>
      <div className="grid grid-cols-2 gap-1.5"><FrostedSelect value={data.mode} onChange={(mode) => update({ ...data, mode: mode as "serial" | "parallel" })} options={[{ value: "serial", label: text("workspaceFollowup.mf46aa4e6cafe") }, { value: "parallel", label: text("workspaceFollowup.mbe050d58e9a7") }]} ariaLabel={text("workspaceFollowup.mf0a5f687c4d4")} compact showLeading={false} side="auto" /><FrostedSelect value={String(data.concurrency)} onChange={(concurrency) => update({ ...data, concurrency: Number(concurrency) })} options={Array.from({ length: 8 }, (_, index) => ({ value: String(index + 1), label: text("workspaceFollowup.m200319ffc9bc", { v0: index + 1 }) }))} ariaLabel={text("workspaceFollowup.m6fbaf96e91fb")} compact showLeading={false} side="auto" /></div>
      <p>{data.items.length ? <UiText id="canvas.maad5b2da2eb7" values={{v0: String(data.items.length)}} /> : <UiText id="canvas.m768446666c00" />}</p><Status status={data.status} />
    </div>;
  }

  return null;
}

function hasCanvasNodeActiveDetail(data: CanvasNodeData) {
  const statusKeepsDetail = (status: string | undefined) => status === "submitting" || status === "running" || status === "failed";
  if ((data.kind === "image" || data.kind === "video" || data.kind === "audio") && data.url.trim().toLowerCase().startsWith("blob:")) return true;
  if (data.kind === "imageTask") {
    const outputs = data.task.batches.at(-1)?.outputs || [];
    return outputs.filter(output => output.status === "success" && output.url).length > 1
      || outputs.some(output => statusKeepsDetail(output.status));
  }
  if (data.kind === "videoTask" || data.kind === "audioTask" || data.kind === "llm") return statusKeepsDetail(data.status);
  return false;
}

function useCanvasExtremeLod(preserveFullDetail: boolean) {
  const globalLowDetail = React.useContext(CanvasLodContext);
  const zone = useStore((state) => getCanvasLodZone(state.transform[2]));
  const deferredZone = React.useDeferredValue(zone);
  const interacting = useCanvasInteracting();
  const previous = React.useRef(zone === "enter");
  const lowDetail = interacting
    ? previous.current
    : resolveCanvasLodZone(deferredZone, previous.current);
  previous.current = lowDetail;
  return preserveFullDetail ? false : globalLowDetail ?? lowDetail;
}

function getCanvasLowDetailImageResult(data: CanvasNodeData) {
  if (data.kind !== "imageTask") return undefined;
  const batch = data.task.batches.at(-1);
  const output = getCanvasPrimaryImageOutput(batch);
  return batch && output ? { batchId: batch.id, outputId: output.id, url: output.url, name: output.name } : undefined;
}

export function getCanvasLowDetailImageUrl(data: CanvasNodeData) {
  return data.kind === "image" ? data.url : getCanvasLowDetailImageResult(data)?.url;
}

function CanvasNodeLowDetail({
  id,
  data,
  width,
  height,
  selected,
  connectionTargetState,
}: {
  id: string;
  data: Extract<CanvasNodeData, { kind: "image" | "video" | "audio" | "imageTask" | "videoTask" | "audioTask" | "llm" }>;
  width: number;
  height: number;
  selected: boolean;
  connectionTargetState: CanvasConnectionTargetState;
}) {
  const connectionInProgress = useCanvasConnectionInProgress();
  const interacting = useCanvasInteracting();
  const [controlsMounted, setControlsMounted] = React.useState(false);
  const mediaNode = data.kind === "image" || data.kind === "video" || data.kind === "audio";
  const editor = React.useContext(CanvasNodeEditorContext);
  const uploadedMedia = mediaNode && data.origin === "upload";
  const taskNode = data.kind === "imageTask" || data.kind === "videoTask" || data.kind === "audioTask" || data.kind === "llm";
  const imageUrl = getCanvasLowDetailImageUrl(data);
  const posterUrl = data.kind === "video" ? data.posterUrl || data.variants?.poster?.url || data.variants?.thumbnail?.url : data.kind === "videoTask" ? data.variants?.poster?.url || data.variants?.thumbnail?.url : undefined;
  const videoUrl = data.kind === "video" ? data.url : data.kind === "videoTask" && data.status === "success" ? data.outputUrl : undefined;
  const audioUrl = data.kind === "audio" ? data.url : data.kind === "audioTask" && data.status === "success" ? data.outputUrl : undefined;
  const text = data.kind === "llm" ? data.output : undefined;
  const imageResult = getCanvasLowDetailImageResult(data);
  const metadataKind = data.kind === "video" || data.kind === "videoTask" ? "video" : data.kind === "audio" || data.kind === "audioTask" ? "audio" : "image";
  const frameRef = React.useRef<HTMLDivElement>(null);

  return (
    <div
      data-canvas-low-detail
      data-canvas-low-detail-node={id}
      data-canvas-connection-target-id={id}
      className="group/material relative"
      style={{ width, height }}
      onPointerEnter={() => { if (!interacting) setControlsMounted(true); }}
      onPointerMove={(event) => {
        if (!controlsMounted && !interacting) setControlsMounted(true);
        updateCanvasConnectionTargetTilt(event, connectionTargetState === "valid", frameRef.current);
      }}
      onPointerLeave={(event) => resetCanvasConnectionTargetTilt(event, frameRef.current)}
    >
      {controlsMounted && (imageUrl || videoUrl || audioUrl) && data.kind !== "llm" && editor?.replaceMediaFile && <CanvasReplaceMediaButton kind={metadataKind} onUpload={file => editor.replaceMediaFile!(id, file, imageResult?.outputId)} onHistory={() => editor.replaceMediaHistory?.(id, imageResult?.outputId)} />}
      {/* Media titles are a few pixels tall here; text nodes keep theirs as the only label. */}
      {data.kind === "llm" ? <CanvasNodeHeading className="canvas-text-node-title"><MessageSquareText className="h-3.5 w-3.5 shrink-0" /><CanvasEditableNodeName name={data.title || editor?.getTextNodeTitle?.(id) || "文本节点"} onRename={value => editor?.updateData(id, current => renameCanvasNodeData(current, value), "push")} /></CanvasNodeHeading> : null}
      {mediaNode && !uploadedMedia ? <Handle id={CANVAS_MEDIA_BODY_TARGET_HANDLE_ID} data-canvas-media-body-target type="target" position={Position.Left} isConnectableStart={false} isConnectableEnd className="!z-10 !rounded-[inherit] !border-0 !bg-transparent !opacity-0" style={{ inset: -20, width: "auto", height: "auto", transform: "none", pointerEvents: connectionInProgress ? "auto" : "none" }} /> : null}
      {taskNode ? <Handle id={CANVAS_TASK_BODY_TARGET_HANDLE_ID} data-canvas-task-body-target type="target" position={Position.Left} isConnectableStart={false} isConnectableEnd className="!z-10 !rounded-[inherit] !border-0 !bg-transparent !opacity-0" style={{ inset: 0, width: "auto", height: "auto", transform: "none", pointerEvents: connectionInProgress ? "auto" : "none" }} /> : null}
      <div
        ref={frameRef}
        data-canvas-task-result={taskNode || undefined}
        data-canvas-connection-target-state={connectionTargetState || undefined}
        className={`canvas-material-frame canvas-low-detail-frame canvas-connection-target h-full w-full ${selected ? "canvas-material-frame-selected" : ""} ${connectionTargetState === "valid" ? "canvas-connection-target-valid" : ""} ${connectionTargetState === "invalid" ? "canvas-connection-target-invalid canvas-connection-target-invalid-frame" : ""}`}
      >
        {imageUrl ? (
          <MediaImage src={imageUrl} alt="" draggable={false} className="h-full w-full object-cover" thumbnailSize={100} />
        ) : videoUrl ? (
          <CanvasVideoPlayer src={videoUrl} poster={posterUrl} previewOnly className="h-full w-full" />
        ) : audioUrl ? (
          <div className="flex h-full w-full items-center justify-center bg-[var(--input-bg)]"><Music2 className="h-8 w-8 text-[var(--app-muted)]" /></div>
        ) : text ? (
          <div className="canvas-low-detail-text">{text}</div>
        ) : data.kind === "imageTask" || data.kind === "videoTask" || data.kind === "audioTask" || data.kind === "llm" ? (
          <CanvasTaskResultPlaceholder kind={data.kind === "imageTask" ? "image" : data.kind === "videoTask" ? "video" : data.kind === "audioTask" ? "audio" : "text"} />
        ) : (
          <div className={`canvas-low-detail-skeleton ${data.kind === "video" ? "canvas-low-detail-video-skeleton" : ""}`}>
            {data.kind === "video" ? <Film /> : data.kind === "audio" ? <Music2 /> : <ImageIcon />}
          </div>
        )}
      </div>
      <CanvasConnectionHandle compact handleId={mediaNode ? CANVAS_MEDIA_INPUT_HANDLE_ID : CANVAS_TASK_INPUT_HANDLE_ID} type="target" connectionInProgress={connectionInProgress} acceptsInput={!uploadedMedia} />
      <CanvasConnectionHandle compact type="source" connectionInProgress={connectionInProgress} />
    </div>
  );
}

function CanvasStackFrame({ id, title, selected }: { id: string; title: string; selected: boolean }) {
  const { text } = useUiLocale();
  const editor = React.useContext(CanvasNodeEditorContext);
  const nodes = useStore(state => state.nodes);
  const zoom = useStore(state => state.transform[2]);
  const [hovered, setHovered] = React.useState(false);
  const connectionInProgress = useCanvasConnectionInProgress();
  const children = nodes.filter(node => node.parentId === id);
  const cards = children.slice(0, 3);
  return <div className="canvas-stack-frame" data-canvas-stack={id} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
    <CanvasNodeHeading fixedScreenSize className="canvas-group-heading"><CanvasEditableNodeName name={title} onRename={value => editor?.updateData(id, current => renameCanvasNodeData(current, value), "push")} /></CanvasNodeHeading>
    {(selected || hovered) && <div className="absolute left-0 right-0" style={{ height: 24 / zoom, top: -24 / zoom }} />}
    {[...cards].reverse().map((node, reverseIndex) => {
      const index = cards.length - 1 - reverseIndex;
      const data = node.data as CanvasNodeData;
      const imageUrl = data.kind === "image" ? data.url : data.kind === "imageTask" ? getCanvasPrimaryImageOutput(data.task.batches.at(-1))?.url : undefined;
      const videoUrl = data.kind === "video" ? data.url : data.kind === "videoTask" ? data.outputUrl : undefined;
      return <div key={node.id} className="canvas-stack-card" data-layer={index}>
        {imageUrl ? <img src={imageUrl} alt="" draggable={false} className="h-full w-full object-cover" />
          : videoUrl ? <CanvasVideoPlayer src={videoUrl} previewOnly className="h-full w-full" />
            : <div className="flex h-full items-center justify-center"><Layers3 className="h-10 w-10" /></div>}
      </div>;
    })}
    <UiProps ids={{"title":["canvas.mf527f0db8df1"]}}><button
      type="button"
      className="canvas-stack-expand nodrag nopan nowheel"
      aria-label={text("workspaceFollowup.m0cd2d2f64ebd", { v0: children.length })}
      aria-expanded={false}
      title="canvas.mf527f0db8df1"
      onPointerDown={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); editor?.groupAction(id, "ungroup"); }}
    ><Maximize2 className="h-4 w-4" />{children.length}<UiText id="canvas.mf56a049fcc23" /></button></UiProps>
    <NodeToolbar isVisible={selected || hovered} position={Position.Top} offset={24} style={{ zIndex: 50 }} className="canvas-material-toolbar nodrag nopan nowheel" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <UiProps ids={{"title":["canvas.mb45494687e39"]}}><ToolbarButton title="canvas.mb45494687e39" onClick={() => editor?.saveMediaToLibrary(id)}><FolderInput className="h-4 w-4" /><UiText id="canvas.mb45494687e39" /></ToolbarButton></UiProps>
      <UiProps ids={{"title":["canvas.mb5b27507401e"]}}><ToolbarButton title="canvas.mb5b27507401e" onClick={() => editor?.groupAction(id, "ungroup")}><Ungroup className="h-4 w-4" /><UiText id="canvas.mb5b27507401e" /></ToolbarButton></UiProps>
    </NodeToolbar>
    <CanvasConnectionHandle type="target" connectionInProgress={connectionInProgress} />
    <CanvasConnectionHandle type="source" connectionInProgress={connectionInProgress} />
  </div>;
}

type CanvasGroupTone = NonNullable<Extract<CanvasNodeData, { kind: "group" }>["tone"]>;

const CANVAS_GROUP_TONES: Array<{ value: CanvasGroupTone; label: string; color: string }> = [
  { value: "neutral", label: "灰色", color: "#898989" },
  { value: "red", label: "红色", color: "#f04f45" },
  { value: "orange", label: "橙色", color: "#ff8a2b" },
  { value: "yellow", label: "黄色", color: "#f8bd45" },
  { value: "green", label: "绿色", color: "#3ecf8e" },
  { value: "cyan", label: "青色", color: "#22b8d9" },
  { value: "blue", label: "蓝色", color: "#4285e8" },
  { value: "purple", label: "紫色", color: "#8b5cf6" },
  { value: "pink", label: "粉色", color: "#ec3e91" },
  { value: "white", label: "白色", color: "#e8e8e8" },
];

function CanvasGroupTonePicker({ value, onChange }: { value: CanvasGroupTone; onChange: (tone: CanvasGroupTone) => void }) {
  const { label: uiLabel } = useUiLocale();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const displayedValue: CanvasGroupTone = value === "primary" ? "blue" : value === "success" ? "green" : value === "warning" ? "yellow" : value;
  const selected = CANVAS_GROUP_TONES.find(option => option.value === displayedValue) ?? CANVAS_GROUP_TONES[0];
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  return <div ref={rootRef} className="canvas-group-tone-control">
    <UiProps ids={{"aria-label":["canvas.mf209a307ca65"]}}><button type="button" aria-label="canvas.mf209a307ca65" aria-expanded={open} onClick={() => setOpen(current => !current)} className="canvas-material-toolbar-item !w-10 !px-0">
      <span className="canvas-group-tone-current" style={{ backgroundColor: selected.color }} />
    </button></UiProps>
    {open && <UiProps ids={{"aria-label":["canvas.m462e2d012c46"]}}><div role="menu" aria-label="canvas.m462e2d012c46" className="canvas-group-tone-menu">
      {CANVAS_GROUP_TONES.map(option => <button
        key={option.value}
        type="button"
        role="menuitemradio"
        aria-label={uiLabel(option.label)}
        aria-checked={option.value === displayedValue}
        className="canvas-group-tone-option"
        onClick={() => { onChange(option.value); setOpen(false); }}
      ><span style={{ backgroundColor: option.color }} /></button>)}
    </div></UiProps>}
  </div>;
}

function CanvasGroupFrame({ id, data, selected }: { id: string; data: Extract<CanvasNodeData, { kind: "group" }>; selected: boolean }) {
  const { text } = useUiLocale();
  const editor = React.useContext(CanvasNodeEditorContext);
  const marqueeActive = useStore(state => Boolean(state.userSelectionActive || state.userSelectionRect));
  const readOnly = useCanvasReadOnly();
  const groupSelected = selected && !marqueeActive && (editor?.isGroupSelected?.(id) ?? selected);
  const zoom = useStore(state => state.transform[2]);
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(data.title);
  const cancelRename = React.useRef(false);
  const saveTitle = () => {
    setEditing(false);
    if (cancelRename.current) return;
    const next = title.trim() || "分组";
    if (next !== data.title) editor?.updateData(id, current => current.kind === "group" ? { ...current, title: next } : current, "push");
  };
  if (data.stacked) return <CanvasStackFrame id={id} title={data.title} selected={groupSelected} />;
  return (
    <div data-canvas-group-frame={id} data-collapsed={Boolean(data.collapsed)} data-tone={data.tone || "neutral"} className={`canvas-group-frame${groupSelected ? " canvas-group-frame-selected" : ""}`} style={{ "--canvas-group-drag-hit": `${8 / zoom}px` } as React.CSSProperties}>
      {!data.collapsed && ["top", "right", "bottom", "left"].map((side) => <div key={side} aria-hidden="true" data-canvas-group-drag-side={side} className="canvas-group-drag-border" />)}
      <NodeResizer isVisible={!readOnly && groupSelected && !data.collapsed} minWidth={320} minHeight={220} color="var(--canvas-node-border-selected)" onResizeEnd={() => editor?.groupAction(id, "fit")} />
      <CanvasNodeHeading fixedScreenSize className="canvas-group-heading" onDoubleClick={event => {
        event.stopPropagation();
        if (editing || readOnly) return;
        cancelRename.current = false;
        setTitle(data.title);
        setEditing(true);
      }}>
        {editing ? <UiProps ids={{"aria-label":["canvas.md7e266bdc806"]}}><input aria-label="canvas.md7e266bdc806" autoFocus value={title} className="nodrag nopan nowheel min-w-0" onFocus={event => event.currentTarget.select()} onPointerDown={event => event.stopPropagation()} onChange={event => setTitle(event.target.value)} onBlur={saveTitle} onKeyDown={event => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === "Escape") { event.preventDefault(); cancelRename.current = true; event.currentTarget.blur(); }
        }} /></UiProps> : <span title={text("workspaceFollowup.m265f31190566", { v0: data.title })}>{data.title}</span>}
        {data.collapsed && <span><UiText id="canvas.mee60469308d3" /></span>}
      </CanvasNodeHeading>
      {groupSelected && <NodeToolbar isVisible position={Position.Top} offset={42} style={{ zIndex: 50 }} className="nodrag nopan nowheel canvas-group-toolbar" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        <CanvasGroupTonePicker value={data.tone || "neutral"} onChange={tone => editor?.updateData(id, current => current.kind === "group" ? { ...current, tone } : current, "push")} />
        <UiProps ids={{"title":["canvas.m00bd3960fea8","canvas.m84a07f292f1f"]}}><ToolbarButton viewAction title={data.collapsed ? "canvas.m00bd3960fea8" : "canvas.m84a07f292f1f"} onClick={() => editor?.groupAction(id, "toggle")}>{data.collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}{data.collapsed ? <UiText id="canvas.m00bd3960fea8" /> : <UiText id="canvas.m84a07f292f1f" />}</ToolbarButton></UiProps>
        <FrostedSelect
          value=""
          onChange={layout => editor?.groupAction(id, "arrange", layout as CanvasGroupLayout)}
          options={[
            { value: "tidy", label: text("workspaceFollowup.m3e83fad2fad5"), buttonLabel: "整理" },
            { value: "grid", label: text("workspaceFollowup.m8f3f96ccab97") },
            { value: "horizontal", label: text("workspaceFollowup.mf8ce76d76d0a") },
            { value: "vertical", label: text("workspaceFollowup.m2d03a9d86527") },
          ]}
          ariaLabel={text("workspaceFollowup.m0c7869db48b4")}
          variant="canvas"
          side="top"
          menuWidth={168}
          menuClassName="!max-h-none !overflow-hidden"
          optionHeight={40}
          buttonClassName="canvas-material-toolbar-item nodrag !h-10 !gap-1.5 !px-3"
          renderLeading={(option, { placement }) => {
            const Icon = placement === "option" && option.value === "horizontal" ? AlignHorizontalSpaceAround
              : placement === "option" && option.value === "vertical" ? AlignVerticalSpaceAround
                : LayoutGrid;
            return <Icon className="h-3.5 w-3.5 shrink-0" />;
          }}
        />
        <UiProps ids={{"title":["canvas.m6136d11c6054"]}}><ToolbarButton viewAction title="canvas.m6136d11c6054" onClick={() => editor?.groupAction(id, "preview")}><Eye className="h-3.5 w-3.5" /><UiText id="canvas.m13d61fea9f17" /></ToolbarButton></UiProps>
        <UiProps ids={{"title":["canvas.mb6dcc71b7a2b"]}}><ToolbarButton title="canvas.mb6dcc71b7a2b" onClick={() => editor?.groupAction(id, "grid")}><Grid3x3 className="h-3.5 w-3.5" /><UiText id="canvas.mb6dcc71b7a2b" /></ToolbarButton></UiProps>
        <UiProps ids={{"title":["canvas.mb45494687e39"]}}><ToolbarButton title="canvas.mb45494687e39" onClick={() => editor?.saveMediaToLibrary(id)}><FolderInput className="h-3.5 w-3.5" /><UiText id="canvas.mb45494687e39" /></ToolbarButton></UiProps>
        <UiProps ids={{"title":["canvas.m61522095240d"]}}><ToolbarButton viewAction title="canvas.m61522095240d" onClick={() => editor?.groupAction(id, "download")}><Archive className="h-3.5 w-3.5" /><UiText id="canvas.m61522095240d" /></ToolbarButton></UiProps>
        <UiProps ids={{"title":["canvas.m5b5f449faba8"]}}><ToolbarButton title="canvas.m5b5f449faba8" onClick={() => editor?.groupAction(id, "ungroup")}><Ungroup className="h-3.5 w-3.5" /><UiText id="canvas.m208b2e807c1b" /></ToolbarButton></UiProps>
      </NodeToolbar>}
    </div>
  );
}

type CanvasNodeCardProps = NodeProps<CanvasFlowNode> & { deferContent?: boolean };

export function CanvasNodeCard(props: CanvasNodeCardProps) {
  const editor = React.useContext(CanvasNodeEditorContext);
  const { data } = props;
  // Position belongs to React Flow's outer wrapper. Passing it into the content
  // defeats memoization on every drag frame despite unchanged media and controls.
  const content = <CanvasNodeCardContent id={props.id} type={props.type} data={data}
    selected={props.selected} dragging={props.dragging} width={props.width} height={props.height}
    deferContent={props.deferContent} />;
  const src = data.kind === "video" ? data.url : data.kind === "videoTask" ? data.outputUrl : undefined;
  const exportVideoFrame = editor?.exportVideoFrame;
  const onCapture = React.useCallback(async (frame: CapturedVideoFrame, mode: VideoFrameMode) => {
    if (src) await exportVideoFrame?.(props.id, frame, mode, src);
  }, [exportVideoFrame, props.id, src]);
  if (src && editor) {
    return <CanvasVideoFrameProvider key={src} src={src} onCapture={onCapture}><CanvasVideoClipProvider nodeId={props.id} src={src} selected={Boolean(props.selected)}
      onExport={editor.exportVideoClip ? clip => editor.exportVideoClip!(props.id, clip, src) : undefined}><CanvasVideoCropProvider nodeId={props.id} src={src} selected={Boolean(props.selected)}
        onExport={editor.exportVideoClip ? clip => editor.exportVideoClip!(props.id, clip, src, "crop") : undefined}><CanvasVideoSubtitleRemovalProvider nodeId={props.id} selected={Boolean(props.selected)} onRemove={editor.removeVideoSubtitles ? (options, size) => editor.removeVideoSubtitles!(props.id, src, options, size) : undefined}>{content}</CanvasVideoSubtitleRemovalProvider></CanvasVideoCropProvider></CanvasVideoClipProvider></CanvasVideoFrameProvider>;
  }
  const audioSrc = data.kind === "audio" ? data.url : data.kind === "audioTask" ? data.outputUrl : undefined;
  if (audioSrc && editor?.exportAudioClip && (data.kind === "audio" || data.kind === "audioTask")) {
    return <CanvasAudioTrimProvider key={audioSrc} nodeId={props.id} src={audioSrc} durationSeconds={data.durationSeconds}
      onExport={(clip, speed) => editor.exportAudioClip!(props.id, clip, audioSrc, speed)}>{content}</CanvasAudioTrimProvider>;
  }
  return content;
}

type CanvasNodeContentProps = Pick<CanvasNodeCardProps, "id" | "type" | "data" | "selected" | "dragging" | "width" | "height" | "deferContent">;
const CanvasNodeCardContent = React.memo(function CanvasNodeCardContent({ id, type, data, selected, dragging, width, height, deferContent = false }: CanvasNodeContentProps) {
  const { label: uiLabel } = useUiLocale();
  const kind = (type || data.kind) as CanvasNodeKind;
  const readOnly = useCanvasReadOnly();
  React.useEffect(() => {
    if (readOnly) return;
    if (kind !== "imageTask" && kind !== "videoTask" && kind !== "audioTask" && kind !== "llm") return;
    // Prepare the editor after the canvas paints, including low-detail task nodes.
    const warm = () => { void loadPromptRichEditor().catch(() => undefined); };
    if (typeof window.requestIdleCallback === "function") {
      const idle = window.requestIdleCallback(warm, { timeout: 1500 });
      return () => window.cancelIdleCallback(idle);
    }
    const timer = window.setTimeout(warm, 250);
    return () => window.clearTimeout(timer);
  }, [kind, readOnly]);
  const Icon = icons[kind];
  const editor = React.useContext(CanvasNodeEditorContext);
  const panelsVisible = (editor?.isPanelVisible(id) ?? Boolean(selected));
  const connectionInProgress = useCanvasConnectionInProgress();
  const connectionTargetState = useCanvasConnectionTargetState(id);
  const connectionTouchesNode = useConnection<CanvasFlowNode, boolean>((connection) => Boolean(
    connection.inProgress && connection.fromNode?.id === id,
  ));
  const supportsLowDetail = hasCanvasThumbnailContent(data);
  const preserveFullDetail = Boolean(selected || Boolean(dragging) || connectionTouchesNode || connectionTargetState || hasCanvasNodeActiveDetail(data));
  const lowDetail = useCanvasExtremeLod(!supportsLowDetail || preserveFullDetail);
  const nodeGeometryRef = useCanvasNodeGeometrySync(id, data);
  const connectionTargetFrameRef = React.useRef<HTMLDivElement>(null);
  const showLowDetail = (lowDetail || (deferContent && !preserveFullDetail)) && supportsLowDetail;
  const imageResolution = useCanvasImageResolution(
    data.kind === "image" ? data.variants?.original?.url || data.url : undefined,
    data.kind === "image" ? formatCanvasMediaResolution(data) : undefined,
    !showLowDetail,
  );
  React.useEffect(() => {
    // Thumbnail tiers do not fire onOriginalLoad. Persist the independently
    // queried source dimensions so the Agent layout repair can resize the node.
    if (readOnly || data.kind !== "image" || !imageResolution || !isCreativeAgentMediaPlaceholder({ data, width, height })
      || (data.variants?.original?.width && data.variants.original.height)) return;
    const [naturalWidth, naturalHeight] = imageResolution.split("×").map(Number);
    if (!(naturalWidth > 0 && naturalHeight > 0)) return;
    editor?.updateData(id, current => current.kind === "image" && current.url === data.url
      ? hydrateCanvasMediaDimensions(current, naturalWidth, naturalHeight) : current, "replace");
  }, [id, data, width, height, imageResolution, editor, readOnly]);
  React.useEffect(() => {
    // Repair only the legacy editor fallback frame, never user-resized materials.
    if (!id.startsWith("edited-") || data.kind !== "image" || data.origin !== "generated"
      || width !== 280 || height !== 240 || !imageResolution) return;
    const [naturalWidth, naturalHeight] = imageResolution.split("×").map(Number);
    if (naturalWidth > 0 && naturalHeight > 0) {
      editor?.updateNodeSize(id, getCanvasMediaNodeSize(naturalWidth, naturalHeight));
    }
  }, [id, data, width, height, imageResolution, editor]);
  const handoffSource = data.kind === "image" ? data.url : data.kind === "video" ? data.posterUrl || data.url : data.kind === "imageTask" ? getCanvasLowDetailImageUrl(data) : data.kind === "videoTask" ? data.outputUrl : undefined;
  if (showLowDetail && (data.kind === "image" || data.kind === "video" || data.kind === "imageTask" || data.kind === "videoTask" || data.kind === "audioTask" || data.kind === "llm")) {
    const frameSize = data.kind === "imageTask" || data.kind === "videoTask" || data.kind === "audioTask"
      ? getCanvasTaskResultFrameSize(data)
      : data.kind === "llm"
        ? getCanvasTextTaskFrameSize(data)
        : {
            width: width ?? DEFAULT_CANVAS_MEDIA_NODE_SIZE.width,
            height: height ?? DEFAULT_CANVAS_MEDIA_NODE_SIZE.height,
          };
    return <CanvasLodHandoff lowDetail source={handoffSource}><div ref={nodeGeometryRef}><CanvasNodeLowDetail id={id} data={data} width={frameSize.width} height={frameSize.height} selected={Boolean(selected)} connectionTargetState={connectionTargetState} /></div></CanvasLodHandoff>;
  }
  if (data.kind === "imageTask" || data.kind === "videoTask" || data.kind === "audioTask" || data.kind === "llm") {
    return <CanvasLodHandoff lowDetail={false} source={handoffSource}><TaskWorkspace id={id} data={data} dragging={Boolean(dragging)} selected={Boolean(selected)} /></CanvasLodHandoff>;
  }
  if (data.kind === "breakdown") return <CanvasBreakdownNode id={id} data={data} width={width} height={height} selected={Boolean(selected)} />;
  if (data.kind === "compare") return <CanvasImageCompareNode id={id} data={data} width={width} height={height} selected={Boolean(selected)} connectionInProgress={connectionInProgress} connectionTargetState={connectionTargetState} />;
  if (kind === "group" && data.kind === "group") {
    return <CanvasGroupFrame id={id} data={data} selected={Boolean(selected)} />;
  }
  if (data.kind === "prompt") {
    return (
      <div ref={nodeGeometryRef} className="relative" style={{ width: width ?? 350, height: height ?? 200 }}>
        <CanvasTextNode
          id={id}
          data={data}
          selected={Boolean(selected)}
          toolbarVisible={editor ? editor.isPanelVisible(id) : Boolean(selected)}
          connectionInProgressOverride={editor?.connectionInProgress}
          connectionFeedbackTarget={editor?.connectionFeedbackTarget ?? null}
          width={width}
          height={height}
          onTextChange={(text) => editor?.updateData(id, (current) => current.kind === "prompt" ? { ...current, text } : current)}
          onBackgroundColorChange={(backgroundColor) => editor?.updateData(id, (current) => current.kind === "prompt" ? { ...current, backgroundColor } : current, "push")}
          onTitleChange={(title) => editor?.updateData(id, (current) => current.kind === "prompt" ? { ...current, title } : current, "push")}
          onSizeChange={(size) => editor?.updateNodeSize(id, size)}
          onSizeEnd={() => editor?.finishNodeResize?.()}
        />
      </div>
    );
  }
  if (data.kind === "image" || data.kind === "video" || data.kind === "audio") {
    const panelSelected = panelsVisible;
    const nodeSelected = Boolean(selected);
    const uploading = data.url.trim().toLowerCase().startsWith("blob:");
    const acceptsInput = data.origin !== "upload";
    const showPendingMediaPreview = uploading;
    const mediaSize = {
      width: width ?? (data.kind === "audio" ? DEFAULT_CANVAS_AUDIO_NODE_SIZE.width : DEFAULT_CANVAS_MEDIA_NODE_SIZE.width),
      height: height ?? (data.kind === "audio" ? DEFAULT_CANVAS_AUDIO_NODE_SIZE.height : DEFAULT_CANVAS_MEDIA_NODE_SIZE.height),
    };
    const imageTargetHandleClassName = "!z-10 !rounded-[inherit] !border-0 !bg-transparent !opacity-0";
    const materialName = editor?.getMediaName(id) || data.name || labels[data.kind];
    const materialResolution = data.kind === "image" ? imageResolution : formatCanvasMediaResolution(data);
    return (
      <CanvasLodHandoff lowDetail={false} source={handoffSource}>
        <div
          ref={nodeGeometryRef}
          data-canvas-connection-target-id={id}
          data-canvas-material-target-state={connectionTargetState || undefined}
          className={`group/material relative ${connectionTargetState === "invalid" ? "canvas-connection-target-invalid-frame" : ""}`}
          style={mediaSize}
          onPointerMove={(event) => updateCanvasConnectionTargetTilt(event, connectionTargetState === "valid", connectionTargetFrameRef.current)}
          onPointerLeave={(event) => resetCanvasConnectionTargetTilt(event, connectionTargetFrameRef.current)}
        >
        <CanvasMaterialMetadata id={id} kind={data.kind} name={materialName} resolution={materialResolution} />
        {!uploading && editor?.replaceMediaFile && <CanvasReplaceMediaButton kind={data.kind} onUpload={file => editor.replaceMediaFile!(id, file)} onHistory={() => editor.replaceMediaHistory?.(id)} />}
        {panelSelected && data.kind === "image" && !uploading && <CanvasMaterialToolbar><UiProps ids={{"title":["canvas.m184506303bf5"]}}><ToolbarButton title="canvas.m184506303bf5" onClick={() => editor?.openImageEditor(id, "crop")}><Scissors className="h-4 w-4" /><UiText id="canvas.m184506303bf5" /></ToolbarButton></UiProps><UiProps ids={{"title":["canvas.m05731b92ad31"]}}><ToolbarButton title="canvas.m05731b92ad31" onClick={() => editor?.openImageEditor(id, "brush")}><Brush className="h-4 w-4" /><UiText id="canvas.m05731b92ad31" /></ToolbarButton></UiProps><CanvasImageGridMenu onSplit={() => editor?.openImageEditor(id, "grid")} onCharacterSheet={() => editor?.createCharacterSheet?.(id, data.url)} /><CanvasAngleButton imageUrl={data.url} onApply={(angle, settings) => { if (!editor?.generateAngle) throw new Error("画布尚未准备好"); editor.generateAngle(id, data.url, angle, settings); }} /><CanvasMaterialToolbarSeparator /><UiProps ids={{"title":["canvas.m4673a2306165"]}}><ToolbarButton viewAction title="canvas.m4673a2306165" onClick={() => editor?.downloadMedia(id)}><Download className="h-4 w-4" /><UiText id="canvas.m4673a2306165" /></ToolbarButton></UiProps><CanvasSaveToLibraryButton onClick={() => editor?.saveMediaToLibrary(id)} /><CanvasMaterialPreviewButton onClick={() => editor?.previewMedia(id)} /></CanvasMaterialToolbar>}
        {panelSelected && data.kind === "video" && !uploading && <CanvasMaterialToolbar><CanvasVideoClipButton breakdown={editor?.breakdownVideo ? { models: editor.breakdownModels ?? [], onStart: model => editor.breakdownVideo!(id, data.url, model) } : undefined} /><CanvasVideoSubtitleRemovalButton /><CanvasVideoSeparateButton job={editor?.videoSeparationJobs?.[id]} onSeparate={editor?.separateVideo ? (mode) => editor.separateVideo!(id, data.url, undefined, undefined, mode) : undefined} /><CanvasVideoFrameControl placement="toolbar" /><CanvasMaterialToolbarSeparator /><UiProps ids={{"title":["canvas.m4673a2306165"]}}><ToolbarButton viewAction title="canvas.m4673a2306165" onClick={() => editor?.downloadMedia(id)}><Download className="h-4 w-4" /><UiText id="canvas.m4673a2306165" /></ToolbarButton></UiProps><CanvasSaveToLibraryButton onClick={() => editor?.saveMediaToLibrary(id)} /><CanvasMaterialPreviewButton onClick={() => editor?.previewMedia(id)} /></CanvasMaterialToolbar>}
        {panelSelected && data.kind === "audio" && !uploading && <CanvasMaterialToolbar><CanvasAudioTrimButton /><CanvasAudioSpeedButton /><UiProps ids={{"title":["canvas.m4673a2306165"]}}><ToolbarButton viewAction title="canvas.m4673a2306165" onClick={() => editor?.downloadMedia(id)}><Download className="h-4 w-4" /><UiText id="canvas.m4673a2306165" /></ToolbarButton></UiProps><CanvasSaveToLibraryButton onClick={() => editor?.saveMediaToLibrary(id)} /></CanvasMaterialToolbar>}
        <NodeResizer isVisible={false} minWidth={120} minHeight={120} keepAspectRatio color="var(--primary-bg)" />
        {acceptsInput && <Handle
          id={CANVAS_MEDIA_BODY_TARGET_HANDLE_ID}
          data-canvas-media-body-target
          type="target"
          position={Position.Left}
          isConnectableStart={false}
          isConnectableEnd={!uploading}
          className={imageTargetHandleClassName}
          style={{ inset: -20, width: "auto", height: "auto", transform: "none", pointerEvents: connectionInProgress && !uploading ? "auto" : "none" }}
        />}
        <div
          ref={connectionTargetFrameRef}
          data-canvas-connection-target-state={connectionTargetState || undefined}
          className={[
            `canvas-material-frame canvas-connection-target h-full w-full ${nodeSelected ? "canvas-material-frame-selected" : ""}`,
            connectionTargetState === "valid" ? "canvas-connection-target-valid" : "",
            connectionTargetState === "invalid" ? "canvas-connection-target-invalid" : "",
          ].join(" ")}
        >
          <div className={`h-full w-full ${showPendingMediaPreview ? "canvas-media-uploading-preview" : ""}`}>
            <Body id={id} data={data} />
          </div>
          {showPendingMediaPreview ? (
            <div data-canvas-media-uploading className="canvas-media-uploading-overlay">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span><UiText id="canvas.m4986eb0b7b65" /></span>
            </div>
          ) : null}
        </div>
        {!uploading && <CanvasConnectionHandle handleId={CANVAS_MEDIA_INPUT_HANDLE_ID} type="target" connectionInProgress={connectionInProgress} acceptsInput={acceptsInput} />}
        {!uploading && <CanvasConnectionHandle type="source" connectionInProgress={connectionInProgress} />}
      </div>
      </CanvasLodHandoff>
    );
  }
  return (
    <div className={`relative canvas-connection-target w-[280px] rounded-2xl border bg-[var(--panel-bg)] p-3 shadow-[var(--shadow-2)] ${selected ? "border-[var(--primary-bg)]" : "border-[var(--border)]"} ${connectionTargetState === "valid" ? "canvas-connection-target-valid" : ""} ${connectionTargetState === "invalid" ? "canvas-connection-target-invalid canvas-connection-target-invalid-frame" : ""}`} data-canvas-connection-target-id={id} data-canvas-connection-target-state={connectionTargetState || undefined}>
      <NodeResizer isVisible={selected && !readOnly} minWidth={240} minHeight={120} color="var(--primary-bg)" />
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-[var(--panel-bg)] !bg-[var(--primary-bg)]" />
      <div className="mb-3 flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--panel-2)] text-[var(--primary-bg)]"><Icon className="h-4 w-4" /></span><CanvasEditableNodeName name={("title" in data && data.title) || uiLabel(labels[kind])} onRename={value => editor?.updateData(id, current => renameCanvasNodeData(current, value), "push")} /></div>
      <Body id={id} data={data} />
      <Handle id={CANVAS_RIGHT_OUTPUT_HANDLE_ID} type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-[var(--panel-bg)] !bg-[var(--primary-bg)]" />
    </div>
  );
});
