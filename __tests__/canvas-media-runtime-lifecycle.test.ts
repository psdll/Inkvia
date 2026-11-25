// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const posterCache = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/canvas/video-poster-cache", () => ({ readCanvasVideoPoster: posterCache.read, writeCanvasVideoPoster: posterCache.write, invalidateCanvasVideoPoster: vi.fn() }));
const state = vi.hoisted(() => ({ zoom: .2, selected: false, interacting: false }));
vi.mock("@xyflow/react", async (original) => ({ ...await original<any>(), useNodeId: () => "node", useConnection: () => false, useStore: (fn: any) => fn({ transform: [0, 0, state.zoom], nodeLookup: new Map([["node", { measured: { width: 350 }, selected: state.selected }]]) }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/canvas/canvas-runtime-context", async () => ({ CanvasRuntimeContext: (await import("react")).createContext(null), useCanvasInteracting: () => state.interacting }));
import { CanvasMediaImage } from "@/components/canvas/CanvasMediaImage";
import { CanvasVideoPlayer, CanvasNodeEditorContext } from "@/components/canvas/CanvasNodeCard";
import { buildCanvasImageCandidates } from "@/lib/canvas/media-url";
let root: Root, host: HTMLDivElement;
let images: HTMLImageElement[];
beforeEach(() => {
  posterCache.read.mockReset().mockResolvedValue(null); posterCache.write.mockReset();
  vi.useFakeTimers(); state.zoom = .2; state.selected = false; state.interacting = false;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); images = [];
  vi.stubGlobal("Image", class { onload: any; onerror: any; src = ""; decoding = ""; decode = async () => {}; constructor() { images.push(this as any); } });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {} } as any);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,frame");
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const render = async (node: React.ReactNode) => { await act(async () => root.render(node)); };
const advance = async (ms: number) => { await act(async () => vi.advanceTimersByTime(ms)); };
const event = async (el: Element, type: string, relatedTarget?: EventTarget) => { await act(async () => el.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget }))); };
const settleImage = async (index: number, success: boolean) => { await act(async () => (success ? images[index].onload : images[index].onerror)?.call(images[index], new Event(success ? "load" : "error"))); };
describe("canvas media real lifecycle", () => {
  it("plays a focused video after the animation settles without a fresh mouse-enter", async () => {
    const consume = vi.fn();
    const request = { nodeId: "node", src: "/focus.mp4", revision: 1 };
    const view = (focusRequest: typeof request | null, previewOnly = false) => React.createElement(CanvasNodeEditorContext.Provider, {
      value: { videoFocusRequest: focusRequest, consumeVideoFocusRequest: consume } as any,
    }, React.createElement(CanvasVideoPlayer, { src: "/focus.mp4", poster: "/poster.png", className: "", previewOnly }));
    state.interacting = true;
    await render(view(request, true)); await advance(500);
    expect(host.querySelector("video")).toBeNull();
    expect(consume).not.toHaveBeenCalled();
    // LOD/full-detail handoff can replace the player during focus.
    await render(null); state.interacting = false;
    await render(view(request)); await advance(300);
    const video = host.querySelector("video");
    expect(video).not.toBeNull();
    await event(video!, "loadedmetadata");
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(consume).toHaveBeenCalledWith(1);
    await render(view(null));
    await event(host.firstElementChild!, "mouseout", document.body);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("restarts a manually paused focused video only for a new double-click request", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      return Promise.resolve();
    });
    vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", { configurable: true, value: true });
    });
    const view = (revision: number) => React.createElement(CanvasNodeEditorContext.Provider, { value: {
      videoFocusRequest: { nodeId: "node", src: "/focus.mp4", revision }, consumeVideoFocusRequest: vi.fn(),
    } as any }, React.createElement(CanvasVideoPlayer, { src: "/focus.mp4", poster: "/poster.png", className: "" }));
    await render(view(1)); await advance(300);
    const video = host.querySelector("video"); expect(video).not.toBeNull();
    await event(video!, "loadedmetadata");
    await event(video!, "click");
    const playCount = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
    state.interacting = true; await render(view(1));
    state.interacting = false; await render(view(1));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(playCount);
    await render(view(2));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(playCount + 1);
  });

  it.each([["other", "/focus.mp4"], ["node", "/old.mp4"]])("does not start a different node or replaced source: %s %s", async (nodeId, src) => {
    const consume = vi.fn();
    await render(React.createElement(CanvasNodeEditorContext.Provider, { value: {
      videoFocusRequest: { nodeId, src, revision: 1 }, consumeVideoFocusRequest: consume,
    } as any }, React.createElement(CanvasVideoPlayer, { src: "/focus.mp4", poster: "/poster.png", className: "" })));
    await advance(1000);
    expect(host.querySelector("video")).toBeNull();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it("requests exact local tiers and a true original", () => {
    for (const tier of [100, 200, 400, 800, 1600]) expect(buildCanvasImageCandidates("/uploads/a.png", tier)[0]).toEqual({ url: `/api/thumb?src=%2Fuploads%2Fa.png&w=${tier}`, original: false });
    expect(buildCanvasImageCandidates("/uploads/a.png", "original")).toEqual([{ url: "/uploads/a.png", original: true }]);
  });
  it("switches decoded tiers without reporting preview dimensions as original", async () => {
    const native = vi.fn();
    const view = () => React.createElement(CanvasMediaImage, { src: "/uploads/a.png", onOriginalLoad: native });
    await render(view()); expect(images[0].src).toContain("w=100"); await settleImage(0, true);
    await event(host.querySelector("img")!, "load"); expect(native).not.toHaveBeenCalled();
    state.zoom = 1; state.selected = true; await render(view());
    expect(images[1].src).toBe("/uploads/a.png"); expect(host.querySelector("img")!.getAttribute("src")).toContain("w=100");
    await settleImage(1, true); await event(host.querySelector("img")!, "load"); expect(native).toHaveBeenCalledTimes(1);
  });
  it("reports terminal initial failure once and preserves visible preview on failed upgrade", async () => {
    const missing = vi.fn(); const view = () => React.createElement(CanvasMediaImage, { src: "/uploads/a.png", onError: missing });
    await render(view()); await settleImage(0, false); await settleImage(1, false); expect(missing).toHaveBeenCalledTimes(1);
    state.zoom = .8; await render(view()); await settleImage(2, false); await settleImage(3, false); expect(missing).toHaveBeenCalledTimes(1);
    state.zoom = 2; await render(view()); await settleImage(4, true);
    const previous = host.querySelector("img")!.getAttribute("src");
    state.zoom = 4; await render(view()); await settleImage(5, false); await settleImage(6, false);
    expect(host.querySelector("img")!.getAttribute("src")).toBe(previous); expect(missing).toHaveBeenCalledTimes(1);
  });
  it("waits for delayed first frame before starting idle disposal", async () => {
    await render(React.createElement(CanvasVideoPlayer, { src: "/video.mp4", className: "" })); await advance(0);
    const video = host.querySelector("video")!; expect(video.preload).toBe("auto");
    await advance(2000); expect(host.querySelector("video")).toBe(video);
    await event(video, "loadedmetadata"); await advance(1000); expect(host.querySelector("video")).toBe(video);
    await event(video, "loadeddata"); await advance(1499); expect(host.querySelector("video")).toBe(video);
    await advance(1); expect(host.querySelector("video")).toBeNull(); expect(video.hasAttribute("src")).toBe(false);
  });
  it("cancels click intent when leaving before metadata", async () => {
    await render(React.createElement(CanvasVideoPlayer, { src: "/video.mp4", poster: "/poster.png", className: "" }));
    // Controls mount when the pointer reaches the player, as they do on screen.
    await event(host.firstElementChild!, "mouseover", document.body);
    await event(host.querySelector("button")!, "click"); await advance(300);
    const video = host.querySelector("video")!;
    await event(host.firstElementChild!, "mouseout", document.body);
    await event(video, "loadedmetadata"); expect(video.play).not.toHaveBeenCalled();
  });
  it("requests real LOD400 and high-DPR1600 URLs", async () => {
    await render(React.createElement(CanvasMediaImage, { src: "/uploads/a.png", previewSize: { width: 400 } }));
    expect(images[0].src).toContain("w=400");
    await settleImage(0, true);
    state.zoom = 4;
    await render(React.createElement(CanvasMediaImage, { src: "/uploads/a.png" }));
    expect(images[1].src).toContain("w=1600");
  });
  it("cancels pending playback on source changes and interactions", async () => {
    const view = (src: string) => React.createElement(CanvasVideoPlayer, { src, poster: "/poster.png", className: "" });
    await render(view("/a.mp4"));
    await event(host.firstElementChild!, "mouseover", document.body);
    await event(host.querySelector("button")!, "click");
    await advance(300);
    state.interacting = true;
    await render(view("/a.mp4"));
    await event(host.querySelector("video")!, "loadedmetadata");
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    state.interacting = false;
    await render(view("/b.mp4"));
    await event(host.firstElementChild!, "mouseover", document.body);
    await advance(300);
    await event(host.querySelector("video")!, "loadedmetadata");
    // The old click was cancelled; a new hover on the new source is a fresh playback intent.
    const played = vi.mocked(HTMLMediaElement.prototype.play).mock.contexts.map(video => (video as HTMLVideoElement).getAttribute("src"));
    expect(played.filter(src => src === "/a.mp4")).toHaveLength(0);
    expect(played.filter(src => src === "/b.mp4")).toHaveLength(1);
    await event(host.firstElementChild!, "mouseout", document.body);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });
  it("disposes stalled initialization at the bounded timeout", async () => {
    await render(React.createElement(CanvasVideoPlayer, { src: "/video.mp4", className: "" })); await advance(0);
    const video = host.querySelector("video")!; await advance(10000);
    expect(video.hasAttribute("src")).toBe(false); expect(video.pause).toHaveBeenCalled(); expect(video.load).toHaveBeenCalled(); expect(host.querySelector("video")).toBeNull();
  });
});

