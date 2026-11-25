// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasGeneratorShell } from "@/components/canvas/CanvasGeneratorShell";
import { CanvasPanelHiddenContext } from "@/components/canvas/canvas-runtime-context";

const storageKey = "canvas_generator_expanded_v1_guest";
let root: Root;
let host: HTMLDivElement;

function render(nodeId = "first", hidden = false) {
  act(() => root.render(React.createElement(CanvasPanelHiddenContext.Provider, { value: hidden },
    React.createElement(CanvasGeneratorShell, { key: nodeId, nodeId, title: "图片",
      children: React.createElement("textarea", { defaultValue: "原提示词" }) }))));
}
function click(label: string) {
  act(() => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
}
const panel = () => document.querySelector<HTMLElement>("[data-canvas-generator-expanded]");
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);

});
afterEach(() => {
  act(() => {
    window.localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
});

describe("persistent canvas generator size mode", () => {
  it.each([false, true])("keeps the editor mounted through interruptible motion (reduced motion: %s)", (reduced) => {
    const animations: Array<{ cancel: ReturnType<typeof vi.fn>; onfinish: null | (() => void) }> = [];
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
    const animate = vi.fn(() => {
      const animation = { cancel: vi.fn(), onfinish: null as null | (() => void) };
      animations.push(animation);
      return animation;
    });
    Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
    vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "dialog"
        ? { left: 200, top: 100, width: 800, height: 600 } as DOMRect
        : { left: 50, top: 350, width: 660, height: 272 } as DOMRect;
    });
    try {
      render();
      const editor = host.querySelector("textarea")!;
      click("放大编辑窗口");
      expect(document.querySelector('[role="dialog"] textarea')).toBe(editor);
      if (reduced) expect(animate).not.toHaveBeenCalled();
      else {
        expect(animate.mock.calls.length).toBe(2);
        expect((animate.mock.calls as unknown as [Keyframe[], KeyframeAnimationOptions][])[0][1].duration).toBe(240);
      }
      // Closing before entry finishes cancels entry, but retains the same editor until exit ends.
      click("关闭大编辑窗口");
      if (!reduced) {
        expect(animations[0].cancel).toHaveBeenCalled();
        expect(document.querySelector('[role="dialog"] textarea')).toBe(editor);
        const keyframes = (animate.mock.calls as unknown as [Keyframe[]][]).flatMap(([frames]) => frames);
        expect(keyframes.every(frame => !String(frame.transform || "").includes("scale"))).toBe(true);
        expect(keyframes.every(frame => frame.width === undefined && frame.height === undefined)).toBe(true);
        act(() => animations[2].onfinish?.());
      }
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(host.querySelector("textarea")).toBe(editor);
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "animate", original);
      else Reflect.deleteProperty(HTMLElement.prototype, "animate");
      vi.unstubAllGlobals();
    }
  });

  it.each([false, true])("opens a separate resizable dialog and restores inline mode %s without remounting the editor", (expanded) => {
    window.localStorage.setItem(storageKey, String(expanded));
    render();
    const editor = host.querySelector("textarea")!;
    editor.value = "窗口切换时保留的草稿";
    const corner = host.querySelector('.canvas-generator-corner-button')!;
    expect(corner.getAttribute("aria-expanded")).toBe(String(expanded));
    click("放大编辑窗口");
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(host.contains(dialog)).toBe(false);
    expect(dialog.querySelector("textarea")).toBe(editor);
    expect(dialog.querySelectorAll("[data-canvas-generator-resize]")).toHaveLength(8);
    expect(dialog.querySelector(".canvas-generator-corner-button")).toBeNull();
    expect(window.localStorage.getItem(storageKey)).toBe(String(expanded));
    const width = parseFloat(dialog.style.width);
    act(() => {
      dialog.querySelector('[data-canvas-generator-resize="e"]')!.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, bubbles: true }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 150 }));
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    expect(parseFloat(dialog.style.width)).toBeGreaterThan(width);
    act(() => editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector("textarea")).toBe(editor);
    expect(editor.value).toBe("窗口切换时保留的草稿");
    expect(Boolean(panel())).toBe(expanded);
    click("放大编辑窗口");
    click("关闭大编辑窗口");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector("textarea")).toBe(editor);
  });

  it("stays expanded after outside clicks, Escape, hidden state and switching nodes; only the toggle collapses it", () => {
    render();
    const editor = host.querySelector("textarea")!;
    editor.value = "正在编辑的草稿";
    click("展开编辑面板");
    expect(host.querySelector("textarea")).toBe(editor);
    expect(host.contains(panel())).toBe(true);
    expect(document.querySelector("[data-canvas-generator-backdrop]")).toBeNull();
    act(() => {
      document.body.click();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(panel()).not.toBeNull();
    render("first", true);
    expect(panel()?.style.visibility).toBe("hidden");
    render("first");
    expect(panel()?.style.visibility).toBe("");
    expect(document.querySelector("textarea")?.value).toBe("正在编辑的草稿");
    render("second");
    expect(panel()).not.toBeNull();
    expect(window.localStorage.getItem(storageKey)).toBe("true");
    click("收起编辑面板");
    render("third");
    expect(panel()).toBeNull();
    expect(window.localStorage.getItem(storageKey)).toBe("false");
  });

  it("restores a saved expanded mode on a fresh mount", () => {
    window.localStorage.setItem(storageKey, "true");
    render();
    expect(panel()).not.toBeNull();
    expect(panel()?.style.width).toBe("");
  });

  it("still toggles and remembers across remounts when storage writes fail", () => {
    window.localStorage.setItem(storageKey, "true");
    vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    render();
    click("收起编辑面板");
    render("second");
    expect(panel()).toBeNull();
    click("展开编辑面板");
    render("third");
    expect(panel()).not.toBeNull();
  });
});
