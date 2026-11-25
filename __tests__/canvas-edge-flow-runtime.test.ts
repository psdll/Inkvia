import * as React from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  interacting: false,
  connecting: false,
  transform: [0, 0, 1],
  width: 1000,
  height: 800,
  nodeLookup: new Map(),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@xyflow/react")>(),
  useStore: (selector: (store: typeof state) => unknown) => selector(state),
}));
vi.mock("@/components/canvas/CanvasRenderRuntime", () => ({
  useCanvasInteracting: () => state.interacting,
  CanvasDeferredNode: () => null,
  CanvasRenderRuntimeProvider: ({ children }: any) => children,
}));
import { Position } from "@xyflow/react";
import { CanvasConnectionDragContext, CanvasDefaultEdge, CanvasEdgeFlowSegments, CanvasConnectionPreviewPath, CanvasConnectionMenuPreview } from "@/components/canvas/SmartCanvasBoard";

let host: HTMLDivElement;
let root: Root;
let frameCallbacks: Map<number, FrameRequestCallback>;
let pathRef: React.RefObject<SVGPathElement>;
let offset: number;
let length: number;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.interacting = false;
  state.connecting = false;
  state.transform = [0, 0, 1];
  state.nodeLookup = new Map([
    ["source", { internals: { positionAbsolute: { x: -20_000, y: 100 } }, measured: { width: 100, height: 100 } }],
    ["target", { internals: { positionAbsolute: { x: 20_000, y: 100 } }, measured: { width: 100, height: 100 } }],
  ]);
  offset = 0;
  length = 100;
  frameCallbacks = new Map();
  let nextId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frameCallbacks.set(++nextId, callback); return nextId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frameCallbacks.delete(id));
  const source = document.createElementNS("http://www.w3.org/2000/svg", "path");
  source.getTotalLength = () => length;
  source.getPointAtLength = (x: number) => ({ x, y: offset } as DOMPoint);
  pathRef = { current: source };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  expect(frameCallbacks.size).toBe(0);
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function render(path: string) {
  act(() => root.render(React.createElement("svg", null, React.createElement(CanvasEdgeFlowSegments, { edgeId: "preview", path }))));
}

it("removes the old flow fragments when viewport movement pauses animation and restores only current geometry", () => {
  render("M 0 0 L 100 0");
  expect(host.querySelectorAll(".canvas-edge-related-flow")).toHaveLength(1);
  state.interacting = true;
  offset = 200;
  render("M 0 200 L 100 200");
  expect(host.querySelectorAll(".canvas-edge-related-flow")).toHaveLength(0);
  expect(frameCallbacks.size).toBe(0);
  offset = 400;
  render("M 0 400 L 100 400");
  expect(host.querySelectorAll(".canvas-edge-related-flow")).toHaveLength(0);
  state.interacting = false;
  render("M 0 400 L 100 400");
  const paths = Array.from(host.querySelectorAll(".canvas-edge-related-flow > path"));
  // Soft halo, tail and head of the travelling comet.
  expect(paths).toHaveLength(3);
  paths.forEach(path => expect(path.getAttribute("d")).toBe("M 0 400 L 100 400"));
  expect(frameCallbacks.size).toBe(0);
});

it("clears glow when the new path is empty", () => {
  render("M 0 0 L 100 0");
  expect(host.querySelectorAll(".canvas-edge-related-flow")).toHaveLength(1);
  length = 0;
  render("");
  expect(host.querySelectorAll(".canvas-edge-related-flow")).toHaveLength(0);
});

function renderCrossingEdge(hovered: boolean) {
  act(() => root.render(React.createElement(CanvasConnectionDragContext.Provider, { value: state.connecting }, React.createElement("svg", null, React.createElement(CanvasDefaultEdge, {
    id: "crossing", source: "source", target: "target",
    sourceX: -20_000, sourceY: 200, sourcePosition: Position.Right,
    targetX: 20_000, targetY: 200, targetPosition: Position.Left,
    data: { hovered }, animated: hovered,
  })))));
}

