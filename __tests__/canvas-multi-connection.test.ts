import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";
import * as connectionRules from "@/lib/canvas/connection-rules";
import * as canvasGraph from "@/lib/canvas/graph";
import type { CanvasEdge, CanvasNode } from "@/lib/canvas/document";

type MultiConnectResult = { connected: boolean; edges: CanvasEdge[] };
type MultiConnect = (
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  sourceIds: readonly string[],
  targetId: string | null,
  createEdgeId: () => string,
) => MultiConnectResult;

const connectSelection = (connectionRules as unknown as {
  connectCanvasNodeSelection?: MultiConnect;
}).connectCanvasNodeSelection;
const marqueeIntersectsNode = (canvasGraph as unknown as {
  doesCanvasMarqueeIntersectNode?: (
    selection: { x: number; y: number; width: number; height: number },
    node: { x: number; y: number; width: number; height: number },
  ) => boolean;
}).doesCanvasMarqueeIntersectNode;
const expandSelectionBounds = (canvasGraph as unknown as {
  expandCanvasMultiSelectionBounds?: (
    bounds: { x: number; y: number; width: number; height: number },
    padding: number,
  ) => { x: number; y: number; width: number; height: number };
}).expandCanvasMultiSelectionBounds;

const imageNode = (id: string): CanvasNode => ({
  id,
  type: "image",
  position: { x: 0, y: 0 },
  data: { kind: "image", url: `/${id}.png` },
});

const videoTaskNode = (id: string): CanvasNode => ({
  id,
  type: "videoTask",
  position: { x: 500, y: 0 },
  data: { kind: "videoTask", model: "test", prompt: "", mediaPaths: [], status: "idle" },
});

const videoNode = (id: string): CanvasNode => ({
  id,
  type: "video",
  position: { x: 800, y: 0 },
  data: { kind: "video", url: `/${id}.mp4` },
});

