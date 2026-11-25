import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptRichEditor } from "@/components/ui/prompt-rich-editor";
import { ExpandablePromptTextarea } from "@/components/ui/expandable-prompt-textarea";
import { closeHistory } from "@tiptap/pm/history";
import type { RoleSkillListItem } from "@/lib/role-skills/contracts";
import { editorDocToPromptText, type PromptRichEditorDoc } from "@/lib/prompt-rich-editor-content";
import { matchHotkey, parseHotkeyString } from "@/lib/hotkeys";
import { CHARACTER_SHEET_PRESET_ID, CHARACTER_SHEET_TOKEN } from "@/lib/canvas/creative-presets/inline-token";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: 7 }, openLoginModal: vi.fn() }),
}));

type Props = Partial<React.ComponentProps<typeof PromptRichEditor>> & { initialValue?: string };

function Harness({ initialValue = "abcdefghij", ...props }: Props) {
  const [value, setValue] = React.useState(initialValue);
  return React.createElement(PromptRichEditor, {
    assets: [],
    ...props,
    value,
    onValueChange: setValue,
  });
}

const skill: RoleSkillListItem = {
  id: "system:1", source: "system", mediaType: "image", name: "商品广告导演",
  summary: "生成商品广告画面", category: "营销", coverUrl: null,
  usageScenario: "产品图", usageGuide: "输入商品信息", revision: 1,
  createdAt: "2026-09-03T00:00:00.000Z", updatedAt: "2026-09-03T00:00:00.000Z",
};

