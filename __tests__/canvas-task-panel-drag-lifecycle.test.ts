// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/dynamic", () => ({ default: () => () => React.createElement("textarea", { "data-editor": true, defaultValue: "draft" }) }));
vi.mock("@xyflow/react", async original => ({ ...await original<any>(), Handle: () => null, NodeToolbar: ({ children }: any) => children, useConnection: () => false, useNodeId: () => "task", useUpdateNodeInternals: () => () => {}, useStore: (select: any) => select({ transform: [0, 0, 1], nodeLookup: new Map(), edges: [] }) }));
vi.mock("@/components/canvas/use-canvas-models", () => ({ useCanvasModels: () => null }));
import { CanvasNodeCard, CanvasNodeEditorContext, type NodeEditor } from "@/components/canvas/CanvasNodeCard";
import { CanvasTextNode } from "@/components/canvas/CanvasTextNode";
import { CanvasInteractingContext } from "@/components/canvas/canvas-runtime-context";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("panel and text gesture lifecycle", () => {
  it("keeps the open task panel visible and its draft intact while panning or scrolling the canvas", () => {
    const editor = { isTaskPanelVisible: () => true, isPanelVisible: () => true, getTaskAssets: () => [], getTaskResultName: () => "LLM", updateData: vi.fn() } as unknown as NodeEditor;
    const data = { kind: "llm", prompt: "draft", status: "idle", model: "" } as any;
    const render = (interacting: boolean) => act(() => root.render(
      React.createElement(CanvasInteractingContext.Provider, { value: interacting },
        React.createElement(CanvasNodeEditorContext.Provider, { value: editor },
          React.createElement(CanvasNodeCard, { id: "task", type: "llm", data, dragging: false, selected: true } as any)))));
    render(false);
    const input = host.querySelector<HTMLTextAreaElement>("[data-editor]")!;
    input.value = "保留草稿";
    input.scrollTop = 25;
    for (const interacting of [true, false, true, false]) {
      render(interacting);
      expect(host.querySelector("[data-editor]")).toBe(input);
      expect(input.closest('[aria-hidden="true"]')).toBeNull();
      expect(input.closest("[inert]")).toBeNull();
      expect(input.value).toBe("保留草稿");
      expect(input.scrollTop).toBe(25);
    }
  });

  it("retains editor DOM, draft and scroll through dragging, but releases it on close", () => {
    let open = true;
    const getTaskAssets = vi.fn(() => []);
    let editor = { isTaskPanelVisible: () => open, isPanelVisible: () => true, getTaskAssets, getTaskResultName: () => "LLM", updateData: vi.fn() } as unknown as NodeEditor;
    const data = { kind: "llm", title: "Task", prompt: "draft", status: "idle", model: "", providerId: "" } as any;
    const render = (dragging: boolean) => act(() => root.render(React.createElement(CanvasNodeEditorContext.Provider, { value: editor }, React.createElement(CanvasNodeCard, { id: "task", type: "llm", data, dragging, selected: true } as any))));
    render(false);
    const input = host.querySelector<HTMLTextAreaElement>("[data-editor]")!;
    expect(input).not.toBeNull(); input.value = "中文草稿"; input.scrollTop = 25;
    render(true);
    expect(host.querySelector("[data-editor]")).toBe(input);
    expect(input.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(input.closest("[inert]")).not.toBeNull();
    render(false);
    expect(host.querySelector("[data-editor]")).toBe(input);
    expect(input.value).toBe("中文草稿"); expect(input.scrollTop).toBe(25);
    expect(getTaskAssets).toHaveBeenCalledTimes(1);
    // Production publishes a new per-node editor snapshot when its panel closes.
    open = false; editor = { ...editor }; render(false);
    expect(host.querySelector("[data-editor]")).toBeNull();
  });
  it.each(["pointerup", "pointercancel", "blur", "Escape", "hidden", "unmount"])("flushes final text size and removes listeners on %s", (ending) => {
    const update = vi.fn(), finish = vi.fn();
    act(() => root.render(React.createElement(CanvasTextNode, { id: "text", data: { kind: "prompt", text: "hello" }, selected: true, width: 350, height: 200, onTextChange: vi.fn(), onTitleChange: vi.fn(), onSizeChange: update, onSizeEnd: finish })));
    act(() => host.querySelector("button")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0 })));
    act(() => { for (let i = 1; i <= 100; i++) window.dispatchEvent(new MouseEvent("pointermove", { clientX: i, clientY: i })); });
    expect(update).not.toHaveBeenCalled();
    act(() => {
      if (ending === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      else if (ending === "hidden") { vi.spyOn(document, "hidden", "get").mockReturnValue(true); document.dispatchEvent(new Event("visibilitychange")); }
      else if (ending === "unmount") root.render(null);
      else window.dispatchEvent(new Event(ending));
    });
    expect(update.mock.calls).toEqual([[{ width: 450, height: 300 }]]);
    expect(finish).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new MouseEvent("pointermove", { clientX: 200, clientY: 200 })); vi.advanceTimersByTime(50); });
    expect(update).toHaveBeenCalledTimes(1);
  });
});
