// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import {
  CanvasEdgeFlowLayer,
  CanvasEdgeFlowRegistryContext,
  createCanvasEdgeFlowRegistry,
  getCanvasEdgeFlowDash,
  getCanvasEdgeFlowOffset,
  useCanvasEdgeFlowRegistration,
} from "@/components/canvas/CanvasEdgeFlowLayer";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

function Edge({ id, path, active }: { id: string; path: string; active: boolean }) {
  useCanvasEdgeFlowRegistration(id, path, active);
  return null;
}

describe("shared canvas edge flow layer", () => {
  it("scales the 300-unit comet to the real curve length, like pathLength on the SVG flow", () => {
    expect(getCanvasEdgeFlowDash([36, 64], 600)).toEqual([72, 128]);
    expect(getCanvasEdgeFlowDash([0, 24, 12, 64], 150)).toEqual([0, 12, 6, 32]);
  });

  it("moves the comet toward the target and loops every three seconds", () => {
    expect(getCanvasEdgeFlowOffset(0, 900)).toBeCloseTo(0);
    expect(getCanvasEdgeFlowOffset(1500, 900)).toBeCloseTo(-450);
    expect(getCanvasEdgeFlowOffset(4500, 900)).toBeCloseTo(-450);
  });

  it("updates a dragged edge's geometry without unregistering it every frame", () => {
    const registry = createCanvasEdgeFlowRegistry();
    const changes = vi.fn();
    registry.subscribe(() => changes(registry.paths().size));
    const view = (path: string, active = true) => React.createElement(CanvasEdgeFlowRegistryContext.Provider, { value: registry },
      React.createElement(Edge, { id: "edge", path, active }));
    act(() => root.render(view("M 0 0 L 100 0")));
    expect([...registry.paths()]).toEqual([["edge", "M 0 0 L 100 0"]]);
    changes.mockClear();
    for (let x = 1; x <= 30; x++) act(() => root.render(view(`M ${x} 0 L 100 0`)));
    // Every notification keeps the flow registered: the layer never restarts mid-drag.
    expect(changes.mock.calls.every(([size]) => size === 1)).toBe(true);
    expect(registry.paths().get("edge")).toBe("M 30 0 L 100 0");
    act(() => root.render(view("M 30 0 L 100 0", false)));
    expect(registry.paths().size).toBe(0);
  });

  it("leaves the SVG fallback to edges rendered without a board layer", () => {
    let shared: boolean | null = null;
    function Probe() { shared = useCanvasEdgeFlowRegistration("edge", "M 0 0 L 1 0", true); return null; }
    act(() => root.render(React.createElement(Probe)));
    expect(shared).toBe(false);
  });

  it("applies a new highlight colour on the very next frame", async () => {
    const strokes: string[] = [];
    const context = {
      setTransform() {}, clearRect() {}, setLineDash() {}, stroke() { strokes.push(String(this.strokeStyle)); },
      strokeStyle: "", globalAlpha: 1, lineWidth: 1, lineCap: "butt", lineDashOffset: 0,
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as any);
    (globalThis as any).Path2D = class {};
    (SVGElement.prototype as any).getTotalLength = () => 300;
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const registry = createCanvasEdgeFlowRegistry();
    registry.set("edge", "M 0 0 L 300 0");
    function Size() {
      const store = useStoreApi();
      React.useLayoutEffect(() => { store.setState({ width: 800, height: 600, transform: [0, 0, 1] }); }, [store]);
      return null;
    }
    // React Flow's label layer is where the board portals the flow canvas.
    host.className = "react-flow";
    const label = document.createElement("div");
    label.className = "react-flow__edgelabel-renderer";
    host.append(label);
    const mountPoint = document.createElement("div");
    host.append(mountPoint);
    const flowRoot = createRoot(mountPoint);
    await act(async () => flowRoot.render(React.createElement(ReactFlowProvider, null,
      React.createElement(CanvasEdgeFlowRegistryContext.Provider, { value: registry },
        React.createElement(Size), React.createElement(CanvasEdgeFlowLayer, { paused: false })))));
    // jsdom does not inherit custom properties; browsers inherit them from the canvas wrapper.
    const flowCanvas = host.querySelector<HTMLCanvasElement>("[data-canvas-edge-flow-layer]")!;
    flowCanvas.style.setProperty("--canvas-edge-flow", "#ff0000");
    await act(async () => { frames.splice(0).forEach(frame => frame(16)); });
    expect(strokes.at(-1)).toBe("#ff0000");
    flowCanvas.style.setProperty("--canvas-edge-flow", "#00ff00");
    await act(async () => { frames.splice(0).forEach(frame => frame(32)); });
    expect(strokes.at(-1)).toBe("#00ff00");
    act(() => flowRoot.unmount());
    vi.restoreAllMocks();
  });
});
