"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useStoreApi } from "@xyflow/react";

/**
 * Travelling edge flows drawn on one screen-sized canvas between the edges and the nodes.
 *
 * Each canvas curve is its own SVG. Animating `stroke-dashoffset` on dozens of long curves
 * repaints the whole edge layer every frame, which flickers when a reference feeds many
 * tasks. Here only this canvas redraws; the SVG edge layer stays untouched.
 */
export type CanvasEdgeFlowRegistry = {
  set(id: string, path: string): void;
  delete(id: string): void;
  subscribe(listener: () => void): () => void;
  paths(): ReadonlyMap<string, string>;
};

export function createCanvasEdgeFlowRegistry(): CanvasEdgeFlowRegistry {
  const flows = new Map<string, string>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  return {
    set(id, path) {
      if (flows.get(id) === path) return;
      flows.set(id, path);
      notify();
    },
    delete(id) {
      if (flows.delete(id)) notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    paths: () => flows,
  };
}

export const CanvasEdgeFlowRegistryContext = React.createContext<CanvasEdgeFlowRegistry | null>(null);

/** Returns true when the shared layer draws this edge's flow; callers fall back to SVG otherwise. */
export function useCanvasEdgeFlowRegistration(id: string, path: string, active: boolean) {
  const registry = React.useContext(CanvasEdgeFlowRegistryContext);
  // Lifetime and geometry are separate: a dragged node changes the path every frame,
  // which must update the drawing without unregistering (and restarting) the flow.
  React.useEffect(() => {
    if (!registry || !active) return;
    return () => registry.delete(id);
  }, [registry, id, active]);
  React.useEffect(() => {
    if (registry && active && path) registry.set(id, path);
  }, [registry, id, path, active]);
  return Boolean(registry);
}

const FLOW_PERIOD_MS = 3000;
/** Path lengths are normalised to 300 units, like the SVG flow (`pathLength={300}`). */
const FLOW_PATH_UNITS = 300;
const FLOW_GROUP_ALPHA = 0.65;
/** Soft halo, fading tail and bright head of the comet; widths are screen pixels up to 100%. */
const FLOW_LAYERS = [
  { dash: [36, 64], width: 8, alpha: 0.12, cap: "round", tone: "tail" },
  { dash: [24, 76], width: 2.5, alpha: 0.35, cap: "butt", tone: "tail" },
  { dash: [0, 24, 12, 64], width: 2.5, alpha: 0.9, cap: "butt", tone: "head" },
] as const;

export function getCanvasEdgeFlowDash(dash: readonly number[], length: number) {
  return dash.map(value => value * length / FLOW_PATH_UNITS);
}

/** Moves the comet from the source toward the target, one loop per period. */
export function getCanvasEdgeFlowOffset(now: number, length: number) {
  return -((now % FLOW_PERIOD_MS) / FLOW_PERIOD_MS) * length;
}

/**
 * `paused` is the live gesture state (camera or node moving), not the settled one:
 * flows disappear while the hand moves and light up in the frame the hand lets go.
 */
export function CanvasEdgeFlowLayer({ paused }: { paused: boolean }) {
  const registry = React.useContext(CanvasEdgeFlowRegistryContext);
  const store = useStoreApi();
  const interacting = paused;
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const measureRef = React.useRef<SVGPathElement>(null);
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const [count, setCount] = React.useState(0);
  // React Flow's label layer sits above the edges and below the nodes, inside the
  // zoomed viewport. Portal there directly, as the shared passive edge layer does.
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    setHost(anchorRef.current?.closest(".react-flow")?.querySelector<HTMLElement>(".react-flow__edgelabel-renderer") ?? null);
  }, []);

  React.useEffect(() => {
    if (!registry) return;
    setCount(registry.paths().size);
    return registry.subscribe(() => setCount(registry.paths().size));
  }, [registry]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const measure = measureRef.current;
    const context = canvas?.getContext("2d");
    if (!registry || !canvas || !measure || !context) return;
    // Flows pause while the camera or a node moves, exactly like the SVG version.
    if (interacting || count === 0) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.visibility = "hidden";
      return;
    }
    canvas.style.visibility = "visible";
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const shapes = new Map<string, { path: Path2D; length: number }>();
    const shapeOf = (d: string) => {
      let shape = shapes.get(d);
      if (!shape) {
        measure.setAttribute("d", d);
        shape = { path: new Path2D(d), length: measure.getTotalLength() };
        shapes.set(d, shape);
      }
      return shape;
    };
    let frame = 0;
    let placement = "";
    const draw = (now: number) => {
      const { transform: [x, y, zoom], width, height } = store.getState();
      if (!(zoom > 0 && width > 0 && height > 0)) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const next = `${x}:${y}:${zoom}:${width}:${height}:${ratio}`;
      if (next !== placement) {
        placement = next;
        // The renderer lives inside the zoomed viewport: undo its transform so the
        // canvas always covers exactly the visible screen at device resolution.
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.style.transform = `translate(${-x / zoom}px, ${-y / zoom}px) scale(${1 / zoom})`;
      }
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(ratio * zoom, 0, 0, ratio * zoom, ratio * x, ratio * y);
      // Read every frame: the highlight colour setting changes this variable live.
      // 光晕和拖尾用尾色、亮头用主色；选了单色高光时两者相同
      const style = getComputedStyle(canvas);
      const head = style.getPropertyValue("--canvas-edge-flow").trim() || "#2ee6a8";
      const tail = style.getPropertyValue("--canvas-edge-flow-tail").trim() || head;
      // Same screen weight as the SVG edges: thin at overview, capped above 100%.
      const unit = 1 / Math.max(1, zoom);
      for (const d of registry.paths().values()) {
        const { path, length } = shapeOf(d);
        if (!(length > 0)) continue;
        const offset = reducedMotion ? 0 : getCanvasEdgeFlowOffset(now, length);
        for (const layer of FLOW_LAYERS) {
          context.strokeStyle = layer.tone === "head" ? head : tail;
          context.globalAlpha = layer.alpha * FLOW_GROUP_ALPHA * (reducedMotion ? 0.7 : 1);
          context.lineWidth = layer.width * unit;
          context.lineCap = layer.cap;
          context.setLineDash(getCanvasEdgeFlowDash(layer.dash, length));
          context.lineDashOffset = offset;
          context.stroke(path);
        }
      }
      context.globalAlpha = 1;
    };
    const loop = (now: number) => {
      draw(now);
      frame = requestAnimationFrame(loop);
    };
    if (reducedMotion) {
      draw(performance.now());
      // Still follow geometry changes (new paths) without animating.
      const unsubscribe = registry.subscribe(() => draw(performance.now()));
      return () => unsubscribe();
    }
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [registry, store, interacting, count, host]);

  if (!registry) return null;
  return <>
    <span ref={anchorRef} hidden />
    {host ? createPortal(<>
      <canvas
        ref={canvasRef}
        data-canvas-edge-flow-layer
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0"
        style={{ transformOrigin: "0 0", visibility: "hidden" }}
      />
      <svg aria-hidden="true" width="0" height="0" className="pointer-events-none absolute" style={{ visibility: "hidden" }}>
        <path ref={measureRef} />
      </svg>
    </>, host) : null}
  </>;
}
