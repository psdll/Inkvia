import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { CanvasSpeechPromptEditor } from "@/components/canvas/CanvasSpeechPromptEditor";
import { CanvasSpeechParameters } from "@/components/canvas/CanvasSpeechParameters";
import { CanvasMiniMaxVoiceFilterDialog } from "@/components/canvas/CanvasMiniMaxVoiceFilterDialog";
import { speechDocToText } from "@/lib/canvas/speech-prompt";
import { EMPTY_CANVAS_VOICE_FILTERS, type CanvasMiniMaxVoice } from "@/lib/canvas/minimax-voice-library";
import { buildMiniMaxSpeechRequest, type MiniMaxSpeechSettings } from "@/lib/minimax-speech-models";

let host: HTMLDivElement;
let root: Root;
const getEditor = () => (host.querySelector(".tiptap") as HTMLElement & { editor: Editor }).editor;
const text = () => speechDocToText(getEditor().getJSON());
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === label)!;
const click = async (element: HTMLElement) => { await act(async () => { element.click(); }); };
const defaultSettings: MiniMaxSpeechSettings = { model: "speech-2.8-hd", text: "你好", voiceId: "female-shaonv", speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "" };

function Harness({ model = "speech-2.8-hd", initialValue = "你好世界", expanded = false }) {
  const [value, onValueChange] = React.useState(initialValue);
  return React.createElement(CanvasSpeechPromptEditor, { value, model, onValueChange, expanded, onSubmit: vi.fn() });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const rect = document.createElement("div").getBoundingClientRect();
  Range.prototype.getBoundingClientRect = () => rect;
  Range.prototype.getClientRects = () => [rect] as unknown as DOMRectList;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("speech editor real interactions", () => {
  it("focuses an expanded speech panel without requesting ancestor scrolling", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    await act(async () => root.render(React.createElement(Harness, { expanded: true })));
    const editor = getEditor();
    const scroll = vi.fn(() => true);
    editor.view.setProps({ handleScrollToSelection: scroll });
    await act(async () => { while (frames.length) frames.shift()!(0); });
    expect(editor.view.hasFocus()).toBe(true);
    expect(scroll).not.toHaveBeenCalled();
  });

  it("inserts at the caret and edits the inline pause instead of appending more text", async () => {
    await act(async () => root.render(React.createElement(Harness)));
    act(() => { getEditor().commands.setTextSelection(3); });
    await click(button("<#>停顿"));
    expect(text()).toBe("你好<#0.25#>世界");
    expect(document.querySelector('[aria-label="停顿时长"]')).not.toBeNull();
    await click(button("0.5s"));
    expect(text()).toBe("你好<#0.5#>世界");
    expect(document.querySelectorAll("[data-speech-token]")).toHaveLength(1);
    await click(host.querySelector<HTMLElement>("[data-speech-token]")!);
    await click(button("1.5s"));
    expect(text()).toBe("你好<#1.5#>世界");
  });

  it("replaces selected text with an interjection, preserving undo and redo", async () => {
    await act(async () => root.render(React.createElement(Harness)));
    act(() => { getEditor().commands.setTextSelection({ from: 3, to: 5 }); });
    await click(button("()语气词"));
    await click(button("笑声 (laughs)"));
    expect(text()).toBe("你好(laughs)");
    act(() => { getEditor().commands.undo(); });
    expect(text()).toBe("你好世界");
    act(() => { getEditor().commands.redo(); });
    expect(text()).toBe("你好(laughs)");
    expect(getEditor().getText({ blockSeparator: "\n" })).toBe("你好(laughs)");
  });

  it("pastes plain API markers as atoms and deletes them as one unit", async () => {
    await act(async () => root.render(React.createElement(Harness, { initialValue: "" })));
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => "你好<#0.25#>世界\n(laughs)" } });
    await act(async () => { getEditor().view.dom.dispatchEvent(paste); });
    expect(text()).toBe("你好<#0.25#>世界\n(laughs)");
    expect(host.querySelectorAll("[data-speech-token]")).toHaveLength(2);
    act(() => { getEditor().view.dispatch(closeHistory(getEditor().state.tr)); getEditor().commands.setNodeSelection(3); });
    await act(async () => { getEditor().view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", keyCode: 8, bubbles: true })); });
    expect(text()).toBe("你好世界\n(laughs)");
    act(() => { getEditor().commands.undo(); });
    expect(text()).toBe("你好<#0.25#>世界\n(laughs)");
  });

  it("hides unsupported controls and preserves plain draft text on model change", async () => {
    await act(async () => root.render(React.createElement(Harness, { initialValue: "你好<#1#>世界" })));
    await act(async () => root.render(React.createElement(Harness, { model: "other-model" })));
    expect(host.querySelectorAll("[data-speech-token]")).toHaveLength(0);
    expect(host.querySelector(".canvas-speech-actions")?.textContent).toBe("");
    expect(text()).toBe("你好<#1#>世界");
  });

  it("copies multiline selections without introducing extra blank lines", async () => {
    const original = "你好<#0.25#>世界\n第二行\n\n(laughs)";
    await act(async () => root.render(React.createElement(Harness, { initialValue: original })));
    const editor = getEditor();
    act(() => { editor.commands.selectAll(); });
    const copied = editor.view.someProp("clipboardTextSerializer", (serialize) => serialize(editor.state.selection.content(), editor.view));
    expect(copied).toBe(original);
  });

  it("supports a custom pause and deleting a keyboard-focused token", async () => {
    await act(async () => root.render(React.createElement(Harness, { initialValue: "你好<#0.25#>世界" })));
    await click(host.querySelector<HTMLElement>("[data-speech-token]")!);
    await click(button("自定义"));
    const input = document.querySelector<HTMLInputElement>('[aria-label="自定义停顿秒数"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2.35");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("确定"));
    expect(text()).toBe("你好<#2.35#>世界");
    await act(async () => { host.querySelector<HTMLElement>("[data-speech-token]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })); });
    expect(text()).toBe("你好世界");
  });

  it("keeps the editor and cursor when the generator is expanded", async () => {
    await act(async () => root.render(React.createElement(Harness)));
    const editor = getEditor();
    act(() => { editor.commands.setTextSelection(3); });
    await act(async () => root.render(React.createElement(Harness, { expanded: true })));
    expect(getEditor()).toBe(editor); expect(editor.state.selection.from).toBe(3);
  });

  it("blocks token insertion over the provider limit without truncating existing text", async () => {
    await act(async () => root.render(React.createElement(Harness, { initialValue: "文".repeat(9999) })));
    await click(button("<#>停顿"));
    expect(text()).toHaveLength(9999);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("9999");
  });
});

describe("audio parameter behavior", () => {
  it("updates speed, sends selected emotion and clears it back to automatic", async () => {
    let saved = defaultSettings;
    function ParametersHarness() {
      const [value, setValue] = React.useState(defaultSettings);
      saved = value;
      return React.createElement(CanvasSpeechParameters, { model: value.model, value, onChange: (patch) => setValue((current) => ({ ...current, ...patch })) });
    }
    await act(async () => root.render(React.createElement(ParametersHarness)));
    expect(button("whisper")).toBeUndefined(); expect(button("fluent")).toBeUndefined();
    const speed = host.querySelector<HTMLInputElement>('input[type="range"][aria-label="语速"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(speed, "1.25");
      speed.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("happy"));
    expect(buildMiniMaxSpeechRequest(saved).body.voice_setting).toMatchObject({ speed: 1.25, emotion: "happy" });
    await click(button("happy"));
    expect(buildMiniMaxSpeechRequest(saved).body.voice_setting).not.toHaveProperty("emotion");
  });

  it("labels the audio parameter sliders and keeps the sound effect and emotion groups accessible", async () => {
    await act(async () => root.render(React.createElement(CanvasSpeechParameters, { model: defaultSettings.model, value: defaultSettings, onChange: vi.fn() })));
    const parameters = host.querySelector('[role="group"][aria-label="音频参数"]');
    expect(parameters).not.toBeNull();
    expect([...parameters!.querySelectorAll('input[type="range"]')].map((input) => input.getAttribute("aria-label")))
      .toEqual(["语速", "声调", "音量", "音高", "强度", "音色调节"]);
    expect(parameters!.querySelector('[aria-label="语速数值"]')).not.toBeNull();
    expect(parameters!.querySelector('[role="group"][aria-label="音效"]')).not.toBeNull();
    expect(parameters!.querySelector('[role="group"][aria-label="情绪"]')).not.toBeNull();
    expect(host.textContent).not.toContain("更多调节");
    expect(host.querySelector('[aria-label="提高语速"]')).toBeNull();
  });

  it("resets speed, pitch and volume without changing voice effects or emotion", async () => {
    let saved: MiniMaxSpeechSettings = { ...defaultSettings, speed: 1.37, pitch: -4, volume: 2, modifyPitch: 30, emotion: "happy" };
    function ParametersHarness() {
      const [value, setValue] = React.useState(saved);
      saved = value;
      return React.createElement(CanvasSpeechParameters, { model: value.model, value, onChange: (patch) => setValue((current) => ({ ...current, ...patch })) });
    }
    await act(async () => root.render(React.createElement(ParametersHarness)));
    await click(button("一键重置"));
    expect(saved).toMatchObject({ speed: 1, pitch: 0, volume: 1, modifyPitch: 30, emotion: "happy" });
    expect(host.querySelector<HTMLInputElement>('[aria-label="语速数值"]')!.value).toBe("1");
  });

  it("commits decimal speed input and keeps sound-effect selection wired to the request", async () => {
    let saved = defaultSettings;
    function ParametersHarness() {
      const [value, setValue] = React.useState(defaultSettings);
      saved = value;
      return React.createElement(CanvasSpeechParameters, { model: value.model, value, onChange: (patch) => setValue((current) => ({ ...current, ...patch })) });
    }
    await act(async () => root.render(React.createElement(ParametersHarness)));
    const input = host.querySelector<HTMLInputElement>('[aria-label="语速数值"]')!;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "1.37");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(buildMiniMaxSpeechRequest(saved).body.voice_setting.speed).toBe(1.37);
    await click(button("电音"));
    expect(button("电音").getAttribute("aria-pressed")).toBe("true");
    expect(buildMiniMaxSpeechRequest(saved).body.voice_modify).toMatchObject({ sound_effects: "robotic" });
  });

  it("applies multiple language filters only on confirmation, Escape first closes the dropdown", async () => {
    const onApply = vi.fn(), onClose = vi.fn();
    await act(async () => root.render(React.createElement(CanvasMiniMaxVoiceFilterDialog, {
      open: true, onApply, onClose, applied: EMPTY_CANVAS_VOICE_FILTERS,
      voices: ["zh", "en"].map((language): CanvasMiniMaxVoice => ({ id: language, name: language, language, description: "", source: "system", gender: "unknown", age: "unknown" })),
    })));
    await click(document.querySelector<HTMLElement>('[aria-label="语言"]')!);
    await click(button("中文")); await click(button("英文"));
    expect(onApply).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[role="menuitemcheckbox"][aria-checked="true"]')).toHaveLength(2);
    await click(document.querySelector<HTMLElement>('[aria-label="性别"]')!);
    expect(document.querySelectorAll(".canvas-voice-filter-menu")).toHaveLength(1);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector(".canvas-voice-filter-menu")).toBeNull();
    await click(button("筛选"));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ language: ["zh", "en"] }));
  });

  it("allows intermediate negative and decimal number drafts before committing", async () => {
    let saved = defaultSettings;
    function ParametersHarness() {
      const [value, setValue] = React.useState(defaultSettings);
      saved = value;
      return React.createElement(CanvasSpeechParameters, { model: value.model, value, onChange: (patch) => setValue((current) => ({ ...current, ...patch })) });
    }
    await act(async () => root.render(React.createElement(ParametersHarness)));
    const input = document.querySelector<HTMLInputElement>('[aria-label="声调数值"]')!;
    const type = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await type("-"); expect(input.value).toBe("-"); expect(saved.pitch).toBe(0);
    await type("-7");
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(saved.pitch).toBe(-7);
    await type("-999");
    await act(async () => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(saved.pitch).toBe(-12); expect(input.value).toBe("-12");
  });
});
