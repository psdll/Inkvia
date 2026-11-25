// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoPosterPreview } from "@/components/ui/video-poster-preview";

vi.mock("@/components/ui/media-image", () => ({
  MediaImage: ({ src, alt }: { src: string; alt: string }) => React.createElement("img", { src, alt }),
}));

let host: HTMLDivElement;
let root: Root;
let decoders: HTMLVideoElement[];
let frameAvailable: boolean;
let observeVisibility: (visible: boolean) => void;
let encode: ReturnType<typeof vi.spyOn>;
let sequence = 0;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) {
      observeVisibility = (visible) => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as any);
    }
    observe() { observeVisibility(true); }
    disconnect() {}
  });
  vi.stubGlobal("FileReader", class {
    result = "data:image/webp;base64,cG9zdGVy";
    onload: (() => void) | null = null;
    readAsDataURL() { this.onload?.(); }
  });
  decoders = [];
  frameAvailable = false;
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, frameAvailable ? 255 : 0]) }),
  } as any);
  encode = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob(["poster"])));
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string, options?: ElementCreationOptions) => {
    const element = createElement(tag, options);
    if (tag === "video") {
      Object.defineProperties(element, {
        duration: { value: 15 }, readyState: { value: 4 },
        videoWidth: { value: 1280 }, videoHeight: { value: 720 },
      });
      decoders.push(element as HTMLVideoElement);
    }
    return element;
  }) as typeof document.createElement);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  // Let the bounded extraction finish even when a preview unmounts mid-load.
  await act(async () => vi.advanceTimersByTimeAsync(4_100));
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function mount(src: string, copies = 1) {
  await act(async () => root.render(React.createElement(React.Fragment, null,
    ...Array.from({ length: copies }, (_, index) => React.createElement(VideoPosterPreview, { key: index, videoSrc: src })),
  )));
}

async function seek(decoder: HTMLVideoElement) {
  await act(async () => {
    decoder.dispatchEvent(new Event("loadedmetadata"));
    decoder.dispatchEvent(new Event("seeked"));
    await vi.advanceTimersByTimeAsync(48);
  });
}

describe("video poster decoded frame readiness", () => {
  it("renders a cached poster on the first commit after reopening, without a new decoder", async () => {
    const src = `/uploads/imports/reopen-${sequence++}.mp4`;
    await mount(src);
    frameAvailable = true;
    await seek(decoders[0]);
    const poster = host.querySelector("img")?.getAttribute("src");
    await act(async () => root.render(null));
    let firstCommit: string | null | undefined;
    function Reopened() {
      React.useLayoutEffect(() => { firstCommit = host.querySelector("img")?.getAttribute("src"); }, []);
      return React.createElement(VideoPosterPreview, { videoSrc: src });
    }
    await act(async () => root.render(React.createElement(Reopened)));
    expect(firstCommit).toBe(poster);
    expect(decoders).toHaveLength(1);
    expect(encode).toHaveBeenCalledOnce();
    await mount(`/uploads/imports/different-${sequence++}.mp4`);
    expect(host.querySelector("img")).toBeNull();
  });
  it("waits for actual pixels after seeked and accepts an opaque black frame", async () => {
    await mount(`/uploads/imports/delayed-${sequence++}.mp4`);
    await seek(decoders[0]);
    expect(encode).not.toHaveBeenCalled();
    expect(host.querySelector("img")).toBeNull();
    frameAvailable = true;
    await act(async () => vi.advanceTimersByTimeAsync(48));
    expect(host.querySelector("img")?.getAttribute("src")).toContain("data:image/webp");
    expect(decoders[0].hasAttribute("src")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares one valid extraction between the upload card and reference strip", async () => {
    await mount(`/uploads/imports/shared-${sequence++}.mp4`, 2);
    expect(decoders).toHaveLength(1);
    frameAvailable = true;
    await seek(decoders[0]);
    expect(host.querySelectorAll("img")).toHaveLength(2);
    expect(encode).toHaveBeenCalledOnce();
  });

  it("falls back after timeout and retries a failed extraction on remount", async () => {
    const src = `/uploads/imports/retry-${sequence++}.mp4`;
    await mount(src);
    await seek(decoders[0]);
    await act(async () => vi.advanceTimersByTimeAsync(4_100));
    expect(host.querySelector("[data-video-poster-fallback]")).not.toBeNull();
    expect(host.querySelector("img")).toBeNull();
    expect(decoders[0].hasAttribute("src")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => root.render(null));
    const decoderCount = decoders.length;
    await mount(src);
    expect(decoders).toHaveLength(decoderCount + 1);
    frameAvailable = true;
    await seek(decoders.at(-1)!);
    expect(host.querySelector("img")).not.toBeNull();
  });

  it("recovers an existing reference preview when it returns to view after a failure", async () => {
    await mount(`/uploads/imports/visible-again-${sequence++}.mp4`);
    await seek(decoders[0]);
    await act(async () => vi.advanceTimersByTimeAsync(4_100));
    expect(host.querySelector("[data-video-poster-fallback]")).not.toBeNull();
    const extractionCount = () => decoders.filter(video => !video.hasAttribute("data-video-poster-fallback")).length;
    const decoderCount = extractionCount();
    await act(async () => observeVisibility(false));
    await act(async () => observeVisibility(true));
    expect(extractionCount()).toBe(decoderCount + 1);
    frameAvailable = true;
    await seek(decoders.at(-1)!);
    expect(host.querySelector("img")).not.toBeNull();
    expect(host.querySelector("[data-video-poster-fallback]")).toBeNull();
  });
});
