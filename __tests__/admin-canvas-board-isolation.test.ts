// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";

const state = vi.hoisted(() => ({ editor: null as any }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/canvas/use-canvas-models", () => ({ useCanvasModels: () => null, resolveCanvasModelId: () => "" }));
vi.mock("@/components/canvas/CanvasNodeSubscriptions", async original => ({ ...await original<any>(), CanvasNodeSubscriptionsProvider: ({ editor, children }: any) => { state.editor = editor; return children; } }));
import SmartCanvasBoard from "@/components/canvas/SmartCanvasBoard";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("shared board observer isolation", () => {
  it("never resumes pending tasks, saves, uploads or cancels while leaving preview controls mounted", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const fetch = vi.fn().mockRejectedValue(new Error("unexpected request")); vi.stubGlobal("fetch", fetch);
    const onChange = vi.fn(), onUndoMediaRefsChange = vi.fn(), onBeforeServerRun = vi.fn();
    const doc = createEmptyCanvasDocumentV2();
    doc.nodes = [{ id: "pending", type: "videoTask", position: { x: 0, y: 0 }, data: { kind: "videoTask", prompt: "draft", status: "submitting", requestKey: "pending-key", model: "test" } } as any];
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(React.createElement(SmartCanvasBoard, { readOnly: true, canvasId: 7, editorSessionId: "", preferenceOwnerId: -30, initial: doc, onChange, onUndoMediaRefsChange, onBeforeServerRun })));
      await act(async () => {
        await state.editor.runNode("pending");
        state.editor.cancelNode("pending");
        await state.editor.replaceMediaFile("pending", new File(["x"], "x.mp4", { type: "video/mp4" }));
        state.editor.updateData("pending", () => { throw new Error("must not edit"); });
      });
      const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      expect(onUndoMediaRefsChange).not.toHaveBeenCalled();
      expect(onBeforeServerRun).not.toHaveBeenCalled();
      expect(host.querySelector('[aria-label="画布工具"]')).not.toBeNull();
      expect(host.querySelector('[aria-label="添加节点"]')?.hasAttribute("disabled")).toBe(true);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
