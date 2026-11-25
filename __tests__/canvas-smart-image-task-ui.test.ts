import { verifyMarqueeOverlap } from './helpers/canvas-selection-contract';
import { verifyMarqueePanel } from './helpers/canvas-board-contract-harness';
import { verifyMarqueeModifiersAndCancel } from './helpers/canvas-selection-contract';
import { verifyDragMerge } from './helpers/canvas-board-contract-harness';
import { verifyConnectedTaskPanel } from './helpers/canvas-board-contract-harness';
import { verifyKeyboardCommands } from './helpers/canvas-selection-contract';
import { verifyConnectionPath } from './helpers/canvas-board-contract-harness';

import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const board = read("components/canvas/SmartCanvasBoard.tsx");
const nodeCard = read("components/canvas/CanvasNodeCard.tsx");
const viewportChrome = read("components/canvas/CanvasViewportChrome.tsx");
const generatorShell = read("components/canvas/CanvasGeneratorShell.tsx");
const editor = read("components/canvas/CanvasEditorPage.tsx");
const promptEditor = read("components/ui/prompt-rich-editor.tsx");
const mediaSize = read("lib/canvas/media-size.ts");
const taskReferences = read("lib/canvas/task-references.ts");
const styles = read("app/globals.css");

describe("smart canvas v2 editor UI", () => {
  it("uses React Flow as the single canvas engine", () => {
    expect(board).toContain("<ReactFlow");
    expect(board).toContain("<CanvasViewportChrome");
    expect(viewportChrome).toContain("<MiniMap");
    expect(board).toContain("selectionOnDrag");
    expect(board).toContain("onConnect={onConnect}");
    expect(board).toContain("onConnectStart={onConnectStart}");
    expect(board).toContain("onConnectEnd={onConnectEnd}");
    expect(board).not.toContain("SmartDomBoard");
  });

  it("selects nodes as soon as the marquee overlaps them", async () => { verifyMarqueeOverlap(); });

  it("keeps task panels closed after marquee selection until a node is clicked", async () => { await verifyMarqueePanel(); });

  it("keeps marquee selection modifier-aware and cancels pending updates with Escape", async () => { verifyMarqueeModifiersAndCancel(); expect(board).toContain('cancelCanvasMarqueeSelection()'); });

  it("uses the native React Flow selection frame without a duplicate custom bounds layer", () => {
    expect(board).not.toContain("CanvasMarqueeSelectionBounds");
    expect(board).not.toContain("data-canvas-marquee-selection-bounds");
    expect(styles).toContain(".canvas-smart-flow .react-flow__selection");
    expect(styles).toContain(".canvas-smart-flow .react-flow__nodesselection-rect");
  });

  it("does not maintain a second persistent marquee visibility state", () => {
    expect(board).not.toContain("marqueeSelectionBoundsVisible");
    expect(board).not.toContain("setMarqueeSelectionBoundsVisible");
  });

  it("shows viewport-wide smart guides and applies a single zoom-aware snapping pass", () => {
    expect(board).toContain("resolveCanvasAlignment");
    expect(board).toContain("CanvasSpatialIndex");
    expect(board).toContain("CANVAS_ALIGNMENT_GUIDE_THRESHOLD / Math.max(viewport.zoom, 0.01)");
    expect(board).toContain("start.alignment.get(documentRef.current.nodes)");
    expect(board).toContain("absolute bottom-0 top-0 w-px");
    expect(board).toContain("absolute left-0 right-0 h-px");
    expect(board).toContain("<CanvasAlignmentGuides guides={alignmentGuides} />");
    expect(board).toContain("publishAlignmentGuides(alignment.guides)");
    expect(board).toContain("clearAlignmentGuides()");
    expect(styles).toContain(".canvas-alignment-guide");
    expect(styles).toContain("repeating-linear-gradient");
  });

  it("temporarily hides an open task panel while retaining explicit open state", () => {
    const fixedPanel = nodeCard.slice(nodeCard.indexOf("function ViewportFixedTaskPanel"), nodeCard.indexOf("function TaskWorkspace"));
    const taskWorkspace = nodeCard.slice(nodeCard.indexOf("function TaskWorkspace"), nodeCard.indexOf("function Body"));

    expect(fixedPanel).toContain('position: "absolute"');
    expect(fixedPanel).toContain('top: position?.top ?? "100%"');
    expect(taskWorkspace).toContain("{panelOpen && !(");
    expect(taskWorkspace).toContain("<PersistentTaskPanel");
    expect(taskWorkspace).toContain("dragging");
    expect(taskWorkspace).toContain("isTaskPanelVisible(id)");
    expect(taskWorkspace).toContain("&& !dragging");
  });

  it("keeps generated task node bounds concrete across single and mixed-selection drags", async () => { await verifyDragMerge(); expect(nodeCard).toContain('getCanvasTaskResultFrameSize(data)'); expect(nodeCard).toContain('updateNodeInternals(id)'); });

  it("uses the neutral one-pixel dotted selection surface", () => {
    expect(styles).toContain("background: var(--canvas-selection-bg)");
    expect(styles).toContain("border: 1px dotted var(--canvas-selection-border)");
    expect(styles).toContain("border-radius: 0");
  });

  it("shows the local upload error after a file is dropped on the canvas", () => {
    const uploadFiles = board.slice(board.indexOf("const uploadFiles"), board.indexOf("const onNodesChange"));

    expect(uploadFiles).toContain("const payload = await uploadCanvasMedia(file)");
    expect(uploadFiles).toContain('throw new Error(payload?.error || "上传失败")');
  });

  it("shows local media immediately and settles uploads concurrently", () => {
    const uploadFiles = board.slice(board.indexOf("const uploadFiles"), board.indexOf("const onNodesChange"));

    expect(uploadFiles).toContain("URL.createObjectURL(file)");
    expect(uploadFiles.indexOf("URL.createObjectURL(file)")).toBeLessThan(uploadFiles.indexOf("uploadCanvasMedia(file)"));
    expect(uploadFiles).toContain("await Promise.all(");
    expect(uploadFiles).toContain("settleUpload(nodeId, objectUrl,");
    expect(uploadFiles).toContain("URL.revokeObjectURL(objectUrl)");
    expect(board).toContain("omitPendingCanvasUploads(");
    expect(board).toContain("pendingDocumentRef.current");
  });

  it("uses edge selection instead of a floating scissors control", () => {
    expect(board).not.toContain("EdgeLabelRenderer");
    expect(board).not.toContain('data-canvas-edge-cutter');
    expect(board).toContain("selectedEdgeIds");
    expect(board).toContain("onEdgeClick=");
  });

  it("rejects invalid material and image-task connections with visible drag feedback", () => {
    expect(board).toContain('from "@/lib/canvas/connection-rules"');
    expect(board).toContain("getCanvasConnectionDecision");
    expect(board).toContain("const connectionDecision = getCanvasConnectionDecision");
    expect(board).toContain("return connectionDecision.allowed");
    expect(board).toContain("isValidConnection={isValidConnection}");
    expect(board).toContain("connectionLineComponent={CanvasConnectionLine}");
    expect(board).toContain('connectionStatus === "invalid"');
    expect(board).toContain("无法连接");
  });

  it("disables every create-from-connection action that violates the typed matrix", () => {
    expect(board).toContain("connectionCreateErrors");
    expect(board).toContain("disabled={Boolean(connectionCreateErrors.imageTask)}");
    expect(board).toContain("title={(connectionCreateErrors.imageTask || undefined) && uiError(connectionCreateErrors.imageTask)}");
    expect(board).toContain("disabled:cursor-not-allowed disabled:opacity-35");
  });

  it("renders the dragged connection with themed glow and delayed invalid feedback", async () => {

    await verifyConnectionPath();
  });

  it("keeps the base edge weight while slightly thickening dragged connections", () => {
    expect(board).toContain("const CANVAS_EDGE_STROKE_WIDTH = 2");
    expect(board).toContain('className={`canvas-smart-flow');
    expect(board).toContain('style={{ "--canvas-edge-stroke-width": CANVAS_EDGE_STROKE_WIDTH } as React.CSSProperties}');
    expect(board).not.toContain("strokeWidth: 2.2");
    expect(board).not.toContain("strokeWidth={invalid ? 4.8 : 4.2}");
    expect(styles).toContain(".canvas-smart-flow .react-flow__edge-path");
    expect(styles).toContain("stroke-width: calc(var(--canvas-edge-stroke-width) * var(--canvas-edge-unit, 1px))");
    expect(styles).not.toContain("stroke-width: 3.4");
  });

  it("animates a valid target while an invalid target blacks out immediately", () => {
    expect(nodeCard).toContain("useConnection");
    expect(nodeCard).toContain("connection.toNode?.id === id");
    expect(nodeCard).toContain("data-canvas-connection-target-state");
    expect(nodeCard).toContain("canvas-connection-target-valid");
    expect(nodeCard).toContain("canvas-connection-target-invalid");
    expect(styles).toContain("@keyframes canvas-connection-target-valid");
    expect(styles).not.toContain("@keyframes canvas-connection-target-invalid");
  });

  it("accepts a dragged connection anywhere over a material body without blocking normal interactions", () => {
    expect(nodeCard).toContain("const connectionInProgress = useCanvasConnectionInProgress()");
    expect(nodeCard).toContain("data-canvas-media-body-target");
    expect(board).toContain("connectionRadius={80}");
    expect(nodeCard).toContain("inset: -20");
    expect(nodeCard).toContain('width: "auto", height: "auto", transform: "none"');
    expect(nodeCard).toContain('pointerEvents: connectionInProgress && !uploading ? "auto" : "none"');
    expect(nodeCard).not.toContain("data-canvas-media-target-indicator");
  });

  it("dims an invalid target without a danger outline", () => {
    expect(nodeCard).toContain("canvas-connection-target-invalid-frame");
    expect(styles).toContain(".canvas-connection-target-invalid-frame");
    expect(styles).toContain(".canvas-connection-target-invalid::before");
    expect(styles).toContain("background: rgba(0, 0, 0, 0.35)");
    expect(styles).toContain("backdrop-filter: blur(6px)");
    expect(styles).toContain("opacity: 1");
    expect(styles).toContain("animation: none");
    expect(styles).toContain("outline: 0");
  });

  it("shares the 80px magnetic connection handle across every media node", () => {
    const connectionHandle = readFileSync("components/canvas/CanvasConnectionHandle.tsx", "utf8");
    expect(nodeCard).toContain("CanvasConnectionHandle");
    expect(connectionHandle).toContain("!h-0 !w-0");
    expect(connectionHandle).toContain("CANVAS_CONNECTION_HANDLE_HIT_SIZE");
    expect(connectionHandle).toContain('width="20" height="20" viewBox="0 0 20 20"');
    expect(connectionHandle).toContain("onPointerMove={compact ? undefined : updatePointer}");
    expect(connectionHandle).not.toContain("group-hover");
    expect(connectionHandle).not.toContain("forceVisible");
    expect(nodeCard).toContain('<CanvasConnectionHandle handleId={CANVAS_MEDIA_INPUT_HANDLE_ID} type="target" connectionInProgress={connectionInProgress} acceptsInput={acceptsInput} />');
    expect(nodeCard).toContain('<CanvasConnectionHandle type="source" connectionInProgress={connectionInProgress} />');
    expect(nodeCard).not.toContain("!right-2");
    expect(nodeCard).not.toContain("imageTargetIndicatorClassName");
  });

  it("keeps media target feedback and full-card hit testing in both detail levels", () => {
    expect(nodeCard).toContain("const connectionTargetFrameRef = React.useRef<HTMLDivElement>(null)");
    expect(nodeCard).toContain("updateCanvasConnectionTargetTilt(event, connectionTargetState === \"valid\", connectionTargetFrameRef.current)");
    expect(nodeCard).toContain("ref={connectionTargetFrameRef}");
    expect(nodeCard).toContain("data-canvas-low-detail-node={id}");
    expect(nodeCard).toContain("canvas-low-detail-frame canvas-connection-target");
    expect(nodeCard).toContain('pointerEvents: connectionInProgress ? "auto" : "none"');
  });

  it("extends the single SVG edge path to hidden material handles without DOM splices", () => {
    const materialHandle = readFileSync("components/canvas/CanvasConnectionHandle.tsx", "utf8");
    const defaultEdge = board.slice(board.indexOf("function CanvasDefaultEdge"), board.indexOf("const edgeTypes"));
    const flowEdges = board.slice(board.indexOf("const flowEdges"), board.indexOf("const renderMode"));

    expect(materialHandle).not.toContain("useNodeConnections");
    expect(materialHandle).not.toContain("data-canvas-material-handle-bridge");
    expect(board).not.toContain("CANVAS_MATERIAL_HANDLE_EDGE_OFFSET");
    expect(board).toContain("const CANVAS_MEDIA_BODY_TARGET_EDGE_OFFSET = 20");
    expect(defaultEdge).toContain("const visualData = data as CanvasVisualEdgeData | undefined");
    expect(defaultEdge).toContain("sourceX");
    expect(defaultEdge).not.toContain("sourceInset");
    expect(defaultEdge).toContain("targetX: targetX + (visualData?.targetInset ?? 0)");
    expect(flowEdges).not.toContain("sourceInset:");
    expect(flowEdges).toContain("targetInset:");
    expect(flowEdges).toContain('targetKind === "image" || targetKind === "video" || targetKind === "audio"');
    expect(flowEdges).toContain("edge.targetHandle === CANVAS_MEDIA_INPUT_HANDLE_ID");
    expect(flowEdges).toContain(": CANVAS_MEDIA_BODY_TARGET_EDGE_OFFSET");
  });

  it("shows matching left and right material handles on generated result frames", () => {
    const taskResultFrame = nodeCard.slice(nodeCard.indexOf("function TaskResultFrame"), nodeCard.indexOf("function ImageTaskPanel"));

    expect(taskResultFrame).toContain("const connectionInProgress = useCanvasConnectionInProgress()");
    expect(taskResultFrame).toContain("group/material");
    expect(taskResultFrame).toContain('<CanvasConnectionHandle handleId={CANVAS_TASK_INPUT_HANDLE_ID} type="target" connectionInProgress={connectionInProgress} />');
    expect(taskResultFrame).toContain('<CanvasConnectionHandle type="source" connectionInProgress={connectionInProgress} />');
  });

  it("opens a create-from-connection menu when a source handle is dropped on the empty canvas", async () => { for (const kind of ['imageTask', 'videoTask', 'llm']) await verifyConnectedTaskPanel(kind); });

  it("keeps the source-to-menu preview line visible while choosing a task type", () => {
    expect(board).toContain("function CanvasConnectionMenuPreview");
    expect(board).toContain("data-canvas-connection-menu-line");
    expect(board).toContain("flow.flowToScreenPosition(connectionState.from)");
    expect(board).toContain("x: sourceScreenPoint.x - (bounds?.left ?? 0)");
    expect(board).toContain("x: point.x - (bounds?.left ?? 0)");
    expect(board).not.toContain("from: connectionState.from ??");
    expect(board).toContain("<CanvasConnectionMenuPreview menu={connectionMenu} />");
  });

  it("supports the core editing commands and keyboard paths", async () => { verifyKeyboardCommands(); });

  it("publishes the latest document while React Flow keeps emitting layout changes", () => {
    expect(board).toContain("const pendingDocumentRef = React.useRef(document)");
    expect(board).toContain("if (changeTimer.current !== undefined) return");
    expect(board).toContain("onChangeRef.current?.(omitPendingCanvasUploads(");
    expect(board).toContain("pendingDocumentRef.current");
    expect(board).toContain("changeTimer.current = undefined");
  });

  it("does not postpone persistence forever while document updates keep arriving", () => {
    expect(editor).toContain("if (saveTimer.current !== undefined) return");
    expect(editor).toContain("saveTimer.current = undefined");
    expect(editor).toContain("void drainSaveQueue()");
  });

  it("does not rerender the graph for an unchanged React Flow selection", () => {
    expect(board).toContain("current.every((id, index) => id === next[index])");
    expect(board).toContain("return unchanged ? current : next");
  });

  it("preserves unchanged flow node identities so React Flow keeps measured handles", () => {
    expect(board).toContain("const flowNodeCacheRef = React.useRef(new Map");
    expect(board).toContain("cached?.source === node && cached.selected === selected");
    expect(board).toContain("cached.flow");
    expect(board).toContain('change.type !== "dimensions" || change.setAttributes');
  });

  it("renders all required v2 node kinds through typed node data", () => {
    for (const kind of ["image", "video", "prompt", "imageTask", "videoTask", "llm", "group", "loop", "compare"]) {
      expect(nodeCard).toContain(`data.kind === "${kind}"`);
    }
  });

  it("shows explicit save and revision conflict states", () => {
    expect(editor).toContain("CANVAS_REVISION_CONFLICT");
    expect(editor).toContain("mergeCanvasDocuments");
    expect(editor).toContain("resolveCanvasMergeConflicts");
    expect(editor).toContain("保存失败");
  });

  it("keeps image generation inside canvas APIs", () => {
    const generateRoute = read("app/api/canvas/generate/route.ts");
    const runner = read("components/canvas/run-node.ts");
    expect(generateRoute).toContain("quality:");
    expect(runner).toContain("aspectRatio?: string");
    expect(runner).toContain('fetch("/api/canvas/generate"');
  });

  it("renders image and video tasks as a result frame with a connected-material editor panel", () => {
    const imageTaskPanel = nodeCard.slice(nodeCard.indexOf("function ImageTaskPanel"), nodeCard.indexOf("function VideoTaskPanel"));
    const parameterDock = imageTaskPanel.slice(imageTaskPanel.indexOf("data-canvas-image-parameter-dock"), imageTaskPanel.indexOf("data-canvas-image-parameter-popover"));

    expect(nodeCard).toContain("PromptRichEditor");
    expect(nodeCard).toContain("data-canvas-task-result");
    expect(nodeCard).toContain("data-canvas-task-panel");
    expect(nodeCard).toContain("data-canvas-image-task-bottom-row");
    expect(nodeCard).toContain("data-canvas-image-parameter-dock");
    expect(nodeCard).toContain("data-canvas-image-parameter-popover");
    expect(nodeCard).toContain("CanvasTaskParameterPopover");
    expect(imageTaskPanel).toContain("width={360}");
    expect(nodeCard).toContain("parameterPopoverMaxHeight");
    expect(nodeCard).toContain('className="canvas-task-model-option"');
    expect(nodeCard).not.toContain('className="canvas-task-model-id">{option.value}');
    expect(styles).toContain(".canvas-image-parameter-ratio-grid");
    expect(nodeCard).toContain('import { CanvasAspectRatioIcon } from "./CanvasAspectRatioIcon"');
    expect(read("components/canvas/CanvasAspectRatioIcon.tsx")).toContain("getAspectRatioPreviewSize(value, compact ? 14 : 20)");
    expect(nodeCard).toContain('<CanvasAspectRatioIcon value={option.value} />');
    expect(nodeCard).toContain('<CanvasAspectRatioIcon value={settings.aspectRatio} compact />');
    expect(nodeCard.indexOf(">分辨率</div>")).toBeLessThan(nodeCard.indexOf(">比例</div>"));
    expect(nodeCard).toContain("canvas-task-parameter-bar");
    expect(parameterDock).toContain("whitespace-nowrap");
    expect(parameterDock).not.toContain("truncate");
    expect(nodeCard).toContain("parameterSummary");
    expect(styles).toContain("--canvas-task-param-border: var(--canvas-controls-border)");
    expect(nodeCard).toContain("getTaskAssets");
    expect(nodeCard).toContain("canvasElapsedSeconds");
    expect(nodeCard).toContain("getCanvasTaskResultFrameSize");
    expect(nodeCard).not.toContain("h-[250px]");
    expect(nodeCard).toContain("<CanvasGeneratorShell");
    expect(nodeCard).toContain("min-h-0 flex-1");
    expect(nodeCard).toContain("ViewportFixedTaskPanel");
    expect(nodeCard).toContain("useStore((state) => state.transform[2])");
    expect(nodeCard).toContain("panelOpen && !(");
    expect(nodeCard).toContain("<PersistentTaskPanel");
    expect(nodeCard).toContain("previewOutput(id, latestBatch.id, coverOutput.id)");
    expect(board).toContain('width: taskSize?.width ?? (kind === "prompt" || kind === "llm" ? 350 : 280)');
    expect(board).toContain("selectedIds.length === 1 && selectedIds[0] === nodeId");
    expect(board).toContain("setSelectedIds([])");
  });

  it("does not invent a quality summary when the selected model has no quality options", () => {
    const imageTaskPanel = nodeCard.slice(nodeCard.indexOf("function ImageTaskPanel"), nodeCard.indexOf("function VideoTaskPanel"));
    const parameterSummary = imageTaskPanel.slice(imageTaskPanel.indexOf("const parameterSummary"), imageTaskPanel.indexOf("const optionButtonClass"));

    expect(parameterSummary).not.toContain('"标准画质"');
    expect(parameterSummary).toContain("params.qualities.length ? qualityLabel : null");
  });

  it("previews image outputs only within the selected generation batch", () => {
    const previewMedia = board.slice(board.indexOf("const previewMedia"), board.indexOf("const savePreviewItem"));

    expect(previewMedia).toContain("scopeBatchId?: string");
    expect(previewMedia).toContain("!scopeBatchId || item.batchId === scopeBatchId");
    expect(board).toContain('previewMedia(nodeId, `${nodeId}:${batchId}:${outputId}`, batchId)');
  });

  it("names generated media from successful output order and keeps that name when saving", () => {
    const generatedMedia = board.slice(board.indexOf("const addGeneratedMedia"), board.indexOf("const runImageOutput"));
    const mediaItems = board.slice(board.indexOf("const mediaItemsForNode"), board.indexOf("const previewMedia"));

    expect(board).toContain('from "@/lib/canvas/material-name"');
    expect(generatedMedia).toContain("const name = getNextCanvasMaterialName(current, kind)");
    expect(mediaItems).toContain("getCanvasImageOutputName(documentRef.current, source.id, batch.id, output.id)");
    expect(mediaItems).toContain("getCanvasTaskGeneratedMediaName(documentRef.current, source.id, source.data.outputUrl, \"video\")");
    expect(mediaItems).not.toContain("图片结果-");
    expect(mediaItems).not.toContain("视频结果-");
    expect(mediaItems).toContain("name: getCanvasMediaNodeName(documentRef.current, source.id)");
    expect(board).toContain("saveMediaToLibrary: (nodeId: string) => openSaveToLibrary(mediaItemsForNode(nodeId))");
    expect(mediaItems).toContain("setLibrarySaveItems(unique)");
  });

  it("does not append a generated result or dangling edge after its source node was deleted", () => {
    const generatedMedia = board.slice(board.indexOf("const addGeneratedMedia"), board.indexOf("const runImageOutput"));

    expect(generatedMedia).toContain("if (!source) return;");
    expect(generatedMedia.indexOf("if (!source) return;")).toBeLessThan(generatedMedia.indexOf("const node: CanvasNode"));
  });

  it("renders connected reference thumbnails in the shared 48px ordered strip", () => {
  const connectedAssets = nodeCard.slice(nodeCard.indexOf("function ConnectedAssets"), nodeCard.indexOf("function ToggleButton"));
  const assetsMarker = connectedAssets.indexOf("data-canvas-task-assets");
  const thumbnailRow = connectedAssets.slice(connectedAssets.lastIndexOf("<div", assetsMarker), connectedAssets.indexOf("{hoverPreview &&"));

  expect(thumbnailRow).toContain('className="canvas-reference-strip"');
  expect(thumbnailRow).toMatch(/className="canvas-reference-card(?:\s[^"]*)?"/);
  expect(thumbnailRow).toContain('className="h-full w-full object-cover"');
  expect(styles).toMatch(/\.canvas-reference-card\s*\{[\s\S]*?width:\s*48px;[\s\S]*?height:\s*48px;/);
});

  it("keeps the live generation timer without showing seconds on completed result media", () => {
    const resultFrame = nodeCard.slice(nodeCard.indexOf("function TaskResultFrame"), nodeCard.indexOf("function ImageTaskPanel"));

    expect(resultFrame).toContain("<CanvasGenerationStatus elapsed={elapsed}");
    expect(resultFrame).not.toContain("!running && startedAt");
  });

  it("keeps image, video and LLM task editors on the shared annotated shell", () => {
    const imagePanel = nodeCard.slice(nodeCard.indexOf("function ImageTaskPanel"), nodeCard.indexOf("function VideoTaskPanel"));
    const videoPanel = nodeCard.slice(nodeCard.indexOf("function VideoTaskPanel"), nodeCard.indexOf("function LlmTaskPanel"));

    expect(generatorShell).toContain("CANVAS_GENERATOR_COLLAPSED_WIDTH = 660");
    expect(imagePanel).not.toContain("h-[250px]");
    expect(imagePanel).toContain("canvas-generator-content");
    expect(imagePanel).toContain("min-h-0 flex-1");
    expect(videoPanel).not.toContain("h-[250px]");
    expect(videoPanel).not.toContain("h-[290px]");
    expect(videoPanel).toContain("canvas-generator-content");
    expect(videoPanel).toContain("min-h-0 flex-1");
    expect(videoPanel).toContain("canvas-video-task-footer");
    expect(videoPanel).toContain("canvas-video-advanced-popover");
    expect(videoPanel).toContain("data-canvas-video-parameter-trigger");
    expect(videoPanel).toContain("data-canvas-video-parameter-popover");
    expect(videoPanel).toContain('aria-label="视频生成模式"');
    expect(videoPanel).toContain('aria-label="视频时长"');
    expect(videoPanel).not.toContain('ariaLabel="视频输出格式"');
    expect(videoPanel).not.toContain("min-h-[300px]");
    expect(nodeCard).toContain("React.useState(250)");
  });

  it("limits task-node selection and dragging to visible task surfaces", () => {
    expect(board).toContain('"canvas-task-node-shell"');
    expect(styles).toMatch(/\.react-flow__node\.canvas-task-node-shell\s*\{[\s\S]*?pointer-events:\s*none\s*!important;/);
    expect(styles).toMatch(/\.react-flow__node\.canvas-task-node-shell \[data-canvas-task-result\],[\s\S]*\.react-flow__node\.canvas-task-node-shell \[data-canvas-task-panel\]\s*\{[\s\S]*?pointer-events:\s*auto;/);
  });

  it("keeps the prompt editor stable while task input changes rerender the canvas", () => {
    expect(promptEditor).toContain("const assetSignature = React.useMemo");
    expect(promptEditor).toContain("const stableAssets = React.useMemo(() => assets, [assetSignature])");
    expect(promptEditor).toContain("const roleSkillSignature = React.useMemo");
    expect(promptEditor).toContain("const stableRoleSkills = React.useMemo(() => roleSkills, [roleSkillSignature])");
    expect(promptEditor).toContain("const extensions = React.useMemo");
    expect(promptEditor).toContain("const assetsRef = React.useRef(stableAssets)");
    expect(promptEditor).toContain("assetsRef.current = stableAssets");
    expect(promptEditor).toContain("createAssetMentionExtension(() => assetsRef.current, suggestionsEnabled)");
    expect(promptEditor).toContain("createRoleSkillSuggestionExtension");
    expect(promptEditor).toContain("[extensions]");
    expect(promptEditor).toContain("promptTextToEditorDoc(value, stableAssets, selectedRoleSkill, inlinePresets)");
  });

  it("resolves prompt asset mentions and renders related input edges with three-segment flow", () => {
    const relatedEdgeStyles = styles.slice(
      styles.indexOf(".canvas-smart-flow .react-flow__edge-path"),
      styles.indexOf("@media (prefers-reduced-motion: reduce)", styles.indexOf(".canvas-smart-flow .react-flow__edge-path")),
    );

    expect(board).toContain("buildPromptWithAssetReferences");
    expect(board).toContain("collectCanvasTaskAssets");
    expect(board).toContain('type: "default" as const');
    expect(board).toContain("const curvedEdge");
    expect(board).toContain("canvas-edge-related");
    expect(board).toContain("function CanvasDefaultEdge");
    expect(board).toContain("<BaseEdge");
    expect(board).toContain("canvas-edge-related-flow");
    expect(board).toContain("registerCanvasEdgeFlow(groupRef.current)");
    expect(styles).toContain("canvas-edge-flow-travel 3s linear infinite");
    expect(board).toContain("pathLength={300}");
    expect(board).toContain("strokeWidth={2.5}");
    expect(board).toContain("CANVAS_EDGE_STROKE_WIDTH");
    expect(board).toContain("finishedAt: Date.now()");
    expect(board).toContain("edges={edgesHidden ? EMPTY_CANVAS_EDGES : flowEdges}");
    expect(relatedEdgeStyles).toContain(".canvas-edge-related");
    expect(relatedEdgeStyles).toContain("stroke-width: calc(var(--canvas-edge-stroke-width) * var(--canvas-edge-unit, 1px))");
    expect(relatedEdgeStyles).not.toContain("stroke-dasharray: 18 190");
    expect(relatedEdgeStyles).not.toContain("drop-shadow(0 0 3px");
  });

  it("persists the same initial video parameters that the task panel displays", () => {
    expect(board).toContain('inputMode: "multimodal"');
    expect(board).toContain('resolution: "480p"');
    expect(board).toContain('ratio: "adaptive"');
    expect(board).toContain('duration: -1');
  });

  it("clears stale completion timestamps before retrying an image output", () => {
    expect(board).toContain('status: "submitting", startedAt: Date.now(), finishedAt: undefined');
    expect(board).toContain('status: "idle", startedAt: undefined, finishedAt: undefined');
  });

  it("keeps image task results in the task frame instead of adding duplicate media nodes", () => {
    const imageRunner = board.slice(board.indexOf("const runImageOutput"), board.indexOf("const runVideoNode"));
    expect(imageRunner).toContain("updateImageOutput");
    expect(imageRunner).not.toContain("addGeneratedMedia");
  });

  it("keeps result-frame connection handles outside the clipped media layer", () => {
    expect(nodeCard).toContain("data-canvas-task-result-media");
    expect(nodeCard).not.toContain("relative flex overflow-hidden rounded-xl border");
  });

  it("keeps the selected task result frame neutral instead of drawing a blue border", () => {
    const taskResultFrame = nodeCard.slice(nodeCard.indexOf("function TaskResultFrame"), nodeCard.indexOf("function ImageTaskPanel"));
    expect(taskResultFrame).toContain("canvas-material-frame-selected");
    expect(styles).toContain("border-color: var(--canvas-node-border-selected)");
    expect(taskResultFrame).not.toContain("border-[var(--primary-bg)]");
  });

  it("selects an angle source without opening the result preview and exposes the current toolbar", () => {
    const taskResultFrame = nodeCard.slice(nodeCard.indexOf("function TaskResultFrame"), nodeCard.indexOf("function ImageTaskPanel"));
    expect(taskResultFrame).toContain("<React.Fragment key={output.id}>{primaryCard}</React.Fragment>");
    expect(taskResultFrame).toContain("onClick={() => { setAngleOutputId(output.id); editor?.focusOutput?.(id, output.id); }}");
    expect(taskResultFrame).toContain("data-canvas-angle-source-selected");
    for (const action of ['"crop"', '"brush"', '"grid"']) {
      expect(taskResultFrame).toContain(action);
    }
    for (const removedAction of ['title="扩图"', 'title="遮罩"']) expect(taskResultFrame).not.toContain(removedAction);
  });

  it("uses the submitted batch ratio for completed results and current settings for placeholders", () => {
    const taskResultFrame = nodeCard.slice(nodeCard.indexOf("function TaskResultFrame"), nodeCard.indexOf("function ImageTaskPanel"));

    expect(taskResultFrame).toContain("getCanvasTaskPrimaryFrameSize(data)");
    expect(taskReferences).toMatch(
      /successful\.length\s*\?\s*\(latestBatch\?\.settings\.aspectRatio\s*\|\|\s*data\.task\.settings\.aspectRatio\)\s*:\s*data\.task\.settings\.aspectRatio/,
    );
  });

  it("keeps image task parameters and generation on one bottom row with templates in the top actions", () => {
    const imageTaskPanel = nodeCard.slice(nodeCard.indexOf("function ImageTaskPanel"), nodeCard.indexOf("function VideoTaskPanel"));
    const bottomRow = imageTaskPanel.slice(imageTaskPanel.indexOf("data-canvas-image-task-bottom-row"));

    expect(styles).toContain(".canvas-generator-content");
    expect(styles).toContain("flex-direction: column");
    expect(styles).toContain("gap: 8px");
    expect(bottomRow).toContain("mt-auto flex items-center gap-2");
    expect(bottomRow.indexOf("data-canvas-image-parameter-dock")).toBeGreaterThanOrEqual(0);
    expect(imageTaskPanel.indexOf("<GeneratorActions")).toBeLessThan(imageTaskPanel.indexOf("data-canvas-image-task-bottom-row"));
    expect(bottomRow.indexOf("editor?.runNode")).toBeGreaterThan(bottomRow.indexOf("data-canvas-image-parameter-dock"));
    const parameterDock = imageTaskPanel.slice(imageTaskPanel.indexOf("data-canvas-image-parameter-dock"), imageTaskPanel.indexOf("data-canvas-image-parameter-popover"));
    expect(parameterDock).not.toContain("border-[var(--canvas-task-param-border)]");
  });
});
