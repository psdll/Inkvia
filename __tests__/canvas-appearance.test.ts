// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { beforeEach, afterEach, expect, it } from "vitest";
import {
  CanvasAppearance,
  CanvasAppearanceSettings,
  useCanvasAppearance,
} from "@/components/canvas/CanvasAppearance";

let host: HTMLDivElement, root: Root;
function Probe() {
  return React.createElement(
    "output",
    null,
    JSON.stringify(useCanvasAppearance().value),
  );
}
function render(canvasId = 1) {
  act(() =>
    root.render(
      React.createElement(CanvasAppearance, {
        ownerId: 7,
        canvasId,
        key: canvasId,
        children: [
          React.createElement(CanvasAppearanceSettings, { key: "settings" }),
          React.createElement(Probe, { key: "probe" }),
        ],
      }),
    ),
  );
}
function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (button) =>
      button.getAttribute("aria-label") === label ||
      button.textContent === label,
  );
  expect(button).toBeTruthy();
  act(() => button!.click());
}
beforeEach(() => {
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("opens a separate color popover without changing the settings layout and closes it before settings", () => {
  render(); click("画布设置"); click("自定义背景颜色");
  const popover = document.querySelector<HTMLElement>('[data-canvas-color-popover]')!;
  expect(popover).not.toBeNull();
  expect(host.contains(popover)).toBe(false);
  expect(popover.querySelectorAll('[aria-label^="选择颜色"]')).toHaveLength(24);
  act(() => popover.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  act(() => popover.querySelector<HTMLButtonElement>('[aria-label="选择颜色 #60a5fa"]')!.click());
  expect(host.querySelector('output')?.textContent).toContain('"background":"#60a5fa"');
  const hex = popover.querySelector<HTMLInputElement>('[aria-label="HEX 颜色值"]')!;
  act(() => Simulate.change(hex, { target: { value: '#abcdef' } } as any));
  act(() => Simulate.blur(hex));
  expect(host.querySelector('output')?.textContent).toContain('"background":"#abcdef"');
  act(() => Simulate.change(hex, { target: { value: 'invalid' } } as any));
  act(() => Simulate.blur(hex));
  expect(hex.value).toBe('#abcdef');
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[data-canvas-color-popover]')).toBeNull();
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('自定义背景颜色');
});
it("changes styles immediately, persists them per canvas, and restores defaults", () => {
  render();
  click("画布设置");
  click("网格");
  click("背景：雾绿");
  click("高光：紫色");
  expect(host.querySelector("output")?.textContent).toContain(
    '"pattern":"grid"',
  );
  expect(
    host
      .querySelector<HTMLElement>("[data-canvas-appearance]")!
      .style.getPropertyValue("--canvas-bg"),
  ).toBe("#1e2923");
  expect(
    host
      .querySelector<HTMLElement>("[data-canvas-appearance]")!
      .style.getPropertyValue("--canvas-edge-flow"),
  ).toBe("#b59aff");
  render(2);
  expect(host.querySelector("output")?.textContent).toContain(
    '"background":""',
  );
  render(1);
  expect(host.querySelector("output")?.textContent).toContain(
    '"background":"#1e2923"',
  );
  click("画布设置");
  click("纯色");
  expect(host.querySelector("output")?.textContent).toContain(
    '"pattern":"solid"',
  );
  click("恢复默认");
  expect(
    JSON.parse(window.localStorage.getItem("canvas_appearance_v1_7_1")!),
  ).toEqual({ pattern: "dots", background: "", highlight: "" });
});
it("rejects malformed saved preferences and closes on Escape with focus restored", () => {
  window.localStorage.setItem(
    "canvas_appearance_v1_7_1",
    JSON.stringify({
      pattern: "invalid",
      background: "url(bad)",
      highlight: "red",
    }),
  );
  render();
  expect(host.querySelector("output")?.textContent).toBe(
    '{"pattern":"dots","background":"","highlight":""}',
  );
  click("画布设置");
  expect(host.querySelector('[role="dialog"]')).toBeTruthy();
  act(() =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement?.getAttribute("aria-label")).toBe("画布设置");
});
