import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XYPanZoom, PanOnScrollMode, type PanZoomInstance } from "@xyflow/system";
import { bindCanvasPanReleaseGuard } from "@/lib/canvas/pan-release-guard";

let surface: HTMLDivElement, pan: PanZoomInstance;
let guard: ReturnType<typeof bindCanvasPanReleaseGuard>;
let released: ReturnType<typeof vi.fn>;
let ended: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  const NativeMouseEvent = MouseEvent;
  // jsdom rejects Vitest's window proxy in UIEventInit; d3 still needs .view.
  vi.stubGlobal("MouseEvent", class extends NativeMouseEvent {
    constructor(type: string, init: MouseEventInit = {}) {
      super(type, { ...init, view: undefined });
      Object.defineProperty(this, "view", { value: window });
    }
  });
  surface = document.createElement("div"); document.body.append(surface);
  Object.defineProperties(surface, { clientWidth: { value: 1000 }, clientHeight: { value: 800 } });
  released = vi.fn();
  ended = vi.fn();
  guard = bindCanvasPanReleaseGuard(released);
  pan = XYPanZoom({ domNode: surface, minZoom: .1, maxZoom: 8, viewport: { x: 0, y: 0, zoom: 1 },
    translateExtent: [[-Infinity, -Infinity], [Infinity, Infinity]], onDraggingChange: vi.fn(), onPanZoomStart: event => guard.start(event), onPanZoomEnd: ended });
  pan.update({ noWheelClassName: "nowheel", noPanClassName: "nopan", preventScrolling: true, panOnScroll: true,
    panOnDrag: [0, 1], panOnScrollMode: PanOnScrollMode.Free, panOnScrollSpeed: 1, userSelectionActive: false,
    zoomOnPinch: true, zoomOnScroll: false, zoomOnDoubleClick: false, zoomActivationKeyPressed: false,
    lib: "react", onTransformChange: vi.fn(), connectionInProgress: false, paneClickDistance: 5 });
});
afterEach(() => { guard.dispose(); pan.destroy(); surface.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const mouse = (type: string, x: number, buttons: number, button = 0) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 200, buttons, button });
function start(button = 0) {
  const buttons = button === 0 ? 1 : 4;
  surface.dispatchEvent(mouse("mousedown", 100, buttons, button));
  window.dispatchEvent(mouse("mousemove", 140, buttons, button));
  expect(pan.getViewport().x).toBe(40);
}

describe("native canvas mouse pan release", () => {
  it("reproduces the previous drag's delayed end callback during a new held drag", () => {
    start(); window.dispatchEvent(mouse("mouseup", 140, 0));
    expect(ended).not.toHaveBeenCalled();
    surface.dispatchEvent(mouse("mousedown", 200, 1));
    window.dispatchEvent(mouse("mousemove", 230, 1));
    vi.advanceTimersByTime(151);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended.mock.calls[0][1].x).toBe(40);
    window.dispatchEvent(mouse("mousemove", 260, 1));
    expect(pan.getViewport().x).toBe(100);
    window.dispatchEvent(mouse("mouseup", 260, 0));
  });
  it.each(['touch', 'pen'])("does not let an unrelated %s pointer interrupt a held mouse drag", pointerType => {
    start();
    for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
      const event = mouse(type, 140, 0);
      Object.defineProperty(event, 'pointerType', { value: pointerType });
      window.dispatchEvent(event);
    }
    window.dispatchEvent(mouse('mousemove', 200, 1));
    expect(pan.getViewport().x).toBe(100);
    expect(released).not.toHaveBeenCalled();
    window.dispatchEvent(mouse('mouseup', 200, 0));
  });
  it.each([0, 1])("stops before a zero-button move reaches the native engine (button %s)", button => {
    start(button);
    window.dispatchEvent(mouse("mousemove", 200, 0, button));
    window.dispatchEvent(mouse("mousemove", 250, 0, button));
    expect(pan.getViewport().x).toBe(40);
    expect(released).toHaveBeenCalledTimes(1);
  });
  it.each(["mouseup", "pointerup", "pointercancel", "blur", "hidden", "Escape", "unmount"])("cleans up the actual pan engine after %s", reason => {
    start();
    if (reason === "hidden") {
      vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      document.dispatchEvent(new Event("visibilitychange"));
    } else if (reason === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    else if (reason === "unmount") guard.dispose();
    else window.dispatchEvent(mouse(reason, 140, 0));
    window.dispatchEvent(mouse("mousemove", 220, 0));
    expect(pan.getViewport().x).toBe(40);
    expect(released).toHaveBeenCalledTimes(1);
  });
  it("permits another drag while the hand tool or Space is still active", () => {
    start(); window.dispatchEvent(mouse("pointerup", 140, 0));
    surface.dispatchEvent(mouse("mousedown", 200, 1));
    window.dispatchEvent(mouse("mousemove", 230, 1));
    expect(pan.getViewport().x).toBe(70);
    window.dispatchEvent(mouse("mouseup", 230, 0));
    window.dispatchEvent(mouse("mousemove", 300, 0));
    expect(pan.getViewport().x).toBe(70);
    expect(released).toHaveBeenCalledTimes(2);
  });
  it("does not cancel a held left drag when only another mouse button is released", () => {
    start(); window.dispatchEvent(mouse("pointerup", 140, 1, 2));
    window.dispatchEvent(mouse("mousemove", 200, 1));
    expect(pan.getViewport().x).toBe(100);
    expect(released).not.toHaveBeenCalled();
  });
  it("leaves wheel and programmatic viewport changes outside the mouse guard", () => {
    surface.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 }));
    const viewport = pan.getViewport();
    expect(viewport.y).toBe(-120);
    window.dispatchEvent(mouse("mousemove", 220, 0));
    expect(pan.getViewport()).toEqual(viewport);
    expect(released).not.toHaveBeenCalled();
  });
});
