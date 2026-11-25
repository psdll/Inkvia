import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasNodeCard } from "@/components/canvas/CanvasNodeCard";

vi.mock("@/components/canvas/use-canvas-models", () => ({ useCanvasModels: () => null }));

describe("canvas image load errors", () => {
  let container: HTMLDivElement;
  let root: Root;
  let missing: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
      async decode() {}
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    missing = vi.fn();
    window.addEventListener("canvas-media-missing", missing);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.removeEventListener("canvas-media-missing", missing);
    vi.unstubAllGlobals();
  });

  it("keeps both nodes and emits no deletion request when their shared image fails to load", async () => {
    await act(async () => root.render(React.createElement(ReactFlowProvider, null,
      ...["original", "copy"].map((id) => React.createElement(CanvasNodeCard, {
        key: id, id, type: "image", data: { kind: "image", url: "/uploads/canvas_imports/shared.png" },
        selected: false, dragging: false, isConnectable: true, zIndex: 0,
        draggable: true, selectable: true, deletable: true, positionAbsoluteX: 0, positionAbsoluteY: 0,
      })),
    )));
    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(2);

    act(() => { images[0].dispatchEvent(new Event("error")); });

    expect(missing).not.toHaveBeenCalled();
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });
});
