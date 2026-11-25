import { describe, expect, it, vi } from "vitest";
import { adoptUserNodes, updateAbsolutePositions, type InternalNodeBase, type NodeBase } from "@xyflow/system";
import { mergeCanvasRenderNodes } from "@/lib/canvas/drag-render-state";

type TestNode = {
  id: string;
  position: { x: number; y: number };
  data: { value: string };
  dragging?: boolean;
  measured?: { width?: number; height?: number };
};

describe("mergeCanvasRenderNodes", () => {
  it("keeps grouped audio at its world position through repeated selection changes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const child: NodeBase = { id: "audio", parentId: "group", position: { x: 80, y: 120 },
        measured: { width: 420, height: 200 }, data: { kind: "audioTask" } };
      const group: NodeBase = { id: "group", position: { x: -1000, y: 6000 },
        measured: { width: 1500, height: 1800 }, data: { kind: "group" } };
      const lookup = new Map<string, InternalNodeBase>();
      const parents = new Map<string, Map<string, InternalNodeBase>>();
      let rendered = mergeCanvasRenderNodes([], [child, group], new Set());
      adoptUserNodes(rendered, lookup, parents);
      // Initial size measurement repairs the coordinates, even for an old unsorted document.
      updateAbsolutePositions(lookup, parents);
      expect(lookup.get("audio")?.internals.positionAbsolute).toEqual({ x: -920, y: 6120 });
      for (const selected of [true, false, true]) {
        rendered = mergeCanvasRenderNodes(rendered, [{ ...child, selected }, group], new Set());
        adoptUserNodes(rendered, lookup, parents);
        expect(lookup.get("audio")?.internals.positionAbsolute).toEqual({ x: -920, y: 6120 });
      }
      expect(warn).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it("orders nested parents before children while preserving live drag positions and node identities", () => {
    const outer = { id: "outer", position: { x: 100, y: 100 } };
    const inner = { id: "inner", parentId: "outer", position: { x: 20, y: 30 } };
    const child = { id: "audio", parentId: "inner", position: { x: 10, y: 10 } };
    const sibling = { id: "sibling", parentId: "inner", position: { x: 500, y: 10 } };
    const current = [{ ...child, position: { x: 40, y: 50 }, dragging: true }];
    const merged = mergeCanvasRenderNodes(current,
      [child, sibling, inner, outer], new Set(["audio"]));
    expect(merged.map(node => node.id)).toEqual(["outer", "inner", "audio", "sibling"]);
    expect(merged[0]).toBe(outer);
    expect(merged[1]).toBe(inner);
    expect(merged[2].position).toEqual({ x: 40, y: 50 });
    expect(mergeCanvasRenderNodes(merged, merged, new Set())).toBe(merged);
  });

  it("keeps the live drag position while accepting fresh business data", () => {
    const current: TestNode[] = [{
      id: "task",
      position: { x: 320, y: 180 },
      data: { value: "old" },
      dragging: true,
      measured: { width: 240, height: 320 },
    }];
    const business: TestNode[] = [{
      id: "task",
      position: { x: 20, y: 30 },
      data: { value: "new" },
      measured: { width: 240, height: 320 },
    }];

    expect(mergeCanvasRenderNodes(current, business, new Set(["task"]))[0]).toMatchObject({
      position: { x: 320, y: 180 },
      data: { value: "new" },
      dragging: true,
    });
  });

  it("uses business order and removes nodes absent from the business document", () => {
    const current: TestNode[] = [
      { id: "removed", position: { x: 0, y: 0 }, data: { value: "removed" } },
      { id: "kept", position: { x: 1, y: 1 }, data: { value: "old" } },
    ];
    const business: TestNode[] = [
      { id: "added", position: { x: 3, y: 3 }, data: { value: "added" } },
      { id: "kept", position: { x: 2, y: 2 }, data: { value: "new" } },
    ];

    const merged = mergeCanvasRenderNodes(current, business, new Set());
    expect(merged.map((node) => node.id)).toEqual(["added", "kept"]);
    expect(merged[1]?.position).toEqual({ x: 2, y: 2 });
  });
});
