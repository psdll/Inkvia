"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";

import { isSeedream55Model } from "@/lib/volcengine-seedream-55";
import { CANVAS_MAX_MARKDOWN_TEXT_BYTES, utf8ByteLength, validateCanvasDocumentBudget } from "@/lib/canvas/limits";
import { createSubtitleRemovalNode, type SubtitleRemovalOptions } from "@/lib/canvas/subtitle-removal";
import type { AngleGenerationSettings } from "./creative/CanvasAngleEditor";
import { hasCreativeSettings, type ImageAngle } from "@/lib/canvas/creative-presets/types";
import { createCanvasAngleTask } from "@/lib/canvas/creative-presets/create-angle-task";
import { buildCanvasCharacterSheetPrompt, createCanvasCharacterSheetTask } from "@/lib/canvas/character-sheet";

import { isQwenImage3Model } from "@/lib/qwen-image-3-models";
import { collectCanvasTextReferences } from "@/lib/canvas/text-references";
import { sizeNewlyConnectedComparisons } from "@/lib/canvas/image-compare";

import { getAvailableGptImage25Mode, resolveGptImage25Selection } from "@/lib/gpt-image-25-models";

import * as React from "react";
import { flushSync } from "react-dom";
import { startCanvasConnectionAutoPan } from "@/lib/canvas/connection-auto-pan";
import { createBrowserUuid } from "@/lib/browser/random-uuid";
import dynamic from "next/dynamic";
import {
  BaseEdge,
  Panel,
  Position,
  ReactFlowProvider,
  SelectionMode,
  ViewportPortal,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  getBezierPath,
  useReactFlow,
  useStore,
  useStoreApi,
  type Connection,
  type ConnectionLineComponentProps,
  type EdgeChange,
  type EdgeProps,
  type EdgeTypes,
  type NodeChange,
  type OnConnectEnd,
  type OnConnectStart,
  type OnNodeDrag,
  type NodeTypes,
  type ReactFlowProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Archive,
  Clapperboard,
  Copy,
  ClipboardPaste,
  FolderInput,
  History,
  Group,
  Columns2,
  Hand,
  ImagePlus,
  Images,
  Keyboard,
  MessageSquareText,
  Music2,
  MousePointer2,
  Plus,
  PackageOpen,
  Scissors,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { CanvasAudioPlaybackProvider } from "@/components/canvas/CanvasAudioPlayback";
import { CanvasDeferredNode, CanvasRenderRuntimeProvider, useCanvasInteracting } from "@/components/canvas/CanvasRenderRuntime";
import { CanvasMediaPrefetch } from "@/components/canvas/CanvasMediaPrefetch";
import { CanvasSaveToLibraryDialog } from "@/components/canvas/CanvasSaveToLibraryDialog";
import { CanvasEdgeViewport } from "./CanvasEdgeViewport";
import { CanvasSharedEdgeProvider, CanvasSharedEdgeLayer, CanvasSharedPassiveEdge } from "./CanvasSharedPassiveEdges";
import { CanvasConnectionHandleSurface, CanvasConnectionHandleClickContext, type CanvasConnectionHandleClick } from "@/components/canvas/CanvasConnectionHandle";
import { CanvasNodeEditorContext, type CanvasBreakdownModel, type CanvasFlowNode, type CanvasVideoFocusRequest } from "@/components/canvas/CanvasNodeCard";
import { CanvasNodeSubscriptionsProvider } from "./CanvasNodeSubscriptions";
import { CanvasLodProvider } from "./canvas-runtime-context";
import type { CanvasPreviewItem } from "@/components/canvas/CanvasMediaPreview";
import { CanvasViewportChrome } from "@/components/canvas/CanvasViewportChrome";
import { CanvasToolMenu, type CanvasToolMode } from "@/components/canvas/CanvasToolMenu";
import { isSunoModel, sunoPrompt } from "@/lib/suno-models";
import { AudioSubmissionError, CANVAS_GENERATION_FOREGROUND_WAIT_MS, shouldResumeCanvasGeneration, submitAudioGen, submitImageGen, submitVideoGen, waitForGenerationOutputs, waitForGenerationResult } from "@/components/canvas/run-node";
import type { CanvasGenerationOutput } from "@/lib/canvas/generation-outputs";
import { isMidjourneyV8Model } from "@/lib/midjourney-v8";
import { normalizeMediaUrl } from "@/lib/media-url";
import { resolveCanvasModelId, useCanvasModels } from "@/components/canvas/use-canvas-models";
import { CANVAS_MEDIA_BODY_TARGET_HANDLE_ID, CANVAS_MEDIA_INPUT_HANDLE_ID, CANVAS_RIGHT_OUTPUT_HANDLE_ID, connectCanvasNodeSelection, getCanvasSelectionConnectionSources, connectCanvasShortcutSelection, getCanvasConnectionDecision, normalizeCanvasConnectionTargetHandle } from "@/lib/canvas/connection-rules";
import { CANVAS_CONNECTION_HANDLE_HIT_SIZE } from "@/lib/canvas/connection-handle-motion";
import { resetCanvasConnectionTargetTilts, canvasRendererPointToFlowPoint, resolveCanvasConnectionCandidateState, resolveCanvasConnectionPreviewTarget, type CanvasConnectionFeedbackTarget } from "@/lib/canvas/connection-feedback";
import { getCanvasEdgeCutWorldGeometry } from "@/lib/canvas/edge-cut-geometry";
import { getCanvasNodeFocusViewport } from "@/lib/canvas/node-focus";
import { animateCanvasFocus } from "@/lib/canvas/focus-animation";
import { registerCanvasEdgeFlow } from "@/lib/canvas/edge-flow-renderer";
import { reflowDerivedNodePositions } from "@/lib/canvas/derived-node-layout";
import type { CanvasDocumentV2, CanvasEdge, CanvasMediaIdentity, CanvasNode, CanvasNodeData, CanvasNodeKind } from "@/lib/canvas/document";
import { normalizeCanvasMediaOrigins } from "@/lib/canvas/document";
import { collapseLegacyVideoResultDuplicates, completeImageTaskOutput, createImageTaskBatch, updateImageTaskOutput } from "@/lib/canvas/execution";
import { mergeCanvasImageResultNodes } from "@/lib/canvas/image-result-nodes";
import { buildExecutionPlan, downstreamNodeIds, type ExecutionScope } from "@/lib/canvas/orchestration";
import type { CreativeAgentBoardBridge, CreativeAgentSelection } from "@/lib/creative-agent/contracts";
import { getCreativeAgentSelection } from "@/lib/creative-agent/canvas-selection";
import { applyCreativeAgentRemoteHistory } from "@/lib/creative-agent/canvas-history";
import { createCanvasHistory, pushCanvasHistory, replaceCanvasHistoryPresent, undoCanvasHistory, redoCanvasHistory, type CanvasHistory } from "@/lib/canvas/history";
import { preserveCanvasTaskExecutions } from "@/lib/canvas/task-history";
import { getCanvasTextNodeTitle, getCanvasTextTaskFrameSize, startCanvasTextWriting } from "@/lib/canvas/text-node";
import { arrangeCanvas, type CanvasArrangeOptions } from "@/lib/canvas/arrangement";
import { arrangeGroupChildren, autoArrangeNodes, doesCanvasMarqueeIntersectNode, duplicateSelection, expandCanvasMultiSelectionBounds, groupSelection, stackSelection, removeSelection, resolveCanvasMarqueeSelection, toggleGroupCollapsed, ungroupSelection, type CanvasGroupLayout, type CanvasMarqueeSelectionMode } from "@/lib/canvas/graph";
import { createCanvasGroupDragGeometry, fitCanvasGroupBounds, findCanvasGroupDropTargets, findCanvasGroupAtPoint, joinCanvasGroups, joinAndAlignCanvasGroups, alignNewCanvasGroupMember, moveCanvasNodeOutOfGroup } from "@/lib/canvas/group-layout";
import { resolveCanvasShortcut } from "@/lib/canvas/shortcuts";
import { bindCanvasPanReleaseGuard } from "@/lib/canvas/pan-release-guard";
import { getCanvasWheelZoomViewport } from "@/lib/canvas/wheel-zoom";
import { omitPendingCanvasUploads, resolveCanvasPendingUpload, settleCanvasPendingUpload, type CanvasMediaKind, type CanvasPendingUploadResult } from "@/lib/canvas/pending-uploads";
import { canvasReplacementTarget, replaceCanvasMedia, type ReplacementMedia } from "@/lib/canvas/replace-media";
import { appendCanvasDocument, parseCanvasJson } from "@/lib/canvas/transfer";
import { buildCanvasTaskMediaInput, collectCanvasTaskAssets, disconnectCanvasEdge, getCanvasImageResultLayout, getCanvasTaskResultFrameSize, collectCanvasVideoReferences, hasPendingCanvasTaskUploads, insertCanvasTaskReferences, normalizeCanvasTaskNodeSizes, reorderCanvasTaskReferences, syncCanvasTaskAssetChanges, syncCanvasTaskPromptsWithEdges } from "@/lib/canvas/task-references";
import { getCanvasVideoReferenceError } from "@/lib/canvas/video-references";
import { buildCanvasSeedAudioInput, getCanvasAudioModelReferenceError } from "@/lib/canvas/seed-audio";
import { isSeedAudioModel } from "@/lib/seed-audio-models";
import { getCanvasReferenceInsertion, type CanvasReferenceInsertion } from "@/lib/canvas/reference-drop";
import { readMediaLibraryDragItems } from "@/lib/media-library-drag";
import { inferPromptAssetKind } from "@/lib/prompt-asset-references";
import { applyCanvasTaskPreferences, carryCanvasImageTaskSettingsToModel, normalizeCanvasVideoTaskForModel, readCanvasTaskPreferences, rememberCanvasTaskPreferences, restoreCanvasAudioModelPreference, restoreCanvasImageModelPreference, restoreCanvasVideoModelPreference, writeCanvasTaskPreferences, type CanvasTaskPreferences } from "@/lib/canvas/task-preferences";
import { getCanvasPrimaryImageOutput, isCanvasImageBatchExpanded, getCanvasImageModelParams, getCanvasImageRequestCount, getCanvasImageSubmissionResolution } from "@/lib/canvas/image-task";
import { DEFAULT_CANVAS_MEDIA_NODE_SIZE, DEFAULT_CANVAS_AUDIO_NODE_SIZE, getCanvasMediaNodeSize, compactCanvasMediaNodeSizes } from "@/lib/canvas/media-size";
import { restoreCreativeAgentMediaSizes } from "@/lib/creative-agent/media-layout";
import { useRestoreAgentMediaTasks } from "@/components/creative-agent/use-restore-media-tasks";
import { getCanvasAudioClipName, type CanvasAudioClip } from "@/lib/canvas/audio-trim";
import { getCanvasAudioSpeedName } from "@/lib/canvas/audio-speed";
import { getCanvasImageOutputName, getCanvasMediaDownloadName, getCanvasMediaNodeName, getCanvasTaskGeneratedMediaName, getNextCanvasMaterialName } from "@/lib/canvas/material-name";
import {
  analyzeAudioFile,
  analyzeAudioUrlCached,
  hydrateCanvasAudioNode,
  registerAudioWaveformPromise,
  type CanvasAudioWaveformData,
} from "@/lib/canvas/audio-waveform";
import { buildPromptWithAssetReferences } from "@/lib/prompt-asset-references";
import { uploadCanvasMedia } from "@/lib/canvas/media-upload-client";
import { CANVAS_IMAGE_UPLOAD_BATCH_LIMIT, CANVAS_PENDING_AUDIO_NODE_SIZE, getCanvasLocalUploadNodeSize, getCanvasUrlMediaNodeSize, getCanvasLocalUploadPositions, hydrateCanvasLocalUploadLayout } from "@/lib/canvas/local-upload-size";
import { VIDEO_FRAME_LABELS, videoFrameNodeName, type VideoFrameMode } from "@/lib/video-frame";
import type { CapturedVideoFrame } from "@/lib/browser/video-frame-capture";
import { resolveCanvasAlignment, type CanvasAlignmentGuide, type CanvasAlignmentRect } from "@/lib/canvas/alignment-guides";
import { createCanvasDragAlignment } from "@/lib/canvas/drag-alignment";
import { dismissCanvasTaskPopovers } from "@/lib/canvas/task-popover-events";
import { getCanvasVideoClipName, type CanvasVideoClip } from "@/lib/canvas/video-clip";
import { getCanvasVideoSeparationNames, separateCanvasVideo, extractCanvasVideoAudio, type CanvasVideoSeparationMode, type CanvasVideoSeparationJob } from "@/lib/canvas/video-separation";
import { applyCanvasPositionChanges, mergeCanvasRenderNodes, orderCanvasParentsFirst } from "@/lib/canvas/drag-render-state";
import { CanvasDragFlow, createCanvasDragPositions } from "./CanvasDragFlow";
import { CanvasEdgeFlowLayer, CanvasEdgeFlowRegistryContext, createCanvasEdgeFlowRegistry, useCanvasEdgeFlowRegistration } from "./CanvasEdgeFlowLayer";
import { BreakdownJobGoneError, cancelCanvasShotBreakdown, followCanvasShotBreakdown, streamCanvasShotBreakdown } from "./shot-breakdown-client";
import { applyBreakdownEvent, createBreakdownData, listBreakdownModels, restartBreakdownData, settleAbandonedBreakdown } from "@/lib/canvas/shot-breakdown/client-state";
import { isDeliberateDoubleClick } from "@/lib/canvas/double-click-gate";
import { BREAKDOWN_CARD_SIZE, breakdownOutputIds, planBreakdownFrameGrid, planBreakdownOutputs } from "@/lib/canvas/shot-breakdown/layout";
import type { BreakdownEvent } from "@/lib/canvas/shot-breakdown/types";
import { getCanvasFlowGeometry } from "@/lib/canvas/flow-geometry";
import { getCanvasEdgePointLookup, getCanvasEdgeSelectionPoints } from "@/lib/canvas/edge-point-cache";
import {CanvasSpatialIndex, viewportToWorldBounds,  canvasNodeWorldPosition } from "@/lib/canvas/spatial-index";
import { createMarqueeIndex, createMarqueeFrame, sampledPathIntersectsRect, stableMarqueeIds, type MarqueeRect } from "@/lib/canvas/marquee-selection";
import { CANVAS_LOD_EXIT_ZOOM, CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM, CANVAS_ZOOM_STEP } from "@/lib/canvas/visual-policy";
import {
  collectCanvasDocumentUndoMediaRefs,
  collectCanvasHistoryUndoMediaRefs,
  type CanvasUndoMediaRef,
} from "@/lib/canvas/undo-media";
import { CanvasReadOnlyContext } from "./CanvasReadOnlyContext";
import { fetchJsonOnce } from "@/lib/client/inflight-json";
import { isGptImage2OfficialProviderModel } from "@/lib/gpt-image-2-official";
import { isQwenImage21Model } from "@/lib/work-fisher-image-params";
import { isTuziGptImage2Model } from "@/lib/tuzi-image-params";
import { getVideoDisplaySpec } from "@/lib/video-resolution-visibility";
import {
  MINIMAX_SPEECH_DEFAULT_VOICE_ID,
  MINIMAX_SPEECH_DEFAULT_VOICE_NAME,
  MINIMAX_SPEECH_HD_MODEL_ID,
} from "@/lib/minimax-speech-models";

const CanvasMediaPreview = dynamic(() => import("@/components/canvas/CanvasMediaPreview"), { ssr: false });
const CanvasGenerationHistory = dynamic(() => import("@/components/canvas/CanvasGenerationHistory"), { ssr: false });
const CanvasShortcutPanel = dynamic(() => import("@/components/canvas/CanvasShortcutPanel"), { ssr: false });
const ImageEditorModal = dynamic(() => import("@/components/canvas/ImageEditorModal"), { ssr: false });
const PresetPromptsTrigger = dynamic(() => import("@/components/presets/preset-prompts").then((module) => module.PresetPromptsTrigger), { ssr: false });

type Props = {
  /** Observe saved content without editor sessions, mutations or task recovery. */
  readOnly?: boolean;
  arrangeActionRef?: React.MutableRefObject<((options: CanvasArrangeOptions) => void) | null>;
  onArrangementPreviewChange?: (active: boolean) => void;
  canvasId: number;
  editorSessionId: string;
  preferenceOwnerId: number | "guest";
  initial: CanvasDocumentV2;
  focusRequest?: { nodeId: string; requestId: number } | null;
  onLiveNodesChange?: (nodes: CanvasDocumentV2["nodes"]) => void;
  onChange?: (document: CanvasDocumentV2) => void;
  agentBridgeRef?: React.Ref<CreativeAgentBoardBridge | null>;
  onSelectionChange?: (selection: CreativeAgentSelection) => void;
  onViewportCommit?: (viewport: CanvasDocumentV2["viewport"]) => void;
  onUndoMediaRefsChange?: (
    heldRefs: CanvasUndoMediaRef[],
    currentRefs: CanvasUndoMediaRef[],
  ) => void;
  onBeforeServerRun: () => Promise<string>;
  onServerRunCommitted?: () => void | Promise<void>;
  onOpenWorkflow?: (selectedIds: string[]) => void;
  onCloseWorkflow?: () => void;
  workflowOpen?: boolean;
  workflowAnchorRef?: React.RefObject<HTMLButtonElement>;
  onToggleLibrary?: () => void;
  libraryOpen?: boolean;
};

type ContextMenuState = { x: number; y: number; position: { x: number; y: number }; nodeId?: string; source?: "dock" | "pane"; view?: "create" } | null;
type ConnectionMenuState = {
  x: number;
  y: number;
  zoom: number;
  position: { x: number; y: number };
  sourceIds: string[];
  sourceHandle?: string | null;
  from: Array<{ x: number; y: number }>;
  to: { x: number; y: number };
  fromPosition: Position;
} | null;
type CreatableNodeKind = "prompt" | "imageTask" | "videoTask" | "audioTask" | "llm" | "loop" | "compare";
type RunRecord = { id: number; status: string; graphRevision64: string; state: { scope?: string; nodeIds?: string[]; nodes?: Record<string, { status: string; error?: string }>; logs?: Array<{ at: string; nodeId?: string; message: string }> }; startedAt: string; finishedAt?: string | null };
type RunListPayload = { success?: boolean; items?: RunRecord[] };
const CANVAS_ACTIVE_RUN_STATUSES = new Set(["queued", "running", "cancel_requested", "submission_unknown"]);

const nodeTypes: NodeTypes = {
  image: CanvasDeferredNode,
  video: CanvasDeferredNode,
  audio: CanvasDeferredNode,
  prompt: CanvasDeferredNode,
  imageTask: CanvasDeferredNode,
  videoTask: CanvasDeferredNode,
  audioTask: CanvasDeferredNode,
  llm: CanvasDeferredNode,
  group: CanvasDeferredNode,
  loop: CanvasDeferredNode,
  compare: CanvasDeferredNode,
  breakdown: CanvasDeferredNode,
};

const CANVAS_IMAGE_EDIT_LABELS = {
  preview: "预览",
  crop: "裁剪",
  brush: "画笔",
  mask: "遮罩",
  outpaint: "扩图",
  grid: "宫格",
} as const;

const CANVAS_ALIGNMENT_GUIDE_THRESHOLD = 8;
const CANVAS_DEFAULT_NODE_WIDTH = 280;
const CANVAS_DEFAULT_NODE_HEIGHT = 180;

function canvasAlignmentRect(node: CanvasNode, offset = { x: 0, y: 0 }): CanvasAlignmentRect {
  return {
    id: node.id,
    x: node.position.x + offset.x,
    y: node.position.y + offset.y,
    width: node.width ?? CANVAS_DEFAULT_NODE_WIDTH,
    height: node.height ?? CANVAS_DEFAULT_NODE_HEIGHT,
  };
}

function canvasAlignmentBounds(nodes: readonly CanvasNode[], offset = { x: 0, y: 0 }): CanvasAlignmentRect | null {
  const rects = nodes.map((node) => canvasAlignmentRect(node, offset));
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { id: "selection", x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

type CanvasNodePositionChange = Extract<NodeChange<CanvasFlowNode>, { type: "position" }> & { position: { x: number; y: number } };

function isCanvasNodePositionChange(change: NodeChange<CanvasFlowNode>): change is CanvasNodePositionChange {
  return change.type === "position" && Boolean(change.position);
}

function sameCanvasAlignmentGuides(
  current: readonly CanvasAlignmentGuide[],
  next: readonly CanvasAlignmentGuide[],
) {
  return current.length === next.length
    && current.every((guide, index) => guide.axis === next[index]?.axis && guide.value === next[index]?.value && guide.start === next[index]?.start && guide.end === next[index]?.end && guide.movingAnchor === next[index]?.movingAnchor);
}

const CANVAS_EDGE_STROKE_WIDTH = 2;
const CANVAS_CONNECTION_DRAG_STROKE_WIDTH = 2;
const CANVAS_EDGE_CUT_HOVER_DELAY_MS = 1000;
export const CanvasConnectionDragContext = React.createContext(false);
const CANVAS_EDGE_CUT_LEAVE_DELAY_MS = 120;
const CANVAS_EDGE_CUT_EXIT_DURATION_MS = 150;

const CANVAS_MEDIA_BODY_TARGET_EDGE_OFFSET = 20;
const CANVAS_MULTI_SELECTION_FRAME_PADDING = 80;
const CANVAS_MULTI_SELECTION_CONNECTOR_ROOT_OVERLAP_PX = 2;
type CanvasVisualEdgeData = { targetInset: number; onDisconnect?: (edgeId: string) => void };

type CanvasMultiConnectionPoint = { id: string; x: number; y: number };
type CanvasMultiSelectionBounds = { x: number; y: number; width: number; height: number };
type CanvasMultiConnectionDrag = {
  sourceIds: string[];
  pointer: { x: number; y: number };
};

function sampleCanvasMarqueeEdges(root: HTMLElement | null) {
  return Array.from(root?.querySelectorAll<SVGPathElement>(".react-flow__edge [data-canvas-edge-cut-hit-area], .react-flow__edge [data-canvas-crossing-edge]") ?? []).map((path) => {
    const points = getCanvasEdgeSelectionPoints(path);
    return { id: path.closest(".react-flow__edge")?.getAttribute("data-id") ?? "", points };
  });
}

function CanvasConnectionLine({
  fromX,
  fromY,
  fromPosition,
  toX,
  toY,
  toPosition,
  toNode,
  toHandle,
  pointer,
  connectionStatus,
}: ConnectionLineComponentProps<CanvasFlowNode>) {
  const editor = React.useContext(CanvasNodeEditorContext);
  const viewportTransform = useStore((state) => state.transform);
  const pointerInFlow = canvasRendererPointToFlowPoint(pointer, viewportTransform);
  const previewTarget = resolveCanvasConnectionPreviewTarget(
    { x: toX, y: toY },
    pointerInFlow,
    toHandle?.id,
    toNode?.data.kind,
  );
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: previewTarget.x,
    targetY: previewTarget.y,
    targetPosition: toPosition,
  });
  const xyflowCandidateState = resolveCanvasConnectionCandidateState(
    connectionStatus === "valid" ? true : connectionStatus === "invalid" ? false : null,
    Boolean(toNode),
  );
  const candidateState = editor?.connectionFeedbackTarget?.state ?? xyflowCandidateState;
  const invalid = candidateState === "invalid";
  const [showInvalidLabel, setShowInvalidLabel] = React.useState(false);
  React.useEffect(() => {
    setShowInvalidLabel(false);
    if (!invalid) return;
    const timer = window.setTimeout(() => setShowInvalidLabel(true), 600);
    return () => window.clearTimeout(timer);
  }, [invalid, toNode?.id, editor?.connectionFeedbackTarget?.nodeId]);

  return (
    <>
      <CanvasConnectionPreviewPath edgeId="connection-preview" path={path} invalid={invalid} />
      {showInvalidLabel && <foreignObject x={previewTarget.x - 48 / viewportTransform[2]} y={previewTarget.y - 60 / viewportTransform[2]} width={96 / viewportTransform[2]} height={60 / viewportTransform[2]} pointerEvents="none" style={{ overflow: "visible" }}><div className="inline-flex h-8 items-center whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-4 text-[13px] text-[var(--app-fg)]" style={{ transform: `scale(${1 / viewportTransform[2]})`, transformOrigin: "top left" }}><UiText id="canvas.m3043cec89d4e" /></div></foreignObject>}
    </>
  );
}

export function CanvasConnectionMenuPreview({ menu }: { menu: NonNullable<ConnectionMenuState> }) {
  return (
    <svg
      data-canvas-connection-menu-line
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[164] h-full w-full overflow-visible"
    >
      {menu.from.map((from) => {
        const [path] = getBezierPath({
          sourceX: from.x,
          sourceY: from.y,
          sourcePosition: menu.fromPosition,
          targetX: menu.to.x,
          targetY: menu.to.y,
          targetPosition: menu.fromPosition === Position.Left ? Position.Right : Position.Left,
        });
        return (
          <g key={`${from.x}:${from.y}`} style={{ "--canvas-edge-unit": `${Math.min(menu.zoom, 1)}px` } as React.CSSProperties}>
          <path
            d={path}
            fill="none"
            className="canvas-connection-preview-base"
            stroke="var(--canvas-edge-related)"
            strokeWidth={CANVAS_EDGE_STROKE_WIDTH * Math.min(menu.zoom, 1)}
            strokeLinecap="round"
            style={{ strokeWidth: CANVAS_EDGE_STROKE_WIDTH * Math.min(menu.zoom, 1) }}
          />
          <CanvasEdgeFlowSegments edgeId={`connection-menu-${from.x}-${from.y}`} path={path} />
          </g>
        );
      })}
    </svg>
  );
}

function CanvasAlignmentGuides({ guides }: { guides: CanvasAlignmentGuide[] }) {
  const transform = useStore((state) => state.transform);
  if (!guides.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[90] overflow-hidden" aria-hidden="true">
      {guides.map((guide) => guide.axis === "x" ? (
        <span key={`x:${guide.value}`} className="canvas-alignment-guide absolute bottom-0 top-0 w-px" style={{ left: transform[0] + guide.value * transform[2] }} />
      ) : (
        <span key={`y:${guide.value}`} className="canvas-alignment-guide canvas-alignment-guide-horizontal absolute left-0 right-0 h-px" style={{ top: transform[1] + guide.value * transform[2] }} />
      ))}
    </div>
  );
}

function closestCanvasEdgePoint(path: SVGPathElement, clientX: number, clientY: number) {
  const svg = path.ownerSVGElement;
  const matrix = path.getScreenCTM();
  if (!svg || !matrix) return null;
  const cursor = svg.createSVGPoint();
  cursor.x = clientX;
  cursor.y = clientY;
  const point = cursor.matrixTransform(matrix.inverse());
  return getCanvasEdgePointLookup(path)(point);
}

export function CanvasEdgeFlowSegments({ edgeId, path }: { edgeId: string; path: string }) {
  const interacting = useCanvasInteracting();
  const groupRef = React.useRef<SVGGElement>(null);
  React.useLayoutEffect(() => {
    if (groupRef.current) return registerCanvasEdgeFlow(groupRef.current);
  }, [interacting, path, edgeId]);
  if (interacting || !path) return null;
  return (
    <g ref={groupRef} className="canvas-edge-related-flow canvas-edge-flow-travel" data-edge-flow={edgeId} fill="none" stroke="var(--canvas-edge-flow)" opacity={0.65} pointerEvents="none">
      {/* Adjacent tail/head segments avoid stacking eight bright, repainting strokes. */}
      <path d={path} pathLength={300} strokeDasharray="36 64" style={{ strokeDasharray: "36 64", strokeWidth: "calc(8 * var(--canvas-edge-unit, 1px))" }} strokeWidth={8} strokeOpacity={0.12} strokeLinecap="round" stroke="var(--canvas-edge-flow-tail, var(--canvas-edge-flow))" />
      <path d={path} pathLength={300} strokeDasharray="24 76" style={{ strokeDasharray: "24 76", strokeWidth: "calc(2.5 * var(--canvas-edge-unit, 1px))" }} strokeWidth={2.5} strokeOpacity={0.35} strokeLinecap="butt" stroke="var(--canvas-edge-flow-tail, var(--canvas-edge-flow))" />
      <path d={path} pathLength={300} strokeDasharray="0 24 12 64" style={{ strokeDasharray: "0 24 12 64", strokeWidth: "calc(2.5 * var(--canvas-edge-unit, 1px))" }} strokeWidth={2.5} strokeOpacity={0.9} strokeLinecap="butt" />
    </g>
  );
}

export function CanvasConnectionPreviewPath({ edgeId, path, invalid, multiSelection = false }: {
  edgeId: string;
  path: string;
  invalid: boolean;
  multiSelection?: boolean;
}) {
  const stroke = invalid ? "var(--canvas-edge-preview)" : "var(--canvas-edge-related)";
  const zoom = useStore((state) => state.transform[2]);
  return (
    <g style={{ "--canvas-edge-unit": `${1 / Math.max(1, zoom)}px`, "--canvas-edge-stroke-width": CANVAS_CONNECTION_DRAG_STROKE_WIDTH } as React.CSSProperties}>
      <path className="canvas-connection-preview-base" data-canvas-multi-selection-preview-line={multiSelection || undefined} d={path} fill="none" stroke={stroke} strokeWidth={CANVAS_CONNECTION_DRAG_STROKE_WIDTH} strokeLinecap="round" pointerEvents="none" />
      {!invalid && <CanvasEdgeFlowSegments edgeId={edgeId} path={path} />}
    </g>
  );
}

function CanvasMultiSelectionPreviewLine({
  source,
  target,
}: {
  source: CanvasMultiConnectionPoint;
  target: { x: number; y: number };
}) {
  const editor = React.useContext(CanvasNodeEditorContext);
  const [path] = getBezierPath({
    sourceX: source.x,
    sourceY: source.y,
    sourcePosition: Position.Right,
    targetX: target.x,
    targetY: target.y,
    targetPosition: Position.Left,
  });

  return (
    <CanvasConnectionPreviewPath
      edgeId={`multi-selection-${source.id}`}
      path={path}
      invalid={editor?.connectionFeedbackTarget?.state === "invalid"}
      multiSelection
    />
  );
}

function CanvasMultiSelectionToolbar({ bounds, canGroup, canSaveToLibrary, canDownloadAll, onGroup, onStack, onSaveToLibrary, onDownloadAll, videoCount = 0, composing = false, onComposeVideos }: {
  bounds: CanvasMultiSelectionBounds;
  videoCount?: number;
  composing?: boolean;
  onComposeVideos?: () => void;
  canGroup: boolean;
  canSaveToLibrary: boolean;
  canDownloadAll: boolean;
  onGroup: () => void;
  onStack: () => void;
  onSaveToLibrary: () => void;
  onDownloadAll: () => void;
}) {
  const { text } = useUiLocale();
  const transform = useStore((state) => state.transform);
  return <UiProps ids={{"aria-label":["canvas.mf83fa2f23c2e"]}}><div
    role="toolbar" aria-label="canvas.mf83fa2f23c2e" data-canvas-multi-selection-toolbar
    className="canvas-material-toolbar nodrag nopan nowheel absolute pointer-events-auto"
    style={{ left: transform[0] + (bounds.x + bounds.width / 2) * transform[2], top: transform[1] + bounds.y * transform[2] - 16, transform: "translate(-50%, -100%)", zIndex: 50 }}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
  >
    <UiProps ids={{"aria-label":["canvas.m21f0b833fcc8"]}}><button type="button" aria-label="canvas.m21f0b833fcc8" disabled={!canGroup} onClick={onGroup} className="canvas-material-toolbar-item disabled:opacity-35">
      <Group className="h-4 w-4" /><UiText id="canvas.m21f0b833fcc8" /></button></UiProps>
    <UiProps ids={{"aria-label":["canvas.mbe8f84d4ac37"]}}><button type="button" aria-label="canvas.mbe8f84d4ac37" disabled={!canGroup} onClick={onStack} className="canvas-material-toolbar-item disabled:opacity-35">
      <Copy className="h-4 w-4" /><UiText id="canvas.mbe8f84d4ac37" /></button></UiProps>
    {/* 选中两段以上已完成的视频时：按从左到右的顺序合成一段 */}
    {videoCount >= 2 && onComposeVideos && <UiProps ids={{"title":["canvas.mc9422d8a14c2"]}}><button type="button" aria-label={text("workspaceFollowup.md36a61dec7c6", { v0: videoCount })} title="canvas.mc9422d8a14c2" disabled={composing} onClick={onComposeVideos} className="canvas-material-toolbar-item disabled:opacity-35">
      <Clapperboard className="h-4 w-4" />{composing ? <UiText id="canvas.m9a3207a2528c" /> : <UiText id="canvas.ma5651442f170" />}
    </button></UiProps>}
    <UiProps ids={{"aria-label":["canvas.mb45494687e39"]}}><button type="button" aria-label="canvas.mb45494687e39" disabled={!canSaveToLibrary} onClick={onSaveToLibrary} className="canvas-material-toolbar-item disabled:opacity-35">
      <FolderInput className="h-4 w-4" /><UiText id="canvas.mb45494687e39" /></button></UiProps>
    {/* Keep this as the final action when adding more multi-selection tools. */}
    <UiProps ids={{"aria-label":["canvas.m7891f1a432a1"]}}><button type="button" aria-label="canvas.m7891f1a432a1" disabled={!canDownloadAll} onClick={onDownloadAll} className="canvas-material-toolbar-item disabled:opacity-35">
      <Archive className="h-4 w-4" /><UiText id="canvas.m7891f1a432a1" /></button></UiProps>
  </div></UiProps>;
}

function CanvasMultiSelectionConnector({
  bounds,
  sources,
  drag,
  showConnector = true,
  showFrame = true,
  onPointerDown,
}: {
  bounds: CanvasMultiSelectionBounds;
  sources: CanvasMultiConnectionPoint[];
  drag: CanvasMultiConnectionDrag | null;
  showConnector?: boolean;
  showFrame?: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLSpanElement>) => void;
}) {
  const viewportTransform = useStore((state) => state.transform);
  const connector = drag?.pointer ?? {
    x: bounds.x + bounds.width,
    y: bounds.y + bounds.height / 2,
  };
  const connectorScreenX = viewportTransform[0] + connector.x * viewportTransform[2];
  const connectorScreenY = viewportTransform[1] + connector.y * viewportTransform[2];
  const frameScreenRight = viewportTransform[0] + (bounds.x + bounds.width) * viewportTransform[2];
  const surfaceRootX = drag
    ? connectorScreenX - CANVAS_CONNECTION_HANDLE_HIT_SIZE / 2
    : frameScreenRight - CANVAS_MULTI_SELECTION_CONNECTOR_ROOT_OVERLAP_PX;
  const grabSize = 12 / viewportTransform[2];
  const startFrameDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const flowRoot = event.currentTarget.closest(".react-flow");
    const target = flowRoot?.querySelector<HTMLElement>(".react-flow__nodesselection-rect, .react-flow__node.selected");
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    // Reuse React Flow's selection drag, including its history and cancellation.
    target.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, view: event.currentTarget.ownerDocument.defaultView, button: event.button, buttons: event.buttons,
      clientX: event.clientX, clientY: event.clientY, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey,
    }));
  };

  return (
    <>
      <ViewportPortal>
        {showFrame ? <div
          data-canvas-multi-selection-frame
          aria-hidden="true"
          className="canvas-multi-selection-frame pointer-events-none absolute"
          style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height, borderWidth: Math.max(0.75, viewportTransform[2]) / viewportTransform[2] }}
        >
          {([
            { left: -grabSize / 2, top: -grabSize / 2, width: bounds.width + grabSize, height: grabSize },
            { left: -grabSize / 2, bottom: -grabSize / 2, width: bounds.width + grabSize, height: grabSize },
            { left: -grabSize / 2, top: grabSize / 2, width: grabSize, height: Math.max(0, bounds.height - grabSize) },
            { right: -grabSize / 2, top: grabSize / 2, width: grabSize, height: Math.max(0, bounds.height - grabSize) },
          ] as React.CSSProperties[]).map((style, index) => <div
            key={index} data-canvas-selection-grab={index} className="absolute cursor-grab pointer-events-auto"
            style={style} onMouseDown={startFrameDrag}
          />)}
        </div> : null}
        {drag ? (
          <svg
            aria-hidden="true"
            className="canvas-multi-selection-preview pointer-events-none absolute overflow-visible"
            style={{ left: 0, top: 0, width: 1, height: 1 }}
          >
            {sources.map((source) => (
              <CanvasMultiSelectionPreviewLine key={source.id} source={source} target={connector} />
            ))}
          </svg>
        ) : null}
      </ViewportPortal>
      {showConnector ? (
        <UiProps ids={{"aria-label":["canvas.me0b33ef5a6e4"],"title":["canvas.me0b33ef5a6e4"]}}><div
          role="button"
          aria-label="canvas.me0b33ef5a6e4"
          title="canvas.me0b33ef5a6e4"
          data-canvas-multi-selection-connector
          className="canvas-multi-selection-connector nodrag nopan"
          style={{
            left: surfaceRootX,
            top: connectorScreenY,
          }}
        >
          <CanvasConnectionHandleSurface
            type="source"
            connectionInProgress={false}
            visualSize={24}
            plusSize={10}
            alwaysVisible
            onPointerDown={onPointerDown}
          />
        </div></UiProps>
      ) : null}
    </>
  );
}

export const CanvasDefaultEdge = React.memo(function CanvasDefaultEdge(props: EdgeProps) {
  const { source, target } = props;
  // Group/elevated edges keep their individual stacking order.
  const ordinaryLayer = useStore(React.useCallback(state => [source, target].every(id => {
    const node = state.nodeLookup.get(id);
    return node && !node.parentId && !(node.internals.z ?? 0);
  }), [source, target]));
  const interacting = useCanvasInteracting();
  const settledVisibility = React.useRef(false);
  const hasVisibleEndpoint = useStore(React.useCallback((state) => {
    // Keep existing edge content stable during the gesture. Newly entering edges
    // draw their base path immediately and mount hover/cut controls after settling.
    if (interacting) return settledVisibility.current;
    const [x, y, zoom] = state.transform;
    const view = { x: -x / zoom, y: -y / zoom, width: state.width / zoom, height: state.height / zoom };
    return [source, target].some((nodeId) => {
      const node = state.nodeLookup.get(nodeId);
      if (!node || node.hidden) return false;
      return node.dragging || doesCanvasMarqueeIntersectNode(view, {
        ...node.internals.positionAbsolute,
        width: node.measured.width ?? node.width ?? 0,
        height: node.measured.height ?? node.height ?? 0,
      });
    });
  }, [source, target, interacting]));
  settledVisibility.current = hasVisibleEndpoint;
  if (!hasVisibleEndpoint) {
    const visualData = props.data as CanvasVisualEdgeData | undefined;
    const [path] = getBezierPath({ ...props, targetX: props.targetX + (visualData?.targetInset ?? 0) });
    // Keep the same solid base when endpoints leave the screen. The wrapper can
    // still be "animated" for selected nodes; React Flow would otherwise apply
    // its moving dash pattern to this simplified path at the viewport boundary.
    return <CanvasSharedPassiveEdge id={props.id} source={source} target={target} selected={props.selected} enabled={ordinaryLayer && !props.animated}>
      <path data-canvas-edge-passive className="canvas-edge-related-base" d={path} fill="none" stroke="var(--canvas-edge)" strokeWidth={CANVAS_EDGE_STROKE_WIDTH} style={{ ...props.style, strokeDasharray: "none", animation: "none" }} markerEnd={props.markerEnd} pointerEvents="none" />
    </CanvasSharedPassiveEdge>;
  }
  return <CanvasInteractiveEdge {...props} />;
});

const CanvasInteractiveEdge = React.memo(function CanvasInteractiveEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
  animated,
  data,
}: EdgeProps) {
  const visualData = data as CanvasVisualEdgeData | undefined;
  const cutGeometry = getCanvasEdgeCutWorldGeometry();
  const hitPathRef = React.useRef<SVGPathElement>(null);
  const showCutTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideCutTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCutPointTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cutPoint, setCutPoint] = React.useState<{ x: number; y: number } | null>(null);
  const [cutVisible, setCutVisible] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  // Idle curves have no animation or open controls to pause. Keep their render
  // snapshot stable when a pan starts; CSS disables their hit targets together.
  const connectionDragInProgress = React.useContext(CanvasConnectionDragContext);
  const interacting = useCanvasInteracting(Boolean(animated || hovered || cutPoint || cutVisible)) || connectionDragInProgress;
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX: targetX + (visualData?.targetInset ?? 0),
    targetY,
    targetPosition,
  });
  // The board draws every travelling flow on one canvas and pauses it during gestures
  // itself; SVG flow is the standalone fallback.
  const sharedFlow = useCanvasEdgeFlowRegistration(id, path, Boolean(animated || hovered));

  const clearShowCutTimer = React.useCallback(() => {
    if (!showCutTimerRef.current) return;
    clearTimeout(showCutTimerRef.current);
    showCutTimerRef.current = null;
  }, []);
  const clearHideCutTimer = React.useCallback(() => {
    if (!hideCutTimerRef.current) return;
    clearTimeout(hideCutTimerRef.current);
    hideCutTimerRef.current = null;
  }, []);
  const clearCutPointTimer = React.useCallback(() => {
    if (!clearCutPointTimerRef.current) return;
    clearTimeout(clearCutPointTimerRef.current);
    clearCutPointTimerRef.current = null;
  }, []);
  const cutFrame = React.useRef(0);
  const cutPointer = React.useRef<{ x: number; y: number } | null>(null);
  const lastCutPointer = React.useRef<{ x: number; y: number; d: string | null } | null>(null);
  const cancelCutFrame = React.useCallback(() => {
    cancelAnimationFrame(cutFrame.current);
    cutFrame.current = 0;
    cutPointer.current = null;
    lastCutPointer.current = null;
  }, []);
  React.useEffect(() => () => cancelCutFrame(), [cancelCutFrame]);
  const updateCutPoint = React.useCallback((event: { clientX: number; clientY: number }) => {
    cutPointer.current = { x: event.clientX, y: event.clientY };
    if (cutFrame.current) return;
    cutFrame.current = requestAnimationFrame(() => {
      cutFrame.current = 0;
      const hitPath = hitPathRef.current;
      const point = cutPointer.current;
      if (!hitPath || !point) return;
      const d = hitPath.getAttribute("d");
      const last = lastCutPointer.current;
      if (last?.d === d && Math.hypot(point.x - last.x, point.y - last.y) < 2) return;
      lastCutPointer.current = { ...point, d };
      const next = closestCanvasEdgePoint(hitPath, point.x, point.y);
      if (next) setCutPoint(next);
    });
  }, []);
  React.useEffect(() => {
    const pointer = cutPointer.current;
    if (pointer && !interacting) updateCutPoint({ clientX: pointer.x, clientY: pointer.y });
  }, [path, interacting, updateCutPoint]);
  const scheduleCutHide = React.useCallback(() => {
    cancelCutFrame();
    clearShowCutTimer();
    clearHideCutTimer();
    clearCutPointTimer();
    hideCutTimerRef.current = setTimeout(() => {
      hideCutTimerRef.current = null;
      setCutVisible(false);
      if (cutVisible) {
        clearCutPointTimerRef.current = setTimeout(() => {
          clearCutPointTimerRef.current = null;
          setCutPoint(null);
        }, CANVAS_EDGE_CUT_EXIT_DURATION_MS);
      } else {
        setCutPoint(null);
      }
    }, CANVAS_EDGE_CUT_LEAVE_DELAY_MS);
  }, [cancelCutFrame, clearCutPointTimer, clearHideCutTimer, clearShowCutTimer, cutVisible]);
  const handleCutHitEnter = React.useCallback((event: React.PointerEvent<SVGPathElement>) => {
    if (interacting) return;
    clearHideCutTimer();
    clearCutPointTimer();
    updateCutPoint(event);
    if (cutVisible || showCutTimerRef.current) return;
    showCutTimerRef.current = setTimeout(() => {
      showCutTimerRef.current = null;
      setCutVisible(true);
    }, CANVAS_EDGE_CUT_HOVER_DELAY_MS);
  }, [interacting, clearCutPointTimer, clearHideCutTimer, cutVisible, updateCutPoint]);
  const stopCutButtonPointerDown = React.useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  }, []);

  React.useEffect(() => () => {
    clearShowCutTimer();
    clearHideCutTimer();
    clearCutPointTimer();
  }, [clearCutPointTimer, clearHideCutTimer, clearShowCutTimer]);

  React.useEffect(() => {
    if (!interacting) return;
    setHovered(false);
    cancelCutFrame();
    clearShowCutTimer();
    clearHideCutTimer();
    clearCutPointTimer();
    setCutVisible(false);
    setCutPoint(null);
  }, [interacting, cancelCutFrame, clearShowCutTimer, clearHideCutTimer, clearCutPointTimer]);

  return (
    <g
      data-canvas-edge-interactive
      className={hovered && !interacting ? "canvas-edge-hovered" : undefined}
      onPointerEnter={() => { if (!interacting) setHovered(true); }}
      onPointerLeave={() => setHovered(false)}
    >
      <BaseEdge
        key="base"
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={0}
        style={hovered && !interacting ? { ...style, stroke: "var(--canvas-edge-hover)" } : style}
        className="canvas-edge-related-base"
      />
      <path
        key="cut-hit"
        ref={hitPathRef}
        data-canvas-edge-cut-hit-area
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={cutGeometry.hitWidth}
        style={{ strokeDasharray: "none", animation: "none" }}
        pointerEvents={interacting ? "none" : "stroke"}
        onPointerEnter={handleCutHitEnter}
        onPointerMove={handleCutHitEnter}
        onPointerLeave={scheduleCutHide}
      />
      {(animated || hovered) && !interacting && !sharedFlow ? (
        <CanvasEdgeFlowSegments key="flow" edgeId={id} path={path} />
      ) : null}
      {cutPoint ? (
        <foreignObject
          key="cut-button"
          x={cutPoint.x - cutGeometry.buttonSize / 2}
          y={cutPoint.y - cutGeometry.buttonSize / 2}
          width={cutGeometry.buttonSize}
          height={cutGeometry.buttonSize}
          style={{
            opacity: cutVisible ? 1 : 0,
            pointerEvents: cutVisible ? "all" : "none",
            transform: cutVisible ? "scale(1)" : "scale(0.7)",
            transformBox: "fill-box",
            transformOrigin: "center",
            transitionDuration: cutVisible ? "200ms" : `${CANVAS_EDGE_CUT_EXIT_DURATION_MS}ms`,
          }}
          className="overflow-visible transition-[opacity,transform] ease-out"
        >
          <UiProps ids={{"aria-label":["canvas.mb5f2ebbb191a"],"title":["canvas.mb5f2ebbb191a"]}}><button
            type="button"
            data-canvas-edge-cut-button
            aria-label="canvas.mb5f2ebbb191a"
            title="canvas.mb5f2ebbb191a"
            onPointerEnter={() => {
              clearHideCutTimer();
              clearCutPointTimer();
            }}
            onPointerLeave={scheduleCutHide}
            onPointerDown={stopCutButtonPointerDown}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (interacting) return;
              clearShowCutTimer();
              clearHideCutTimer();
              clearCutPointTimer();
              setCutVisible(false);
              setCutPoint(null);
              visualData?.onDisconnect?.(id);
            }}
            className="nodrag nopan inline-flex h-full w-full items-center justify-center rounded-full border border-[rgba(255,255,255,0.1)] bg-[rgba(30,30,30,0.95)] text-[rgba(255,255,255,0.7)] shadow-[var(--canvas-shadow-dropdown)] transition-colors hover:text-white"
            style={{ borderWidth: cutGeometry.borderWidth, pointerEvents: cutVisible ? "auto" : "none" }}
          >
            <Scissors className="-rotate-[115deg]" style={{ width: cutGeometry.iconSize, height: cutGeometry.iconSize }} />
          </button></UiProps>
        </foreignObject>
      ) : null}
    </g>
  );
});

const EMPTY_CANVAS_EDGES: CanvasEdge[] = [];
const CANVAS_SELECT_PAN_BUTTONS = [1];
const CANVAS_HAND_PAN_BUTTONS = [0, 1];
const CANVAS_MULTI_SELECTION_KEYS = ["Control", "Meta", "Shift"];
const edgeTypes: EdgeTypes = {
  default: CanvasDefaultEdge,
};

let sequence = 0;
function id(prefix: string) {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function toFlowNode(node: CanvasNode, selected: boolean): CanvasFlowNode {
  const task = node.data.kind === "imageTask" || node.data.kind === "videoTask" || node.data.kind === "audioTask" || node.data.kind === "llm";
  return {
    ...node,
    ...getCanvasFlowGeometry(node),
    extent: node.parentId ? undefined : node.extent,
    zIndex: node.data.kind === "group" ? node.data.stacked ? 0 : -1001 : node.zIndex,
    selected,
    className: task ? "canvas-task-node-shell" : node.type === "group" ? "canvas-group-node-shell" : undefined,
  } as CanvasFlowNode;
}

function toCanvasNode(node: CanvasFlowNode): CanvasNode {
  return {
    id: node.id,
    type: node.data.kind,
    position: node.position,
    data: node.data,
    width: node.width,
    height: node.height,
    parentId: node.parentId,
    extent: node.extent === "parent" ? "parent" : undefined,
    zIndex: node.zIndex,
    hidden: node.hidden,
  };
}

const isMarkdownFile = (file: File) => /\.md$/i.test(file.name);
const isCanvasUploadFile = (file: File) => isMarkdownFile(file) || /^(image|video|audio)\//.test(file.type);

function emptyImageTask(): CanvasNodeData {
  return {
    kind: "imageTask",
    task: {
      references: [],
      settings: { model: "", prompt: "", aspectRatio: "auto", resolution: "2K", customSize: "1024x1024", quality: "", count: 1 },
      batches: [],
    },
  };
}

function defaultData(kind: CanvasNodeKind, preferences: CanvasTaskPreferences = {}): CanvasNodeData {
  if (kind === "compare") return { kind, beforeUrl: "", afterUrl: "", slider: 0.5 };
  if (kind === "prompt") return { kind, text: "" };
  if (kind === "imageTask") return applyCanvasTaskPreferences(emptyImageTask(), preferences);
  if (kind === "videoTask") return applyCanvasTaskPreferences({ kind, model: "", prompt: "", mediaPaths: [], inputMode: "multimodal", resolution: "480p", ratio: "adaptive", duration: -1, status: "idle" }, preferences);
  if (kind === "audioTask") return applyCanvasTaskPreferences({
    kind,
    model: preferences.audio?.lastModel || MINIMAX_SPEECH_HD_MODEL_ID,
    prompt: "",
    voiceId: MINIMAX_SPEECH_DEFAULT_VOICE_ID,
    voiceName: MINIMAX_SPEECH_DEFAULT_VOICE_NAME,
    speed: 1,
    pitch: 0,
    volume: 1,
    modifyPitch: 0,
    modifyIntensity: 0,
    modifyTimbre: 0,
    soundEffect: "",
    status: "idle",
  }, preferences);
  if (kind === "llm") return { kind, prompt: "", status: "idle" };
  if (kind === "loop") return { kind, items: [], mode: "serial", concurrency: 1, status: "idle" };
  throw new Error(`Node type ${kind} requires media input`);
}

function clientPoint(event: MouseEvent | TouchEvent) {
  if ("changedTouches" in event && event.changedTouches.length) {
    return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
  }
  return { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
}

function clampCanvasMenuPosition(x: number, y: number, width = 192, height = 320) {
  if (typeof window === "undefined") return { x, y };
  const margin = 12;
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
  };
}

function reflowTrackedDerivedBranch(
  nodes: CanvasNode[],
  rootSourceId: string,
  derivedSources: ReadonlyMap<string, string>,
) {
  let nextNodes = nodes;
  const sourcesToReflow = [rootSourceId];
  const visitedSources = new Set<string>();
  const affectedNodeIds = new Set<string>();

  while (sourcesToReflow.length) {
    const sourceId = sourcesToReflow.shift()!;
    if (visitedSources.has(sourceId)) continue;
    visitedSources.add(sourceId);
    const derivedNodeIds = nextNodes
      .filter((candidate) => derivedSources.get(candidate.id) === sourceId)
      .map((candidate) => candidate.id);
    if (!derivedNodeIds.length) continue;
    const branchNodeIds = [...derivedNodeIds];
    const branchIds = new Set(branchNodeIds);
    for (let index = 0; index < branchNodeIds.length; index += 1) {
      const branchSourceId = branchNodeIds[index];
      for (const candidate of nextNodes) {
        if (derivedSources.get(candidate.id) !== branchSourceId || branchIds.has(candidate.id)) continue;
        branchIds.add(candidate.id);
        branchNodeIds.push(candidate.id);
      }
    }
    const descendantNodeIds = branchNodeIds.filter((candidateId) => !derivedNodeIds.includes(candidateId));
    nextNodes = reflowDerivedNodePositions(nextNodes, sourceId, derivedNodeIds, descendantNodeIds);
    for (const derivedNodeId of derivedNodeIds) {
      affectedNodeIds.add(derivedNodeId);
      sourcesToReflow.push(derivedNodeId);
    }
  }

  return { nodes: nextNodes, nodeIds: [...affectedNodeIds] };
}

type CanvasDragCopy = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedIds: string[];
  idMap: Map<string, string>;
};

function Inner({ readOnly = false, arrangeActionRef, onArrangementPreviewChange, canvasId, editorSessionId, preferenceOwnerId, initial, focusRequest, onLiveNodesChange, onChange, agentBridgeRef, onSelectionChange: onAgentSelectionChange, onViewportCommit, onUndoMediaRefsChange, onBeforeServerRun, onServerRunCommitted, onOpenWorkflow, onCloseWorkflow, workflowOpen = false, workflowAnchorRef, onToggleLibrary, libraryOpen = false }: Props) {
  const { text, label: uiLabel, error: uiError } = useUiLocale();
  const flow = useReactFlow<CanvasFlowNode, CanvasEdge>();
  const flowStore = useStoreApi<CanvasFlowNode, CanvasEdge>();
  const xyflowConnectionInProgress = useStore((state) => Boolean(state.connection?.inProgress));
  const models = useCanvasModels();
  const normalizedInitial = React.useMemo(() => {
    const normalized = compactCanvasMediaNodeSizes(normalizeCanvasMediaOrigins(normalizeCanvasTaskNodeSizes(mergeCanvasImageResultNodes(collapseLegacyVideoResultDuplicates(initial)))));
    return { ...normalized, nodes: fitCanvasGroupBounds(normalized.nodes, undefined, true) };
  }, [initial]);
  const [initialTaskPreferences] = React.useState(() => typeof window === "undefined" ? {} : readCanvasTaskPreferences(window.localStorage, preferenceOwnerId));
  const taskPreferencesRef = React.useRef<CanvasTaskPreferences>(initialTaskPreferences);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const shortcutButtonRef = React.useRef<HTMLButtonElement>(null);
  const toolButtonRef = React.useRef<HTMLButtonElement>(null);
  const [toolMode, setToolMode] = React.useState<CanvasToolMode>("move");
  const [spacePanHeld, setSpacePanHeld] = React.useState(false);
  const [mousePanActive, setMousePanActive] = React.useState(false);
  // A pan keeps ownership of this pointer cycle even if Space is released first.
  const handToolActive = toolMode === "hand" || spacePanHeld || mousePanActive;
  React.useLayoutEffect(() => {
    if (!handToolActive) return;
    // Disable hit/focus targets at the layer boundary. Changing draggable and
    // focusable on every node used to tear down drag listeners and rewrite
    // hundreds of edge wrappers before the first pan frame could be painted.
    const layers = Array.from(wrapRef.current?.querySelectorAll<HTMLElement>(
      ".react-flow__nodes, .react-flow__edges, .react-flow__nodesselection",
    ) ?? []).filter(layer => !layer.hasAttribute("inert"));
    layers.forEach(layer => layer.setAttribute("inert", ""));
    return () => { layers.forEach(layer => layer.removeAttribute("inert")); };
  }, [handToolActive]);
  const pointerPositionRef = React.useRef<{ x: number; y: number } | null>(null);
  const pointerOverCanvasRef = React.useRef(false);
  // 空格平移：鼠标最后一次在画布上移动的时间、最后一次在画布外输入框打字的时间
  const canvasPointerMovedAtRef = React.useRef(0);
  const outsideTypingAtRef = React.useRef(0);
  const mediaInputRef = React.useRef<HTMLInputElement>(null);
  const mediaUploadPositionRef = React.useRef<{ x: number; y: number } | null>(null);
  React.useEffect(() => {
    const input = mediaInputRef.current;
    const onCancel = () => { mediaUploadPositionRef.current = null; };
    input?.addEventListener("cancel", onCancel);
    return () => input?.removeEventListener("cancel", onCancel);
  }, []);
  const migrateLegacyViewportRef = React.useRef(
    initial.nodes.length > 0
      && initial.viewport.zoom === 1
      && initial.viewport.x === 0
      && initial.viewport.y === 0,
  );
  const historyRef = React.useRef<CanvasHistory>(createCanvasHistory(normalizedInitial));
  const [document, setDocument] = React.useState(normalizedInitial);
  const [renderNodes, setRenderNodes] = React.useState<CanvasFlowNode[]>(
    () => orderCanvasParentsFirst(normalizedInitial.nodes).map((node) => toFlowNode(node, false)),
  );
  const [dragCopyPreview, setDragCopyPreview] = React.useState<CanvasDragCopy | null>(null);
  const documentRef = React.useRef(document);
  const pendingDocumentRef = React.useRef(document);
  const remoteAppliedDocumentRef = React.useRef<CanvasDocumentV2 | null>(null);
  const onChangeRef = React.useRef(onChange);
  const onUndoMediaRefsChangeRef = React.useRef(onUndoMediaRefsChange);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  // Relationship flow is an explicit click preview, independent of selection.
  const [edgeGlowNodeId, setEdgeGlowNodeId] = React.useState<string | null>(null);
  const [edgeFlowRegistry] = React.useState(createCanvasEdgeFlowRegistry);
  const suppressEdgeGlowClick = React.useRef(false);
  const stopEdgeGlow = React.useCallback(() => {
    suppressEdgeGlowClick.current = true;
    setEdgeGlowNodeId(null);
  }, []);
  React.useEffect(() => {
    if (edgeGlowNodeId && !selectedIds.includes(edgeGlowNodeId)) setEdgeGlowNodeId(null);
  }, [edgeGlowNodeId, selectedIds]);
  const [selectedEdgeIds, setSelectedEdgeIds] = React.useState<string[]>([]);
  // 多图节点里单独聚焦的一张：画布上点选某一格，或从 Agent 对话点图定位；节点不再选中时自动清除
  const [focusedOutput, setFocusedOutput] = React.useState<{ nodeId: string; outputId: string; pulse: number } | null>(null);
  const focusOutput = React.useCallback((nodeId: string, outputId: string) => setFocusedOutput(current => current?.nodeId === nodeId && current.outputId === outputId ? current : { nodeId, outputId, pulse: Date.now() }), []);
  React.useEffect(() => {
    if (focusedOutput && !selectedIds.includes(focusedOutput.nodeId)) setFocusedOutput(null);
  }, [focusedOutput, selectedIds]);
  const agentSelectionIdsRef = React.useRef({ nodeIds: selectedIds, edgeIds: selectedEdgeIds, focusedOutput });
  agentSelectionIdsRef.current = { nodeIds: selectedIds, edgeIds: selectedEdgeIds, focusedOutput };
  React.useEffect(() => {
    onAgentSelectionChange?.(getCreativeAgentSelection(canvasId, omitPendingCanvasUploads(document, new Set(pendingUploadUrlsRef.current.keys())), selectedIds, selectedEdgeIds, false, focusedOutput));
  }, [canvasId, document, selectedIds, selectedEdgeIds, focusedOutput, onAgentSelectionChange]);
  const [selectionInProgress, setSelectionInProgress] = React.useState(false);
  const [viewportInteracting, setViewportInteracting] = React.useState(false);
  const focusAnimation = React.useRef<ReturnType<typeof animateCanvasFocus> | null>(null);
  const [videoFocusRequest, setVideoFocusRequest] = React.useState<CanvasVideoFocusRequest | null>(null);
  const videoFocusRevision = React.useRef(0);
  const consumeVideoFocusRequest = React.useCallback((revision: number) => {
    setVideoFocusRequest(current => current?.revision === revision ? null : current);
  }, []);
  React.useEffect(() => {
    if (videoFocusRequest && (selectedIds.length !== 1 || selectedIds[0] !== videoFocusRequest.nodeId)) setVideoFocusRequest(null);
  }, [selectedIds, videoFocusRequest]);
  React.useEffect(() => () => focusAnimation.current?.dispose(), []);
  const panReleaseGuard = React.useRef<ReturnType<typeof bindCanvasPanReleaseGuard> | null>(null);
  const viewportGestureStartedAt = React.useRef(0);
  const wheelEndTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearWheelEndTimer = React.useCallback(() => {
    if (wheelEndTimer.current !== null) clearTimeout(wheelEndTimer.current);
    wheelEndTimer.current = null;
  }, []);
  React.useEffect(() => clearWheelEndTimer, [clearWheelEndTimer]);
  React.useEffect(() => {
    const guard = bindCanvasPanReleaseGuard(() => {
      setMousePanActive(false);
      setViewportInteracting(false);
    });
    panReleaseGuard.current = guard;
    return () => { guard.dispose(); panReleaseGuard.current = null; };
  }, []);
  const [nodeGestureActive, setNodeGestureActive] = React.useState(false);
  const [taskPanelsSuppressedByMarquee, setTaskPanelsSuppressedByMarquee] = React.useState(false);
  const [openTaskPanelNodeId, setOpenTaskPanelNodeId] = React.useState<string | null>(null);
  const [alignmentGuides, setAlignmentGuides] = React.useState<CanvasAlignmentGuide[]>([]);
  const edgesPreferenceKey = `canvas_edges_hidden_v2_${preferenceOwnerId}_${canvasId}`;
  const [edgesHidden, setEdgesHidden] = React.useState(() => {
    try {
      const saved = window.localStorage.getItem(edgesPreferenceKey);
      return (saved ?? window.localStorage.getItem(`canvas_edges_hidden_v1_${preferenceOwnerId}`)) === "true";
    } catch { return false; }
  });
  // Snapshot the legacy user-wide setting once per canvas, including before any toggle.
  // Reconciliation can remount the editor; another canvas must not change this preference.
  React.useEffect(() => {
    try { window.localStorage.setItem(edgesPreferenceKey, String(edgesHidden)); } catch { /* Keep the current session usable without storage. */ }
  }, [edgesPreferenceKey, edgesHidden]);
  // Interaction preference, not a collaborative document edit: it lives with the viewer.
  const snapPreferenceKey = `canvas_snap_to_grid_v1_${preferenceOwnerId}`;
  const [snapToGrid, setSnapToGrid] = React.useState(() => {
    try { return window.localStorage.getItem(snapPreferenceKey) !== "false"; } catch { return true; }
  });
  const toggleSnapToGrid = React.useCallback(() => {
    const next = !snapToGrid;
    setSnapToGrid(next);
    try { window.localStorage.setItem(snapPreferenceKey, String(next)); } catch { /* Keep the current session usable without storage. */ }
  }, [snapPreferenceKey, snapToGrid]);
  const toggleEdges = React.useCallback(() => {
    const next = !edgesHidden;
    setEdgesHidden(next);
    try { window.localStorage.setItem(edgesPreferenceKey, String(next)); } catch { /* Keep the current session usable without storage. */ }
    setSelectedEdgeIds((selected) => selected.length ? [] : selected);
  }, [edgesHidden, edgesPreferenceKey]);
  const pendingAlignmentGuidesRef = React.useRef<CanvasAlignmentGuide[]>([]);
  const alignmentGuideFrameRef = React.useRef<number | null>(null);
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState>(null);
  const [connectionMenu, setConnectionMenu] = React.useState<ConnectionMenuState>(null);
  const [connectionFeedbackTarget, setConnectionFeedbackTarget] = React.useState<CanvasConnectionFeedbackTarget>(null);
  const [multiConnectionDrag, setMultiConnectionDrag] = React.useState<CanvasMultiConnectionDrag | null>(null);
  const multiConnectionInProgress = multiConnectionDrag !== null;
  const connectionDragInProgress = xyflowConnectionInProgress || multiConnectionInProgress;
  const multiConnectionCleanupRef = React.useRef<(() => void) | null>(null);
  const connectionFeedbackTargetRef = React.useRef<CanvasConnectionFeedbackTarget>(null);
  const connectionQueryFrame = React.useRef(0);
  const updateConnectionFeedbackTarget = React.useCallback((next: CanvasConnectionFeedbackTarget) => {
    if (!next) {
      cancelAnimationFrame(connectionQueryFrame.current);
      connectionQueryFrame.current = 0;
    }
    const previous = connectionFeedbackTargetRef.current;
    if (previous?.nodeId !== next?.nodeId || previous?.state !== next?.state) {
      const previousTarget = wrapRef.current?.querySelector<HTMLElement>(`[data-canvas-connection-target-id="${previous?.nodeId}"]`);
      if (previousTarget) resetCanvasConnectionTargetTilts(previousTarget);
    }
    connectionFeedbackTargetRef.current = next;
    setConnectionFeedbackTarget((current) => (
      current?.nodeId === next?.nodeId && current?.state === next?.state ? current : next
    ));
  }, []);
  const [templateNodeId, setTemplateNodeId] = React.useState<string | null>(null);
  const [imageEditor, setImageEditor] = React.useState<{ nodeId: string; url: string; mode?: "preview" | "crop" | "brush" | "mask" | "outpaint" | "grid" } | null>(null);
  const [preview, setPreview] = React.useState<{ items: CanvasPreviewItem[]; index: number } | null>(null);
  const [librarySaveItems, setLibrarySaveItems] = React.useState<CanvasPreviewItem[]>([]);
  const [replacementTarget, setReplacementTarget] = React.useState<{ id: string; kind: "image" | "video" | "audio"; outputId?: string } | null>(null);
  const [generationHistoryOpen, setGenerationHistoryOpen] = React.useState(false);
  const [generationHistoryMounted, setGenerationHistoryMounted] = React.useState(false);
  const canvasInteractionLocked = imageEditor !== null || preview !== null || generationHistoryOpen;
  const [, setRuns] = React.useState<RunRecord[]>([]);
  const [utilityPanel, setUtilityPanel] = React.useState<"shortcuts" | "tools" | null>(null);
  const [videoSeparationJobs, setVideoSeparationJobs] = React.useState<Record<string, CanvasVideoSeparationJob>>({});
  const videoSeparationLocks = React.useRef(new Set<string>());
  const [actionMessage, setActionMessage] = React.useState("");
  React.useEffect(() => {
    const surface = wrapRef.current;
    if (!surface) return;
    const modifier = (event: KeyboardEvent | PointerEvent) => {
      surface.dataset.canvasGroupAccess = event.ctrlKey || event.metaKey ? "true" : "false";
    };
    const reset = () => { surface.dataset.canvasGroupAccess = "false"; };
    const preventPageZoom = (event: WheelEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-canvas-title-bar], [data-canvas-viewport-controls], [data-canvas-bottom-dock]")) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!surface.contains(target)) return;
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const renderer = target.closest<HTMLElement>(".react-flow__renderer");
      if (!renderer) return;
      // Own modified wheel zoom before the engine's Mac pinch multiplier.
      // Plain wheels still pan the canvas or scroll node text normally.
      event.stopPropagation();
      if (canvasInteractionLocked || !flow.viewportInitialized || flowStore.getState().userSelectionActive) return;
      if (target.closest(".nowheel") && !target.closest("[data-canvas-text-output-scroll], .canvas-text-node-content")) return;
      const viewport = getCanvasWheelZoomViewport(flow.getViewport(), event, renderer.getBoundingClientRect());
      // No queued tween: each input uses the latest camera, anchored at the pointer.
      // setViewport retains the engine's move/end callbacks and personal-view save.
      if (viewport) void flow.setViewport(viewport, { duration: 0 });
    };
    window.addEventListener("keydown", modifier, true);
    window.addEventListener("keyup", modifier, true);
    window.addEventListener("blur", reset);
    surface.addEventListener("pointermove", modifier, true);
    window.document.addEventListener("wheel", preventPageZoom, { passive: false, capture: true });
    return () => {
      window.removeEventListener("keydown", modifier, true);
      window.removeEventListener("keyup", modifier, true);
      window.removeEventListener("blur", reset);
      surface.removeEventListener("pointermove", modifier, true);
      window.document.removeEventListener("wheel", preventPageZoom, true);
    };
  }, [canvasInteractionLocked, flow, flowStore]);
  React.useEffect(() => {
    if (!actionMessage) return;
    const timer = window.setTimeout(() => setActionMessage(""), 3000);
    return () => window.clearTimeout(timer);
  }, [actionMessage]);
  const [uploadNotice, setUploadNotice] = React.useState<{ message: string } | null>(null);
  React.useEffect(() => {
    if (!uploadNotice) return;
    const timer = window.setTimeout(() => setUploadNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [uploadNotice]);
  const [arrangementPreview, setArrangementPreview] = React.useState<{ previous: CanvasDocumentV2 } | null>(null);
  const arrangementPreviewRef = React.useRef<{ previous: CanvasDocumentV2 } | null>(null);
  const dragStart = React.useRef<{
    document: CanvasDocumentV2;
    ids: string[];
    nodeId: string;
    nodesById: Map<string, CanvasNode>;
    movingIds: Set<string>;
    groups: ReturnType<typeof createCanvasGroupDragGeometry>;
    alignment: ReturnType<typeof createCanvasDragAlignment>;
    copy?: CanvasDragCopy;
    taskPanelWasOpen: boolean;
  } | null>(null);
  const groupDropElements = React.useRef(new Map<string, HTMLElement>());
  const groupDropIds = React.useRef(new Set<string>());
  const clearGroupDropTargets = React.useCallback(() => {
    for (const id of groupDropIds.current) {
      const element = groupDropElements.current.get(id);
      if (element) delete element.dataset.canvasGroupDrop;
    }
    groupDropIds.current.clear();
  }, []);
  const cancelledCopyDragIds = React.useRef(new Set<string>());
  const connectingNodeRef = React.useRef<string | null>(null);
  const marqueeSelectionRef = React.useRef<{
    previousNodeIds: string[];
    previousEdgeIds: string[];
    insideNodeIds: Set<string>;
    mode: CanvasMarqueeSelectionMode;
    search: ReturnType<typeof createMarqueeIndex>;
    latestRect: MarqueeRect | null;
    start: { x: number; y: number } | null;
    edgeSamples: { id: string; points: { x: number; y: number }[] }[];
  } | null>(null);
  const marqueeFrameRef = React.useRef<ReturnType<typeof createMarqueeFrame<MarqueeRect>> | null>(null);
  const marqueeCancelledRef = React.useRef(false);
  const suppressPaneClickRef = React.useRef(false);
  const clipboard = React.useRef<{ document: CanvasDocumentV2; ids: string[] } | null>(null);
  const changeTimer = React.useRef<number | undefined>(undefined);
  const dataEditTimer = React.useRef<number | undefined>(undefined);
  const coalescedDataEditRef = React.useRef<{ nodeId: string; expiresAt: number } | null>(null);
  const pendingUploadUrlsRef = React.useRef(new Map<string, string>());
  const derivedSourceByNodeIdRef = React.useRef(new Map<string, string>());
  const flowNodeCacheRef = React.useRef(new Map<string, { source: CanvasNode; selected: boolean; flow: CanvasFlowNode }>());
  const activeGenerations = React.useRef(new Set<string>());
  const cancelledNodeIdsRef = React.useRef(new Set<string>());
  const llmAbortControllersRef = React.useRef(new Map<string, AbortController>());
  const audioAbortControllersRef = React.useRef(new Map<string, AbortController>());
  const cancelRequested = React.useRef(false);
  const activeServerRuns = React.useRef(new Map<number, string[]>());
  const pollingServerRuns = React.useRef(new Set<number>());
  const pollServerRunRef = React.useRef<(runId: number) => Promise<void>>(async () => undefined);
  const observerSnapshotRef = React.useRef(normalizedInitial);

  React.useEffect(() => { documentRef.current = document; }, [document]);
  React.useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  React.useEffect(() => {
    if (!readOnly || observerSnapshotRef.current === normalizedInitial) return;
    observerSnapshotRef.current = normalizedInitial;
    // Refresh content without moving the administrator's camera or publishing it.
    const next = { ...normalizedInitial, viewport: flow.getViewport() };
    documentRef.current = next;
    pendingDocumentRef.current = next;
    setDocument(next);
    setSelectedIds(ids => ids.filter(id => next.nodes.some(node => node.id === id)));
  }, [readOnly, normalizedInitial, flow]);
  React.useEffect(() => { onUndoMediaRefsChangeRef.current = onUndoMediaRefsChange; }, [onUndoMediaRefsChange]);
  React.useEffect(() => () => multiConnectionCleanupRef.current?.(), []);

  const commitViewport = React.useCallback((viewport: CanvasDocumentV2["viewport"]) => {
    const current = documentRef.current;
    if (
      current.viewport.x === viewport.x
      && current.viewport.y === viewport.y
      && current.viewport.zoom === viewport.zoom
    ) return;
    const next = { ...current, viewport };
    documentRef.current = next;
    pendingDocumentRef.current = next;
    setDocument(next);
    onViewportCommit?.(viewport);
  }, [onViewportCommit]);

  const commitViewportAfter = React.useCallback((operation: Promise<unknown>) => {
    void operation.then(() => commitViewport(flow.getViewport()));
  }, [commitViewport, flow]);

  const revealDerivedNodes = React.useCallback((sourceId: string, nodeIds: string[]) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const targetIds = [...new Set([sourceId, ...nodeIds])];
        const targetNodes = targetIds
          .map((nodeId) => flow.getNode(nodeId))
          .filter((node): node is CanvasFlowNode => Boolean(node));
        const canvasBounds = wrapRef.current?.getBoundingClientRect();
        if (!canvasBounds || targetNodes.length !== targetIds.length) return;

        const targetBounds = flow.getNodesBounds(targetNodes);
        const topLeft = flow.flowToScreenPosition({ x: targetBounds.x, y: targetBounds.y });
        const bottomRight = flow.flowToScreenPosition({
          x: targetBounds.x + targetBounds.width,
          y: targetBounds.y + targetBounds.height,
        });
        const margin = 24;
        const fullyVisible = (
          topLeft.x >= canvasBounds.left + margin
          && topLeft.y >= canvasBounds.top + margin
          && bottomRight.x <= canvasBounds.right - margin
          && bottomRight.y <= canvasBounds.bottom - margin
        );
        if (fullyVisible) return;

        const currentZoom = flow.getViewport().zoom;
        commitViewportAfter(flow.fitView({
          nodes: targetNodes,
          padding: 0.18,
          duration: 260,
          maxZoom: currentZoom,
        }));
      });
    });
  }, [commitViewportAfter, flow]);

  React.useEffect(() => {
    if (!focusRequest || !documentRef.current.nodes.some((node) => node.id === focusRequest.nodeId)) return;
    const target = flow.getNode(focusRequest.nodeId);
    if (!target) return;
    setSelectedIds([focusRequest.nodeId]);
    setSelectedEdgeIds([]);
    setContextMenu(null);
    setConnectionMenu(null);
    commitViewportAfter(flow.fitView({ nodes: [target], padding: 0.24, duration: 260, maxZoom: 1.5 }));
  }, [commitViewportAfter, flow, focusRequest]);

  React.useEffect(() => {
    const currentEdgeIds = new Set(document.edges.map((edge) => edge.id));
    setSelectedEdgeIds((current) => current.filter((edgeId) => currentEdgeIds.has(edgeId)));
  }, [document.edges]);

  React.useEffect(() => {
    if (!openTaskPanelNodeId) return;
    if (selectedIds.length === 1 && selectedIds[0] === openTaskPanelNodeId) return;
    setOpenTaskPanelNodeId(null);
  }, [openTaskPanelNodeId, selectedIds]);

  const refreshRuns = React.useCallback(async () => {
    if (readOnly) return;
    const { ok, json: payload } = await fetchJsonOnce<RunListPayload>(`/api/canvas/${canvasId}/runs`);
    if (!ok || !payload?.success) return;
    const items = Array.isArray(payload.items) ? payload.items as RunRecord[] : [];
    setRuns(items);
    for (const run of items) {
      if (!CANVAS_ACTIVE_RUN_STATUSES.has(run.status)) {
        activeServerRuns.current.delete(run.id);
        continue;
      }
      activeServerRuns.current.set(run.id, run.state?.nodeIds || []);
      if (!pollingServerRuns.current.has(run.id)) void pollServerRunRef.current(run.id);
    }
  }, [readOnly, canvasId]);

  React.useEffect(() => { void refreshRuns(); }, [refreshRuns]);
  React.useEffect(() => () => { activeServerRuns.current.clear(); }, []);

  React.useEffect(() => {
    if (readOnly) return;
    if (Math.random() >= 0.01) return;
    let stopped = false;
    let frame = 0;
    let previousFrame = performance.now();
    const frameDurations: number[] = [];
    const longTasks: number[] = [];
    const sampleFrame = (now: number) => {
      if (stopped) return;
      frameDurations.push(Math.max(0, now - previousFrame));
      if (frameDurations.length > 300) frameDurations.shift();
      previousFrame = now;
      frame = window.requestAnimationFrame(sampleFrame);
    };
    frame = window.requestAnimationFrame(sampleFrame);
    const observer = typeof PerformanceObserver !== "undefined"
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        })
      : null;
    try { observer?.observe({ entryTypes: ["longtask"] }); } catch { observer?.disconnect(); }
    const interval = window.setInterval(() => {
      if (!frameDurations.length) return;
      const sorted = [...frameDurations].sort((left, right) => left - right);
      const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
      const tasks = longTasks.splice(0);
      void fetch("/api/canvas/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          observations: [
            { name: "canvas_client_frame_duration_ms", value: p95 },
            { name: "canvas_client_dom_nodes", value: window.document.querySelectorAll(".react-flow__node").length },
            { name: "canvas_client_active_decoders", value: window.document.querySelectorAll("video[src],audio[src]").length },
            ...tasks.slice(0, 10).map((value) => ({ name: "canvas_client_long_task_duration_ms", value })),
          ],
          increments: tasks.length ? [{ name: "canvas_client_long_task_total", value: tasks.length }] : [],
        }),
      }).catch(() => undefined);
    }, 15_000);
    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      observer?.disconnect();
    };
  }, [readOnly]);

  const publishPendingDocument = React.useCallback(() => {
    if (readOnly) return;
    onLiveNodesChange?.(pendingDocumentRef.current.nodes);
    onChangeRef.current?.(omitPendingCanvasUploads(
      pendingDocumentRef.current,
      new Set(pendingUploadUrlsRef.current.keys()),
    ));
  }, [readOnly, onLiveNodesChange]);

  const flushBeforeServerRun = React.useCallback(async () => {
    if (readOnly) throw new Error("管理员查看模式不能运行任务");
    window.clearTimeout(changeTimer.current);
    changeTimer.current = undefined;
    pendingDocumentRef.current = documentRef.current;
    publishPendingDocument();
    return await onBeforeServerRun();
  }, [readOnly, onBeforeServerRun, publishPendingDocument]);

  React.useEffect(() => {
    if (readOnly) return;
    pendingDocumentRef.current = document;
    if (document === remoteAppliedDocumentRef.current) return;
    if (arrangementPreviewRef.current) return;
    if (changeTimer.current !== undefined) return;
    changeTimer.current = window.setTimeout(() => {
      changeTimer.current = undefined;
      publishPendingDocument();
    }, 250);
  }, [readOnly, document, publishPendingDocument]);

  React.useEffect(() => {
    if (readOnly) return;
    const flushPendingChangeNow = () => {
      if (changeTimer.current === undefined) return false;
      window.clearTimeout(changeTimer.current);
      changeTimer.current = undefined;
      publishPendingDocument();
      return true;
    };
    const flushPendingChange = (event: BeforeUnloadEvent) => {
      if (!flushPendingChangeNow()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const flushPendingChangeOnLeave = () => { flushPendingChangeNow(); };
    const flushPendingChangeWhenHidden = () => {
      if (globalThis.document.visibilityState === "hidden") flushPendingChangeNow();
    };
    window.addEventListener("beforeunload", flushPendingChange);
    window.addEventListener("pagehide", flushPendingChangeOnLeave);
    globalThis.document.addEventListener("visibilitychange", flushPendingChangeWhenHidden);
    return () => {
      window.removeEventListener("beforeunload", flushPendingChange);
      window.removeEventListener("pagehide", flushPendingChangeOnLeave);
      globalThis.document.removeEventListener("visibilitychange", flushPendingChangeWhenHidden);
      flushPendingChangeNow();
    };
  }, [readOnly, publishPendingDocument]);

  React.useEffect(() => {
    const pendingUrls = pendingUploadUrlsRef.current;
    return () => {
      for (const url of new Set(pendingUrls.values())) URL.revokeObjectURL(url);
      pendingUrls.clear();
    };
  }, []);

  const publishAlignmentGuides = React.useCallback((guides: CanvasAlignmentGuide[]) => {
    pendingAlignmentGuidesRef.current = guides;
    if (alignmentGuideFrameRef.current !== null) return;
    alignmentGuideFrameRef.current = window.requestAnimationFrame(() => {
      alignmentGuideFrameRef.current = null;
      const next = pendingAlignmentGuidesRef.current;
      setAlignmentGuides((current) => sameCanvasAlignmentGuides(current, next) ? current : next);
    });
  }, []);

  const clearAlignmentGuides = React.useCallback(() => {
    if (alignmentGuideFrameRef.current !== null) {
      window.cancelAnimationFrame(alignmentGuideFrameRef.current);
    }
    alignmentGuideFrameRef.current = null;
    pendingAlignmentGuidesRef.current = [];
    setAlignmentGuides((current) => current.length ? [] : current);
  }, []);

  React.useEffect(() => { if (!snapToGrid) clearAlignmentGuides(); }, [snapToGrid, clearAlignmentGuides]);

  React.useEffect(() => () => {
    if (alignmentGuideFrameRef.current !== null) {
      window.cancelAnimationFrame(alignmentGuideFrameRef.current);
    }
  }, []);

  const clearDataEditCoalescing = React.useCallback(() => {
    window.clearTimeout(dataEditTimer.current);
    dataEditTimer.current = undefined;
    coalescedDataEditRef.current = null;
  }, []);

  const publishUndoMediaRefs = React.useCallback((history: CanvasHistory) => {
    if (readOnly) return;
    onUndoMediaRefsChangeRef.current?.(
      collectCanvasHistoryUndoMediaRefs(history),
      collectCanvasDocumentUndoMediaRefs(history.present),
    );
  }, [readOnly]);

  React.useEffect(() => {
    publishUndoMediaRefs(historyRef.current);
  }, [publishUndoMediaRefs]);

  React.useEffect(() => () => {
    window.clearTimeout(dataEditTimer.current);
  }, []);

  const commit = React.useCallback((next: CanvasDocumentV2) => {
    if (readOnly) return;
    const normalized = sizeNewlyConnectedComparisons(documentRef.current, normalizeCanvasMediaOrigins(normalizeCanvasTaskNodeSizes(next)));
    clearDataEditCoalescing();
    historyRef.current = pushCanvasHistory(historyRef.current, normalized);
    publishUndoMediaRefs(historyRef.current);
    documentRef.current = normalized;
    pendingDocumentRef.current = normalized;
    setDocument(normalized);
  }, [readOnly, clearDataEditCoalescing, publishUndoMediaRefs]);

  useRestoreAgentMediaTasks(canvasId, document, readOnly, documentRef, commit, arrangementPreviewRef);

  const restoreHistory = React.useCallback((next: CanvasHistory) => {
    if (readOnly) return;
    // Undo restores content; the uncontrolled viewport stays where the user is.
    // Persist that same camera instead of an old history snapshot's viewport.
    const restored = preserveCanvasTaskExecutions(next.present, documentRef.current);
    const normalized = normalizeCanvasTaskNodeSizes({ ...restored, viewport: flow.getViewport() });
    clearDataEditCoalescing();
    historyRef.current = { ...next, present: normalized };
    publishUndoMediaRefs(historyRef.current);
    documentRef.current = normalized;
    pendingDocumentRef.current = normalized;
    setDocument(normalized);
    setSelectedIds([]);
    setSelectedEdgeIds([]);
    setContextMenu(null);
    setConnectionMenu(null);
  }, [readOnly, clearDataEditCoalescing, flow, publishUndoMediaRefs]);

  React.useEffect(() => {
    if (readOnly || arrangementPreviewRef.current) return;
    const current = documentRef.current;
    const next = restoreCreativeAgentMediaSizes(current);
    if (next !== current) commit(next);
  }, [document.nodes, readOnly, commit]);

  React.useImperativeHandle(agentBridgeRef, () => ({
    getSnapshot: () => {
      const committed = omitPendingCanvasUploads(documentRef.current, new Set(pendingUploadUrlsRef.current.keys()));
      return { document: committed, selection: getCreativeAgentSelection(canvasId, committed, agentSelectionIdsRef.current.nodeIds, agentSelectionIdsRef.current.edgeIds, false, agentSelectionIdsRef.current.focusedOutput) };
    },
    flush: () => {
      if (readOnly) throw new Error("管理员查看模式不能运行 Agent");
      if (arrangementPreviewRef.current) throw new Error("请先确认或取消画布排列预览");
      window.clearTimeout(changeTimer.current);
      changeTimer.current = undefined;
      pendingDocumentRef.current = documentRef.current;
      publishPendingDocument();
    },
    applyRemote: (incoming) => {
      window.clearTimeout(changeTimer.current);
      changeTimer.current = undefined;
      clearDataEditCoalescing();
      const current = documentRef.current;
      const persisted = omitPendingCanvasUploads(current, new Set(pendingUploadUrlsRef.current.keys()));
      const pendingIds = new Set(current.nodes.filter(node => !persisted.nodes.some(saved => saved.id === node.id)).map(node => node.id));
      const next = { ...incoming, viewport: flow.getViewport(), settings: current.settings,
        nodes: [...incoming.nodes, ...current.nodes.filter(node => pendingIds.has(node.id) && !incoming.nodes.some(saved => saved.id === node.id))],
        edges: [...incoming.edges, ...current.edges.filter(edge => (pendingIds.has(edge.source) || pendingIds.has(edge.target)) && !incoming.edges.some(saved => saved.id === edge.id))],
      };
      const merged = applyCreativeAgentRemoteHistory({ ...historyRef.current, present: documentRef.current }, next);
      historyRef.current = merged.history;
      remoteAppliedDocumentRef.current = merged.history.present;
      documentRef.current = merged.history.present;
      pendingDocumentRef.current = merged.history.present;
      setDocument(merged.history.present);
      setSelectedIds(ids => ids.filter(id => next.nodes.some(node => node.id === id)));
      setSelectedEdgeIds(ids => ids.filter(id => next.edges.some(edge => edge.id === id)));
      publishUndoMediaRefs(merged.history);
      onLiveNodesChange?.(next.nodes);
      if (merged.conflicts.length) setActionMessage(text("workspaceFollowup.m7984268d0d43"));
      return { conflicts: merged.conflicts };
    },
    focus: (nodeId, request) => {
      const target = flow.getNode(nodeId);
      if (!target) return;
      setSelectedIds([nodeId]);
      setSelectedEdgeIds([]);
      // 从对话点的是多图里的某一张：聚焦这一张（收起时临时显示它，展开时高亮那一格）
      const data = documentRef.current.nodes.find(node => node.id === nodeId)?.data;
      const ready = data?.kind === "imageTask" ? (data.task.batches.at(-1)?.outputs ?? []).filter(output => output.status === "success" && output.url) : [];
      const output = request?.outputIndex != null ? ready[request.outputIndex] : undefined;
      setFocusedOutput(output ? { nodeId, outputId: output.id, pulse: Date.now() } : null);
      void flow.fitView({ nodes: [target], padding: 0.24, duration: 300, maxZoom: 1.5 });
    },
  }), [canvasId, clearDataEditCoalescing, flow, onLiveNodesChange, publishPendingDocument, publishUndoMediaRefs, readOnly]);

  const undo = React.useCallback(() => restoreHistory(undoCanvasHistory(historyRef.current)), [restoreHistory]);
  const redo = React.useCallback(() => restoreHistory(redoCanvasHistory(historyRef.current)), [restoreHistory]);

  const pasteNodes = React.useCallback((position?: { x: number; y: number }) => {
    if (readOnly) return;
    const copied = clipboard.current;
    if (!copied?.ids.length) return;
    const result = duplicateSelection(copied.document, copied.ids, { x: 48, y: 48 });
    const originalNodeIds = new Set(copied.document.nodes.map((node) => node.id));
    const originalEdgeIds = new Set(copied.document.edges.map((edge) => edge.id));
    let copiedNodes = result.document.nodes.filter((node) => !originalNodeIds.has(node.id));
    const copiedEdges = result.document.edges.filter((edge) => !originalEdgeIds.has(edge.id));
    if (position && copiedNodes.length) {
      const copiedIds = new Set(copiedNodes.map((node) => node.id));
      const roots = copiedNodes.filter((node) => !node.parentId || !copiedIds.has(node.parentId));
      const nodesById = new Map(result.document.nodes.map((node) => [node.id, node]));
      const rootPositions = new Map(roots.map((node) => [node.id, canvasNodeWorldPosition(node, nodesById)]));
      const left = Math.min(...Array.from(rootPositions.values(), (point) => point.x));
      const top = Math.min(...Array.from(rootPositions.values(), (point) => point.y));
      copiedNodes = copiedNodes.map((node) => {
        const point = rootPositions.get(node.id);
        return point ? { ...node, parentId: undefined, position: { x: point.x + position.x - left, y: point.y + position.y - top } } : node;
      });
    }
    commit({ ...documentRef.current, nodes: [...documentRef.current.nodes, ...copiedNodes], edges: [...documentRef.current.edges, ...copiedEdges] });
    setSelectedIds(result.selectedIds);
    setContextMenu(null);
  }, [readOnly, commit]);

  const createNodeData = React.useCallback((kind: CreatableNodeKind, sourceIds: readonly string[] = []): CanvasNodeData => {
    const data = defaultData(kind, taskPreferencesRef.current);
    if (data.kind === "videoTask") {
      const model = resolveCanvasModelId(models?.video || [], data.model);
      return normalizeCanvasVideoTaskForModel(data, model, getVideoDisplaySpec(model, models?.video || []), false);
    }
    if (data.kind !== "audioTask" || !sourceIds.length) return data;
    const availableModels = models?.audio ?? [];
    const candidates = [data.model, ...availableModels.map((model) => model.id)]
      .filter((model, index, all) => all.indexOf(model) === index && availableModels.some((available) => available.id === model));
    const model = candidates.find((candidate) => {
      const target: CanvasNode = {
        id: "__canvas-connection-audioTask__",
        type: "audioTask",
        position: { x: 0, y: 0 },
        data: { ...data, model: candidate },
      };
      return sourceIds.every((source) => getCanvasConnectionDecision(
        [...documentRef.current.nodes, target], { source, target: target.id },
      ).allowed);
    });
    return restoreCanvasAudioModelPreference(data, model ?? "", taskPreferencesRef.current);
  }, [models?.audio, models?.video]);

  const addNode = React.useCallback((kind: CreatableNodeKind, options?: { position?: { x: number; y: number }; sourceId?: string; sourceIds?: string[]; sourceHandle?: string | null }) => {
    if (readOnly) return;
    const bounds = wrapRef.current?.getBoundingClientRect();
    const position = options?.position ?? (bounds
      ? flow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
      : { x: 0, y: 0 });
    const sourceIds = [...new Set(options?.sourceIds?.length ? options.sourceIds : options?.sourceId ? [options.sourceId] : [])];
    const data = createNodeData(kind, sourceIds);
    const taskSize = data.kind === "imageTask" || data.kind === "videoTask" || data.kind === "audioTask"
      ? getCanvasTaskResultFrameSize(data)
      : data.kind === "llm"
        ? getCanvasTextTaskFrameSize(data)
        : null;
    const node: CanvasNode = {
      id: id(kind),
      type: kind,
      position,
      data,
      width: taskSize?.width ?? (kind === "prompt" || kind === "llm" ? 350 : 280),
      height: taskSize?.height ?? (kind === "prompt" || kind === "llm" ? 200 : 180),
    };
    if (kind === "compare") {
      const source = documentRef.current.nodes.find((item) => item.id === sourceIds[0]);
      node.width = source?.width ?? 350;
      node.height = source?.height ?? 350;
    }
    const nextNodes = [...documentRef.current.nodes, node];
    let edges = documentRef.current.edges;
    if (sourceIds.length > 1) {
      const result = connectCanvasNodeSelection(nextNodes, edges, sourceIds, node.id, () => id("edge"));
      if (!result.connected) {
        setActionMessage(text("workspaceFollowup.m68e3121a1f58"));
        setConnectionMenu(null);
        return;
      }
      edges = result.edges;
    } else if (sourceIds.length === 1) {
      const connectionDecision = getCanvasConnectionDecision(nextNodes, { source: sourceIds[0], target: node.id }, edges);
      if (!connectionDecision.allowed) {
        setActionMessage(connectionDecision.error || text("workspaceFollowup.m6340b951ecd3"));
        setConnectionMenu(null);
        return;
      }
      edges = addEdge({ id: id("edge"), source: sourceIds[0], sourceHandle: options?.sourceHandle, target: node.id, type: "default" }, edges);
    }
    const targetGroupId = sourceIds.length ? findCanvasGroupAtPoint(documentRef.current.nodes, position) : undefined;
    const insertedDocument = { ...documentRef.current, nodes: nextNodes, edges };
    const nextDocument = targetGroupId
      ? alignNewCanvasGroupMember(joinCanvasGroups(insertedDocument, new Map([[node.id, targetGroupId]]), true), node.id)
      : insertedDocument;
    commit(sourceIds.length ? syncCanvasTaskPromptsWithEdges(nextDocument, edges) : nextDocument);
    setSelectedIds([node.id]);
    if (sourceIds.length) setEdgeGlowNodeId(node.id);
    if (sourceIds.length && (kind === "imageTask" || kind === "videoTask" || kind === "audioTask" || kind === "llm")) {
      setOpenTaskPanelNodeId(node.id);
    }
    setContextMenu(null);
    setConnectionMenu(null);
  }, [readOnly, commit, createNodeData, flow]);

  const hydrateAudioWaveform = React.useCallback((nodeId: string, waveform: CanvasAudioWaveformData) => {
    const current = documentRef.current;
    const task = current.nodes.find((node) => node.id === nodeId);
    if (task?.data.kind === "audioTask") {
      const next = {
        ...current,
        nodes: current.nodes.map((node) => node.id === nodeId && node.data.kind === "audioTask"
          ? { ...node, data: { ...node.data, waveformPeaks: waveform.waveformPeaks, durationSeconds: waveform.durationSeconds } }
          : node),
      };
      documentRef.current = next;
      setDocument(next);
      return;
    }
    const next = hydrateCanvasAudioNode(current, nodeId, waveform);
    if (next === current) return;
    documentRef.current = next;
    setDocument(next);
  }, []);

  const addMediaNode = React.useCallback((
    kind: "image" | "video" | "audio",
    url: string,
    name?: string,
    position?: { x: number; y: number },
    waveformPromise?: Promise<CanvasAudioWaveformData>,
  ) => {
    const node: CanvasNode = {
      id: id(kind),
      type: kind,
      position: position ?? { x: 0, y: 0 },
      data: kind === "image"
        ? { kind: "image", url, name, origin: "upload" }
        : kind === "video"
          ? { kind: "video", url, name, origin: "upload" }
          : { kind: "audio", url, name, origin: "upload" },
      width: kind === "audio" ? DEFAULT_CANVAS_AUDIO_NODE_SIZE.width : 280,
      height: kind === "audio" ? DEFAULT_CANVAS_AUDIO_NODE_SIZE.height : 240,
    };
    commit({ ...documentRef.current, nodes: [...documentRef.current.nodes, node] });
    setSelectedIds([node.id]);
    if (kind === "audio") {
      void (waveformPromise ?? analyzeAudioUrlCached(url))
        .then((waveform) => hydrateAudioWaveform(node.id, waveform))
        .catch(() => undefined);
    }
    return node.id;
  }, [commit, hydrateAudioWaveform]);

  const settleUpload = React.useCallback((nodeId: string, localUrl: string, result: CanvasPendingUploadResult) => {
    const resolve = (document: CanvasDocumentV2) => resolveCanvasPendingUpload(document, nodeId, result, localUrl);
    const settled = settleCanvasPendingUpload(historyRef.current, documentRef.current, nodeId, result, localUrl);
    if (clipboard.current) clipboard.current.document = resolve(clipboard.current.document);
    if (dragStart.current) {
      dragStart.current.document = resolve(dragStart.current.document);
      if (dragStart.current.copy) {
        const copy = dragStart.current.copy;
        const resolvedCopy = resolve({ ...dragStart.current.document, nodes: copy.nodes, edges: copy.edges });
        dragStart.current.copy = { ...copy, nodes: resolvedCopy.nodes, edges: resolvedCopy.edges };
        setDragCopyPreview(dragStart.current.copy);
      }
    }
    if (arrangementPreviewRef.current) {
      arrangementPreviewRef.current = { previous: resolve(arrangementPreviewRef.current.previous) };
      setArrangementPreview(arrangementPreviewRef.current);
    }
    historyRef.current = settled.history;
    publishUndoMediaRefs(settled.history);
    documentRef.current = settled.document;
    pendingDocumentRef.current = settled.document;
    setDocument(settled.document);
    if (result.status === "failed") {
      const remainingIds = new Set(settled.document.nodes.map((node) => node.id));
      setSelectedIds((selected) => selected.filter((id) => remainingIds.has(id)));
    }
  }, [publishUndoMediaRefs]);

  const uploadFiles = React.useCallback(async (
    files: File[],
    position: { x: number; y: number },
    displayNames?: string[],
    localPreview = false,
    connectFromId?: string,
    displaySizes?: Array<{ width: number; height: number }>,
    referenceInsertion?: CanvasReferenceInsertion,
  ) => {
    if (readOnly) return;
    const markdownFiles = files.filter(isMarkdownFile);
    const importedTextNodeIds: string[] = [];
    let textImportError = "";
    if (markdownFiles.length) {
      const results = await Promise.allSettled(markdownFiles.map(async file => {
        if (file.size > CANVAS_MAX_MARKDOWN_TEXT_BYTES) throw new Error("文档不能超过 256 KB");
        const text = await file.text();
        if (utf8ByteLength(text) > CANVAS_MAX_MARKDOWN_TEXT_BYTES) throw new Error("文档不能超过 256 KB");
        return text;
      }));
      const textNodes: CanvasNode[] = results.flatMap((result, index) => {
        if (result.status === "rejected") return [];
        return [{ id: id("prompt"), type: "prompt", position, width: 350, height: 200,
          data: { kind: "prompt", title: markdownFiles[index].name, text: result.value, format: "markdown" } }];
      });
      const current = documentRef.current;
      const positions = getCanvasLocalUploadPositions(textNodes.map(node => ({ width: node.width!, height: node.height! })), position, current.nodes);
      const failures = results.flatMap((result, index) => result.status === "rejected"
        ? [`${markdownFiles[index].name}：${result.reason instanceof Error ? result.reason.message : "无法读取文件"}`] : []);
      textNodes.forEach((node, index) => { node.position = positions[index]; });
      if (textNodes.length) {
        const next = { ...current, nodes: [...current.nodes, ...textNodes] };
        try {
          validateCanvasDocumentBudget(next);
          commit(next);
          importedTextNodeIds.push(...textNodes.map(node => node.id));
          setSelectedIds(importedTextNodeIds);
        } catch {
          failures.push("文档内容或画布总大小超出保存限制，请缩小文档后重试");
        }
      }
      textImportError = failures.length ? `Markdown 导入失败：${failures.join("；")}` : "";
      setActionMessage(textImportError);
      const mediaIndexes = files.flatMap((file, index) => isMarkdownFile(file) ? [] : [index]);
      files = mediaIndexes.map(index => files[index]);
      displayNames = displayNames && mediaIndexes.map(index => displayNames![index]);
      displaySizes = displaySizes && mediaIndexes.map(index => displaySizes![index]);
      if (!files.length) return;
    }
    const referenceTask = referenceInsertion ? documentRef.current.nodes.find(node => node.id === referenceInsertion.nodeId) : undefined;
    if (referenceTask?.data.kind === "videoTask") {
      const references = [...collectCanvasVideoReferences(documentRef.current, referenceTask.id), ...files.map(file => ({
        kind: file.type.startsWith("audio/") ? "audio" : file.type.startsWith("video/") ? "video" : "image",
      }))];
      const error = getCanvasVideoReferenceError(referenceTask.data.model, references);
      if (error) { setActionMessage(error); return; }
    }
    const imageCount = files.filter(file => file.type.startsWith("image/")).length;
    if (imageCount > CANVAS_IMAGE_UPLOAD_BATCH_LIMIT) {
      setUploadNotice({ message: text("workspaceFollowup.m75a8ae39ec53", { v0: CANVAS_IMAGE_UPLOAD_BATCH_LIMIT, v1: CANVAS_IMAGE_UPLOAD_BATCH_LIMIT, v2: imageCount - CANVAS_IMAGE_UPLOAD_BATCH_LIMIT }) });
      let acceptedImages = 0;
      files = files.filter(file => !file.type.startsWith("image/") || acceptedImages++ < CANVAS_IMAGE_UPLOAD_BATCH_LIMIT);
    } else {
      setUploadNotice(null);
    }
    setActionMessage(textImportError);
    const preparedUploads = files.map((file, index) => {
      const kind: CanvasMediaKind = file.type.startsWith("audio/")
        ? "audio"
        : file.type.startsWith("video/")
          ? "video"
          : "image";
      const nodeId = id(kind);
      const objectUrl = URL.createObjectURL(file);
      const waveformPromise = kind === "audio"
        ? analyzeAudioFile(file).catch(() => null)
        : null;
      const size = displaySizes?.[index] || (kind === "audio" ? CANVAS_PENDING_AUDIO_NODE_SIZE : DEFAULT_CANVAS_MEDIA_NODE_SIZE);
      const node: CanvasNode = {
        id: nodeId,
        type: kind,
        position,
        data: { kind, url: objectUrl, name: displayNames?.[index] || file.name, origin: connectFromId ? "generated" : "upload", localPreview: localPreview && kind === "image" ? true : undefined },
        width: size.width,
        height: size.height,
      };
      if (connectFromId) derivedSourceByNodeIdRef.current.set(nodeId, connectFromId);
      pendingUploadUrlsRef.current.set(nodeId, objectUrl);
      return { file, kind, node, nodeId, objectUrl, waveformPromise, size };
    });
    const uploadPositions = getCanvasLocalUploadPositions(preparedUploads.map(({ size }) => size), position, documentRef.current.nodes);
    const uploads = preparedUploads.map((upload, index) => ({
      ...upload,
      node: { ...upload.node, position: uploadPositions[index] || position },
    }));

    const connectedEdges: CanvasEdge[] = connectFromId
      ? uploads.map(({ nodeId }) => ({ id: id("edge"), source: connectFromId, target: nodeId, type: "default" }))
      : referenceInsertion
        ? uploads.map(({ nodeId }) => ({ id: id("edge"), source: nodeId, target: referenceInsertion.nodeId, type: "default" }))
        : [];
    const current = documentRef.current;
    const appendedNodes = [...current.nodes, ...uploads.map(({ node }) => node)];
    const laidOutNodes = connectFromId
      ? reflowTrackedDerivedBranch(
          appendedNodes,
          connectFromId,
          derivedSourceByNodeIdRef.current,
        ).nodes
      : appendedNodes;
    const nextDocument = {
      ...current,
      nodes: laidOutNodes,
      edges: [...current.edges, ...connectedEdges],
    };
    commit(referenceInsertion ? insertCanvasTaskReferences(current, nextDocument, referenceInsertion) : nextDocument);
    const uploadedNodeIds = uploads.map(({ nodeId }) => nodeId);
    setSelectedIds(referenceInsertion ? [referenceInsertion.nodeId] : [...importedTextNodeIds, ...uploadedNodeIds]);
    if (connectFromId) revealDerivedNodes(connectFromId, uploadedNodeIds);

    // Reading one slow file must not hold up the other local previews or uploads.
    const sizing = uploads.map(async (upload, index) => {
      if (displaySizes?.[index] || upload.kind === "audio") return;
      const size = await getCanvasLocalUploadNodeSize(upload.file, upload.kind, upload.objectUrl);
      if (!pendingUploadUrlsRef.current.has(upload.nodeId)) return;
      const before = uploads.map(item => item.node);
      upload.size = size;
      const positions = getCanvasLocalUploadPositions(uploads.map(item => item.size), position, documentRef.current.nodes.filter(node => !uploadedNodeIds.includes(node.id)));
      uploads.forEach((item, i) => { item.node = { ...item.node, ...item.size, position: positions[i] }; });
      const after = uploads.map(item => item.node);
      const hydrate = (document: CanvasDocumentV2) => hydrateCanvasLocalUploadLayout(document, before, after);
      const next = hydrate(documentRef.current);
      historyRef.current = { ...historyRef.current, past: historyRef.current.past.map(hydrate), future: historyRef.current.future.map(hydrate), present: next };
      if (dragStart.current) dragStart.current.document = hydrate(dragStart.current.document);
      if (clipboard.current) clipboard.current.document = hydrate(clipboard.current.document);
      documentRef.current = next;
      pendingDocumentRef.current = next;
      setDocument(next);
    });

    for (const { nodeId, waveformPromise } of uploads) {
      if (!waveformPromise) continue;
      void waveformPromise.then((waveform) => {
        if (waveform && pendingUploadUrlsRef.current.has(nodeId)) hydrateAudioWaveform(nodeId, waveform);
      });
    }

    await Promise.all(uploads.map(async ({ file, kind: localKind, nodeId, objectUrl, waveformPromise }, index) => {
      try {
        const payload = await uploadCanvasMedia(file);
        if (pendingUploadUrlsRef.current.get(nodeId) !== objectUrl) return;
        if (!payload?.success || !payload.url) {
          throw new Error(payload?.error || "上传失败");
        }
        const kind: CanvasMediaKind = payload.kind === "audio" || localKind === "audio"
          ? "audio"
          : payload.kind === "video" || localKind === "video"
            ? "video"
            : "image";
        if (kind === "audio" && waveformPromise) {
          registerAudioWaveformPromise(payload.url, waveformPromise.then((waveform) => {
            if (!waveform) throw new Error("音频波形解析失败");
            return waveform;
          }));
        }
        await sizing[index];
        if (pendingUploadUrlsRef.current.get(nodeId) !== objectUrl) return;
        settleUpload(nodeId, objectUrl, { status: "success", url: payload.url, kind, mediaId: payload.mediaId, variants: payload.variants });
      } catch (error) {
        if (pendingUploadUrlsRef.current.get(nodeId) !== objectUrl) return;
        derivedSourceByNodeIdRef.current.delete(nodeId);
        settleUpload(nodeId, objectUrl, { status: "failed" });
        setActionMessage(String((error as Error)?.message || "上传失败"));
      } finally {
        if (pendingUploadUrlsRef.current.get(nodeId) === objectUrl) {
          pendingUploadUrlsRef.current.delete(nodeId);
          window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
        }
      }
    }));
  }, [readOnly, commit, hydrateAudioWaveform, revealDerivedNodes, settleUpload]);

  const [dragPositions] = React.useState(createCanvasDragPositions);
  const flushDragPositions = React.useCallback(() => {
    const changes = dragPositions.getSnapshot();
    if (!changes.length) return;
    setRenderNodes(current => applyNodeChanges(changes.map(change => ({ ...change, dragging: false })), current));
    dragPositions.clear();
  }, [dragPositions]);
  const onNodesChange = React.useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    if (readOnly) changes = changes.filter(change => change.type === "select" || change.type === "dimensions");
    const selectionChanges = changes.filter((change) => change.type === "select");
    if (selectionChanges.length) {
      const marquee = marqueeSelectionRef.current;
      if (marqueeCancelledRef.current) {
        // The React Flow pointer lifecycle may finish after Escape cleared the marquee.
      } else if (marquee) {
        // The exact contained set is recomputed from the live marquee rectangle
        // in onSelectionChange so controlled selected flags cannot skew toggling.
      } else {
        setSelectedIds((current) => {
          if (dragStart.current?.copy) return dragStart.current.copy.selectedIds;
          const nextSet = new Set(current);
          for (const change of selectionChanges) change.selected ? nextSet.add(change.id) : nextSet.delete(change.id);
          const next = [...nextSet];
          const unchanged = current.length === next.length
            && current.every((id, index) => id === next[index]);
          return unchanged ? current : next;
        });
      }
    }
    // Node deletion is owned by applyRemoval, never by incidental React Flow changes.
    const structural = changes.filter((change) => change.type !== "select" && change.type !== "remove"
      && (change.type !== "dimensions" || change.setAttributes)
      && (change.type !== "position" || !cancelledCopyDragIds.current.has(change.id)))
      .map((change) => snapToGrid && !dragStart.current && change.type === "position" && change.dragging === false
        // A delayed drag-end event still carries the library's pre-alignment position.
        // Finish its dragging flag without undoing the final snapped coordinates.
        ? { ...change, position: undefined, positionAbsolute: undefined }
        : change);
    if (!structural.length) return;
    const positionChange = structural.find((change): change is CanvasNodePositionChange => isCanvasNodePositionChange(change));
    const start = dragStart.current;
    if (start && start.groups.indices.size !== documentRef.current.nodes.length) start.groups = createCanvasGroupDragGeometry(documentRef.current.nodes, start.ids);
    if (positionChange && !snapToGrid) clearAlignmentGuides();
    const alignedStructural = positionChange && start && snapToGrid
      ? (() => {
        const alignmentNodes = start.copy ? start.nodesById : start.groups.byId;
        const sourceNode = alignmentNodes.get(positionChange.id);
        const movingNodes = start.ids.flatMap((nodeId) => {
          const node = alignmentNodes.get(nodeId);
          return node ? [node] : [];
        });
        if (!sourceNode || movingNodes.length !== start.ids.length) {
          clearAlignmentGuides();
          return structural;
        }
        const movement = {
          x: positionChange.position!.x - sourceNode.position.x,
          y: positionChange.position!.y - sourceNode.position.y,
        };
        const movingBounds = canvasAlignmentBounds(movingNodes.map((node) => ({
          ...node, position: canvasNodeWorldPosition(node, alignmentNodes),
        })), movement);
        const bounds = wrapRef.current?.getBoundingClientRect();
        if (!movingBounds || !bounds) {
          clearAlignmentGuides();
          return structural;
        }
        const viewport = flow.getViewport();
        const alignment = resolveCanvasAlignment(
          movingBounds,
          start.alignment.get(documentRef.current.nodes),
          CANVAS_ALIGNMENT_GUIDE_THRESHOLD / Math.max(viewport.zoom, 0.01),
          { gridSize: 12, previousGuides: pendingAlignmentGuidesRef.current },
        );
        publishAlignmentGuides(alignment.guides);
        if (alignment.offset.x === 0 && alignment.offset.y === 0) return structural;
        return structural.map((change) => {
          if (change.type !== "position" || !start.movingIds.has(change.id) || !change.position) return change;
          return {
            ...change,
            position: {
              x: change.position.x + alignment.offset.x,
              y: change.position.y + alignment.offset.y,
            },
          };
        });
      })()
      : structural;
    if (start?.copy && positionChange) {
      // Native drag events still name the originals; only their copies receive movement.
      const copyChanges = alignedStructural.flatMap((change) => {
        if (change.type !== "position") return [];
        const copyId = start.copy!.idMap.get(change.id);
        return copyId ? [{ ...change, id: copyId }] : [];
      });
      start.copy = { ...start.copy, nodes: applyCanvasPositionChanges(start.copy.nodes, copyChanges) };
      setRenderNodes((current) => applyNodeChanges(copyChanges, current));
      return;
    }
    if (alignedStructural.every((change) => change.type === "position")) {
      const positioned = applyCanvasPositionChanges(documentRef.current.nodes, alignedStructural);
      const changedIds = new Set(alignedStructural.map(change => change.id));
      const groups = start?.groups ?? createCanvasGroupDragGeometry(positioned, []);
      const parentIds: string[] = [];
      for (const id of changedIds) {
        const index = groups.indices.get(id);
        const node = index === undefined ? undefined : positioned[index];
        if (!node) continue;
        groups.byId.set(id, node);
        if (node.parentId && !changedIds.has(node.parentId)) parentIds.push(node.parentId);
      }
      const nodes = parentIds.length ? fitCanvasGroupBounds(positioned, parentIds, false, groups) : positioned;
      const single = start?.ids.length === 1 ? groups.byId.get(start.ids[0]) : undefined;
      const isolatedDrag = single && !single.parentId && single.type !== "group" && nodes === positioned
        && alignedStructural.every(change => change.type === "position" && change.dragging === true && change.id === single.id);
      if (isolatedDrag) {
        dragPositions.publish(alignedStructural as Extract<NodeChange<CanvasFlowNode>, { type: "position" }>[]);
      } else {
        flushDragPositions();
        setRenderNodes((current) => {
          const moved = applyNodeChanges(alignedStructural, current);
          if (nodes === positioned) return moved;
          const fitted = new Map(nodes.filter((node, index) => node !== positioned[index]).map(node => [node.id, node]));
          return moved.map(node => {
            const updated = fitted.get(node.id);
            return updated ? { ...node, ...toFlowNode(updated, Boolean(node.selected)), dragging: node.dragging } : node;
          });
        });
      }
      if (nodes !== documentRef.current.nodes) {
        documentRef.current = { ...documentRef.current, nodes };
        if (!dragStart.current) setDocument(documentRef.current);
      }
      if (start) {
        const targets = new Set(findCanvasGroupDropTargets(nodes, start.ids, groups).values());
        for (const id of groupDropIds.current) if (!targets.has(id)) {
          const element = groupDropElements.current.get(id);
          if (element) delete element.dataset.canvasGroupDrop;
        }
        for (const id of targets) if (!groupDropIds.current.has(id)) {
          const element = groupDropElements.current.get(id);
          if (element) element.dataset.canvasGroupDrop = "true";
        }
        groupDropIds.current = targets;
      }
      return;
    }
    setRenderNodes((current) => applyNodeChanges(alignedStructural, current));
    const currentNodes = documentRef.current.nodes.map((node) => toFlowNode(node, selectedIds.includes(node.id)));
    const changedIds = new Set(alignedStructural.map((change) => "id" in change ? change.id : change.item.id));
    const currentById = new Map(documentRef.current.nodes.map((node) => [node.id, node]));
    const nextNodes = applyNodeChanges(alignedStructural, currentNodes).map((node) => changedIds.has(node.id) ? toCanvasNode(node) : currentById.get(node.id) ?? toCanvasNode(node));
    const normalized = normalizeCanvasTaskNodeSizes({ ...documentRef.current, nodes: nextNodes });
    documentRef.current = normalized;
    if (dragStart.current && positionChange) return;
    setDocument(normalized);
  }, [clearAlignmentGuides, commit, dragPositions, flow, flushDragPositions, publishAlignmentGuides, selectedIds, snapToGrid]);

  const onEdgesChange = React.useCallback((changes: EdgeChange<CanvasEdge>[]) => {
    const selectionChanges = changes.filter((change): change is Extract<EdgeChange<CanvasEdge>, { type: "select" }> => change.type === "select");
    if (selectionChanges.length) {
      if (marqueeCancelledRef.current) {
        // Preserve the pre-marquee edge selection until the cancelled pointer cycle ends.
      } else if (marqueeSelectionRef.current) {
        setSelectedEdgeIds([]);
      } else {
        setSelectedEdgeIds((current) => {
          const nextSet = new Set(current);
          for (const change of selectionChanges) {
            if (change.selected) nextSet.add(change.id);
            else nextSet.delete(change.id);
          }
          const next = [...nextSet];
          const unchanged = current.length === next.length
            && current.every((id, index) => id === next[index]);
          return unchanged ? current : next;
        });
      }
    }
    const structural = changes.filter((change) => change.type !== "select");
    if (!structural.length) return;
    const nextEdges = applyEdgeChanges(structural, documentRef.current.edges);
    commit(syncCanvasTaskPromptsWithEdges(documentRef.current, nextEdges));
  }, [commit]);

  const isValidConnection = React.useCallback((connection: Connection | CanvasEdge) => {
    const connectionDecision = getCanvasConnectionDecision(
      documentRef.current.nodes,
      connection,
      documentRef.current.edges,
    );
    return connectionDecision.allowed;
  }, []);

  const onConnect = React.useCallback((connection: Connection) => {
    if (readOnly) return;
    const pointerTarget = connectionFeedbackTargetRef.current;
    connectingNodeRef.current = null;
    updateConnectionFeedbackTarget(null);
    setConnectionMenu(null);
    const targetId = pointerTarget?.nodeId ?? connection.target;
    const pointerTargetMatchesConnection = pointerTarget?.nodeId === connection.target;
    const targetNode = documentRef.current.nodes.find((node) => node.id === targetId);
    const pointerTargetHandle = targetNode && (targetNode.data.kind === "image" || targetNode.data.kind === "video" || targetNode.data.kind === "audio")
      ? CANVAS_MEDIA_BODY_TARGET_HANDLE_ID
      : null;
    const normalizedConnection = {
      ...connection,
      target: targetId,
      targetHandle: pointerTarget && !pointerTargetMatchesConnection
        ? pointerTargetHandle
        : normalizeCanvasConnectionTargetHandle(connection.targetHandle),
    };
    const connectionDecision = getCanvasConnectionDecision(documentRef.current.nodes, normalizedConnection, documentRef.current.edges);
    if (!connectionDecision.allowed) {
      if (!pointerTarget) setActionMessage(connectionDecision.error || text("workspaceFollowup.m6340b951ecd3"));
      return;
    }
    const sourceNode = documentRef.current.nodes.find(node => node.id === normalizedConnection.source);
    const nextEdges = sourceNode?.data.kind === "group"
      ? connectCanvasNodeSelection(documentRef.current.nodes, documentRef.current.edges,
        getCanvasSelectionConnectionSources(documentRef.current.nodes, [sourceNode.id]).map(node => node.id), targetId, () => id("edge")).edges
      : addEdge({ ...normalizedConnection, id: id("edge"), type: "default" }, documentRef.current.edges);
    commit(syncCanvasTaskPromptsWithEdges(documentRef.current, nextEdges));
    if (targetNode?.data.kind === "llm") {
      setSelectedIds([targetNode.id]);
      setOpenTaskPanelNodeId(targetNode.id);
    }
  }, [readOnly, commit, updateConnectionFeedbackTarget]);

  const onConnectStart: OnConnectStart = React.useCallback((_event, params) => {
    if (readOnly) return;
    connectingNodeRef.current = params.handleType === "source" ? params.nodeId : null;
    updateConnectionFeedbackTarget(null);
    setContextMenu(null);
    setConnectionMenu(null);
    setActionMessage("");
  }, [readOnly, updateConnectionFeedbackTarget]);

  const onConnectEnd: OnConnectEnd = React.useCallback((event, connectionState) => {
    if (readOnly) return;
    const sourceId = connectingNodeRef.current;
    connectingNodeRef.current = null;
    updateConnectionFeedbackTarget(null);
    if (!sourceId || connectionState.isValid) return;
    const point = clientPoint(event);
    const targetId = connectionState.toNode?.id;
    const targetIsGroup = documentRef.current.nodes.some(node => node.id === targetId && node.data.kind === "group" && !node.data.collapsed);
    const connectionDecision = targetId && !targetIsGroup
      ? getCanvasConnectionDecision(documentRef.current.nodes, { source: sourceId, target: targetId }, documentRef.current.edges)
      : null;
    if (connectionDecision && !connectionDecision.allowed) {
      return;
    }
    const target = event.target;
    const droppedOnPane = target instanceof Element && (target.classList.contains("react-flow__pane")
      || Boolean(target.closest('[data-canvas-group-frame][data-collapsed="false"]')
        && !target.closest('button, input, textarea, [role="button"], [data-canvas-connection-target-id]')));
    if (!droppedOnPane) return;
    const bounds = wrapRef.current?.getBoundingClientRect();
    const sourceScreenPoint = connectionState.from
      ? flow.flowToScreenPosition(connectionState.from)
      : point;
    const menuPoint = clampCanvasMenuPosition(point.x, point.y, 220, 317);
    setContextMenu(null);
    suppressPaneClickRef.current = true;
    window.setTimeout(() => { suppressPaneClickRef.current = false; }, 0);
    setConnectionMenu({
      sourceIds: getCanvasSelectionConnectionSources(documentRef.current.nodes, [sourceId]).map(node => node.id),
      sourceHandle: connectionState.fromHandle?.id,
      x: menuPoint.x,
      y: menuPoint.y,
      zoom: flow.getViewport().zoom,
      position: flow.screenToFlowPosition(point),
      from: [{
        x: sourceScreenPoint.x - (bounds?.left ?? 0),
        y: sourceScreenPoint.y - (bounds?.top ?? 0),
      }],
      to: {
        x: point.x - (bounds?.left ?? 0),
        y: point.y - (bounds?.top ?? 0),
      },
      fromPosition: connectionState.fromPosition ?? Position.Right,
    });
  }, [readOnly, flow, onConnect, updateConnectionFeedbackTarget]);

  const openHandleConnectionMenu = React.useCallback(({ nodeId, handleId, position, point }: CanvasConnectionHandleClick) => {
    if (readOnly) return;
    if (handToolActive || canvasInteractionLocked) return;
    const node = flow.getNode(nodeId);
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!node || !wrap) return;
    const bounds = flow.getNodesBounds([node]);
    const frame = node.data.kind === "imageTask" ? getCanvasImageResultLayout(node.data).primary : { x: 0, y: 0, width: bounds.width, height: bounds.height };
    const from = flow.flowToScreenPosition({
      x: bounds.x + frame.x + (position === Position.Right ? frame.width : 0),
      y: bounds.y + frame.y + frame.height / 2,
    });
    const menuPoint = clampCanvasMenuPosition(point.x, point.y, 220, 317);
    setSelectedIds([nodeId]);
    setSelectedEdgeIds([]);
    setOpenTaskPanelNodeId(null);
    setContextMenu(null);
    setConnectionMenu({
      sourceIds: getCanvasSelectionConnectionSources(documentRef.current.nodes, [nodeId]).map(node => node.id), sourceHandle: handleId, ...menuPoint,
      zoom: flow.getViewport().zoom, position: flow.screenToFlowPosition(point),
      from: [{ x: from.x - wrap.left, y: from.y - wrap.top }],
      to: { x: point.x - wrap.left, y: point.y - wrap.top }, fromPosition: position,
    });
  }, [readOnly, canvasInteractionLocked, flow, handToolActive]);

  const updateCanvasConnectionFeedbackTarget = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const { clientX, clientY } = event;
    const ownerDocument = event.currentTarget.ownerDocument;
    cancelAnimationFrame(connectionQueryFrame.current);
    connectionQueryFrame.current = requestAnimationFrame(() => {
    connectionQueryFrame.current = 0;
    const sourceId = connectingNodeRef.current;
    if (!sourceId) {
      updateConnectionFeedbackTarget(null);
      return;
    }
    const targetElement = ownerDocument
      .elementsFromPoint(clientX, clientY)
      .map((element) => element.closest<HTMLElement>("[data-canvas-connection-target-id]"))
      .find((element): element is HTMLElement => Boolean(element)) ?? null;
    const targetId = targetElement?.dataset.canvasConnectionTargetId || null;
    if (!targetId || targetId === sourceId) {
      updateConnectionFeedbackTarget(null);
      return;
    }
    const connectionDecision = getCanvasConnectionDecision(
      documentRef.current.nodes,
      { source: sourceId, target: targetId },
      documentRef.current.edges,
    );
    const next = { nodeId: targetId, state: connectionDecision.allowed ? "valid" as const : "invalid" as const };
    updateConnectionFeedbackTarget(next);
    });
  }, [updateConnectionFeedbackTarget]);

  React.useEffect(() => {
    const cancel = () => {
      connectingNodeRef.current = null;
      updateConnectionFeedbackTarget(null);
      flowStore.getState().cancelConnection?.();
      setConnectionMenu(null);
    };
    const visibility = () => { if (window.document.hidden) cancel(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing && connectingNodeRef.current) cancel(); };
    window.addEventListener("blur", cancel);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape);
    window.document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(connectionQueryFrame.current);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape);
      window.document.removeEventListener("visibilitychange", visibility);
    };
  }, [flowStore, updateConnectionFeedbackTarget]);

  const onNodeDragStart: OnNodeDrag<CanvasFlowNode> = React.useCallback((event, node) => {
    // The dragged node's relations pause while it moves and flow again on release.
    setEdgeGlowNodeId(node.id);
    // An unchosen connection menu is cancelled by moving nodes, not suspended.
    setConnectionMenu(null);
    if (dragStart.current) return;
    cancelledCopyDragIds.current.clear();
    setNodeGestureActive(true);
    dismissCanvasTaskPopovers();
    const ids = selectedIds.includes(node.id) ? selectedIds : [node.id];
    const alt = "altKey" in event && event.altKey;
    const shift = "shiftKey" in event && event.shiftKey;
    const command = ("ctrlKey" in event && event.ctrlKey) || ("metaKey" in event && event.metaKey);
    let copy: CanvasDragCopy | undefined;
    if (alt) {
      const duplicated = duplicateSelection(documentRef.current, ids, { x: 0, y: 0 }, {
        copyInternalEdges: command || shift,
        preserveIncomingEdges: shift || (ids.length === 1 && node.type !== "group"),
      });
      copy = {
        nodes: duplicated.document.nodes.slice(documentRef.current.nodes.length),
        edges: duplicated.document.edges.slice(documentRef.current.edges.length),
        selectedIds: duplicated.selectedIds,
        idMap: duplicated.idMap,
      };
      for (const nodeId of copy.idMap.keys()) flowNodeCacheRef.current.delete(nodeId);
      setDragCopyPreview(copy);
      setSelectedIds(copy.selectedIds);
    } else {
      for (const nodeId of ids) derivedSourceByNodeIdRef.current.delete(nodeId);
    }
    clearAlignmentGuides();
    dragStart.current = {
      document: documentRef.current,
      ids,
      nodeId: node.id,
      nodesById: new Map(documentRef.current.nodes.map(node => [node.id, node])),
      movingIds: new Set(ids),
      groups: createCanvasGroupDragGeometry(documentRef.current.nodes, ids),
      alignment: createCanvasDragAlignment(new Set(ids), canvasAlignmentRect),
      copy,
      taskPanelWasOpen: openTaskPanelNodeId === node.id,
    };
    groupDropElements.current = new Map(Array.from(wrapRef.current?.querySelectorAll<HTMLElement>("[data-canvas-group-frame]") ?? [], element => [element.dataset.canvasGroupFrame!, element]));
  }, [clearAlignmentGuides, openTaskPanelNodeId, selectedIds]);

  const onNodeDragStop: OnNodeDrag<CanvasFlowNode> = React.useCallback(() => {
    flushDragPositions();
    cancelledCopyDragIds.current.clear();
    setNodeGestureActive(false);
    const start = dragStart.current;
    dragStart.current = null;
    clearAlignmentGuides();
    clearGroupDropTargets();
    if (!start) return;
    setDragCopyPreview(null);
    setOpenTaskPanelNodeId((current) => (
      start.taskPanelWasOpen ? start.nodeId : current === start.nodeId ? null : current
    ));
    if (start.copy) {
      for (const nodeId of start.copy.idMap.keys()) flowNodeCacheRef.current.delete(nodeId);
      const copied = { ...documentRef.current,
        nodes: [...documentRef.current.nodes, ...start.copy.nodes],
        edges: [...documentRef.current.edges, ...start.copy.edges],
      };
      commit(joinAndAlignCanvasGroups(copied, findCanvasGroupDropTargets(copied.nodes, start.copy.selectedIds)));
      setSelectedIds(start.copy.selectedIds);
      return;
    }
    commit(joinAndAlignCanvasGroups(documentRef.current, findCanvasGroupDropTargets(documentRef.current.nodes, start.ids)));
  }, [clearAlignmentGuides, clearGroupDropTargets, commit, flushDragPositions]);

  React.useEffect(() => {
    const finishInterruptedDrag = (event?: Event) => {
      // A different pointer being cancelled must not finish the active mouse pan.
      if (event?.type === "pointercancel" && panReleaseGuard.current?.isActive()) return;
      clearWheelEndTimer();
      flushDragPositions();
      setNodeGestureActive(false);
      setViewportInteracting(false);
      setSelectionInProgress(false);
      clearGroupDropTargets();
      const start = dragStart.current;
      if (!start) return;
      dragStart.current = null;
      clearAlignmentGuides();
      if (start.copy) {
        cancelledCopyDragIds.current = new Set(start.copy.idMap.keys());
        setDragCopyPreview(null);
        setSelectedIds(start.ids);
        window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, view: window, button: 0, buttons: 0 }));
        return;
      }
      setRenderNodes((current) => current.map((node) => (
        start.ids.includes(node.id) ? { ...node, dragging: false } : node
      )));
      setOpenTaskPanelNodeId((current) => (
        start.taskPanelWasOpen ? start.nodeId : current === start.nodeId ? null : current
      ));
      commit(documentRef.current);
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, view: window, button: 0, buttons: 0 }));
    };

    window.addEventListener("blur", finishInterruptedDrag);
    window.addEventListener("pointercancel", finishInterruptedDrag);
    const visibilityChange = () => { if (window.document.hidden) finishInterruptedDrag(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing) finishInterruptedDrag(); };
    window.document.addEventListener("visibilitychange", visibilityChange);
    window.addEventListener("keydown", escape);
    return () => {
      window.document.removeEventListener("visibilitychange", visibilityChange);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", finishInterruptedDrag);
      window.removeEventListener("pointercancel", finishInterruptedDrag);
    };
  }, [clearAlignmentGuides, clearGroupDropTargets, clearWheelEndTimer, commit, flushDragPositions]);

  const duplicate = React.useCallback((ids = selectedIds, options: { preserveIncomingEdges?: boolean; placeInFreeSpace?: boolean } = {}) => {
    if (readOnly) return;
    if (!ids.length) return;
    const current = documentRef.current;
    const singleNode = ids.length === 1 ? current.nodes.find((node) => node.id === ids[0]) : undefined;
    let offset: { x: number; y: number } | undefined;
    if (options.placeInFreeSpace && singleNode) {
      const byId = new Map(current.nodes.map(node => [node.id, node]));
      const ancestors = new Set<string>();
      for (let parentId = singleNode.parentId; parentId && !ancestors.has(parentId); parentId = byId.get(parentId)?.parentId) ancestors.add(parentId);
      // Containers are backgrounds for their own children, not placement obstacles.
      // Resolve all positions before filtering ancestors so nested nodes stay in world space.
      const occupied = current.nodes.map(node => {
        const measured = flow.getInternalNode(node.id)?.measured;
        return { ...node, position: canvasNodeWorldPosition(node, byId), parentId: undefined,
          width: measured?.width ?? node.width, height: measured?.height ?? node.height };
      }).filter(node => !ancestors.has(node.id));
      const source = occupied.find(node => node.id === singleNode.id)!;
      const bounds = flow.getNodesBounds([flow.getNode(singleNode.id) ?? singleNode]);
      const [position] = getCanvasLocalUploadPositions([bounds], source.position, occupied);
      offset = { x: position.x - source.position.x, y: position.y - source.position.y };
    }
    const result = duplicateSelection(current, ids, offset, {
      preserveIncomingEdges: options.preserveIncomingEdges ?? Boolean(singleNode && singleNode.type !== "group"),
    });
    if (options.placeInFreeSpace && singleNode?.parentId) {
      result.document.nodes = fitCanvasGroupBounds(result.document.nodes, [singleNode.parentId], true);
    }
    commit(result.document);
    setSelectedIds(result.selectedIds);
  }, [readOnly, commit, flow, selectedIds]);

  const applyRemoval = React.useCallback((nodeIds: string[], edgeIds: string[]) => {
    if (readOnly) return;
    if (!nodeIds.length && !edgeIds.length) return;
    const current = documentRef.current;
    const withoutNodes = nodeIds.length ? removeSelection(current, nodeIds) : current;
    const removedEdges = new Set(edgeIds);
    const nextEdges = withoutNodes.edges.filter((edge) => !removedEdges.has(edge.id));
    commit(syncCanvasTaskAssetChanges(current, { ...withoutNodes, edges: nextEdges }));
    setSelectedIds([]);
    setSelectedEdgeIds([]);
    setContextMenu(null);
    setConnectionMenu(null);
  }, [readOnly, commit]);
  const remove = React.useCallback(() => {
    applyRemoval(selectedIds, selectedEdgeIds);
  }, [applyRemoval, selectedIds, selectedEdgeIds]);

  const group = React.useCallback(() => {
    if (selectedIds.length < 2) return;
    try {
      const result = groupSelection(documentRef.current, selectedIds);
      commit(result.document);
      setSelectedIds([result.groupId]);
    } catch {
      // Nested selections are intentionally not regrouped.
    }
  }, [commit, selectedIds]);

  const stack = React.useCallback(() => {
    if (selectedIds.length < 2) return;
    try {
      const result = stackSelection(documentRef.current, selectedIds);
      commit(result.document);
      setSelectedIds([result.groupId]);
    } catch { /* Nested selections cannot be stacked. */ }
  }, [commit, selectedIds]);

  const ungroup = React.useCallback(() => {
    const groupId = selectedIds.find((selectedId) => documentRef.current.nodes.some((node) => node.id === selectedId && node.type === "group"));
    if (!groupId) return;
    commit(ungroupSelection(documentRef.current, groupId));
    setSelectedIds([]);
  }, [commit, selectedIds]);

  const connectSelected = React.useCallback(() => {
    const current = documentRef.current;
    const result = connectCanvasShortcutSelection(current.nodes, current.edges, selectedIds, () => id("edge"));
    if (!result.connected) { setActionMessage(result.error || text("workspaceFollowup.m6340b951ecd3")); return; }
    commit(syncCanvasTaskPromptsWithEdges(current, result.edges));
  }, [commit, selectedIds]);

  const previewArrangement = React.useCallback((options?: CanvasArrangeOptions) => {
    if (readOnly) return;
    if (arrangementPreviewRef.current) return;
    const current = documentRef.current;
    const next = options ? arrangeCanvas(current, options) : autoArrangeNodes(current);
    if (next === current || next.nodes.every((node, index) => node.position.x === current.nodes[index]?.position.x && node.position.y === current.nodes[index]?.position.y)) return;
    if (changeTimer.current !== undefined) {
      window.clearTimeout(changeTimer.current);
      changeTimer.current = undefined;
      pendingDocumentRef.current = current;
      publishPendingDocument();
    }
    const previewState = { previous: { ...current, viewport: flow.getViewport() } };
    arrangementPreviewRef.current = previewState;
    setArrangementPreview(previewState);
    documentRef.current = next;
    pendingDocumentRef.current = next;
    setDocument(next);
    window.requestAnimationFrame(() => {
      void flow.fitView({ padding: 0.12, duration: 300 });
    });
  }, [readOnly, flow, publishPendingDocument]);

  const autoArrange = React.useCallback(() => previewArrangement(), [previewArrangement]);
  React.useEffect(() => {
    if (!arrangeActionRef) return;
    arrangeActionRef.current = previewArrangement;
    return () => { arrangeActionRef.current = null; };
  }, [arrangeActionRef, previewArrangement]);
  React.useEffect(() => {
    onArrangementPreviewChange?.(Boolean(arrangementPreview));
    return () => onArrangementPreviewChange?.(false);
  }, [arrangementPreview, onArrangementPreviewChange]);

  const restoreAutoArrange = React.useCallback(() => {
    const previewState = arrangementPreviewRef.current;
    if (!previewState) return;
    setArrangementPreview(null);
    const previous = preserveCanvasTaskExecutions(previewState.previous, documentRef.current);
    documentRef.current = previous;
    pendingDocumentRef.current = previous;
    setDocument(previous);
    void flow.setViewport(previous.viewport, { duration: 300 });
    window.requestAnimationFrame(() => {
      arrangementPreviewRef.current = null;
    });
  }, [flow]);

  const keepAutoArrange = React.useCallback(() => {
    if (!arrangementPreviewRef.current) return;
    const next = { ...documentRef.current, viewport: flow.getViewport() };
    arrangementPreviewRef.current = null;
    setArrangementPreview(null);
    clearDataEditCoalescing();
    historyRef.current = pushCanvasHistory(historyRef.current, next);
    publishUndoMediaRefs(historyRef.current);
    documentRef.current = next;
    pendingDocumentRef.current = next;
    setDocument(next);
    publishPendingDocument();
  }, [clearDataEditCoalescing, flow, publishPendingDocument, publishUndoMediaRefs]);

  const applyMediaReplacement = React.useCallback(async (nodeId: string, media: ReplacementMedia, outputId?: string) => {
    const source = documentRef.current.nodes.find(node => node.id === nodeId);
    const before = source && canvasReplacementTarget(source.data, outputId)?.url;
    if (media.kind === "image" && !(media.variants?.original?.width && media.variants.original.height)) {
      const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        const cleanup = () => { clearTimeout(timer); image.onload = null; image.onerror = null; };
        const timer = window.setTimeout(() => { cleanup(); reject(new Error("图片尺寸读取超时，请重试")); }, 15000);
        image.onload = () => { const size = { width: image.naturalWidth, height: image.naturalHeight }; cleanup(); resolve(size); };
        image.onerror = () => { cleanup(); reject(new Error("图片读取失败，原素材已保留")); };
        image.src = media.url;
      });
      media = { ...media, variants: { ...media.variants, original: { url: media.url, ...size } } };
    }
    const current = documentRef.current.nodes.find(node => node.id === nodeId);
    if (!current || canvasReplacementTarget(current.data, outputId)?.url !== before) throw new Error("节点素材已改变，请重新选择替换");
    commit(replaceCanvasMedia(documentRef.current, nodeId, media, outputId));
    setActionMessage(text("workspaceFollowup.m0a1606cf531a"));
  }, [commit]);
  const replaceMediaFile = React.useCallback(async (nodeId: string, file: File, outputId?: string) => {
    if (readOnly) return;
    const node = documentRef.current.nodes.find(item => item.id === nodeId);
    const target = node && canvasReplacementTarget(node.data, outputId);
    if (!target) throw new Error("节点没有可替换素材");
    const kind = target.kind;
    if (!file.type.startsWith(`${kind}/`)) throw new Error("只能替换相同类型的素材");
    const originalUrl = target.url;
    const media = await uploadCanvasMedia(file);
    const current = documentRef.current.nodes.find(item => item.id === nodeId);
    if (!current || canvasReplacementTarget(current.data, outputId)?.url !== originalUrl) throw new Error("节点素材已改变，请重新选择替换");
    if (media.kind && media.kind !== kind) throw new Error("只能替换相同类型的素材");
    await applyMediaReplacement(nodeId, { kind, url: media.url, mediaId: media.mediaId, variants: media.variants }, target.outputId);
  }, [readOnly, applyMediaReplacement]);

  const updateData = React.useCallback((
    nodeId: string,
    updater: (data: CanvasNodeData) => CanvasNodeData,
    historyMode: "coalesce" | "replace" | "push" = "coalesce",
  ) => {
    if (readOnly) return;
    const currentNode = documentRef.current.nodes.find((node) => node.id === nodeId);
    if (!currentNode) return;
    const nextData = updater(currentNode.data);
    if (nextData === currentNode.data) return;
    let position = currentNode.position;
    if (currentNode.data.kind === "imageTask" && nextData.kind === "imageTask") {
      const previousLayout = getCanvasImageResultLayout(currentNode.data);
      const nextLayout = getCanvasImageResultLayout(nextData);
      if (previousLayout.primary.x !== nextLayout.primary.x || previousLayout.primary.y !== nextLayout.primary.y) {
        // Keep the primary image anchored when the grid folds or its card size changes.
        position = {
          x: position.x + previousLayout.primary.x - nextLayout.primary.x,
          y: position.y + previousLayout.primary.y - nextLayout.primary.y,
        };
      }
    }
    let next = normalizeCanvasTaskNodeSizes({
      ...documentRef.current,
      nodes: documentRef.current.nodes.map((node) => node.id === nodeId ? { ...node, position, data: nextData } : node),
    });
    if (currentNode.data.kind === "imageTask" && nextData.kind === "imageTask"
      && currentNode.data.task.batches.at(-1)?.primaryOutputId !== nextData.task.batches.at(-1)?.primaryOutputId) {
      next = syncCanvasTaskAssetChanges(documentRef.current, next);
    }
    const now = Date.now();
    const canCoalesce = historyMode === "coalesce"
      && coalescedDataEditRef.current?.nodeId === nodeId
      && coalescedDataEditRef.current.expiresAt >= now;
    clearDataEditCoalescing();
    historyRef.current = historyMode === "replace" || canCoalesce
      ? replaceCanvasHistoryPresent(historyRef.current, next)
      : pushCanvasHistory(historyRef.current, next);
    if (historyMode === "coalesce") {
      const marker = { nodeId, expiresAt: now + 700 };
      coalescedDataEditRef.current = marker;
      dataEditTimer.current = window.setTimeout(() => {
        if (coalescedDataEditRef.current === marker) coalescedDataEditRef.current = null;
        dataEditTimer.current = undefined;
      }, 700);
    }
    publishUndoMediaRefs(historyRef.current);
    documentRef.current = next;
    pendingDocumentRef.current = next;
    setDocument(next);
  }, [readOnly, clearDataEditCoalescing, publishUndoMediaRefs]);

  const collapseImageResults = React.useCallback((viewport?: CanvasDocumentV2["viewport"]) => {
    const surface = viewport ? flowStore.getState() : undefined;
    for (const node of documentRef.current.nodes) {
      if (node.data.kind !== "imageTask" || !isCanvasImageBatchExpanded(node.data.task.batches.at(-1))) continue;
      if (viewport && surface) {
        const renderedNode = flow.getNode(node.id);
        if (!renderedNode || !surface.width || !surface.height) continue;
        const bounds = flow.getNodesBounds([renderedNode]);
        const left = bounds.x * viewport.zoom + viewport.x;
        const top = bounds.y * viewport.zoom + viewport.y;
        const right = left + bounds.width * viewport.zoom;
        const bottom = top + bounds.height * viewport.zoom;
        if (right > 0 && bottom > 0 && left < surface.width && top < surface.height) continue;
      }
      updateData(node.id, data => data.kind === "imageTask" ? {
        ...data, task: { ...data.task, batches: data.task.batches.map((batch, index) =>
          index === data.task.batches.length - 1 ? { ...batch, expanded: false } : batch) },
      } : data, "replace");
    }
  }, [flow, flowStore, updateData]);

  React.useEffect(() => {
    const nodeControls = ".react-flow__node, .react-flow__handle, [data-canvas-task-panel-anchor], [data-canvas-focus-toolbar], [data-canvas-task-parameter-portal], [data-frosted-select-menu], [data-agent-debug-inspector]";
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(nodeControls)) return;
      collapseImageResults();
    };
    const onWheel = (event: WheelEvent) => {
      if (dragStart.current) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(nodeControls) && target.closest(".nowheel, [data-canvas-task-panel-anchor], [data-canvas-task-parameter-portal], [data-frosted-select-menu], [data-canvas-text-output-scroll], .canvas-text-node-content")) return;
      // Canvas scrolling checks visibility after the viewport has moved.
      if (target?.closest(".react-flow__renderer") && wrapRef.current?.contains(target)) return;
      collapseImageResults();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-agent-debug-inspector]")) return;
      if (event.key === "Escape") collapseImageResults();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [collapseImageResults]);

  React.useEffect(() => {
    if (libraryOpen || workflowOpen || utilityPanel) collapseImageResults();
  }, [libraryOpen, workflowOpen, utilityPanel, collapseImageResults]);

  const rememberTaskPreferences = React.useCallback((data: CanvasNodeData) => {
    if (readOnly) return;
    const nextPreferences = rememberCanvasTaskPreferences(taskPreferencesRef.current, data);
    if (nextPreferences === taskPreferencesRef.current) return;
    taskPreferencesRef.current = nextPreferences;
    writeCanvasTaskPreferences(window.localStorage, preferenceOwnerId, nextPreferences);
  }, [readOnly, preferenceOwnerId]);

  const changeTaskModel = React.useCallback((nodeId: string, model: string) => {
    if (readOnly) return;
    const node = documentRef.current.nodes.find((candidate) => candidate.id === nodeId);
    if (node?.data.kind === "audioTask") {
      const error = getCanvasAudioModelReferenceError(model, collectCanvasTaskAssets(documentRef.current, nodeId));
      if (error) { setActionMessage(error); return; }
    }
    if (node?.data.kind === "videoTask") {
      const error = getCanvasVideoReferenceError(model, collectCanvasVideoReferences(documentRef.current, nodeId));
      if (error) { setActionMessage(error); return; }
    }
    updateData(nodeId, (current) => {
      if (current.kind === "audioTask") return restoreCanvasAudioModelPreference(current, model, taskPreferencesRef.current);
      if (current.kind === "imageTask") {
        const selection = resolveGptImage25Selection(model);
        const targetParams = models?.image.find((candidate) => candidate.id === selection.model)?.params
          || getCanvasImageModelParams(selection.model);
        if (current.task.preset === "characterSheet" && !targetParams.aspectRatios.some((option) => option.value === "16:9" && !option.disabled)) return current;
        if (selection.model === current.task.settings.model && selection.gptImage25Mode) {
          return { ...current, task: { ...current.task, settings: { ...current.task.settings, gptImage25Mode: selection.gptImage25Mode } } };
        }
        const source = current.task.preset === "characterSheet"
          ? { ...current, task: { ...current.task, settings: { ...current.task.settings, aspectRatio: "16:9" } } }
          : current;
        const restored = carryCanvasImageTaskSettingsToModel(source, selection.model, targetParams);
        if (selection.gptImage25Mode) restored.task.settings.gptImage25Mode = selection.gptImage25Mode;
        return restored;
      }
      if (current.kind === "videoTask") {
        const spec = getVideoDisplaySpec(model, models?.video || []);
        return normalizeCanvasVideoTaskForModel(current, model, spec, collectCanvasVideoReferences(documentRef.current, nodeId));
      }
      return current;
    }, "push");
  }, [readOnly, models, updateData]);

  React.useEffect(() => {
    if (readOnly) return;
    if (models?.capabilityStatus !== "loaded") return;
    for (const node of documentRef.current.nodes) {
      if (node.data.kind === "videoTask" && node.data.subtitleRemoval) continue;
      if (node.data.kind === "imageTask") {
        const imageModels = node.data.task.preset === "characterSheet"
          ? models.image.filter((model) => model.params.aspectRatios.some((option) => option.value === "16:9" && !option.disabled))
          : models.image;
        const nextModel = resolveCanvasModelId(imageModels, node.data.task.settings.model);
        const nextMode = getAvailableGptImage25Mode(nextModel, node.data.task.settings.gptImage25Mode, models.image.find((model) => model.id === nextModel)?.gptImage25Variants);
        if (!nextModel || (nextModel === node.data.task.settings.model && (!nextMode || nextMode === (node.data.task.settings.gptImage25Mode || "flare"))
          && (node.data.task.preset !== "characterSheet" || node.data.task.settings.aspectRatio === "16:9"))) continue;
        updateData(node.id, (current) => {
          if (current.kind !== "imageTask") return current;
          const currentModel = resolveCanvasModelId(imageModels, current.task.settings.model);
          if (!currentModel) return current;
          const currentMode = getAvailableGptImage25Mode(currentModel, current.task.settings.gptImage25Mode, models.image.find((model) => model.id === currentModel)?.gptImage25Variants);
          if (currentModel === current.task.settings.model) {
            if (current.task.preset === "characterSheet") {
              const params = models.image.find((candidate) => candidate.id === currentModel)?.params || getCanvasImageModelParams(currentModel);
              const source = { ...current, task: { ...current.task, settings: { ...current.task.settings, aspectRatio: "16:9" } } };
              const normalized = carryCanvasImageTaskSettingsToModel(source, currentModel, params);
              return { ...normalized, task: { ...normalized.task, settings: { ...normalized.task.settings, gptImage25Mode: currentMode } } };
            }
            return { ...current, task: { ...current.task, settings: { ...current.task.settings, gptImage25Mode: currentMode } } };
          }
          const params = models.image.find((candidate) => candidate.id === currentModel)?.params
            || getCanvasImageModelParams(currentModel);
          const restored = current.task.preset === "characterSheet"
            ? carryCanvasImageTaskSettingsToModel({ ...current, task: { ...current.task, settings: { ...current.task.settings, aspectRatio: "16:9" } } }, currentModel, params)
            : restoreCanvasImageModelPreference(current, currentModel, params, taskPreferencesRef.current);
          restored.task.settings.gptImage25Mode = getAvailableGptImage25Mode(currentModel, restored.task.settings.gptImage25Mode, models.image.find((model) => model.id === currentModel)?.gptImage25Variants);
          return restored;
        }, "replace");
        continue;
      }
      if (node.data.kind === "videoTask") {
        if (node.data.subtitleRemoval) continue;
        const nextModel = resolveCanvasModelId(models.video, node.data.model);
        if (!nextModel) continue;
        updateData(node.id, (current) => {
          if (current.kind !== "videoTask") return current;
          const currentModel = resolveCanvasModelId(models.video, current.model);
          if (!currentModel) return current;
          const spec = getVideoDisplaySpec(currentModel, models.video);
          const restored = currentModel === current.model
            ? current
            : restoreCanvasVideoModelPreference(current, currentModel, spec, taskPreferencesRef.current);
          const next = normalizeCanvasVideoTaskForModel(restored, currentModel, spec, collectCanvasVideoReferences(documentRef.current, node.id));
          return current.model === next.model
            && current.inputMode === next.inputMode
            && current.resolution === next.resolution
            && current.ratio === next.ratio
            && current.duration === next.duration
            && current.generateAudio === next.generateAudio
            && current.omniReferenceTaskType === next.omniReferenceTaskType
            && current.outputFormat === next.outputFormat
            ? current
            : next;
        }, "replace");
        continue;
      }
      if (node.data.kind === "audioTask") {
        const nextModel = resolveCanvasModelId(models.audio, node.data.model);
        if (!nextModel || nextModel === node.data.model) continue;
        updateData(node.id, (current) => current.kind === "audioTask" ? restoreCanvasAudioModelPreference(current, nextModel, taskPreferencesRef.current) : current, "replace");
        continue;
      }
      if (node.data.kind !== "llm" || !node.data.providerId || !node.data.model) continue;
      const providerId = node.data.providerId;
      const modelId = node.data.model;
      const currentModelEnabled = models.chat.some((model) => model.providerId === providerId && model.modelId === modelId);
      const fallbackModel = models.chat[0];
      if (currentModelEnabled || !fallbackModel) continue;
      updateData(node.id, (current) => {
        if (current.kind !== "llm" || !current.providerId || !current.model) return current;
        const stillEnabled = models.chat.some((model) => model.providerId === current.providerId && model.modelId === current.model);
        return stillEnabled
          ? current
          : { ...current, providerId: fallbackModel.providerId, model: fallbackModel.modelId, thinkingLevel: "default" };
      }, "replace");
    }
  }, [readOnly, models, updateData]);

  const updateNodeSize = React.useCallback((nodeId: string, size: { width: number; height: number }) => {
    if (readOnly) return;
    const current = documentRef.current;
    const node = current.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || (node.width === size.width && node.height === size.height)) return;
    const derivedSources = derivedSourceByNodeIdRef.current;
    const resizedNodes = current.nodes.map((candidate) => (
      candidate.id === nodeId
        ? { ...candidate, width: size.width, height: size.height, data: candidate.data.kind === "llm" && candidate.data.output !== undefined
          ? { ...candidate.data, resultFrameSize: size }
          : candidate.data }
        : candidate
    ));
    const rootSourceId = derivedSources.get(nodeId) || nodeId;
    const reflowed = reflowTrackedDerivedBranch(resizedNodes, rootSourceId, derivedSources);
    const next = {
      ...current,
      nodes: reflowed.nodes,
    };
    documentRef.current = next;
    setDocument(next);
    if (reflowed.nodeIds.length) {
      revealDerivedNodes(rootSourceId, reflowed.nodeIds);
    }
  }, [readOnly, revealDerivedNodes]);

  const updateImageOutput = React.useCallback((nodeId: string, batchId: string, outputId: string, patch: Record<string, unknown>) => {
    updateData(nodeId, (data) => {
      if (data.kind !== "imageTask") return data;
      return {
        ...data,
        task: {
          ...data.task,
          batches: data.task.batches.map((batch) => batch.id === batchId ? updateImageTaskOutput(batch, outputId, patch) : batch),
        },
      };
    }, "replace");
  }, [updateData]);

  const hasPendingTaskUploads = React.useCallback(
    (nodeId: string) => hasPendingCanvasTaskUploads(documentRef.current, nodeId),
    [],
  );

  const completeImageOutput = React.useCallback((nodeId: string, batchId: string, outputId: string, results: CanvasGenerationOutput[]) => {
    updateData(nodeId, (data) => data.kind !== "imageTask" ? data : {
      ...data,
      task: {
        ...data.task,
        batches: data.task.batches.map((batch) => batch.id === batchId ? completeImageTaskOutput(batch, outputId, results) : batch),
      },
    }, "replace");
  }, [updateData]);

  const recoveredImageOutputsRef = React.useRef(new Set<string>());
  const imageRecoveryEpochRef = React.useRef(0);
  React.useEffect(() => {
    imageRecoveryEpochRef.current += 1;
    recoveredImageOutputsRef.current.clear();
    return () => { imageRecoveryEpochRef.current += 1; };
  }, [canvasId, readOnly]);
  React.useEffect(() => {
    if (readOnly) return;
    const epoch = imageRecoveryEpochRef.current;
    for (const node of document.nodes) {
      if (node.data.kind !== "imageTask") continue;
      const batch = node.data.task.batches.at(-1);
      if (!batch || !isMidjourneyV8Model(batch.settings.model)) continue;
      for (const output of batch.outputs) {
        if (output.status !== "success" || !output.generationId || !output.url || output.generationOutputsResolved) continue;
        const key = `${node.id}:${batch.id}:${output.id}:${output.generationId}`;
        if (recoveredImageOutputsRef.current.has(key)) continue;
        recoveredImageOutputsRef.current.add(key);
        // Older canvases saved only the first Midjourney image. Fetch saved results, never resubmit.
        void fetch(`/api/canvas/generation/${output.generationId}`, { cache: "no-store" })
          .then(async (response) => response.ok ? response.json() : null)
          .then((payload) => {
            if (epoch !== imageRecoveryEpochRef.current) return;
            if (!payload?.success || !Array.isArray(payload.outputs) || !payload.outputs.length) return;
            const current = documentRef.current.nodes.find((candidate) => candidate.id === node.id);
            const currentOutput = current?.data.kind === "imageTask"
              ? current.data.task.batches.at(-1)?.outputs.find((candidate) => candidate.id === output.id) : undefined;
            if (currentOutput?.status !== "success" || currentOutput.generationId !== output.generationId
              || currentOutput.generationOutputsResolved || currentOutput.url !== output.url
              || normalizeMediaUrl(output.url) !== payload.outputs[0].url) return;
            completeImageOutput(node.id, batch.id, output.id, payload.outputs);
          }).catch(() => undefined);
      }
    }
  }, [canvasId, document.nodes, readOnly, completeImageOutput]);

  const addGeneratedMedia = React.useCallback((sourceId: string, kind: "image" | "video" | "audio", url: string, resultId?: string, explicitName?: string, reveal = true, media?: CanvasMediaIdentity & { waveformPeaks?: number[]; durationSeconds?: number }) => {
    const current = documentRef.current;
    const stableId = resultId || id(kind);
    if (current.nodes.some((node) => node.id === stableId)) return;
    const source = current.nodes.find((node) => node.id === sourceId);
    if (!source) return;
    const name = getNextCanvasMaterialName(current, kind);
    const original = media?.variants?.original;
    const size = kind === "audio" ? DEFAULT_CANVAS_AUDIO_NODE_SIZE : original?.width && original.height ? getCanvasMediaNodeSize(original.width, original.height) : { width: 280, height: 240 };
    const node: CanvasNode = {
      id: stableId,
      type: kind,
      position: { x: source.position.x + 360, y: source.position.y },
      data: { ...media, kind, url, name: explicitName || name, origin: "generated" },
      width: size.width,
      height: size.height,
    };
    derivedSourceByNodeIdRef.current.set(stableId, sourceId);
    const laidOut = reflowTrackedDerivedBranch(
      [...current.nodes, node],
      sourceId,
      derivedSourceByNodeIdRef.current,
    );
    commit({ ...current, nodes: laidOut.nodes, edges: source.type === "group" ? current.edges : [...current.edges, { id: id("edge"), source: sourceId, target: stableId, type: "default" }] });
    if (reveal) revealDerivedNodes(sourceId, [stableId]);
    return stableId;
  }, [commit, revealDerivedNodes]);

  const runImageOutput = React.useCallback(async (nodeId: string, batchId: string, outputId: string, resumeGenerationId?: number, extraPrompt = "") => {
    if (readOnly) return;
    const runKey = `${nodeId}:${batchId}:${outputId}`;
    if (activeGenerations.current.has(runKey)) return false;
    activeGenerations.current.add(runKey);
    try {
      const node = documentRef.current.nodes.find((candidate) => candidate.id === nodeId);
      if (!node || node.data.kind !== "imageTask") return false;
      const batch = node.data.task.batches.find((candidate) => candidate.id === batchId);
      if (!batch) return false;
      const output = batch.outputs.find((candidate) => candidate.id === outputId);
      if (!output) return false;
      const outputRequestKey = output.requestKey || createBrowserUuid();
      let generationId = resumeGenerationId;
      let directOutputs: CanvasGenerationOutput[] | undefined;
      if (!generationId) {
        if (hasPendingTaskUploads(nodeId)) {
          setActionMessage(text("workspaceFollowup.m5d4e03b3b835"));
          return false;
        }
        const supplement = [batch.settings.prompt, extraPrompt].filter(Boolean).join("\n\n");
        const prompt = node.data.task.preset === "characterSheet" ? buildCanvasCharacterSheetPrompt(supplement) : supplement;
        const taskInput = buildCanvasTaskMediaInput(documentRef.current, nodeId, prompt);
        const imagePaths = taskInput.imagePaths;
        const runnableImageModel = models?.capabilityStatus === "loaded"
          ? resolveCanvasModelId(models.image, batch.settings.model)
          : batch.settings.model || models?.image[0]?.id || "";
        if (!prompt.trim() && !taskInput.textList.length && !hasCreativeSettings(batch.settings) && !(isSeedream55Model(batch.settings.model) && batch.settings.seedream55?.layerDecomposition)) throw new Error("请输入图片生成指令，或连接一个提示词节点");
        if (!runnableImageModel) throw new Error("暂无可用图片模型");
        if (node.data.task.preset === "characterSheet" && !imagePaths.length) throw new Error("角色设定图需要连接参考图片");
        if (isGptImage2OfficialProviderModel(runnableImageModel) && imagePaths.length > 16) {
          throw new Error("GPT-Image-2（re/yu）最多支持 16 张参考图");
        }
        if (isQwenImage3Model(runnableImageModel) && imagePaths.length > 3) throw new Error("Qwen-Image-3.0 最多支持 3 张参考图");
        if (isQwenImage21Model(runnableImageModel) && imagePaths.length > 10) throw new Error("Qwen-Image-Global-2.1 最多支持 10 张参考图");
        if (isTuziGptImage2Model(runnableImageModel) && imagePaths.length > 16) {
          throw new Error("GPT-Image-2（tz）最多支持 16 张参考图");
        }
        if (imagePaths.length > 16) throw new Error("图片模型最多支持 16 张参考图");
        await flushBeforeServerRun();
        updateImageOutput(nodeId, batchId, outputId, { status: "submitting", startedAt: Date.now(), finishedAt: undefined, requestKey: outputRequestKey, error: undefined });
        const submitted = await submitImageGen({
          canvasId,
          sessionId: editorSessionId,
          requestKey: outputRequestKey,
          model: runnableImageModel,
          prompt: taskInput.prompt,
          textList: taskInput.textList,
          creativePresets: batch.settings.creativePresets,
          imageAngle: batch.settings.imageAngle,
          aspectRatio: batch.settings.aspectRatio,
          resolution: getCanvasImageSubmissionResolution(runnableImageModel, batch.settings.resolution),
          customSize: batch.settings.customSize,
          quality: batch.settings.quality,
          googleThinkingLevel: batch.settings.googleThinkingLevel,
          googleSearchMode: batch.settings.googleSearchMode,
          gptImage25Mode: batch.settings.gptImage25Mode,
          background: batch.settings.background,
          outputFormat: batch.settings.outputFormat,
          gifSize: batch.settings.gifSize, frameCount: batch.settings.frameCount, frameDurationMs: batch.settings.frameDurationMs, seedream55: batch.settings.seedream55,
          speed: batch.settings.midjourneySpeed,
          midjourneyOptions: batch.settings.midjourneyOptions,
          imagePaths: imagePaths.length ? imagePaths : undefined,
        });
        rememberTaskPreferences({
          ...node.data,
          task: {
            ...node.data.task,
            settings: { ...batch.settings, model: runnableImageModel },
          },
        });
        generationId = submitted.generationId;
        directOutputs = submitted.outputs?.length ? submitted.outputs : submitted.url ? [{ url: submitted.url, generationId }] : undefined;
      }
      if (directOutputs?.length) {
        completeImageOutput(nodeId, batchId, outputId, directOutputs);
        return true;
      }
      if (!generationId) throw new Error("图片任务缺少 Generation ID");
      updateImageOutput(nodeId, batchId, outputId, { status: "running", generationId, error: undefined });
      const outputs = await waitForGenerationOutputs(generationId, undefined, 2500, CANVAS_GENERATION_FOREGROUND_WAIT_MS, () => cancelRequested.current || cancelledNodeIdsRef.current.has(nodeId));
      completeImageOutput(nodeId, batchId, outputId, outputs);
      return true;
    } catch (reason) {
      const cancelled = cancelRequested.current || cancelledNodeIdsRef.current.has(nodeId);
      updateImageOutput(nodeId, batchId, outputId, { status: cancelled ? "cancelled" : "failed", error: cancelled ? undefined : String((reason as Error)?.message || reason), finishedAt: Date.now() });
      return false;
    } finally {
      activeGenerations.current.delete(runKey);
    }
  }, [readOnly, canvasId, editorSessionId, hasPendingTaskUploads, models, flushBeforeServerRun, rememberTaskPreferences, updateImageOutput, completeImageOutput]);

  const runVideoNode = React.useCallback(async (nodeId: string, resumeGenerationId?: number, extraPrompt = "") => {
    if (readOnly) return;
    const runKey = `video:${nodeId}:${extraPrompt}`;
    if (activeGenerations.current.has(runKey)) return false;
    activeGenerations.current.add(runKey);
    try {
      const node = documentRef.current.nodes.find((candidate) => candidate.id === nodeId);
      if (!node || node.data.kind !== "videoTask") return false;
      const videoRequestKey = node.data.status === "submitting" && node.data.requestKey
        ? node.data.requestKey
        : createBrowserUuid();
      if (!resumeGenerationId && hasPendingTaskUploads(nodeId)) {
        setActionMessage(text("workspaceFollowup.m5d4e03b3b835"));
        return false;
      }
      let generationId = resumeGenerationId;
      if (!generationId) {
        const prompt = [node.data.prompt, extraPrompt].filter(Boolean).join("\n\n");
        const taskInput = buildCanvasTaskMediaInput(documentRef.current, nodeId, prompt);
        if (!prompt.trim() && !taskInput.textList.length && !hasCreativeSettings(node.data)) throw new Error("请输入视频生成指令，或连接一个提示词节点");
        const runnableVideoModel = models?.capabilityStatus === "loaded"
          ? resolveCanvasModelId(models.video, node.data.model)
          : node.data.model || models?.video[0]?.id || "";
        if (!runnableVideoModel) {
          setActionMessage(text("workspaceFollowup.m13a996744d69"));
          return false;
        }
        const submittedData = normalizeCanvasVideoTaskForModel(
          node.data,
          runnableVideoModel,
          getVideoDisplaySpec(runnableVideoModel, models?.video || []),
          collectCanvasVideoReferences(documentRef.current, nodeId),
        );
        const referenceError = getCanvasVideoReferenceError(runnableVideoModel, collectCanvasVideoReferences(documentRef.current, nodeId), submittedData.inputMode, true);
        if (referenceError) { setActionMessage(referenceError); return false; }
        updateData(nodeId, (data) => data.kind === "videoTask" ? submittedData : data, "replace");
        await flushBeforeServerRun();
        updateData(nodeId, (data) => data.kind === "videoTask" ? { ...data, status: "submitting", requestKey: videoRequestKey, generationId: undefined, startedAt: Date.now(), finishedAt: undefined, error: undefined } : data, "replace");
        const submitted = await submitVideoGen({
          canvasId,
          sessionId: editorSessionId,
          requestKey: videoRequestKey,
          model: runnableVideoModel,
          prompt: taskInput.prompt,
          textList: taskInput.textList,
          mediaPaths: taskInput.mediaPaths,
          creativePresets: submittedData.creativePresets,
          cameraFixed: submittedData.cameraFixed,
          inputMode: submittedData.inputMode,
          resolution: submittedData.resolution,
          ratio: submittedData.ratio,
          duration: submittedData.duration,
          generateAudio: submittedData.generateAudio,
          omniReferenceTaskType: submittedData.omniReferenceTaskType,
          outputFormat: submittedData.outputFormat,
        });
        rememberTaskPreferences(submittedData);
        generationId = submitted.generationId;
      }
      updateData(nodeId, (data) => data.kind === "videoTask" ? { ...data, status: "running", generationId, startedAt: data.startedAt || Date.now(), error: undefined } : data, "replace");
      const url = await waitForGenerationResult(generationId, undefined, 2500, CANVAS_GENERATION_FOREGROUND_WAIT_MS, () => cancelRequested.current || cancelledNodeIdsRef.current.has(nodeId));
      updateData(nodeId, (data) => data.kind === "videoTask" ? { ...data, status: "success", generationId, outputUrl: url, outputName: undefined, mediaId: undefined, variants: undefined, finishedAt: Date.now(), error: undefined } : data, "replace");
      return true;
    } catch (reason) {
      const cancelled = cancelRequested.current || cancelledNodeIdsRef.current.has(nodeId);
      updateData(nodeId, (data) => data.kind === "videoTask" ? { ...data, status: cancelled ? "cancelled" : "failed", finishedAt: Date.now(), error: cancelled ? undefined : String((reason as Error)?.message || reason) } : data, "replace");
      return false;
    } finally {
      activeGenerations.current.delete(runKey);
    }
  }, [readOnly, canvasId, editorSessionId, hasPendingTaskUploads, models, flushBeforeServerRun, rememberTaskPreferences, updateData]);

  const runAudioNode = React.useCallback(async (nodeId: string, extraPrompt = "", resumeGenerationId?: number) => {
    if (readOnly) return;
    const runKey = `audio:${nodeId}`;
    if (activeGenerations.current.has(runKey)) return false;
    activeGenerations.current.add(runKey);
    let sunoSubmitStarted = false;
    try {
      const node = documentRef.current.nodes.find((candidate) => candidate.id === nodeId);
      if (!node || node.data.kind !== "audioTask") return false;
      const textList = collectCanvasTextReferences(documentRef.current, nodeId).map(reference => reference.content);
      const text = [isSunoModel(node.data.model) ? sunoPrompt(node.data.suno || {}) : node.data.prompt, extraPrompt].filter(Boolean).join("\n\n").trim();
      if (!resumeGenerationId && !text && !textList.length && !(isSunoModel(node.data.model) && node.data.suno?.custom && node.data.suno.instrumental)) throw new Error("请输入生成内容，或连接一个提示词节点");
      const model = resumeGenerationId ? node.data.model : models?.capabilityStatus === "loaded"
        ? resolveCanvasModelId(models.audio, node.data.model)
        : node.data.model || models?.audio[0]?.id || "";
      if (!model) throw new Error("暂无可用音频模型");
      const referenceError = getCanvasAudioModelReferenceError(model, collectCanvasTaskAssets(documentRef.current, nodeId));
      if (!resumeGenerationId && referenceError) throw new Error(referenceError);
      const seedAudioInput = isSeedAudioModel(model)
        ? { ...buildCanvasSeedAudioInput(documentRef.current, nodeId, text), audioFormat: node.data.audioFormat, sampleRate: node.data.sampleRate }
        : {};
      const requestKey = (resumeGenerationId || node.data.status === "submitting") && node.data.requestKey
        ? node.data.requestKey
        : createBrowserUuid();
      if (!resumeGenerationId) await flushBeforeServerRun();
      updateData(nodeId, (data) => data.kind === "audioTask" ? {
        ...data,
        model,
        status: resumeGenerationId ? "running" : "submitting",
        requestKey,
        generationId: resumeGenerationId,
        startedAt: resumeGenerationId ? data.startedAt || Date.now() : Date.now(),
        finishedAt: undefined,
        error: undefined,
      } : data, "replace");
      const abortController = new AbortController();
      audioAbortControllersRef.current.set(nodeId, abortController);
      sunoSubmitStarted = !resumeGenerationId && isSunoModel(model);
      const submitted = resumeGenerationId ? { generationId: resumeGenerationId, url: undefined, durationSeconds: undefined, usageCharacters: undefined } : await submitAudioGen({
        canvasId,
        sessionId: editorSessionId,
        requestKey,
        model,
        text,
        textList,
        suno: isSunoModel(model) ? node.data.suno : undefined,
        voiceId: node.data.voiceId,
        speed: node.data.speed,
        pitch: node.data.pitch,
        volume: node.data.volume,
        modifyPitch: node.data.modifyPitch,
        modifyIntensity: node.data.modifyIntensity,
        modifyTimbre: node.data.modifyTimbre,
        soundEffect: node.data.soundEffect,
        ...(node.data.emotion ? { emotion: node.data.emotion } : {}),
        ...seedAudioInput,
        signal: abortController.signal,
      });
      sunoSubmitStarted = false;
      rememberTaskPreferences({ ...node.data, model });
      if (cancelledNodeIdsRef.current.has(nodeId)) throw new Error("任务已取消");
      updateData(nodeId, (data) => data.kind === "audioTask" ? { ...data, status: "running", generationId: submitted.generationId, error: undefined } : data, "replace");
      const outputs = isSunoModel(model) ? await waitForGenerationOutputs(submitted.generationId, progress => { if (progress.message) updateData(nodeId, data => data.kind === "audioTask" ? { ...data, error: progress.message } : data, "replace"); }, 4000, CANVAS_GENERATION_FOREGROUND_WAIT_MS, () => cancelRequested.current || cancelledNodeIdsRef.current.has(nodeId)) : undefined;
      const tracks = outputs?.flatMap(o => o.suno ? [{ ...o.suno, url: o.url, generationId: o.generationId, mediaId: o.mediaId }] : []);
      const url = outputs?.[0]?.url || submitted.url || await waitForGenerationResult(
        submitted.generationId,
        undefined,
        1500,
        CANVAS_GENERATION_FOREGROUND_WAIT_MS,
        () => cancelRequested.current || cancelledNodeIdsRef.current.has(nodeId),
      );
      updateData(nodeId, (data) => data.kind === "audioTask" ? {
        ...data,
        status: "success",
        generationId: submitted.generationId,
        outputUrl: url,
        outputName: tracks?.[0]?.title,
        audioOutputs: tracks?.length ? tracks : undefined,
        selectedAudioIndex: tracks?.length ? 0 : undefined,
        waveformPeaks: undefined,
        durationSeconds: tracks?.[0]?.durationSeconds ?? submitted.durationSeconds,
        usageCharacters: submitted.usageCharacters,
        finishedAt: Date.now(),
        error: undefined,
      } : data, "replace");
      void analyzeAudioUrlCached(url).then((waveform) => hydrateAudioWaveform(nodeId, waveform)).catch(() => undefined);
      return true;
    } catch (reason) {
      const uncertain = sunoSubmitStarted && !(reason instanceof AudioSubmissionError && reason.rejected);
      const cancelled = cancelRequested.current || cancelledNodeIdsRef.current.has(nodeId) || (reason as Error)?.name === "AbortError";
      updateData(nodeId, (data) => data.kind === "audioTask" ? {
        ...data,
        status: uncertain ? "submitting" : cancelled ? "cancelled" : "failed",
        finishedAt: Date.now(),
        error: uncertain ? "提交结果待确认，请刷新恢复查询，勿重复新建任务" : cancelled ? undefined : String((reason as Error)?.message || reason),
      } : data, "replace");
      return false;
    } finally {
      audioAbortControllersRef.current.delete(nodeId);
      activeGenerations.current.delete(runKey);
    }
  }, [readOnly, canvasId, editorSessionId, flushBeforeServerRun, hydrateAudioWaveform, models, rememberTaskPreferences, updateData]);

  const runLlmNode = React.useCallback(async (nodeId: string, extraPrompt = "") => {
    if (readOnly) return;
    const runKey = `llm:${nodeId}:${extraPrompt}`;
    if (activeGenerations.current.has(runKey)) return false;
    activeGenerations.current.add(runKey);
    try {
      const node = documentRef.current.nodes.find((candidate) => candidate.id === nodeId);
      if (!node || node.data.kind !== "llm") return false;
      if (hasPendingTaskUploads(nodeId)) {
        setActionMessage(text("workspaceFollowup.m5d4e03b3b835"));
        return false;
      }
      const textList = collectCanvasTextReferences(documentRef.current, nodeId).map(reference => reference.content);
      const prompt = [node.data.prompt, extraPrompt].filter(Boolean).join("\n\n");
      if (!prompt.trim() && !textList.length) throw new Error("请输入内容，或连接一个提示词节点");
      const taskAssets = collectCanvasTaskAssets(documentRef.current, nodeId);
      const promptRequest = buildPromptWithAssetReferences(prompt, taskAssets);
      const providerId = node.data.providerId;
      const modelId = node.data.model;
      const requestedLlmModel = models?.capabilityStatus === "loaded"
        ? models.chat.find((model) => model.providerId === providerId && model.modelId === modelId)
          || models.chat.find((model) => model.providerId === models.canvasDefault.providerId && model.modelId === models.canvasDefault.modelId)
          || models.chat[0]
        : undefined;
      if (!requestedLlmModel) {
        setActionMessage(text("workspaceFollowup.mad4e141306dc"));
        return false;
      }
      await flushBeforeServerRun();
      updateData(nodeId, (data) => data.kind === "llm" ? { ...data, status: "running", error: undefined } : data, "replace");
      const abortController = new AbortController();
      llmAbortControllersRef.current.set(nodeId, abortController);
      const response = await fetch("/api/canvas/llm", {
        method: "POST",
        signal: abortController.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Canvas-Id": String(canvasId),
          "X-Canvas-Session-Id": editorSessionId,
        },
        body: JSON.stringify({
          prompt: promptRequest.modelPrompt,
          textList,
          mediaReferences: taskAssets.map(({ kind, url }) => ({ kind, url })),
          system: node.data.system,
          thinkingLevel: node.data.thinkingLevel && requestedLlmModel.thinkingLevels?.includes(node.data.thinkingLevel) ? node.data.thinkingLevel : "default",
          override: requestedLlmModel ? { providerId: requestedLlmModel.providerId, modelId: requestedLlmModel.modelId } : undefined,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (cancelledNodeIdsRef.current.has(nodeId)) throw new Error("任务已取消");
      if (!response.ok || !payload?.success) throw new Error(payload?.error || "LLM 运行失败");
      updateData(nodeId, (data) => data.kind === "llm" ? { ...data, status: "success", output: String(payload.text || ""), error: undefined } : data, "replace");
      return true;
    } catch (reason) {
      const cancelled = cancelRequested.current || cancelledNodeIdsRef.current.has(nodeId);
      updateData(nodeId, (data) => data.kind === "llm" ? { ...data, status: cancelled ? "cancelled" : "failed", error: cancelled ? undefined : String((reason as Error)?.message || reason) } : data, "replace");
      return false;
    } finally {
      llmAbortControllersRef.current.delete(nodeId);
      activeGenerations.current.delete(runKey);
    }
  }, [readOnly, canvasId, editorSessionId, hasPendingTaskUploads, models, flushBeforeServerRun, updateData]);

  const runNode = React.useCallback(async (nodeId: string, extraPrompt = "") => {
    if (readOnly) return;
    const node = documentRef.current.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return false;
    cancelledNodeIdsRef.current.delete(nodeId);
    if ((node.data.kind === "imageTask" || node.data.kind === "videoTask") && hasPendingTaskUploads(nodeId)) {
      setActionMessage(text("workspaceFollowup.m5d4e03b3b835"));
      return false;
    }
    if (node.data.kind === "imageTask") {
      const imageModel = models?.capabilityStatus === "loaded"
        ? resolveCanvasModelId(models.image, node.data.task.settings.model)
        : node.data.task.settings.model || models?.image[0]?.id || "";
      if (!imageModel) {
        setActionMessage(text("workspaceFollowup.m8b9e2720d908"));
        return false;
      }
      if (node.data.task.preset === "characterSheet" && !getCanvasImageModelParams(imageModel).aspectRatios.some((option) => option.value === "16:9" && !option.disabled)) {
        setActionMessage(text("workspaceFollowup.m208407f944b9"));
        return false;
      }
      const settings = {
        ...node.data.task.settings,
        model: imageModel,
        aspectRatio: node.data.task.preset === "characterSheet" ? "16:9" : node.data.task.settings.aspectRatio,
        count: getCanvasImageRequestCount(imageModel, node.data.task.settings.count),
      };
      const batch = createImageTaskBatch(settings, Date.now(), (prefix) => id(prefix));
      updateData(nodeId, (data) => data.kind === "imageTask" ? { ...data, task: { ...data.task, settings, batches: [...data.task.batches, batch] } } : data);
      const results = await Promise.all(batch.outputs.map((output) => runImageOutput(nodeId, batch.id, output.id, undefined, extraPrompt)));
      return results.every(Boolean);
    }
    if (node.data.kind === "videoTask" && node.data.subtitleRemoval) { setActionMessage(text("workspaceFollowup.m7188dbfb8acf")); return false; }
    if (node.data.kind === "videoTask") return runVideoNode(nodeId, undefined, extraPrompt);
    if (node.data.kind === "audioTask") return runAudioNode(nodeId, extraPrompt);
    if (node.data.kind === "llm") return runLlmNode(nodeId, extraPrompt);
    return true;
  }, [readOnly, hasPendingTaskUploads, models, runAudioNode, runImageOutput, runLlmNode, runVideoNode, updateData]);

  const generateAngle = React.useCallback((sourceId: string, url: string, angle: ImageAngle, generationSettings?: AngleGenerationSettings) => {
    if (readOnly) return;
    const source = documentRef.current.nodes.find(node => node.id === sourceId);
    const defaults = createNodeData("imageTask");
    if (defaults.kind !== "imageTask") throw new Error("无法创建图片任务");
    const inherited = source?.data.kind === "imageTask" ? source.data.task.settings : defaults.task.settings;
    const settings = { ...inherited, ...generationSettings, customSize: undefined };
    const model = settings.model || models?.image[0]?.id;
    if (!model || !models?.image.some(candidate => candidate.id === model)) throw new Error("请先在图片节点选择可用的图生图模型。");
    const nodeId = id("imageTask");
    const next = createCanvasAngleTask(documentRef.current, { sourceId, url, angle, prompt: generationSettings?.prompt, settings: { ...settings, model }, nodeId, edgeId: id("edge") });
    commit(next);
    setSelectedIds([nodeId]);
    setOpenTaskPanelNodeId(nodeId);
    void runNode(nodeId);
  }, [readOnly, commit, createNodeData, models, runNode]);

  const createCharacterSheet = React.useCallback((sourceId: string, url: string) => {
    if (readOnly) return;
    try {
      const source = documentRef.current.nodes.find((node) => node.id === sourceId);
      const defaults = createNodeData("imageTask");
      if (defaults.kind !== "imageTask") throw new Error("无法创建图片任务");
      const inherited = source?.data.kind === "imageTask" ? source.data.task.settings : defaults.task.settings;
      const available = models?.image.filter((model) => model.params.aspectRatios.some((option) => option.value === "16:9" && !option.disabled)) || [];
      const model = available.find((item) => item.id === inherited.model) || available[0];
      if (!model) throw new Error("暂无支持 16:9 的图片模型");
      const base = { ...defaults, task: { ...defaults.task, settings: { ...inherited, aspectRatio: "16:9" } } };
      const settings = carryCanvasImageTaskSettingsToModel(base, model.id, model.params).task.settings;
      const nodeId = id("imageTask");
      const next = createCanvasCharacterSheetTask(documentRef.current, { sourceId, url, settings, nodeId, edgeId: id("edge") });
      commit(next);
      setSelectedIds([nodeId]);
      setOpenTaskPanelNodeId(nodeId);
    } catch (reason) {
      setActionMessage(reason instanceof Error ? reason.message : text("workspaceFollowup.m67c99767c2e4"));
    }
  }, [readOnly, commit, createNodeData, models]);

  const cancelNode = React.useCallback((nodeId: string) => {
    if (readOnly) return;
    const target = documentRef.current.nodes.find(node => node.id === nodeId);
    const serverRunId = [...activeServerRuns.current].find(([, nodeIds]) => nodeIds.includes(nodeId))?.[0];
    if (target?.data.kind === "videoTask" && target.data.subtitleRemoval && serverRunId) {
      void fetch(`/api/canvas/runs/${serverRunId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) }).then(response => { if (!response.ok) throw new Error("取消失败"); }).catch(() => setActionMessage(text("workspaceFollowup.m0d9508c570ad")));
    }
    cancelledNodeIdsRef.current.add(nodeId);
    llmAbortControllersRef.current.get(nodeId)?.abort();
    audioAbortControllersRef.current.get(nodeId)?.abort();
    updateData(nodeId, (data) => {
      if (data.kind === "imageTask") {
        const finishedAt = Date.now();
        return {
          ...data,
          task: {
            ...data.task,
            batches: data.task.batches.map((batch) => ({
              ...batch,
              outputs: batch.outputs.map((output) => (
                output.status === "submitting" || output.status === "running"
                  ? { ...output, status: "cancelled" as const, finishedAt, error: undefined }
                  : output
              )),
            })),
          },
        };
      }
      if (data.kind === "videoTask") {
        return { ...data, status: "cancelled", finishedAt: Date.now(), error: undefined };
      }
      if (data.kind === "audioTask") {
        return { ...data, status: "cancelled", finishedAt: Date.now(), error: undefined };
      }
      if (data.kind === "llm") {
        return { ...data, status: "cancelled", error: undefined };
      }
      return data;
    }, "replace");
    setActionMessage(text("workspaceFollowup.m6f96c2add214"));
  }, [readOnly, updateData]);

  const retryImageOutput = React.useCallback((nodeId: string, batchId: string, outputId: string) => {
    if (readOnly) return;
    if (hasPendingTaskUploads(nodeId)) {
      setActionMessage(text("workspaceFollowup.m5d4e03b3b835"));
      return;
    }
    cancelledNodeIdsRef.current.delete(nodeId);
    updateImageOutput(nodeId, batchId, outputId, { status: "idle", startedAt: undefined, finishedAt: undefined, requestKey: createBrowserUuid(), error: undefined, generationId: undefined, url: undefined });
    void runImageOutput(nodeId, batchId, outputId);
  }, [readOnly, hasPendingTaskUploads, runImageOutput, updateImageOutput]);

  React.useEffect(() => {
    if (readOnly) return;
    for (const node of documentRef.current.nodes) {
      if (node.data.kind === "imageTask") {
        for (const batch of node.data.task.batches) for (const output of batch.outputs) {
          if (output.status === "submitting" && !output.generationId && !output.requestKey) {
            updateImageOutput(node.id, batch.id, output.id, {
              status: "failed",
              finishedAt: Date.now(),
              error: "旧任务缺少防重复标识，已停止等待，请重新生成",
            });
          } else if (output.status === "submitting" && output.requestKey && !output.generationId) {
            void runImageOutput(node.id, batch.id, output.id);
          } else if (shouldResumeCanvasGeneration({
            status: output.status,
            generationId: output.generationId,
            error: output.error,
          })) {
            void runImageOutput(node.id, batch.id, output.id, output.generationId);
          }
        }
      }
      if (node.data.kind === "videoTask" && node.data.status === "success" && node.data.outputUrl && node.data.error === "生成超时") {
        updateData(node.id, (data) => data.kind === "videoTask" ? { ...data, error: undefined } : data, "replace");
      } else if (node.data.kind === "videoTask" && node.data.status === "submitting" && !node.data.generationId && !node.data.requestKey) {
        updateData(node.id, (data) => data.kind === "videoTask" ? {
          ...data,
          status: "failed",
          finishedAt: Date.now(),
          error: "旧任务缺少防重复标识，已停止等待，请重新生成",
        } : data, "replace");
      } else if (node.data.kind === "videoTask" && node.data.status === "submitting" && node.data.requestKey && !node.data.generationId) {
        void runVideoNode(node.id);
      } else if (node.data.kind === "videoTask" && shouldResumeCanvasGeneration({
        status: node.data.status,
        generationId: node.data.generationId,
        error: node.data.error,
      })) {
        void runVideoNode(node.id, node.data.generationId);
      } else if (node.data.kind === "audioTask" && node.data.status === "submitting" && node.data.requestKey && !node.data.generationId) {
        void runAudioNode(node.id);
      } else if (node.data.kind === "audioTask" && isSunoModel(node.data.model) && shouldResumeCanvasGeneration(node.data)) {
        void runAudioNode(node.id, "", node.data.generationId);
      } else if (node.data.kind === "audioTask" && (node.data.status === "submitting" || node.data.status === "running")) {
        updateData(node.id, (data) => data.kind === "audioTask" ? {
          ...data,
          status: "failed",
          finishedAt: Date.now(),
          error: "音频任务状态已中断，请重新生成",
        } : data, "replace");
      }
    }
  }, [readOnly, runAudioNode, runImageOutput, runVideoNode, updateData, updateImageOutput]);

  const mediaItemsForNode = React.useCallback((nodeId: string): CanvasPreviewItem[] => {
    const source = documentRef.current.nodes.find((node) => node.id === nodeId);
    if (!source) return [];
    if (source.data.kind === "image" || source.data.kind === "video" || source.data.kind === "audio") {
      return [{ id: source.id, url: source.data.url, kind: source.data.kind, name: getCanvasMediaNodeName(documentRef.current, source.id), prompt: source.data.prompt, model: source.data.model, sourceNodeId: source.id }];
    }
    if (source.data.kind === "videoTask" && source.data.outputUrl) {
      return [{ id: `${source.id}:output`, url: source.data.outputUrl, kind: "video", name: getCanvasTaskGeneratedMediaName(documentRef.current, source.id, source.data.outputUrl, "video"), prompt: source.data.prompt, model: source.data.model, sourceNodeId: source.id }];
    }
    if (source.data.kind === "audioTask" && source.data.outputUrl) {
      return [{ id: `${source.id}:output`, url: source.data.outputUrl, kind: "audio", name: getCanvasTaskGeneratedMediaName(documentRef.current, source.id, source.data.outputUrl, "audio"), prompt: source.data.prompt, model: source.data.model, sourceNodeId: source.id }];
    }
    if (source.data.kind === "imageTask") {
      return source.data.task.batches.flatMap((batch) => batch.outputs.flatMap((output) => output.url ? [{ id: `${source.id}:${batch.id}:${output.id}`, url: output.url, kind: "image" as const, name: getCanvasImageOutputName(documentRef.current, source.id, batch.id, output.id), prompt: batch.settings.prompt, model: batch.settings.model, sourceNodeId: source.id, batchId: batch.id, outputId: output.id }] : []));
    }
    if (source.data.kind === "group") {
      return documentRef.current.nodes.filter((node) => node.parentId === source.id).flatMap((node) => mediaItemsForNode(node.id));
    }
    return [];
  }, []);

  const openSaveToLibrary = React.useCallback((items: CanvasPreviewItem[]) => {
    if (readOnly) return;
    const seen = new Set<string>();
    const unique = items.filter(item => {
      const key = `${item.sourceNodeId ?? ""}:${item.id}:${item.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!unique.length) { setActionMessage(text("workspaceFollowup.mfe8830672457")); return; }
    setLibrarySaveItems(unique);
  }, [readOnly]);

  const previewMedia = React.useCallback((nodeId: string, itemId?: string, scopeBatchId?: string) => {
    const items = mediaItemsForNode(nodeId).filter((item) => !scopeBatchId || item.batchId === scopeBatchId);
    if (!items.length) { setActionMessage(text("workspaceFollowup.m9ab4ec23cffa")); return; }
    const node = documentRef.current.nodes.find(candidate => candidate.id === nodeId);
    const primary = node?.data.kind === "imageTask" ? getCanvasPrimaryImageOutput(node.data.task.batches.at(-1)) : undefined;
    const index = Math.max(0, items.findIndex(item => itemId ? item.id === itemId : item.outputId === primary?.id));
    setPreview({ items, index });
  }, [mediaItemsForNode]);

  const downloadPreviewItem = React.useCallback(async (item: CanvasPreviewItem) => {
    const response = await fetch(item.url);
    if (!response.ok) throw new Error("媒体下载失败");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = getCanvasMediaDownloadName(item, blob.type);
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }, []);

  const downloadGroupItems = React.useCallback(async (items: CanvasPreviewItem[], archiveName: string) => {
    const seen = new Set<string>();
    const currentItems = items.filter(item => {
      const source = documentRef.current.nodes.find(node => node.id === item.sourceNodeId);
      if (source?.data.kind === "imageTask") {
        const batch = source.data.task.batches.at(-1);
        if (item.batchId !== batch?.id || !batch?.outputs.some(output => output.id === item.outputId && output.status === "success" && output.url === item.url)) return false;
      }
      const key = `${item.sourceNodeId ?? ""}:${item.id}:${item.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!currentItems.length) throw new Error("分组中没有可下载的媒体");
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const files: { filename: string; blob: Blob }[] = [];
    const filenameCounts = new Map<string, number>();
    for (let index = 0; index < currentItems.length; index += 1) {
      const item = currentItems[index];
      const response = await fetch(item.url);
      if (!response.ok) throw new Error(`第 ${index + 1} 个媒体下载失败`);
      const blob = await response.blob();
      const filename = getCanvasMediaDownloadName({ ...item, name: item.name || `media-${index + 1}` }, blob.type).replace(/[\\/]/g, "_");
      files.push({ filename, blob });
      filenameCounts.set(filename, (filenameCounts.get(filename) ?? 0) + 1);
    }
    files.forEach(({ filename, blob }, index) => {
      // Keep the node name intact even when different current results share it.
      zip.file(filenameCounts.get(filename)! > 1 ? `${index + 1}/${filename}` : filename, blob);
    });
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${archiveName.replace(/[\\/]/g, "_")}.zip`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }, []);

  const selectedMediaItems = React.useMemo(() => {
    const seen = new Set<string>();
    return selectedIds.flatMap(mediaItemsForNode).filter(item => {
      const key = `${item.sourceNodeId ?? ""}:${item.id}:${item.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [document.nodes, mediaItemsForNode, selectedIds]);

  // 画布上选中的已完成视频，按位置从左到右（同一列从上到下）排序，作为合成顺序
  const selectedVideoNodeIds = React.useMemo(() => document.nodes
    .filter(node => selectedIds.includes(node.id) && (node.data.kind === "video" || node.data.kind === "videoTask" && node.data.status === "success" && Boolean(node.data.outputUrl)))
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
    .map(node => node.id), [document.nodes, selectedIds]);
  const [composingVideos, setComposingVideos] = React.useState(false);
  const composeSelectedVideos = React.useCallback(async () => {
    if (readOnly || composingVideos || selectedVideoNodeIds.length < 2) return;
    const nodeIds = [...selectedVideoNodeIds];
    setComposingVideos(true);
    setActionMessage(text("workspaceFollowup.m6b0ff5a311b0", { v0: nodeIds.length }));
    try {
      const response = await fetch("/api/canvas/compose-video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ canvasId, nodeIds }) });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "合成失败，请稍后重试");
      const seconds = Number(response.headers.get("X-Composed-Duration")) || undefined;
      const width = Number(response.headers.get("X-Composed-Width")) || undefined, height = Number(response.headers.get("X-Composed-Height")) || undefined;
      const name = `合成视频 ${nodeIds.length} 段`;
      const payload = await uploadCanvasMedia(new File([await response.blob()], `${name}.mp4`, { type: "video/mp4" }));
      addGeneratedMedia(nodeIds[nodeIds.length - 1], "video", payload.url, `video-compose-${createBrowserUuid()}`, name, true, {
        mediaId: payload.mediaId, durationSeconds: seconds,
        variants: { ...payload.variants, original: { ...payload.variants?.original, url: payload.url, width, height } },
      });
      setActionMessage(text("workspaceFollowup.m0be639a9802d", { v0: nodeIds.length, v1: seconds ? text("workspaceFollowup.ma019a8a1bcd2", { v0: seconds.toFixed(1) }) : "" }));
    } catch (error) {
      setActionMessage(String((error as Error)?.message || error));
    } finally {
      setComposingVideos(false);
    }
  }, [readOnly, composingVideos, selectedVideoNodeIds, canvasId, addGeneratedMedia]);

  const downloadSelectedMedia = React.useCallback(() => {
    void downloadGroupItems(selectedMediaItems, `canvas-selection-${Date.now()}`)
      .catch(error => setActionMessage(String((error as Error)?.message || error)));
  }, [downloadGroupItems, selectedMediaItems]);

  const createGroupGrid = React.useCallback(async (groupId: string) => {
    if (readOnly) return;
    const items = mediaItemsForNode(groupId).filter((item) => item.kind === "image");
    if (items.length < 2) throw new Error("分组至少需要两张图片才能宫格拼接");
    const images = await Promise.all(items.map((item) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("分组图片加载失败"));
      image.src = item.url;
    })));
    const columns = Math.ceil(Math.sqrt(images.length));
    const rows = Math.ceil(images.length / columns);
    const cell = 512;
    const canvas = window.document.createElement("canvas");
    canvas.width = columns * cell;
    canvas.height = rows * cell;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    images.forEach((image, index) => {
      const scale = Math.min(cell / image.naturalWidth, cell / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      const x = (index % columns) * cell + (cell - width) / 2;
      const y = Math.floor(index / columns) * cell + (cell - height) / 2;
      context.drawImage(image, x, y, width, height);
    });
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("宫格拼接失败")), "image/png"));
    const payload = await uploadCanvasMedia(new File([blob], `grid-${Date.now()}.png`, { type: "image/png" }));
    addGeneratedMedia(groupId, "image", payload.url, `group-grid-${groupId}-${Date.now()}`);
    setActionMessage(text("workspaceFollowup.m1da27935688f"));
  }, [readOnly, addGeneratedMedia, mediaItemsForNode]);

  const groupAction = React.useCallback((groupId: string, action: "toggle" | "arrange" | "fit" | "preview" | "grid" | "download" | "ungroup", layout: CanvasGroupLayout = "tidy") => {
    if (action === "fit") { commit({ ...documentRef.current, nodes: fitCanvasGroupBounds(documentRef.current.nodes, [groupId], true) }); return; }
    if (action === "toggle") {
      const next = toggleGroupCollapsed(documentRef.current, groupId);
      if (readOnly) { documentRef.current = next; setDocument(next); } else commit(next);
      return;
    }
    if (action === "arrange") { commit(arrangeGroupChildren(documentRef.current, groupId, layout)); return; }
    if (action === "preview") { previewMedia(groupId); return; }
    if (action === "ungroup") { commit(ungroupSelection(documentRef.current, groupId)); setSelectedIds([]); wrapRef.current?.focus({ preventScroll: true }); return; }
    if (action === "grid") {
      setActionMessage(text("workspaceFollowup.m3c8defb1766b"));
      void createGroupGrid(groupId).catch((error) => setActionMessage(String((error as Error)?.message || error)));
      return;
    }
    setActionMessage(text("workspaceFollowup.md2bd4447ecf1"));
    const group = documentRef.current.nodes.find(node => node.id === groupId);
    const groupName = group?.data.kind === "group" ? group.data.title.trim() || "分组" : "分组";
    void downloadGroupItems(mediaItemsForNode(groupId), groupName)
      .then(() => setActionMessage(text("workspaceFollowup.mf6440059efd7")))
      .catch((error) => setActionMessage(String((error as Error)?.message || error)));
  }, [readOnly, commit, createGroupGrid, downloadGroupItems, mediaItemsForNode, previewMedia]);

  const applyTemplate = React.useCallback((content: string) => {
    if (!templateNodeId) return;
    updateData(templateNodeId, (data) => {
      if (data.kind === "prompt") return { ...data, text: content };
      if (data.kind === "imageTask") return { ...data, task: { ...data.task, settings: { ...data.task.settings, prompt: content } } };
      if (data.kind === "videoTask") return { ...data, prompt: content };
      if (data.kind === "llm") return { ...data, prompt: content };
      return data;
    });
    setTemplateNodeId(null);
  }, [templateNodeId, updateData]);

  const addEditedImages = React.useCallback(async (sourceId: string, urls: string[], mode: "preview" | "crop" | "brush" | "mask" | "outpaint" | "grid", outpaintFile?: File, outpaintSize?: { width: number; height: number }, media?: CanvasMediaIdentity[]) => {
    if (readOnly) return;
    if (mode === "crop") {
      if (!outpaintFile) {
        setActionMessage(text("workspaceFollowup.m029e2e7df0e1"));
        return;
      }
      const current = documentRef.current;
      const source = current.nodes.find((node) => node.id === sourceId);
      const position = source?.position || { x: 0, y: 0 };
      const cropFile = outpaintFile;
      const cropDisplaySize = outpaintSize
        ? getCanvasMediaNodeSize(outpaintSize.width, outpaintSize.height)
        : undefined;
      void uploadFiles(
        [cropFile],
        position,
        [CANVAS_IMAGE_EDIT_LABELS.crop],
        true,
        sourceId,
        cropDisplaySize ? [cropDisplaySize] : undefined,
      );
      return;
    }

    if (mode === "outpaint") {
      if (!outpaintFile || !outpaintSize) {
        setActionMessage(text("workspaceFollowup.m686416301317"));
        return;
      }
      const current = documentRef.current;
      const source = current.nodes.find((node) => node.id === sourceId);
      const preferredTask = defaultData("imageTask", taskPreferencesRef.current);
      if (preferredTask.kind !== "imageTask") return;
      const settings = {
        ...preferredTask.task.settings,
        model: preferredTask.task.settings.model || models?.image[0]?.id || "",
        prompt: "",
        count: 1,
      };
      const imageNodeId = id("image");
      const taskNodeId = id("imageTask");
      const referenceId = id("reference");
      const objectUrl = URL.createObjectURL(outpaintFile);
      pendingUploadUrlsRef.current.set(imageNodeId, objectUrl);
      pendingUploadUrlsRef.current.set(taskNodeId, objectUrl);
      const imageSize = getCanvasMediaNodeSize(outpaintSize.width, outpaintSize.height);
      const imageNode: CanvasNode = {
        id: imageNodeId,
        type: "image",
        position: {
          x: (source?.position.x || 0) + (source?.width || 280) + 120,
          y: source?.position.y || 0,
        },
        data: { kind: "image", url: objectUrl, name: CANVAS_IMAGE_EDIT_LABELS.outpaint, origin: "generated", localPreview: true },
        width: imageSize.width,
        height: imageSize.height,
      };
      const taskData: CanvasNodeData = {
        kind: "imageTask",
        task: {
          references: [{
            id: referenceId,
            url: objectUrl,
            name: CANVAS_IMAGE_EDIT_LABELS.outpaint,
            width: outpaintSize.width,
            height: outpaintSize.height,
          }],
          settings,
          batches: [],
        },
      };
      const taskSize = getCanvasTaskResultFrameSize(taskData);
      const taskNode: CanvasNode = {
        id: taskNodeId,
        type: "imageTask",
        position: {
          x: imageNode.position.x + (imageNode.width || 280) + 120,
          y: imageNode.position.y,
        },
        data: taskData,
        width: taskSize.width,
        height: taskSize.height,
      };
      derivedSourceByNodeIdRef.current.set(imageNodeId, sourceId);
      derivedSourceByNodeIdRef.current.set(taskNodeId, imageNodeId);
      const laidOut = reflowTrackedDerivedBranch(
        [...current.nodes, imageNode, taskNode],
        sourceId,
        derivedSourceByNodeIdRef.current,
      );
      commit({
        ...current,
        nodes: laidOut.nodes,
        edges: addEdge({
          id: id("edge"),
          source: imageNodeId,
          target: taskNodeId,
          type: "default",
        }, current.edges),
      });
      revealDerivedNodes(sourceId, [imageNodeId, taskNodeId]);
      setSelectedIds([taskNodeId]);
      setOpenTaskPanelNodeId(taskNodeId);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (!documentRef.current.nodes.some((node) => node.id === taskNodeId)) return;
          setSelectedIds([taskNodeId]);
          setOpenTaskPanelNodeId(taskNodeId);
        });
      });
      setActionMessage(text("workspaceFollowup.m52a7b8fd4978"));

      void (async () => {
        try {
          const payload = await uploadCanvasMedia(outpaintFile);
          if (pendingUploadUrlsRef.current.get(imageNodeId) !== objectUrl) return;
          settleUpload(imageNodeId, objectUrl, { status: "success", kind: "image", url: payload.url, mediaId: payload.mediaId, variants: payload.variants });
          setActionMessage(text("workspaceFollowup.mfa1b3fe0e716"));
        } catch (error) {
          if (pendingUploadUrlsRef.current.get(imageNodeId) !== objectUrl) return;
          derivedSourceByNodeIdRef.current.delete(imageNodeId);
          derivedSourceByNodeIdRef.current.delete(taskNodeId);
          settleUpload(imageNodeId, objectUrl, { status: "failed" });
          setOpenTaskPanelNodeId((currentNodeId) => currentNodeId === taskNodeId ? null : currentNodeId);
          setActionMessage(text("workspaceFollowup.m4584de3eb8ed", { v0: uiError(error) }));
        } finally {
          if (pendingUploadUrlsRef.current.get(imageNodeId) === objectUrl) {
            pendingUploadUrlsRef.current.delete(imageNodeId);
            pendingUploadUrlsRef.current.delete(taskNodeId);
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
          }
        }
      })();
      return;
    }
    const createdNodeIds = urls
      .map((url, index) => addGeneratedMedia(
        sourceId,
        "image",
        url,
        `edited-${sourceId}-${Date.now()}-${index}`,
        CANVAS_IMAGE_EDIT_LABELS[mode],
        false,
        media?.[index],
      ))
      .filter((nodeId): nodeId is string => Boolean(nodeId));
    if (createdNodeIds.length) revealDerivedNodes(sourceId, createdNodeIds);
  }, [readOnly, addGeneratedMedia, commit, models?.image, revealDerivedNodes, settleUpload, uploadFiles]);

  const exportVideoFrame = React.useCallback(async (nodeId: string, frame: CapturedVideoFrame, mode: VideoFrameMode, sourceUrl: string) => {
    if (readOnly) return;
    const node = documentRef.current.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || (node.data.kind !== "video" && node.data.kind !== "videoTask")) return;
    if ((node.data.kind === "video" ? node.data.url : node.data.outputUrl) !== sourceUrl) return;
    const payload = await uploadCanvasMedia(frame.file);
    const current = documentRef.current.nodes.find((candidate) => candidate.id === nodeId);
    const currentUrl = current?.data.kind === "video" ? current.data.url : current?.data.kind === "videoTask" ? current.data.outputUrl : undefined;
    if (!sourceUrl || currentUrl !== sourceUrl) return;
    addGeneratedMedia(nodeId, "image", payload.url, `video-frame-${nodeId}-${createBrowserUuid()}`, videoFrameNodeName(mode, frame.time), true, {
      mediaId: payload.mediaId,
      variants: { ...payload.variants, original: { ...payload.variants?.original, url: payload.url, width: frame.width, height: frame.height } },
    });
    setActionMessage(text("workspaceFollowup.m4ce0112f38bd", { v0: VIDEO_FRAME_LABELS[mode] }));
  }, [readOnly, addGeneratedMedia]);

  const exportVideoClip = React.useCallback(async (nodeId: string, clip: CanvasVideoClip, sourceUrl: string, operation?: "crop") => {
    if (readOnly) throw new Error("只读画布不能截取视频");
    const sourceMatches = () => {
      const node = documentRef.current.nodes.find(candidate => candidate.id === nodeId);
      return node?.data.kind === "video" ? node.data.url === sourceUrl : node?.data.kind === "videoTask" && node.data.outputUrl === sourceUrl;
    };
    if (!sourceMatches()) throw new Error("原视频已变更，请重新截取");
    const name = getCanvasVideoClipName(getCanvasMediaNodeName(documentRef.current, nodeId)
      || getCanvasTaskGeneratedMediaName(documentRef.current, nodeId, sourceUrl, "video") || "视频", operation);
    const payload = await uploadCanvasMedia(new File([clip.blob], `${name}.mp4`, { type: "video/mp4" }));
    if (!sourceMatches()) throw new Error("原视频已变更，请重新截取");
    addGeneratedMedia(nodeId, "video", payload.url, `video-clip-${createBrowserUuid()}`, name, true, {
      mediaId: payload.mediaId, durationSeconds: clip.durationSeconds,
      variants: { ...payload.variants, original: { ...payload.variants?.original, url: payload.url, width: clip.width, height: clip.height } },
    });
    setActionMessage(operation === "crop" ? text("workspaceFollowup.m4da0bc0aa3ad") : text("workspaceFollowup.m937ad21fd3b6"));
  }, [readOnly, addGeneratedMedia]);

  const separateVideo = React.useCallback(async (nodeId: string, sourceUrl: string, onProgress?: (progress: number) => void, signal?: AbortSignal, mode: CanvasVideoSeparationMode = "tracks") => {
    if (readOnly) throw new Error("只读画布不能分离音视频");
    if (videoSeparationLocks.current.has(nodeId)) throw new Error("该视频正在分离中");
    videoSeparationLocks.current.add(nodeId);
    const reportProgress = (progress: number) => {
      setVideoSeparationJobs(jobs => ({ ...jobs, [nodeId]: { mode, status: "running", progress } }));
      onProgress?.(progress);
    };
    reportProgress(0);
    try {
      const checkSource = () => {
        signal?.throwIfAborted();
        const node = documentRef.current.nodes.find(candidate => candidate.id === nodeId);
        const url = node?.data.kind === "video" ? node.data.url : node?.data.kind === "videoTask" ? node.data.outputUrl : undefined;
        if (!sourceUrl || url !== sourceUrl) throw new Error("原视频已变更，请重新分离");
      };
      checkSource();
      const result = await separateCanvasVideo(sourceUrl, progress => reportProgress(progress * (mode === "tracks" ? .8 : .35)), signal);
      checkSource();
      if (mode !== "tracks") {
        if (result.durationSeconds > 300) throw new Error("人声和背景音提取暂支持 5 分钟以内的视频");
        result.audio = await extractCanvasVideoAudio(result.audio, mode, signal);
        checkSource(); reportProgress(.8);
      }
      const names = getCanvasVideoSeparationNames(getCanvasMediaNodeName(documentRef.current, nodeId)
        || getCanvasTaskGeneratedMediaName(documentRef.current, nodeId, sourceUrl, "video") || "视频", mode);
      const audio = await uploadCanvasMedia(new File([result.audio], `${names.audio}.${mode === "tracks" ? "m4a" : "wav"}`, { type: mode === "tracks" ? "audio/mp4" : "audio/wav" }));
      checkSource(); reportProgress(.9);
      const video = await uploadCanvasMedia(new File([result.video], `${names.video}.mp4`, { type: "video/mp4" }));
      checkSource();
      // Both uploads must succeed before either result becomes part of the document/history.
      const current = documentRef.current;
      const source = current.nodes.find(node => node.id === nodeId)!;
      const audioId = id("audio"), videoId = id("video");
      const added: CanvasNode[] = [
        { id: audioId, type: "audio", position: { ...source.position }, ...DEFAULT_CANVAS_AUDIO_NODE_SIZE,
          data: { kind: "audio", origin: "generated", name: names.audio, url: audio.url, mediaId: audio.mediaId, variants: audio.variants, durationSeconds: result.durationSeconds } },
        { id: videoId, type: "video", position: { ...source.position }, ...getCanvasMediaNodeSize(result.width, result.height),
          data: { kind: "video", origin: "generated", name: names.video, url: video.url, mediaId: video.mediaId,
            variants: { ...video.variants, original: { ...video.variants?.original, url: video.url, width: result.width, height: result.height } } } },
      ];
      for (const node of added) derivedSourceByNodeIdRef.current.set(node.id, nodeId);
      const laidOut = reflowTrackedDerivedBranch([...current.nodes, ...added], nodeId, derivedSourceByNodeIdRef.current);
      commit({ ...current, nodes: laidOut.nodes, edges: [...current.edges, ...added.map(node => ({ id: id("edge"), source: nodeId, target: node.id, type: "default" as const }))] });
      reportProgress(1);
      setVideoSeparationJobs(jobs => ({ ...jobs, [nodeId]: { mode, status: "success", progress: 1 } }));
      revealDerivedNodes(nodeId, [audioId, videoId]);
      setActionMessage(text("workspaceFollowup.m52588fcee15a", { v0: mode === "vocals" ? text("workspaceFollowup.m1f270ddf1563") : mode === "background" ? text("workspaceFollowup.m6b1edb2bbe07") : text("workspaceFollowup.mb6dd16ff52eb") }));
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : "音视频分离失败，请重试";
      setVideoSeparationJobs(jobs => ({ ...jobs, [nodeId]: { mode, status: "error", progress: 0, error } }));
      setActionMessage(error);
      throw reason;
    } finally { videoSeparationLocks.current.delete(nodeId); }
  }, [readOnly, commit, revealDerivedNodes]);

  const exportAudioClip = React.useCallback(async (nodeId: string, clip: CanvasAudioClip, sourceUrl: string, speed?: number) => {
    if (readOnly) throw new Error("只读画布不能处理音频");
    const sourceMatches = () => {
      const node = documentRef.current.nodes.find(candidate => candidate.id === nodeId);
      return node?.data.kind === "audio" ? node.data.url === sourceUrl : node?.data.kind === "audioTask" && node.data.outputUrl === sourceUrl;
    };
    if (!sourceMatches()) throw new Error("原音频已变更，请重新处理");
    const sourceName = getCanvasMediaNodeName(documentRef.current, nodeId)
      || getCanvasTaskGeneratedMediaName(documentRef.current, nodeId, sourceUrl, "audio") || "音频";
    const name = speed === undefined ? getCanvasAudioClipName(sourceName) : getCanvasAudioSpeedName(sourceName, speed);
    const payload = await uploadCanvasMedia(new File([clip.blob], `${name}.wav`, { type: "audio/wav" }));
    if (!sourceMatches()) throw new Error("原音频已变更，请重新处理");
    addGeneratedMedia(nodeId, "audio", payload.url, `audio-clip-${createBrowserUuid()}`, name, true, {
      mediaId: payload.mediaId, variants: payload.variants,
      waveformPeaks: clip.waveformPeaks, durationSeconds: clip.durationSeconds,
    });
    setActionMessage(speed === undefined ? text("workspaceFollowup.m14b19d661b03") : text("workspaceFollowup.m25c60e59b76d"));
  }, [readOnly, addGeneratedMedia]);

  const startWorkflow = React.useCallback(async (target: ExecutionScope, explicitNodeIds?: string[]) => {
    if (readOnly) return false;
    const plan = explicitNodeIds?.length ? explicitNodeIds : buildExecutionPlan(documentRef.current, target);
    if (!plan.length) return false;
    const node = plan.length === 1 ? documentRef.current.nodes.find(node => node.id === plan[0]) : undefined;
    const independentSubtitle = target.scope === "single" && node?.data.kind === "videoTask" && Boolean(node.data.subtitleRemoval);
    if (activeServerRuns.current.size && !independentSubtitle) return false;
    cancelRequested.current = false;
    let expectedRevision: string;
    try {
      expectedRevision = await flushBeforeServerRun();
    } catch (error) {
      setActionMessage(String((error as Error)?.message || error));
      return false;
    }
    const response = await fetch(`/api/canvas/${canvasId}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Canvas-Session-Id": editorSessionId },
      body: JSON.stringify({ scope: target.scope, nodeIds: plan, expectedRevision, clientRequestId: createBrowserUuid() }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success || !payload.run?.id) {
      setActionMessage(payload?.error || text("workspaceFollowup.m5a5e92a05396"));
      return false;
    }
    if (payload.executionMode !== "server") {
      setActionMessage(text("workspaceFollowup.m79c7cc2488d5"));
      return false;
    }
    const runId = Number(payload.run.id);
    activeServerRuns.current.set(runId, plan);
    const state: RunRecord["state"] = {
      scope: target.scope,
      nodeIds: plan,
      nodes: Object.fromEntries(plan.map((nodeId) => [nodeId, { status: "queued" }])),
      logs: [{ at: new Date().toISOString(), message: `开始 ${target.scope} 运行，共 ${plan.length} 个节点` }],
    };
    setRuns((current) => [{ ...payload.run, state }, ...current]);
    void pollServerRunRef.current(runId);
    return true;
  }, [readOnly, canvasId, editorSessionId, flushBeforeServerRun]);

  const removeVideoSubtitles = React.useCallback(async (nodeId: string, sourceUrl: string, options: SubtitleRemovalOptions, size: { width: number; height: number }) => {
    if (readOnly) throw new Error("只读画布不能去字幕");
    const current = documentRef.current;
    const source = current.nodes.find(node => node.id === nodeId);
    const url = source?.data.kind === "video" ? source.data.url : source?.data.kind === "videoTask" ? source.data.outputUrl : undefined;
    if (!source || url !== sourceUrl) throw new Error("原视频已变更，请重新选择");
    const name = getCanvasMediaNodeName(current, nodeId) || getCanvasTaskGeneratedMediaName(current, nodeId, sourceUrl, "video") || "视频";
    const result = createSubtitleRemovalNode(id("videoTask"), `${name}_去字幕`, sourceUrl, size, options);
    result.position = { ...source.position };
    derivedSourceByNodeIdRef.current.set(result.id, nodeId);
    const layout = reflowTrackedDerivedBranch([...current.nodes, result], nodeId, derivedSourceByNodeIdRef.current);
    commit({ ...current, nodes: layout.nodes, edges: [...current.edges, { id: id("edge"), source: nodeId, target: result.id, type: "default" }] });
    revealDerivedNodes(nodeId, [result.id]);
    try {
      if (!await startWorkflow({ scope: "single", nodeId: result.id }, [result.id])) throw new Error("去字幕任务未能启动，请检查画布执行器后重试");
      // Cancellation can happen while the initial save / queue request is pending.
      const latest = documentRef.current.nodes.find(node => node.id === result.id);
      if (latest?.data.kind === "videoTask" && latest.data.status === "cancelled") cancelNode(result.id);
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : "去字幕任务启动失败";
      updateData(result.id, data => data.kind === "videoTask" ? { ...data, status: "failed", error, finishedAt: Date.now() } : data);
      throw reason;
    }
  }, [readOnly, commit, revealDerivedNodes, startWorkflow, updateData, cancelNode]);

  // 拉片 ─────────────────────────────────────────────────────────────────────
  const breakdownAbortRef = React.useRef(new Map<string, AbortController>());
  const breakdownModels = React.useMemo(() => listBreakdownModels(models?.chat ?? [])
    .map(model => ({ providerId: model.providerId, modelId: model.modelId, label: model.label || model.modelId })), [models?.chat]);
  /** Lays newly arrived results out on the canvas as documents, stills and segment clips. */
  const materializeBreakdown = React.useCallback((breakdownId: string) => {
    const current = documentRef.current;
    const node = current.nodes.find(item => item.id === breakdownId);
    if (!node || node.data.kind !== "breakdown") return;
    const planned = planBreakdownOutputs(node as CanvasNode & { data: typeof node.data }, kind => id(kind));
    if (!planned) return;
    const nodes = current.nodes.map(item => item.id === breakdownId && item.data.kind === "breakdown" ? { ...item, data: { ...item.data, outputs: planned.outputs } } : item);
    commit({ ...current, nodes: [...nodes, ...planned.nodes], edges: [...current.edges, ...planned.edges] });
  }, [commit]);
  /**
   * Follows a 拉片 background job: starts it when given a model, otherwise reconnects.
   * The job runs on the server, so a refresh or a dropped connection only pauses the view.
   */
  const runBreakdown = React.useCallback(async (breakdownId: string, model?: CanvasBreakdownModel) => {
    const node = documentRef.current.nodes.find(item => item.id === breakdownId);
    if (!node || node.data.kind !== "breakdown") return;
    breakdownAbortRef.current.get(breakdownId)?.abort();
    const controller = new AbortController();
    breakdownAbortRef.current.set(breakdownId, controller);
    let pending: BreakdownEvent[] = [];
    let timer: number | undefined;
    // Results land immediately; bare progress ticks are coalesced so a long
    // analysis does not rewrite a large node every few hundred milliseconds.
    const apply = () => {
      if (timer) window.clearTimeout(timer);
      timer = undefined;
      const events = pending;
      pending = [];
      if (!events.length) return;
      updateData(breakdownId, data => data.kind === "breakdown"
        ? events.reduce((current, event) => applyBreakdownEvent(current, event), data)
        : data, "replace");
      if (events.some(event => event.type !== "stage" && event.type !== "job")) materializeBreakdown(breakdownId);
    };
    const onEvent = (event: BreakdownEvent) => {
      if (event.type === "ping") return;
      pending.push(event);
      if (event.type === "stage") { if (!timer) timer = window.setTimeout(apply, 400); }
      else apply();
    };
    const jobId = () => {
      const current = documentRef.current.nodes.find(item => item.id === breakdownId)?.data;
      return current?.kind === "breakdown" ? current.jobId : undefined;
    };
    const fail = (error: string) => updateData(breakdownId, data => data.kind === "breakdown" && data.status === "running"
      ? applyBreakdownEvent(data, { type: "error", error })
      : data, "replace");
    try {
      let finished = false;
      if (model) {
        finished = await streamCanvasShotBreakdown({
          canvasId, sessionId: editorSessionId, videoUrl: node.data.sourceUrl,
          providerId: model.providerId, modelId: model.modelId, signal: controller.signal, onEvent,
        }).catch(error => { if (controller.signal.aborted || !jobId()) throw error; return false; });
      }
      // Reconnect after a refresh or a dropped connection; the job kept running meanwhile.
      for (let attempt = 0; !finished && attempt < 5; attempt += 1) {
        const id = jobId();
        if (!id || controller.signal.aborted) break;
        if (model || attempt) await new Promise(resolve => window.setTimeout(resolve, 1500 * (attempt + 1)));
        if (controller.signal.aborted) return;
        finished = await followCanvasShotBreakdown({ jobId: id, signal: controller.signal, onEvent }).catch(error => {
          if (error instanceof BreakdownJobGoneError || controller.signal.aborted) throw error;
          return false;
        });
      }
      apply();
      if (!finished && !controller.signal.aborted) fail(jobId() ? "与拉片任务的连接中断，刷新页面即可继续查看进度" : "拉片启动失败，请重新拉片");
    } catch (reason) {
      apply();
      if (controller.signal.aborted) return;
      fail(reason instanceof Error ? reason.message : "拉片失败，请稍后重试");
    } finally {
      if (breakdownAbortRef.current.get(breakdownId) === controller) breakdownAbortRef.current.delete(breakdownId);
    }
  }, [canvasId, editorSessionId, updateData, materializeBreakdown]);
  // Leaving the page stops watching, never the job itself.
  React.useEffect(() => () => { breakdownAbortRef.current.forEach(controller => controller.abort()); }, []);
  // A breakdown still running when the canvas opens is picked up where it is;
  // only runs from before background jobs existed (no job id) are closed.
  React.useEffect(() => {
    if (readOnly) return;
    for (const node of documentRef.current.nodes) {
      if (node.data.kind !== "breakdown" || node.data.status !== "running" || breakdownAbortRef.current.has(node.id)) continue;
      if (node.data.jobId) void runBreakdown(node.id);
      else updateData(node.id, data => data.kind === "breakdown" ? settleAbandonedBreakdown(data) : data, "replace");
    }
    // Only on open: later runs are tracked by breakdownAbortRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const breakdownVideo = React.useCallback((nodeId: string, sourceUrl: string, model?: CanvasBreakdownModel) => {
    if (readOnly) return;
    const chosen = model ?? breakdownModels[0];
    if (!chosen) {
      setActionMessage(text("workspaceFollowup.mb0b985a0aaa2"));
      return;
    }
    const current = documentRef.current;
    const source = current.nodes.find(node => node.id === nodeId);
    const url = source?.data.kind === "video" ? source.data.url : source?.data.kind === "videoTask" ? source.data.outputUrl : undefined;
    if (!source || url !== sourceUrl) { setActionMessage(text("workspaceFollowup.m95551781fdaa")); return; }
    if (sourceUrl.startsWith("blob:")) { setActionMessage(text("workspaceFollowup.mc0f8101e01e4")); return; }
    const name = getCanvasMediaNodeName(current, nodeId) || getCanvasTaskGeneratedMediaName(current, nodeId, sourceUrl, "video") || "视频";
    const node: CanvasNode = {
      id: id("breakdown"),
      type: "breakdown",
      position: { ...source.position },
      ...BREAKDOWN_CARD_SIZE,
      data: createBreakdownData({ sourceNodeId: nodeId, sourceUrl, sourceName: name, providerId: chosen.providerId, model: chosen.modelId }),
    };
    derivedSourceByNodeIdRef.current.set(node.id, nodeId);
    const layout = reflowTrackedDerivedBranch([...current.nodes, node], nodeId, derivedSourceByNodeIdRef.current);
    commit({ ...current, nodes: layout.nodes, edges: [...current.edges, { id: id("edge"), source: nodeId, target: node.id, type: "default" }] });
    revealDerivedNodes(nodeId, [node.id]);
    setSelectedIds([node.id]);
    void runBreakdown(node.id, chosen);
  }, [readOnly, breakdownModels, commit, revealDerivedNodes, runBreakdown]);

  const rerunBreakdown = React.useCallback((breakdownId: string, model: CanvasBreakdownModel) => {
    if (readOnly) return;
    const current = documentRef.current;
    const breakdown = current.nodes.find(node => node.id === breakdownId);
    if (!breakdown || breakdown.data.kind !== "breakdown") return;
    // A re-run replaces the documents, stills and clips the previous run laid out.
    const stale = new Set(breakdownOutputIds(breakdown.data.outputs));
    const data = restartBreakdownData(breakdown.data, { providerId: model.providerId, model: model.modelId });
    commit({
      ...current,
      nodes: current.nodes.filter(node => !stale.has(node.id)).map(node => node.id === breakdownId ? { ...node, ...BREAKDOWN_CARD_SIZE, data } : node),
      edges: current.edges.filter(edge => !stale.has(edge.source) && !stale.has(edge.target)),
    });
    void runBreakdown(breakdownId, model);
  }, [readOnly, runBreakdown, commit]);

  const cancelBreakdown = React.useCallback((breakdownId: string) => {
    const breakdown = documentRef.current.nodes.find(node => node.id === breakdownId)?.data;
    if (breakdown?.kind === "breakdown" && breakdown.jobId) void cancelCanvasShotBreakdown(breakdown.jobId);
    breakdownAbortRef.current.get(breakdownId)?.abort();
    breakdownAbortRef.current.delete(breakdownId);
    updateData(breakdownId, data => data.kind === "breakdown" && data.status === "running"
      ? { ...data, status: "failed", error: "已取消拉片", finishedAt: Date.now() }
      : data, "replace");
  }, [updateData]);

  /** Places keyframe stills (and optional tasks) in a column right of the breakdown. */
  const addBreakdownDerived = React.useCallback((breakdownId: string, items: Array<{ frame?: { url: string; name: string }; task?: CanvasNodeData }>) => {
    const current = documentRef.current;
    const breakdown = current.nodes.find(node => node.id === breakdownId);
    if (!breakdown || breakdown.data.kind !== "breakdown") return [];
    const video = breakdown.data.video;
    const frameSize = video?.width && video.height ? getCanvasMediaNodeSize(video.width, video.height) : DEFAULT_CANVAS_MEDIA_NODE_SIZE;
    const derivedIds = new Set(current.edges.filter(edge => edge.source === breakdownId).map(edge => edge.target));
    const column = breakdown.position.x + (breakdown.width ?? 1040) + 160;
    let top = breakdown.position.y;
    for (const node of current.nodes) {
      if (derivedIds.has(node.id)) top = Math.max(top, node.position.y + (node.height ?? 0) + 120);
    }
    const nodes: CanvasNode[] = [];
    const edges: CanvasEdge[] = [];
    for (const item of items) {
      let rowHeight = 0;
      let frameId: string | undefined;
      if (item.frame) {
        frameId = id("image");
        nodes.push({ id: frameId, type: "image", position: { x: column, y: top }, ...frameSize, data: { kind: "image", url: item.frame.url, name: item.frame.name, origin: "generated" } });
        edges.push({ id: id("edge"), source: breakdownId, target: frameId, type: "default" });
        rowHeight = frameSize.height;
      }
      if (item.task) {
        const taskId = id(item.task.kind);
        const taskSize = item.task.kind === "imageTask" || item.task.kind === "videoTask" ? getCanvasTaskResultFrameSize(item.task) : { width: 350, height: 200 };
        nodes.push({ id: taskId, type: item.task.kind, position: { x: column + (frameId ? frameSize.width + 160 : 0), y: top }, ...taskSize, data: item.task });
        edges.push({ id: id("edge"), source: frameId ?? breakdownId, target: taskId, type: "default" });
        rowHeight = Math.max(rowHeight, taskSize.height);
      }
      top += rowHeight + 120;
    }
    const nextEdges = [...current.edges, ...edges];
    commit(syncCanvasTaskPromptsWithEdges({ ...current, nodes: [...current.nodes, ...nodes], edges: nextEdges }, nextEdges));
    return nodes;
  }, [commit]);

  const breakdownToImageTask = React.useCallback((breakdownId: string, shotIndex: number) => {
    if (readOnly) return;
    const breakdown = documentRef.current.nodes.find(node => node.id === breakdownId);
    if (breakdown?.data.kind !== "breakdown") return;
    const shot = breakdown.data.shots.find(item => item.index === shotIndex);
    if (!shot) return;
    const task = createNodeData("imageTask");
    if (task.kind !== "imageTask") return;
    task.title = `镜头${shot.index} 首帧`;
    task.task = { ...task.task, settings: { ...task.task.settings, prompt: shot.imagePrompt || shot.description } };
    const created = addBreakdownDerived(breakdownId, [{ frame: shot.frameUrl ? { url: shot.frameUrl, name: `镜头${shot.index} 关键帧` } : undefined, task }]);
    const taskNode = created.find(node => node.type === "imageTask");
    if (taskNode) { setSelectedIds([taskNode.id]); setOpenTaskPanelNodeId(taskNode.id); revealDerivedNodes(breakdownId, created.map(node => node.id)); }
  }, [readOnly, addBreakdownDerived, createNodeData, revealDerivedNodes]);

  const breakdownToVideoTask = React.useCallback((breakdownId: string, segmentIndex: number) => {
    if (readOnly) return;
    const breakdown = documentRef.current.nodes.find(node => node.id === breakdownId);
    if (breakdown?.data.kind !== "breakdown") return;
    const segment = breakdown.data.segments.find(item => item.index === segmentIndex);
    if (!segment) return;
    const firstShot = breakdown.data.shots.find(shot => shot.index === segment.shots[0]);
    const task = createNodeData("videoTask");
    if (task.kind !== "videoTask") return;
    task.title = `片段${segment.index} ${segment.title}`.trim();
    task.prompt = segment.videoPrompt || segment.shots.map(index => breakdown.data.kind === "breakdown" ? breakdown.data.shots.find(shot => shot.index === index)?.motionPrompt : "").filter(Boolean).join("\n");
    task.duration = Math.max(1, Math.round(segment.end - segment.start));
    const created = addBreakdownDerived(breakdownId, [{ frame: firstShot?.frameUrl ? { url: firstShot.frameUrl, name: `片段${segment.index} 首帧` } : undefined, task }]);
    const taskNode = created.find(node => node.type === "videoTask");
    if (taskNode) { setSelectedIds([taskNode.id]); setOpenTaskPanelNodeId(taskNode.id); revealDerivedNodes(breakdownId, created.map(node => node.id)); }
  }, [readOnly, addBreakdownDerived, createNodeData, revealDerivedNodes]);

  /** All keyframes as a grid inside one frame; a second click just jumps to it. */
  const expandBreakdownFrames = React.useCallback((breakdownId: string) => {
    if (readOnly) return;
    const reveal = (nodeId: string) => {
      const target = flow.getNode(nodeId);
      if (!target) return;
      setSelectedIds([nodeId]);
      void flow.fitView({ nodes: [target], padding: 0.12, duration: 300, maxZoom: 1 });
    };
    const current = documentRef.current;
    const breakdown = current.nodes.find(node => node.id === breakdownId);
    if (!breakdown || breakdown.data.kind !== "breakdown") return;
    const existing = breakdown.data.outputs?.framesGroup;
    if (existing && current.nodes.some(node => node.id === existing)) { reveal(existing); return; }
    const data = { ...breakdown.data, outputs: { ...breakdown.data.outputs, framesGroup: undefined } };
    const planned = planBreakdownFrameGrid({ ...breakdown, data }, kind => id(kind));
    if (!planned) return;
    commit({
      ...current,
      nodes: [...current.nodes.map(node => node.id === breakdownId ? { ...node, data: { ...data, outputs: planned.outputs } } : node), ...planned.nodes],
    });
    window.requestAnimationFrame(() => reveal(planned.nodes[0].id));
  }, [readOnly, commit, flow]);

  const cancelCanvasMarqueeSelection = React.useCallback(() => {
    marqueeFrameRef.current?.cancel();
    const marquee = marqueeSelectionRef.current;
    // Pointerdown creates a native rectangle before our onSelectionStart runs.
    // Clear that pending rectangle too, or a later move can revive selection.
    if (!marquee && !flowStore.getState().userSelectionRect) return false;
    marqueeCancelledRef.current = true;
    marqueeSelectionRef.current = null;
    flowStore.setState({
      userSelectionActive: false,
      userSelectionRect: null,
      ...(marquee ? { nodesSelectionActive: marquee.previousNodeIds.length > 0 } : {}),
    });
    setSelectionInProgress(false);
    if (marquee) {
      setSelectedIds(marquee.previousNodeIds);
      setSelectedEdgeIds(marquee.previousEdgeIds);
    }
    return true;
  }, [flowStore]);

  const toggleLibraryPanel = React.useCallback(() => {
    setContextMenu(null);
    setConnectionMenu(null);
    setUtilityPanel(null);
    onCloseWorkflow?.();
    onToggleLibrary?.();
  }, [onCloseWorkflow, onToggleLibrary]);

  const selectCanvasTool = React.useCallback((mode: CanvasToolMode) => {
    cancelCanvasMarqueeSelection();
    setToolMode(mode);
    setSpacePanHeld(false);
    setUtilityPanel(null);
    setContextMenu(null);
    setConnectionMenu(null);
    setOpenTaskPanelNodeId(null);
    updateConnectionFeedbackTarget(null);
    clearAlignmentGuides();
    wrapRef.current?.focus({ preventScroll: true });
  }, [cancelCanvasMarqueeSelection, clearAlignmentGuides, updateConnectionFeedbackTarget]);

  const closeToolMenu = React.useCallback(() => setUtilityPanel((current) => current === "tools" ? null : current), []);

  React.useEffect(() => {
    if (canvasInteractionLocked) { setSpacePanHeld(false); return; }
    const onSpaceDown = (event: KeyboardEvent) => {
      // Lost keyup events must not leave the node/edge layers inert.
      if (event.key === "Escape" && !event.isComposing) { setSpacePanHeld(false); return; }
      const target = event.target instanceof Element ? event.target : null;
      const wrap = wrapRef.current;
      const editableSelector = "input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox']";
      const outsideEditable = Boolean(target && wrap && !wrap.contains(target) && target.closest(editableSelector));
      const isSpace = event.code === "Space" || event.key === " ";
      if (outsideEditable && (!isSpace || event.isComposing)) outsideTypingAtRef.current = Date.now();
      if (!isSpace || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.defaultPrevented) return;
      if (!target || !wrap || wrap.querySelector("[data-canvas-video-clip-editor]") || target.closest("[role='dialog'],[role='menu'],[role='listbox']")) return;
      const insideCanvas = wrap.contains(target);
      // A task editor can retain autofocus after the pointer returns to the canvas.
      // Let Space take over that focus without requiring a throwaway canvas click.
      const retainedTaskEditorFocus = insideCanvas && pointerOverCanvasRef.current && Boolean(target.closest("[data-canvas-task-panel]"));
      // 焦点还在画布外的输入框（如 Agent 输入框）：打完字后把鼠标移到了画布上才接管空格去平移；还在打字就照常输入空格
      const movedToCanvasAfterTyping = outsideEditable && pointerOverCanvasRef.current && canvasPointerMovedAtRef.current > outsideTypingAtRef.current;
      if (target.closest(editableSelector) && !retainedTaskEditorFocus && !movedToCanvasAfterTyping) return;
      if (!target.closest(editableSelector)) outsideTypingAtRef.current = 0;
      const focusedControl = target.closest("button,a,[role='slider']");
      const canvasFocused = insideCanvas && !focusedControl;
      // 鼠标在画布上时，焦点停在画布外的按钮等控件上也接管空格（不再需要先点一下画布，也不会误按下那个按钮）
      const retainedFocus = pointerOverCanvasRef.current && (insideCanvas || movedToCanvasAfterTyping || target === wrap.ownerDocument.body || target === wrap.ownerDocument.documentElement || !target.closest(editableSelector));
      if (!canvasFocused && !retainedFocus) return;
      if (movedToCanvasAfterTyping) (wrap.ownerDocument.activeElement as HTMLElement | null)?.blur();
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) {
        // Native mousedown can arrive before a batched render updates the
        // pan filter. Commit the mode and inert layers before that first press;
        // a rejected mousedown cannot be recovered by later pointer moves.
        flushSync(() => {
          cancelCanvasMarqueeSelection();
          updateConnectionFeedbackTarget(null);
          setSpacePanHeld(true);
        });
      } else setSpacePanHeld(true);
      wrap.focus({ preventScroll: true });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space" || event.key === " ") setSpacePanHeld(false);
    };
    const onBlur = () => { setSpacePanHeld(false); pointerOverCanvasRef.current = false; };
    const onVisibilityChange = () => { if (window.document.hidden) onBlur(); };
    window.addEventListener("keydown", onSpaceDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    window.document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onSpaceDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      window.document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cancelCanvasMarqueeSelection, canvasInteractionLocked, updateConnectionFeedbackTarget]);

  React.useEffect(() => {
    if (canvasInteractionLocked) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.isContentEditable || Boolean(target?.closest("input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox'],[role='combobox']"));
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || editing || !target || !wrapRef.current?.contains(target)) return;
      const focusedControl = target !== wrapRef.current && Boolean(target.closest("button,a,[role='dialog'],[role='menu'],[role='listbox']"));
      const command = event.ctrlKey || event.metaKey;
      const zoomShortcut = command && !event.altKey ? resolveCanvasShortcut(event) : null;
      if (zoomShortcut === "zoomIn" || zoomShortcut === "zoomOut" || zoomShortcut === "fit") {
        event.preventDefault();
        collapseImageResults();
        if (zoomShortcut === "fit") void flow.fitView({ padding: 0.12, duration: 300 });
        else void flow.zoomTo(Math.max(CANVAS_MIN_ZOOM, Math.min(CANVAS_MAX_ZOOM,
          flow.getZoom() * (zoomShortcut === "zoomIn" ? CANVAS_ZOOM_STEP : 1 / CANVAS_ZOOM_STEP))), { duration: 200 });
        return;
      }
      // Even when node selection is unavailable, consume select-all so it cannot
      // fall through to the browser and highlight toolbar/page text.
      if (command && !event.altKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        if (handToolActive || focusedControl || event.repeat) return;
        setSelectedIds(documentRef.current.nodes.map((node) => node.id));
        setSelectedEdgeIds([]);
        setOpenTaskPanelNodeId(null);
        return;
      }
      if (event.repeat) return;

      if (event.key === "Escape") {
        if (cancelCanvasMarqueeSelection()) {
          event.preventDefault();
          return;
        }
        if (contextMenu || connectionMenu) {
          event.preventDefault();
          setContextMenu(null);
          setConnectionMenu(null);
          return;
        }
        if (utilityPanel) {
          event.preventDefault();
          setUtilityPanel(null);
          return;
        }
        if (workflowOpen) {
          event.preventDefault();
          onCloseWorkflow?.();
          return;
        }
        if (libraryOpen) {
          event.preventDefault();
          toggleLibraryPanel();
          return;
        }
        if (openTaskPanelNodeId || selectedIds.length || selectedEdgeIds.length) {
          event.preventDefault();
          setOpenTaskPanelNodeId(null);
          setSelectedIds([]);
          setSelectedEdgeIds([]);
          setTaskPanelsSuppressedByMarquee(false);
          clearAlignmentGuides();
        }
        return;
      }
      if (focusedControl) return;

      const shortcut = resolveCanvasShortcut(event);
      if (shortcut) {
        if (handToolActive && ["group", "ungroup", "connect", "duplicate", "delete"].includes(shortcut)) return;
        event.preventDefault();
        if (shortcut === "move" || shortcut === "hand") { selectCanvasTool(shortcut); return; }
        if (shortcut === "undo") { undo(); return; }
        if (shortcut === "redo") { redo(); return; }
        if (shortcut === "group") { group(); return; }
        if (shortcut === "ungroup") { ungroup(); return; }
        if (shortcut === "connect") { connectSelected(); return; }
        if (shortcut === "duplicate") { duplicate(); return; }
        if (shortcut === "delete") { remove(); return; }
        if (shortcut === "arrange") { autoArrange(); return; }
        if (shortcut === "fit") { collapseImageResults(); void flow.fitView({ padding: 0.12, duration: 300 }); return; }
        if (shortcut === "zoomIn" || shortcut === "zoomOut") {
          collapseImageResults();
          const zoom = flow.getZoom() * (shortcut === "zoomIn" ? CANVAS_ZOOM_STEP : 1 / CANVAS_ZOOM_STEP);
          void flow.zoomTo(Math.max(CANVAS_MIN_ZOOM, Math.min(CANVAS_MAX_ZOOM, zoom)), { duration: 200 });
          return;
        }
        if (shortcut === "generate") {
          for (const nodeId of selectedIds) {
            const node = documentRef.current.nodes.find((item) => item.id === nodeId);
            if (node && ["imageTask", "videoTask", "audioTask", "llm"].includes(node.data.kind)) void runNode(nodeId);
          }
          return;
        }
        if (shortcut === "create") {
          const bounds = wrapRef.current.getBoundingClientRect();
          const point = pointerPositionRef.current ?? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
          const menuPoint = clampCanvasMenuPosition(point.x, point.y);
          setConnectionMenu(null);
          setUtilityPanel(null);
          onCloseWorkflow?.();
          if (libraryOpen) toggleLibraryPanel();
          setContextMenu({ ...menuPoint, position: flow.screenToFlowPosition(point) });
          return;
        }
      }
      if (command && event.key.toLowerCase() === "c" && selectedIds.length) { event.preventDefault(); clipboard.current = { document: documentRef.current, ids: selectedIds }; return; }
      if (command && event.key.toLowerCase() === "v") {
        if (handToolActive) return;
        const copied = clipboard.current;
        if (!copied?.ids.length) return;
        event.preventDefault();
        pasteNodes();
        return;
      }
      if (!command && !event.altKey && event.key.toLowerCase() === "a") { event.preventDefault(); toggleLibraryPanel(); return; }
      if (!command && !event.altKey && event.key.toLowerCase() === "z") { event.preventDefault(); void flow.fitView({ padding: 0.12, duration: 300 }); return; }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [autoArrange, cancelCanvasMarqueeSelection, canvasInteractionLocked, clearAlignmentGuides, collapseImageResults, connectSelected, connectionMenu, contextMenu, duplicate, flow, group, handToolActive, libraryOpen, onCloseWorkflow, openTaskPanelNodeId, pasteNodes, redo, remove, runNode, selectCanvasTool, selectedEdgeIds, selectedIds, toggleLibraryPanel, undo, ungroup, updateConnectionFeedbackTarget, utilityPanel, workflowOpen]);

  React.useEffect(() => {
    if (canvasInteractionLocked) return;
    const onPaste = (event: ClipboardEvent) => {
      if (handToolActive) return;
      const target = event.target as HTMLElement | null;
      if (!target || !wrapRef.current?.contains(target) || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      const files = Array.from(event.clipboardData?.items || []).filter((item) => item.kind === "file" && item.type.startsWith("image/")).map(item => item.getAsFile()).filter((file): file is File => Boolean(file));
      if (!files.length) return;
      event.preventDefault();
      const bounds = wrapRef.current?.getBoundingClientRect();
      const position = bounds ? flow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }) : { x: 0, y: 0 };
      void uploadFiles(files, position);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [canvasInteractionLocked, flow, handToolActive, uploadFiles]);

  const personalImportController = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => personalImportController.current?.abort(), []);
  const importPersonalMaterial = React.useCallback(async (materialId: string, position?: { x: number; y: number }, insertion?: ReturnType<typeof getCanvasReferenceInsertion>, dropGroupId?: string) => {
    if (readOnly) return;
    if (personalImportController.current) { setActionMessage(text("workspaceFollowup.m92c1a69e9792")); return; }
    const controller = new AbortController(); personalImportController.current = controller;
    setActionMessage(text("workspaceFollowup.mc13059f6dc42"));
    try {
      const response = await fetch(`/api/canvas/materials/${encodeURIComponent(materialId)}/use`, { method: "POST", signal: controller.signal });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "添加素材失败");
      if (controller.signal.aborted) return;
      const media = payload.media;
      if (!["image", "video", "audio"].includes(media.kind) || !media.url || !media.mediaId) throw new Error("素材返回格式错误");
      const rect = wrapRef.current?.getBoundingClientRect();
      const targetPosition = position || flow.screenToFlowPosition({ x: (rect?.left || 0) + (rect?.width || 800) / 2, y: (rect?.top || 0) + (rect?.height || 600) / 2 });
      const current = documentRef.current;
      const task = insertion ? current.nodes.find(node => node.id === insertion.nodeId) : undefined;
      if (insertion && (!task || !["imageTask", "videoTask"].includes(task.data.kind))) throw new Error("目标任务已不存在");
      if (task?.data.kind === "imageTask" && media.kind !== "image") throw new Error("图片任务只能使用图片参考素材");
      if (task?.data.kind === "videoTask") {
        const error = getCanvasVideoReferenceError(task.data.model, [...collectCanvasVideoReferences(current, task.id), { kind: media.kind }]);
        if (error) throw new Error(error);
      }
      const original = media.variants?.original;
      const size = media.kind === "audio" ? DEFAULT_CANVAS_AUDIO_NODE_SIZE : getCanvasMediaNodeSize(original?.width || 0, original?.height || 0);
      const placement = position ? targetPosition : getCanvasLocalUploadPositions([size], targetPosition, current.nodes.map(node => {
        const measured = flow.getInternalNode(node.id)?.measured;
        return { ...node, width: measured?.width ?? node.width, height: measured?.height ?? node.height };
      }))[0];
      const node: CanvasNode = { id: id(media.kind), type: media.kind, position: placement,
        data: { kind: media.kind, url: media.url, name: media.name, mediaId: media.mediaId, variants: media.variants, origin: "upload" },
        ...size };
      const next: CanvasDocumentV2 = { ...current, nodes: [...current.nodes, node], edges: task ? [...current.edges, { id: id("edge"), source: node.id, target: task.id, type: "default" }] : current.edges };
      const placed = dropGroupId
        ? alignNewCanvasGroupMember(joinCanvasGroups(next, new Map([[node.id, dropGroupId]]), true), node.id)
        : next;
      commit(insertion ? insertCanvasTaskReferences(current, placed, insertion) : placed);
      setSelectedIds([task?.id || node.id]);
      if (media.kind === "audio") void analyzeAudioUrlCached(media.url).then(waveform => hydrateAudioWaveform(node.id, waveform)).catch(() => undefined);
      setActionMessage(text("workspaceFollowup.m161cf14f01ea"));
    } catch (error) { if (!controller.signal.aborted) setActionMessage((error as Error).message); }
    finally { if (personalImportController.current === controller) personalImportController.current = null; }
  }, [readOnly, commit, flow, hydrateAudioWaveform]);
  React.useEffect(() => {
    const useMaterial = (event: Event) => { const materialId = (event as CustomEvent<{ id: string }>).detail?.id; if (materialId) void importPersonalMaterial(materialId); };
    window.addEventListener("canvas-personal-material-use", useMaterial);
    return () => window.removeEventListener("canvas-personal-material-use", useMaterial);
  }, [importPersonalMaterial]);

  const onDrop = React.useCallback((event: React.DragEvent) => {
    if (readOnly) { event.preventDefault(); return; }
    event.preventDefault();
    const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const libraryPayload = event.dataTransfer.getData("application/x-canvas-lib");
    const insertion = getCanvasReferenceInsertion(event.target, event.clientX, event.clientY);
    const personalMaterialId = event.dataTransfer.getData("application/x-canvas-personal-material");
    if (personalMaterialId) {
      const dropPosition = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
      const groupId = insertion ? undefined : findCanvasGroupAtPoint(documentRef.current.nodes, dropPosition);
      void importPersonalMaterial(personalMaterialId, dropPosition, insertion, groupId);
      return;
    }
    if (insertion) {
      const current = documentRef.current;
      const task = current.nodes.find((node) => node.id === insertion.nodeId);
      if (!task || (task.data.kind !== "imageTask" && task.data.kind !== "videoTask")) return;
      const files = Array.from(event.dataTransfer.files || []).filter((file) => file.type.startsWith("image/")
        || (task.data.kind === "videoTask" && (file.type.startsWith("video/") || file.type.startsWith("audio/"))));
      if (files.length) {
        void uploadFiles(files, position, undefined, false, undefined, undefined, insertion);
        return;
      }
      let sources: Array<{ url: string; kind?: string; name?: string }> = readMediaLibraryDragItems(event.dataTransfer);
      if (libraryPayload) {
        try {
          const item = JSON.parse(libraryPayload);
          if (item.url && ["image", "video", "audio"].includes(item.type)) sources = [{ url: item.url, kind: item.type, name: item.name }];
        } catch { return; }
      } else if (!sources.length) {
        const raw = ["application/x-media-library-url", "application/x-local-upload-path", "application/x-history-media-url", "application/x-history-image-url", "text/uri-list"]
          .map((type) => event.dataTransfer.getData(type)).find(Boolean) || "";
        sources = raw.split(/\r?\n/).map((url) => ({ url: url.trim() })).filter(({ url }) => url && !url.startsWith("#"));
      }
      const seen = new Set(collectCanvasTaskAssets(current, task.id).map((asset) => asset.url));
      const mediaNodes = sources.flatMap((source): CanvasNode[] => {
        const kind = source.kind === "audio" || source.kind === "video" || source.kind === "image"
          ? source.kind : inferPromptAssetKind(source.url);
        if (seen.has(source.url) || (task.data.kind === "imageTask" && kind !== "image")) return [];
        seen.add(source.url);
        return [{ id: id(kind), type: kind, position,
          data: { kind, url: source.url, name: source.name, origin: "upload" },
          ...(kind === "audio" ? DEFAULT_CANVAS_AUDIO_NODE_SIZE : DEFAULT_CANVAS_MEDIA_NODE_SIZE),
        }];
      });
      if (!mediaNodes.length) return;
      if (task.data.kind === "videoTask") {
        const error = getCanvasVideoReferenceError(task.data.model, [...collectCanvasVideoReferences(current, task.id), ...mediaNodes.map(node => ({ kind: node.data.kind }))]);
        if (error) { setActionMessage(error); return; }
      }
      const positions = getCanvasLocalUploadPositions(mediaNodes.map((node) => ({ width: node.width!, height: node.height! })), position);
      commit(insertCanvasTaskReferences(current, {
        ...current,
        nodes: [...current.nodes, ...mediaNodes.map((node, index) => ({ ...node, position: positions[index] || position }))],
        edges: [...current.edges, ...mediaNodes.map((node): CanvasEdge => ({ id: id("edge"), source: node.id, target: task.id, type: "default" }))],
      }, insertion));
      setSelectedIds([task.id]);
      for (const node of mediaNodes) {
        if (node.data.kind === "audio") void analyzeAudioUrlCached(node.data.url).then((waveform) => hydrateAudioWaveform(node.id, waveform)).catch(() => undefined);
      }
      return;
    }
    if (libraryPayload) {
      try {
        const item = JSON.parse(libraryPayload) as { url?: string; name?: string; type?: string };
        if (item.url && item.type === "file") {
          void fetch(item.url).then((response) => {
            if (!response.ok) throw new Error("工作流读取失败");
            return response.text();
          }).then((content) => {
            commit(appendCanvasDocument(documentRef.current, parseCanvasJson(content), position));
            setActionMessage(text("workspaceFollowup.m59cb377624e7"));
          }).catch((error) => setActionMessage(String((error as Error)?.message || error)));
        } else if (item.url) addMediaNode(item.type === "audio" ? "audio" : item.type === "video" ? "video" : "image", item.url, item.name, position);
      } catch {
        // Invalid library payloads are ignored.
      }
      return;
    }
    const files = Array.from(event.dataTransfer.files || []).filter(isCanvasUploadFile);
    if (files.length) void uploadFiles(files, position);
  }, [addMediaNode, commit, flow, hydrateAudioWaveform, importPersonalMaterial, uploadFiles]);

  const onSelectionChange = React.useCallback(() => {
    if (marqueeCancelledRef.current) return;
    const marquee = marqueeSelectionRef.current;
    if (!marquee) return;
    const { userSelectionRect, transform } = flowStore.getState();
    if (userSelectionRect) {
      const [translateX, translateY, zoom] = transform;
      const selectionBounds = {
        x: (userSelectionRect.x - translateX) / zoom,
        y: (userSelectionRect.y - translateY) / zoom,
        width: userSelectionRect.width / zoom,
        height: userSelectionRect.height / zoom,
      };
      marquee.latestRect = selectionBounds;
      if (Math.hypot(userSelectionRect.width, userSelectionRect.height) > 5) {
        marqueeFrameRef.current?.push(selectionBounds);
      }
    }
  }, [flowStore]);

  React.useEffect(() => {
    // React Flow's selection callback only fires for ID changes. Subscribe to the
    // rectangle too so group bounds and final pointer coordinates stay current.
    const unsubscribe = flowStore.subscribe?.((state, previous) => {
      if (state.userSelectionRect !== previous.userSelectionRect || state.transform !== previous.transform) onSelectionChange();
    });
    const cancel = () => { cancelCanvasMarqueeSelection(); };
    const onVisibility = () => { if (window.document.hidden) cancel(); };
    window.addEventListener("blur", cancel);
    window.addEventListener("pointercancel", cancel);
    window.document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsubscribe?.();
      marqueeFrameRef.current?.cancel();
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pointercancel", cancel);
      window.document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cancelCanvasMarqueeSelection, flowStore, onSelectionChange]);

  const pollServerRun = React.useCallback(async (runId: number) => {
    if (readOnly || pollingServerRuns.current.has(runId)) return;
    pollingServerRuns.current.add(runId);
    try {
      while (activeServerRuns.current.has(runId)) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        if (!activeServerRuns.current.has(runId)) return;
        try {
          const response = await fetch(`/api/canvas/runs/${runId}`, { cache: "no-store" });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload?.success || !payload.run) continue;
          const run = payload.run as RunRecord & { steps?: Array<{ nodeId: string; status: string; errorMessage?: string | null }> };
          const state: RunRecord["state"] = {
            ...(run.state || {}),
            nodes: Object.fromEntries((run.steps || []).map((step) => [step.nodeId, { status: step.status, error: step.errorMessage || undefined }])),
          };
          setRuns((current) => current.map((item) => item.id === runId ? { ...item, ...run, state } : item));
          if (["success", "failed", "cancelled"].includes(run.status)) {
            activeServerRuns.current.delete(runId);
            await onServerRunCommitted?.();
            await refreshRuns();
            return;
          }
          if (run.status === "submission_unknown") return;
        } catch {
          // The durable server queue keeps running; transient polling failures are retried.
        }
      }
    } finally {
      pollingServerRuns.current.delete(runId);
    }
  }, [readOnly, onServerRunCommitted, refreshRuns]);
  pollServerRunRef.current = pollServerRun;

  const getTaskTextReferences = React.useCallback((nodeId: string) => collectCanvasTextReferences(document, nodeId, true), [document]);

  const getTaskAssets = React.useCallback((nodeId: string) => collectCanvasTaskAssets(documentRef.current, nodeId), [document.edges, document.nodes]);
  const getTaskVideoReferences = React.useCallback((nodeId: string) => collectCanvasVideoReferences(documentRef.current, nodeId), [document.edges, document.nodes]);

  const reorderTaskReferences = React.useCallback((nodeId: string, orderedIds: string[]) => {
    commit(reorderCanvasTaskReferences(documentRef.current, nodeId, orderedIds));
  }, [commit]);

  const removeTaskReference = React.useCallback((nodeId: string, referenceId: string) => {
    const current = documentRef.current;
    const textReference = collectCanvasTextReferences(current, nodeId).find(reference => reference.id === referenceId);
    if (textReference) {
      commit({ ...current, edges: current.edges.filter(edge => edge.target !== nodeId || edge.source !== textReference.sourceNodeId) });
      return;
    }
    const reference = collectCanvasTaskAssets(current, nodeId).find((asset) => asset.id === referenceId);
    if (!reference) return;
    const nodes = current.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      if (node.data.kind === "imageTask") {
        return {
          ...node,
          data: {
            ...node.data,
            task: {
              ...node.data.task,
              references: node.data.task.references.filter((item) => item.id !== referenceId && item.url !== reference.url),
              referenceOrder: node.data.task.referenceOrder?.filter((id) => id !== referenceId),
            },
          },
        };
      }
      if (node.data.kind === "videoTask") {
        return {
          ...node,
          data: {
            ...node.data,
            mediaPaths: node.data.mediaPaths.filter((url) => url !== reference.url),
            referenceOrder: node.data.referenceOrder?.filter((id) => id !== referenceId),
          },
        };
      }
      if (node.data.kind === "llm" || node.data.kind === "audioTask") {
        return { ...node, data: { ...node.data, referenceOrder: node.data.referenceOrder?.filter((id) => id !== referenceId) } };
      }
      return node;
    });
    const edges = reference.sourceNodeId
      ? current.edges.filter((edge) => edge.target !== nodeId || edge.source !== reference.sourceNodeId)
      : current.edges;
    commit(syncCanvasTaskAssetChanges(current, { ...current, nodes, edges }));
  }, [commit]);

  const locateCanvasNode = React.useCallback((nodeId: string) => {
    const target = flow.getNode(nodeId);
    if (!target) return;
    setSelectedIds([nodeId]);
    void flow.fitView({ nodes: [target], padding: 0.24, duration: 300, maxZoom: 1.5 });
  }, [flow]);

  const focusCanvasNode = React.useCallback((node: CanvasFlowNode) => {
    focusAnimation.current?.cancel();
    const bounds = flow.getNodesBounds([node]);
    // A regular click selects just this node before its double-click is dispatched.
    const toolbar = wrapRef.current?.querySelector<HTMLElement>("[data-canvas-focus-toolbar]");
    const toolbarSpace = toolbar ? Math.max(0, flow.flowToScreenPosition(bounds).y - toolbar.getBoundingClientRect().top) : 0;
    const viewport = getCanvasNodeFocusViewport(bounds, flowStore.getState(), toolbarSpace);
    if (!viewport) return;
    setSelectedIds([node.id]);
    setSelectedEdgeIds([]);
    setContextMenu(null);
    setConnectionMenu(null);
    setOpenTaskPanelNodeId(null);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Focusing a node needs a visible spatial transition, even on dense boards.
    const duration = reducedMotion ? 0 : 360;
    const root = wrapRef.current;
    const element = root?.querySelector<HTMLElement>(".react-flow__viewport");
    if (duration && root && element?.animate) {
      setViewportInteracting(true);
      focusAnimation.current = animateCanvasFocus({
        root, element, from: flow.getViewport(), to: viewport, duration,
        apply: next => commitViewportAfter(flow.setViewport(next, { duration: 0 })),
        onEnd: () => { focusAnimation.current = null; setViewportInteracting(false); },
      });
      if (focusAnimation.current) return;
      setViewportInteracting(false);
    }
    commitViewportAfter(flow.setViewport(viewport, { duration }));
  }, [commitViewportAfter, flow, flowStore]);

  const disconnectEdgeById = React.useCallback((edgeId: string) => {
    const current = documentRef.current;
    const next = disconnectCanvasEdge(current, edgeId);
    if (next === current) return;
    commit(next);
    setSelectedEdgeIds((selected) => selected.filter((selectedId) => selectedId !== edgeId));
  }, [commit]);

  const mentionTaskReference = React.useCallback((nodeId: string, token: string) => {
    const marker = `@${token}`;
    updateData(nodeId, (data) => {
      if (data.kind === "imageTask") {
        const prompt = data.task.settings.prompt;
        if (prompt.includes(marker)) return data;
        return { ...data, task: { ...data.task, settings: { ...data.task.settings, prompt: prompt.trim() ? `${prompt} ${marker}` : marker } } };
      }
      if (data.kind === "videoTask" || data.kind === "llm" || data.kind === "audioTask") {
        if (data.prompt.includes(marker)) return data;
        return { ...data, prompt: data.prompt.trim() ? `${data.prompt} ${marker}` : marker };
      }
      return data;
    });
  }, [updateData]);

  const editor = React.useMemo(() => ({
    videoFocusRequest,
    consumeVideoFocusRequest,
    updateData,
    startTextWriting: (nodeId: string) => {
      if (readOnly) return;
      const next = startCanvasTextWriting(documentRef.current, nodeId);
      if (next === documentRef.current) return;
      commit(next);
      setSelectedIds([nodeId]);
      setOpenTaskPanelNodeId(null);
    },
    getTextNodeTitle: (nodeId: string) => getCanvasTextNodeTitle(documentRef.current, nodeId),
    replaceMediaFile,
    replaceMediaHistory: (nodeId: string, outputId?: string) => {
      if (readOnly) return;
      const node = documentRef.current.nodes.find(item => item.id === nodeId);
      const target = node && canvasReplacementTarget(node.data, outputId);
      if (!target) return;
      setReplacementTarget({ id: nodeId, kind: target.kind, outputId: target.outputId });
      setGenerationHistoryMounted(true); setGenerationHistoryOpen(true);
    },
    expandAudioOutputs: (nodeId: string) => {
      if (readOnly) return;
      const source = documentRef.current.nodes.find(n => n.id === nodeId);
      if (!source || source.data.kind !== "audioTask" || !source.data.audioOutputs?.length) return;
      const model = source.data.model;
      const nodes: CanvasNode[] = source.data.audioOutputs.map((track, index) => ({
        id: id("audio"), type: "audio", parentId: source.parentId,
        position: { x: source.position.x + (source.width || 420) + 80, y: source.position.y + index * 220 },
        width: 420, height: 180,
        data: { kind: "audio", origin: "generated", url: track.url, mediaId: track.mediaId,
          name: track.title || `歌曲 ${track.audioIndex}`, prompt: track.lyrics, model,
          durationSeconds: track.durationSeconds, sunoTrack: track },
      }));
      commit({ ...documentRef.current, nodes: [...documentRef.current.nodes, ...nodes] });
      setSelectedIds(nodes.map(n => n.id));
    },
    changeTaskModel,
    updateNodeSize,
    finishNodeResize: () => commit(documentRef.current),
    hydrateAudioWaveform,
    runNode,
    cancelNode,
    retryImageOutput,
    generateAngle,
    createCharacterSheet,
    openTemplate: (nodeId: string) => { if (!readOnly) setTemplateNodeId(nodeId); },
    openImageEditor: (nodeId: string, mode?: "preview" | "crop" | "brush" | "mask" | "outpaint" | "grid") => {
      if (readOnly) return;
      const node = documentRef.current.nodes.find((candidate) => candidate.id === nodeId);
      if (node?.data.kind === "image") setImageEditor({ nodeId, url: node.data.url, mode });
    },
    editOutput: (nodeId: string, batchId: string, outputId: string, mode: "preview" | "crop" | "brush" | "mask" | "outpaint" | "grid" = "crop") => {
      if (readOnly) return;
      const item = mediaItemsForNode(nodeId).find((candidate) => candidate.batchId === batchId && candidate.outputId === outputId);
      if (item) setImageEditor({ nodeId, url: item.url, mode });
    },
    exportVideoFrame,
    exportVideoClip,
    separateVideo,
    removeVideoSubtitles,
    breakdownModels,
    breakdownVideo,
    rerunBreakdown,
    cancelBreakdown,
    breakdownToImageTask,
    breakdownToVideoTask,
    expandBreakdownFrames,
    videoSeparationJobs,
    exportAudioClip,
    previewMedia: (nodeId: string) => previewMedia(nodeId),
    downloadMedia: (nodeId: string) => {
      const item = mediaItemsForNode(nodeId)[0];
      if (item) void downloadPreviewItem(item).catch((error) => setActionMessage(String((error as Error)?.message || error)));
    },
    saveMediaToLibrary: (nodeId: string) => openSaveToLibrary(mediaItemsForNode(nodeId)),
    previewOutput: (nodeId: string, batchId: string, outputId: string) => previewMedia(nodeId, `${nodeId}:${batchId}:${outputId}`, batchId),
    downloadOutput: (nodeId: string, batchId: string, outputId: string) => {
      const item = mediaItemsForNode(nodeId).find((candidate) => candidate.batchId === batchId && candidate.outputId === outputId);
      if (item) void downloadPreviewItem(item).catch((error) => setActionMessage(String((error as Error)?.message || error)));
    },
    saveOutputToLibrary: (nodeId: string, batchId: string, outputId: string) => {
      const item = mediaItemsForNode(nodeId).find((candidate) => candidate.batchId === batchId && candidate.outputId === outputId);
      if (item) openSaveToLibrary([item]);
    },
    groupAction,
    getTaskAssets,
    getTaskVideoReferences,
    getTaskTextReferences,
    reorderTaskReferences,
    removeTaskReference,
    locateCanvasNode,
    mentionTaskReference,
    getMediaName: (nodeId: string) => getCanvasMediaNodeName(documentRef.current, nodeId),
    getTaskResultName: (nodeId: string, batchId?: string, outputId?: string) => {
      const node = documentRef.current.nodes.find((candidate) => candidate.id === nodeId);
      if (node?.data.kind === "imageTask" && batchId && outputId) {
        return getCanvasImageOutputName(documentRef.current, nodeId, batchId, outputId);
      }
      if (node?.data.kind === "videoTask" && node.data.outputUrl) {
        return getCanvasTaskGeneratedMediaName(documentRef.current, nodeId, node.data.outputUrl, "video");
      }
      if (node?.data.kind === "audioTask" && node.data.outputUrl) {
        return getCanvasTaskGeneratedMediaName(documentRef.current, nodeId, node.data.outputUrl, "audio");
      }
      return undefined;
    },
    isPanelVisible: (nodeId: string) => !canvasInteractionLocked && !taskPanelsSuppressedByMarquee && selectedIds.length === 1 && selectedIds[0] === nodeId,
    isGroupSelected: (nodeId: string) => !selectionInProgress && selectedIds.includes(nodeId),
    isTaskPanelVisible: (nodeId: string) => !canvasInteractionLocked && openTaskPanelNodeId === nodeId && selectedIds.length === 1 && selectedIds[0] === nodeId,
    connectionInProgress: multiConnectionInProgress,
    connectionFeedbackTarget,
    focusedOutput,
    focusOutput,
  }), [focusedOutput, focusOutput, videoFocusRequest, consumeVideoFocusRequest, readOnly, generateAngle, createCharacterSheet, replaceMediaFile, cancelNode, canvasInteractionLocked, changeTaskModel, commit, connectionFeedbackTarget, downloadPreviewItem, exportVideoFrame, exportVideoClip, separateVideo, removeVideoSubtitles, breakdownModels, breakdownVideo, rerunBreakdown, cancelBreakdown, breakdownToImageTask, breakdownToVideoTask, expandBreakdownFrames, videoSeparationJobs, exportAudioClip, getTaskAssets, getTaskVideoReferences, getTaskTextReferences, groupAction, hydrateAudioWaveform, locateCanvasNode, mediaItemsForNode, mentionTaskReference, multiConnectionInProgress, openSaveToLibrary, openTaskPanelNodeId, previewMedia, removeTaskReference, reorderTaskReferences, retryImageOutput, runNode, selectedIds, selectionInProgress, taskPanelsSuppressedByMarquee, toggleLibraryPanel, updateData, updateNodeSize]);
  const flowNodes = React.useMemo(() => {
    const nextCache = new Map<string, { source: CanvasNode; selected: boolean; flow: CanvasFlowNode }>();
    const selectedSet = new Set(selectedIds);
    const nextNodes = [...document.nodes, ...(dragCopyPreview?.nodes ?? [])].map((node) => {
      const selected = selectedSet.has(node.id);
      const cached = flowNodeCacheRef.current.get(node.id);
      // Native marquee selection also selects group shells. Replace stale node
      // references so React Flow adopts our scoped selection, including on release.
      const selectionMatches = Boolean(flow.getInternalNode(node.id)?.selected) === selected;
      const flowNode = cached?.source === node && cached.selected === selected && selectionMatches ? cached.flow : toFlowNode(node, selected);
      if (readOnly) { flowNode.draggable = false; flowNode.connectable = false; flowNode.deletable = false; }
      nextCache.set(node.id, { source: node, selected, flow: flowNode });
      return flowNode;
    });
    flowNodeCacheRef.current = nextCache;
    return nextNodes;
  }, [readOnly, document.nodes, dragCopyPreview, flow, selectedIds, selectionInProgress]);
  React.useEffect(() => {
    setRenderNodes((current) => mergeCanvasRenderNodes(
      current,
      flowNodes,
      new Set(dragStart.current?.copy?.idMap.values() ?? dragStart.current?.ids ?? []),
    ));
  }, [flowNodes]);
  const nodeDragInProgress = nodeGestureActive || renderNodes.some((node) => Boolean(node.dragging));
  // Dense boards: fade unrelated curves so the clicked node's relations stay traceable.
  const edgeFocusActive = Boolean(edgeGlowNodeId) && document.edges.some(edge => edge.source === edgeGlowNodeId || edge.target === edgeGlowNodeId);
  const edgeOverview = useStore(state => state.transform[2] < CANVAS_LOD_EXIT_ZOOM);
  const interacting = nodeGestureActive || nodeDragInProgress || viewportInteracting || selectionInProgress;
  const edgeCache = React.useRef(new Map<string, { source: CanvasEdge; key: string; edge: CanvasEdge & Record<string, unknown> }>());
  const flowEdges = React.useMemo(() => {
    const nextCache = new Map<string, { source: CanvasEdge; key: string; edge: CanvasEdge & Record<string, unknown> }>();
    const selected = new Set(selectedIds);
    const nodeKinds = new Map([...document.nodes, ...(dragCopyPreview?.nodes ?? [])].map((node) => [node.id, node.data.kind] as const));
    const stackedParents = new Set(document.nodes.filter(node => node.data.kind === "group" && node.data.stacked).map(node => node.id));
    const stackOwner = new Map(document.nodes.filter(node => node.parentId && stackedParents.has(node.parentId)).map(node => [node.id, node.parentId!]));
    const result = [...document.edges, ...(dragCopyPreview?.edges ?? [])].map(original => {
      const source = stackOwner.get(original.source) ?? original.source;
      const target = stackOwner.get(original.target) ?? original.target;
      return source === original.source && target === original.target ? original : { ...original, source, target, sourceHandle: null, targetHandle: null };
    }).filter(edge => edge.source !== edge.target).map((edge) => {
      const targetKind = nodeKinds.get(edge.target);
      const selectedRelated = selected.has(edge.source) || selected.has(edge.target);
      const glowing = selected.has(edgeGlowNodeId ?? "") && (edge.source === edgeGlowNodeId || edge.target === edgeGlowNodeId);
      const edgeSelected = selectedEdgeIds.includes(edge.id);
      const className = [
        "canvas-edge-related",
        selectedRelated || edgeSelected ? "canvas-edge-live" : "",
        edgeSelected ? "canvas-edge-selected" : "",
      ].filter(Boolean).join(" ");
      const key = `${targetKind}:${selectedRelated}:${edgeSelected}:${glowing}`;
      const cached = edgeCache.current.get(edge.id);
      if (cached?.source === edge && cached.key === key && (cached.edge.data as { onDisconnect?: unknown })?.onDisconnect === disconnectEdgeById) {
        nextCache.set(edge.id, cached);
        return cached.edge;
      }
      const curvedEdge = {
        ...edge,
        sourceHandle: edge.sourceHandle || CANVAS_RIGHT_OUTPUT_HANDLE_ID,
        type: "default" as const,
        data: {
          targetInset: targetKind === "image" || targetKind === "video" || targetKind === "audio"
            ? edge.targetHandle === CANVAS_MEDIA_INPUT_HANDLE_ID
              ? 0
              : CANVAS_MEDIA_BODY_TARGET_EDGE_OFFSET
            : 0,
          onDisconnect: disconnectEdgeById,
        },
        className,
        style: {
          // 发光的相关连线不再整条变亮，底线保持暗色，只靠流光显示关系
          stroke: edgeSelected ? "var(--canvas-edge-selected)" : "var(--canvas-edge)",
        },
        selected: edgeSelected,
        reconnectable: false,
      };
      const rendered = { ...curvedEdge, animated: glowing };
      nextCache.set(edge.id, { source: edge, key, edge: rendered });
      return rendered;
    });
    edgeCache.current = nextCache;
    return result;
  }, [disconnectEdgeById, document.edges, document.nodes, dragCopyPreview, selectedEdgeIds, selectedIds, edgeGlowNodeId]);
  const selectedFlowNodes = React.useMemo(
    () => renderNodes.filter((node) => selectedIds.includes(node.id)),
    [renderNodes, selectedIds],
  );
  const multiSelectionBounds = React.useMemo(
    () => selectedFlowNodes.length > 1
      ? expandCanvasMultiSelectionBounds(flow.getNodesBounds(selectedFlowNodes), CANVAS_MULTI_SELECTION_FRAME_PADDING)
      : null,
    [flow, selectedFlowNodes],
  );
  const selectedConnectionGroup = selectedFlowNodes.length === 1 && selectedFlowNodes[0].data.kind === "group" ? selectedFlowNodes[0] : null;
  const connectionSelectionBounds = selectedConnectionGroup ? flow.getNodesBounds([selectedConnectionGroup]) : multiSelectionBounds;
  const multiConnectionSources = React.useMemo<CanvasMultiConnectionPoint[]>(() => (
    getCanvasSelectionConnectionSources(renderNodes, selectedIds)
      .map((node) => {
        const bounds = flow.getNodesBounds([node]);
        const frame = node.data.kind === "imageTask" ? getCanvasImageResultLayout(node.data).primary : { x: 0, y: 0, width: bounds.width, height: bounds.height };
        return {
          id: node.id,
          x: bounds.x + frame.x + frame.width,
          y: bounds.y + frame.y + frame.height / 2,
        };
      })
  ), [flow, renderNodes, selectedIds]);
  const startMultiConnectionDrag = React.useCallback((event: React.PointerEvent<HTMLSpanElement>) => {
    if (readOnly) return;
    if (!connectionSelectionBounds || multiConnectionSources.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    multiConnectionCleanupRef.current?.();

    const sourceIds = multiConnectionSources.map((source) => source.id);
    const ownerDocument = event.currentTarget.ownerDocument;
    const initialPointer = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setMultiConnectionDrag({ sourceIds, pointer: initialPointer });
    setOpenTaskPanelNodeId(null);
    setContextMenu(null);
    setConnectionMenu(null);
    setActionMessage("");

    const getTargetId = (pointerEvent: PointerEvent) => {
      const targetElement = ownerDocument
        .elementsFromPoint(pointerEvent.clientX, pointerEvent.clientY)
        .map((element) => element.closest<HTMLElement>("[data-canvas-connection-target-id]"))
        .find((element): element is HTMLElement => Boolean(element)) ?? null;
      return targetElement?.dataset.canvasConnectionTargetId || null;
    };
    const previewConnection = (targetId: string | null) => connectCanvasNodeSelection(
      documentRef.current.nodes,
      documentRef.current.edges,
      sourceIds,
      targetId,
      () => "__canvas-multi-selection-preview-edge__",
    );
    const publishPointer = (pointerEvent: PointerEvent) => {
      const pointer = flow.screenToFlowPosition({ x: pointerEvent.clientX, y: pointerEvent.clientY });
      const hoveredTargetId = getTargetId(pointerEvent);
      const targetId = hoveredTargetId && !sourceIds.includes(hoveredTargetId)
        ? hoveredTargetId
        : null;
      const result = previewConnection(targetId);
      setMultiConnectionDrag({ sourceIds, pointer });
      updateConnectionFeedbackTarget(targetId
        ? { nodeId: targetId, state: result.connected ? "valid" : "invalid" }
        : null);
    };
    let pointerFrame: number | null = null;
    let latestPointer: PointerEvent | null = null;
    const stopAutoPan = startCanvasConnectionAutoPan(
      () => flowStore.getState(),
      () => latestPointer,
      () => { if (latestPointer) publishPointer(latestPointer); },
    );
    const onPointerMove = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      latestPointer = pointerEvent;
      if (pointerFrame !== null) return;
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = null;
        if (latestPointer) publishPointer(latestPointer);
      });
    };
    const cleanup = () => {
      stopAutoPan();
      if (pointerFrame !== null) cancelAnimationFrame(pointerFrame);
      pointerFrame = null;
      latestPointer = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onBlur);
      if (multiConnectionCleanupRef.current === cleanup) multiConnectionCleanupRef.current = null;
      window.removeEventListener("keydown", onEscape);
      ownerDocument.removeEventListener("visibilitychange", onVisibility);
    };
    const finish = (pointerEvent: PointerEvent, cancelled: boolean) => {
      cleanup();
      const hoveredTargetId = cancelled ? null : getTargetId(pointerEvent);
      const droppedOnSelectedSource = Boolean(hoveredTargetId && sourceIds.includes(hoveredTargetId));
      const targetId = droppedOnSelectedSource ? null : hoveredTargetId;
      setMultiConnectionDrag(null);
      updateConnectionFeedbackTarget(null);
      const result = connectCanvasNodeSelection(
        documentRef.current.nodes,
        documentRef.current.edges,
        sourceIds,
        targetId,
        () => id("edge"),
      );
      if (result.connected) {
        commit(syncCanvasTaskPromptsWithEdges(documentRef.current, result.edges));
        setSelectedIds([]);
        if (targetId && documentRef.current.nodes.some(node => node.id === targetId && node.data.kind === "llm")) {
          setSelectedIds([targetId]);
          setOpenTaskPanelNodeId(targetId);
        }
        return;
      }
      const droppedOnPane = !cancelled && (droppedOnSelectedSource || ownerDocument
        .elementsFromPoint(pointerEvent.clientX, pointerEvent.clientY)
        .some((element) => element.classList.contains("react-flow__pane")
          || element.matches('[data-canvas-group-frame][data-collapsed="false"]')));
      if (!targetId && droppedOnPane) {
        const point = clientPoint(pointerEvent);
        const bounds = wrapRef.current?.getBoundingClientRect();
        const menuPoint = clampCanvasMenuPosition(point.x, point.y, 220, 317);
        suppressPaneClickRef.current = true;
        window.setTimeout(() => { suppressPaneClickRef.current = false; }, 0);
        setConnectionMenu({
          sourceIds,
          x: menuPoint.x,
          y: menuPoint.y,
          zoom: flow.getViewport().zoom,
          position: flow.screenToFlowPosition(point),
          from: multiConnectionSources.map((source) => {
            const sourceScreenPoint = flow.flowToScreenPosition(source);
            return {
              x: sourceScreenPoint.x - (bounds?.left ?? 0),
              y: sourceScreenPoint.y - (bounds?.top ?? 0),
            };
          }),
          to: {
            x: point.x - (bounds?.left ?? 0),
            y: point.y - (bounds?.top ?? 0),
          },
          fromPosition: Position.Right,
        });
        return;
      }
      setSelectedIds([]);
    };
    const onPointerUp = (pointerEvent: PointerEvent) => finish(pointerEvent, false);
    const onPointerCancel = (pointerEvent: PointerEvent) => finish(pointerEvent, true);
    const onBlur = () => {
      cleanup();
      setMultiConnectionDrag(null);
      updateConnectionFeedbackTarget(null);
    };
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing) onBlur(); };
    const onVisibility = () => { if (ownerDocument.hidden) onBlur(); };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", onPointerCancel, { once: true });
    window.addEventListener("blur", onBlur, { once: true });
    multiConnectionCleanupRef.current = cleanup;
    window.addEventListener("keydown", onEscape);
    ownerDocument.addEventListener("visibilitychange", onVisibility);
  }, [readOnly, commit, flow, flowStore, multiConnectionSources, connectionSelectionBounds, updateConnectionFeedbackTarget]);
  const handleFlowEdgeClick = React.useCallback<NonNullable<ReactFlowProps<CanvasFlowNode, CanvasEdge>["onEdgeClick"]>>(
    () => {
      setOpenTaskPanelNodeId(null);
      setContextMenu(null);
      setConnectionMenu(null);
    }, []);

  const handleFlowNodeClick = React.useCallback<NonNullable<ReactFlowProps<CanvasFlowNode, CanvasEdge>["onNodeClick"]>>(
    (event, node) => {
      if (handToolActive) return;
      if (!suppressEdgeGlowClick.current) setEdgeGlowNodeId(node.id);
      marqueeSelectionRef.current = null;
      marqueeCancelledRef.current = false;
      setTaskPanelsSuppressedByMarquee(false);
      setSelectedEdgeIds([]);
      setContextMenu(null);
      setConnectionMenu(null);
      const multiSelection = event.shiftKey || event.ctrlKey || event.metaKey;
      if (node.data.kind === "imageTask" || node.data.kind === "videoTask" || node.data.kind === "audioTask" || node.data.kind === "llm") {
        if (multiSelection) {
          setOpenTaskPanelNodeId(null);
        } else {
          setSelectedIds([node.id]);
          // Show the editor on the first click; double-click focus closes it separately.
          setOpenTaskPanelNodeId(node.id);
        }
      } else {
        setOpenTaskPanelNodeId(null);
      }
    }, [handToolActive]);

  const handleFlowNodeDoubleClick = React.useCallback<NonNullable<ReactFlowProps<CanvasFlowNode, CanvasEdge>["onNodeDoubleClick"]>>(
    (event, node) => {
      if (handToolActive || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!isDeliberateDoubleClick(event)) return;
      if (!["image", "video", "audio", "imageTask", "videoTask", "audioTask", "llm", "prompt", "compare"].includes(node.data.kind)) return;
      if ((event.target as Element).closest("button, a, input, textarea, select, [contenteditable='true'], [role='slider'], [role='button'], .react-flow__handle, [data-canvas-task-panel-anchor]")) return;
      event.preventDefault();
      event.stopPropagation();
      // 图片（含多图结果）双击直接打开大图预览，多图可左右切换整组
      const imageBatch = node.data.kind === "imageTask" ? node.data.task?.batches.at(-1) : undefined;
      if ((node.data.kind === "image" && node.data.url) || imageBatch?.outputs.some(output => output.status === "success" && output.url)) {
        const focused = focusedOutput?.nodeId === node.id && imageBatch ? `${node.id}:${imageBatch.id}:${focusedOutput.outputId}` : undefined;
        previewMedia(node.id, focused, imageBatch?.id);
        return;
      }
      focusCanvasNode(node);
      const src = node.data.kind === "video" ? node.data.url
        : node.data.kind === "videoTask" && node.data.status === "success" ? node.data.outputUrl : undefined;
      setVideoFocusRequest(src ? { nodeId: node.id, src, revision: ++videoFocusRevision.current } : null);
    }, [focusCanvasNode, handToolActive, focusedOutput, previewMedia]);

  const handleFlowNodeContextMenu = React.useCallback<NonNullable<ReactFlowProps<CanvasFlowNode, CanvasEdge>["onNodeContextMenu"]>>(
    (event, node) => {
      event.preventDefault();
      const menuPoint = clampCanvasMenuPosition(event.clientX, event.clientY, 220, 288);
      setConnectionMenu(null);
      setOpenTaskPanelNodeId(null);
      setSelectedEdgeIds([]);
      if (!selectedIds.includes(node.id)) setSelectedIds([node.id]);
      setContextMenu({
        x: menuPoint.x,
        y: menuPoint.y,
        position: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        nodeId: node.id,
      });
    }, [flow, selectedIds]);

  const handleSelectionContextMenu = React.useCallback<NonNullable<ReactFlowProps<CanvasFlowNode, CanvasEdge>["onSelectionContextMenu"]>>((event, nodes) => {
    if (!nodes.length) return;
    handleFlowNodeContextMenu(event, nodes[0]);
    setSelectedIds(nodes.map(node => node.id));
  }, [handleFlowNodeContextMenu]);

  // Stable flow options avoid a store-wide subscription broadcast for every guide update.
  const handleFlowInit = React.useCallback<NonNullable<ReactFlowProps<CanvasFlowNode, CanvasEdge>["onInit"]>>(
    (instance) => {
      performance.mark(`canvas:${canvasId}:board-ready`);
      if (!migrateLegacyViewportRef.current) return;
      migrateLegacyViewportRef.current = false;
      void instance.fitView({ padding: 0.12 }).then(() => commitViewport(instance.getViewport()));
    },
    [canvasId, commitViewport],
  );

  const handleSelectionDragStart = React.useCallback<NonNullable<ReactFlowProps<CanvasFlowNode, CanvasEdge>["onSelectionDragStart"]>>(
    (event, nodes) => { if (nodes[0]) onNodeDragStart(event.nativeEvent ?? event, nodes[0], nodes); },
    [onNodeDragStart],
  );

  const handleSelectionDragStop = React.useCallback<NonNullable<ReactFlowProps<CanvasFlowNode, CanvasEdge>["onSelectionDragStop"]>>(
    (event, nodes) => { if (nodes[0]) onNodeDragStop(event.nativeEvent ?? event, nodes[0], nodes); },
    [onNodeDragStop],
  );

  const handleSelectionStart = React.useCallback<NonNullable<ReactFlowProps<CanvasFlowNode, CanvasEdge>["onSelectionStart"]>>(
    (event) => {
      stopEdgeGlow();
      const mode: CanvasMarqueeSelectionMode = event.ctrlKey || event.metaKey
        ? "toggle"
        : event.shiftKey
          ? "union"
          : "replace";
      marqueeCancelledRef.current = false;
      marqueeFrameRef.current?.cancel();
      const snapshot = flow.getNodes().map((node) => ({ ...flow.getNodesBounds([node]), id: node.id, parentId: node.parentId, hidden: node.hidden, selectable: node.selectable, expandedGroup: node.data.kind === "group" && !node.data.collapsed }));
      const rect = flowStore.getState().userSelectionRect;
      const start = rect ? { x: rect.startX, y: rect.startY } : null;
      const selectionParent = start ? snapshot
        .filter((node) => node.expandedGroup && !node.hidden && node.selectable !== false && start.x > node.x && start.x < node.x + node.width && start.y > node.y && start.y < node.y + node.height)
        .sort((a, b) => a.width * a.height - b.width * b.height)[0] : undefined;
      const selectionAncestors = new Set<string>();
      for (let parent = selectionParent; parent; parent = snapshot.find((node) => node.id === parent?.parentId)) selectionAncestors.add(parent.id);
      marqueeSelectionRef.current = {
        previousNodeIds: selectedIds,
        previousEdgeIds: selectedEdgeIds,
        insideNodeIds: new Set(),
        mode,
        search: createMarqueeIndex(snapshot, selectionParent?.id),
        latestRect: null,
        start,
        edgeSamples: sampleCanvasMarqueeEdges(wrapRef.current),
      };
      const gesture = marqueeSelectionRef.current;
      marqueeFrameRef.current = createMarqueeFrame((bounds: MarqueeRect) => {
        if (marqueeCancelledRef.current || marqueeSelectionRef.current !== gesture) return;
        const insideNodeIds = gesture.search(bounds);
        gesture.insideNodeIds = new Set(insideNodeIds);
        const next = resolveCanvasMarqueeSelection(gesture.previousNodeIds, insideNodeIds, gesture.mode)
          .filter((id) => !insideNodeIds.length || !selectionAncestors.has(id));
        setSelectedIds((current) => stableMarqueeIds(current, next));
      }, requestAnimationFrame, cancelAnimationFrame);
      setSelectionInProgress(true);
      setTaskPanelsSuppressedByMarquee(true);
      setOpenTaskPanelNodeId(null);
      setContextMenu(null);
      setConnectionMenu(null);
      setSelectedEdgeIds([]);
      clearAlignmentGuides();
    },
    [clearAlignmentGuides, flow, flowStore, selectedEdgeIds, selectedIds, stopEdgeGlow],
  );

  const handleSelectionEnd = React.useCallback<NonNullable<ReactFlowProps<CanvasFlowNode, CanvasEdge>["onSelectionEnd"]>>(
    (event) => {
      setSelectionInProgress(false);
      if (marqueeCancelledRef.current) {
        marqueeCancelledRef.current = false;
        return;
      }
      const marquee = marqueeSelectionRef.current;
      if (marquee) {
        if (marquee.start) {
          const end = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
          marquee.latestRect = { x: Math.min(marquee.start.x, end.x), y: Math.min(marquee.start.y, end.y), width: Math.abs(end.x - marquee.start.x), height: Math.abs(end.y - marquee.start.y) };
        }
        const finalRect = marquee.latestRect;
        if (finalRect && Math.hypot(finalRect.width, finalRect.height) * flow.getZoom() > 5) {
          marqueeFrameRef.current?.push(finalRect);
          marqueeFrameRef.current?.flush();
          // Include paths newly revealed by auto-pan before the final hit test.
          const edgeSamples = new Map((marquee.insideNodeIds.size ? [] : [...marquee.edgeSamples, ...sampleCanvasMarqueeEdges(wrapRef.current)]).map((edge) => [edge.id, edge]));
          const edges = marquee.insideNodeIds.size ? [] : [...edgeSamples.values()].filter((edge) => sampledPathIntersectsRect(edge.points, finalRect)).map((edge) => edge.id);
          setSelectedEdgeIds((current) => stableMarqueeIds(current, resolveCanvasMarqueeSelection(marquee.previousEdgeIds, edges, marquee.mode)));
        } else {
          marqueeFrameRef.current?.cancel();
          setSelectedIds((current) => stableMarqueeIds(current, marquee.previousNodeIds));
          setSelectedEdgeIds((current) => stableMarqueeIds(current, marquee.previousEdgeIds));
        }
      }
      marqueeSelectionRef.current = null;
    },
    [flow],
  );

  const handlePaneClick = React.useCallback<NonNullable<ReactFlowProps<CanvasFlowNode, CanvasEdge>["onPaneClick"]>>(
    () => {
      if (handToolActive) return;
      if (suppressPaneClickRef.current) return;
      stopEdgeGlow();
      marqueeSelectionRef.current = null;
      marqueeCancelledRef.current = false;
      setSelectedIds([]);
      setSelectedEdgeIds([]);
      setOpenTaskPanelNodeId(null);
      setContextMenu(null);
      setConnectionMenu(null);
      clearAlignmentGuides();
    },
    [clearAlignmentGuides, handToolActive, stopEdgeGlow],
  );

  const handlePaneContextMenu = React.useCallback<NonNullable<ReactFlowProps<CanvasFlowNode, CanvasEdge>["onPaneContextMenu"]>>(
    (event) => {
      event.preventDefault();
      const menuPoint = clampCanvasMenuPosition(event.clientX, event.clientY, 220, 288);
      setConnectionMenu(null);
      setContextMenu({
        source: "pane",
        x: menuPoint.x,
        y: menuPoint.y,
        position: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      });
    },
    [flow],
  );

  const handleMove = React.useCallback<NonNullable<ReactFlowProps<CanvasFlowNode, CanvasEdge>["onMove"]>>(
    (event, viewport) => {
      // Modified wheel zoom uses setViewport and has no originating event here.
      if (!dragStart.current && (!event || event.type === "wheel")) collapseImageResults(viewport);
      if (event?.type !== "wheel") return;
      // XYPanZoom can omit onMoveEnd for a lone wheel tick and resume the next
      // scroll with onMove only. Settle every accepted wheel, not just starts.
      // Relationship flows only pause while moving; the flow layer resumes them on release.
      viewportGestureStartedAt.current = event.timeStamp;
      setViewportInteracting(true);
      clearWheelEndTimer();
      wheelEndTimer.current = setTimeout(() => {
        wheelEndTimer.current = null;
        if (panReleaseGuard.current?.isActive() || focusAnimation.current) return;
        setViewportInteracting(false);
        commitViewport(flow.getViewport());
      }, 200);
    },
    [clearWheelEndTimer, collapseImageResults, commitViewport, flow],
  );

  const handleMoveStart = React.useCallback<NonNullable<ReactFlowProps<CanvasFlowNode, CanvasEdge>["onMoveStart"]>>(
    (event, viewport) => {
      if (event && event.type !== "wheel" && !dragStart.current) collapseImageResults();
      clearWheelEndTimer();
      viewportGestureStartedAt.current = event?.timeStamp ?? performance.now();
      panReleaseGuard.current?.start(event);
      if (panReleaseGuard.current?.isActive()) {
        cancelCanvasMarqueeSelection();
        setMousePanActive(true);
      }
      setViewportInteracting(true);
      dismissCanvasTaskPopovers();
      setContextMenu(null);
      setConnectionMenu(null);
      handleMove(event, viewport);
    },
    [cancelCanvasMarqueeSelection, clearWheelEndTimer, collapseImageResults, handleMove],
  );

  const handleMoveEnd = React.useCallback<NonNullable<ReactFlowProps<CanvasFlowNode, CanvasEdge>["onMoveEnd"]>>(
    (event, viewport) => {
      // Scroll-enabled pan ends are delayed by the engine. An older end
      // must not restore expensive content or save a stale viewport while
      // the next mouse gesture is already running.
      if (panReleaseGuard.current?.isActive()
        || (event && event.timeStamp < viewportGestureStartedAt.current)) return;
      clearWheelEndTimer();
      setViewportInteracting(false);
      commitViewport(viewport);
    },
    [clearWheelEndTimer, commitViewport],
  );

  const contextNode = contextMenu?.nodeId ? document.nodes.find((node) => node.id === contextMenu.nodeId) : null;
  const connectionCreateErrors: Record<"llm" | "imageTask" | "videoTask" | "audioTask" | "compare", string | null> = {
    compare: null,
    llm: null,
    imageTask: null,
    videoTask: null,
    audioTask: null,
  };
  if (connectionMenu) {
    for (const kind of ["llm", "imageTask", "videoTask", "audioTask", "compare"] as const) {
      const data = createNodeData(kind, connectionMenu.sourceIds);
      const taskSize = data.kind === "imageTask" || data.kind === "videoTask" || data.kind === "audioTask"
        ? getCanvasTaskResultFrameSize(data)
        : { width: 350, height: 200 };
      const target: CanvasNode = {
        id: `__canvas-connection-${kind}__`,
        type: kind,
        position: connectionMenu.position,
        data,
        width: taskSize.width,
        height: taskSize.height,
      };
      connectionCreateErrors[kind] = connectionMenu.sourceIds
        .map((sourceId) => getCanvasConnectionDecision(
          [...document.nodes, target],
          { source: sourceId, target: target.id },
          document.edges,
        ))
        .find((decision) => !decision.allowed)?.error ?? null;
    }
  }
  if (connectionMenu && connectionMenu.sourceIds.length > 2) {
    connectionCreateErrors.compare = text("workspaceFollowup.m94ba70be6103");
  }
  const connectionMenuSourceKinds = connectionMenu
    ? connectionMenu.sourceIds.map((sourceId) => document.nodes.find((node) => node.id === sourceId)?.data.kind)
    : [];
  if (connectionMenuSourceKinds.some(kind => kind === "image" || kind === "imageTask") && connectionMenuSourceKinds.some(kind => kind === "video" || kind === "videoTask")) {
    connectionCreateErrors.compare = text("workspaceFollowup.m10d1303246a8");
  }
  const connectionMenuSourceLabel = connectionMenuSourceKinds.length > 0 && connectionMenuSourceKinds.every((kind) => kind === "image" || kind === "imageTask")
    ? text("workspaceFollowup.md24c10d37db0")
    : connectionMenuSourceKinds.length > 0 && connectionMenuSourceKinds.every((kind) => kind === "video" || kind === "videoTask")
      ? text("workspaceFollowup.mc20f7618d330")
      : connectionMenuSourceKinds.length > 0 && connectionMenuSourceKinds.every((kind) => kind === "audio" || kind === "audioTask")
        ? text("workspaceFollowup.m296c632ec857")
        : connectionMenuSourceKinds.length > 0 && connectionMenuSourceKinds.every((kind) => kind === "prompt" || kind === "llm")
          ? text("workspaceFollowup.mdd81861811e5")
          : "";
  const connectionMenuTitle = connectionMenu?.sourceIds.length === 1
    ? text("workspaceFollowup.m9f81189742ea")
    : connectionMenu
      ? text("workspaceFollowup.m97f513e5823e", { v0: connectionMenu.sourceIds.length, v1: connectionMenuSourceLabel })
      : "";

  const onPaneDoubleClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (readOnly) return;
    if (handToolActive) return;
    if (!isDeliberateDoubleClick(event)) return;
    const target = event.target as HTMLElement;
    if (!target.classList.contains("react-flow__pane")) return;
    event.preventDefault();
    const menuPoint = clampCanvasMenuPosition(event.clientX, event.clientY);
    setConnectionMenu(null);
    setContextMenu({
      x: menuPoint.x,
      y: menuPoint.y,
      position: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    });
  }, [readOnly, flow, handToolActive]);

  const openDockCreateMenu = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (readOnly) return;
    if (contextMenu?.source === "dock") {
      setContextMenu(null);
      return;
    }
    const canvasBounds = wrapRef.current?.getBoundingClientRect();
    const triggerBounds = event.currentTarget.getBoundingClientRect();
    const canvasCenter = canvasBounds
      ? { x: canvasBounds.left + canvasBounds.width / 2, y: canvasBounds.top + canvasBounds.height / 2 }
      : { x: triggerBounds.left, y: triggerBounds.top };
    setConnectionMenu(null);
    setUtilityPanel(null);
    onCloseWorkflow?.();
    if (libraryOpen) onToggleLibrary?.();
    setContextMenu({
      x: triggerBounds.left,
      y: triggerBounds.top,
      source: "dock",
      position: flow.screenToFlowPosition(canvasCenter),
    });
  }, [readOnly, contextMenu?.source, flow, libraryOpen, onCloseWorkflow, onToggleLibrary]);

  React.useEffect(() => {
    if (workflowOpen) onOpenWorkflow?.(selectedIds);
  }, [workflowOpen, selectedIds, onOpenWorkflow]);

  const toggleWorkflowPanel = React.useCallback(() => {
    setContextMenu(null);
    setConnectionMenu(null);
    setUtilityPanel(null);
    if (libraryOpen) onToggleLibrary?.();
    if (workflowOpen) onCloseWorkflow?.();
    else {
      window.clearTimeout(changeTimer.current);
      changeTimer.current = undefined;
      pendingDocumentRef.current = documentRef.current;
      publishPendingDocument();
      onOpenWorkflow?.(selectedIds);
    }
  }, [libraryOpen, onCloseWorkflow, onOpenWorkflow, onToggleLibrary, publishPendingDocument, selectedIds, workflowOpen]);

  const toggleUtilityPanel = React.useCallback((panel: "shortcuts" | "tools") => {
    setContextMenu(null);
    setConnectionMenu(null);
    onCloseWorkflow?.();
    if (libraryOpen) onToggleLibrary?.();
    setUtilityPanel((current) => current === panel ? null : panel);
    wrapRef.current?.focus({ preventScroll: true });
  }, [libraryOpen, onCloseWorkflow, onToggleLibrary]);

  const contextNodeIds = contextNode ? (selectedIds.includes(contextNode.id) ? selectedIds : [contextNode.id]) : [];
  const contextMediaItems = contextNodeIds.flatMap(mediaItemsForNode);
  const contextGroupMemberIds = contextNodeIds.filter(id => document.nodes.some(node => node.id === id && node.parentId && node.type !== "group"));
  const paneContextRoot = contextMenu?.source === "pane" && contextMenu.view !== "create";
  const createMenuOpen = Boolean(contextMenu && !contextNode && !paneContextRoot);
  const menuPanelLayoutClass = "w-[220px] space-y-1 rounded-2xl p-2.5";
  const createMenuLayoutClass = `${menuPanelLayoutClass} [&>button]:h-12 [&>button]:gap-3 [&>button]:px-1.5 [&>button]:text-sm [&>button>span]:flex [&>button>span]:h-8 [&>button>span]:w-8 [&>button>span]:shrink-0 [&>button>span]:items-center [&>button>span]:justify-center [&>button>span]:rounded-lg [&>button>span]:bg-[var(--panel-2)]`;
  const paneMenuItemClass = "flex h-12 w-full items-center justify-between gap-3 rounded-lg px-1.5 text-left text-sm text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-35";
  const contextMenuPanel = contextMenu && (
    <div
      id={contextMenu.source === "dock" ? "canvas-create-menu" : undefined}
      data-canvas-context-menu
      className={`${contextMenu.source === "dock" ? "absolute bottom-[calc(100%+18.5px)] left-1/2 -translate-x-1/2 nodrag nopan nowheel" : "fixed"} z-[160] ${createMenuOpen || contextNode ? createMenuLayoutClass : menuPanelLayoutClass} border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)]`}
      style={contextMenu.source === "dock" ? undefined : (() => {
        const point = createMenuOpen ? clampCanvasMenuPosition(contextMenu.x, contextMenu.y, 220, 452) : contextNode ? clampCanvasMenuPosition(contextMenu.x, contextMenu.y, 220, contextGroupMemberIds.length ? 336 : 288) : contextMenu;
        return { left: point.x, top: point.y };
      })()}
    >
      {paneContextRoot && <>
        <button type="button" data-canvas-upload disabled={readOnly} onClick={() => { mediaUploadPositionRef.current = contextMenu.position; setContextMenu(null); mediaInputRef.current?.click(); }} className={paneMenuItemClass}><UiText id="canvas.m9e07e3c0532d" /></button>
        <button type="button" data-canvas-open-create disabled={readOnly} onClick={() => setContextMenu({ ...contextMenu, view: "create" })} className={paneMenuItemClass}><UiText id="canvas.m771b4e0346ae" /></button>
        <div role="separator" className="mx-1.5 border-t border-[var(--border)]" />
        <button type="button" disabled={readOnly || !historyRef.current.past.length} onClick={undo} className={paneMenuItemClass}><span><UiText id="canvas.m926a50b98ece" /></span><span className="text-sm text-[var(--app-muted)]">Ctrl + Z</span></button>
        <button type="button" disabled={readOnly || !historyRef.current.future.length} onClick={redo} className={paneMenuItemClass}><span><UiText id="canvas.m03717b6f1070" /></span><span className="text-sm text-[var(--app-muted)]">Ctrl + Shift + Z</span></button>
        <div role="separator" className="mx-1.5 border-t border-[var(--border)]" />
        <button type="button" disabled={readOnly || !clipboard.current?.ids.length || handToolActive} onClick={() => pasteNodes(contextMenu.position)} className={paneMenuItemClass}><span><UiText id="canvas.m335179267471" /></span><span className="text-sm text-[var(--app-muted)]">Ctrl + V</span></button>
      </>}
      {!contextNode && !paneContextRoot && <>
        <div className="flex h-7 items-center px-1.5 text-xs font-medium text-[var(--app-muted)]"><UiText id="canvas.m771b4e0346ae" /></div>
        <button type="button" data-canvas-create-kind="imageTask" onClick={() => addNode("imageTask", { position: contextMenu.position })} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)]"><span><ImagePlus className="h-[18px] w-[18px]" /></span><UiText id="canvas.md24c10d37db0" /></button>
        <button type="button" data-canvas-create-kind="videoTask" onClick={() => addNode("videoTask", { position: contextMenu.position })} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)]"><span><Video className="h-[18px] w-[18px]" /></span><UiText id="canvas.mc20f7618d330" /></button>
        <button type="button" data-canvas-create-kind="audioTask" onClick={() => addNode("audioTask", { position: contextMenu.position })} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)]"><span><Music2 className="h-[18px] w-[18px]" /></span><UiText id="canvas.m296c632ec857" /></button>
        <button type="button" data-canvas-create-kind="llm" onClick={() => addNode("llm", { position: contextMenu.position })} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)]"><span><MessageSquareText className="h-[18px] w-[18px]" /></span><UiText id="canvas.mdd81861811e5" /></button>
        <button type="button" data-canvas-create-kind="compare" onClick={() => addNode("compare", { position: contextMenu.position })} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)]"><span><Columns2 className="h-[18px] w-[18px]" /></span><UiText id="canvas.mbc4b2dbbb77b" /></button>
        <div role="separator" className="mx-1.5 border-t border-[var(--border)]" />
        <div className="flex h-7 items-center px-1.5 text-xs font-medium text-[var(--app-muted)]"><UiText id="canvas.m3e9ebef15b76" /></div>
        <button type="button" data-canvas-upload disabled={readOnly} onClick={() => { mediaUploadPositionRef.current = contextMenu.position; setContextMenu(null); mediaInputRef.current?.click(); }} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-35"><span><Upload className="h-[18px] w-[18px]" /></span><UiText id="canvas.m9e07e3c0532d" /></button>
        <button type="button" data-canvas-open-history disabled={readOnly} onClick={() => { setReplacementTarget(null); setUtilityPanel(null); setContextMenu(null); setGenerationHistoryMounted(true); setGenerationHistoryOpen(true); }} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-35"><span><History className="h-[18px] w-[18px]" /></span><UiText id="canvas.m73c8136b0056" /></button>
      </>}
      {contextNode && <>
        <UiProps ids={{"title":["canvas.mfe8830672457"]}}><button type="button" data-canvas-node-action="save" disabled={readOnly || !contextMediaItems.length} title={!contextMediaItems.length ? "canvas.mfe8830672457" : undefined} onClick={() => { openSaveToLibrary(contextMediaItems); setContextMenu(null); }} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-35"><span><FolderInput className="h-[18px] w-[18px]" /></span><UiText id="canvas.mb45494687e39" /></button></UiProps>
        <div role="separator" className="mx-1.5 border-t border-[var(--border)]" />
        <UiProps ids={{"title":["canvas.maa6788ac0eb1"]}}><button type="button" data-canvas-node-action="copy" title="canvas.maa6788ac0eb1" onClick={() => { clipboard.current = { document: documentRef.current, ids: [...contextNodeIds] }; setContextMenu(null); }} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)]"><span><Copy className="h-[18px] w-[18px]" /></span><UiText id="canvas.mf352dbc5b84e" /></button></UiProps>
        <UiProps ids={{"title":["canvas.m584a18da1bcc"]}}><button type="button" data-canvas-node-action="duplicate" disabled={readOnly} title="canvas.m584a18da1bcc" onClick={() => { duplicate(contextNodeIds, { preserveIncomingEdges: true, placeInFreeSpace: true }); setContextMenu(null); }} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)]"><span><Copy className="h-[18px] w-[18px]" /></span><UiText id="canvas.mbfe958dea679" /></button></UiProps>
        <UiProps ids={{"title":["canvas.m567a1f20babd"]}}><button type="button" data-canvas-node-action="paste" title="canvas.m567a1f20babd" disabled={readOnly || !clipboard.current?.ids.length || handToolActive} onClick={() => pasteNodes(contextMenu.position)} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-35"><span><ClipboardPaste className="h-[18px] w-[18px]" /></span><UiText id="canvas.m335179267471" /></button></UiProps>
        <div role="separator" className="mx-1.5 border-t border-[var(--border)]" />
        <button type="button" data-canvas-node-action="delete" disabled={readOnly} onClick={() => applyRemoval(contextNodeIds, [])} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)]"><span><Trash2 className="h-[18px] w-[18px]" /></span><UiText id="canvas.m2f9daa828907" /></button>
        {contextGroupMemberIds.length > 0 && <button type="button" data-canvas-node-action="move-out-of-group" disabled={readOnly} onClick={() => {
          if (readOnly) return;
          const current = documentRef.current;
          const measured = new Map(current.nodes.map(node => [node.id, flow.getInternalNode(node.id)?.measured ?? {}]));
          const next = contextGroupMemberIds.reduce((result, nodeId) => moveCanvasNodeOutOfGroup(result, nodeId, measured), current);
          if (next !== current) commit(next);
          setSelectedIds(contextGroupMemberIds);
          setContextMenu(null);
          wrapRef.current?.focus({ preventScroll: true });
        }} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-35"><span><FolderInput className="h-[18px] w-[18px]" /></span><UiText id="canvas.mf623c6e3ebce" /></button>}
      </>}
    </div>
  );

  return (
    <CanvasRenderRuntimeProvider interacting={interacting} owner={preferenceOwnerId}>
    <CanvasConnectionDragContext.Provider value={connectionDragInProgress}>
    <CanvasLodProvider>
    <CanvasNodeEditorContext.Provider value={editor}>
    <CanvasNodeSubscriptionsProvider editor={editor} revision={document}>
      <div
        ref={wrapRef}
        data-canvas-tool-mode={handToolActive ? "hand" : "move"}
        tabIndex={-1}
        className="canvas-editor-surface relative h-full min-h-0 w-full bg-[var(--canvas-bg)] outline-none"
        onPointerDownCapture={(event) => {
          suppressEdgeGlowClick.current = false;
          const target = event.target as HTMLElement;
          if (target.closest("input,textarea,[contenteditable='true'],button,[role='dialog'],[role='menu'],[role='listbox']")) return;
          // Cancellation protects only the old pointer cycle, not the next click.
          if (event.button === 0 && !handToolActive) marqueeCancelledRef.current = false;
          wrapRef.current?.focus({ preventScroll: true });
        }}
        onPointerMoveCapture={(event) => {
          pointerPositionRef.current = { x: event.clientX, y: event.clientY };
          const target = event.target as Element;
          canvasPointerMovedAtRef.current = Date.now();
          pointerOverCanvasRef.current = Boolean(target.closest(".canvas-smart-flow")) && !target.closest("input,textarea,select,[contenteditable]:not([contenteditable='false']),button,a,[role='dialog'],[role='menu'],[role='listbox'],[role='slider'],[data-canvas-task-panel]");
          if (!handToolActive) updateCanvasConnectionFeedbackTarget(event);
        }}
        onPointerLeave={() => { pointerOverCanvasRef.current = false; updateConnectionFeedbackTarget(null); }}
        onClickCapture={(event) => {
          if (handToolActive && (event.target as Element).classList.contains("react-flow__pane")) event.stopPropagation();
        }}
        onDoubleClickCapture={onPaneDoubleClick}
        onDrop={onDrop}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
      >
        <input
          ref={mediaInputRef}
          type="file"
          accept="image/*,video/*,audio/*,.md,text/markdown,text/x-markdown"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files || []).filter(isCanvasUploadFile);
            const bounds = wrapRef.current?.getBoundingClientRect();
            const position = mediaUploadPositionRef.current ?? (bounds
              ? flow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
              : { x: 0, y: 0 });
            mediaUploadPositionRef.current = null;
            if (files.length) void uploadFiles(files, position);
            event.target.value = "";
          }}
        />
        <CanvasConnectionHandleClickContext.Provider value={openHandleConnectionMenu}>
        <CanvasAudioPlaybackProvider nodeIds={document.nodes.filter((node) => node.data.kind === "audio" || (node.data.kind === "audioTask" && node.data.status === "success")).map((node) => node.id)}>
        <CanvasSharedEdgeProvider>
        <CanvasEdgeFlowRegistryContext.Provider value={edgeFlowRegistry}>
        <CanvasDragFlow positions={dragPositions}
          className={`canvas-smart-flow${handToolActive ? " canvas-hand-tool" : ""}${selectedIds.length > 1 ? " canvas-multi-selection-active" : ""}${nodeDragInProgress ? " canvas-node-dragging" : ""}${interacting ? " canvas-interacting" : ""}${viewportInteracting && !nodeDragInProgress && !selectionInProgress && !connectionDragInProgress ? " canvas-viewport-moving" : ""}${connectionDragInProgress ? " canvas-connecting" : ""}${edgeFocusActive ? " canvas-edge-focus" : ""}${edgeOverview ? " canvas-edge-overview" : ""}${canvasInteractionLocked ? " pointer-events-none" : ""}`}
          style={{ "--canvas-edge-stroke-width": CANVAS_EDGE_STROKE_WIDTH } as React.CSSProperties}
          nodes={renderNodes}
          edges={edgesHidden ? EMPTY_CANVAS_EDGES : flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onlyRenderVisibleElements={true}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onInit={handleFlowInit}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          isValidConnection={isValidConnection}
          connectionRadius={80}
          elevateEdgesOnSelect={false}
          connectionLineComponent={CanvasConnectionLine}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onSelectionDragStart={handleSelectionDragStart}
          onSelectionDragStop={handleSelectionDragStop}
          onEdgeClick={handleFlowEdgeClick}
          onNodeClick={handleFlowNodeClick}
          onNodeDoubleClick={handleFlowNodeDoubleClick}
          onSelectionChange={onSelectionChange}
          onSelectionStart={handleSelectionStart}
          onSelectionEnd={handleSelectionEnd}
          onPaneClick={handlePaneClick}
          onPaneContextMenu={handlePaneContextMenu}
          onNodeContextMenu={handleFlowNodeContextMenu}
          onSelectionContextMenu={handleSelectionContextMenu}
          onMoveStart={handleMoveStart}
          onMove={handleMove}
          onMoveEnd={handleMoveEnd}
          defaultViewport={initial.viewport}
          selectionOnDrag={!handToolActive}
          selectionKeyCode={handToolActive ? null : "Shift"}
          paneClickDistance={5}
          selectionMode={SelectionMode.Partial}
          panOnDrag={handToolActive ? CANVAS_HAND_PAN_BUTTONS : CANVAS_SELECT_PAN_BUTTONS}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable={true}
          nodesFocusable={true}
          edgesFocusable={true}
          panOnScroll
          panOnScrollSpeed={1}
          autoPanOnNodeFocus={false}
          zoomOnScroll={false}
          zoomOnPinch
          panActivationKeyCode={null}
          multiSelectionKeyCode={CANVAS_MULTI_SELECTION_KEYS}
          snapToGrid={false}
          minZoom={CANVAS_MIN_ZOOM}
          maxZoom={CANVAS_MAX_ZOOM}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
        >
          {!handToolActive && !selectionInProgress && !nodeGestureActive && multiSelectionBounds && (
            <CanvasMultiSelectionToolbar
              bounds={multiSelectionBounds}
              canGroup={!readOnly && selectedFlowNodes.filter(node => !node.parentId).length >= 2}
              canSaveToLibrary={!readOnly && selectedMediaItems.length > 0}
              canDownloadAll={selectedMediaItems.length > 0}
              onGroup={group}
              onStack={stack}
              onSaveToLibrary={() => openSaveToLibrary(selectedMediaItems)}
              onDownloadAll={downloadSelectedMedia}
              videoCount={readOnly ? 0 : selectedVideoNodeIds.length}
              composing={composingVideos}
              onComposeVideos={() => void composeSelectedVideos()}
            />
          )}
          {!readOnly && !handToolActive && !selectionInProgress && connectionSelectionBounds && multiConnectionSources.length >= (selectedConnectionGroup ? 1 : 2) ? (
            <CanvasMultiSelectionConnector
              bounds={connectionSelectionBounds}
              showFrame={!selectedConnectionGroup}
              sources={multiConnectionSources}
              drag={multiConnectionDrag}
              showConnector={!connectionMenu}
              onPointerDown={startMultiConnectionDrag}
            />
          ) : null}
          <CanvasViewportChrome onViewportCommit={commitViewport} hideRecoveryHint={Boolean(contextMenu || utilityPanel)} raiseRecoveryHint={Boolean(actionMessage)} edgesHidden={edgesHidden} snapToGrid={snapToGrid} onToggleEdges={toggleEdges} onToggleSnap={toggleSnapToGrid} />
          <CanvasMediaPrefetch />
          <CanvasEdgeFlowLayer paused={interacting} />
          <CanvasAlignmentGuides guides={alignmentGuides} />
          {arrangementPreview ? (
            <Panel position="bottom-left" data-canvas-arrange-confirmation className="!bottom-[76px] !left-3 !m-0 w-[220px] rounded-[14px] border border-[var(--canvas-controls-border)] bg-[var(--canvas-controls-bg)] p-4 text-[var(--canvas-controls-text)] shadow-[var(--canvas-shadow-dropdown)]">
              <p className="text-[13px] font-medium"><UiText id="canvas.mddc8ffa517b2" /></p>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button type="button" onClick={restoreAutoArrange} className="h-8 rounded-lg px-3 text-xs text-[var(--canvas-controls-text-muted)] transition-colors duration-200 hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-controls-text)]"><UiText id="canvas.mddde08946298" /></button>
                <button type="button" onClick={keepAutoArrange} className="h-8 rounded-lg bg-[var(--canvas-controls-active)] px-3 text-xs font-medium text-[var(--canvas-controls-text)] transition-colors duration-200 hover:brightness-110"><UiText id="canvas.m670ec25af841" /></button>
              </div>
            </Panel>
          ) : null}
          {document.nodes.length === 0 ? (
            <div data-canvas-empty-onboarding className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div className="flex flex-col items-center text-center text-[var(--app-fg)]">
                <p className="text-[16px] font-medium"><UiText id="canvas.mdfb6a2c06ed8" /></p>
                <p className="mt-1 text-[12px] text-[var(--app-muted)]"><UiText id="canvas.m2eb814d2580b" /></p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {([
                    [text("workspaceFollowup.m54f5b35c541e"), "llm"],
                    [text("workspaceFollowup.m0dd7eabb988a"), "imageTask"],
                    [text("workspaceFollowup.m5c78ad195403"), "videoTask"],
                    [text("workspaceFollowup.mce8c82b6b325"), "videoTask"],
                  ] as const).map(([label, kind]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={(event) => { event.stopPropagation(); addNode(kind); }}
                      className="pointer-events-auto rounded-[10px] border border-[var(--canvas-controls-border)] bg-[var(--canvas-controls-bg)] px-3.5 py-2 text-[12px] text-[var(--canvas-controls-text)] shadow-[var(--canvas-shadow-dropdown)] transition-colors hover:bg-[var(--canvas-controls-hover)]"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          <UiProps ids={{"aria-label":["canvas.md4a4d51795cb"]}}><Panel
            position="bottom-center"
            data-canvas-bottom-dock
            role="toolbar"
            aria-label="canvas.md4a4d51795cb"
            style={{ left: "50%", zIndex: 160 }}
            className="!bottom-3 !m-0 flex h-[52px] items-center gap-1 rounded-[14px] border-[0.5px] border-[var(--canvas-controls-border)] bg-[color-mix(in_srgb,var(--canvas-controls-bg)_65%,transparent)] p-1.5 text-[var(--canvas-controls-icon)] shadow-[var(--canvas-shadow-dropdown)] backdrop-blur-md"
          >
            <div className="relative">
              <UiProps ids={{"aria-label":["canvas.m771b4e0346ae"]}}><button type="button" disabled={readOnly} aria-label="canvas.m771b4e0346ae" data-canvas-tooltip={text("workspaceFollowup.m771b4e0346ae")} aria-expanded={contextMenu?.source === "dock"} aria-controls={contextMenu?.source === "dock" ? "canvas-create-menu" : undefined} onClick={openDockCreateMenu} className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-[var(--canvas-controls-active-bg)] text-[var(--canvas-controls-active-fg)] transition-colors hover:brightness-95">
                {contextMenu?.source === "dock" ? <X className="h-[18px] w-[18px]" /> : <Plus className="h-[18px] w-[18px]" />}
              </button></UiProps>
              {contextMenu?.source === "dock" && contextMenuPanel}
            </div>
            <div className="relative">
              <UiProps ids={{"aria-label":["canvas.m5d32bbe03019","canvas.mfc6bb436b8ca"]}}><button ref={toolButtonRef} type="button" data-canvas-tool-trigger aria-label={handToolActive ? "canvas.m5d32bbe03019" : "canvas.mfc6bb436b8ca"} data-canvas-tooltip={handToolActive ? text("workspaceFollowup.m5d32bbe03019") : text("workspaceFollowup.mfc6bb436b8ca")} aria-haspopup="menu" aria-expanded={utilityPanel === "tools"} aria-controls={utilityPanel === "tools" ? "canvas-tool-menu" : undefined} onClick={() => toggleUtilityPanel("tools")} className={`inline-flex h-[38px] w-[38px] items-center justify-center rounded-[10px] transition-colors hover:bg-[var(--canvas-controls-hover)] ${utilityPanel === "tools" ? "bg-[var(--canvas-controls-active)]" : ""}`}>
                {handToolActive ? <Hand className="h-[18px] w-[18px]" /> : <MousePointer2 className="h-[18px] w-[18px]" />}
              </button></UiProps>
              {utilityPanel === "tools" && <CanvasToolMenu mode={toolMode} anchorRef={toolButtonRef} onChange={selectCanvasTool} onClose={closeToolMenu} />}
            </div>
            <UiProps ids={{"aria-label":["canvas.mc71d0bca46eb"]}}><button ref={workflowAnchorRef} type="button" aria-expanded={workflowOpen} aria-controls={workflowOpen ? "canvas-workflow-panel" : undefined} aria-label="canvas.mc71d0bca46eb" data-canvas-tooltip={text("workspaceFollowup.mc71d0bca46eb")} aria-pressed={workflowOpen} onClick={toggleWorkflowPanel} className={`inline-flex h-[38px] w-[38px] items-center justify-center rounded-[10px] transition-colors hover:bg-[var(--canvas-controls-hover)] ${workflowOpen ? "bg-[var(--canvas-controls-active)]" : ""}`}><PackageOpen className="h-[18px] w-[18px]" /></button></UiProps>
            <UiProps ids={{"aria-label":["canvas.m4a8255fdfa4d"]}}><button type="button" aria-label="canvas.m4a8255fdfa4d" data-canvas-tooltip={text("workspaceFollowup.m4a8255fdfa4d")} aria-pressed={generationHistoryOpen} onPointerEnter={() => setGenerationHistoryMounted(true)} onFocus={() => setGenerationHistoryMounted(true)} onClick={() => { setReplacementTarget(null); setUtilityPanel(null); setContextMenu(null); setGenerationHistoryMounted(true); setGenerationHistoryOpen(true); }} className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[10px] transition-colors hover:bg-[var(--canvas-controls-hover)]"><History className="h-[18px] w-[18px]" /></button></UiProps>
            <UiProps ids={{"aria-label":["canvas.mee2638183d3e"]}}><button ref={shortcutButtonRef} type="button" aria-label="canvas.mee2638183d3e" data-canvas-tooltip={text("workspaceFollowup.mee2638183d3e")} aria-pressed={utilityPanel === "shortcuts"} onClick={() => toggleUtilityPanel("shortcuts")} className={`inline-flex h-[38px] w-[38px] items-center justify-center rounded-[10px] transition-colors hover:bg-[var(--canvas-controls-hover)] ${utilityPanel === "shortcuts" ? "bg-[var(--canvas-controls-active)]" : ""}`}><Keyboard className="h-[18px] w-[18px]" /></button></UiProps>
            <UiProps ids={{"aria-label":["canvas.m66e8a0315571"]}}><button type="button" aria-label="canvas.m66e8a0315571" data-canvas-tooltip={text("workspaceFollowup.m66e8a0315571")} aria-pressed={libraryOpen} onClick={toggleLibraryPanel} className={`inline-flex h-[38px] w-[38px] items-center justify-center rounded-[10px] transition-colors hover:bg-[var(--canvas-controls-hover)] ${libraryOpen ? "bg-[var(--canvas-controls-active)]" : ""}`}><Images className="h-[18px] w-[18px]" /></button></UiProps>
          </Panel></UiProps>
          <CanvasEdgeViewport canvasRef={wrapRef} />
          <CanvasSharedEdgeLayer canvasRef={wrapRef} />
        </CanvasDragFlow>
        </CanvasEdgeFlowRegistryContext.Provider>
        </CanvasSharedEdgeProvider>
        </CanvasAudioPlaybackProvider>
        </CanvasConnectionHandleClickContext.Provider>

        {connectionMenu && <>
          <CanvasConnectionMenuPreview menu={connectionMenu} />
          <div data-canvas-connection-menu className={`fixed z-[165] ${createMenuLayoutClass} border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)]`} style={{ left: connectionMenu.x, top: connectionMenu.y }}>
            <div className="flex h-7 items-center px-1.5 text-xs font-medium text-[var(--app-muted)]">{uiLabel(connectionMenuTitle)}</div>
            <button type="button" data-canvas-connection-kind="llm" disabled={Boolean(connectionCreateErrors.llm)} title={(connectionCreateErrors.llm || undefined) && uiError(connectionCreateErrors.llm)} onClick={() => addNode("llm", { position: connectionMenu.position, sourceIds: connectionMenu.sourceIds, sourceHandle: connectionMenu.sourceHandle })} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-35"><span><MessageSquareText className="h-[18px] w-[18px]" /></span><UiText id="canvas.mdd81861811e5" /></button>
            <button type="button" data-canvas-connection-kind="imageTask" disabled={Boolean(connectionCreateErrors.imageTask)} title={(connectionCreateErrors.imageTask || undefined) && uiError(connectionCreateErrors.imageTask)} onClick={() => addNode("imageTask", { position: connectionMenu.position, sourceIds: connectionMenu.sourceIds, sourceHandle: connectionMenu.sourceHandle })} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-35"><span><ImagePlus className="h-[18px] w-[18px]" /></span><UiText id="canvas.md24c10d37db0" /></button>
            <button type="button" data-canvas-connection-kind="videoTask" disabled={Boolean(connectionCreateErrors.videoTask)} title={(connectionCreateErrors.videoTask || undefined) && uiError(connectionCreateErrors.videoTask)} onClick={() => addNode("videoTask", { position: connectionMenu.position, sourceIds: connectionMenu.sourceIds, sourceHandle: connectionMenu.sourceHandle })} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-35"><span><Video className="h-[18px] w-[18px]" /></span><UiText id="canvas.mc20f7618d330" /></button>
            <button type="button" data-canvas-connection-kind="audioTask" disabled={Boolean(connectionCreateErrors.audioTask)} title={(connectionCreateErrors.audioTask || undefined) && uiError(connectionCreateErrors.audioTask)} onClick={() => addNode("audioTask", { position: connectionMenu.position, sourceIds: connectionMenu.sourceIds, sourceHandle: connectionMenu.sourceHandle })} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-35"><span><Music2 className="h-[18px] w-[18px]" /></span><UiText id="canvas.m296c632ec857" /></button>
            <div role="separator" className="mx-1.5 border-t border-[var(--border)]" />
            <button type="button" data-canvas-connection-kind="compare" disabled={Boolean(connectionCreateErrors.compare)} title={connectionCreateErrors.compare || undefined} onClick={() => addNode("compare", { position: connectionMenu.position, sourceIds: connectionMenu.sourceIds, sourceHandle: connectionMenu.sourceHandle })} className="flex w-full items-center rounded-lg text-left text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-35"><span><Columns2 className="h-[18px] w-[18px]" /></span><UiText id="canvas.mbc4b2dbbb77b" /></button>
          </div>
        </>}

        {contextMenu?.source !== "dock" && contextMenuPanel}

        {utilityPanel === "shortcuts" && <CanvasShortcutPanel anchorRef={shortcutButtonRef} onClose={() => { setUtilityPanel(null); wrapRef.current?.focus({ preventScroll: true }); }} />}
        {uploadNotice && <div role="alert" className="pointer-events-none absolute left-1/2 top-6 z-50 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--app-fg)] shadow-[var(--shadow)]">{uiLabel(uploadNotice.message)}</div>}
        {actionMessage && <button type="button" onClick={() => setActionMessage("")} style={{ left: "50%" }} className="absolute bottom-[76px] z-40 -translate-x-1/2 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-2 text-xs text-[var(--app-fg)] shadow-[var(--shadow)]">{uiLabel(actionMessage)}</button>}
      </div>
      {templateNodeId ? (
        <PresetPromptsTrigger
          presentation="assistant"
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setTemplateNodeId(null);
          }}
          hideTrigger
          onApply={applyTemplate}
        />
      ) : null}
      {imageEditor && <ImageEditorModal imageUrl={imageEditor.url} initialMode={imageEditor.mode} onClose={() => { setImageEditor(null); wrapRef.current?.focus({ preventScroll: true }); }} onResult={(urls, mode, sourceFile, sourceSize, media) => addEditedImages(imageEditor.nodeId, urls, mode, sourceFile, sourceSize, media)} />}
      {generationHistoryMounted && <CanvasGenerationHistory key={replacementTarget?.id || "history"} selectionKind={replacementTarget?.kind} open={generationHistoryOpen} owner={preferenceOwnerId} canvasId={canvasId} onClose={() => { setGenerationHistoryOpen(false); setReplacementTarget(null); wrapRef.current?.focus({ preventScroll: true }); }} onAdd={async (items) => {
        if (!items.length) return;
        if (replacementTarget) {
          const item = items[0];
          if (item) {
            try { await applyMediaReplacement(replacementTarget.id, { kind: item.kind, url: item.url, posterUrl: item.posterUrl || undefined }, replacementTarget.outputId); setGenerationHistoryOpen(false); setReplacementTarget(null); }
            catch (error) { setActionMessage(String((error as Error)?.message || error)); }
          }
          return;
        }
        const rect = wrapRef.current?.getBoundingClientRect();
        const center = flow.screenToFlowPosition({ x: (rect?.left || 0) + (rect?.width || 800) / 2, y: (rect?.top || 0) + (rect?.height || 600) / 2 });
        const sizes: Array<{ width: number; height: number }> = [];
        // Limit concurrent metadata requests when importing a large history selection.
        for (let offset = 0; offset < items.length; offset += 4) {
          sizes.push(...await Promise.all(items.slice(offset, offset + 4).map(item => getCanvasUrlMediaNodeSize(item.url, item.kind))));
        }
        if (!wrapRef.current) return;
        const positions = getCanvasLocalUploadPositions(sizes, { x: center.x - sizes[0].width / 2, y: center.y - sizes[0].height / 2 }, documentRef.current.nodes);
        const nodes: CanvasNode[] = items.map((item, index) => ({
          id: id(item.kind), type: item.kind,
          position: positions[index],
          ...sizes[index],
          data: { kind: item.kind, url: item.url, name: item.name, origin: "generated", prompt: item.prompt, model: item.model || undefined, ...(item.kind === "video" ? { posterUrl: item.posterUrl || undefined } : {}) },
        }));
        commit({ ...documentRef.current, nodes: [...documentRef.current.nodes, ...nodes] });
        setSelectedIds(nodes.map(node => node.id));
        for (const node of nodes) if (node.data.kind === "audio") void analyzeAudioUrlCached(node.data.url).then(waveform => hydrateAudioWaveform(node.id, waveform)).catch(() => undefined);
      }} />}
      {preview && <CanvasMediaPreview items={preview.items} initialIndex={preview.index} onClose={() => { setPreview(null); wrapRef.current?.focus({ preventScroll: true }); }} onEdit={readOnly ? undefined : (item) => { setPreview(null); setImageEditor({ nodeId: item.sourceNodeId || item.id, url: item.url, mode: "crop" }); }} onRerun={readOnly ? undefined : (item) => { if (item.sourceNodeId) void runNode(item.sourceNodeId); }} />}
      <CanvasSaveToLibraryDialog open={librarySaveItems.length > 0} items={librarySaveItems} onClose={() => setLibrarySaveItems([])} onSaved={count => { setLibrarySaveItems([]); setActionMessage(`已保存 ${count} 个素材到素材库`); }} />
    </CanvasNodeSubscriptionsProvider>
    </CanvasNodeEditorContext.Provider>
    </CanvasLodProvider>
    </CanvasConnectionDragContext.Provider>
    </CanvasRenderRuntimeProvider>
  );
}

export default function SmartCanvasBoard(props: Props) {
  return <CanvasReadOnlyContext.Provider value={props.readOnly ?? false}><ReactFlowProvider><Inner {...props} /></ReactFlowProvider></CanvasReadOnlyContext.Provider>;
}
