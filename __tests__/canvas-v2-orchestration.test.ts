import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";
import { buildExecutionPlan, executeCanvasLoop } from "@/lib/canvas/orchestration";

function workflow(): CanvasDocumentV2 {
  return {
    ...createEmptyCanvasDocumentV2(),
    nodes: ["a", "b", "c", "d"].map((id, index) => ({ id, type: "prompt" as const, position: { x: index * 200, y: 0 }, data: { kind: "prompt" as const, text: id } })),
    edges: [
      { id: "ab", source: "a", target: "b" },
      { id: "bc", source: "b", target: "c" },
      { id: "ad", source: "a", target: "d" },
    ],
  };
}

describe("canvas v2 workflow orchestration", () => {
  it("builds deterministic single, downstream, and full topological plans", () => {
    expect(buildExecutionPlan(workflow(), { scope: "single", nodeId: "b" })).toEqual(["b"]);
    expect(buildExecutionPlan(workflow(), { scope: "downstream", nodeId: "b" })).toEqual(["b", "c"]);
    expect(buildExecutionPlan(workflow(), { scope: "full" })).toEqual(["a", "b", "c", "d"]);
  });

  it("honors serial and bounded parallel loop concurrency", async () => {
    let active = 0;
    let peak = 0;
    const seen: string[] = [];
    const worker = async (item: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(item);
      active -= 1;
    };

    await executeCanvasLoop(["a", "b", "c"], "serial", 8, worker);
    expect(peak).toBe(1);
    expect(seen).toEqual(["a", "b", "c"]);

    active = 0;
    peak = 0;
    seen.length = 0;
    await executeCanvasLoop(["a", "b", "c", "d"], "parallel", 2, worker);
    expect(peak).toBe(2);
    expect(seen.sort()).toEqual(["a", "b", "c", "d"]);
  });
});
