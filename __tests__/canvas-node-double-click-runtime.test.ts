import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasNodeData } from "@/lib/canvas/document";

const state = vi.hoisted(() => ({ zoom: 1 }));
vi.mock("@xyflow/react", async (original) => ({
  ...await original<any>(),
  Handle: () => null,
  useNodeId: () => "media",
  useConnection: () => false,
  useUpdateNodeInternals: () => () => {},
  useStore: (select: any) => select({ transform: [0, 0, state.zoom], nodeLookup: new Map(), edges: [] }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/canvas/use-canvas-models", () => ({ useCanvasModels: () => null }));
vi.mock("@/components/canvas/CanvasAudioPlayback", () => ({ useCanvasAudioPlayback: () => ({ snapshot: { active: false }, toggle: vi.fn(), seek: vi.fn() }) }));
import { CanvasNodeCard, CanvasNodeEditorContext } from "@/components/canvas/CanvasNodeCard";

const previewMedia = vi.fn(), previewOutput = vi.fn(), bubbled = vi.fn(), updateData = vi.fn();
const editor = {
  previewMedia, previewOutput, updateData,
  updateNodeSize: vi.fn(),
  isPanelVisible: () => false, isTaskPanelVisible: () => false,
  getMediaName: () => undefined, getTaskResultName: () => undefined,
  getTaskAssets: () => [],
} as unknown as NonNullable<React.ContextType<typeof CanvasNodeEditorContext>>;
const settings = { model: "", prompt: "", aspectRatio: "1:1", resolution: "2K", quality: "", count: 2 };
const imageTask = (): Extract<CanvasNodeData, { kind: "imageTask" }> => ({
  kind: "imageTask", task: { references: [], settings, batches: [
    { id: "old", createdAt: 1, settings, outputs: [{ id: "old-output", status: "success", url: "/old.png" }] },
    { id: "latest", createdAt: 2, settings, outputs: [
      { id: "first", status: "success", url: "/first.png" },
      { id: "second", status: "success", url: "/second.png" },
    ] },
  ] },
});
const dataFor = (kind: "image" | "video" | "videoTask" | "audio"): CanvasNodeData => kind === "image"
  ? { kind, url: "/image.png" }
  : kind === "audio" ? { kind, url: "/audio.wav", waveformPeaks: [0.2, 0.4], durationSeconds: 5 }
  : kind === "video" ? { kind, url: "/video.mp4", posterUrl: "/poster.png" }
    : { kind, model: "", prompt: "", mediaPaths: [], status: "success", outputUrl: "/video.mp4", variants: { poster: { url: "/poster.png" } } };
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  state.zoom = 1; vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    async decode() {}
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = async (data: CanvasNodeData, overrides = {}) => {
  await act(async () => root.render(React.createElement(ReactFlowProvider, null,
    React.createElement(CanvasNodeEditorContext.Provider, { value: editor },
      React.createElement("div", { onDoubleClick: bubbled }, React.createElement(CanvasNodeCard, {
        id: "media", type: data.kind, data, selected: false, dragging: false, width: 350, height: 350,
        isConnectable: true, zIndex: 0, draggable: true, selectable: true, deletable: true,
        positionAbsoluteX: 0, positionAbsoluteY: 0,
        ...overrides,
      })),
    ),
  )));
};
const doubleClick = (target: Element) => act(() => { target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 })); });

describe("canvas media double-click canvas focus", () => {
  it("focuses and edits a plain text node with one double-click", async () => {
    const data: CanvasNodeData = { kind: "prompt", text: "普通文本正文" };
    await render(data, { selected: true });
    expect(host.querySelector('.canvas-text-node-content')!.classList.contains("nowheel")).toBe(true);
    doubleClick(host.querySelector('.canvas-text-node-value')!);
    expect(bubbled).toHaveBeenCalledOnce();
    expect(host.querySelector('.canvas-text-node-content')!.classList.contains("nowheel")).toBe(false);
    expect(host.querySelector('textarea')!.value).toBe("普通文本正文");
  });
  it("focuses and edits LLM output with one double-click while preserving normal drag and scroll", async () => {
    const data: CanvasNodeData = { kind: "llm", prompt: "原始指令", output: "原始正文", status: "success" };
    await render(data, { selected: true });
    const scroll = host.querySelector('[data-canvas-text-output-scroll]')!;
    expect(scroll.classList.contains("nowheel")).toBe(true);
    expect(host.querySelector('[data-canvas-llm-result] > .canvas-text-result-resize')).not.toBeNull();
    expect(scroll.classList.contains("nodrag")).toBe(false);
    expect(scroll.classList.contains("nopan")).toBe(false);
    doubleClick(host.querySelector('[data-canvas-text-output-scroll] > div')!);
    expect(bubbled).toHaveBeenCalledOnce();
    const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="编辑文本节点内容"]')!;
    expect(input.value).toBe("原始正文");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "修改后的正文");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(updateData).toHaveBeenCalledOnce();
    expect(updateData.mock.calls[0][1](data)).toEqual({ ...data, output: "修改后的正文" });
    expect(host.querySelector('textarea[aria-label="编辑文本节点内容"]')).toBeNull();
  });
  it.each([["edited-old", 280, 240, true], ["edited-resized", 400, 300, false], ["ordinary", 280, 240, false]])("repairs only legacy edited default frames: %s", async (id, width, height, repairs) => {
    await render({ kind: "image", url: "/edited.png", origin: "generated",
      variants: { original: { url: "/edited.png", width: 1536, height: 2752 } } }, { id, width, height });
    expect(editor.updateNodeSize).toHaveBeenCalledTimes(repairs ? 1 : 0);
    if (repairs) {
      const size = vi.mocked(editor.updateNodeSize).mock.calls[0][1];
      expect(size.width / size.height).toBeCloseTo(1536 / 2752, 2);
    }
  });
  it.each(["image", "video", "videoTask", "audio"] as const)("delegates %s focus to the canvas", async kind => {
    await render(dataFor(kind));
    doubleClick(host.querySelector(kind === "audio" ? "[data-canvas-audio-seek-track]" : "img")!);
    expect(previewMedia).not.toHaveBeenCalled();
    expect(bubbled).toHaveBeenCalledOnce();
  });
  it("focuses the whole image node when double-clicking one of its results", async () => {
    await render(imageTask());
    doubleClick(host.querySelector('[alt="生成结果 2"]')!);
    expect(previewOutput).not.toHaveBeenCalled();
    expect(previewMedia).not.toHaveBeenCalled();
    expect(bubbled).toHaveBeenCalledOnce();
  });
  it.each(["image", "video", "videoTask", "imageTask"] as const)("delegates %s focus at low zoom", async kind => {
    state.zoom = .1;
    await render(kind === "imageTask" ? imageTask() : dataFor(kind));
    expect(Boolean(host.querySelector("[data-canvas-low-detail]"))).toBe(kind !== "imageTask");
    doubleClick(host.querySelector("img")!);
    expect(previewOutput).not.toHaveBeenCalled();
    expect(previewMedia).not.toHaveBeenCalled();
    expect(bubbled).toHaveBeenCalledOnce();
  });
  it.each(["video", "videoTask"] as const)("keeps %s playback controls independent", async kind => {
    await render(dataFor(kind));
    // Playback controls mount when the pointer reaches the player.
    await act(async () => { host.querySelector(".group\\/video")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })); });
    for (const control of host.querySelectorAll("[data-canvas-video-controls] button, [data-canvas-video-controls] input")) doubleClick(control);
    expect(host.querySelector("[data-canvas-video-controls] button")).not.toBeNull();
    expect(previewMedia).not.toHaveBeenCalled();
    expect(bubbled).not.toHaveBeenCalled();
  });
  it("does not open a preview for an empty video task", async () => {
    await render({ kind: "videoTask", model: "", prompt: "", mediaPaths: [], status: "idle" });
    doubleClick(host.querySelector("[data-canvas-task-result-media]")!);
    expect(previewMedia).not.toHaveBeenCalled();
    expect(previewOutput).not.toHaveBeenCalled();
    expect(bubbled).toHaveBeenCalledOnce();
  });
  it.each(["imageTask", "videoTask", "audioTask"] as const)("allows focusing a running %s without a result", async kind => {
    const data: CanvasNodeData = kind === "imageTask"
      ? { kind, task: { references: [], settings, batches: [{ id: "running", createdAt: 1, settings, outputs: [{ id: "pending", status: "running" }] }] } }
      : kind === "videoTask" ? { kind, model: "", prompt: "", mediaPaths: [], status: "running" }
        : { kind, model: "", prompt: "", voiceId: "", speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "", status: "running" };
    state.zoom = .1;
    await render(data);
    doubleClick(host.querySelector("[data-canvas-task-result-media]")!);
    expect(bubbled).toHaveBeenCalledOnce();
    expect(previewMedia).not.toHaveBeenCalled();
    expect(previewOutput).not.toHaveBeenCalled();
  });
});
