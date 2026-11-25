// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CanvasSharedEdgeProvider, CanvasSharedEdgeLayer, CanvasSharedPassiveEdge } from "@/components/canvas/CanvasSharedPassiveEdges";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("shares one SVG for passive paths and preserves React Flow keyboard events and exact path updates", () => {
  const keyboard = vi.fn();
  const canvasRef = React.createRef<HTMLDivElement>();
  const render = (count: number, moved = false, share = true) => act(() => root.render(
    React.createElement("div", { ref: canvasRef }, React.createElement(CanvasSharedEdgeProvider, null,
      React.createElement("div", { className: "react-flow__edges" }, Array.from({ length: count }, (_, i) =>
        React.createElement("svg", { key: i }, React.createElement("g", { className: "react-flow__edge", onKeyDown: keyboard },
          React.createElement(CanvasSharedPassiveEdge, { id: `e${i}`, source: "a", target: "b", enabled: share,
            children: React.createElement("path", { d: moved ? `M${i} 0L20 20` : `M${i} 0L10 10`, "data-edge": i }) }))))),
      React.createElement(CanvasSharedEdgeLayer, { canvasRef }))),
  ));
  render(500);
  expect(host.querySelectorAll("[data-canvas-shared-passive-edges]")).toHaveLength(1);
  expect(host.querySelectorAll("[data-canvas-shared-passive-edges] path")).toHaveLength(500);
  expect(host.querySelectorAll(".react-flow__edges > svg > .react-flow__edge:empty")).toHaveLength(500);
  expect(host.querySelectorAll("svg g")).toHaveLength(500);
  const edge = host.querySelector('[data-canvas-shared-passive-edges] [data-id="e0"]')!;
  expect(edge.getAttribute("tabindex")).toBe("0");
  act(() => edge.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(keyboard).toHaveBeenCalledTimes(1);
  render(2, true);
  expect(host.querySelectorAll("path")).toHaveLength(2);
  expect(host.querySelector('[data-edge="0"]')?.getAttribute("d")).toBe("M0 0L20 20");
  render(2, true, false);
  expect(host.querySelectorAll("[data-canvas-shared-passive-edges] path")).toHaveLength(0);
  expect(host.querySelectorAll(".react-flow__edge path")).toHaveLength(2);
  act(() => root.render(null));
  expect(host.querySelector("svg")).toBeNull();
});

it("renders the original path when no shared layer is available", () => {
  act(() => root.render(React.createElement("svg", null, React.createElement(CanvasSharedPassiveEdge, {
    id: "fallback", source: "a", target: "b", enabled: true, children: React.createElement("path", { d: "M0 0L10 10" }),
  }))));
  expect(host.querySelector("path")?.getAttribute("d")).toBe("M0 0L10 10");
  expect(host.querySelector("[data-canvas-shared-passive-edge]")).toBeNull();
});
