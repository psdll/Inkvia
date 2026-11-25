import { describe, expect, it } from "vitest";
import { CANVAS_MAX_TAG_BYTES, CANVAS_MAX_TAGS_PER_NODE, CanvasLimitError, validateCanvasNodeBudget } from "@/lib/canvas/limits";
import type { CanvasNode } from "@/lib/canvas/document";

function node(extra: Record<string, unknown> = {}): CanvasNode {
  return {
    id: "n",
    type: "prompt",
    position: { x: 0, y: 0 },
    data: { kind: "prompt", text: "ok", ...extra },
  };
}

describe("canvas entity coordinate and tag bounds", () => {
  it("rejects coordinates and dimensions outside the finite world budget", () => {
    expect(() => validateCanvasNodeBudget({ ...node(), position: { x: 10_000_001, y: 0 } })).toThrowError(
      expect.objectContaining<Partial<CanvasLimitError>>({ code: "NODE_POSITION_LIMIT" }),
    );
    expect(() => validateCanvasNodeBudget({ ...node(), width: 100_001 })).toThrowError(
      expect.objectContaining<Partial<CanvasLimitError>>({ code: "NODE_SIZE_LIMIT" }),
    );
  });

  it("limits tag count and each UTF-8 tag value", () => {
    expect(() => validateCanvasNodeBudget(node({ tags: Array.from({ length: CANVAS_MAX_TAGS_PER_NODE + 1 }, () => "tag") }))).toThrowError(
      expect.objectContaining<Partial<CanvasLimitError>>({ code: "NODE_TAG_COUNT_LIMIT" }),
    );
    expect(() => validateCanvasNodeBudget(node({ tags: ["中".repeat(CANVAS_MAX_TAG_BYTES)] }))).toThrowError(
      expect.objectContaining<Partial<CanvasLimitError>>({ code: "NODE_TAG_BYTE_LIMIT" }),
    );
  });
});
