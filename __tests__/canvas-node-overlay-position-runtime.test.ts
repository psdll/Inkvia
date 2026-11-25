import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasTaskParameterPopover } from "@/components/canvas/CanvasTaskParameterPopover";
import { FrostedSelect } from "@/components/ui/frosted-select";

let host: HTMLDivElement;
let root: Root;
let anchorRect: DOMRect;
function rect(x: number, y: number, width: number, height: number): DOMRect {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => anchorRect);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("node overlays may extend outside the viewport", () => {
  it("follows a moved panel without a resize or scroll event and stops when closed", async () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++nextId, callback); return nextId; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
    const anchorRef = React.createRef<HTMLButtonElement>();
    const render = (open: boolean) => act(async () => root.render(React.createElement(React.Fragment, null,
      React.createElement("button", { ref: anchorRef }, "比例"),
      React.createElement(CanvasTaskParameterPopover, { open, anchorRef, onClose: vi.fn(), side: "top", children: "比例选项" }),
    )));
    anchorRect = rect(760, 560, 230, 32);
    await render(true);
    const panel = document.querySelector<HTMLElement>("[data-canvas-task-parameter-portal]")!;
    anchorRect = rect(670, 730, 230, 32);
    await act(async () => {
      const pending = [...frames]; frames.clear();
      pending.forEach(([, callback]) => callback(16));
    });
    expect(panel.style.left).toBe("670px");
    expect(panel.style.bottom).toBe(`${window.innerHeight - 730 + 8}px`);
    await render(false);
    expect(frames.size).toBe(0);
    expect(document.querySelector("[data-canvas-task-parameter-portal]")).toBeNull();
  });
  it.each(["top", "bottom", "auto"] as const)("anchors the %s parameter popover without shifting or shrinking it", async (side) => {
    const anchorRef = React.createRef<HTMLButtonElement>();
    anchorRect = rect(-140, -60, 80, 32);
    await act(async () => root.render(React.createElement(React.Fragment, null,
      React.createElement("button", { ref: anchorRef }, "参数"),
      React.createElement(CanvasTaskParameterPopover, { open: true, anchorRef, onClose: vi.fn(), width: 360, maxHeight: 500, side, align: "center", children: "参数内容" }),
    )));
    const panel = document.querySelector<HTMLElement>("[data-canvas-task-parameter-portal]")!;
    expect(panel.style.left).toBe("-280px");
    expect(panel.style.width).toBe("360px");
    expect(panel.style.maxHeight).toBe("500px");
    if (side === "bottom") expect(panel.style.top).toBe("-20px");
    else expect(panel.style.bottom).toBe(`${window.innerHeight + 68}px`);

    // Moving the anchor changes its position by the same amount, even across screen edges.
    anchorRect = rect(window.innerWidth + 100, window.innerHeight + 80, 80, 32);
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(panel.style.left).toBe(`${window.innerWidth - 40}px`);
    if (side === "bottom") expect(panel.style.top).toBe(`${window.innerHeight + 120}px`);
    else expect(panel.style.bottom).toBe("-72px");
    expect(panel.style.maxHeight).toBe("500px");
  });

  it.each(["top", "bottom", "auto"] as const)("keeps canvas selects on the requested %s side when their node is at the edge", async (side) => {
    anchorRect = rect(-140, window.innerHeight - 20, 80, 32);
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      return this.tagName === "BUTTON" ? anchorRect : rect(0, 0, 360, 400);
    });
    await act(async () => root.render(React.createElement(FrostedSelect, {
      variant: "canvas", side, value: "a", onChange: vi.fn(), menuWidth: 360, menuMaxHeight: 300,
      options: Array.from({ length: 10 }, (_, index) => ({ value: String(index), label: `模型 ${index}` })),
    })));
    await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
    const menu = document.querySelector<HTMLElement>("[data-frosted-select-menu]")!;
    expect(menu.style.left).toBe("-140px");
    expect(menu.style.width).toBe("360px");
    expect(menu.style.maxHeight).toBe("300px");
    if (side === "top") expect(menu.style.bottom).toBe("30px");
    else expect(menu.style.top).toBe(`${window.innerHeight + 22}px`);
  });

  it("preserves screen-boundary avoidance for selects outside the canvas", async () => {
    anchorRect = rect(-140, window.innerHeight - 20, 80, 32);
    await act(async () => root.render(React.createElement(FrostedSelect, {
      value: "a", onChange: vi.fn(), menuWidth: 360,
      options: [{ value: "a", label: "普通页面选项" }],
    })));
    await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
    const menu = document.querySelector<HTMLElement>("[data-frosted-select-menu]")!;
    expect(menu.style.left).toBe("12px");
    expect(menu.style.bottom).toBe("30px");
    expect(menu.style.top).toBe("");
  });
});
