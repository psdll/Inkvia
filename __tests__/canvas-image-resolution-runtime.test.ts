import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasNodeData } from "@/lib/canvas/document";
import { restoreCreativeAgentMediaSizes } from "@/lib/creative-agent/media-layout";

const state = vi.hoisted(() => ({ zoom: .4, subscribers: new Set<() => void>(), contentRender: vi.fn(), updateInternals: vi.fn() }));
vi.mock("@xyflow/react", async (original) => {
  const React = await import("react");
  return {
  ...await original<any>(), Handle: () => null, useNodeId: () => "image",
  useConnection: () => false, useUpdateNodeInternals: () => { state.contentRender(); return state.updateInternals; },
  useStore: (select: any) => React.useSyncExternalStore(
    callback => { state.subscribers.add(callback); return () => { state.subscribers.delete(callback); }; },
    () => select({ transform: [0, 0, state.zoom], nodeLookup: new Map() }),
  ),
}; });
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/canvas/use-canvas-models", () => ({ useCanvasModels: () => null }));
import { CanvasNodeCard, CanvasNodeEditorContext } from "@/components/canvas/CanvasNodeCard";

let host: HTMLDivElement, root: Root;
const fetchMetadata = vi.fn();
beforeEach(() => {
  state.zoom = .4; fetchMetadata.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMetadata);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    async decode() {}
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async (data: CanvasNodeData | null, overrides: Partial<Parameters<typeof CanvasNodeCard>[0]> = {}, editor: React.ContextType<typeof CanvasNodeEditorContext> = null) => {
  await act(async () => {
    state.subscribers.forEach(notify => notify());
    root.render(React.createElement(ReactFlowProvider, null, React.createElement(CanvasNodeEditorContext.Provider, { value: editor }, data && React.createElement(CanvasNodeCard, {
    id: "image", type: data.kind, data, selected: false, dragging: false, width: 350, height: 350,
    isConnectable: true, zIndex: 0, draggable: true, selectable: true, deletable: true,
    positionAbsoluteX: 0, positionAbsoluteY: 0,
    ...overrides,
  })))); });
};
const task = (url: string): CanvasNodeData => {
  const settings = { model: "", prompt: "", aspectRatio: "9:16", resolution: "2K", quality: "", count: 1 };
  return { kind: "imageTask", task: { references: [], settings, batches: [
    { id: url, createdAt: 1, settings, outputs: [{ id: url, status: "success", url }] },
  ] } };
};
const metadata = (width: number, height: number) => ({ ok: true, json: async () => ({ width, height }) });
const loadPreview = (width: number, height: number) => {
  const image = host.querySelector("img")!;
  Object.defineProperties(image, { naturalWidth: { configurable: true, value: width }, naturalHeight: { configurable: true, value: height } });
  act(() => { image.dispatchEvent(new Event("load")); });
};

describe("canvas source image resolution", () => {
  it.each([[1728, 2304, 350, 467], [2560, 1440, 622, 350]])("repairs Agent placeholders from %s x %s metadata while displaying only thumbnails", async (width, height, frameWidth, frameHeight) => {
    const data: CanvasNodeData = { kind: "image", origin: "generated", name: "Agent 图片 · 45809", mediaId: "ffffffff-ffff-4fff-8fff-ffffffffffff", url: `/uploads/agent-metadata-${width}.png` };
    let hydrated = data as CanvasNodeData;
    const updateData = vi.fn((_id: string, updater: (value: CanvasNodeData) => CanvasNodeData) => { hydrated = updater(hydrated); });
    const editor = { updateData, isPanelVisible: () => false, isTaskPanelVisible: () => false, getMediaName: () => undefined } as unknown as NonNullable<React.ContextType<typeof CanvasNodeEditorContext>>;
    fetchMetadata.mockResolvedValueOnce(metadata(width, height));
    await render(data, { width: 360, height: 360 }, editor);
    loadPreview(200, Math.round(height / width * 200));
    expect(updateData).toHaveBeenCalledWith("image", expect.any(Function), "replace");
    expect(hydrated).toMatchObject({ variants: { original: { width, height } } });
    const restored = restoreCreativeAgentMediaSizes({ ...createEmptyCanvasDocumentV2(), nodes: [{ id: "image", type: "image", position: { x: 0, y: 0 }, width: 360, height: 360, data: hydrated }] });
    expect(restored.nodes[0]).toMatchObject({ width: frameWidth, height: frameHeight });
    await render(hydrated, { width: frameWidth, height: frameHeight }, editor);
    const frame = host.querySelector<HTMLElement>('[data-canvas-connection-target-id="image"]');
    expect(frame?.style.width).toBe(`${frameWidth}px`);
    expect(frame?.style.height).toBe(`${frameHeight}px`);
  });

  it("reuses node content for 60 coordinate frames but refreshes size and business data", async () => {
    const data: CanvasNodeData = { kind: "image", url: "blob:drag-preview", name: "原名称" };
    await render(data, { dragging: true });
    state.contentRender.mockClear();
    const image = host.querySelector("img");
    for (let frame = 1; frame <= 60; frame++) {
      await render(data, { dragging: true, positionAbsoluteX: frame * 2, positionAbsoluteY: frame });
    }
    expect(state.contentRender).not.toHaveBeenCalled();
    expect(host.querySelector("img")).toBe(image);
    await render(data, { dragging: true, width: 500 });
    expect(state.contentRender).toHaveBeenCalled();
    state.contentRender.mockClear();
    await render({ ...data, name: "新名称" }, { dragging: false, width: 500 });
    expect(state.contentRender).toHaveBeenCalled();
    expect(host.textContent).toContain("新名称");
  });

  it("makes no React commits while overview zoom changes within the same label scale", async () => {
    state.zoom = .1;
    const onRender = vi.fn();
    const data: CanvasNodeData = { kind: "image", url: "blob:overview-preview", name: "缩略图" };
    await act(async () => root.render(React.createElement(ReactFlowProvider, null,
      React.createElement(React.Profiler, { id: "node", onRender }, React.createElement(CanvasNodeCard, {
        id: "image", type: "image", data, selected: false, dragging: false, width: 350, height: 350,
        isConnectable: true, zIndex: 0, draggable: true, selectable: true, deletable: true,
        positionAbsoluteX: 0, positionAbsoluteY: 0,
      })))));
    onRender.mockClear();
    for (const zoom of [.105, .11, .115, .12, .125, .13]) {
      await act(async () => { state.zoom = zoom; state.subscribers.forEach(notify => notify()); });
    }
    expect(onRender).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLElement>("[data-canvas-material-metadata]")?.style.transform).toBe("scale(2)");
    await act(async () => { state.zoom = .75; state.subscribers.forEach(notify => notify()); });
    expect(onRender).toHaveBeenCalled();
    expect(host.querySelector<HTMLElement>("[data-canvas-material-metadata]")?.style.transform).toBe(`scale(${1 / .75})`);
    // Zooming in keeps the heading at its 100% screen size instead of enlarging it.
    await act(async () => { state.zoom = 2; state.subscribers.forEach(notify => notify()); });
    expect(host.querySelector<HTMLElement>("[data-canvas-material-metadata]")?.style.transform).toBe("scale(0.5)");
  });
  it("skips source metadata in overview and loads it when full detail returns", async () => {
    const data: CanvasNodeData = { kind: "image", url: "/uploads/overview-resolution.png" };
    state.zoom = .1;
    await render(data);
    expect(host.querySelector("[data-canvas-low-detail]")).not.toBeNull();
    expect(fetchMetadata).not.toHaveBeenCalled();
    fetchMetadata.mockResolvedValueOnce(metadata(4000, 3000));
    state.zoom = .4;
    await render(data);
    expect(fetchMetadata).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("4000 × 3000");
  });
  it("keeps original dimensions while generated previews change tiers and remount", async () => {
    let finish!: (response: ReturnType<typeof metadata>) => void;
    fetchMetadata.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const data = task("/uploads/resolution-generated.png");
    await render(data); loadPreview(200, 358);
    expect(host.textContent).not.toContain("200 × 358");
    await act(async () => finish(metadata(1536, 2752)));
    expect(host.textContent).toContain("1536 × 2752");
    for (const zoom of [.8, 2, .4]) {
      state.zoom = zoom; await render(data); loadPreview(zoom === 2 ? 800 : 400, zoom === 2 ? 1433 : 717);
      expect(host.textContent).toContain("1536 × 2752");
    }
    await render(null); await render(data);
    expect(host.textContent).toContain("1536 × 2752");
    expect(fetchMetadata).toHaveBeenCalledTimes(1);
    expect(fetchMetadata.mock.calls[0][0]).toBe("/api/thumb?src=%2Fuploads%2Fresolution-generated.png&metadata=1");
  });
  it("uses saved originals for uploaded images without fetching another copy", async () => {
    await render({ kind: "image", url: "/uploads/known.png", variants: {
      original: { url: "/uploads/known.png", width: 3000, height: 2000 },
      thumbnail: { url: "/thumb.png", width: 200, height: 133 },
    } });
    loadPreview(200, 133);
    expect(host.textContent).toContain("3000 × 2000");
    expect(fetchMetadata).not.toHaveBeenCalled();
  });
  it("reads missing source dimensions instead of labeling an image with thumbnail dimensions", async () => {
    fetchMetadata.mockResolvedValueOnce(metadata(4000, 3000));
    await render({ kind: "image", url: "/uploads/missing-dimensions.png", variants: {
      thumbnail: { url: "/thumb.png", width: 200, height: 150 },
    } });
    loadPreview(200, 150);
    expect(host.textContent).toContain("4000 × 3000");
    expect(host.textContent).not.toContain("200 × 150");
  });
  it("discards late metadata for a replaced result", async () => {
    let finish!: (response: ReturnType<typeof metadata>) => void;
    fetchMetadata.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render(task("/uploads/old-result.png"));
    fetchMetadata.mockResolvedValueOnce(metadata(1024, 1024));
    await render(task("/uploads/new-result.png"));
    await act(async () => finish(metadata(1536, 2752)));
    expect(host.textContent).toContain("1024 × 1024");
    expect(host.textContent).not.toContain("1536 × 2752");
  });
  it("does not claim preview dimensions when source metadata fails", async () => {
    fetchMetadata.mockResolvedValueOnce({ ok: false });
    await render(task("/uploads/unavailable.png")); loadPreview(200, 358);
    expect(host.textContent).not.toContain("200 × 358");
  });
});
