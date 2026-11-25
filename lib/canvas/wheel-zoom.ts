import type { CanvasViewport } from "./document";
import { CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM } from "./visual-policy";

/** Wheel pixels per doubling. Matches the React Flow pinch curve, so trackpads feel familiar. */
const CANVAS_WHEEL_PIXELS_PER_DOUBLING = 50;
/** Largest wheel delta applied by one event. One mouse notch becomes one bounded step. */
const CANVAS_WHEEL_MAX_DELTA = 12;
/** Zoom ratio of one coarse wheel notch. */
export const CANVAS_WHEEL_ZOOM_STEP = 2 ** (CANVAS_WHEEL_MAX_DELTA / CANVAS_WHEEL_PIXELS_PER_DOUBLING);

/** Bound coarse wheel ticks while keeping fractional trackpad input continuous. */
export function getCanvasWheelZoomViewport(viewport: CanvasViewport, event: Pick<WheelEvent, "deltaY" | "deltaMode" | "clientX" | "clientY">, bounds: Pick<DOMRect, "left" | "top" | "height">): CanvasViewport | null {
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
  // WheelEvent does not reliably identify the device. Use the same bounded
  // curve for Ctrl/Meta wheels and pinch events, without an OS multiplier.
  const delta = Math.max(-CANVAS_WHEEL_MAX_DELTA, Math.min(CANVAS_WHEEL_MAX_DELTA, pixels));
  const zoom = Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, viewport.zoom * 2 ** (-delta / CANVAS_WHEEL_PIXELS_PER_DOUBLING)));
  if (zoom === viewport.zoom) return null;
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const ratio = zoom / viewport.zoom;
  return { x: x - (x - viewport.x) * ratio, y: y - (y - viewport.y) * ratio, zoom };
}
