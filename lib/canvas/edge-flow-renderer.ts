import { traceFlowStroke, getVisibleFlowLines, type FlowLine } from "./edge-flow-geometry";

type FlowEntry = {
  element: SVGPathElement;
  path: Path2D;
  unit: number;
  matrix?: DOMMatrix;
  color?: string;
  width?: number;
  lines?: FlowLine[] | null;
};

type FlowRenderer = { add: (element: SVGPathElement) => () => void };
const renderers = new WeakMap<HTMLElement, FlowRenderer>();

// One screen-sized surface and one clock per board. SVG dashes otherwise repaint
// the full (potentially enormous) bounds of every connected curve every frame.
function createRenderer(root: HTMLElement, viewport: HTMLElement): FlowRenderer | null {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  canvas.dataset.canvasEdgeFlowLayer = "";
  // Opacity on the whole surface also caps brightness where many flows overlap.
  canvas.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;transform-origin:0 0;opacity:0.75";
  const edges = viewport.querySelector(".react-flow__edges");
  if (edges) edges.after(canvas);
  else viewport.prepend(canvas);
  const entries = new Set<FlowEntry>();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let dirty = true;
  let disposed = false;
  let dpr = 1;
  let left = 0;
  let top = 0;

  function schedule() {
    if (!disposed && !document.hidden && !frame && entries.size) frame = requestAnimationFrame(draw);
  }
  function invalidate() { dirty = true; schedule(); }
  function updateProjection() {
    const rect = root.getBoundingClientRect();
    left = rect.left; top = rect.top;
    dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / Math.max(1, rect.width * rect.height)));
    const width = Math.max(1, Math.ceil(rect.width * dpr));
    const height = Math.max(1, Math.ceil(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    // Keep the bitmap in screen pixels while retaining the viewport's stacking
    // order: flow below node cards and controls, never across their media.
    const transform = getComputedStyle(viewport).transform;
    canvas.style.transform = new DOMMatrix(transform === "none" ? undefined : transform).inverse().toString();
    for (const entry of entries) {
      entry.matrix = entry.element.getScreenCTM() ?? undefined;
      const style = getComputedStyle(entry.element);
      entry.color = style.stroke;
      entry.width = parseFloat(style.strokeWidth) || 2.5;
      if (entry.matrix) entry.lines = getVisibleFlowLines(entry.element.getAttribute("d") || "", entry.matrix, left, top, rect.width, rect.height);
    }
    dirty = false;
  }
  function draw(time: number) {
    frame = 0;
    if (disposed || document.hidden) return;
    if (dirty) updateProjection();
    ctx!.setTransform(1, 0, 0, 1, 0, 0);
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    const phase = reducedMotion.matches ? 0 : (time % 3000) / 10;
    for (const entry of entries) {
      const m = entry.matrix;
      if (!m) continue;
      if (entry.lines) {
        if (!entry.lines.length) continue;
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx!.strokeStyle = entry.color!;
        // Keep isolated packets readable when zoomed out; the surface opacity
        // still caps the brightness of densely overlapping connections.
        ctx!.lineWidth = Math.max(0.65, entry.width! * Math.hypot(m.a, m.b));
        ctx!.setLineDash([]);
        ctx!.beginPath(); traceFlowStroke(entry.lines, phase, "tail", ctx!);
        ctx!.globalAlpha = 0.35; ctx!.stroke();
        ctx!.beginPath(); traceFlowStroke(entry.lines, phase, "head", ctx!);
        ctx!.globalAlpha = 0.9; ctx!.stroke();
        continue;
      }
      ctx!.setTransform(m.a * dpr, m.b * dpr, m.c * dpr, m.d * dpr, (m.e - left) * dpr, (m.f - top) * dpr);
      ctx!.strokeStyle = entry.color!;
      ctx!.lineWidth = Math.max(entry.width!, 0.65 / Math.max(0.001, Math.hypot(m.a, m.b)));
      ctx!.lineDashOffset = -phase * entry.unit;
      ctx!.setLineDash([24 * entry.unit, 76 * entry.unit]);
      ctx!.globalAlpha = 0.35;
      ctx!.stroke(entry.path);
      ctx!.setLineDash([0, 24 * entry.unit, 12 * entry.unit, 64 * entry.unit]);
      ctx!.globalAlpha = 0.9;
      ctx!.stroke(entry.path);
    }
    if (!reducedMotion.matches) schedule();
  }
  function visibilityChanged() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    invalidate();
  }
  const resize = new ResizeObserver(invalidate);
  resize.observe(root);
  const mutation = new MutationObserver(invalidate);
  mutation.observe(viewport, { attributes: true, attributeFilter: ["style"] });
  mutation.observe(root, { attributes: true, attributeFilter: ["class", "style"] });
  const appearance = root.closest("[data-canvas-appearance]");
  if (appearance) mutation.observe(appearance, { attributes: true, attributeFilter: ["style"] });
  document.addEventListener("visibilitychange", visibilityChanged);
  reducedMotion.addEventListener("change", invalidate);
  return {
    add(element) {
      const entry: FlowEntry = {
        element,
        path: new Path2D(element.getAttribute("d") || ""),
        unit: element.getTotalLength() / 300,
      };
      entries.add(entry);
      invalidate();
      return () => {
        entries.delete(entry);
        if (entries.size) { invalidate(); return; }
        disposed = true;
        if (frame) cancelAnimationFrame(frame);
        resize.disconnect();
        mutation.disconnect();
        document.removeEventListener("visibilitychange", visibilityChanged);
        reducedMotion.removeEventListener("change", invalidate);
        canvas.remove();
        renderers.delete(root);
      };
    },
  };
}

export function registerCanvasEdgeFlow(group: SVGGElement): (() => void) | undefined {
  const root = group.closest<HTMLElement>(".react-flow");
  const viewport = root?.querySelector<HTMLElement>(".react-flow__viewport");
  const path = group.querySelector("path");
  if (!root || !viewport || !path || typeof Path2D === "undefined") return;
  let renderer = renderers.get(root);
  if (!renderer) {
    renderer = createRenderer(root, viewport) ?? undefined;
    if (!renderer) return;
    renderers.set(root, renderer);
  }
  const unregister = renderer.add(path);
  // Retain the geometry for updates, but stop both SVG painting and its CSS clock.
  group.style.visibility = "hidden";
  group.style.animation = "none";
  return () => {
    unregister();
    group.style.removeProperty("visibility");
    group.style.removeProperty("animation");
  };
}
