import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("canvas image editor modal lock", () => {
  it("blocks background canvas pointer and shortcut interactions while the editor is open", () => {
    const board = read("components/canvas/SmartCanvasBoard.tsx");
    const editor = read("components/canvas/ImageEditorModal.tsx");
    const shortcutsHandler = board.indexOf("const onKeyDown = (event: KeyboardEvent) =>");
    const pasteHandler = board.indexOf("const onPaste = (event: ClipboardEvent) =>");
    const shortcuts = board.slice(
      board.lastIndexOf("React.useEffect(() => {", shortcutsHandler),
      pasteHandler,
    );
    const paste = board.slice(
      board.lastIndexOf("React.useEffect(() => {", pasteHandler),
      board.indexOf("const onDrop = React.useCallback"),
    );

    expect(board).toContain("const canvasInteractionLocked = imageEditor !== null || preview !== null || generationHistoryOpen;");
    expect(shortcuts).toContain("if (canvasInteractionLocked) return;");
    expect(paste).toContain("if (canvasInteractionLocked) return;");
    expect(board).toContain('canvasInteractionLocked ? " pointer-events-none" : ""');
    expect(editor).toContain("fixed inset-0 z-[1100]");
    expect(editor).toContain('role="dialog"');
    expect(editor).toContain('aria-modal="true"');
  });

  it("routes undo and redo shortcuts to the editor with a 50-step history limit", () => {
    const editor = read("components/canvas/ImageEditorModal.tsx");

    expect(editor).toContain("const IMAGE_EDITOR_HISTORY_LIMIT = 50;");
    expect(editor).toContain(
      "drawingHistory.current.splice(0, drawingHistory.current.length - IMAGE_EDITOR_HISTORY_LIMIT);",
    );
    expect(editor).toContain("const command = event.ctrlKey || event.metaKey;");
    expect(editor).toContain('event.key.toLowerCase() === "z"');
    expect(editor).toContain('event.key.toLowerCase() === "y"');
    expect(editor).toContain("event.shiftKey ? redoDrawing() : undoDrawing();");
    expect(editor).toContain("if (isTextEntryTarget(event.target)) return;");
  });
});
