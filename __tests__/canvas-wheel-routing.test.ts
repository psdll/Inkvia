// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanOnScrollMode, XYPanZoom } from "@xyflow/system";
import { CANVAS_WHEEL_ZOOM_STEP as STEP, getCanvasWheelZoomViewport } from "@/lib/canvas/wheel-zoom";

// Run the actual native capture handler against DOM wheel events.
const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");
const start = board.indexOf("const preventPageZoom =");
const source = board.slice(start, board.indexOf('window.addEventListener("keydown", modifier', start));
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const factory = new Function("surface", "flow", "flowStore", "canvasInteractionLocked", "getCanvasWheelZoomViewport", `${compiled}; return preventPageZoom;`);
const createHandler = (surface: HTMLElement, flow?: unknown, store?: unknown, locked = false) => factory(surface, flow, store, locked, getCanvasWheelZoomViewport) as (event: WheelEvent) => void;
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });

function nativeWheelCanvas(zoom = 1, userAgent = "Mac", activationKeyPressed = false, locked = false) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  const surface = document.createElement("div");
  surface.className = "react-flow react-flow__renderer";
  document.body.append(surface);
  Object.defineProperties(surface, { clientWidth: { value: 1000 }, clientHeight: { value: 800 } });
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({ x: 40, y: 60, left: 40, top: 60, right: 1040, bottom: 860, width: 1000, height: 800, toJSON() {} });
  const started = vi.fn(), moved = vi.fn(), ended = vi.fn();
  const pan = XYPanZoom({ domNode: surface, minZoom: .1, maxZoom: 8, viewport: { x: 125, y: -85, zoom },
    translateExtent: [[-Infinity, -Infinity], [Infinity, Infinity]], onDraggingChange: vi.fn(),
    onPanZoomStart: started, onPanZoom: moved, onPanZoomEnd: ended });
  pan.update({ noWheelClassName: "nowheel", noPanClassName: "nopan", preventScrolling: true, panOnScroll: true,
    panOnDrag: [0, 1], panOnScrollMode: PanOnScrollMode.Free, panOnScrollSpeed: 1, userSelectionActive: false,
    zoomOnPinch: true, zoomOnScroll: false, zoomOnDoubleClick: false, zoomActivationKeyPressed: activationKeyPressed,
    lib: "react", onTransformChange: vi.fn(), connectionInProgress: false, paneClickDistance: 5 });
  const flow = { viewportInitialized: true, getViewport: pan.getViewport, setViewport: pan.setViewport };
  const state = { userSelectionActive: false };
  const handler = createHandler(surface, flow, { getState: () => state }, locked);
  document.addEventListener("wheel", handler, { capture: true, passive: false });
  const wheel = (init: WheelEventInit, target: Element = surface) => {
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 440, clientY: 360, ...init });
    target.dispatchEvent(event);
    return event;
  };
  return { surface, pan, state, started, moved, ended, wheel, dispose() {
    document.removeEventListener("wheel", handler, true); pan.destroy(); surface.remove();
  } };
}

