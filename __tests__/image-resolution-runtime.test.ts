import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageResolution } from "@/components/ui/image-resolution";
import { CanvasBoard } from "@/components/ui/canvas-board";

class SourceImage {
  static instances: SourceImage[] = [];
  src = "";
  decoding = "";
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { SourceImage.instances.push(this); }
  load(width: number, height: number) {
    this.naturalWidth = width;
    this.naturalHeight = height;
    act(() => this.onload?.());
  }
}

let host: HTMLDivElement;
let root: Root;
const label = () => host.querySelector("[data-image-resolution]")?.textContent;
beforeEach(() => {
  SourceImage.instances = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Image", SourceImage);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("original image resolution", () => {
  it.each(["pending", "failed"])("keeps the available thumbnail visible when the large image is %s", (state) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 1000, height: 600 } as DOMRect);
    act(() => root.render(React.createElement(CanvasBoard, {
      src: "/large-preview.webp", showLoadingIndicator: false,
      preview: React.createElement("img", { src: "/cached-thumbnail.webp", alt: "available thumbnail" }),
    })));
    const thumbnail = host.querySelector('[data-canvas-image-preview] img');
    const primary = host.querySelector<HTMLImageElement>('img[src="/large-preview.webp"]')!;
    if (state === "failed") act(() => primary.dispatchEvent(new Event("error")));
    expect(thumbnail?.getAttribute("src")).toBe("/cached-thumbnail.webp");
    expect(host.querySelector("[data-canvas-image-loading]")).toBeNull();
    expect(host.textContent).not.toContain("图片暂时无法显示");
    expect(host.textContent).not.toContain("600%");
    Object.defineProperties(primary, { naturalWidth: { value: 1280 }, naturalHeight: { value: 720 } });
    act(() => primary.dispatchEvent(new Event("load")));
    expect(host.querySelector("[data-canvas-image-preview]")).toBeNull();
    expect(primary.closest(".opacity-0")).toBeNull();
  });

  it("keeps the original dimensions while displaying a preview and zooming to the original", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 1000, height: 600 } as DOMRect);
    act(() => root.render(React.createElement(CanvasBoard, { src: "/preview.webp", originalSrc: "/original.png" })));
    const preview = host.querySelector("img")!;
    Object.defineProperties(preview, { naturalWidth: { value: 1280 }, naturalHeight: { value: 720 } });
    act(() => preview.dispatchEvent(new Event("load")));
    expect(label()).toBeUndefined();
    expect(SourceImage.instances[0].src).toBe("/original.png");
    SourceImage.instances[0].load(2560, 1440);
    expect(label()).toBe("2560 × 1440");
    expect(preview.getAttribute("src")).toBe("/preview.webp");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="放大"]')!.click());
    expect(label()).toBe("2560 × 1440");
    SourceImage.instances[1].load(2560, 1440);
    expect(preview.getAttribute("src")).toBe("/original.png");
    act(() => preview.dispatchEvent(new Event("load")));
    expect(label()).toBe("2560 × 1440");
  });

  it("uses recorded frame dimensions without loading the original again", () => {
    act(() => root.render(React.createElement(ImageResolution, { src: "/frame.png", dimensions: { width: 2560, height: 1440 } })));
    expect(label()).toBe("2560 × 1440");
    expect(SourceImage.instances).toHaveLength(0);
  });

  it("clears the previous dimensions and ignores late loads when switching images", () => {
    const render = (src: string) => act(() => root.render(React.createElement(ImageResolution, { src })));
    render("/first.png");
    const first = SourceImage.instances[0];
    const lateLoad = first.onload!;
    first.load(2560, 1440);
    expect(label()).toBe("2560 × 1440");
    render("/second.png");
    expect(label()).toBeUndefined();
    act(() => lateLoad());
    expect(label()).toBeUndefined();
    SourceImage.instances[1].load(1024, 1536);
    expect(label()).toBe("1024 × 1536");
  });

  it("removes CDN preview resizing and falls back to the remote original if its proxy fails", () => {
    act(() => root.render(React.createElement(ImageResolution, { src: "https://example.com/image.png?x-oss-process=image/resize,w_600" })));
    const image = SourceImage.instances[0];
    expect(image.src).toBe("/api/media-proxy?url=https%3A%2F%2Fexample.com%2Fimage.png");
    act(() => image.onerror?.());
    expect(image.src).toBe("https://example.com/image.png");
    image.load(4096, 2304);
    expect(label()).toBe("4096 × 2304");
  });

  it("does not show invalid dimensions or invent a size when the original fails to load", () => {
    act(() => root.render(React.createElement(ImageResolution, { src: "/failed.png", dimensions: { width: 0, height: NaN } })));
    const image = SourceImage.instances[0];
    image.load(0, 0);
    act(() => image.onerror?.());
    expect(label()).toBeUndefined();
  });

  it("resolves the dimensions of each image independently in a series", () => {
    act(() => root.render(React.createElement(React.Fragment, null,
      React.createElement(ImageResolution, { src: "/landscape.png" }),
      React.createElement(ImageResolution, { src: "/portrait.png" }),
    )));
    SourceImage.instances[1].load(1440, 2560);
    SourceImage.instances[0].load(2560, 1440);
    expect([...host.querySelectorAll("[data-image-resolution]")].map(el => el.textContent)).toEqual(["2560 × 1440", "1440 × 2560"]);
  });
});
