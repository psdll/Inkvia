import { describe, expect, it } from "vitest";
import type { CanvasEdge, CanvasNode } from "@/lib/canvas/document";
import { CanvasSpatialIndex } from "@/lib/canvas/spatial-index";

function largeGraph(nodeCount = 5_000, edgeCount = 30_000) {
  const nodes: CanvasNode[] = Array.from({ length: nodeCount }, (_, index) => ({
    id: `n-${index}`,
    type: "prompt",
    position: { x: (index % 100) * 320, y: Math.floor(index / 100) * 220 },
    width: 280,
    height: 180,
    data: { kind: "prompt", text: `node ${index}` },
  }));
  const edges: CanvasEdge[] = [];
  for (let index = 1; index <= 1_000; index += 1) {
    edges.push({ id: `hub-${index}`, source: "n-0", target: `n-${index}` });
  }
  for (let index = edges.length; index < edgeCount; index += 1) {
    const source = (index * 17) % nodeCount;
    const target = (source + 1 + (index % 97)) % nodeCount;
    edges.push({ id: `e-${index}`, source: `n-${source}`, target: `n-${target}` });
  }
  return { nodes, edges };
}

describe("canvas 5k/30k performance gate", () => {
  it("keeps indexing, viewport queries, and a 1k-degree update bounded", () => {
    const { nodes, edges } = largeGraph();
    const buildStartedAt = performance.now();
    const index = new CanvasSpatialIndex(nodes, edges);
    const buildMs = performance.now() - buildStartedAt;

    const queryStartedAt = performance.now();
    for (let sample = 0; sample < 1_000; sample += 1) {
      const x = (sample % 100) * 320;
      index.searchNodes({ minX: x, minY: 0, maxX: x + 1_920, maxY: 1_080 });
      index.searchEdges({ minX: x, minY: 0, maxX: x + 1_920, maxY: 1_080 });
    }
    const queryMs = performance.now() - queryStartedAt;

    const updateStartedAt = performance.now();
    index.updateNode(nodes[0], { ...nodes[0], position: { x: 100, y: 100 } });
    const updateMs = performance.now() - updateStartedAt;

    expect(index.nodeCount).toBe(5_000);
    expect(index.edgeCount).toBe(30_000);
    expect(buildMs).toBeLessThan(6_000);
    expect(queryMs).toBeLessThan(3_000);
    expect(updateMs).toBeLessThan(4_000);
  }, 20_000);
});