describe("canvas wheel zoom with the real pan/zoom engine", () => {
  it.each([.1, .13, .2, .23, .5, 1, 2, 4, 8])("limits a coarse Ctrl wheel step and keeps the pointer anchor at zoom %s", zoom => {
    const canvas = nativeWheelCanvas(zoom);
    try {
      const before = canvas.pan.getViewport();
      canvas.wheel({ ctrlKey: true, deltaY: -100 });
      const after = canvas.pan.getViewport();
      expect(after.zoom).toBeCloseTo(Math.min(8, zoom * STEP));
      expect((400 - after.x) / after.zoom).toBeCloseTo((400 - before.x) / before.zoom);
      expect((300 - after.y) / after.zoom).toBeCloseTo((300 - before.y) / before.zoom);
    } finally { canvas.dispose(); }
  });

  it.each([["Mac", "ctrlKey", false], ["Mac", "metaKey", true], ["Windows", "ctrlKey", true]] as const)("uses the same coarse input scale on %s with %s", (platform, modifier, activation) => {
    const canvas = nativeWheelCanvas(1, platform, activation);
    try {
      canvas.wheel({ [modifier]: true, deltaY: -120 });
      expect(canvas.pan.getViewport().zoom).toBeCloseTo(STEP);
    } finally { canvas.dispose(); }
  });

  it.each([.1, .2, .5, 1, 2, 4, 8])("bounds zoom-out without shifting the cursor anchor at zoom %s", zoom => {
    const canvas = nativeWheelCanvas(zoom);
    try {
      const before = canvas.pan.getViewport();
      canvas.wheel({ ctrlKey: true, deltaY: 120 });
      const after = canvas.pan.getViewport();
      expect(after.zoom).toBeCloseTo(Math.max(.1, zoom / STEP));
      expect((400 - after.x) / after.zoom).toBeCloseTo((400 - before.x) / before.zoom);
      expect((300 - after.y) / after.zoom).toBeCloseTo((300 - before.y) / before.zoom);
    } finally { canvas.dispose(); }
  });

  it.each([[0, -100], [0, -120], [0, -1000], [1, -3], [2, -1]])("normalizes coarse wheel units (mode %s, delta %s)", (deltaMode, deltaY) => {
    const canvas = nativeWheelCanvas();
    try {
      canvas.wheel({ ctrlKey: true, deltaMode, deltaY });
      expect(canvas.pan.getViewport().zoom).toBeCloseTo(STEP);
    } finally { canvas.dispose(); }
  });

  it("retains fine-delta accumulation across many events instead of stepping or rounding", () => {
    const canvas = nativeWheelCanvas();
    try {
      for (let i = 0; i < 24; i++) canvas.wheel({ ctrlKey: true, deltaY: -.5 });
      expect(canvas.pan.getViewport().zoom).toBeCloseTo(STEP, 10);
      for (let i = 0; i < 24; i++) canvas.wheel({ ctrlKey: true, deltaY: .5 });
      expect(canvas.pan.getViewport().zoom).toBeCloseTo(1, 10);
    } finally { canvas.dispose(); }
  });

  it("clamps at both limits without consuming further movement, then responds to reversal", () => {
    const canvas = nativeWheelCanvas();
    try {
      for (let i = 0; i < 60; i++) canvas.wheel({ ctrlKey: true, deltaY: -120 });
      expect(canvas.pan.getViewport().zoom).toBe(8);
      const upper = canvas.pan.getViewport();
      canvas.wheel({ ctrlKey: true, deltaY: -120 });
      expect(canvas.pan.getViewport()).toEqual(upper);
      for (let i = 0; i < 60; i++) canvas.wheel({ ctrlKey: true, deltaY: 120 });
      expect(canvas.pan.getViewport().zoom).toBe(.1);
      canvas.wheel({ ctrlKey: true, deltaY: -120 });
      expect(canvas.pan.getViewport().zoom).toBeCloseTo(.1 * STEP);
    } finally { canvas.dispose(); }
  });

  it("keeps fine pinch input continuous, reverses exactly, and stops without animation drift", () => {
    vi.useFakeTimers();
    const canvas = nativeWheelCanvas();
    try {
      const before = canvas.pan.getViewport();
      canvas.wheel({ ctrlKey: true, deltaY: -.5 });
      expect(canvas.pan.getViewport().zoom).toBeGreaterThan(1);
      expect(canvas.pan.getViewport().zoom).toBeLessThan(1.02);
      canvas.wheel({ ctrlKey: true, deltaY: .5 });
      expect(canvas.pan.getViewport().zoom).toBeCloseTo(before.zoom);
      expect(canvas.pan.getViewport().x).toBeCloseTo(before.x);
      for (let i = 0; i < 4; i++) canvas.wheel({ ctrlKey: true, deltaY: -120 });
      const stopped = canvas.pan.getViewport();
      expect(stopped.zoom).toBeCloseTo(STEP ** 4);
      vi.advanceTimersByTime(1000);
      expect(canvas.pan.getViewport()).toEqual(stopped);
      expect(canvas.ended).toHaveBeenCalledTimes(1);
      expect(canvas.ended.mock.lastCall?.[1]).toEqual(stopped);
    } finally { canvas.dispose(); }
  });
});