it("shows a persisted low-detail poster without mounting or playing a video", async () => {
  posterCache.read.mockResolvedValue({ url: "data:image/jpeg;base64,stored", tier: 100 });
  await render(React.createElement(CanvasVideoPlayer, { src: "/cached.mp4", previewOnly: true, className: "" }));
  await advance(5000);
  expect(host.querySelector("[data-canvas-video-poster]")?.getAttribute("src")).toBe("data:image/jpeg;base64,stored");
  expect(host.querySelector("video")).toBeNull();
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
});

it("ignores a late cached poster after the media source changes", async () => {
  let resolveOld!: (value: { url: string; tier: number }) => void;
  posterCache.read.mockImplementation((_: unknown, src: string) => src === "/old.mp4"
    ? new Promise(resolve => { resolveOld = resolve; })
    : Promise.resolve({ url: "data:image/jpeg;base64,new", tier: 100 }));
  const view = (src: string) => React.createElement(CanvasVideoPlayer, { src, previewOnly: true, className: "" });
  await render(view("/old.mp4"));
  await render(view("/new.mp4"));
  await act(async () => resolveOld({ url: "data:image/jpeg;base64,old", tier: 100 }));
  expect(host.querySelector("[data-canvas-video-poster]")?.getAttribute("src")).toBe("data:image/jpeg;base64,new");
  expect(host.querySelector("video")).toBeNull();
});

