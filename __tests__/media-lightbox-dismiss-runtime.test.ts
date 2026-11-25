// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaLightbox } from "@/components/ui/media-lightbox";

vi.mock("@/components/ui/resilient-image", () => ({ ResilientImage: () => React.createElement("img", { alt: "预览图片" }) }));
vi.mock("@/components/ui/app-video-player", () => ({ AppVideoPlayer: () => null }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("media preview outside dismissal", () => {
  it.each(["floating", "content", "material-detail"] as const)("dismisses %s only for a click that starts and ends outside", layout => {
    const close = vi.fn();
    act(() => root.render(React.createElement(MediaLightbox, { open: true, src: "/test.png", kind: "image", layout, onClose: close })));
    const backdrop = document.querySelector("[data-media-lightbox-backdrop]")!;
    const zoom = document.querySelector('[aria-label="放大"]')!;
    act(() => { Simulate.pointerDown(zoom); Simulate.click(zoom); });
    expect(document.body.textContent).toContain("125%");
    expect(close).not.toHaveBeenCalled();
    act(() => { Simulate.pointerDown(zoom); Simulate.click(backdrop); });
    expect(close).not.toHaveBeenCalled();
    act(() => { Simulate.pointerDown(backdrop); Simulate.click(backdrop); });
    expect(close).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("100%");
  });
});
