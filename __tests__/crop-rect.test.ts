import { describe, expect, it } from "vitest";
import { updateCropRect } from "@/lib/canvas/crop-rect";

const start = { x: 0.1, y: 0.2, w: 0.5, h: 0.4 };

describe("crop rectangle interactions", () => {
  it("moves the crop rectangle without leaving the image", () => {
    expect(updateCropRect(start, "move", 0.8, 0.8)).toEqual({
      x: 0.5,
      y: 0.6,
      w: 0.5,
      h: 0.4,
    });
    expect(updateCropRect(start, "move", -0.8, -0.8)).toEqual({
      x: 0,
      y: 0,
      w: 0.5,
      h: 0.4,
    });
  });

  it("resizes from horizontal and vertical edges within the image", () => {
    expect(updateCropRect(start, "e", 0.8, 0)).toEqual({ x: 0.1, y: 0.2, w: 0.9, h: 0.4 });
    expect(updateCropRect(start, "s", 0, 0.8)).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.8 });
    expect(updateCropRect(start, "w", -0.8, 0)).toEqual({ x: 0, y: 0.2, w: 0.6, h: 0.4 });
    expect(updateCropRect(start, "n", 0, -0.8)).toEqual({ x: 0.1, y: 0, w: 0.5, h: 0.6 });
  });

  it("resizes from corners while preserving a minimum crop size", () => {
    const resized = updateCropRect(start, "nw", 0.9, 0.9, 0.04);
    expect(resized.x).toBeCloseTo(0.56);
    expect(resized.y).toBeCloseTo(0.56);
    expect(resized.w).toBeCloseTo(0.04);
    expect(resized.h).toBeCloseTo(0.04);
  });

  it("keeps a tiny selection inside the image when minimum size is constrained by an edge", () => {
    const tiny = { x: 0.99, y: 0.99, w: 0.005, h: 0.005 };
    const resized = updateCropRect(tiny, "se", 0.1, 0.1);

    expect(resized.x + resized.w).toBeLessThanOrEqual(1);
    expect(resized.y + resized.h).toBeLessThanOrEqual(1);
  });
});
