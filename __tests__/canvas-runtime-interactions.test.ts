import { describe, expect, it } from "vitest";
import { getCanvasConnectionHandleMotion, getCanvasConnectionHandlePointerOffset } from "@/lib/canvas/connection-handle-motion";
import { getCanvasEdgeCutWorldGeometry } from "@/lib/canvas/edge-cut-geometry";
import { applyCanvasPositionChanges, mergeCanvasRenderNodes } from "@/lib/canvas/drag-render-state";

describe("canvas interaction runtime", () => {
  it("limits magnetic following radially while preserving the pointer direction", () => {
    const motion = getCanvasConnectionHandleMotion("source", { x: 80, y: -80 });
    expect(Math.hypot(motion.x, motion.y)).toBeCloseTo(30);
    expect(motion.x).toBeCloseTo(-motion.y);
    expect(getCanvasConnectionHandlePointerOffset({ x: 40, y: 0 }, { left: 0, top: 0, width: 40, height: 40 })).toEqual({ x: 20, y: -20 });
  });

  it("scales edge affordances in canvas coordinates", () => {
    for (const zoom of [0.1, 0.5, 1, 8]) {
      const geometry = getCanvasEdgeCutWorldGeometry();
      expect(geometry.hitWidth * zoom).toBe(20 * zoom);
      expect(geometry.buttonSize * zoom).toBe(48 * zoom);
    }
  });

  it("updates only moved nodes and keeps no-op document arrays unchanged", () => {
    const nodes = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), position: { x: i, y: 0 }, data: { text: "keep" } }));
    expect(applyCanvasPositionChanges(nodes, [{ id: "1", position: { x: 1, y: 0 } }])).toBe(nodes);
    const moved = applyCanvasPositionChanges(nodes, [{ id: "1", position: { x: 40, y: 5 } }, { id: "2", position: { x: 50, y: 8 } }]);
    expect(moved[1].position).toEqual({ x: 40, y: 5 });
    expect(moved[2].position).toEqual({ x: 50, y: 8 });
    expect(moved[1].data).toBe(nodes[1].data);
    expect(moved.filter((node, i) => node !== nodes[i])).toHaveLength(2);
    expect(nodes[1].position).toEqual({ x: 1, y: 0 });
  });

  it("does not create an extra render update when business references already match", () => {
    const nodes = [{ id: "a", position: { x: 1, y: 2 } }];
    expect(mergeCanvasRenderNodes(nodes, nodes, new Set())).toBe(nodes);
    expect(mergeCanvasRenderNodes(nodes, [...nodes], new Set())).toBe(nodes);
  });
});
