import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const board = readFileSync(resolve(process.cwd(), "components/canvas/SmartCanvasBoard.tsx"), "utf8");

describe("canvas arrange layout", () => {
  it("renders live dashed alignment guides while dragging", () => {
    expect(board).toContain("function CanvasAlignmentGuides");
    expect(board).toContain("<CanvasAlignmentGuides guides={alignmentGuides} />");
    expect(board).toContain("resolveCanvasAlignment");
  });

  it("keeps auto arrange transactional until the user keeps or restores it", () => {
    expect(board).toContain("arrangementPreview");
    expect(board).toContain("是否保留此次整理结果？");
    expect(board).toContain("data-canvas-arrange-confirmation");
    expect(board).toContain("还原");
    expect(board).toContain("保留");
    expect(board).toContain("restoreAutoArrange");
    expect(board).toContain("keepAutoArrange");
    const restore = board.slice(board.indexOf("const restoreAutoArrange"), board.indexOf("const keepAutoArrange"));
    expect(restore.indexOf("setDocument(previous)")).toBeLessThan(restore.indexOf("arrangementPreviewRef.current = null"));
  });
});
