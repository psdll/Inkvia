import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");
const editor = readFileSync("components/canvas/CanvasEditorPage.tsx", "utf8");

describe("canvas unsaved change unload guard", () => {
  it("keeps automatic persistence, announces status and offers retry after a save error", () => {
    expect(editor).toMatch(/<span role="status" className="sr-only">\{saveState === "saved"/);
    expect(editor).not.toContain("已保存 · revision");
    expect(editor).toMatch(/saveState === "error" && <button[^\n]+queueSave\(currentRef.current, true\)/);
    expect(editor).toContain("pendingRef.current = next");
    expect(editor).toContain("saveTimer.current = window.setTimeout(() => {");
    expect(editor).toContain("void drainSaveQueue();");
    expect(editor).toContain("}, 300);");
    expect(editor).toContain("onChange={(next) => queueSave(next)}");
  });

  it("warns while an editor save is pending, active, conflicted, or failed", () => {
    expect(editor).toContain('window.addEventListener("beforeunload", onBeforeUnload)');
    expect(editor).toContain("pendingRef.current");
    expect(editor).toContain("savingRef.current");
    expect(editor).toContain('saveState === "error"');
    expect(editor).toContain('saveState === "conflict"');
    expect(editor).toContain("event.preventDefault()");
    expect(editor).toContain('event.returnValue = ""');
  });

  it("waits for the newest save and returns its revision before a server run", () => {
    expect(editor).toContain("while (savingRef.current)");
    expect(editor).toContain("const prepareServerRun");
    expect(editor).toContain("await drainSaveQueue()");
    expect(editor).toContain("return revisionRef.current");
    expect(editor).toContain("onBeforeServerRun={prepareServerRun}");
  });

  it("publishes and guards a board change that is still inside the render throttle", () => {
    expect(board).toContain('window.addEventListener("beforeunload", flushPendingChange)');
    expect(board).toContain('window.addEventListener("pagehide", flushPendingChangeOnLeave)');
    expect(board).toContain('globalThis.document.addEventListener("visibilitychange", flushPendingChangeWhenHidden)');
    expect(board).toContain("if (changeTimer.current === undefined) return");
    expect(board).toContain("publishPendingDocument()");
    expect(board).toContain("event.preventDefault()");
    expect(board).toContain('event.returnValue = ""');
  });

  it("flushes the editor save queue when the page is hidden", () => {
    expect(editor).toContain('window.addEventListener("pagehide", flushPendingSave)');
    expect(editor).toContain('globalThis.document.addEventListener("visibilitychange", flushPendingSaveWhenHidden)');
    expect(editor).toContain('if (globalThis.document.visibilityState === "hidden") flushPendingSave()');
    expect(editor).toContain("void drainRef.current()");
  });
});
