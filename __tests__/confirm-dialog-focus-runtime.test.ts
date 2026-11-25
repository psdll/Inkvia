/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((item) => item.textContent === label)!;
const key = async (target: Element, value: string, extra = {}) => {
  await act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...extra })));
};

describe("shared confirmation keyboard behavior", () => {
  it.each(["center", "right"] as const)("%s: names the dialog, traps Tab and returns focus", async (placement) => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return React.createElement(React.Fragment, null,
        React.createElement("button", { onClick: () => setOpen(true) }, "删除入口"),
        React.createElement(ConfirmDialog, { open, placement, title: "删除项目", description: "移入回收站", danger: true, onClose: () => setOpen(false), onConfirm: vi.fn() }));
    }
    await act(async () => root.render(React.createElement(Harness)));
    const opener = button("删除入口"); opener.focus();
    await act(async () => opener.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("删除项目");
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe("移入回收站");
    expect(document.activeElement).toBe(button("取消"));
    button("确定").focus(); await key(button("确定"), "Tab");
    const close = document.querySelector('[aria-label="关闭"]')!;
    expect(document.activeElement).toBe(close);
    await key(close, "Tab", { shiftKey: true }); expect(document.activeElement).toBe(button("确定"));
    opener.focus(); expect(dialog.contains(document.activeElement)).toBe(true);
    await key(button("确定"), "Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps input focus on rerender and avoids duplicate submission before React commits", async () => {
    let resolve!: (value: boolean) => void;
    const confirm = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    const close = vi.fn();
    const props = { open: true, title: "重命名", onClose: close, onConfirm: confirm, children: React.createElement("input", { defaultValue: "项目" }) };
    await act(async () => root.render(React.createElement(ConfirmDialog, props)));
    const input = document.querySelector("input")!; expect(document.activeElement).toBe(input);
    await act(async () => root.render(React.createElement(ConfirmDialog, { ...props, description: "请修改名称" })));
    expect(document.activeElement).toBe(input);
    await act(async () => { button("确定").click(); button("确定").click(); });
    expect(confirm).toHaveBeenCalledTimes(1);
    await key(input, "Escape"); expect(close).not.toHaveBeenCalled();
    await act(async () => resolve(false)); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(button("确定").disabled).toBe(false);
  });

  it("lets only the top confirmation consume Escape and restores the underlying focus", async () => {
    const outsideEscape = vi.fn(); window.addEventListener("keydown", outsideEscape);
    function Harness() {
      const [inner, setInner] = React.useState(false);
      return React.createElement(React.Fragment, null,
        React.createElement(ConfirmDialog, { open: true, title: "外层", onClose: vi.fn(), onConfirm: vi.fn(), children: React.createElement("button", { onClick: () => setInner(true) }, "打开内层") }),
        React.createElement(ConfirmDialog, { open: inner, title: "内层", danger: true, onClose: () => setInner(false), onConfirm: vi.fn() }));
    }
    await act(async () => root.render(React.createElement(Harness)));
    const opener = button("打开内层"); opener.focus(); await act(async () => opener.click());
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    await key(document.activeElement!, "Escape");
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.activeElement).toBe(opener); expect(document.body.style.overflow).toBe("hidden");
    expect(outsideEscape).not.toHaveBeenCalled(); window.removeEventListener("keydown", outsideEscape);
  });

  it("does not confirm during IME composition or when Enter belongs to a textarea", async () => {
    const confirm = vi.fn();
    await act(async () => root.render(React.createElement(ConfirmDialog, { open: true, title: "编辑", onClose: vi.fn(), onConfirm: confirm, children: React.createElement("textarea") })));
    const input = document.querySelector("textarea")!;
    await key(input, "Enter", { isComposing: true }); await key(input, "Enter");
    expect(confirm).not.toHaveBeenCalled();
  });
});
