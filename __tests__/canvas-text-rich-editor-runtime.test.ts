// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { installCanvasDomMeasurements } from "./helpers/canvas-runtime-harness";

vi.mock("@xyflow/react", async original => ({ ...await original<any>(), NodeToolbar: ({ children }: any) => React.createElement("div", null, children) }));
import { CanvasTextRichEditor } from "@/components/canvas/CanvasTextRichEditor";

let host: HTMLDivElement, root: Root, restoreMeasurements: () => void;
const changed = vi.fn();
const colorChanged = vi.fn();
const copy = vi.fn(async (_text: string) => {});
const editor = () => (document.querySelector(".tiptap") as HTMLElement & { editor: Editor }).editor;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  restoreMeasurements = installCanvasDomMeasurements();
  const rect = document.createElement("div").getBoundingClientRect();
  Range.prototype.getBoundingClientRect = () => rect;
  Range.prototype.getClientRects = () => [rect] as unknown as DOMRectList;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  changed.mockClear(); copy.mockClear(); colorChanged.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); restoreMeasurements(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(value = "hello") {
  await act(async () => root.render(React.createElement(CanvasTextRichEditor, { value, onChange: changed, selected: true, title: "文本节点 1", onBackgroundColorChange: colorChanged })));
}
async function click(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}
describe("canvas manual text editor", () => {
  it("keeps the formatting toolbar off while the node is part of a multi-selection", async () => {
    await act(async () => root.render(React.createElement(CanvasTextRichEditor, { value: "片段", onChange: changed, selected: true, toolbarVisible: false, title: "片段 1 - 镜头拆解", onBackgroundColorChange: colorChanged })));
    expect(document.querySelector('button[aria-label="框底色"]')).toBeNull();
    await mount("片段");
    expect(document.querySelector('button[aria-label="框底色"]')).not.toBeNull();
  });
  it("selects a frame color and restores the default without changing text or formatting", async () => {
    await mount("**人物保留**");
    changed.mockClear();
    await click("框底色");
    expect(document.querySelectorAll('[aria-label="选择框底色"] button')).toHaveLength(10);
    await click("红色底色");
    expect(colorChanged).toHaveBeenLastCalledWith("#ef4444");
    expect(document.querySelector('[aria-label="选择框底色"]')).toBeNull();
    expect(editor().getMarkdown()).toBe("**人物保留**");
    expect(changed).not.toHaveBeenCalled();
    expect(editor().isEditable).toBe(false);
    await click("框底色"); await click("默认底色");
    expect(colorChanged).toHaveBeenLastCalledWith("");
    await click("框底色");
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.querySelector('[aria-label="选择框底色"]')).toBeNull();
  });
  it("allows node dragging until double-click editing and releases editing on Escape or outside click", async () => {
    await mount("人物保留");
    const surface = () => host.querySelector<HTMLElement>(".canvas-text-rich-editor")!;
    changed.mockClear();
    expect(editor().isEditable).toBe(false);
    expect(surface().closest(".nodrag")).toBeNull();
    await act(async () => { surface().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(editor().isEditable).toBe(true);
    expect(surface().classList.contains("nodrag")).toBe(true);
    await act(async () => { surface().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(editor().isEditable).toBe(false);
    expect(surface().classList.contains("nodrag")).toBe(false);
    await act(async () => { surface().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(editor().isEditable).toBe(false);
    expect(editor().getMarkdown()).toBe("人物保留");
    expect(changed).not.toHaveBeenCalled();
  });
  it("formats headings, bold and italic text and clears formatting without losing content", async () => {
    await mount();
    await click("一级标题"); expect(editor().getMarkdown().trim()).toBe("# hello");
    await click("二级标题"); expect(editor().getMarkdown().trim()).toBe("## hello");
    await click("三级标题"); expect(editor().getMarkdown().trim()).toBe("### hello");
    await click("正文"); expect(editor().getMarkdown().trim()).toBe("hello");
    act(() => { editor().commands.selectAll(); });
    await click("加粗"); expect(editor().getHTML()).toContain("<strong>hello</strong>");
    await click("斜体"); expect(editor().getHTML()).toContain("<em>");
    act(() => { editor().chain().unsetAllMarks().clearNodes().run(); }); expect(editor().getMarkdown().trim()).toBe("hello");
    expect(changed.mock.calls.at(-1)?.[0].trim()).toBe("hello");
  });
  it("creates ordered and unordered lists plus a horizontal rule", async () => {
    await mount();
    await click("无序列表"); expect(editor().getHTML()).toContain("<ul>");
    await click("有序列表"); expect(editor().getHTML()).toContain("<ol>");
    await click("有序列表");
    await click("分隔线"); expect(editor().getHTML()).toContain("<hr>");
    expect(changed).toHaveBeenCalled();
  });
  it("copies readable content and preserves the same editor when expanding and closing", async () => {
    await mount("# hello\n\n**world**");
    await click("复制内容"); expect(copy).toHaveBeenCalledWith("hello\nworld");
    const original = editor();
    await click("放大编辑器");
    expect(document.querySelector("dialog[open] .tiptap")).not.toBeNull();
    expect(editor()).toBe(original);
    act(() => { editor().commands.insertContent("added"); });
    const content = editor().getMarkdown();
    await click("关闭文本编辑器");
    expect(document.querySelector("dialog")).toBeNull();
    expect(editor()).toBe(original);
    expect(editor().getMarkdown()).toBe(content);
  });
  it("restores saved formatting and accepts a canvas undo without emitting a new edit", async () => {
    await mount("## 标题\n\n- 一\n- 二");
    expect(editor().getHTML()).toContain("<h2>标题</h2>");
    expect(editor().getHTML()).toContain("<ul>");
    changed.mockClear();
    await mount("earlier");
    expect(editor().getMarkdown()).toBe("earlier");
    expect(changed).not.toHaveBeenCalled();
  });
});
