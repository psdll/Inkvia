import { verifyDragMerge } from './helpers/canvas-board-contract-harness';
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");

describe("canvas drag presentation fast path", () => {
  it("renders presentation nodes and avoids document state writes during an active drag", () => {
    expect(board).toContain("const [renderNodes, setRenderNodes]");
    expect(board).toContain("nodes={renderNodes}");
    expect(board).toContain("applyNodeChanges(alignedStructural, current)");
    expect(board).toContain("if (dragStart.current && positionChange)");
    expect(board).toContain("documentRef.current = normalized");
    expect(board).not.toContain("activeDragIds");
  });

  it("merges business updates without resetting active drag positions", async () => {

    await verifyDragMerge();
  });

  it("publishes alignment guides through one animation-frame scheduler", () => {
    expect(board).toContain("window.requestAnimationFrame");
    expect(board).toContain("window.cancelAnimationFrame");
    expect(board).toContain("publishAlignmentGuides");
    expect(board).toContain("clearAlignmentGuides");
  });
});
