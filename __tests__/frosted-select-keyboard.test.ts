/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */

import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

import { FrostedSelect } from "@/components/ui/frosted-select";

const OPTIONS = [
  { value: "first", label: "第一项" },
  { value: "second", label: "第二项" },
];

function KeyboardHarness() {
  const [value, setValue] = React.useState("first");
  return React.createElement(FrostedSelect, { value, onChange: setValue, options: OPTIONS });
}

const domKeys = [[Element.prototype, 'scrollIntoView'], [HTMLCanvasElement.prototype, 'getContext']] as const;
const originalDom = domKeys.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key));
afterAll(() => { vi.unstubAllGlobals(); domKeys.forEach(([target, key], i) => { const descriptor=originalDom[i]; if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key); }); });
beforeAll(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = () => undefined;
  HTMLCanvasElement.prototype.getContext = (() => ({
    measureText: (text: string) => ({ width: text.length * 8 }),
  })) as any;
});

describe("FrostedSelect keyboard selection", () => {
  it("commits the active option with Enter while the menu is open", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(KeyboardHarness));
    });

    const button = host.querySelector("button") as HTMLButtonElement;
    await act(async () => button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await act(async () => button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));

    expect(button.textContent).toContain("第二项");
    expect(button.getAttribute("aria-expanded")).toBe("false");

    await act(async () => root.unmount());
    host.remove();
  });
});


describe("administrator dropdown in a drawer", () => {
  it("opens below a top trigger and Escape closes only the menu", async () => {
    document.documentElement.dataset.adminDropdownScope = "true";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const close = vi.fn();
    try {
      await act(async () => root.render(React.createElement(ConfirmDialog, {
        open: true, placement: "right", focusPanelOnOpen: true,
        title: "测试抽屉", onClose: close, onConfirm: () => {},
      }, React.createElement(KeyboardHarness))));
      const trigger = document.querySelector<HTMLButtonElement>("button[aria-haspopup=listbox]")!;
      trigger.getBoundingClientRect = () => ({ top: 100, bottom: 140, left: 100, right: 240, width: 140, height: 40, x: 100, y: 100, toJSON() {} });
      await act(async () => trigger.click());
      const menu = document.querySelector<HTMLElement>("[role=listbox]")!;
      expect(menu.closest("[role=dialog]")).not.toBeNull();
      expect(Number.parseFloat(menu.style.top)).toBe(146);
      await act(async () => (menu.querySelector("button") as HTMLButtonElement).focus());
      expect(menu.contains(document.activeElement)).toBe(true);
      await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(document.querySelector("[role=listbox]")).toBeNull();
      expect(close).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(trigger);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      delete document.documentElement.dataset.adminDropdownScope;
    }
  });
});
