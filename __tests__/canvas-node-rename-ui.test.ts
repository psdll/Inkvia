// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasEditableNodeName } from "@/components/canvas/CanvasEditableNodeName";
import { CanvasReadOnlyContext } from "@/components/canvas/CanvasReadOnlyContext";

let host: HTMLDivElement, root: Root;
const rename = vi.fn(), shortcut = vi.fn(), doubleClick = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function render(readOnly = false) {
  act(() => root.render(React.createElement(CanvasReadOnlyContext.Provider, { value: readOnly },
    React.createElement("div", { onKeyDown: shortcut, onDoubleClick: doubleClick },
      React.createElement(CanvasEditableNodeName, { name: "原名", onRename: rename })))));
}
function edit(value: string) {
  act(() => host.querySelector("span")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  const input = host.querySelector("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}
function key(input: HTMLInputElement, key: string, isComposing = false) {
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key, isComposing, bubbles: true })));
}

describe("node name editing", () => {
  it.each(["Enter", "blur"])("saves once on %s without bubbling to canvas", finish => {
    render(); const input = edit(" 新名称 ");
    expect(document.activeElement).toBe(input);
    expect(doubleClick).not.toHaveBeenCalled();
    if (finish === "Enter") key(input, "Enter");
    else act(() => input.blur());
    expect(rename).toHaveBeenCalledOnce();
    expect(rename).toHaveBeenCalledWith("新名称");
    expect(shortcut).not.toHaveBeenCalled();
  });
  it("cancels with Escape and rejects blank names", () => {
    render(); key(edit("取消的名称"), "Escape");
    expect(rename).not.toHaveBeenCalled();
    expect(host.textContent).toBe("原名");
    key(edit("   "), "Enter");
    expect(rename).not.toHaveBeenCalled();
  });
  it("does not save while confirming Chinese composition", () => {
    render(); const input = edit("角色");
    key(input, "Enter", true);
    expect(host.querySelector("input")).toBe(input);
    expect(rename).not.toHaveBeenCalled();
    key(input, "Enter");
    expect(rename).toHaveBeenCalledOnce();
    expect(rename).toHaveBeenCalledWith("角色");
  });
  it("keeps read-only canvas names immutable", () => {
    render(true);
    act(() => host.querySelector("span")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(host.querySelector("input")).toBeNull();
    expect(rename).not.toHaveBeenCalled();
  });
});
