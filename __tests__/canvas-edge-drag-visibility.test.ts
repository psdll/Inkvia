import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");
const card = readFileSync("components/canvas/CanvasNodeCard.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");

describe("canvas edge visibility while dragging nodes", () => {
  it("keeps measured node geometry and the complete edge graph available while dragging", () => {
    const reactFlow = board.slice(
      board.indexOf("<CanvasDragFlow positions={dragPositions}"),
      board.indexOf("</CanvasDragFlow>"),
    );
    const flowNodeAdapter = board.slice(
      board.indexOf("function toFlowNode"),
      board.indexOf("function toCanvasNode"),
    );

    expect(reactFlow).toContain("nodes={renderNodes}");
    expect(reactFlow).toContain("edges={edgesHidden ? EMPTY_CANVAS_EDGES : flowEdges}");
    expect(reactFlow).toContain("onlyRenderVisibleElements={true}");
    expect(flowNodeAdapter).toContain("getCanvasFlowGeometry(node)");
    expect(board).toContain("if (!hasVisibleEndpoint)");
    expect(board).toContain("data-canvas-edge-passive");
    expect(board).toContain("(animated || hovered) && !interacting");
    expect(board).toContain("hovered && !interacting");
  });

  it("hides only the animated edge glow while a node is being dragged", () => {
    const reactFlow = board.slice(
      board.indexOf("<CanvasDragFlow positions={dragPositions}"),
      board.indexOf("</CanvasDragFlow>"),
    );

    expect(board).toContain(
      "const nodeDragInProgress = nodeGestureActive || renderNodes.some((node) => Boolean(node.dragging))",
    );
    expect(reactFlow).toContain(
      '${nodeDragInProgress ? " canvas-node-dragging" : ""}',
    );
    expect(reactFlow).toContain(
      '${canvasInteractionLocked ? " pointer-events-none" : ""}`}',
    );
    expect(styles).toContain(
      ".canvas-smart-flow.canvas-node-dragging .canvas-edge-related-flow",
    );
    expect(styles).toContain("display: none");
    expect(styles).not.toContain(
      ".canvas-smart-flow.canvas-node-dragging .canvas-edge-related-base",
    );
  });

  it("preserves target and source handles when low-detail content replaces players", () => {
    const lowDetail = card.slice(card.indexOf("function CanvasNodeLowDetail"), card.indexOf("function CanvasNodeCard"));

    expect(lowDetail).toContain("CanvasConnectionHandle");
    expect(lowDetail).toContain("CANVAS_MEDIA_INPUT_HANDLE_ID");
    expect(lowDetail).toContain('type="target"');
    expect(lowDetail).toContain('type="source"');
    expect(lowDetail).toContain("previewOnly");
  });
});
