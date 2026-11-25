import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("canvas session undo integration", () => {
  it("supports undo and redo history keyboard actions", () => {
    const board = read("components/canvas/SmartCanvasBoard.tsx");
    const shortcuts = read("components/canvas/CanvasShortcutPanel.tsx");

    expect(board).toContain('shortcut === "undo"');
    expect(board).toContain("redoCanvasHistory");
    expect(board).not.toContain('event.key.toLowerCase() === "y"');
    expect(shortcuts).toContain('["Ctrl", "Shift", "Z"]');
  });

  it("publishes held and current media references whenever history changes", () => {
    const board = read("components/canvas/SmartCanvasBoard.tsx");

    expect(board).toContain("onUndoMediaRefsChange");
    expect(board).toContain("collectCanvasHistoryUndoMediaRefs");
    expect(board).toContain("collectCanvasDocumentUndoMediaRefs");
    expect(board).toContain("publishUndoMediaRefs(historyRef.current)");
  });

  it("uses a page-scoped lease and releases it when the editor closes", () => {
    const page = read("components/canvas/CanvasEditorPage.tsx");

    expect(page).toContain("undoSessionIdRef");
    expect(page).toContain(`/undo-media-holds`);
    expect(page).toContain('method: "DELETE"');
    expect(page).toContain("currentRefs: undoCurrentRefsRef.current");
    expect(page).toContain("keepalive: true");
    expect(page).toContain('window.addEventListener("pagehide", release)');
  });

  it("waits for undo protection before physically deleting removed imports", () => {
    const page = read("components/canvas/CanvasEditorPage.tsx");

    expect(page).toContain("await undoSyncRef.current");
    expect(page).toContain("if (undoProtectionReady)");
    expect(page).toContain("/api/canvas/media/delete");
  });
});
