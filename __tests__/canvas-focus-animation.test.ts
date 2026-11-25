import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { animateCanvasFocus } from "@/lib/canvas/focus-animation";
const state = vi.hoisted(() => ({ animate: vi.fn() }));
vi.mock("@/lib/canvas/focus-preview", () => ({ createCanvasFocusPreview: () => {
  const canvas = document.createElement("canvas"); canvas.animate = state.animate; return canvas;
} }));

let root: HTMLDivElement, element: HTMLDivElement, edges: HTMLDivElement;
let resolve: () => void, reject: (error: Error) => void;
let animation: { finished: Promise<void>; cancel: ReturnType<typeof vi.fn> };
let apply: ReturnType<typeof vi.fn>, onEnd: ReturnType<typeof vi.fn>;
let controller: ReturnType<typeof animateCanvasFocus>;
const from = { x: -400, y: -300, zoom: .1 };
const to = { x: -4200, y: -3100, zoom: 1.8 };
beforeEach(() => {
  root = document.createElement("div"); element = document.createElement("div"); edges = document.createElement("div");
  edges.className = "react-flow__edges"; edges.style.clipPath = "inset(0px)";
  element.append(edges); root.append(element); document.body.append(root);
  Object.defineProperties(root, { clientWidth: { value: 1200 }, clientHeight: { value: 800 } });
  animation = { finished: new Promise<void>((yes, no) => { resolve = yes; reject = no; }), cancel: vi.fn() };
  state.animate.mockReset().mockImplementation(() => animation as unknown as Animation);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("DOMMatrixReadOnly", class { a = .8; e = -1600; f = -1200; });
  apply = vi.fn(); onEnd = vi.fn();
  controller = animateCanvasFocus({ root, element, from, to, duration: 360, apply, onEnd });
});
afterEach(() => { controller?.dispose(); root.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("animates transforms without store updates until completion, then commits exactly once", async () => {
  expect(state.animate).toHaveBeenCalledWith([
    { transform: "translate(0px, 0px) scale(1)" },
    { transform: "translate(3000px, 2300px) scale(18)" },
  ], expect.objectContaining({ duration: 360, fill: "both" }));
  expect(apply).not.toHaveBeenCalled();
  expect(root.hasAttribute("data-canvas-focus-animating")).toBe(true);
  expect(element.style.opacity).toBe("0");
  resolve(); await animation.finished;
  expect(apply).toHaveBeenCalledOnce(); expect(apply).toHaveBeenCalledWith(to);
  expect(element.style.transform).toBe("translate(-4200px, -3100px) scale(1.8)");
  expect(root.hasAttribute("data-canvas-focus-animating")).toBe(false);
  expect(edges.style.clipPath).toBe("inset(0px)");
  expect(element.style.opacity).toBe("");
  expect(root.querySelector('canvas')).toBeNull();
  expect(onEnd).toHaveBeenCalledOnce();
});

it.each(["pointerdown", "wheel", "keydown", "blur"])("commits the currently displayed viewport on %s, with no later snap to the destination", async type => {
  window.dispatchEvent(new Event(type));
  expect(apply).toHaveBeenCalledOnce(); expect(apply.mock.calls[0][0]).toMatchObject({ x: -1920, y: -1440 });
  expect(apply.mock.calls[0][0].zoom).toBeCloseTo(.08);
  resolve(); await animation.finished;
  expect(apply).toHaveBeenCalledOnce();
  expect(onEnd).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event(type));
  expect(apply).toHaveBeenCalledOnce();
});

it("disposes on unmount without saving or calling a component state setter", async () => {
  controller!.dispose();
  reject(new Error("cancelled")); await animation.finished.catch(() => {});
  expect(apply).not.toHaveBeenCalled(); expect(onEnd).not.toHaveBeenCalled();
  expect(root.hasAttribute("data-canvas-focus-animating")).toBe(false);
  window.dispatchEvent(new Event("wheel")); expect(apply).not.toHaveBeenCalled();
});

it("interrupts when the document becomes hidden", () => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(apply).toHaveBeenCalledOnce(); expect(apply.mock.calls[0][0]).toMatchObject({ x: -1920, y: -1440 });
});

it("uses the live renderer when focusing would zoom out beyond the captured screen", () => {
  controller!.dispose();
  state.animate.mockClear();
  expect(animateCanvasFocus({ root, element, from: to, to: from, duration: 360, apply, onEnd })).toBeNull();
  expect(state.animate).not.toHaveBeenCalled();
  expect(element.style.opacity).toBe("");
});

it("captures only decoded media at a bounded pixel size and preserves cover cropping", async () => {
  controller!.dispose();
  const { createCanvasFocusPreview } = await vi.importActual<typeof import("@/lib/canvas/focus-preview")>("@/lib/canvas/focus-preview");
  const ctx = { setTransform: vi.fn(), fillRect: vi.fn(), save: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), drawImage: vi.fn(), restore: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as any);
  vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(3);
  const node = document.createElement("div"); node.className = "react-flow__node";
  const image = document.createElement("img"); image.style.objectFit = "cover"; image.style.opacity = "1";
  Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 200 }, naturalHeight: { value: 100 } });
  const pending = document.createElement("img");
  node.append(image, pending); element.append(node);
  const rect = { x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON() {} };
  vi.spyOn(node, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect);
  const preview = createCanvasFocusPreview(root, element, from)!;
  expect(preview.width).toBe(2400); expect(preview.height).toBe(1600);
  expect(ctx.drawImage).toHaveBeenCalledOnce();
  expect(ctx.drawImage).toHaveBeenCalledWith(image, -50, 0, 200, 100);
  expect(preview.getAttribute("aria-hidden")).toBe("true");
  expect(preview.style.pointerEvents).toBe("none");
  const overscan = createCanvasFocusPreview(root, element, from, { x: 1000, y: -6000, zoom: 2 })!;
  expect(overscan.style.left).toBe("-450px");
  expect(overscan.style.transformOrigin).toBe("450px 0px");
  expect(overscan.width).toBe(3300);
});