describe("canvas multi-selection connection", () => {
  it("exposes one shared all-or-nothing connection operation", () => {
    expect(connectSelection).toBeTypeOf("function");
  });

  it("creates one edge from every selected source to the dropped target", () => {
    if (!connectSelection) return;
    const nodes = [imageNode("image-a"), imageNode("image-b"), videoTaskNode("video-task")];
    let edgeNumber = 0;

    const result = connectSelection(nodes, [], ["image-a", "image-b"], "video-task", () => `edge-${++edgeNumber}`);

    expect(result.connected).toBe(true);
    expect(result.edges).toEqual([
      { id: "edge-1", source: "image-a", target: "video-task", targetHandle: null, type: "default" },
      { id: "edge-2", source: "image-b", target: "video-task", targetHandle: null, type: "default" },
    ]);
  });

  it("does not create a partial batch when one selected source is incompatible or the drop is blank", () => {
    if (!connectSelection) return;
    const imageTask: CanvasNode = {
      id: "image-task",
      type: "imageTask",
      position: { x: 500, y: 0 },
      data: {
        kind: "imageTask",
        task: {
          references: [],
          settings: {
            model: "test",
            prompt: "",
            aspectRatio: "1:1",
            resolution: "1K",
            quality: "standard",
            count: 1,
          },
          batches: [],
        },
      },
    };
    const video: CanvasNode = {
      id: "video",
      type: "video",
      position: { x: 0, y: 200 },
      data: { kind: "video", url: "/video.mp4" },
    };
    const existing: CanvasEdge[] = [{ id: "existing", source: "image-a", target: "image-task", type: "default" }];

    const incompatible = connectSelection(
      [imageNode("image-a"), video, imageTask],
      existing,
      ["image-a", "video"],
      "image-task",
      () => "unused",
    );
    const blank = connectSelection([imageNode("image-a"), imageTask], existing, ["image-a"], null, () => "unused");

    expect(incompatible).toEqual({ connected: false, edges: existing });
    expect(blank).toEqual({ connected: false, edges: existing });
  });

  it("uses the same full-frame media target handle as a single-node connection", () => {
    if (!connectSelection) return;
    const result = connectSelection(
      [videoTaskNode("video-task-a"), videoTaskNode("video-task-b"), videoNode("video-target")],
      [],
      ["video-task-a", "video-task-b"],
      "video-target",
      () => "edge",
    );

    expect(result.connected).toBe(true);
    expect(result.edges).toEqual([
      { id: "edge", source: "video-task-a", target: "video-target", targetHandle: "canvas-media-body-target", type: "default" },
      { id: "edge", source: "video-task-b", target: "video-target", targetHandle: "canvas-media-body-target", type: "default" },
    ]);
  });

  it("renders the selected group with a visible dashed frame and a fixed-screen connector outside it", () => {
    const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");
    const handle = readFileSync("components/canvas/CanvasConnectionHandle.tsx", "utf8");
    const styles = readFileSync("app/globals.css", "utf8");

    expect(expandSelectionBounds).toBeTypeOf("function");
    expect(expandSelectionBounds?.({ x: 100, y: 120, width: 200, height: 300 }, 80)).toEqual({
      x: 20,
      y: 40,
      width: 360,
      height: 460,
    });
    expect(board).toContain("function CanvasMultiSelectionConnector");
    expect(board).toContain("data-canvas-multi-selection-frame");
    expect(board).toContain("CANVAS_MULTI_SELECTION_FRAME_PADDING = 80");
    expect(board).toContain("CANVAS_MULTI_SELECTION_CONNECTOR_ROOT_OVERLAP_PX = 2");
    expect(board).toContain("const frameScreenRight = viewportTransform[0] + (bounds.x + bounds.width) * viewportTransform[2]");
    expect(board).toContain("? connectorScreenX - CANVAS_CONNECTION_HANDLE_HIT_SIZE / 2");
    expect(board).toContain(": frameScreenRight - CANVAS_MULTI_SELECTION_CONNECTOR_ROOT_OVERLAP_PX");
    expect(board).toContain("data-canvas-multi-selection-connector");
    expect(board).toContain("data-canvas-multi-selection-preview-line");
    expect(board).toContain("CanvasEdgeFlowSegments");
    expect(board).toContain("startMultiConnectionDrag");
    expect(board).toContain("elementsFromPoint(clientX, clientY)");
    expect(board).toContain("<CanvasConnectionHandleSurface");
    expect(board).toContain("const viewportTransform = useStore((state) => state.transform)");
    expect(board).toContain("const connectorScreenX = viewportTransform[0] + connector.x * viewportTransform[2]");
    expect(board).toContain("const connectorScreenY = viewportTransform[1] + connector.y * viewportTransform[2]");
    expect(board).toContain("visualSize={24}");
    expect(board).toContain("plusSize={10}");
    expect(board).toContain("alwaysVisible");
    expect(board).not.toContain("visualSize={32}");
    expect(handle).toContain("export function CanvasConnectionHandleSurface");
    expect(handle).toContain("plusSize = 7");
    expect(handle).toContain('opacity: alwaysVisible ? 1 : "var(--canvas-handle-opacity, 0)"');
    expect(styles).toContain(".canvas-multi-selection-frame");
    expect(styles).toContain("border: 2px dashed var(--canvas-selection-border)");
    expect(styles).toMatch(/\.canvas-multi-selection-preview\s*\{[\s\S]*?z-index:\s*3;/);
    expect(styles).toContain(".canvas-multi-selection-active .react-flow__node.selected .canvas-material-frame");
    expect(styles).toContain(".canvas-multi-selection-connector");
    expect(styles).not.toContain("--canvas-multi-selection-connector-size: 32px");
  });

  it("waits until marquee release before rendering the settled multi-selection frame", () => {
    const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");

    expect(board).toContain("onSelectionStart");
    expect(board).toContain("setSelectionInProgress(true)");
    expect(board).toContain("onSelectionEnd");
    expect(board).toContain("setSelectionInProgress(false)");
    expect(board).toContain("!selectionInProgress && connectionSelectionBounds && multiConnectionSources.length >= (selectedConnectionGroup ? 1 : 2)");
  });

  it("opens the existing connection creation menu when a selected group is dropped on blank canvas", () => {
    const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");
    const dragStart = board.indexOf("const startMultiConnectionDrag");
    const menuErrors = board.indexOf("const connectionCreateErrors", dragStart);
    const multiDragImplementation = board.slice(dragStart, menuErrors);

    expect(board).toContain("sourceIds: string[]");
    expect(board).toContain("from: Array<{ x: number; y: number }>");
    expect(board).toContain("menu.from.map((from)");
    expect(multiDragImplementation).toContain("setConnectionMenu({");
    expect(multiDragImplementation).toContain("react-flow__pane");
    expect(multiDragImplementation).not.toContain("if (!result.connected) setSelectedIds([])");
    expect(board).toContain("引用选中的 ${connectionMenu.sourceIds.length} 个${connectionMenuSourceLabel}节点");
    expect(board).toContain("sourceIds: connectionMenu.sourceIds");
    expect(board).toContain("connectCanvasNodeSelection(");
  });

  it("hides the group connector while its creation menu is open just like a single-node connection", () => {
    const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");

    expect(board).toContain("showConnector?: boolean");
    expect(board).toContain("showConnector={!connectionMenu}");
    expect(board).toContain("{showConnector ? (");
    expect(board).toContain("<CanvasConnectionMenuPreview menu={connectionMenu} />");
    expect(board).not.toContain("multiSelectionConnectorDrag");
  });

  it("treats selected source nodes as neutral space and opens the creation menu when dropped on one", () => {
    const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");
    const dragStart = board.indexOf("const startMultiConnectionDrag");
    const menuErrors = board.indexOf("const connectionCreateErrors", dragStart);
    const multiDragImplementation = board.slice(dragStart, menuErrors);

    expect(multiDragImplementation).toContain("const hoveredTargetId = getTargetId(pointerEvent)");
    expect(multiDragImplementation).toContain("!sourceIds.includes(hoveredTargetId)");
    expect(multiDragImplementation).toContain("const droppedOnSelectedSource = Boolean(hoveredTargetId && sourceIds.includes(hoveredTargetId))");
    expect(multiDragImplementation).toContain("const targetId = droppedOnSelectedSource ? null : hoveredTargetId");
    expect(multiDragImplementation).toContain("droppedOnSelectedSource || ownerDocument");
    expect(multiDragImplementation).toContain("setConnectionMenu({");
  });

  it("ends multi-selection after a selected group connects to an existing node", () => {
    const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");
    const dragStart = board.indexOf("const startMultiConnectionDrag");
    const connectedBranchStart = board.indexOf("if (result.connected) {", dragStart);
    const connectedBranchEnd = board.indexOf("const droppedOnPane", connectedBranchStart);
    const connectedBranch = board.slice(connectedBranchStart, connectedBranchEnd);

    expect(connectedBranch).toContain("commit(syncCanvasTaskPromptsWithEdges(documentRef.current, result.edges))");
    expect(connectedBranch).toContain("setSelectedIds([])");
  });

  it("shares the single-node connection-in-progress state with every node surface", () => {
    const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");
    const card = readFileSync("components/canvas/CanvasNodeCard.tsx", "utf8");
    const textNode = readFileSync("components/canvas/CanvasTextNode.tsx", "utf8");

    expect(board).toContain("const multiConnectionInProgress = multiConnectionDrag !== null");
    expect(board).toContain("connectionInProgress: multiConnectionInProgress");
    expect(card).toContain("connectionInProgress: boolean");
    expect(card).toContain("function useCanvasConnectionInProgress()");
    expect(card.match(/const connectionInProgress = useCanvasConnectionInProgress\(\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(textNode).toContain("connectionInProgressOverride?: boolean");
    expect(textNode).toContain("xyflowConnectionInProgress || Boolean(connectionInProgressOverride)");
  });

  it("selects a material as soon as the marquee overlaps it instead of requiring full containment", () => {
    expect(marqueeIntersectsNode).toBeTypeOf("function");
    if (!marqueeIntersectsNode) return;

    expect(marqueeIntersectsNode(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 90, y: 90, width: 40, height: 40 },
    )).toBe(true);
    expect(marqueeIntersectsNode(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 100, y: 20, width: 40, height: 40 },
    )).toBe(false);

    const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");
    expect(board).toContain("selectionMode={SelectionMode.Partial}");
    expect(board).toContain("createMarqueeIndex");
  });
});
