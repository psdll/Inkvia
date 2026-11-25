import { describe, expect, it } from "vitest";

import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  CANVAS_ZOOM_STEP,
  clampCanvasZoomPercent,
  parseCanvasZoomPercent,
  getCanvasLodZone,
  getCanvasDotGap,
  resolveCanvasLod,
  resolveCanvasLodZone,
} from "@/lib/canvas/visual-policy";

describe("canvas visual policy", () => {
  it("keeps the designed zoom range, step, and percentage clamp", () => {
    expect(CANVAS_MIN_ZOOM).toBe(0.1);
    expect(CANVAS_MAX_ZOOM).toBe(8);
    expect(CANVAS_ZOOM_STEP).toBe(1.2);
    expect(clampCanvasZoomPercent(4)).toBe(10);
    expect(clampCanvasZoomPercent(264.4)).toBe(264);
    expect(clampCanvasZoomPercent(900)).toBe(800);
    expect(clampCanvasZoomPercent(Number.NaN)).toBe(100);
  });

  it("keeps dots near a 16px screen rhythm until zooming above 100 percent", () => {
    expect(getCanvasDotGap(0.1)).toBe(80);
    expect(getCanvasDotGap(0.2)).toBe(80);
    expect(getCanvasDotGap(0.23)).toBe(70);
    expect(getCanvasDotGap(0.4)).toBe(40);
    expect(getCanvasDotGap(1)).toBe(16);
    expect(getCanvasDotGap(2.64)).toBe(16);
    expect(getCanvasDotGap(8)).toBe(16);
  });

  it("uses 22/25 percent hysteresis including exact boundaries", () => {
    expect(getCanvasLodZone(0.219)).toBe("enter");
    expect(getCanvasLodZone(0.22)).toBe("hold");
    expect(getCanvasLodZone(0.249)).toBe("hold");
    expect(getCanvasLodZone(0.25)).toBe("exit");
    let previous = false;
    expect([.5, .2, .23, .25, .23, .5].map(zoom => previous = resolveCanvasLod(zoom, previous))).toEqual([false, true, true, false, false, false]);
    expect(resolveCanvasLodZone("hold", true)).toBe(true);
    expect(resolveCanvasLodZone("hold", false)).toBe(false);
  });
  it.each([["17.411", 17], ["50%", 50], ["", 42], ["abc", 42], ["-10", 10], ["900", 800], ["Infinity", 42], ["9".repeat(400), 42]])("parses %s before constraining it", (input, expected) => {
    expect(parseCanvasZoomPercent(String(input), 42)).toBe(expected);
  });
});
