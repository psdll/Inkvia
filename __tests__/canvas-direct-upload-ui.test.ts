import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CANVAS_UPLOAD_CALLERS = [
  "components/canvas/SmartCanvasBoard.tsx",
  "components/canvas/CanvasEditorPage.tsx",
  "components/canvas/ImageEditorModal.tsx",
];

describe("canvas local upload integration", () => {
  it.each(CANVAS_UPLOAD_CALLERS)("routes every canvas media write through the shared local upload client: %s", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toContain('fetch("/api/canvas/upload"');
    expect(source).toContain("uploadCanvasMedia");
  });

  it("keeps the validated local multipart route enabled in production", () => {
    const source = readFileSync("app/api/canvas/upload/route.ts", "utf8");
    expect(source).not.toContain("DIRECT_UPLOAD_REQUIRED");
    expect(source).toContain("streamCanvasMediaUpload");
  });
});
