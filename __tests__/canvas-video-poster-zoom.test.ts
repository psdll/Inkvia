// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasNodeData } from "@/lib/canvas/document";

const state = vi.hoisted(() => ({ zoom: .1, width: 350, serverPosters: false, connecting: false, readOnly: false }));
vi.mock("@xyflow/react", async (original) => ({
  ...await original<any>(),
  Handle: () => null,
  useNodeId: () => "video",
  useConnection: () => state.connecting,
  useUpdateNodeInternals: () => () => {},
  useStore: (select: any) => select({ transform: [0, 0, state.zoom], nodeLookup: new Map([["video", { measured: { width: state.width } }]]) }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/canvas/use-canvas-models", () => ({ useCanvasModels: () => null }));
import { CanvasNodeCard, CanvasVideoPlayer } from "@/components/canvas/CanvasNodeCard";
import { CanvasLodContext, CanvasLodProvider, CanvasRuntimeProvider } from "@/components/canvas/canvas-runtime-context";
import { CanvasReadOnlyContext } from "@/components/canvas/CanvasReadOnlyContext";

let root: Root, host: HTMLDivElement;
let hoveredSurface: Element | null;
let pointerStaysOverVideo: boolean;
beforeEach(() => {
  vi.useFakeTimers(); state.zoom = .3; state.width = 350; state.serverPosters = false; state.connecting = false; state.readOnly = false;
  hoveredSurface = null; pointerStaysOverVideo = false;
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector) {
    // jsdom does not calculate CSS hover from the dispatched pointer events.
    if (selector === ":hover") return this === hoveredSurface || (pointerStaysOverVideo && this === host.querySelector('[class~="group/video"]'));
    return matches.call(this, selector);
  });
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) { void Promise.resolve().then(() => value.includes("poster=1") && !state.serverPosters ? this.onerror?.() : this.onload?.()); }
    async decode() {}
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {} } as any);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,poster");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const render = async (data: CanvasNodeData | null, selected = false, interacting = false, deferContent = false) => {
  const node = data ? React.createElement(CanvasNodeCard, {
      // The mocked useStore has no subscription; refresh memoized content when simulating a new viewport.
      id: "video", type: data.kind, data: { ...data }, selected, dragging: false, width: 350, height: 622,
      isConnectable: true, zIndex: 0, draggable: true, selectable: true, deletable: true,
      positionAbsoluteX: 0, positionAbsoluteY: 0, deferContent,
    }) : null;
  await act(async () => root.render(React.createElement(CanvasReadOnlyContext.Provider, { value: state.readOnly },
    React.createElement(CanvasRuntimeProvider, { interacting, children: React.createElement(ReactFlowProvider, null, node) }))));
};
const advance = async (ms: number) => { await act(async () => vi.advanceTimersByTime(ms)); };
const enterVideo = async (surface = host.querySelector<HTMLElement>('[class~="group/video"]')!) => {
  hoveredSurface = surface;
  await act(async () => surface.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })));
};
const leaveVideo = async () => {
  const surface = hoveredSurface;
  hoveredSurface = null; pointerStaysOverVideo = false;
  await act(async () => surface?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));
};
const frameReady = async (video: HTMLVideoElement, width = 720, height = 1280) => {
  Object.defineProperties(video, { videoWidth: { value: width }, videoHeight: { value: height }, readyState: { value: 4 } });
  await act(async () => { video.dispatchEvent(new Event("loadedmetadata")); video.dispatchEvent(new Event("loadeddata")); });
};

