import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ x: 0, y: 0, zoom: 1, nodes: new Map<string, any>() }));
const subscriptions = vi.hoisted(() => new Set<(state: any, previous: any) => void>());
const flowStore = vi.hoisted(() => ({
  getState: () => ({ width: 1000, height: 700, transform: [state.x, state.y, state.zoom], nodeLookup: state.nodes, nodes: [...state.nodes.values()] }),
  subscribe: (listener: (state: any, previous: any) => void) => { subscriptions.add(listener); return () => subscriptions.delete(listener); },
}));
vi.mock("@xyflow/react", async original => ({ ...await original<any>(), useStoreApi: () => flowStore, useNodeId: () => null, useConnection: () => false, useStore: (select: any) => select({ width: 1000, height: 700, transform: [state.x, state.y, state.zoom], nodeLookup: state.nodes }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/canvas/use-canvas-models", () => ({ useCanvasModels: () => null }));
import { CanvasMediaPrefetch } from "@/components/canvas/CanvasMediaPrefetch";
import { CanvasRuntimeProvider, CanvasRuntimeContext } from "@/components/canvas/canvas-runtime-context";
import { CanvasMediaImage } from "@/components/canvas/CanvasMediaImage";

let root: Root, host: HTMLDivElement, images: string[], runtime: React.ContextType<typeof CanvasRuntimeContext>;
const Capture = () => { runtime = React.useContext(CanvasRuntimeContext); return null; };
const node = (id: string, x: number, y: number, extra = {}) => ({ id, data: { kind: "image", url: `/uploads/${id}.jpg` }, internals: { positionAbsolute: { x, y } }, measured: { width: 100, height: 100 }, ...extra });
beforeEach(() => {
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  subscriptions.clear(); state.x = state.y = 0; state.zoom = 1; state.nodes = new Map(); images = [];
  vi.stubGlobal("Image", class { onload: any; onerror: any; async decode() {} set src(src: string) { images.push(src); void Promise.resolve().then(() => this.onload?.()); } });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {} } as any);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,frame");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const render = async (showImage = false, busy = false) => { await act(async () => root.render(React.createElement(CanvasRuntimeProvider, { interacting: busy, children: [React.createElement(Capture, { key: "capture" }), React.createElement(CanvasMediaPrefetch, { key: "prefetch" }), showImage ? React.createElement(CanvasMediaImage, { key: "image", src: "/uploads/near.jpg" }) : null] }))); };
function move(x: number) {
  const previous = flowStore.getState(); state.x = x;
  const next = flowStore.getState();
  act(() => subscriptions.forEach(listener => listener(next, previous)));
}

describe("canvas prepares neighboring media before it enters the viewport", () => {
  it("preloads near edges, excludes visible, hidden and far-away media", async () => {
    for (const n of [node("near", 1200, 20), node("visible", 100, 20), node("far", 3000, 20), node("hidden", 1200, 200, { hidden: true })]) state.nodes.set(n.id, n);
    await render();
    expect(images.some(url => url.includes("near.jpg"))).toBe(true);
    expect(images.some(url => /visible.jpg|far.jpg|hidden.jpg/.test(url))).toBe(false);
  });
  it("does not preload any offscreen media in the ten percent overview", async () => {
    state.zoom = .1;
    for (const n of [node("near", 12000, 20), node("far", 18000, 20)]) state.nodes.set(n.id, n);
    await render();
    expect(images).toHaveLength(0);
    expect(host.querySelector('[data-canvas-media-prefetch]')?.children).toHaveLength(0);
  });
  it("hands the prepared preview to a visible node without waiting on other requests", async () => {
    state.nodes.set("near", node("near", 1200, 20)); await render();
    runtime!.images.setLimit(0); state.x = -500;
    await render(true);
    expect(host.querySelector('img')?.getAttribute("src")).toContain("near.jpg");
  });
  it("does not mount an offscreen video decoder just to extract a preview", async () => {
    state.nodes.set("clip", node("clip", 1200, 20, { data: { kind: "videoTask", outputUrl: "/uploads/clip.mp4" } }));
    await render(); await act(async () => vi.advanceTimersByTime(0));
    expect(host.querySelector("video")).toBeNull();
    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  it("schedules one candidate query after 100 viewport updates and unsubscribes", async () => {
    state.nodes.set("near", node("near", 1200, 20)); await render();
    const values = vi.spyOn(state.nodes, "values");
    const previous = flowStore.getState(); values.mockClear();
    const next = { ...previous, transform: [100, 0, 1] };
    act(() => { for (let i = 0; i < 100; i++) subscriptions.forEach(listener => listener(next, previous)); });
    expect(values).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(180));
    // One getState array and one candidate enumeration, never one per event.
    expect(values).toHaveBeenCalledTimes(2);
    act(() => root.render(null)); expect(subscriptions.size).toBe(0);
  });
  it("continues bounded small-preview work during continuous panning", async () => {
    state.nodes.set("approaching", node("approaching", 2200, 20));
    await render(false, true);
    expect(images.some(url => url.includes("approaching.jpg"))).toBe(false);
    for (let i = 0; i < 6; i++) {
      move(-650 - i * 10);
      await act(async () => vi.advanceTimersByTime(40));
    }
    expect(images.some(url => url.includes("approaching.jpg"))).toBe(true);
    expect(images.filter(Boolean).every(url => url.includes("w=100"))).toBe(true);
    expect(subscriptions.size).toBe(1);
  });
  it("keeps an existing neighboring preview until it leaves the wider release boundary", async () => {
    state.nodes.set("near", node("near", 1200, 20)); await render();
    const image = host.querySelector("img"); expect(image).not.toBeNull();
    move(100); await act(async () => vi.advanceTimersByTime(180));
    expect(host.querySelector("img")).toBe(image);
    move(2000); await act(async () => vi.advanceTimersByTime(180));
    expect(host.querySelector("img")).toBeNull();
  });
  it("caps neighboring work at twenty-four previews and retains it on pan", async () => {
    for (let i = 0; i < 100; i++) state.nodes.set(String(i), node(String(i), 1100 + i, 20));
    await render();
    expect(host.querySelector('[data-canvas-media-prefetch]')?.children).toHaveLength(24);
    await render(false, true);
    expect(host.querySelector('[data-canvas-media-prefetch]')?.children).toHaveLength(24);
    expect(subscriptions.size).toBe(1);
  });
  it("releases previous neighboring previews when zooming out to overview", async () => {
    state.nodes.set("near", node("near", 1200, 20)); await render();
    expect(host.querySelector("img")).not.toBeNull();
    state.zoom = .1; await render();
    expect(host.querySelector('[data-canvas-media-prefetch]')?.children).toHaveLength(0);
  });

});
