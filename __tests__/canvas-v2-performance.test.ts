import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";
import { autoArrangeNodes } from "@/lib/canvas/graph";
import { buildExecutionPlan } from "@/lib/canvas/orchestration";

function largeDocument(): CanvasDocumentV2 {
  const nodes = Array.from({ length: 300 }, (_, index) => ({ id: `n${index}`, type: "prompt" as const, position: { x: 0, y: 0 }, data: { kind: "prompt" as const, text: String(index) } }));
  const edges = Array.from({ length: 500 }, (_, index) => {
    const source = index % 299;
    const target = Math.min(299, source + 1 + Math.floor(index / 299));
    return { id: `e${index}`, source: `n${source}`, target: `n${target}` };
  });
  return { ...createEmptyCanvasDocumentV2(), nodes, edges };
}

describe("canvas v2 desktop graph performance", () => {
  it("plans and arranges 300 nodes with 500 edges within the unit performance budget", () => {
    const document = largeDocument();
    const startedAt = performance.now();
    const plan = buildExecutionPlan(document, { scope: "full" });
    const arranged = autoArrangeNodes(document);
    const elapsed = performance.now() - startedAt;
    expect(plan).toHaveLength(300);
    expect(arranged.nodes).toHaveLength(300);
    expect(elapsed).toBeLessThan(250);
  });
});
