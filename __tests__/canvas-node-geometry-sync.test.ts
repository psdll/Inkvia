import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const nodeCard = readFileSync("components/canvas/CanvasNodeCard.tsx", "utf8");

describe("canvas node geometry synchronization", () => {
  it("re-measures custom nodes after node data or rendered size changes", () => {
    const hookStart = nodeCard.indexOf("function useCanvasNodeGeometrySync");

    expect(hookStart).toBeGreaterThanOrEqual(0);

    const hook = nodeCard.slice(hookStart, nodeCard.indexOf("function TaskResultFrame"));
    expect(hook).toContain("useUpdateNodeInternals()");
    expect(hook).toContain("new ResizeObserver");
    expect(hook).toContain("observer.observe(element)");
    expect(hook).toContain("window.requestAnimationFrame");
    expect(hook).toContain("window.cancelAnimationFrame");
    expect(hook).toContain("updateNodeInternals(id)");
  });
});
