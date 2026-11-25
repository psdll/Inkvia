import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasLru, CanvasMountQueue, CanvasWorkQueue } from "@/lib/canvas/render-runtime";

const flowState = vi.hoisted(() => ({ transform: [0, 0, .5], nodeLookup: new Map<string, any>() }));
vi.mock("@xyflow/react", () => ({ useNodeId: () => "image", useStore: (select: any) => select(flowState) }));
import { CanvasMediaImage } from "@/components/canvas/CanvasMediaImage";
import { CanvasRuntimeContext, CanvasRuntimeProvider, CanvasInteractingContext, useCanvasInteracting } from "@/components/canvas/canvas-runtime-context";

let host: HTMLDivElement, root: Root, images: HTMLImageElement[], runtime: React.ContextType<typeof CanvasRuntimeContext>;
beforeEach(() => {
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  images = [];
  flowState.transform = [0, 0, .5]; flowState.nodeLookup.clear();
  vi.stubGlobal("Image", class { onload: any; onerror: any; src = ""; decode = async () => {}; constructor() { images.push(this as any); } });
  runtime = { images: new CanvasWorkQueue(1), referenceImages: new CanvasWorkQueue(4), decoded: new CanvasLru<HTMLImageElement>(100), previews: new CanvasLru(1000) } as any;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const render = async (visible: boolean) => { await act(async () => root.render(React.createElement(CanvasRuntimeContext.Provider, { value: runtime }, visible ? React.createElement(CanvasMediaImage, { src: "/uploads/seen.jpg" }) : null))); };
const loaded = async (index: number) => { await act(async () => images[index].onload?.(new Event("load"))); };

describe("canvas panning preserves previously seen previews", () => {
  it("notifies active interaction consumers without rendering dormant edge controls", async () => {
    let dormantRenders = 0;
    const Probe = React.memo(({ enabled }: { enabled: boolean }) => {
      const busy = useCanvasInteracting(enabled);
      if (!enabled) dormantRenders += 1;
      return React.createElement("span", { "data-enabled": String(enabled) }, String(busy));
    });
    const children = [React.createElement(Probe, { key: "idle", enabled: false }), React.createElement(Probe, { key: "active", enabled: true })];
    const show = async (interacting: boolean) => act(async () => root.render(React.createElement(CanvasRuntimeProvider, { interacting, children })));
    await show(false);
    const initialRenders = dormantRenders;
    await show(true);
    expect(host.querySelector('[data-enabled="true"]')?.textContent).toBe("true");
    expect(dormantRenders).toBe(initialRenders);
    await show(false);
    expect(host.querySelector('[data-enabled="true"]')?.textContent).toBe("true");
    await act(async () => vi.advanceTimersByTime(180));
    expect(host.querySelector('[data-enabled="true"]')?.textContent).toBe("false");
    expect(dormantRenders).toBe(initialRenders);
  });
  it("reads the current pan state when dormant controls become active", async () => {
    const Probe = ({ enabled }: { enabled: boolean }) => React.createElement("span", null, String(useCanvasInteracting(enabled)));
    const show = async (enabled: boolean) => act(async () => root.render(React.createElement(CanvasRuntimeProvider, {
      interacting: true, children: React.createElement(Probe, { enabled }),
    })));
    await show(false);
    expect(host.textContent).toBe("false");
    await show(true);
    expect(host.textContent).toBe("true");
  });
  it("does not download an offscreen original when thumbnail prefetch fails", async () => {
    const show = async (prefetch: boolean) => act(async () => root.render(
      React.createElement(CanvasRuntimeContext.Provider, { value: runtime },
        React.createElement(CanvasMediaImage, { src: "/uploads/large-original.jpg", prefetch }))));
    await show(true);
    expect(images).toHaveLength(1);
    await act(async () => images[0].onerror?.(new Event("error")));
    expect(images).toHaveLength(1);
    // Becoming visible may still use the original if its thumbnail is unavailable.
    await show(false);
    await act(async () => images[1].onerror?.(new Event("error")));
    expect(images[2].src).toContain("large-original.jpg");
    expect(images[2].src).not.toContain("/api/thumb");
  });
  it("keeps a decoded same-source preview when every higher-resolution candidate fails", async () => {
    await render(true); await loaded(0);
    const preview = host.querySelector("img")?.getAttribute("src");
    flowState.transform[2] = 4;
    await render(true);
    await act(async () => images[1].onerror?.(new Event("error")));
    await act(async () => images[2].onerror?.(new Event("error")));
    expect(host.querySelector("img")?.getAttribute("src")).toBe(preview);
    expect(host.querySelector('[data-canvas-image-failed]')).toBeNull();
  });
  it("does not preserve another source's image if replacement loading fails", async () => {
    await render(true); await loaded(0);
    await act(async () => root.render(React.createElement(CanvasRuntimeContext.Provider, { value: runtime },
      React.createElement(CanvasMediaImage, { src: "/uploads/other.jpg" }))));
    await act(async () => images[1].onerror?.(new Event("error")));
    await act(async () => images[2].onerror?.(new Event("error")));
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector('[data-canvas-image-failed]')).not.toBeNull();
  });
  it("shows a local upload immediately even when remote image loading is blocked", async () => {
    runtime!.images.add("blocked-remote", () => new Promise(() => {}));
    await act(async () => root.render(React.createElement(CanvasRuntimeContext.Provider, { value: runtime },
      React.createElement(CanvasMediaImage, { src: "blob:new-upload" }))));
    expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:new-upload");
    expect(images).toHaveLength(0);
  });
  it("keeps the local preview while switching to the uploaded server URL", async () => {
    const show = async (src: string) => act(async () => root.render(React.createElement(CanvasRuntimeContext.Provider, { value: runtime },
      React.createElement(CanvasMediaImage, { src }))));
    await show("blob:new-upload");
    await show("/uploads/new-upload.png");
    expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:new-upload");
    await loaded(0);
    expect(host.querySelector("img")?.getAttribute("src")).toContain("new-upload.png");
  });
  it("bounds visible image work to four slots during and after panning", async () => {
    const children = Array.from({ length: 4 }, (_, i) => React.createElement(CanvasMediaImage, { key: i, src: `/uploads/next-${i}.jpg` }));
    await act(async () => root.render(React.createElement(CanvasRuntimeProvider, { interacting: true, children })));
    expect(images).toHaveLength(4);
    await act(async () => root.render(React.createElement(CanvasRuntimeProvider, { interacting: false, children })));
    await act(async () => vi.advanceTimersByTime(180));
    // The small in-flight previews are cancelled before four final-tier loads start.
    expect(images.filter(image => image.src)).toHaveLength(4);
    expect(images.slice(0, 4).every(image => image.src === "")).toBe(true);
  });
  it("shows a decoded image immediately on return even with a blocked loading queue", async () => {
    await render(true); await loaded(0); await render(false);
    runtime!.images.add("slow-unrelated", () => new Promise(() => {}));
    await render(true);
    expect(host.querySelector("img")?.getAttribute("src")).toContain("seen.jpg");
    expect(images).toHaveLength(1);
  });
  it("cancels an offscreen load and prepares it again when the node returns", async () => {
    await render(true);
    const url = images[0].src;
    await render(false);
    expect(images[0].src).toBe("");
    expect(images[0].onload).toBeNull();
    await loaded(0);
    expect(runtime!.decoded.get(url)).toBeUndefined();
    await render(true);
    expect(host.querySelector("[data-canvas-image-loading]")).not.toBeNull();
    expect(images).toHaveLength(2);
    await loaded(1);
    expect(host.querySelector("img")?.getAttribute("src")).toContain("seen.jpg");
  });

  it("keeps large decoded images out of the offscreen pool and preserves small previews", async () => {
    await render(true); await loaded(0);
    const preview = images[0].src;
    flowState.transform[2] = 4;
    await render(true); await loaded(1);
    const full = images[1].src;
    expect(host.querySelector("img")?.getAttribute("src")).toBe(full);
    expect(runtime!.decoded.get(full)).toBeUndefined();
    expect(runtime!.previews.get("/uploads/seen.jpg")?.url).toBe(preview);
    await render(false);
    await render(true);
    expect(host.querySelector("img")?.getAttribute("src")).toBe(preview);
    await loaded(2);
    expect(host.querySelector("img")?.getAttribute("src")).toBe(full);
  });

  it("frees a queue slot even if an offscreen image is still decoding", async () => {
    let finish!: () => void;
    await render(true);
    const url = images[0].src;
    images[0].decode = () => new Promise<void>(resolve => { finish = resolve; });
    await loaded(0);
    await render(false);
    await render(true);
    expect(images).toHaveLength(2);
    expect(images[0].src).toBe("");
    await act(async () => finish());
    expect(runtime!.decoded.get(url)).toBeUndefined();
    await loaded(1);
    expect(host.querySelector("img")?.getAttribute("src")).toBe(url);
  });

  it("shows new small previews while panning, then upgrades without clearing visible pixels", async () => {
    flowState.transform[2] = 4;
    const show = async (busy: boolean) => act(async () => root.render(
      React.createElement(CanvasRuntimeContext.Provider, { value: runtime },
        React.createElement(CanvasInteractingContext.Provider, { value: busy },
          React.createElement(CanvasMediaImage, { src: "/uploads/pan-new.jpg" })))));
    await show(true);
    expect(host.querySelector("[data-canvas-image-loading]")).not.toBeNull();
    expect(images[0].src).toMatch(/&w=200$/);
    await loaded(0);
    const preview = host.querySelector("img")!.getAttribute("src");
    await show(false);
    expect(images[1].src).toMatch(/&w=1600$/);
    expect(host.querySelector("img")!.getAttribute("src")).toBe(preview);
    await loaded(1);
    expect(host.querySelector("img")!.getAttribute("src")).toMatch(/&w=1600$/);
    await show(true);
    expect(images).toHaveLength(2);
    expect(host.querySelector("img")!.getAttribute("src")).toMatch(/&w=1600$/);
  });

  it("defers original fallback until panning stops instead of treating a missing thumbnail as missing media", async () => {
    const onError = vi.fn();
    const show = async (busy: boolean) => act(async () => root.render(
      React.createElement(CanvasRuntimeContext.Provider, { value: runtime },
        React.createElement(CanvasInteractingContext.Provider, { value: busy },
          React.createElement(CanvasMediaImage, { src: "/uploads/no-thumb.jpg", onError })))));
    await show(true);
    await act(async () => images[0].onerror?.(new Event("error")));
    expect(images).toHaveLength(1);
    expect(onError).not.toHaveBeenCalled();
    await show(false);
    await act(async () => images[1].onerror?.(new Event("error")));
    expect(images[2].src).toBe("/uploads/no-thumb.jpg");
    await loaded(2);
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/uploads/no-thumb.jpg");
    expect(runtime!.decoded.get("/uploads/no-thumb.jpg")).toBeUndefined();
  });
  it("restores the last preview URL even after the decoded image pool evicts it", async () => {
    await render(true); await loaded(0); await render(false);
    for (let i = 0; i < 100; i++) runtime!.decoded.set(String(i), images[0]);
    runtime!.images.add("slow-unrelated", () => new Promise(() => {}));
    await render(true);
    expect(host.querySelector("img")?.getAttribute("src")).toContain("seen.jpg");
  });
  it("readmits a returning node through the mount queue after releasing its old content", () => {
    const mounts = new CanvasMountQueue();
    for (let i = 0; i < 31; i++) mounts.add(String(i), () => {});
    mounts.flush(false); mounts.cancel("30");
    const returned = vi.fn(); mounts.add("30", returned, true);
    expect(returned).not.toHaveBeenCalled();
    expect(mounts.has("30")).toBe(false);
    // While the camera keeps moving, the queue upgrades one waiting node per frame.
    mounts.flush(true);
    expect(returned).toHaveBeenCalledOnce();
    expect(mounts.has("30")).toBe(true);
  });
});

describe("fixed-size canvas panel references", () => {
  const showReferences = async (count: number) => act(async () => root.render(
    React.createElement(CanvasRuntimeContext.Provider, { value: runtime },
      Array.from({ length: count }, (_, i) => React.createElement(CanvasMediaImage, {
        key: i, src: `/uploads/reference-${i}.png`, screenPreviewSize: 48,
      })))));

  it.each([5, 15, 20])("loads %i small references without waiting for blocked canvas images", async count => {
    runtime!.images.add("slow-canvas-original", () => new Promise(() => {}));
    flowState.transform[2] = 1;
    flowState.nodeLookup.set("image", { measured: { width: 622 }, selected: true });
    await showReferences(count);
    expect(images).toHaveLength(4);
    for (let i = 0; i < count; i++) {
      expect(images[i].src).toMatch(/\/api\/thumb\?.*&w=100$/);
      await loaded(i);
    }
    expect(host.querySelectorAll("img")).toHaveLength(count);
  });

  it("does not reload panel thumbnails when zoom or task selection changes", async () => {
    flowState.nodeLookup.set("image", { measured: { width: 622 }, selected: true });
    for (const zoom of [.1, .2, .3, .5, 1, 2, 3]) {
      flowState.transform[2] = zoom;
      await showReferences(1);
      if (zoom === .1) await loaded(0);
      expect(images).toHaveLength(1);
      expect(host.querySelector("img")?.getAttribute("src")).toMatch(/&w=100$/);
    }
  });

  it("reuses all 20 warm canvas previews immediately without fetching another tier", async () => {
    for (let i = 0; i < 20; i++) runtime!.previews.set(`/uploads/reference-${i}.png`, { url: `/cached-${i}-400.webp`, original: false });
    runtime!.images.add("slow-canvas", () => new Promise(() => {}));
    await showReferences(20);
    expect(host.querySelectorAll("img")).toHaveLength(20);
    expect(images).toHaveLength(0);
  });

  it("keeps small panel previews out of the canvas large-preview cache", async () => {
    await showReferences(1); await loaded(0);
    expect(runtime!.previews.get("/uploads/reference-0.png")).toBeUndefined();
    expect(runtime!.decoded.get(images[0].src)).toBeDefined();
  });
});
