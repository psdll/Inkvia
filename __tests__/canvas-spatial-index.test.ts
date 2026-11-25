import { describe, expect, it } from "vitest";
import type { CanvasEdge, CanvasNode } from "@/lib/canvas/document";
import {
  CanvasSpatialIndex,
  screenPixelsToWorld,
  viewportToWorldBounds,
} from "@/lib/canvas/spatial-index";

function node(id: string, x: number, y: number, zIndex = 0): CanvasNode {
  return {
    id,
    type: "prompt",
    position: { x, y },
    width: 100,
    height: 80,
    zIndex,
    data: { kind: "prompt", text: id },
  };
}

describe("canvas RBush spatial index", () => {
  it("indexes nested local coordinates in world space and moves descendant edges with the parent", () => {
    const parent = node("parent", 10000, 10000);
    const child = { ...node("child", 100, 100), parentId: "parent" };
    const nested = { ...node("nested", 20, 20), parentId: "child" };
    const other = node("other", 12000, 12000);
    const index = new CanvasSpatialIndex([parent, child, nested, other], [{ id: "edge", source: "nested", target: "other" }]);
    expect(index.searchNodes({ minX: 10100, minY: 10100, maxX: 10101, maxY: 10101 }).map(n => n.id)).toContain("child");
    index.updateNode(parent, { ...parent, position: { x: 20000, y: 20000 } });
    expect(index.searchNodes({ minX: 20120, minY: 20120, maxX: 20121, maxY: 20121 }).map(n => n.id)).toContain("nested");
    expect(index.searchEdges({ minX: 20160, minY: 20150, maxX: 20180, maxY: 20180 })[0].points[0]).toEqual({ x: 20170, y: 20160 });
    index.updateNode(child, { ...child, parentId: undefined, position: { x: 20100, y: 20100 } });
    expect(index.searchNodes({ minX: 20120, minY: 20120, maxX: 20121, maxY: 20121 }).map(n => n.id)).toContain("nested");
  });
  it("terminates with cyclic parents and updates only related geometry", () => {
    const a = { ...node("a", 10, 10), parentId: "b" }, b = { ...node("b", 10, 10), parentId: "a" };
    const index = new CanvasSpatialIndex([a, b], []);
    index.updateNode(a, { ...a, position: { x: 20, y: 20 } });
    expect(index.nodeCount).toBe(2);
    expect(index.searchNodes({ minX: 30, minY: 30, maxX: 31, maxY: 31 })).toHaveLength(2);
  });
  it("bulk loads thousands of nodes and returns only viewport candidates", () => {
    const nodes = Array.from({ length: 5_000 }, (_, index) => node(`n-${index}`, (index % 100) * 200, Math.floor(index / 100) * 160));
    const index = new CanvasSpatialIndex(nodes, []);
    const visible = index.searchNodes({ minX: 0, minY: 0, maxX: 500, maxY: 400 });
    expect(index.nodeCount).toBe(5_000);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(50);
  });

  it("hit tests the topmost node using a screen-pixel tolerance converted to world units", () => {
    const index = new CanvasSpatialIndex([node("bottom", 0, 0, 1), node("top", 0, 0, 5)], []);
    expect(index.hitTestNode({ x: 102, y: 40 }, screenPixelsToWorld(4, 2))?.id).toBe("top");
    expect(index.hitTestNode({ x: 110, y: 40 }, screenPixelsToWorld(4, 2))).toBeNull();
  });

  it("removes the old bbox and inserts the new bbox only after an update", () => {
    const original = node("a", 0, 0);
    const index = new CanvasSpatialIndex([original], []);
    index.updateNode(original, { ...original, position: { x: 1000, y: 1000 } });
    expect(index.searchNodes({ minX: 0, minY: 0, maxX: 200, maxY: 200 })).toEqual([]);
    expect(index.searchNodes({ minX: 900, minY: 900, maxX: 1200, maxY: 1200 }).map((item) => item.id)).toEqual(["a"]);
  });

  it("indexes edges separately and performs precise point-to-segment hit testing", () => {
    const nodes = [node("a", 0, 0), node("b", 300, 0)];
    const edges: CanvasEdge[] = [{ id: "e1", source: "a", target: "b" }];
    const index = new CanvasSpatialIndex(nodes, edges);
    expect(index.hitTestEdge({ x: 200, y: 43 }, 5)?.id).toBe("e1");
    expect(index.hitTestEdge({ x: 200, y: 60 }, 5)).toBeNull();
  });

  it("converts React Flow viewport transforms to overscanned world bounds", () => {
    expect(viewportToWorldBounds({ x: -100, y: -50, zoom: 2 }, 800, 600, 40)).toEqual({
      minX: 30,
      minY: 5,
      maxX: 470,
      maxY: 345,
    });
  });
});