describe("canvas native wheel routing", () => {
  it.each([false, true])("leaves the camera unchanged during selection or a locked editor (locked=%s)", locked => {
    const canvas = nativeWheelCanvas(1, "Mac", false, locked);
    canvas.state.userSelectionActive = !locked;
    try {
      const before = canvas.pan.getViewport();
      expect(canvas.wheel({ ctrlKey: true, deltaY: -100 }).defaultPrevented).toBe(true);
      expect(canvas.pan.getViewport()).toEqual(before);
    } finally { canvas.dispose(); }
  });

  it("keeps plain wheel panning and nowheel panels separate from camera zoom", () => {
    const canvas = nativeWheelCanvas();
    try {
      canvas.wheel({ deltaX: 30, deltaY: 60 });
      expect(canvas.pan.getViewport()).toEqual({ x: 95, y: -145, zoom: 1 });
      canvas.surface.innerHTML = '<div class="nowheel"><button>control</button></div>';
      const target = canvas.surface.querySelector('button')!;
      for (const modifier of ['ctrlKey', 'metaKey']) canvas.wheel({ [modifier]: true, deltaY: -100 }, target);
      expect(canvas.pan.getViewport()).toEqual({ x: 95, y: -145, zoom: 1 });
    } finally { canvas.dispose(); }
  });

  it.each(["data-canvas-title-bar", "data-canvas-viewport-controls", "data-canvas-bottom-dock"])("blocks regular wheel and browser zoom on %s, including outside the flow surface", marker => {
    const surface = document.createElement("div");
    const toolbar = document.createElement("div");
    toolbar.setAttribute(marker, "");
    document.body.append(surface, toolbar);
    const handler = createHandler(surface);
    const reached = vi.fn();
    toolbar.addEventListener("wheel", reached);
    document.addEventListener("wheel", handler, { capture: true, passive: false });
    try {
      for (const ctrlKey of [false, true]) {
        const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey, deltaY: 100 });
        toolbar.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      }
      expect(reached).not.toHaveBeenCalled();
    } finally { document.removeEventListener("wheel", handler, true); }
  });
  it.each(['data-canvas-text-output-scroll', 'class="canvas-text-node-content"'])("zooms over text without temporarily removing scroll blockers: %s", marker => {
    const canvas = nativeWheelCanvas();
    canvas.surface.innerHTML = `<div ${marker}><div class="nowheel"><span>text</span></div></div>`;
    const target = canvas.surface.querySelector("span")!;
    const blocker = target.parentElement!;
    try {
      const initial = canvas.pan.getViewport();
      canvas.wheel({ deltaY: 10 }, target);
      expect(blocker.classList.contains("nowheel")).toBe(true);
      expect(canvas.pan.getViewport()).toEqual(initial);
      const zoom = canvas.wheel({ ctrlKey: true, deltaY: -100 }, target);
      expect(zoom.defaultPrevented).toBe(true);
      expect(blocker.classList.contains("nowheel")).toBe(true);
      expect(canvas.pan.getViewport().zoom).toBeCloseTo(STEP);
      // An ordinary wheel immediately after pinch still belongs to the text.
      const zoomed = canvas.pan.getViewport();
      canvas.wheel({ deltaY: 10 }, target);
      expect(canvas.pan.getViewport()).toEqual(zoomed);
    } finally { canvas.dispose(); }
  });
});
