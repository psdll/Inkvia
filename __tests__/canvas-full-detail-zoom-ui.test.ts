import { verifyConnectedTaskPanel, verifyTaskClickFocus, verifyImmediateTaskClick } from './helpers/canvas-board-contract-harness';
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");
const nodeCard = readFileSync("components/canvas/CanvasNodeCard.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");

describe("canvas viewport virtualization and detail", () => {
  it.each(["imageTask", "videoTask", "audioTask", "llm"])("closes the immediately opened %s task panel when double-clicking to focus", async kind => {
    await verifyTaskClickFocus(kind);
  });

  it("closes an already open task panel when double-clicking to focus", async () => {
    await verifyTaskClickFocus("imageTask", true);
  });

  it.each(["imageTask", "videoTask", "audioTask", "llm"])("opens %s immediately and never reopens it after multi-selection", verifyImmediateTaskClick);

  it("keeps complete nodes and only hides edges through the explicit visibility toggle", () => {
    expect(board).toContain("nodes={renderNodes}");
    expect(board).toContain("edges={edgesHidden ? EMPTY_CANVAS_EDGES : flowEdges}");
    expect(board).toContain("onlyRenderVisibleElements={true}");
    expect(board).not.toContain("CanvasOverviewNode");
    expect(board).not.toContain("CanvasOverviewLayer");
    expect(board).not.toContain("selectCanvasRenderMode");
    expect(board).not.toContain("renderedFlowNodes");
    expect(board).not.toContain("renderedFlowEdges");
  });

  it("does not rerender React state on every zoom frame", () => {
    expect(board).not.toContain("renderViewport");
    expect(board).not.toContain("updateRenderViewport");
    expect(board).not.toContain("viewportFrameRef");
    expect(board).not.toContain("pendingViewportRef");
  });

  it("subscribes node LOD to three zoom zones and renders 100px previews below 14 percent", () => {
    expect(nodeCard).toContain("function useCanvasExtremeLod");
    expect(nodeCard).toContain("getCanvasLodZone(state.transform[2])");
    expect(nodeCard).toContain('resolveCanvasLodZone(deferredZone, previous.current)');
    expect(nodeCard).toContain("function CanvasNodeLowDetail");
    expect(nodeCard).toContain("data-canvas-low-detail");
    expect(nodeCard).toContain("thumbnailSize={100}");
    expect(nodeCard).toContain("canvas-low-detail-video-skeleton");
    expect(nodeCard).not.toContain("useStore((state) => resolveCanvasLod(state.transform[2]");
  });

  it("keeps active source and target nodes at full detail", () => {
    const connectionDetail = nodeCard.slice(
      nodeCard.indexOf("const connectionTouchesNode"),
      nodeCard.indexOf("const supportsLowDetail"),
    );

    expect(nodeCard).toContain("selected || Boolean(dragging)");
    expect(nodeCard).toContain("hasCanvasNodeActiveDetail(data)");
    expect(connectionDetail).toContain("connection.fromNode?.id === id");
    expect(connectionDetail).not.toContain("connection.toNode?.id === id");
    expect(nodeCard).toContain('useCanvasExtremeLod(!supportsLowDetail || preserveFullDetail)');
    expect(nodeCard).toContain('status === "failed"');
    expect(nodeCard).toContain('status === "submitting" || status === "running"');
  });

  it("keeps node hover independent from edge hover", () => {
    expect(board).not.toContain("hoveredNodeId");
    expect(board).not.toContain("hoveredEdgeId");
    expect(board).toContain('"canvas-edge-hovered"');
    expect(board).not.toContain('"canvas-edge-muted"');
    expect(board).toContain("data-canvas-edge-interactive");
  });

  it("keeps unrelated edges at their normal opacity while highlighting hovered edges", () => {
    expect(styles).not.toContain(".react-flow__edge.canvas-edge-related.canvas-edge-muted");
    expect(styles).not.toContain("opacity: 0.22");
    expect(styles).toContain(".react-flow__edge.canvas-edge-related .canvas-edge-hovered .canvas-edge-related-base");
    expect(styles).toContain("transition: opacity 160ms ease");
    expect(styles).toContain("var(--primary-bg)");
  });

  it("opens the existing panel when a single task node is clicked", async () => {

    for (const kind of ["imageTask", "videoTask", "llm"]) await verifyConnectedTaskPanel(kind);
  });
});
