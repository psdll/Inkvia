import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const card = readFileSync("components/canvas/CanvasNodeCard.tsx", "utf8");

describe("canvas image quality options", () => {
  it("falls back from a legacy quality value to the model default in the task panel", () => {
    expect(card).toContain("params.qualities.some((option) => option.value === settings.quality)");
    expect(card).not.toContain("const qualityValue = settings.quality || params.defaultQuality");
  });
});
