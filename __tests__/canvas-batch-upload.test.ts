import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";
import { canvasInternalNode } from './helpers/canvas-runtime-harness';
import { buildCanvasTaskMediaInput, collectCanvasTaskAssets, hasPendingCanvasTaskUploads } from "@/lib/canvas/task-references";

const state = vi.hoisted(() => ({ props: null as any, imageEditor: null as any, editor: null as any, context: null as any, submit: vi.fn(), size: vi.fn(), upload: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: (loader: any) => (props: any) => {
  if (String(loader).includes("ImageEditorModal")) state.imageEditor = props;
  return null;
} }));
vi.mock("@/components/canvas/use-canvas-models", () => ({ useCanvasModels: () => null, resolveCanvasModelId: () => "test-model" }));
vi.mock("@/lib/client/inflight-json", () => ({ fetchJsonOnce: async () => ({ ok: true, json: { success: true, items: [] } }) }));
vi.mock("@/components/canvas/CanvasViewportChrome", () => ({ CanvasViewportChrome: () => null }));
vi.mock("@/components/canvas/CanvasAudioPlayback", () => ({ CanvasAudioPlaybackProvider: ({ children }: any) => children }));
vi.mock("@/components/canvas/CanvasMediaPrefetch", () => ({ CanvasMediaPrefetch: () => null }));
vi.mock("@/components/canvas/CanvasNodeCard", async () => {
  const React = await import("react"); state.context = React.createContext(null);
  return { CanvasNodeCard: () => null, CanvasNodeEditorContext: state.context };
});
vi.mock("@/components/canvas/run-node", () => ({
  CANVAS_GENERATION_FOREGROUND_WAIT_MS: 1000, shouldResumeCanvasGeneration: () => false,
  submitVideoGen: state.submit, submitImageGen: vi.fn(), waitForGenerationResult: async () => "/test-output.mp4",
}));
vi.mock("@xyflow/react", async original => {
  const actual = await original<typeof import("@xyflow/react")>(); const React = await import("react");
  const flow = {
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }), getZoom: () => 1, getNodesBounds: actual.getNodesBounds,
    setViewport: vi.fn(), fitView: vi.fn(),
    screenToFlowPosition: (point: any) => point, flowToScreenPosition: (point: any) => point,
    getNodes: () => state.props.nodes, getNode: (id: string) => state.props.nodes.find((node: any) => node.id === id),
    getInternalNode: (id: string) => canvasInternalNode(state.props?.nodes, id),
  };
  return { ...actual,
    useReactFlow: () => flow, useStore: (selector: any) => selector({ transform: [0, 0, 1] }),
    useStoreApi: () => ({ getState: () => ({ transform: [0, 0, 1] }), setState: vi.fn() }),
    ReactFlowProvider: ({ children }: any) => children,
    ReactFlow: (props: any) => { state.props = props; state.editor = React.useContext(state.context); return React.createElement("div", null, props.children); },
    Panel: ({ children }: any) => children, ViewportPortal: ({ children }: any) => children,
  };
});
vi.mock("@/lib/canvas/local-upload-size", async original => ({
  ...await original<typeof import("@/lib/canvas/local-upload-size")>(), getCanvasLocalUploadNodeSize: state.size,
}));
vi.mock("@/lib/canvas/media-upload-client", () => ({ uploadCanvasMedia: state.upload }));
import SmartCanvasBoard from "@/components/canvas/SmartCanvasBoard";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  state.size.mockReset().mockImplementation(() => new Promise(() => {}));
  state.upload.mockReset().mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn((file: File) => `blob:${file.name}`);
    static revokeObjectURL = vi.fn();
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function mount(onChange = vi.fn(), onUndoMediaRefsChange = vi.fn(), initial = createEmptyCanvasDocumentV2()) {
  await act(async () => root.render(React.createElement(SmartCanvasBoard, {
    canvasId: 57, editorSessionId: "test-session", preferenceOwnerId: "guest", onChange, onUndoMediaRefsChange,
    onBeforeServerRun: async () => "1", initial,
  })));
}
const files = (count: number) => Array.from({ length: count }, (_, i) => new File(["test"], `${i}.png`, { type: "image/png" }));
async function pick(selected: File[]) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: selected });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
async function drop(selected: File[]) {
  const event = new Event("drop", { bubbles: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: selected, getData: () => "" } });
  Object.defineProperty(event, "clientX", { value: 100 });
  Object.defineProperty(event, "clientY", { value: 200 });
  await act(async () => host.querySelector('input[type="file"]')!.parentElement!.dispatchEvent(event));
}
async function paste(selected: File[]) {
  const event = new Event("paste", { bubbles: true });
  Object.defineProperty(event, "clipboardData", { value: { items: selected.map(file => ({ kind: "file", type: file.type, getAsFile: () => file })) } });
  await act(async () => host.querySelector('input[type="file"]')!.parentElement!.dispatchEvent(event));
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe("canvas batch uploads", () => {
  it("accepts .md files and imports their full Markdown as editable persisted text nodes", async () => {
    const change = vi.fn(); await mount(change);
    expect(host.querySelector<HTMLInputElement>('input[type="file"]')!.accept).toContain(".md");
    const content = "# 故事大纲\n\n第一幕：中文内容。\n\n- 保留 **Markdown**\n";
    const file = new File([content], "故事大纲.md", { type: "text/markdown" });
    Object.defineProperty(file, "text", { value: vi.fn().mockResolvedValue(content) });
    await pick([file]);
    expect(state.props.nodes).toHaveLength(1);
    expect(state.props.nodes[0]).toMatchObject({ type: "prompt", data: { kind: "prompt", title: "故事大纲.md", text: content, format: "markdown" } });
    expect(state.upload).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(300));
    expect(change.mock.calls.at(-1)?.[0].nodes[0].data.text).toBe(content);
  });
  it("rejects an oversized Markdown document before adding an unsavable node", async () => {
    await mount();
    const content = "中".repeat(100000);
    const file = new File([content], "超大.md");
    Object.defineProperty(file, "text", { value: vi.fn().mockResolvedValue(content) });
    await pick([file]);
    expect(state.props.nodes).toHaveLength(0);
    expect(host.textContent).toContain("超大.md");
    expect(host.textContent).toContain("256 KB");
  });
  it("recognizes uppercase .MD with no MIME when dropped alongside images", async () => {
    await mount();
    const file = new File(["正文"], "草稿.MD", { type: "" });
    Object.defineProperty(file, "text", { value: vi.fn().mockResolvedValue("正文") });
    await drop([file, ...files(1)]);
    expect(state.props.nodes.map((node: any) => node.data.kind).sort()).toEqual(["image", "prompt"]);
    expect(state.upload).toHaveBeenCalledTimes(1);
    expect(state.upload.mock.calls[0][0].name).toBe("0.png");
  });
  it("reports Markdown read errors and still imports other selected documents", async () => {
    await mount();
    const bad = new File([""], "bad.md"), good = new File([""], "empty.md");
    Object.defineProperty(bad, "text", { value: vi.fn().mockRejectedValue(new Error("无法读取")) });
    Object.defineProperty(good, "text", { value: vi.fn().mockResolvedValue("") });
    await pick([bad, good]);
    expect(state.props.nodes).toHaveLength(1);
    expect(state.props.nodes[0].data).toMatchObject({ title: "empty.md", text: "" });
    expect(host.textContent).toContain("bad.md"); expect(state.upload).not.toHaveBeenCalled();
  });

  it("uploads replacements onto the existing node and rejects other media kinds", async () => {
    const initial = createEmptyCanvasDocumentV2();
    initial.nodes = [{ id: "source", type: "image", position: { x: 70, y: 90 }, data: { kind: "image", url: "/old.png", prompt: "keep" } }];
    initial.edges = [{ id: "edge", source: "source", target: "downstream" }];
    await mount(vi.fn(), vi.fn(), initial);
    await expect(state.editor.replaceMediaFile("source", new File(["video"], "wrong.mp4", { type: "video/mp4" }))).rejects.toThrow("相同类型");
    expect(state.upload).not.toHaveBeenCalled();
    state.upload.mockResolvedValue({ kind: "image", url: "/new.png", mediaId: "new", variants: { original: { url: "/new.png", width: 1600, height: 900 } } });
    await act(async () => state.editor.replaceMediaFile("source", new File(["image"], "new.png", { type: "image/png" })));
    expect(state.props.nodes).toHaveLength(1);
    expect(state.props.nodes[0]).toMatchObject({ id: "source", position: { x: 70, y: 90 }, data: { url: "/new.png", prompt: "keep", mediaId: "new" } });
  });
  it.each(["brush", "mask", "grid"])("preserves every %s output's own dimensions and media identity", async mode => {
    const initial = createEmptyCanvasDocumentV2();
    initial.nodes = [{ id: "source", type: "image", position: { x: 0, y: 0 }, width: 350, height: 627,
      data: { kind: "image", url: "/source.png" } }];
    await mount(vi.fn(), vi.fn(), initial);
    await act(async () => state.editor.openImageEditor("source", mode));
    const media = [{ width: 1536, height: 2752 }, { width: 1800, height: 900 }].map((size, i) => ({
      url: `/edit-${i}.png`, mediaId: `edit-${i}`, variants: { original: { ...size, url: `/edit-${i}.png` } },
    }));
    await act(async () => state.imageEditor.onResult(media.map(m => m.url), mode, undefined, undefined, media));
    for (const item of media) {
      const node = state.props.nodes.find((n: any) => n.data.url === item.url);
      expect(node.data.mediaId).toBe(item.mediaId);
      expect(node.data.variants).toEqual(item.variants);
      expect(node.width / node.height).toBeCloseTo(item.variants.original.width / item.variants.original.height, 2);
    }
  });
  it("places clicked library materials outside existing nodes and dismisses the notice", async () => {
    const initial = createEmptyCanvasDocumentV2();
    initial.nodes = [{ id: "existing", type: "image", position: { x: 0, y: 0 }, width: 800, height: 600,
      data: { kind: "image", url: "/existing.png" } }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, media: {
      kind: "image", url: "/imported.png", mediaId: "imported", name: "素材",
      variants: { original: { width: 1000, height: 1000 } },
    } }), { status: 200 })));
    await mount(vi.fn(), vi.fn(), initial);
    await act(async () => { window.dispatchEvent(new CustomEvent("canvas-personal-material-use", { detail: { id: "material" } })); });
    const added = state.props.nodes.find((node: any) => node.id !== "existing");
    expect(added).toBeDefined();
    expect(added.position.x >= 950 || added.position.y >= 750).toBe(true);
    expect(host.textContent).toContain("素材已添加到当前画布");
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(host.textContent).not.toContain("素材已添加到当前画布");
  });
  describe.each(["imageTask", "videoTask"] as const)("new references in %s", (kind) => {
    function taskDocument(): CanvasDocumentV2 {
      return { ...createEmptyCanvasDocumentV2(), nodes: [{ id: "task", type: kind, position: { x: 0, y: 0 },
        data: kind === "videoTask"
          ? { kind, model: "test-model", prompt: "@图片1 靠近 @图片2", mediaPaths: ["/a.png", "/b.png"], status: "idle" }
          : { kind, task: { references: [{ id: "a", url: "/a.png", name: "a" }, { id: "b", url: "/b.png", name: "b" }], batches: [],
            settings: { model: "test-model", prompt: "@图片1 靠近 @图片2", aspectRatio: "1:1", resolution: "2K", count: 1, quality: "" } } },
      }] };
    }
    async function dropOnReference(data: Record<string, string>, selected: File[] = [], x = 5) {
      const strip = document.createElement("div");
      strip.dataset.canvasReferenceTaskId = "task";
      const card = document.createElement("div");
      card.dataset.canvasReferenceId = kind === "videoTask" ? "configured:/a.png" : "a";
      card.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 48, bottom: 48, width: 48, height: 48, toJSON() {} });
      strip.append(card);
      host.querySelector('input[type="file"]')!.parentElement!.append(strip);
      const event = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: 20 });
      Object.defineProperty(event, "dataTransfer", { value: { files: selected, getData: (type: string) => data[type] || "" } });
      await act(async () => { card.dispatchEvent(event); });
      strip.remove();
    }
    const promptOf = (doc: CanvasDocumentV2) => {
      const data = doc.nodes.find((node) => node.id === "task")!.data;
      return data.kind === "imageTask" ? data.task.settings.prompt : data.kind === "videoTask" ? data.prompt : "";
    };
    async function saved(change: ReturnType<typeof vi.fn>): Promise<CanvasDocumentV2> {
      await act(async () => vi.advanceTimersByTime(300));
      return change.mock.lastCall![0];
    }

    it.each([5, 45])("persists selected library materials at x=%s and preserves prompt bindings", async (x) => {
      const change = vi.fn();
      await mount(change, vi.fn(), taskDocument());
      await dropOnReference({ "application/x-media-library-items": JSON.stringify([
        { id: 1, url: "/new1.png", kind: "image" }, { id: 2, url: "/new2.png", kind: "image" },
      ]) }, [], x);
      const doc = await saved(change);
      const expected = x === 5 ? ["/new1.png", "/new2.png", "/a.png", "/b.png"] : ["/a.png", "/new1.png", "/new2.png", "/b.png"];
      expect(collectCanvasTaskAssets(doc, "task").map((asset) => asset.url)).toEqual(expected);
      expect(promptOf(doc)).toBe(x === 5 ? "@图片3 靠近 @图片4" : "@图片1 靠近 @图片4");
      expect(buildCanvasTaskMediaInput(doc, "task", promptOf(doc)).imagePaths).toEqual(expected);
      expect(doc.edges).toHaveLength(2);
    });

    it("keeps file selection order when uploads finish out of order", async () => {
      state.size.mockResolvedValue({ width: 622, height: 350 });
      const first = deferred<any>();
      const second = deferred<any>();
      state.upload.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
      const change = vi.fn();
      await mount(change, vi.fn(), taskDocument());
      await dropOnReference({}, files(2));
      expect(state.editor.getTaskAssets("task").map((asset: any) => asset.url)).toEqual(["blob:0.png", "blob:1.png", "/a.png", "/b.png"]);
      await act(async () => second.resolve({ success: true, url: "/second.png", mediaId: "second" }));
      await act(async () => first.resolve({ success: true, url: "/first.png", mediaId: "first" }));
      const doc = await saved(change);
      expect(hasPendingCanvasTaskUploads(doc, "task")).toBe(false);
      expect(buildCanvasTaskMediaInput(doc, "task", promptOf(doc)).imagePaths).toEqual(["/first.png", "/second.png", "/a.png", "/b.png"]);
      expect(promptOf(doc)).toBe("@图片3 靠近 @图片4");
    });

    it("restores original reference numbering if an inserted upload fails", async () => {
      const upload = deferred<any>();
      state.upload.mockImplementationOnce(() => upload.promise);
      const change = vi.fn();
      await mount(change, vi.fn(), taskDocument());
      await dropOnReference({}, files(1));
      await act(async () => upload.resolve({ success: false, error: "upload failed" }));
      const doc = await saved(change);
      expect(collectCanvasTaskAssets(doc, "task").map((asset) => asset.url)).toEqual(["/a.png", "/b.png"]);
      expect(promptOf(doc)).toBe("@图片1 靠近 @图片2");
    });
  });
  it.each(['success', 'failure'])("does not publish a late %s upload after the editing session unmounts", async outcome => {
    const upload = deferred<any>();
    state.upload.mockImplementationOnce(() => upload.promise);
    state.size.mockResolvedValue({ width: 622, height: 350 });
    const holds = vi.fn();
    await mount(vi.fn(), holds); await pick(files(1));
    await act(async () => root.render(null));
    holds.mockClear();
    const revoked = vi.mocked(URL.revokeObjectURL).mock.calls.length;
    await act(async () => upload.resolve(outcome === 'success'
      ? { success: true, url: '/uploads/late.png', mediaId: 'late' }
      : { success: false, error: 'late failure' }));
    await act(async () => vi.advanceTimersByTime(2000));
    expect(holds).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(revoked);
  });
  it.each([19, 20])("creates %i local previews without waiting for metadata or the server", async count => {
    await mount(); await pick(files(count));
    expect(state.props.nodes).toHaveLength(count);
    expect(state.props.nodes.every((node: any) => node.data.url.startsWith("blob:"))).toBe(true);
    expect(state.upload).toHaveBeenCalled();
  });
  it.each([pick, drop, paste])("places uploads in free space before and after metadata hydration", async enter => {
    const metadata = deferred<{ width: number; height: number }>();
    state.size.mockImplementation(() => metadata.promise);
    const existing = { id: "existing", type: "image" as const, position: { x: 0, y: 0 }, width: 900, height: 900,
      data: { kind: "image" as const, url: "/existing.png" } };
    await mount(vi.fn(), vi.fn(), { ...createEmptyCanvasDocumentV2(), nodes: [existing] });
    await enter(files(2));
    const check = () => {
      const nodes = state.props.nodes;
      expect(nodes.find((node: any) => node.id === "existing").position).toEqual(existing.position);
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        expect(a.position.x + a.width <= b.position.x || b.position.x + b.width <= a.position.x
          || a.position.y + a.height <= b.position.y || b.position.y + b.height <= a.position.y).toBe(true);
      }
    };
    check();
    await act(async () => metadata.resolve({ width: 1800, height: 350 }));
    check();
    await enter(files(1));
    check();
  });

  it.each([pick, drop, paste])("uploads only the first 20 images and briefly warns about the excess", async enter => {
    await mount(); await enter(files(21));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("已接收前 20 张，超出的 1 张未上传");
    expect(state.props.nodes).toHaveLength(20);
    expect(state.size).toHaveBeenCalledTimes(20);
    expect(state.upload).toHaveBeenCalledTimes(20);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(20);
    expect(state.props.nodes.some((node: any) => node.data.name === "20.png")).toBe(false);
    await act(async () => vi.advanceTimersByTime(3500));
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it("accepts another batch and resets the expiry of a repeated over-limit notice", async () => {
    await mount(); await pick(files(21));
    await act(async () => vi.advanceTimersByTime(3000));
    await pick(files(22));
    expect(state.props.nodes).toHaveLength(40);
    await act(async () => vi.advanceTimersByTime(500));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("超出的 2 张未上传");
    await act(async () => vi.advanceTimersByTime(3000));
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it("updates an available image's aspect ratio without waiting for a stalled image", async () => {
    const first = deferred<{ width: number; height: number }>();
    state.size.mockImplementationOnce(() => first.promise);
    await mount(); await pick(files(2));
    expect(state.props.nodes).toHaveLength(2);
    await act(async () => first.resolve({ width: 622, height: 350 }));
    expect(state.props.nodes[0]).toMatchObject({ width: 622, height: 350 });
    expect(state.props.nodes[1].position.x - state.props.nodes[0].position.x).toBe(772);
  });
  it("preserves edits and later batches when an earlier file finishes reading", async () => {
    const first = deferred<{ width: number; height: number }>();
    state.size.mockImplementationOnce(() => first.promise);
    await mount(); await pick(files(1));
    const original = state.props.nodes[0];
    await act(async () => state.editor.updateData(original.id, (data: any) => ({ ...data, name: "renamed" })));
    await pick([new File(["later"], "later.png", { type: "image/png" })]);
    await act(async () => first.resolve({ width: 622, height: 350 }));
    expect(state.props.nodes).toHaveLength(2);
    expect(state.props.nodes.find((node: any) => node.id === original.id).data.name).toBe("renamed");
  });
  it("does not restore nodes deleted while the metadata was being read", async () => {
    const first = deferred<{ width: number; height: number }>();
    state.size.mockImplementationOnce(() => first.promise);
    await mount(); await pick(files(1));
    const id = state.props.nodes[0].id;
    await act(async () => state.props.onNodesChange([{ type: "select", id, selected: true }]));
    const board = host.querySelector('input[type="file"]')!.parentElement!;
    await act(async () => board.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })));
    await act(async () => first.resolve({ width: 622, height: 350 }));
    expect(state.props.nodes).toHaveLength(0);
  });  it("preserves a manually moved node when later dimensions arrive", async () => {
    const first = deferred<{ width: number; height: number }>();
    state.size.mockImplementationOnce(() => first.promise);
    await mount(); await pick(files(2));
    const id = state.props.nodes[1].id;
    await act(async () => state.props.onNodesChange([{ type: "position", id, position: { x: 700, y: 900 }, dragging: true }]));
    await act(async () => first.resolve({ width: 622, height: 350 }));
    expect(state.props.nodes.find((node: any) => node.id === id).position).toEqual({ x: 700, y: 900 });
  });
  it("settles each upload independently, saves no blob URLs, and keeps one undo for the batch", async () => {
    state.size.mockResolvedValue({ width: 622, height: 350 });
    const first = deferred<any>(), second = deferred<any>();
    state.upload.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const onChange = vi.fn();
    await mount(onChange); await pick(files(2));
    await act(async () => first.resolve({ success: true, url: "/uploads/first.png", mediaId: "first" }));
    expect(state.props.nodes[0].data.url).toBe("/uploads/first.png");
    expect(state.props.nodes[1].data.url).toMatch(/^blob:/);
    await act(async () => vi.advanceTimersByTime(500));
    const saved = onChange.mock.calls.at(-1)![0] as CanvasDocumentV2;
    expect(saved.nodes).toHaveLength(1);
    expect(JSON.stringify(saved)).not.toContain("blob:");
    await act(async () => second.resolve({ success: true, url: "/uploads/second.png", mediaId: "second" }));
    await act(async () => host.querySelector('input[type="file"]')!.parentElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })));
    expect(state.props.nodes).toHaveLength(0);
  });

});