function attachCrossingGeometry() {
  const hit = host.querySelector<SVGPathElement>("[data-canvas-edge-cut-hit-area]")!;
  expect(hit).not.toBeNull();
  hit.getTotalLength = () => 40_000;
  hit.getPointAtLength = (distance) => ({ x: distance - 20_000, y: 200 } as DOMPoint);
  hit.getScreenCTM = () => ({ inverse: () => ({}) } as DOMMatrix);
  hit.ownerSVGElement!.createSVGPoint = () => ({
    x: 0, y: 0,
    matrixTransform() { return { x: this.x / state.transform[2], y: this.y / state.transform[2] }; },
  } as DOMPoint);
  return hit;
}

it.each([.1, .5, 2])("uses the same base and flow for single and multiple previews at zoom %s", zoom => {
  state.transform[2] = zoom;
  act(() => root.render(React.createElement("svg", null,
    ...[false, true].map((multiSelection, i) => React.createElement(CanvasConnectionPreviewPath, {
      key: i, edgeId: `preview-${i}`, path: "M 0 0 C 100 0 100 100 200 100", invalid: false, multiSelection,
    })),
  )));
  const bases = Array.from(host.querySelectorAll(".canvas-connection-preview-base"));
  expect(bases).toHaveLength(2);
  bases.forEach(base => {
    expect(base.getAttribute("stroke-width")).toBe("2");
    expect(base.getAttribute("stroke")).toBe("var(--canvas-edge-related)");
    expect((base as SVGElement).style.filter).toBe("");
    expect((base.parentElement as unknown as SVGElement).style.getPropertyValue("--canvas-edge-unit")).toBe(`${1 / Math.max(1, zoom)}px`);
  });
  expect(host.querySelectorAll("[data-edge-flow]")).toHaveLength(2);
  expect(host.querySelector('[stroke-width="6"]')).toBeNull();
});

it.each([.1, .5, 2])("keeps menu preview weight equal to completed edges at zoom %s", zoom => {
  act(() => root.render(React.createElement(CanvasConnectionMenuPreview, { menu: {
    from: [{ x: 0, y: 0 }, { x: 0, y: 100 }], to: { x: 200, y: 50 }, fromPosition: Position.Right, zoom,
  } as any })));
  const bases = Array.from(host.querySelectorAll(".canvas-connection-preview-base"));
  expect(bases).toHaveLength(2);
  bases.forEach(base => {
    expect((base as SVGElement).style.strokeWidth).toBe(String(2 * Math.min(zoom, 1)));
    expect(base.getAttribute("stroke")).toBe("var(--canvas-edge-related)");
    expect((base as SVGElement).style.filter).toBe("");
  });
  const flows = Array.from(host.querySelectorAll('[data-edge-flow]'));
  expect(flows).toHaveLength(2);
  flows.forEach((flow, index) => {
    expect((flow.parentElement as unknown as SVGElement).style.getPropertyValue('--canvas-edge-unit')).toBe(`${Math.min(zoom, 1)}px`);
    expect(flow.querySelector('path')?.getAttribute('d')).toBe(bases[index].getAttribute('d'));
  });
  act(() => root.render(null));
  expect(host.querySelector('[data-edge-flow]')).toBeNull();
});

it("keeps edge geometry visible without rebuilding interaction controls while shrinking", () => {
  renderCrossingEdge(false);
  const passive = host.querySelector('[data-canvas-edge-passive]');
  expect(passive).not.toBeNull();
  state.interacting = true;
  state.nodeLookup.get("source").internals.positionAbsolute.x = 100;
  for (const zoom of [.5, .2, .1]) {
    state.transform[2] = zoom;
    renderCrossingEdge(false);
    expect(host.querySelector('[data-canvas-edge-passive]')).toBe(passive);
    expect(host.querySelector('[data-canvas-edge-cut-hit-area]')).toBeNull();
  }
  state.interacting = false;
  renderCrossingEdge(false);
  const hit = host.querySelector('[data-canvas-edge-cut-hit-area]');
  expect(hit).not.toBeNull();
  state.interacting = true;
  state.nodeLookup.get("source").internals.positionAbsolute.x = -20_000;
  renderCrossingEdge(false);
  expect(host.querySelector('[data-canvas-edge-cut-hit-area]')).toBe(hit);
  state.interacting = false;
  renderCrossingEdge(false);
  expect(host.querySelector('[data-canvas-edge-passive]')).not.toBeNull();
});

