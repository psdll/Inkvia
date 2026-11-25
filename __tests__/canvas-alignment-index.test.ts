import { describe, expect, it, vi } from "vitest";
import { CanvasAlignmentIndex, resolveCanvasAlignment, type CanvasAlignmentGuide, type CanvasAlignmentRect } from "@/lib/canvas/alignment-guides";
import { createCanvasDragAlignment } from "@/lib/canvas/drag-alignment";
import type { CanvasNode } from "@/lib/canvas/document";

describe("indexed alignment", () => {
  it("matches the full scan throughout drags at every supported zoom, including retained and distant guides", () => {
    let seed = 730;
    const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
    const candidates = Array.from({ length: 1200 }, (_, i) => ({
      id: `n${i}`, x: Math.floor(random() * 50) * 60, y: Math.floor(random() * 80) * 100,
      width: 80 + Math.floor(random() * 5) * 40, height: 80 + Math.floor(random() * 5) * 20,
    }));
    const index = new CanvasAlignmentIndex(candidates);
    for (const zoom of [0.1, 0.13, 0.2, 0.23, 0.5, 1, 2, 4, 8]) {
      let previousGuides: CanvasAlignmentGuide[] = [];
      for (let frame = 0; frame < 100; frame++) {
        const moving = { id: "moving", x: -40 + frame * 31.07, y: 95 + frame * 8.19, width: 160, height: 120 };
        const options = { gridSize: 12, previousGuides };
        const expected = resolveCanvasAlignment(moving, candidates, 8 / zoom, options);
        expect(resolveCanvasAlignment(moving, index, 8 / zoom, options)).toEqual(expected);
        previousGuides = expected.guides;
      }
    }
  });

  it("skips unrelated anchors while preserving every matching row and column", () => {
    const candidates = Array.from({ length: 5000 }, (_, i) => ({ id: `n${i}`, x: i * 1000, y: i * 1300, width: 200, height: 100 }));
    const index = new CanvasAlignmentIndex(candidates);
    const moving = { id: "moving", x: 1999, y: 2599, width: 200, height: 100 };
    expect(index.query(moving, 8).length).toBeLessThan(5);
    expect(resolveCanvasAlignment(moving, index, 8)).toEqual(resolveCanvasAlignment(moving, candidates, 8));
  });

  it("reuses the full candidate list for a dense aligned column instead of collecting and sorting it again", () => {
    const candidates = Array.from({ length: 5000 }, (_, i) => ({ id: `n${i}`, x: 300, y: i * 200, width: 100, height: 80 }));
    const index = new CanvasAlignmentIndex(candidates);
    const moving = { id: "moving", x: 299, y: 1599, width: 100, height: 80 };
    expect(index.query(moving, 8)).toBe(candidates);
    expect(resolveCanvasAlignment(moving, index, 8)).toEqual(resolveCanvasAlignment(moving, candidates, 8));
  });
});

const node = (id: string, x: number, parentId?: string): CanvasNode => ({
  id, type: "prompt", position: { x, y: 0 }, parentId, width: 100, height: 80, data: { kind: "prompt", text: "" },
});
const rect = (n: CanvasNode): CanvasAlignmentRect => ({ id: n.id, ...n.position, width: n.width!, height: n.height! });

it("reuses stationary geometry across 60 frames and invalidates resize, reparent, visibility and insertion", () => {
  const toRect = vi.fn(rect);
  const cache = createCanvasDragAlignment(new Set(["moving"]), toRect);
  let nodes = [node("moving", 0), node("target", 300)];
  const first = cache.get(nodes);
  for (let i = 1; i <= 60; i++) {
    nodes = [{ ...nodes[0], position: { x: i, y: i } }, nodes[1]];
    expect(cache.get(nodes)).toBe(first);
  }
  expect(toRect).toHaveBeenCalledTimes(1);
  for (const patch of [{ width: 400 }, { hidden: true }, { hidden: false, parentId: "group" }]) {
    nodes = [nodes[0], { ...nodes[1], ...patch }];
    const previous = cache.get(nodes);
    nodes = [...nodes, node(`new${nodes.length}`, 500)];
    expect(cache.get(nodes)).not.toBe(previous);
  }
});

it("excludes moving group descendants and resizing ancestors but keeps stationary siblings in world coordinates", () => {
  const nodes = [node("group", 100), node("moving", 20, "group"), node("sibling", 300, "group"), node("child", 50, "moving")];
  const toRect = vi.fn(rect);
  const cache = createCanvasDragAlignment(new Set(["moving"]), toRect);
  cache.get(nodes);
  expect(toRect.mock.calls.map(([n]) => [n.id, n.position.x])).toEqual([["sibling", 400]]);
  cache.get([{ ...nodes[0], position: { x: 90, y: 0 } }, nodes[1], { ...nodes[2], position: { x: 310, y: 0 } }, nodes[3]]);
  expect(toRect.mock.calls.at(-1)?.[0].position.x).toBe(400);
});
