import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerCanvasEdgeFlow } from "@/lib/canvas/edge-flow-renderer";

let root: HTMLElement, viewport: HTMLElement, edges: HTMLElement, nodes: HTMLElement;
let frames: Map<number, FrameRequestCallback>;
let cleanups: Array<() => void>;
let media: EventTarget & { matches: boolean };
let ctx: Record<string, any>;
let resized: () => void;
const matrix = { a: .1, b: 0, c: 0, d: .1, e: 300, f: 200 };
beforeEach(() => {
  root = document.createElement("div"); root.className = "react-flow";
  viewport = document.createElement("div"); viewport.className = "react-flow__viewport";
  edges = document.createElement("div"); edges.className = "react-flow__edges";
  nodes = document.createElement("div"); nodes.className = "react-flow__nodes";
  viewport.append(edges, nodes); root.append(viewport); document.body.append(root);
  root.getBoundingClientRect = () => ({ left: 10, top: 20, width: 1000, height: 800 } as DOMRect);
  frames = new Map(); cleanups = []; let id = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++id, cb); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("Path2D", class { constructor(public d?: string) {} moveTo() {} lineTo() {} });
  vi.stubGlobal("DOMMatrix", class { inverse() { return { toString: () => "matrix(10,0,0,10,-3000,-2000)" }; } });
  vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { resized = cb; } observe() {} disconnect() {} });
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => media);
  ctx = { setTransform: vi.fn(), clearRect: vi.fn(), setLineDash: vi.fn(), stroke: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as any);
  vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(3);
});
afterEach(() => {
  cleanups.forEach(clean => clean());
  expect(frames.size).toBe(0);
  root.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
function add() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const group = document.createElementNS(svg.namespaceURI, "g") as SVGGElement;
  const path = document.createElementNS(svg.namespaceURI, "path") as SVGPathElement;
  path.setAttribute("d", "M 0 0 C 100 0 100 200 300 200");
  path.style.stroke = "rgb(105, 181, 253)"; path.style.strokeWidth = "2.5px";
  path.getTotalLength = vi.fn(() => 300);
  path.getScreenCTM = vi.fn(() => ({ ...matrix } as DOMMatrix));
  group.append(path); svg.append(group); edges.append(svg);
  const cleanup = registerCanvasEdgeFlow(group);
  if (cleanup) cleanups.push(cleanup);
  return { group, path, cleanup };
}
function frame(time = 100) {
  const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb(time));
}

it("draws all 65 connections with one clock, caches geometry, and releases the last surface", () => {
  const flows = Array.from({ length: 65 }, add);
  expect(root.querySelectorAll("canvas")).toHaveLength(1);
  expect(frames.size).toBe(1);
  frame();
  expect(ctx.stroke).toHaveBeenCalledTimes(130);
  frame(200);
  expect(ctx.stroke).toHaveBeenCalledTimes(260);
  flows.forEach(({ path, group }) => {
    expect(path.getTotalLength).toHaveBeenCalledOnce();
    expect(path.getScreenCTM).toHaveBeenCalledOnce();
    expect(group.style.visibility).toBe("hidden");
    expect(group.style.animation).toBe("none");
  });
  cleanups.splice(0, 64).forEach(clean => clean());
  expect(root.querySelectorAll("canvas")).toHaveLength(1);
  cleanups.pop()!();
  expect(root.querySelector("canvas")).toBeNull();
  expect(frames.size).toBe(0);
  expect(flows[64].group.style.visibility).toBe("");
});

it("keeps a bounded screen surface above base edges and below node cards", () => {
  add(); frame();
  const canvas = root.querySelector("canvas")!;
  expect([...viewport.children]).toEqual([edges, canvas, nodes]);
  expect(canvas.width).toBe(2000); expect(canvas.height).toBe(1600);
  expect(canvas.style.opacity).toBe("0.75");
  expect(canvas.style.transform).toBe("matrix(10,0,0,10,-3000,-2000)");
  expect(ctx.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
  expect(ctx.lineWidth).toBe(.65); expect(ctx.globalAlpha).toBe(.9);
});

it("reprojects after resize and viewport movement without remeasuring curve length", async () => {
  const { path } = add(); frame();
  vi.mocked(path.getScreenCTM).mockReturnValue({ ...matrix, a: .5, d: .5 } as DOMMatrix);
  resized(); frame();
  expect(ctx.lineWidth).toBe(1.25);
  viewport.style.transform = "translate(10px, 20px) scale(.5)";
  await Promise.resolve(); frame();
  expect(path.getScreenCTM).toHaveBeenCalledTimes(3);
  expect(path.getTotalLength).toHaveBeenCalledOnce();
});

it("stops the clock in a hidden document and resumes exactly one clock", () => {
  add(); frame();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(frames.size).toBe(0);
  hidden.mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(frames.size).toBe(1);
});

it("renders a static highlight for reduced motion and responds to preference changes", () => {
  media.matches = true; add(); frame();
  expect(ctx.stroke).toHaveBeenCalledTimes(2);
  expect(frames.size).toBe(0);
  media.matches = false; media.dispatchEvent(new Event("change"));
  expect(frames.size).toBe(1); frame(); expect(frames.size).toBe(1);
});

it("leaves SVG fallback intact when canvas rendering is unavailable", () => {
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
  const { group, cleanup } = add();
  expect(cleanup).toBeUndefined(); expect(group.style.visibility).toBe("");
  expect(root.querySelector("canvas")).toBeNull(); expect(frames.size).toBe(0);
});