it("restores selected-node edge flow after viewport interaction ends", () => {
  state.nodeLookup.get("source").internals.positionAbsolute.x = 100;
  renderCrossingEdge(true);
  expect(host.querySelector('[data-edge-flow="crossing"]')).not.toBeNull();
  state.interacting = true;
  renderCrossingEdge(true);
  expect(host.querySelector('[data-edge-flow="crossing"]')).toBeNull();
  state.interacting = false;
  renderCrossingEdge(true);
  expect(host.querySelector('[data-edge-flow="crossing"]')).not.toBeNull();
});

it.each([0.1, 1, 2])("lights an edge with a visible endpoint immediately at zoom %s", (zoom) => {
  state.nodeLookup.get("source").internals.positionAbsolute.x = 100;
  state.transform[2] = zoom;
  renderCrossingEdge(false);
  const hit = attachCrossingGeometry();
  expect(hit.getAttribute("pointer-events")).toBe("stroke");
  expect(hit.style.strokeDasharray).toBe("none");
  expect(hit.style.animation).toBe("none");
  expect(host.querySelector(".react-flow__edge-interaction")).toBeNull();
  expect(host.querySelectorAll(".canvas-edge-related-flow")).toHaveLength(0);
  renderCrossingEdge(true);
  expect(host.querySelectorAll(".canvas-edge-related-flow")).toHaveLength(1);
  renderCrossingEdge(false);
  expect(host.querySelectorAll(".canvas-edge-related-flow")).toHaveLength(0);
  expect(frameCallbacks.size).toBe(0);
});

it("shows visible-endpoint scissors after 1000 ms and cancels them when the pointer leaves", () => {
  vi.useFakeTimers();
  state.nodeLookup.get("source").internals.positionAbsolute.x = 100;
  renderCrossingEdge(false);
  const hit = attachCrossingGeometry();
  renderCrossingEdge(true);
  act(() => hit.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, clientX: 500, clientY: 200 })));
  act(() => { const frames = [...frameCallbacks.values()]; frameCallbacks.clear(); frames.forEach(callback => callback(16)); });
  act(() => vi.advanceTimersByTime(999));
  expect(host.querySelector("foreignObject")?.getAttribute("style")).toContain("opacity: 0");
  act(() => vi.advanceTimersByTime(1));
  expect(host.querySelector("foreignObject")?.getAttribute("style")).toContain("opacity: 1");
  act(() => hit.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body })));
  renderCrossingEdge(false);
  act(() => vi.advanceTimersByTime(270));
  expect(host.querySelector("[data-canvas-edge-cut-button]")).toBeNull();
  expect(host.querySelectorAll(".canvas-edge-related-flow")).toHaveLength(0);
});

it("clears crossing-edge hover effects and pending scissors when panning starts", () => {
  vi.useFakeTimers();
  state.nodeLookup.get("source").internals.positionAbsolute.x = 100;
  renderCrossingEdge(false);
  const hit = attachCrossingGeometry();
  renderCrossingEdge(true);
  act(() => hit.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, clientX: 500, clientY: 200 })));
  act(() => vi.advanceTimersByTime(250));
  state.interacting = true;
  renderCrossingEdge(true);
  act(() => vi.advanceTimersByTime(500));
  expect(host.querySelectorAll(".canvas-edge-related-flow")).toHaveLength(0);
  expect(host.querySelector("[data-canvas-edge-cut-button]")).toBeNull();
  expect(hit.getAttribute("pointer-events")).toBe("none");
  expect(frameCallbacks.size).toBe(0);
});