it("starts fallback extraction after 150ms but still accepts a late cache hit", async () => {
  let resolveCache!: (value: { url: string; tier: number }) => void;
  posterCache.read.mockImplementation(() => new Promise(resolve => { resolveCache = resolve; }));
  await render(React.createElement(CanvasVideoPlayer, { src: "/slow-cache.mp4", previewOnly: true, className: "" }));
  await advance(149);
  expect(host.querySelector("video")).toBeNull();
  await advance(1); await advance(0);
  expect(host.querySelector("video")).not.toBeNull();
  await act(async () => resolveCache({ url: "data:image/jpeg;base64,late", tier: 100 }));
  expect(host.querySelector("[data-canvas-video-poster]")?.getAttribute("src")).toBe("data:image/jpeg;base64,late");
});

it("retries a completely black first frame at 0.5 seconds without playing the video", async () => {
  const pixels = new Uint8ClampedArray(16 * 16 * 4);
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({ drawImage() {}, getImageData: () => ({ data: pixels }) } as any);
  await render(React.createElement(CanvasVideoPlayer, { src: "/fade-in.mp4", previewOnly: true, className: "" }));
  await advance(0);
  const video = host.querySelector("video")!;
  Object.defineProperties(video, { videoWidth: { value: 720 }, videoHeight: { value: 1280 }, readyState: { value: 4 }, duration: { value: 10 } });
  await event(video, "loadeddata");
  expect(video.currentTime).toBe(.5);
  expect(host.querySelector("[data-canvas-video-poster]")).toBeNull();
  pixels[0] = 120;
  await event(video, "seeked");
  expect(host.querySelector("[data-canvas-video-poster]")).not.toBeNull();
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  expect(posterCache.write).toHaveBeenCalled();
});