let host: HTMLDivElement;
let root: Root;
const currentEditor = () => (document.querySelector(".tiptap") as HTMLElement & { editor: Editor }).editor;
const render = async (props: Props = {}) => {
  await act(async () => root.render(React.createElement(Harness, props)));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has no layout; ProseMirror and the suggestion popup measure DOM ranges.
  const rect = document.createElement("div").getBoundingClientRect();
  Range.prototype.getBoundingClientRect = () => rect;
  Range.prototype.getClientRects = () => [rect] as unknown as DOMRectList;
  HTMLElement.prototype.scrollIntoView = vi.fn();
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

describe("prompt editor interaction stability", () => {
  it.each(["", "\n"])("places the caret on either side of a leading asset after %j", async (prefix) => {
    await render({ initialValue: `${prefix}@图片1描述`, assets: [{ id: "a", token: "图片1", kind: "image", url: "/uploads/fixture-a.png" }] });
    const editor = currentEditor();
    const tag = host.querySelector<HTMLElement>("[data-asset-mention]")!;
    expect(host.querySelector("[data-asset-caret-anchor]")).not.toBeNull();
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toBe(`${prefix}@图片1描述`);
    tag.getBoundingClientRect = () => ({ left: 100, width: 60 } as DOMRect);
    await act(async () => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      tag.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 102, button: 0 }));
    });
    expect(editor.state.selection.from).toBe(prefix.length + 1);
    expect(host.querySelector("[data-asset-visible-caret]")).not.toBeNull();
    expect(editor.view.dom.getAttribute("data-asset-caret-active")).toBe("true");
    await act(async () => { editor.commands.insertContent("前文"); });
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toBe(`${prefix}前文@图片1描述`);
    await act(async () => { tag.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 158, button: 0 })); });
    expect(editor.state.selection.from).toBe(prefix.length + 4);
    expect(host.querySelector("[data-asset-visible-caret]")).toBeNull();
    await act(async () => { editor.commands.insertContent("后文"); });
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toBe(`${prefix}前文@图片1后文描述`);
  });
  it("hides the asset caret for a range selection and in a disabled editor", async () => {
    await render({ initialValue: "@图片1描述", assets: [{ id: "a", token: "图片1", kind: "image", url: "/uploads/fixture-a.png" }] });
    const editor = currentEditor();
    await act(async () => { editor.commands.setTextSelection(1); });
    expect(host.querySelector("[data-asset-visible-caret]")).not.toBeNull();
    await act(async () => { editor.commands.setTextSelection({ from: 1, to: 3 }); });
    expect(host.querySelector("[data-asset-visible-caret]")).toBeNull();
    await act(async () => { editor.commands.setTextSelection(1); editor.setEditable(false); });
    expect(host.querySelector("[data-asset-visible-caret]")).toBeNull();
  });
  it("inserts the character sheet at the selection and can undo and delete the inline tag", async () => {
    const handle = React.createRef<import("@/components/ui/prompt-rich-editor").PromptCreativeEditorHandle>();
    await render({ initialValue: "前文后文", creativeEditorRef: handle });
    const editor = currentEditor();
    const preset = { id: CHARACTER_SHEET_PRESET_ID, name: "角色设定图" };
    await act(async () => { editor.commands.setTextSelection(3); handle.current!.insertPreset(preset); });
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toBe(`前文${CHARACTER_SHEET_TOKEN}后文`);
    await act(async () => { editor.commands.undo(); });
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toBe("前文后文");
    await act(async () => { editor.commands.setTextSelection({ from: 1, to: 3 }); handle.current!.insertPreset(preset); });
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toBe(`${CHARACTER_SHEET_TOKEN}后文`);
    await act(async () => { editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })); });
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toBe("后文");
  });
  it("renders the character sheet inside the editable prompt and removes it with Backspace", async () => {
    const handle = React.createRef<import("@/components/ui/prompt-rich-editor").PromptCreativeEditorHandle>();
    await render({ initialValue: `${CHARACTER_SHEET_TOKEN}\n补充要求`, creativeEditorRef: handle });
    const editor = currentEditor();
    expect(editor.view.dom.querySelector('[data-motion-id="characterSheet-0"]')?.textContent).toContain("角色设定图");
    await act(async () => {
      editor.commands.setTextSelection(2);
      editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    });
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).not.toContain(CHARACTER_SHEET_TOKEN);
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toContain("补充要求");
  });
  it.each(["mount", "expand"])("focuses the canvas editor on %s without requesting ancestor scrolling", async (action) => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    await render({ variant: "canvasGenerator", autoFocus: action === "mount", expanded: action === "mount" });
    const editor = currentEditor();
    const scroll = vi.fn(() => true);
    editor.view.setProps({ handleScrollToSelection: scroll });
    if (action === "expand") await render({ variant: "canvasGenerator", autoFocus: true, expanded: true });
    await act(async () => {
      while (frames.length) frames.shift()!(0);
    });
    expect(editor.view.hasFocus()).toBe(true);
    expect(scroll).not.toHaveBeenCalled();
  });

  it.each([false, true])("reserves Ctrl+Enter for generation without changing the prompt (generation disabled: %s)", async (disabled) => {
    const generate = vi.fn();
    const hotkey = parseHotkeyString("Ctrl+Enter");
    await render({
      initialValue: "ABCD",
      onKeyDown: (event) => {
        if (!matchHotkey(event.nativeEvent, hotkey)) return;
        event.preventDefault();
        if (!disabled) generate();
      },
    });
    const editor = currentEditor();
    act(() => { editor.commands.setTextSelection(3); editor.view.focus(); });
    await act(async () => {
      editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", keyCode: 13, ctrlKey: true, bubbles: true, cancelable: true,
      }));
    });
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toBe("ABCD");
    expect(editor.state.selection.from).toBe(3);
    expect(generate).toHaveBeenCalledTimes(disabled ? 0 : 1);
  });

  it("does not insert a Ctrl+Enter newline when no page shortcut handler is attached", async () => {
    await render({ initialValue: "ABCD" });
    const editor = currentEditor();
    act(() => { editor.commands.setTextSelection(3); editor.view.focus(); });
    await act(async () => {
      editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", keyCode: 13, ctrlKey: true, bubbles: true, cancelable: true,
      }));
    });
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toBe("ABCD");
  });

  it.each([false, true])("keeps Enter available for newline without generating (shift: %s)", async (shiftKey) => {
    const generate = vi.fn();
    const hotkey = parseHotkeyString("Ctrl+Enter");
    await render({
      initialValue: "ABCD",
      onKeyDown: (event) => {
        if (matchHotkey(event.nativeEvent, hotkey)) { event.preventDefault(); generate(); }
      },
    });
    const editor = currentEditor();
    act(() => { editor.commands.setTextSelection(3); editor.view.focus(); });
    await act(async () => {
      editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", keyCode: 13, shiftKey, bubbles: true, cancelable: true,
      }));
    });
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toBe("AB\nCD");
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps the same editor, selection and undo history across expanding and collapsing", async () => {
    function ExpandableHarness() {
      const [value, onChange] = React.useState("abcdefghij");
      return React.createElement(ExpandablePromptTextarea, { value, onChange });
    }
    await act(async () => root.render(React.createElement(ExpandableHarness)));
    const editor = currentEditor();
    act(() => {
      editor.commands.insertContentAt(4, "!");
      editor.commands.setTextSelection({ from: 2, to: 6 });
    });
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="展开提示词"]')!.click());
    expect(currentEditor() === editor).toBe(true);
    expect(editor.state.selection.from).toBe(2);
    expect(editor.state.selection.to).toBe(6);
    expect(editor.can().undo()).toBe(true);
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭提示词面板"]')!.click());
    expect(currentEditor() === editor).toBe(true);
    act(() => { editor.commands.undo(); });
    expect(editor.getText()).toBe("abcdefghij");
  });

  it.each(["@", "/"])("closes the %s suggestion menu before the expanded panel on Escape", async (trigger) => {
    function ExpandableHarness() {
      const [value, onChange] = React.useState("");
      return React.createElement(ExpandablePromptTextarea, { value, onChange, assets: [{ id: "a", token: "图片1", kind: "image", url: "/uploads/fixture-a.png" }], roleSkills: [skill], onRoleSkillSelect: vi.fn() });
    }
    await act(async () => root.render(React.createElement(ExpandableHarness)));
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="展开提示词"]')!.click());
    const editor = currentEditor();
    const menuSelector = trigger === "@" ? "[data-prompt-asset-menu]" : "[data-role-skill-slash-menu]";
    await act(async () => { editor.view.focus(); editor.commands.insertContent(trigger); });
    expect(document.querySelector(menuSelector)).not.toBeNull();
    await act(async () => { editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true })); });
    expect(document.querySelector('[aria-label="关闭提示词面板"]')).not.toBeNull();
    expect(document.querySelector(menuSelector)).toBeNull();
    await act(async () => { editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true })); });
    expect(document.querySelector('[aria-label="关闭提示词面板"]')).toBeNull();
  });

  it("converts references after repeatedly replacing the prompt without remounting", async () => {
    const asset = { id: "a", token: "图片1", kind: "image" as const, url: "/uploads/fixture-a.png" };
    await render({ initialValue: "初始@图片1", assets: [asset] });
    const editor = currentEditor();
    for (const prompt of ["第二次@图片1描述", "第三次@图1描述"]) {
      await act(async () => {
        editor.view.dispatch(closeHistory(editor.state.tr).insertText(prompt, 1, editor.state.doc.content.size - 1));
      });
      expect(currentEditor()).toBe(editor);
      expect(editor.view.dom.querySelectorAll("[data-asset-mention]")).toHaveLength(1);
      expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toBe(prompt.replace("@图1", "@图片1"));
    }
    await act(async () => { editor.commands.undo(); });
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toBe("第二次@图片1描述");
    await act(async () => { editor.commands.redo(); });
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toBe("第三次@图片1描述");
  });

  it("converts short aliases on every paste including after replacing connected media", async () => {
    const asset = { id: "a", token: "图片1", kind: "image" as const, url: "/before.png", name: "原图" };
    await render({ initialValue: "", assets: [asset] });
    const editor = currentEditor();
    for (const current of [asset, { ...asset, url: "/after.png", name: "新图" }, { ...asset, id: "b", url: "/reconnected.png" }]) {
      await render({ assets: [current] });
      await act(async () => {
        editor.commands.selectAll();
        const paste = new Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(paste, "clipboardData", { value: { getData: (type: string) => type === "text/plain" ? "@图1作为人物参考" : "" } });
        editor.view.dom.dispatchEvent(paste);
      });
      expect(editor.view.dom.querySelectorAll("[data-asset-mention]")).toHaveLength(1);
      expect(editor.state.doc.nodeAt(1)?.attrs).toMatchObject({ assetId: current.id, url: current.url, name: current.name });
    }
  });

  it("recognizes pending references when assets connect and follows identity when reordered", async () => {
    const a = { id: "a", token: "图片1", kind: "image" as const, url: "/a.png" };
    const b = { id: "b", token: "图片2", kind: "image" as const, url: "/b.png" };
    await render({ initialValue: "@图1和@图片2描述", assets: [] });
    const editor = currentEditor();
    await render({ assets: [a, b] });
    expect(editor.view.dom.querySelectorAll("[data-asset-mention]")).toHaveLength(2);
    await render({ assets: [{ ...b, token: "图片1" }, { ...a, token: "图片2", url: "/a-new.png" }] });
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toBe("@图片2和@图片1描述");
    expect(editor.state.doc.nodeAt(1)?.attrs).toMatchObject({ assetId: "a", url: "/a-new.png" });
    await render({ assets: [{ ...b, token: "图片1" }] });
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toBe("和@图片1描述");
  });

  it("waits for the full reference number while typing, then converts on blur", async () => {
    const assets = [1, 10].map(number => ({ id: String(number), token: `图片${number}`, kind: "image" as const, url: `/uploads/fixture-${number}.png` }));
    await render({ initialValue: "", assets });
    const editor = currentEditor();
    await act(async () => { editor.view.focus(); editor.commands.insertContent("@图片1"); });
    expect(editor.view.dom.querySelector("[data-asset-mention]")).toBeNull();
    await act(async () => { editor.commands.insertContent("0"); editor.view.dom.blur(); });
    expect(editor.state.doc.nodeAt(1)?.attrs.assetId).toBe("10");
    expect(editor.view.dom.querySelectorAll("[data-asset-mention]")).toHaveLength(1);
  });

  it("displays loaded short references as tags and saves their canonical spelling when edited", async () => {
    const onValueChange = vi.fn();
    await act(async () => root.render(React.createElement(PromptRichEditor, {
      value: "@图1作为参考", assets: [{ id: "a", token: "图片1", kind: "image", url: "/uploads/fixture-a.png" }], onValueChange,
    })));
    const editor = currentEditor();
    expect(editor.view.dom.querySelectorAll("[data-asset-mention]")).toHaveLength(1);
    expect(onValueChange).not.toHaveBeenCalled();
    await act(async () => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, "。"); });
    expect(onValueChange).toHaveBeenCalledWith("@图片1作为参考。");
  });

  it("waits until Chinese composition ends before converting and preserves the caret", async () => {
    await render({ initialValue: "", assets: [{ id: "a", token: "图片1", kind: "image", url: "/uploads/fixture-a.png" }] });
    const editor = currentEditor();
    let composing = true;
    Object.defineProperty(editor.view, "composing", { configurable: true, get: () => composing });
    await act(async () => { editor.commands.insertContent("参考@图1的衣服"); });
    expect(editor.view.dom.querySelector("[data-asset-mention]")).toBeNull();
    composing = false;
    await act(async () => {
      editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    expect(editor.view.dom.querySelectorAll("[data-asset-mention]")).toHaveLength(1);
    expect(editorDocToPromptText(editor.getJSON() as PromptRichEditorDoc)).toBe("参考@图片1的衣服");
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
  });

  it("updates asset metadata without moving the selection or adding an undo step", async () => {
    const asset = { id: "a", token: "图片1", kind: "image" as const, url: "/uploads/fixture-a.png", name: "before" };
    await render({ initialValue: "开头@图片1中间文字结尾", assets: [asset] });
    const editor = currentEditor();
    act(() => { editor.commands.setTextSelection({ from: 5, to: 8 }); editor.view.focus(); });
    await render({ assets: [{ ...asset, name: "after" }] });
    expect(currentEditor() === editor).toBe(true);
    expect(editor.state.selection.from).toBe(5);
    expect(editor.state.selection.to).toBe(8);
    expect(editor.can().undo()).toBe(false);
    expect(editor.state.doc.nodeAt(3)?.attrs.name).toBe("after");
  });

  it.each([true, false])("restores the selected skill on undo and removes it on redo (catalog loaded: %s)", async (catalogLoaded) => {
    function SkillHarness() {
      const [value, setValue] = React.useState("abcdefghij");
      const [selected, setSelected] = React.useState<RoleSkillListItem | null>(skill);
      return React.createElement(React.Fragment, null,
        React.createElement(PromptRichEditor, { value, assets: [], onValueChange: setValue, roleSkills: catalogLoaded ? [skill] : [], selectedRoleSkill: selected, onRoleSkillSelect: setSelected, onRoleSkillRemove: () => setSelected(null) }),
        React.createElement("output", { "data-selected-skill": "" }, selected?.id || "none"));
    }
    await act(async () => root.render(React.createElement(SkillHarness)));
    const editor = currentEditor();
    await act(async () => { editor.view.dispatch(closeHistory(editor.state.tr).delete(1, 2)); });
    expect(host.querySelector("output")?.textContent).toBe("none");
    await act(async () => { editor.commands.undo(); });
    expect(host.querySelector("output")?.textContent).toBe(skill.id);
    expect(editor.getJSON().content?.[0].content?.[0].type).toBe("roleSkillMention");
    await act(async () => { editor.commands.redo(); });
    expect(host.querySelector("output")?.textContent).toBe("none");
    expect(editor.getText()).toBe("abcdefghij");
  });

  it("does not add a blank line when the DOM changes while typing @ in a Windows prompt", async () => {
    await render({ initialValue: "第一行\r\n第二行\r\n第三行" });
    const editor = currentEditor();
    const secondLine = Array.from(editor.view.dom.querySelector("p")!.childNodes)
      .find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.startsWith("第二行")) as Text;

    await act(async () => {
      // Native typing changes the text DOM before ProseMirror reparses that range.
      secondLine.insertData(1, "@");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const doc = editor.getJSON() as PromptRichEditorDoc;
    expect(editorDocToPromptText(doc)).toBe("第一行\n第@二行\n第三行");
    expect(doc.content[0].content?.filter((node) => node.type === "hardBreak")).toHaveLength(2);
  });

  it("does not cancel a padding mousedown or force the existing selection to the end", async () => {
    await render();
    const editor = currentEditor();
    act(() => { editor.commands.setTextSelection({ from: 2, to: 6 }); });
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => { host.querySelector(".prompt-rich-editor")!.dispatchEvent(event); });

    expect(event.defaultPrevented).toBe(false);
    expect(editor.state.selection.from).toBe(2);
    expect(editor.state.selection.to).toBe(6);
  });

  it("keeps the editor, focus, selection and undo history when the skill catalog loads", async () => {
    const onRoleSkillSelect = vi.fn();
    await render({ roleSkillsLoading: true, onRoleSkillSelect });
    const editor = currentEditor();
    act(() => {
      editor.commands.insertContentAt(4, "!");
      editor.commands.setTextSelection({ from: 2, to: 6 });
      editor.view.focus();
    });
    const dom = editor.view.dom;
    expect(editor.can().undo()).toBe(true);

    for (const catalog of [
      { roleSkillsLoading: false, roleSkills: [skill] },
      { roleSkillsLoading: true, roleSkills: [skill] },
      { roleSkillsLoading: false, roleSkills: [skill], roleSkillsError: "加载失败" },
    ]) {
      await render({ ...catalog, onRoleSkillSelect });
      expect(currentEditor() === editor).toBe(true);
      expect(document.activeElement).toBe(dom);
      expect(editor.state.selection.from).toBe(2);
      expect(editor.state.selection.to).toBe(6);
      expect(editor.can().undo()).toBe(true);
    }
    act(() => { editor.commands.undo(); });
    expect(editor.getText()).toBe("abcdefghij");
  });

  it("updates an open slash menu when loading completes without recreating the editor", async () => {
    const onRoleSkillSelect = vi.fn();
    await render({ initialValue: "", roleSkillsLoading: true, onRoleSkillSelect });
    const editor = currentEditor();
    await act(async () => {
      editor.view.focus();
      editor.commands.insertContent("/");
    });
    expect(document.querySelector("[data-role-skill-slash-menu]")?.textContent).toContain("正在加载技能");

    await render({ roleSkillsLoading: false, roleSkills: [skill], onRoleSkillSelect });

    expect(currentEditor() === editor).toBe(true);
    const option = document.querySelector<HTMLButtonElement>("[data-role-skill-slash-menu] [role=option]");
    expect(option?.textContent).toContain(skill.name);
    await act(async () => {
      option!.click();
    });
    expect(onRoleSkillSelect).toHaveBeenCalledWith(skill);
  });
});
