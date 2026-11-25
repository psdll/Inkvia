// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ zoom: .35, resizeEnd: undefined as (() => void) | undefined, resizeVisible: false, userSelectionActive: false, userSelectionRect: null as null | { width: number; height: number } }));
vi.mock("@xyflow/react", async original => ({
  ...await original<any>(),
  Handle: () => null,
  useConnection: () => false,
  useUpdateNodeInternals: () => () => {},
  useStore: (select: any) => select({ transform: [0, 0, state.zoom], nodes: [{ id: "a", parentId: "group", data: { kind: "image", url: "/a.png" } }, { id: "b", parentId: "group", data: { kind: "image", url: "/b.png" } }, { id: "outside" }], nodeLookup: new Map(), userSelectionActive: state.userSelectionActive, userSelectionRect: state.userSelectionRect }),
  NodeToolbar: ({ children, style, className, onPointerDown }: any) => React.createElement("div", { style, className, onPointerDown, "data-toolbar": true }, children),
  NodeResizer: ({ onResizeEnd, isVisible }: any) => { state.resizeEnd = onResizeEnd; state.resizeVisible = isVisible; return null; },
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/canvas/use-canvas-models", () => ({ useCanvasModels: () => null }));
import { CanvasNodeCard, CanvasNodeEditorContext } from "@/components/canvas/CanvasNodeCard";
import { CanvasDeferredNode } from "@/components/canvas/CanvasDeferredNode";

let root: Root, host: HTMLDivElement;
const groupAction = vi.fn();
const updateData = vi.fn();
const saveMediaToLibrary = vi.fn();
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
const render = async (collapsed = false, groupSelected = true, stacked = false) => {
  await act(async () => root.render(React.createElement(CanvasNodeEditorContext.Provider, {
    value: { groupAction, updateData, saveMediaToLibrary, isPanelVisible: () => false, isGroupSelected: () => groupSelected, connectionInProgress: false, connectionFeedbackTarget: null } as any,
    children: React.createElement(CanvasNodeCard, {
      id: "group", type: "group", data: { kind: "group", title: "参考素材", collapsed, stacked }, selected: true,
      dragging: false, width: 800, height: 600, isConnectable: false, zIndex: -1001,
      draggable: true, selectable: true, deletable: true, positionAbsoluteX: 0, positionAbsoluteY: 0,
    }),
  })));
};

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  groupAction.mockClear(); updateData.mockClear(); saveMediaToLibrary.mockClear(); state.resizeEnd = undefined;
  state.resizeVisible = false; state.userSelectionActive = false; state.userSelectionRect = null;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); HTMLElement.prototype.scrollIntoView = originalScrollIntoView; vi.unstubAllGlobals(); });

