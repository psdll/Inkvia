/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HoverPreviewVideo } from "@/components/ui/hover-preview-video";

let host: HTMLDivElement;
let root: Root;
let observers: Array<{ notify: (visible: boolean) => void; disconnect: ReturnType<typeof vi.fn> }>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  observers = [];
  vi.stubGlobal("IntersectionObserver", class {
    disconnect = vi.fn();
    constructor(callback: IntersectionObserverCallback) {
      observers.push({ notify: visible => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver), disconnect: this.disconnect });
    }
    observe() {}
    unobserve() {}
  });
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockResolvedValue();
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

const render = async (props: React.ComponentProps<typeof HoverPreviewVideo>) => {
  await act(async () => root.render(React.createElement(HoverPreviewVideo, { eager: true, deferFallback: true, ...props })));
};
const failPoster = async () => { await act(async () => Simulate.error(host.querySelector("img")!)); };
const visibility = async (visible: boolean) => { await act(async () => observers.at(-1)!.notify(visible)); };

it("retries a failed poster and uses the next cover without loading a video", async () => {
  await render({ src: "/clip.mp4", posterSrc: "/broken.webp", posterCandidates: ["/broken.webp", "/backup.webp"] });
  await failPoster();
  expect(host.querySelector("img")!.getAttribute("src")).toContain("_r=1");
  await failPoster();
  expect(host.querySelector("img")!.getAttribute("src")).toBe("/backup.webp");
  expect(host.querySelector("video")).toBeNull();
  expect(host.textContent).not.toContain("悬停预览");
});

it("loads a static video frame only while a card with exhausted covers is visible", async () => {
  await render({ src: "/fallback.mp4#old", posterSrc: "/unavailable.webp" });
  await failPoster();
  await failPoster();
  expect(host.querySelector("video")).toBeNull();
  await visibility(true);
  const video = host.querySelector("video")!;
  expect(video.getAttribute("src")).toBe("/fallback.mp4#t=0.1");
  expect(video.preload).toBe("metadata");
  expect(video.autoplay).toBe(false);
  expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  await visibility(false);
  expect(host.querySelector("video")).toBeNull();
});

it("recovers missing covers without hover and resets failure when switching assets", async () => {
  await render({ src: "/missing-cover.mp4" });
  await visibility(true);
  expect(host.querySelector("video")).not.toBeNull();
  await act(async () => Simulate.error(host.querySelector("video")!));
  expect(host.textContent).toContain("视频预览暂不可用");
  await render({ src: "/next.mp4", posterSrc: "/next.webp" });
  expect(host.querySelector("img")!.getAttribute("src")).toBe("/next.webp");
  expect(host.textContent).not.toContain("视频预览暂不可用");
  expect(host.querySelector("video")).toBeNull();
});

it("keeps healthy covers lightweight and retains hover playback", async () => {
  await render({ src: "/healthy.mp4", posterSrc: "/healthy.webp" });
  expect(host.querySelector("video")).toBeNull();
  await act(async () => Simulate.mouseEnter(host.firstElementChild!));
  expect(host.querySelector("video")!.getAttribute("src")).toBe("/healthy.mp4");
  expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  await act(async () => Simulate.mouseLeave(host.firstElementChild!));
  expect(host.querySelector("video")).toBeNull();
  expect(host.querySelector("img")).not.toBeNull();
});
