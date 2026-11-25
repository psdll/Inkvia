import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CanvasArrangeMenu } from "@/components/canvas/CanvasArrangeMenu";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === label ||
      b.textContent?.startsWith(label),
  );
  expect(button).toBeTruthy();
  act(() => button!.click());
}
it("runs classification directly from the compact submenu", () => {
  const onArrange = vi.fn();
  act(() => root.render(React.createElement(CanvasArrangeMenu, { onArrange })));
  click("整理画布");
  click("分类整理");
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).not.toContain("预览整理");
  click("按素材类型");
  expect(onArrange).toHaveBeenCalledWith({
    category: "media",
    layout: "grid",
    followConnections: false,
  });
  expect(host.querySelector('[role="menu"]')).toBeNull();
});
it("toggles upstream organization without closing, then runs the chosen layout", () => {
  const onArrange = vi.fn();
  act(() => root.render(React.createElement(CanvasArrangeMenu, { onArrange })));
  click("整理画布");
  click("布局整理");
  click("整理相连的上下游");
  expect(onArrange).not.toHaveBeenCalled();
  expect(
    host
      .querySelector('[role="menuitemcheckbox"]')
      ?.getAttribute("aria-checked"),
  ).toBe("true");
  click("垂直布局");
  expect(onArrange).toHaveBeenCalledWith({
    category: "none",
    layout: "vertical",
    followConnections: true,
  });
  expect(host.querySelector('[role="menu"]')).toBeNull();
});
it("supports keyboard navigation, escape, outside click and disabled state", () => {
  const onArrange = vi.fn();
  act(() => root.render(React.createElement(CanvasArrangeMenu, { onArrange })));
  click("整理画布");
  act(() =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  expect(document.activeElement?.textContent).toBe("布局整理");
  expect(host.querySelector('[role="menu"][aria-label="布局整理"]')).toBeNull();
  click("布局整理");
  expect(
    host.querySelector('[role="menu"][aria-label="布局整理"]'),
  ).not.toBeNull();
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(host.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("整理画布");
  click("整理画布");
  act(() =>
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })),
  );
  expect(host.querySelector('[role="menu"]')).toBeNull();
  act(() =>
    root.render(
      React.createElement(CanvasArrangeMenu, { onArrange, disabled: true }),
    ),
  );
  expect(host.querySelector("button")?.disabled).toBe(true);
});
it("expands sections on click, collapses on repeat click, and keeps tidy independent of connections", () => {
  const onArrange = vi.fn();
  act(() => root.render(React.createElement(CanvasArrangeMenu, { onArrange })));
  click("整理画布");
  expect(host.textContent).not.toContain("按素材类型");
  click("分类整理"); expect(host.textContent).toContain("按素材类型");
  click("分类整理"); expect(host.textContent).not.toContain("按素材类型");
  click("布局整理"); click("整理相连的上下游"); click("对齐现有布局");
  expect(onArrange).toHaveBeenCalledWith({ category: "none", layout: "tidy", followConnections: false });
});
