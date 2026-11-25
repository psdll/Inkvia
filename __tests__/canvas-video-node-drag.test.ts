import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasNodeCard } from "@/components/canvas/CanvasNodeCard";

vi.mock("@/components/canvas/use-canvas-models", () => ({ useCanvasModels: () => null }));

describe("video node drag surfaces", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
      async decode() {}
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it.each(["video", "videoTask"] as const)("allows dragging the %s picture while keeping playback controls isolated", async (kind) => {
    await act(async () => root.render(React.createElement(ReactFlowProvider, null,
      React.createElement(CanvasNodeCard, {
        id: "video", type: kind,
        data: kind === "video"
          ? { kind, url: "/video.mp4", posterUrl: "/poster.png" }
          : { kind, model: "", prompt: "", mediaPaths: [], status: "success", outputUrl: "/video.mp4", variants: { poster: { url: "/poster.png" } } },
        selected: false, dragging: false, isConnectable: true, zIndex: 0,
        draggable: true, selectable: true, deletable: true, positionAbsoluteX: 0, positionAbsoluteY: 0,
      }),
    )));
    const poster = host.querySelector<HTMLImageElement>("[data-canvas-video-poster]")!;
    expect(host.querySelector("[data-canvas-video-controls]")).toBeNull();
    // Playback controls mount when the pointer reaches the player.
    await act(async () => { host.querySelector(".group\\/video")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })); });
    const progress = host.querySelector<HTMLInputElement>('[aria-label="视频进度"]')!;
    expect(poster).not.toBeNull();
    expect(poster.closest(".nodrag")).toBeNull();
    expect(progress.closest(".nodrag")).not.toBeNull();
    // React Flow rejects wheel events if any ancestor has `nowheel`.
    // Video surfaces and their controls must keep scrolling the shared canvas.
    expect(poster.closest(".nowheel")).toBeNull();
    expect(progress.closest(".nowheel")).toBeNull();
    const bubbledWheel = vi.fn();
    document.addEventListener("wheel", bubbledWheel);
    try {
      act(() => {
        poster.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 }));
        progress.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120 }));
      });
      expect(bubbledWheel).toHaveBeenCalledTimes(2);
      expect(bubbledWheel.mock.calls.map(([event]) => event.defaultPrevented)).toEqual([false, false]);
    } finally { document.removeEventListener("wheel", bubbledWheel); }
    const bubbledPointerDown = vi.fn();
    document.addEventListener("pointerdown", bubbledPointerDown);
    act(() => { poster.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); });
    act(() => { progress.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); });
    document.removeEventListener("pointerdown", bubbledPointerDown);
    expect(bubbledPointerDown).toHaveBeenCalledTimes(1);
    expect(bubbledPointerDown.mock.calls[0][0].target).toBe(poster);
  });
});