it("ignores crossing an idle edge throughout a connection drag and restores hover after release", () => {
  vi.useFakeTimers();
  state.nodeLookup.get("source").internals.positionAbsolute.x = 100;
  renderCrossingEdge(false);
  const hit = attachCrossingGeometry();
  state.connecting = true;
  renderCrossingEdge(false);
  act(() => {
    hit.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, clientX: 500, clientY: 200 }));
    hit.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 520, clientY: 200 }));
    vi.advanceTimersByTime(1500);
  });
  expect(hit.getAttribute("pointer-events")).toBe("none");
  expect(host.querySelector(".canvas-edge-hovered")).toBeNull();
  expect(host.querySelector("[data-canvas-edge-cut-button]")).toBeNull();
  expect(frameCallbacks.size).toBe(0);
  state.connecting = false;
  renderCrossingEdge(false);
  act(() => hit.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, clientX: 500, clientY: 200 })));
  act(() => { const frames = [...frameCallbacks.values()]; frameCallbacks.clear(); frames.forEach(callback => callback(16)); });
  act(() => vi.advanceTimersByTime(1000));
  expect(hit.getAttribute("pointer-events")).toBe("stroke");
  expect(host.querySelector(".canvas-edge-hovered")).not.toBeNull();
  expect(host.querySelector("foreignObject")?.getAttribute("style")).toContain("opacity: 1");
});

it.each([250, 1000])("clears pending or visible scissors when a connection drag begins after %s ms", delay => {
  vi.useFakeTimers();
  state.nodeLookup.get("source").internals.positionAbsolute.x = 100;
  renderCrossingEdge(false);
  const hit = attachCrossingGeometry();
  act(() => hit.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, clientX: 500, clientY: 200 })));
  act(() => { const frames = [...frameCallbacks.values()]; frameCallbacks.clear(); frames.forEach(callback => callback(16)); });
  act(() => vi.advanceTimersByTime(delay));
  state.connecting = true;
  renderCrossingEdge(false);
  act(() => vi.advanceTimersByTime(1500));
  expect(host.querySelector(".canvas-edge-hovered")).toBeNull();
  expect(host.querySelector("[data-canvas-edge-cut-button]")).toBeNull();
  expect(hit.getAttribute("pointer-events")).toBe("none");
  expect(frameCallbacks.size).toBe(0);
});

it.each([0.1, 1, 2])("keeps crossing lines passive when both endpoints are outside at zoom %s", (zoom) => {
  state.transform[2] = zoom;
  renderCrossingEdge(true);
  expect(host.querySelector("[data-canvas-edge-passive]")?.getAttribute("pointer-events")).toBe("none");
  expect(host.querySelector("[data-canvas-edge-cut-hit-area]")).toBeNull();
  expect(host.querySelectorAll(".canvas-edge-related-flow")).toHaveLength(0);
  expect(frameCallbacks.size).toBe(0);
});

it("unmounts hover work when the last endpoint leaves and restores it on return", () => {
  vi.useFakeTimers();
  state.nodeLookup.get("source").internals.positionAbsolute.x = 100;
  renderCrossingEdge(false);
  const hit = attachCrossingGeometry();
  renderCrossingEdge(true);
  act(() => hit.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, clientX: 500, clientY: 200 })));
  state.nodeLookup.get("source").internals.positionAbsolute.x = -20_000;
  renderCrossingEdge(true);
  act(() => vi.advanceTimersByTime(1500));
  expect(host.querySelector("[data-canvas-edge-cut-button]")).toBeNull();
  expect(host.querySelector("[data-canvas-edge-cut-hit-area]")).toBeNull();
  expect(frameCallbacks.size).toBe(0);
  state.nodeLookup.get("source").internals.positionAbsolute.x = 100;
  renderCrossingEdge(false);
  expect(host.querySelector("[data-canvas-edge-cut-hit-area]")).not.toBeNull();
});

