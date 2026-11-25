export const CANVAS_MIN_ZOOM = 0.1;
export const CANVAS_MAX_ZOOM = 8;
export const CANVAS_ZOOM_STEP = 1.2;
// Below ~25% nodes are a few screen pixels wide: show the lightweight thumbnail form.
export const CANVAS_LOD_ENTER_ZOOM = 0.22;
export const CANVAS_LOD_EXIT_ZOOM = 0.25;
export type CanvasLodZone = "enter" | "hold" | "exit";

/** Dense graphs should not rebuild their visible contents at every animation step. */
export function getCanvasViewportAnimationDuration(nodeCount: number, edgeCount: number, reducedMotion = false, duration = 300) {
  return reducedMotion || nodeCount >= 100 || edgeCount >= 200 ? 0 : duration;
}

export function clampCanvasZoomPercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(800, Math.max(10, Math.round(value)));
}

export function parseCanvasZoomPercent(value: string, current: number): number {
  const text = value.trim().replace(/%$/, "").trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return current;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? clampCanvasZoomPercent(parsed) : current;
}

export function getCanvasDotGap(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : CANVAS_MIN_ZOOM;
  return Math.min(80, Math.max(16, Math.round(16 / safeZoom)));
}

export function resolveCanvasLod(zoom: number, previous: boolean): boolean {
  return resolveCanvasLodZone(getCanvasLodZone(zoom), previous);
}

export function getCanvasLodZone(zoom: number): CanvasLodZone {
  if (zoom < CANVAS_LOD_ENTER_ZOOM) return "enter";
  if (zoom >= CANVAS_LOD_EXIT_ZOOM) return "exit";
  return "hold";
}

export function resolveCanvasLodZone(zone: CanvasLodZone, previous: boolean): boolean {
  if (zone === "enter") return true;
  if (zone === "exit") return false;
  return previous;
}
