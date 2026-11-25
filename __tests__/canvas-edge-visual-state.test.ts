import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");
const styles = readFileSync("app/globals.css", "utf8");

describe("canvas edge visual states", () => {
  it("lets all solid edge states shrink with the canvas without a screen-space floor", () => {
    expect(styles).not.toContain("--canvas-edge-min-stroke-width");
    expect(styles).toMatch(/\.react-flow__edge\.canvas-edge-related \.canvas-edge-related-base,\s*\[data-canvas-shared-passive-edge\]\s*\{[^}]*stroke-width: calc\(var\(--canvas-edge-stroke-width\) \* var\(--canvas-edge-unit, 1px\)\)/);
    expect(styles).toMatch(/\.canvas-edge-selected \.canvas-edge-related-base,\s*\[data-canvas-shared-passive-edge\]\[aria-selected="true"\]\s*\{[^}]*stroke-width: calc\(2 \* var\(--canvas-edge-unit, 1px\)\)/);
    expect(styles).toMatch(/\.canvas-edge-hovered \.canvas-edge-related-base\s*\{[^}]*stroke-width: calc\(4 \* var\(--canvas-edge-unit, 1px\)\)/);
  });

  it("uses world-space line weight and semantic colors for every edge state", () => {
    const defaultEdge = board.slice(
      board.indexOf("function CanvasDefaultEdge"),
      board.indexOf("const edgeTypes"),
    );
    const flowEdges = board.slice(
      board.indexOf("const flowEdges"),
      board.indexOf("const renderMode"),
    );

    expect(defaultEdge).toContain('className="canvas-edge-related-base"');
    expect(defaultEdge).not.toContain('className={animated ? "canvas-edge-related-base" : undefined}');
    expect(defaultEdge).toContain("<CanvasEdgeFlowSegments");
    expect(defaultEdge).toContain("edgeId={id}");
    expect(board).toContain("const CANVAS_EDGE_STROKE_WIDTH = 2");
    expect(defaultEdge).not.toContain("vectorEffect");
    expect(styles).not.toContain("vector-effect: non-scaling-stroke");
    expect(flowEdges).toContain('"canvas-edge-related"');
    expect(defaultEdge).toContain('"canvas-edge-hovered"');
    expect(flowEdges).toContain('"canvas-edge-selected"');
    expect(flowEdges).not.toContain('"canvas-edge-reconnecting"');
    expect(flowEdges).not.toContain('"canvas-edge-muted"');
    expect(flowEdges).toContain('"var(--canvas-edge-selected)"');
    // 发光的相关连线底线保持暗色，只由流光表达关系
    expect(flowEdges).not.toContain('"var(--canvas-edge-related)"');
    expect(flowEdges).toContain('"var(--canvas-edge)"');
    expect(flowEdges).toContain(
      "const selectedRelated = selected.has(edge.source) || selected.has(edge.target)",
    );
    expect(flowEdges).toContain("const edgeSelected = selectedEdgeIds.includes(edge.id)");
    expect(board).not.toContain("hoveredEdgeId");
    expect(styles).not.toContain("transition: stroke 200ms ease, stroke-width 200ms ease");
    expect(flowEdges).not.toContain("reconnectingEdgeId");
    expect(flowEdges).not.toContain("relatedTaskIds.has(edge.target)");
    const flow = board.slice(board.indexOf("export function CanvasEdgeFlowSegments"), board.indexOf("function CanvasConnectionPreviewPath"));
    expect(flow).not.toContain("requestAnimationFrame");
    expect(flow).not.toContain("setGeometry");
    expect(flow).toContain("pathLength={300}");
    expect(styles).toContain("canvas-edge-flow-travel 3s linear infinite");
    expect(board).toContain("strokeWidth={2.5}");
  });

  it("keeps the screen-space connection menu preview at the same world-space weight", () => {
    const preview = board.slice(
      board.indexOf("function CanvasConnectionMenuPreview"),
      board.indexOf("function CanvasDefaultEdge"),
    );
    const connectEnd = board.slice(
      board.indexOf("const onConnectEnd"),
      board.indexOf("const onNodeDragStart"),
    );

    expect(preview).toContain("strokeWidth={CANVAS_EDGE_STROKE_WIDTH * Math.min(menu.zoom, 1)}");
    expect(preview).toContain('stroke="var(--canvas-edge-related)"');
    expect(preview).not.toContain("canvas-edge-flow-glow");
    expect(connectEnd).toContain("zoom: flow.getViewport().zoom");
  });

  it("keeps every edge below nodes when a node or edge is selected", () => {
    expect(board).toContain("elevateEdgesOnSelect={false}");
    expect(board).not.toMatch(/\n\s+elevateEdgesOnSelect\s*\n/);
  });

  it("stops native flow animation when reduced motion is requested", () => {
    const reducedMotion = styles.slice(
      styles.lastIndexOf("@media (prefers-reduced-motion: reduce)", styles.indexOf("@keyframes float")),
      styles.indexOf("@keyframes float"),
    );

    expect(reducedMotion).toContain(".canvas-edge-related-flow");
    expect(reducedMotion).toContain("opacity: 0.45");
    expect(reducedMotion).not.toContain("stroke-dasharray");
    expect(reducedMotion).toContain("animation: none");
  });
});
