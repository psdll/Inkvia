import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const board = read("components/canvas/SmartCanvasBoard.tsx");
const nodeCard = read("components/canvas/CanvasNodeCard.tsx");

describe("canvas pending upload generation guard", () => {
  it("keeps temporary URLs out of task submissions", () => {
    expect(board).toContain("hasPendingCanvasTaskUploads(documentRef.current, nodeId)");
    expect(board).toContain('setActionMessage("素材仍在上传中，请稍后再生成")');
  });

  it("shows upload state on the material node without changing the generate button", () => {
    expect(nodeCard).toContain("data-canvas-media-uploading");
    expect(nodeCard).toContain("正在上传素材...");
    expect(nodeCard).toContain("!uploading && <CanvasConnectionHandle");
    expect(nodeCard).not.toContain("hasPendingTaskUploads");
    expect(nodeCard).not.toContain('"素材上传中..."');
  });

  it("creates pending image and video nodes at their local media ratio", () => {
    expect(board).toContain("getCanvasLocalUploadNodeSize");
    expect(board).toContain("getCanvasLocalUploadPositions");
    // The batch runtime suite verifies immediate previews and independent metadata settlement.
    expect(board).toContain('hydrateCanvasLocalUploadLayout');
    expect(board).not.toMatch(/await Promise\.all\([\s\S]*?getCanvasLocalUploadNodeSize\([\s\S]*?commit\(/);
    expect(nodeCard).toContain("showPendingMediaPreview");
    expect(nodeCard).toContain("canvas-media-uploading-overlay");
  });
});