it("does not cancel the cut timer when the parent hover flag arrives after the pointer frame", () => {
  vi.useFakeTimers();
  state.nodeLookup.get("source").internals.positionAbsolute.x = 100;
  renderCrossingEdge(false);
  const hit = attachCrossingGeometry();
  act(() => hit.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, clientX: 500, clientY: 200 })));
  act(() => { const frames = [...frameCallbacks.values()]; frameCallbacks.clear(); frames.forEach(callback => callback(16)); });
  act(() => vi.advanceTimersByTime(80));
  renderCrossingEdge(true);
  act(() => vi.advanceTimersByTime(920));
  expect(host.querySelector("foreignObject")?.getAttribute("style")).toContain("opacity: 1");
});

it("handles hover locally and keeps it while entering scissors without a parent update", () => {
  vi.useFakeTimers();
  state.nodeLookup.get("source").internals.positionAbsolute.x = 100;
  renderCrossingEdge(false);
  const hit = attachCrossingGeometry();
  act(() => hit.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, clientX: 500, clientY: 200 })));
  expect(host.querySelector(".canvas-edge-hovered")).not.toBeNull();
  expect(host.querySelector("[data-canvas-edge-cut-hit-area]")).not.toBeNull();
  act(() => { const frames = [...frameCallbacks.values()]; frameCallbacks.clear(); frames.forEach(callback => callback(16)); });
  act(() => vi.advanceTimersByTime(1000));
  const button = host.querySelector("[data-canvas-edge-cut-button]")!;
  act(() => {
    hit.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: button }));
    button.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, relatedTarget: hit }));
  });
  act(() => vi.advanceTimersByTime(150));
  expect(host.querySelector("foreignObject")?.getAttribute("style")).toContain("opacity: 1");
  expect(host.querySelector(".canvas-edge-hovered")).not.toBeNull();
  act(() => button.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body })));
  expect(host.querySelector(".canvas-edge-hovered")).toBeNull();
  expect(host.querySelector(".canvas-edge-related-flow")).toBeNull();
  act(() => vi.advanceTimersByTime(270));
  expect(host.querySelector("[data-canvas-edge-cut-button]")).toBeNull();
});

it("keeps a selected-related crossing line solid when zoom moves both endpoints offscreen", () => {
  // Use the installed framework rule: an animated edge applies dashdraw to every
  // descendant path, including our simplified line unless it explicitly opts out.
  const css = readFileSync("node_modules/@xyflow/react/dist/style.css", "utf8");
  const rule = css.match(/\.react-flow__edge\.animated path\s*\{[^}]*\}/)?.[0];
  expect(rule).toBeTruthy();
  const stylesheet = document.createElement("style");
  stylesheet.textContent = rule!;
  document.head.append(stylesheet);
  const draw = () => act(() => root.render(React.createElement("svg", null,
    React.createElement("g", { className: "react-flow__edge canvas-edge-related animated" },
      React.createElement(CanvasDefaultEdge, {
        id: "crossing", source: "source", target: "target",
        sourceX: -20_000, sourceY: 200, sourcePosition: Position.Right,
        targetX: 20_000, targetY: 200, targetPosition: Position.Left,
        animated: true, style: { stroke: "rgb(180, 190, 200)", opacity: .8 },
      })))));
  try {
    state.nodeLookup.get("source").internals.positionAbsolute.x = 100;
    draw();
    expect(host.querySelector("[data-canvas-edge-cut-hit-area]")).not.toBeNull();
    state.nodeLookup.get("source").internals.positionAbsolute.x = -20_000;
    draw();
    const path = host.querySelector<SVGPathElement>("[data-canvas-edge-passive]")!;
    expect(path).not.toBeNull();
    expect(getComputedStyle(path).animation).toBe("none");
    expect(getComputedStyle(path).strokeDasharray).toBe("none");
    expect(path.style.stroke).toBe("rgb(180, 190, 200)");
    expect(path.style.opacity).toBe("0.8");
    expect(host.querySelector("[data-canvas-edge-cut-hit-area]")).toBeNull();
    state.nodeLookup.get("source").internals.positionAbsolute.x = 100;
    draw();
    expect(host.querySelector("[data-canvas-edge-passive]")).toBeNull();
    expect(host.querySelector("[data-canvas-edge-cut-hit-area]")).not.toBeNull();
  } finally {
    stylesheet.remove();
  }
});