describe("canvas video posters across zoom levels", () => {
  it.each([.1, .13, .14, .2, .22, .23, .25, .5, 1, 2, 4, 8].flatMap(zoom => ["video", "videoTask"].flatMap(kind => [false, true].map(readOnly => ({ zoom, kind, readOnly })))))(
    "plays the hovered $kind at zoom $zoom while leaving its selection unchanged (readOnly=$readOnly)", async ({ zoom, kind, readOnly }) => {
      state.zoom = zoom; state.readOnly = readOnly;
      const data: CanvasNodeData = kind === "video"
        ? { kind: "video", url: "/uploads/hover.mp4", posterUrl: "/uploads/poster.jpg" }
        : { kind: "videoTask", model: "test", prompt: "", mediaPaths: [], status: "success", outputUrl: "/uploads/hover.mp4", variants: { poster: { url: "/uploads/poster.jpg" } } };
      await render(data);
      await enterVideo(); await advance(350);
      expect(host.querySelector("video")).not.toBeNull();
      await frameReady(host.querySelector("video")!);
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
      if (zoom < .22) {
        expect(host.querySelector('[data-canvas-low-detail]')).not.toBeNull();
        expect(host.querySelector('[data-canvas-video-controls]')).toBeNull();
      }
      await leaveVideo();
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    },
  );
  it.each([.1, .2, .5, 1, 4, 8])("remembers hover arriving during pan settling at zoom %s", async zoom => {
    state.zoom = zoom;
    const data: CanvasNodeData = { kind: "video", url: "/uploads/settling.mp4", posterUrl: "/uploads/poster.jpg" };
    await render(data, false, true);
    await enterVideo(); await advance(350);
    expect(host.querySelector("video")).toBeNull();
    await render(data); await advance(180); await advance(350);
    expect(host.querySelector("video")).not.toBeNull();
    await frameReady(host.querySelector("video")!);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });
  it("prepares an intentional hover without a 300ms delay", async () => {
    state.zoom = 1;
    await render({ kind: "video", url: "/uploads/immediate.mp4", posterUrl: "/uploads/poster.jpg" });
    await enterVideo(); await advance(0);
    expect(host.querySelector("video")).not.toBeNull();
  });
  it("recovers stationary hover after replacing the low-detail player at the LOD boundary", async () => {
    const data: CanvasNodeData = { kind: "video", url: "/uploads/remount.mp4", posterUrl: "/uploads/poster.jpg" };
    state.zoom = .1; await render(data);
    await enterVideo(); await advance(350);
    // Zoom moves/replaces DOM below a stationary pointer; there is no new enter.
    pointerStaysOverVideo = true;
    state.zoom = .5; await render(data); await advance(350);
    expect(host.querySelector("video")).not.toBeNull();
    await frameReady(host.querySelector("video")!);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });
  it("starts hover playback while all background poster slots are occupied", async () => {
    await act(async () => root.render(React.createElement(CanvasRuntimeProvider, { interacting: false,
      children: [
        ...Array.from({ length: 3 }, (_, i) => React.createElement(CanvasVideoPlayer, { key: i, src: `/uploads/background-${i}.mp4`, previewOnly: true, className: "" })),
        React.createElement(CanvasVideoPlayer, { key: "hover", src: "/uploads/priority.mp4", poster: "/uploads/poster.jpg", className: "" }),
      ],
    })));
    await advance(0);
    expect(host.querySelectorAll("video")).toHaveLength(3);
    await enterVideo(host.querySelectorAll<HTMLElement>('[class~="group/video"]')[3]); await advance(350);
    const video = host.querySelector<HTMLVideoElement>('video[src="/uploads/priority.mp4"]');
    expect(video).not.toBeNull();
    await frameReady(video!);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });
  it("cancels unfinished hover decoders when sweeping across twenty overview videos", async () => {
    await act(async () => root.render(React.createElement(CanvasRuntimeProvider, { interacting: false,
      children: Array.from({ length: 20 }, (_, i) => React.createElement(CanvasVideoPlayer, {
        key: i, src: `/uploads/sweep-${i}.mp4`, poster: "/uploads/poster.jpg", previewOnly: true, className: "",
      })),
    })));
    const surfaces = host.querySelectorAll<HTMLElement>('[class~="group/video"]');
    for (let i = 0; i < surfaces.length; i++) {
      await enterVideo(surfaces[i]); await advance(0);
      expect(host.querySelectorAll("video")).toHaveLength(1);
      expect(host.querySelector("video")?.getAttribute("src")).toBe(`/uploads/sweep-${i}.mp4`);
      await leaveVideo(); await advance(0);
      expect(host.querySelectorAll("video")).toHaveLength(0);
    }
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  it("retries a failed video on the next hover instead of keeping its broken decoder", async () => {
    state.zoom = 1;
    await render({ kind: "video", url: "/uploads/retry.mp4", posterUrl: "/uploads/poster.jpg" });
    await enterVideo(); await advance(350);
    const failed = host.querySelector("video")!;
    await act(async () => failed.dispatchEvent(new Event("error")));
    await leaveVideo(); await enterVideo(); await advance(350);
    const retried = host.querySelector("video")!;
    expect(retried).not.toBeNull();
    expect(retried).not.toBe(failed);
    await frameReady(retried);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });
  it.each([.1, 1])("plays inside the 22-25 percent hold zone when arriving from zoom %s", async previousZoom => {
    const data: CanvasNodeData = { kind: "video", url: "/uploads/hysteresis.mp4", posterUrl: "/uploads/poster.jpg" };
    state.zoom = previousZoom; await render(data);
    state.zoom = .23; await render(data);
    const overview = Boolean(host.querySelector('[data-canvas-low-detail]'));
    expect(overview).toBe(previousZoom === .1);
    await enterVideo(); await advance(0);
    await frameReady(host.querySelector("video")!);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(Boolean(host.querySelector('[data-canvas-low-detail]'))).toBe(overview);
  });
  it("drops stale hover when the pointer left an inert layer during panning", async () => {
    state.zoom = 1;
    const data: CanvasNodeData = { kind: "video", url: "/uploads/left.mp4", posterUrl: "/uploads/poster.jpg" };
    await render(data); await enterVideo(); await advance(0); await frameReady(host.querySelector("video")!);
    const playCount = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
    await render(data, false, true);
    hoveredSurface = null; // No mouseout is delivered while the node layer is inert.
    await render(data); await advance(180); await advance(1600);
    expect(host.querySelector("video")).toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(playCount);
  });
  it("does not start a video that was left before pan settling completes", async () => {
    const data: CanvasNodeData = { kind: "video", url: "/uploads/passed.mp4", posterUrl: "/uploads/poster.jpg" };
    await render(data, false, true); await enterVideo(); await leaveVideo();
    await render(data); await advance(1000);
    expect(host.querySelector("video")).toBeNull();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  it.each([true, false])("keeps prefetch=%s inert during connection gestures", async prefetch => {
    const draw = () => act(async () => root.render(React.createElement(CanvasVideoPlayer, {
      src: "/uploads/connection.mp4", poster: "/uploads/poster.jpg", className: "", prefetch,
    })));
    state.connecting = true; await draw(); await enterVideo(); await advance(1000);
    expect(host.querySelector("video")).toBeNull();
    state.connecting = false; await draw(); await advance(0);
    if (prefetch) expect(host.querySelector("video")).toBeNull();
    else {
      await frameReady(host.querySelector("video")!);
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    }
  });
  it("falls back to muted hover playback when the browser rejects sound autoplay", async () => {
    state.zoom = 1;
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    await render({ kind: "video", url: "/uploads/autoplay.mp4", posterUrl: "/uploads/poster.jpg" });
    await enterVideo(); await advance(0);
    const video = host.querySelector("video")!;
    await frameReady(video);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(video.muted).toBe(true);
  });
  it("shows a local video's server poster without creating a decoder", async () => {
    state.serverPosters = true;
    await render({ kind: "video", url: "/uploads/server-poster.mp4" });
    await advance(0);
    expect(host.querySelector('[data-canvas-video-poster]')?.getAttribute("src")).toContain("poster=1");
    expect(host.querySelector("video")).toBeNull();
    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
  });
  it("fills every cold low-detail video with a 100px poster using bounded decoders, without playback", async () => {
    state.zoom = .1;
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(function (this: HTMLCanvasElement) { return `data:image/jpeg;base64,poster-${this.width}`; });
    await act(async () => root.render(React.createElement(CanvasRuntimeProvider, { interacting: false,
      children: Array.from({ length: 20 }, (_, i) => React.createElement(CanvasVideoPlayer, { key: i, src: `/uploads/cold-${i}.mp4`, previewOnly: true, className: "" })),
    })));
    await advance(0);
    expect(host.querySelectorAll("video")).toHaveLength(3);
    for (let batch = 0; batch < 7; batch++) {
      const videos = Array.from(host.querySelectorAll("video"));
      expect(videos.length).toBeLessThanOrEqual(3);
      for (const video of videos) await frameReady(video);
      await advance(1);
    }
    expect(host.querySelectorAll('[data-canvas-video-poster]')).toHaveLength(20);
    expect(Array.from(host.querySelectorAll('[data-canvas-video-poster]')).every(img => img.getAttribute("src")?.endsWith("poster-100"))).toBe(true);
    expect(host.querySelectorAll("video")).toHaveLength(0);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  it("drops the unreadable name in the low-detail overview and restores it at full detail", async () => {
    const data: CanvasNodeData = { kind: "video", name: "客厅镜头", url: "/uploads/named.mp4", posterUrl: "/uploads/poster.jpg" };
    state.zoom = .1;
    await render(data);
    expect(host.querySelector('[data-canvas-material-metadata]')).toBeNull();
    expect(host.querySelector('[data-canvas-video-poster]')).not.toBeNull();
    state.zoom = .5;
    await render(data); await advance(180);
    expect(host.querySelector('[data-canvas-material-metadata]')?.textContent).toContain("客厅镜头");
  });
  it("shows an explicit failed preview and releases a failed low-detail decoder", async () => {
    state.zoom = .1;
    await render({ kind: "video", url: "/uploads/missing.mp4" }); await advance(0);
    await act(async () => host.querySelector("video")!.dispatchEvent(new Event("error")));
    await advance(1);
    expect(host.querySelector('[data-canvas-video-preview-state="failed"]')).not.toBeNull();
    expect(host.querySelector("video")).toBeNull();
    await render({ kind: "video", url: "/uploads/missing.mp4" }); await advance(20000);
    expect(host.querySelector("video")).toBeNull();
  });
  it("newly visible nodes inherit the canvas LOD hysteresis after panning inside the hold zone", async () => {
    function Probe({ id }: { id: string }) { return React.createElement("span", { "data-lod-probe": id }, String(React.useContext(CanvasLodContext))); }
    const draw = async (ids: string[], busy = false) => act(async () => root.render(React.createElement(CanvasRuntimeProvider, {
      interacting: busy, children: React.createElement(CanvasLodProvider, { children: ids.map(id => React.createElement(Probe, { id, key: id })) }),
    })));
    state.zoom = .5; await draw(["a"]); expect(host.textContent).toBe("false");
    state.zoom = .2; await draw(["a"]); expect(host.textContent).toBe("true");
    state.zoom = .23; await draw(["a", "b"]); expect(host.textContent).toBe("truetrue");
    state.zoom = .25; await draw(["a", "b"], true); expect(host.textContent).toBe("truetrue");
    await draw(["a", "b"]); await advance(180); expect(host.textContent).toBe("falsefalse");
    state.zoom = .23; await draw(["b", "c"]); expect(host.textContent).toBe("falsefalse");
  });
  it("keeps existing content mounted across the overview boundary until shrinking settles", async () => {
    const unmount = vi.fn();
    function Detail() { React.useEffect(() => () => unmount(), []); return React.createElement("span", null, "detail"); }
    function Probe() { return React.useContext(CanvasLodContext) ? React.createElement("span", null, "overview") : React.createElement(Detail); }
    const draw = async (busy: boolean) => act(async () => root.render(React.createElement(CanvasRuntimeProvider, {
      interacting: busy, children: React.createElement(CanvasLodProvider, { children: React.createElement(Probe) }),
    })));
    state.zoom = .5; await draw(false);
    await draw(true);
    for (const zoom of [.13, .18, .1]) { state.zoom = zoom; await draw(true); }
    expect(host.textContent).toBe("detail"); expect(unmount).not.toHaveBeenCalled();
    await draw(false); await advance(179);
    expect(host.textContent).toBe("detail");
    await advance(1);
    expect(host.textContent).toBe("overview"); expect(unmount).toHaveBeenCalledOnce();
  });
  // 622px node at DPR 1.5: previews cover the device pixels; beyond 1600px the frame is taken at source width (2560).
  it.each([[.1, 400], [.35, 400], [.38, 400], [.5, 800], [1, 1600], [8, 2560]])("captures a right-sized poster at zoom %s on a high-density screen", async (zoom, width) => {
    state.zoom = zoom; state.width = 622;
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1.5 });
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(function (this: HTMLCanvasElement) { return `data:image/jpeg;base64,poster-${this.width}`; });
    await render({ kind: "video", url: "/uploads/sharp.mp4" }, zoom < .14); await advance(0);
    await frameReady(host.querySelector("video")!, 2560, 1440); await advance(1500);
    expect(host.querySelector('[data-canvas-video-poster]')?.getAttribute("src")).toBe(`data:image/jpeg;base64,poster-${width}`);
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenLastCalledWith("image/jpeg", .9);
    expect(host.querySelector("video")).toBeNull();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("upgrades a cached poster after zoom settles, preserving the old image until the new frame is ready", async () => {
    state.width = 622; Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1.5 });
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(function (this: HTMLCanvasElement) { return `data:image/jpeg;base64,poster-${this.width}`; });
    const data: CanvasNodeData = { kind: "video", url: "/uploads/upgrade.mp4" };
    await render(data); await advance(0); await frameReady(host.querySelector("video")!, 2560, 1440); await advance(1500);
    state.zoom = 1; await render(data, false, true); await advance(1000);
    expect(host.querySelector('[data-canvas-video-poster]')?.getAttribute("src")).toContain("poster-400");
    expect(host.querySelector("video")).toBeNull();
    await render(data); await advance(180); await advance(0);
    expect(host.querySelector('[data-canvas-video-poster]')?.getAttribute("src")).toContain("poster-400");
    expect(host.querySelector("video")?.className).toContain("opacity-0");
    await frameReady(host.querySelector("video")!, 2560, 1440); await advance(1500);
    expect(host.querySelector('[data-canvas-video-poster]')?.getAttribute("src")).toContain("poster-1600");
    await render(null); await render(data); await advance(0);
    expect(host.querySelector('[data-canvas-video-poster]')?.getAttribute("src")).toContain("poster-1600");
    state.zoom = .1; await render(data); await advance(0);
    expect(host.querySelector("video")).toBeNull();
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledTimes(2);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("keeps the existing preview when a sharper frame fails, without retrying on every render", async () => {
    const data: CanvasNodeData = { kind: "video", url: "/uploads/failed-upgrade.mp4" };
    await render(data); await advance(0); await frameReady(host.querySelector("video")!); await advance(1500);
    state.zoom = 8; await render(data); await advance(180); await advance(0);
    expect(host.querySelector("video")).not.toBeNull();
    await act(async () => host.querySelector("video")!.dispatchEvent(new Event("error"))); await advance(1500);
    await render(data); await advance(1000);
    expect(host.querySelector("video")).toBeNull();
    expect(host.querySelector('[data-canvas-video-poster]')?.getAttribute("src")).toBe("data:image/jpeg;base64,poster");
  });

  it("caps a portrait poster at the source resolution instead of upscaling it", async () => {
    state.zoom = 8;
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(function (this: HTMLCanvasElement) { return `data:image/jpeg;base64,${this.width}x${this.height}`; });
    await render({ kind: "video", url: "/uploads/portrait.mp4" }); await advance(0);
    await frameReady(host.querySelector("video")!, 720, 1280); await advance(1500);
    expect(host.querySelector('[data-canvas-video-poster]')?.getAttribute("src")).toContain("720x1280");
    await render(null); await render({ kind: "video", url: "/uploads/portrait.mp4" }); await advance(0);
    expect(host.querySelector("video")).toBeNull();
  });

  it("keeps the old poster throughout decoding a sharper image", async () => {
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(function (this: HTMLCanvasElement) { return `data:image/jpeg;base64,poster-${this.width}`; });
    const data: CanvasNodeData = { kind: "video", url: "/uploads/decoding.mp4" };
    await render(data); await advance(0); await frameReady(host.querySelector("video")!, 2560, 1440); await advance(1500);
    let finishDecode!: () => void;
    vi.spyOn(Image.prototype, "decode").mockImplementationOnce(() => new Promise<void>(resolve => { finishDecode = resolve; }));
    state.zoom = 8; await render(data); await advance(180); await advance(0); await frameReady(host.querySelector("video")!, 2560, 1440);
    expect(host.querySelector('[data-canvas-video-poster]')?.getAttribute("src")).toContain("poster-400");
    expect(host.querySelector("video")?.className).toContain("opacity-0");
    await act(async () => finishDecode());
    expect(host.querySelector('[data-canvas-video-poster]')?.getAttribute("src")).toContain("poster-2560");
  });

  it("does not replace a new source's poster with an old extraction still decoding", async () => {
    let finishDecode!: () => void;
    vi.spyOn(Image.prototype, "decode").mockImplementationOnce(() => new Promise<void>(resolve => { finishDecode = resolve; }));
    await render({ kind: "video", url: "/uploads/old.mp4" }); await advance(0); await frameReady(host.querySelector("video")!);
    await render({ kind: "video", url: "/uploads/new.mp4" }); await advance(0);
    await act(async () => finishDecode());
    expect(host.querySelector('[data-canvas-video-poster]')).toBeNull();
    expect(host.querySelector("video")?.getAttribute("src")).toBe("/uploads/new.mp4");
  });

  it("shows the lightweight poster while full node content is deferred during panning", async () => {
    await render({ kind: "video", url: "/uploads/video.mp4", posterUrl: "/uploads/poster.jpg" }, false, true, true);
    expect(host.querySelector('[data-canvas-video-poster]')).not.toBeNull();
    expect(host.querySelector("video")).toBeNull();
  });
  it.each([.1, .22, .25, .27, .5, 1, 8].flatMap(zoom => [
    { zoom, data: { kind: "video", url: "/uploads/video.mp4" } as CanvasNodeData },
    { zoom, data: { kind: "videoTask", model: "test", prompt: "", mediaPaths: [], status: "success", outputUrl: "/uploads/result.mp4" } as CanvasNodeData },
  ]))("prepares a static frame at zoom $zoom for $data.kind without a supplied poster", async ({ zoom, data }) => {
    state.zoom = zoom;
    await render(data); await advance(0);
    const video = host.querySelector("video");
    expect(video).not.toBeNull();
    await frameReady(video!); await advance(1500);
    expect(host.querySelector("video")).toBeNull();
    expect(host.querySelector('[data-canvas-video-poster]')?.getAttribute("src")).toBe("data:image/jpeg;base64,poster");
    if (zoom < .22) expect(host.querySelector('[data-canvas-video-controls]')).toBeNull();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  it("keeps the captured frame through LOD, selection and viewport remounts", async () => {
    const data: CanvasNodeData = { kind: "video", url: "/uploads/video.mp4" };
    await render(data); await advance(0); await frameReady(host.querySelector("video")!); await advance(1500);
    for (const zoom of [.22, .25, .27, .5, 1, 8, .25, .22, .1]) {
      state.zoom = zoom; await render(data); await advance(180); await advance(0);
      expect(host.querySelector('[data-canvas-video-poster]')?.getAttribute("src")).toBe("data:image/jpeg;base64,poster");
      const video = host.querySelector("video");
      if (video) { await frameReady(video); await advance(1500); }
      expect(host.querySelector("video")).toBeNull();
    }
    await render(data, true); await render(data, false);
    await render(null); await render(data); await advance(0);
    expect(host.querySelector('[data-canvas-video-poster]')?.getAttribute("src")).toBe("data:image/jpeg;base64,poster");
    expect(host.querySelector("video")).toBeNull();
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledTimes(2);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  it("keeps twenty overview videos static when hovering only their outer node headers", async () => {
    state.zoom = .1;
    for (let i = 0; i < 20; i++) {
      await render({ kind: "video", url: `/uploads/${i}.mp4`, posterUrl: "/uploads/poster.jpg" });
      const surface = host.querySelector('[data-canvas-low-detail]')!;
      await act(async () => surface.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
      await advance(1000);
      expect(host.querySelector("video")).toBeNull();
    }
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  it("waits for interaction settling before extracting and never reuses a different source's frame", async () => {
    const data: CanvasNodeData = { kind: "video", url: "/uploads/a.mp4" };
    await render(data, false, true); await advance(1000); expect(host.querySelector("video")).toBeNull();
    await render(data); await advance(180); await advance(0);
    await frameReady(host.querySelector("video")!); await advance(1500);
    await render({ ...data, url: "/uploads/b.mp4" }); await advance(0);
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("video")?.getAttribute("src")).toBe("/uploads/b.mp4");
  });
  it("keeps a full-detail poster visible until the hovered player's frame is ready", async () => {
    state.zoom = .5;
    await render({ kind: "video", url: "/uploads/video.mp4", posterUrl: "/uploads/poster.jpg" });
    const surface = host.querySelector('[data-canvas-video-poster]')!.parentElement!;
    await enterVideo(surface);
    await advance(300);
    const video = host.querySelector("video")!;
    expect(video.className).toContain("opacity-0");
    await frameReady(video);
    expect(video.className).toContain("opacity-100");
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });
  it.each([.1, .5])("recovers a failed supplied poster at zoom %s by extracting the video's frame", async (zoom) => {
    state.zoom = zoom;
    await render({ kind: "video", url: "/uploads/video.mp4", posterUrl: "/uploads/expired.jpg" });
    const poster = host.querySelector('[data-canvas-video-poster]')!;
    await act(async () => poster.dispatchEvent(new Event("error")));
    await advance(0);
    expect(host.querySelector("video")).not.toBeNull();
    await frameReady(host.querySelector("video")!); await advance(1500);
    expect(host.querySelector('[data-canvas-video-poster]')?.getAttribute("src")).toBe("data:image/jpeg;base64,poster");
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  it("preserves five-second progress through busy release and respects manual pause", async () => {
    const data: CanvasNodeData = { kind: "video", url: "/uploads/progress.mp4", posterUrl: "/uploads/poster.jpg" };
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      this.dispatchEvent(new Event("play")); return Promise.resolve();
    });
    vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, "paused", { configurable: true, value: true });
      this.dispatchEvent(new Event("pause"));
    });
    await render(data);
    const surface = host.querySelector('[data-canvas-video-poster]')!.parentElement!;
    await enterVideo(surface);
    await advance(300);
    let video = host.querySelector("video")!;
    Object.defineProperty(video, "duration", { configurable: true, value: 30 });
    await frameReady(video);
    video.currentTime = 5;
    await render(data, false, true);
    expect(video.currentTime).toBe(5); expect(video.paused).toBe(true);
    await advance(1600); expect(host.querySelector("video")).toBeNull();
    await render(data); await advance(180); await advance(300);
    video = host.querySelector("video")!;
    Object.defineProperty(video, "duration", { configurable: true, value: 30 });
    await frameReady(video);
    expect(video.currentTime).toBe(5); expect(video.paused).toBe(false);
    await act(async () => host.querySelector('[aria-label="暂停"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const playCount = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
    await render(data, false, true); await render(data); await advance(180);
    expect(video.paused).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(playCount);
  });
});