describe("group toolbar interaction", () => {
  it("uses the existing unstack action from the new count badge", async () => {
    await render(true, true, true);
    const expand = host.querySelector<HTMLButtonElement>('[aria-label="展开 2 张图片"]')!;
    expect(expand.textContent).toBe("2张");
    act(() => expand.click());
    expect(groupAction).toHaveBeenCalledWith("group", "ungroup");
  });
  it.each([0.11, 0.35, 1])("keeps the colored group frame directly in its sized node container at zoom %s", async zoom => {
    const previousZoom = state.zoom;
    state.zoom = zoom;
    try {
      await act(async () => root.render(React.createElement(CanvasDeferredNode, {
        id: "group", type: "group", data: { kind: "group", title: "参考素材", collapsed: false, tone: "cyan" }, selected: false,
        dragging: false, width: 800, height: 600, isConnectable: false, zIndex: -1001,
        draggable: true, selectable: true, deletable: true, positionAbsoluteX: 0, positionAbsoluteY: 0,
      })));
      const frame = host.querySelector<HTMLElement>('[data-canvas-group-frame="group"]')!;
      expect(frame).not.toBeNull();
      expect(frame.dataset.tone).toBe("cyan");
      // Percentage-height frames cannot pass through auto-height thumbnail wrappers.
      expect(frame.parentElement).toBe(host);
      expect(host.querySelector('[data-canvas-lod-handoff]')).toBeNull();
    } finally { state.zoom = previousZoom; }
  });
  it("renders stacked previews and allows restoring the nodes", async () => {
    await render(true, true, true);
    expect(host.querySelectorAll('.canvas-stack-card')).toHaveLength(2);
    expect((host.querySelector('[data-toolbar]') as HTMLElement).style.zIndex).toBe('50');
    expect((host.querySelector('.canvas-stack-frame > .absolute') as HTMLElement).style.height).toBe(`${24 / state.zoom}px`);
    expect(host.querySelector('.canvas-group-frame')).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="取消堆叠"]')!.click());
    expect(groupAction).toHaveBeenCalledWith("group", "ungroup");
  });
  it.each(["Enter", "blur", "Escape"])("renames from the whole heading with %s", async (action) => {
    await render();
    const heading = host.querySelector<HTMLElement>(".canvas-group-heading")!;
    act(() => heading.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = host.querySelector<HTMLInputElement>('[aria-label="分组名称"]')!;
    expect(input).not.toBeNull();
    expect(input.selectionEnd).toBe(input.value.length);
    act(() => { input.value = "  产品参考  "; Simulate.change(input); });
    // Confirming Chinese IME input must not submit the rename.
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })));
    expect(updateData).not.toHaveBeenCalled();
    act(() => action === "blur" ? input.blur() : Simulate.keyDown(input, { key: action }));
    expect(host.querySelector('[aria-label="分组名称"]')).toBeNull();
    if (action === "Escape") expect(updateData).not.toHaveBeenCalled();
    else {
      expect(updateData).toHaveBeenCalledTimes(1);
      expect(updateData.mock.calls[0][0]).toBe("group");
      expect(updateData.mock.calls[0][1]({ kind: "group", title: "参考素材", collapsed: false })).toEqual({ kind: "group", title: "产品参考", collapsed: false });
      expect(updateData.mock.calls[0][2]).toBe("push");
    }
  });

  it("does not flash group actions or selection decoration during a child marquee or its release", async () => {
    await render();
    expect(host.querySelector(".canvas-group-frame-selected")).not.toBeNull();
    // Pointer down arms the rectangle before React Flow marks selection active.
    state.userSelectionRect = { width: 0, height: 0 };
    await render();
    expect(host.querySelector(".canvas-group-frame-selected")).toBeNull();
    expect(host.querySelector("[data-toolbar]")).toBeNull();
    expect(state.resizeVisible).toBe(false);
    state.userSelectionActive = true;
    state.userSelectionRect = { width: 150, height: 200 };
    await render(false, false);
    expect(host.querySelector(".canvas-group-frame-selected")).toBeNull();
    expect(host.querySelector("[data-toolbar]")).toBeNull();
    expect(state.resizeVisible).toBe(false);
    // The native selected prop can still be true after pointer up; it is not authoritative.
    state.userSelectionActive = false; state.userSelectionRect = null;
    await render(false, false);
    expect(host.querySelector(".canvas-group-frame-selected")).toBeNull();
    expect(host.querySelector("[data-toolbar]")).toBeNull();
    expect(state.resizeVisible).toBe(false);
    await render();
    expect(host.querySelector("[data-toolbar]")).not.toBeNull();
    expect(host.querySelector(".canvas-group-frame-selected")).not.toBeNull();
    expect(state.resizeVisible).toBe(true);
  });

  it("keeps all six actions above the canvas pane and dispatches to the selected group", async () => {
    await render();
    const toolbar = host.querySelector<HTMLElement>("[data-toolbar]")!;
    expect(Number(toolbar.style.zIndex)).toBeGreaterThan(1);
    const colorButton = toolbar.querySelector<HTMLButtonElement>('button[aria-label="更换组底色"]')!;
    expect(toolbar.querySelector('button')).toBe(colorButton);
    await act(async () => colorButton.click());
    expect(document.querySelectorAll('[aria-label="组底色"] [role="menuitemradio"]')).toHaveLength(10);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="组底色"] [aria-label="绿色"]')!.click());
    expect(updateData).toHaveBeenLastCalledWith("group", expect.any(Function), "push");
    expect(updateData.mock.calls.at(-1)![1]({ kind: "group", title: "参考素材", collapsed: false })).toMatchObject({ tone: "green" });
    const saveButton = toolbar.querySelector<HTMLButtonElement>('button[aria-label="保存到素材库"]')!;
    await act(async () => saveButton.click());
    expect(saveMediaToLibrary).toHaveBeenCalledWith("group");
    const actions = ["toggle", "arrange", "preview", "grid", "download", "ungroup"];
    const buttons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>("button")).filter(button => button !== colorButton && button !== saveButton);
    expect(buttons).toHaveLength(actions.length);
    for (let i = 0; i < buttons.length; i++) {
      await act(async () => buttons[i].click());
      if (actions[i] === "arrange") {
        const gridOption = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-frosted-select-menu] button[role="option"]')).find(button => button.textContent?.includes("宫格重排"));
        expect(gridOption).toBeDefined();
        await act(async () => gridOption!.click());
        expect(groupAction).toHaveBeenLastCalledWith("group", "arrange", "grid");
      } else {
        expect(groupAction).toHaveBeenLastCalledWith("group", actions[i]);
      }
    }
    expect(host.querySelector(".canvas-group-heading")?.textContent).toBe("参考素材");
  });

  it("expands a collapsed group and fits the frame after a corner resize", async () => {
    await render(true);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="展开"]')!.click());
    expect(groupAction).toHaveBeenLastCalledWith("group", "toggle");
    await render();
    await act(async () => state.resizeEnd!());
    expect(groupAction).toHaveBeenLastCalledWith("group", "fit");
  });
});
