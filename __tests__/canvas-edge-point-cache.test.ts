import { describe, expect, it, vi } from "vitest";
import { createCanvasEdgePointLookup, getCanvasEdgePointLookup, createCanvasBezierPointLookup, getCanvasEdgeSelectionPoints } from "@/lib/canvas/edge-point-cache";
import { sampledPathIntersectsRect } from "@/lib/canvas/marquee-selection";
describe("edge nearest-point lookup", () => {
  it("selects dense cubic edges without native measurement and invalidates on geometry changes", () => {
    let d = "M0,0 C0,100 100,100 100,0";
    const getTotalLength = vi.fn(() => { throw new Error("native measurement on interaction"); });
    const getPointAtLength = vi.fn();
    for (let i = 0; i < 300; i++) {
      const path = { getAttribute: () => d, getTotalLength, getPointAtLength } as unknown as SVGPathElement;
      const points = getCanvasEdgeSelectionPoints(path);
      expect(getCanvasEdgeSelectionPoints(path)).toBe(points);
      expect(sampledPathIntersectsRect(points, { x: 49, y: 74, width: 2, height: 2 })).toBe(true);
      expect(sampledPathIntersectsRect(points, { x: 49, y: 90, width: 2, height: 2 })).toBe(false);
      d = "M0,0 C0,-100 100,-100 100,0";
      expect(getCanvasEdgeSelectionPoints(path)).not.toBe(points);
      expect(sampledPathIntersectsRect(getCanvasEdgeSelectionPoints(path), { x: 49, y: 74, width: 2, height: 2 })).toBe(false);
      d = "M0,0 C0,100 100,100 100,0";
    }
    expect(getTotalLength).not.toHaveBeenCalled();
    expect(getPointAtLength).not.toHaveBeenCalled();
  });
  it("retains cached native sampling for non-cubic paths", () => {
    const path = { getAttribute: () => "M0,0 L100,0", getTotalLength: vi.fn(() => 100), getPointAtLength: vi.fn(x => ({ x, y: 0 })) } as unknown as SVGPathElement;
    const points = getCanvasEdgeSelectionPoints(path);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[64]).toEqual({ x: 100, y: 0 });
    expect(getCanvasEdgeSelectionPoints(path)).toBe(points);
    expect(path.getTotalLength).toHaveBeenCalledTimes(1);
  });
  it("locates a cubic curve without calling native SVG length sampling", () => {
    const getTotalLength = vi.fn(() => { throw new Error("expensive SVG integration"); });
    const getPointAtLength = vi.fn();
    const path = { getAttribute: () => "M0,0 C0,100 100,100 100,0", getTotalLength, getPointAtLength } as unknown as SVGPathElement;
    const lookup = getCanvasEdgePointLookup(path);
    for (let i = 0; i < 100; i++) {
      const p = lookup({ x: 50, y: 100 })!;
      expect(p.x).toBeCloseTo(50, 4); expect(p.y).toBeCloseTo(75, 4);
    }
    expect(getTotalLength).not.toHaveBeenCalled(); expect(getPointAtLength).not.toHaveBeenCalled();
    expect(lookup({ x: -10, y: -10 })).toEqual({ x: 0, y: 0 });
    expect(lookup({ x: 110, y: -10 })).toEqual({ x: 100, y: 0 });
  });
  it("handles long world-coordinate curves, scientific notation and degenerate curves", () => {
    const lookup = createCanvasBezierPointLookup("M-2e4,-100 C0,-100 0,100 2e4,100")!;
    const p = lookup({ x: 0, y: 0 })!;
    expect(p.x).toBeCloseTo(0, 2); expect(p.y).toBeCloseTo(0, 2);
    expect(lookup({ x: NaN, y: 0 })).toBeNull();
    expect(createCanvasBezierPointLookup("M1,2 C1,2 1,2 1,2")!({ x: 9, y: 9 })).toEqual({ x: 1, y: 2 });
    expect(createCanvasBezierPointLookup("M0,0 L100,0")).toBeNull();
  });
  it("samples 81 coarse points once and only 11 neighboring points per query", () => {
    const path = { getTotalLength: vi.fn(() => 100), getPointAtLength: vi.fn((length: number) => ({ x: length, y: 0 })) };
    const lookup = createCanvasEdgePointLookup(path);
    expect(path.getPointAtLength).toHaveBeenCalledTimes(81);
    for (let i = 0; i < 100; i++) expect(lookup({ x: 33.25, y: 10 })?.x).toBeCloseTo(33.25);
    expect(path.getTotalLength).toHaveBeenCalledTimes(1);
    expect(path.getPointAtLength).toHaveBeenCalledTimes(81 + 1100);
  });
  it("invalidates cached samples only when path d changes", () => {
    let d = "a";
    const getPointAtLength = vi.fn((t: number) => ({ x: t, y: d === "a" ? 0 : 100 }));
    const path = { getAttribute: () => d, getTotalLength: () => 100, getPointAtLength } as unknown as SVGPathElement;
    const first = getCanvasEdgePointLookup(path);
    expect(getCanvasEdgePointLookup(path)).toBe(first);
    expect(getPointAtLength).toHaveBeenCalledTimes(81);
    d = "b";
    const second = getCanvasEdgePointLookup(path);
    expect(second).not.toBe(first);
    expect(getPointAtLength).toHaveBeenCalledTimes(162);
    expect(second({ x: 50, y: 105 })).toEqual({ x: 50, y: 100 });
  });
  it("finds the corner of a folded path and handles degenerate input", () => {
    const lookup = createCanvasEdgePointLookup({ getTotalLength: () => 100, getPointAtLength: t => t <= 50 ? { x: t, y: 0 } : { x: 50, y: t - 50 } });
    expect(lookup({ x: 51, y: -1 })).toEqual({ x: 50, y: 0 });
    expect(lookup({ x: NaN, y: 0 })).toBeNull();
    expect(createCanvasEdgePointLookup({ getTotalLength: () => 0, getPointAtLength: vi.fn() })({ x: 0, y: 0 })).toBeNull();
  });
});
