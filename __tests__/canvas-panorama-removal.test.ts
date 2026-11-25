import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canvas panorama removal", () => {
  it("removes the panorama viewer and every canvas entry point", () => {
    const nodeCard = readFileSync("components/canvas/CanvasNodeCard.tsx", "utf8");
    const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");

    expect(existsSync("components/canvas/Panorama360Modal.tsx")).toBe(false);
    expect(nodeCard).not.toContain("360°");
    expect(nodeCard).not.toContain("openPanorama");
    expect(nodeCard).not.toContain("openOutputPanorama");
    expect(board).not.toContain("Panorama360Modal");
    expect(board).not.toContain("panoramaEditor");
    expect(board).not.toContain("openPanorama");
    expect(board).not.toContain("openOutputPanorama");
  });
});
