import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CANVAS_EDGE_CUT_BUTTON_SIZE_PX,
  CANVAS_EDGE_CUT_HIT_WIDTH_PX,
  CANVAS_EDGE_CUT_ICON_SIZE_PX,
  getCanvasEdgeCutWorldGeometry,
} from "@/lib/canvas/edge-cut-geometry";

const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");

describe("canvas edge selection and reconnect contract", () => {
  it("keeps edge selection transient while wiring multi-select and keyboard deletion", () => {
    const edgesChange = board.slice(board.indexOf("const onEdgesChange"), board.indexOf("const isValidConnection"));
    const selectionChange = board.slice(board.indexOf("const onSelectionChange"), board.indexOf("const getTaskAssets"));
    const remove = board.slice(board.indexOf("const applyRemoval ="), board.indexOf("const group ="));

    expect(board).toContain("const [selectedEdgeIds, setSelectedEdgeIds]");
    expect(edgesChange).toContain('change.type === "select"');
    expect(remove).toContain("selectedEdgeIds");
    expect(remove).toContain("syncCanvasTaskAssetChanges");
    expect(remove).toContain("const current = documentRef.current");
    expect(board).toContain("onEdgeClick=");
    expect(board).toContain("data-canvas-edge-interactive");
    expect(board).not.toContain("setHoveredEdgeId");
    expect(selectionChange).toContain("if (!marquee) return");
    expect(selectionChange).not.toContain("const nextEdges = edges.map");
  });

  it("uses disconnect affordances without rendering endpoint reconnect handles", () => {
    expect(board).not.toContain("reconnectEdge");
    expect(board).not.toContain("const onReconnect:");
    expect(board).not.toContain("onReconnect={onReconnect}");
    expect(board).not.toContain("reconnectRadius=");
    expect(board).toContain("reconnectable: false");
    expect(board).not.toContain('setActionMessage("连线已断开")');
    expect(board).toContain("deleteKeyCode={null}");
  });

  it("keeps the hover-to-cut edge affordance", () => {
    expect(board).toContain("Scissors");
    expect(board).toContain("const CANVAS_EDGE_CUT_HOVER_DELAY_MS = 1000");
    expect(board).toContain("const CANVAS_EDGE_CUT_LEAVE_DELAY_MS = 120");
    expect(board).toContain("const CANVAS_EDGE_CUT_EXIT_DURATION_MS = 150");
    expect(board).toContain("getCanvasEdgePointLookup");
    expect(board).toContain("getCanvasEdgeCutWorldGeometry()");
    expect(board).toContain("const matrix = path.getScreenCTM()");
    expect(board).toContain("const [hovered, setHovered] = React.useState(false)");
    expect(board).not.toContain("hovered: edgeHovered");
    expect(board).toContain("data-canvas-edge-cut-hit-area");
    expect(board).toContain("data-canvas-edge-cut-button");
    expect(board).toContain("onPointerMove={handleCutHitEnter}");
    expect(board).toContain("onPointerDown={stopCutButtonPointerDown}");
    expect(board).toContain("visualData?.onDisconnect?.(id)");
    expect(board).toContain("const disconnectEdgeById = React.useCallback");
    expect(board).toContain("onDisconnect: disconnectEdgeById");
    expect(board).toContain("bg-[rgba(30,30,30,0.95)]");
    expect(board).toContain("border-[rgba(255,255,255,0.1)]");
    expect(board).toContain("text-[rgba(255,255,255,0.7)]");
    expect(board).toContain("-rotate-[115deg]");
    expect(board).toContain('cutVisible ? "scale(1)" : "scale(0.7)"');
    expect(board).toContain('pointerEvents: cutVisible ? "auto" : "none"');
  });

  it("scales the hit band and scissors with canvas zoom, including overview mode", () => {
    expect(CANVAS_EDGE_CUT_HIT_WIDTH_PX).toBe(20);
    expect(CANVAS_EDGE_CUT_BUTTON_SIZE_PX).toBe(48);
    expect(CANVAS_EDGE_CUT_ICON_SIZE_PX).toBe(28);

    for (const zoom of [0.1, 0.2, 0.33, 1, 2, 8]) {
      const geometry = getCanvasEdgeCutWorldGeometry();
      expect(geometry.hitWidth * zoom).toBeCloseTo(20 * zoom);
      expect(geometry.buttonSize * zoom).toBeCloseTo(CANVAS_EDGE_CUT_BUTTON_SIZE_PX * zoom, 6);
      expect(geometry.iconSize * zoom).toBeCloseTo(CANVAS_EDGE_CUT_ICON_SIZE_PX * zoom, 6);
    }
  });
});
