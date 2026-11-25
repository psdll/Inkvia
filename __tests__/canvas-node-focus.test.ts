import { describe, expect, it } from "vitest";
import { getCanvasNodeFocusViewport } from "@/lib/canvas/node-focus";
import { getCanvasViewportAnimationDuration } from "@/lib/canvas/visual-policy";

describe("canvas node focus framing", () => {
  it("focuses dense graphs immediately while retaining animation for smaller boards", () => {
    expect(getCanvasViewportAnimationDuration(174, 453)).toBe(0);
    expect(getCanvasViewportAnimationDuration(100, 0)).toBe(0);
    expect(getCanvasViewportAnimationDuration(40, 200)).toBe(0);
    expect(getCanvasViewportAnimationDuration(20, 30)).toBe(300);
    expect(getCanvasViewportAnimationDuration(20, 30, true)).toBe(0);
  });
  it.each([
    [350, 622], [622, 350], [350, 350], [300, 120], [1800, 350], [350, 2400],
  ])("fits and centers a %s by %s node in the available viewport", (width, height) => {
    const bounds = { x: 4000, y: -1200, width, height };
    const viewport = getCanvasNodeFocusViewport(bounds, { width: 1920, height: 855 })!;
    const left = bounds.x * viewport.zoom + viewport.x;
    const top = bounds.y * viewport.zoom + viewport.y;
    expect(left + width * viewport.zoom / 2).toBeCloseTo(960);
    expect(top + height * viewport.zoom / 2).toBeCloseTo(427.5);
    expect(left).toBeGreaterThanOrEqual(56 - 1e-8);
    expect(top).toBeGreaterThanOrEqual(56 - 1e-8);
    expect(viewport.zoom).toBeLessThanOrEqual(2);
  });
  it("uses different zoom levels for tall media and compact audio", () => {
    const screen = { width: 1920, height: 855 };
    expect(getCanvasNodeFocusViewport({ x: 0, y: 0, width: 350, height: 622 }, screen)!.zoom).toBeCloseTo(1.1945, 4);
    expect(getCanvasNodeFocusViewport({ x: 0, y: 0, width: 300, height: 120 }, screen)!.zoom).toBe(2);
  });
  it("adapts to a narrower viewport and ignores an unmeasured node", () => {
    const node = { x: 0, y: 0, width: 622, height: 350 };
    expect(getCanvasNodeFocusViewport(node, { width: 800, height: 600 })!.zoom).toBeCloseTo(688 / 622);
    expect(getCanvasNodeFocusViewport({ ...node, width: 0 }, { width: 800, height: 600 })).toBeNull();
    expect(getCanvasNodeFocusViewport(node, { width: 0, height: 0 })).toBeNull();
  });
  it("keeps the selected media toolbar above a tall node inside the viewport", () => {
    const node = { x: -900, y: -600, width: 350, height: 622 };
    const viewport = getCanvasNodeFocusViewport(node, { width: 1920, height: 807 }, 86)!;
    const top = node.y * viewport.zoom + viewport.y;
    expect(top - 86).toBeCloseTo(56);
    expect(top + node.height * viewport.zoom).toBeCloseTo(807 - 56);
  });
});
